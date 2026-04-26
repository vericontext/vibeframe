#!/usr/bin/env tsx
/**
 * Pass 1 — single-shot single-beat experiment.
 *
 * Goal: confirm Claude Sonnet 4.6 with full Hyperframes-skill context can
 * produce a sub-composition HTML file that survives `vibe scene lint`.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... pnpm exec tsx tests/v059-preflight/run-pass-1.ts
 *
 * Inputs:  tests/v059-preflight/fixtures/{DESIGN.md, STORYBOARD.md}
 * Output:  tests/v059-preflight/project-shell/compositions/scene-beat-1.html
 *          + lint report
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const HF_SKILLS = resolve(ROOT, "../../oss/hyperframes/skills/hyperframes");

// ---------------------------------------------------------------------------
// Load .env if present (api keys)
// ---------------------------------------------------------------------------
const envPath = resolve(ROOT, ".env");
if (existsSync(envPath)) {
  const raw = readFileSync(envPath, "utf-8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY not set in env or .env");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load the skill bundle (the cinematic-craft system prompt)
// ---------------------------------------------------------------------------
function loadSkillBundle(): string {
  const files = [
    [`${HF_SKILLS}/SKILL.md`, "hyperframes/SKILL.md"],
    [`${HF_SKILLS}/house-style.md`, "hyperframes/house-style.md"],
    [`${HF_SKILLS}/references/motion-principles.md`, "hyperframes/references/motion-principles.md"],
    [`${HF_SKILLS}/references/typography.md`, "hyperframes/references/typography.md"],
    [`${HF_SKILLS}/references/transitions.md`, "hyperframes/references/transitions.md"],
  ];
  const parts: string[] = [];
  for (const [path, label] of files) {
    if (!existsSync(path)) {
      console.warn(`SKIP missing: ${path}`);
      continue;
    }
    parts.push(`\n\n=== ${label} ===\n\n` + readFileSync(path, "utf-8"));
  }
  return parts.join("\n");
}

const skillBundle = loadSkillBundle();
const designMd = readFileSync(resolve(__dirname, "fixtures/DESIGN.md"), "utf-8");
const storyboard = readFileSync(resolve(__dirname, "fixtures/STORYBOARD.md"), "utf-8");

console.log(`Skill bundle:    ${skillBundle.length.toLocaleString()} chars`);
console.log(`DESIGN.md:       ${designMd.length} chars`);
console.log(`STORYBOARD.md:   ${storyboard.length} chars`);

// ---------------------------------------------------------------------------
// Build the prompt
// ---------------------------------------------------------------------------

const systemPrompt = `You are a Hyperframes composition author. The skill content below
defines the framework rules, motion principles, and quality standards.
Read it thoroughly before writing any HTML.

${skillBundle}

=== DESIGN.md (project-specific visual identity — HARD-GATE, every decision must trace back) ===

${designMd}`;

const userPrompt = `Build the Hyperframes sub-composition HTML for **Beat 1** of the storyboard
below. The composition will be loaded into a root index.html via
\`data-composition-src="compositions/scene-beat-1.html"\`.

Requirements (non-negotiable):
- Use the \`<template>\` wrapper (this is a sub-composition, not standalone)
- Composition id: \`scene-beat-1\`
- \`data-width="1920" data-height="1080"\`
- One paused GSAP timeline registered on \`window.__timelines["scene-beat-1"]\`
- All timed elements have \`class="clip"\` and \`data-start\`, \`data-duration\`, \`data-track-index\`
- No \`Math.random()\`, \`Date.now()\`, \`repeat: -1\`, or \`<br>\` in content
- Layout-before-animation: position elements at their hero-frame state in CSS, animate FROM
- No exit animations — the final scene rule does not apply here (this is Beat 1, not the last beat)
- Strictly follow DESIGN.md palette (#0A0A0F, #F5F5F7, #0066FF), Inter typography, Swiss Pulse motion (expo.out / power3.out / power4.out)

=== Beat to build ===

${storyboard}

=== Output format ===

Return ONE complete HTML file in a single \`\`\`html\`\`\` fenced code block. No prose,
no explanations, no commentary outside the code block. Just the HTML.`;

// ---------------------------------------------------------------------------
// Call Claude
// ---------------------------------------------------------------------------

async function main() {
const client = new Anthropic({ apiKey });

console.log("\n--- Calling claude-sonnet-4-6 ---");
const t0 = Date.now();

const response = await client.messages.create({
  model: "claude-sonnet-4-6", // Sonnet 4.6 (latest stable; 4.6 is alias)
  max_tokens: 6000,
  system: systemPrompt,
  messages: [{ role: "user", content: userPrompt }],
});

const latencyMs = Date.now() - t0;

const textBlock = response.content.find((b) => b.type === "text") as
  | { type: "text"; text: string }
  | undefined;
if (!textBlock) {
  console.error("No text block in response:", response);
  process.exit(2);
}

console.log(`Latency:         ${latencyMs} ms`);
console.log(`Stop reason:     ${response.stop_reason}`);
console.log(`Input tokens:    ${response.usage.input_tokens}`);
console.log(`Output tokens:   ${response.usage.output_tokens}`);
// Sonnet 4.5 pricing: $3/MTok input, $15/MTok output
const cost =
  (response.usage.input_tokens / 1_000_000) * 3 +
  (response.usage.output_tokens / 1_000_000) * 15;
console.log(`Cost:            $${cost.toFixed(4)}`);

// ---------------------------------------------------------------------------
// Parse HTML out
// ---------------------------------------------------------------------------

const html = (() => {
  const m = textBlock.text.match(/```html\s*\n([\s\S]*?)\n```/);
  if (m) return m[1].trim();
  // Fallback: maybe the model returned raw HTML without fences.
  if (textBlock.text.trim().startsWith("<")) return textBlock.text.trim();
  console.error("Could not extract HTML from response. First 500 chars:");
  console.error(textBlock.text.slice(0, 500));
  process.exit(3);
})();

const sceneOutPath = resolve(__dirname, "project-shell/compositions/scene-beat-1.html");
writeFileSync(sceneOutPath, html, "utf-8");
console.log(`\nWrote: ${sceneOutPath} (${html.length} chars)`);

// ---------------------------------------------------------------------------
// Wire it into root index.html
// ---------------------------------------------------------------------------

const rootPath = resolve(__dirname, "project-shell/index.html");
let rootHtml = readFileSync(rootPath, "utf-8");
const clipRef = `<div class="clip" data-composition-id="scene-beat-1" data-composition-src="compositions/scene-beat-1.html" data-start="0" data-duration="3" data-track-index="0"></div>`;
if (!rootHtml.includes("scene-beat-1")) {
  rootHtml = rootHtml.replace(
    "<!-- Scenes added via `vibe scene add` are inserted here. -->",
    `<!-- Scenes added via \`vibe scene add\` are inserted here. -->\n      ${clipRef}`,
  );
  writeFileSync(rootPath, rootHtml, "utf-8");
  console.log(`Updated root index.html with scene-beat-1 reference`);
}

// ---------------------------------------------------------------------------
// Lint
// ---------------------------------------------------------------------------

console.log("\n--- Running vibe scene lint --json ---");
const cli = resolve(ROOT, "packages/cli/dist/index.js");
let lintReport: any;
try {
  const out = execSync(`node "${cli}" scene lint --project "${resolve(__dirname, "project-shell")}" --json`, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  lintReport = JSON.parse(out);
} catch (err: any) {
  // lint exits non-zero on errors but still emits JSON to stdout
  if (err.stdout) {
    try { lintReport = JSON.parse(err.stdout); } catch { /* fallthrough */ }
  }
  if (!lintReport) {
    console.error("Lint failed to emit JSON. stderr:", err.stderr?.slice(0, 500));
    process.exit(4);
  }
}

console.log(`OK:              ${lintReport.ok}`);
console.log(`Errors:          ${lintReport.errorCount ?? "?"}`);
console.log(`Warnings:        ${lintReport.warningCount ?? "?"}`);

if ((lintReport.errorCount ?? 0) > 0) {
  console.log("\n--- Lint findings ---");
  for (const file of lintReport.files ?? []) {
    if (!file.findings || file.findings.length === 0) continue;
    console.log(`\n${file.file}:`);
    for (const f of file.findings) {
      if (f.severity !== "error") continue;
      console.log(`  ${f.severity.toUpperCase()} [${f.code}] ${f.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Save run summary
// ---------------------------------------------------------------------------

const summary = {
  pass: 1,
  ts: new Date().toISOString(),
  model: "claude-sonnet-4-6",
  latencyMs,
  inputTokens: response.usage.input_tokens,
  outputTokens: response.usage.output_tokens,
  costUsd: Number(cost.toFixed(4)),
  htmlChars: html.length,
  lint: {
    ok: lintReport.ok ?? false,
    errorCount: lintReport.errorCount ?? -1,
    warningCount: lintReport.warningCount ?? -1,
  },
};

const summaryPath = resolve(__dirname, "tmp/pass-1-summary.json");
writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n");
console.log(`\nSaved: ${summaryPath}`);

if (lintReport.ok) {
  console.log("\nPASS — lint clean. v0.59 hypothesis intact for this beat.");
} else {
  console.log("\nFAIL — lint has errors. See findings above.");
  process.exit(5);
}
}

main().catch((err) => { console.error(err); process.exit(99); });
