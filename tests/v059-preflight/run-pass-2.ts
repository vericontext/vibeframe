#!/usr/bin/env tsx
/**
 * Pass 2 — determinism check.
 *
 * Calls Claude with the *same* prompt N times, measures pairwise diff
 * between outputs. Tells us whether content-hash caching in v0.59 will
 * actually hit (if outputs drift wildly, the cache is useless).
 *
 * Acceptance:
 * - All N runs lint-clean (errorCount === 0)
 * - Pairwise normalised line-diff mean < 30% — workable for cache-by-hash
 *   on the prompt; ≥30% means we need a structural extraction step.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... pnpm exec tsx tests/v059-preflight/run-pass-2.ts [N=5]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const HF_SKILLS = resolve(ROOT, "../../oss/hyperframes/skills/hyperframes");
const N = Number(process.argv[2] ?? "5");

// .env loader
const envPath = resolve(ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) { console.error("ANTHROPIC_API_KEY missing"); process.exit(1); }

function loadSkillBundle(): string {
  const files = [
    `${HF_SKILLS}/SKILL.md`,
    `${HF_SKILLS}/house-style.md`,
    `${HF_SKILLS}/references/motion-principles.md`,
    `${HF_SKILLS}/references/typography.md`,
    `${HF_SKILLS}/references/transitions.md`,
  ];
  return files
    .filter(existsSync)
    .map((p) => `\n\n=== ${p.replace(HF_SKILLS + "/", "hyperframes/")} ===\n\n` + readFileSync(p, "utf-8"))
    .join("\n");
}

const skillBundle = loadSkillBundle();
const designMd = readFileSync(resolve(__dirname, "fixtures/DESIGN.md"), "utf-8");
const storyboard = readFileSync(resolve(__dirname, "fixtures/STORYBOARD.md"), "utf-8");

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
// Diff helper — normalised line-Jaccard (1 - intersect/union)
// Whitespace-collapse, ignore blank lines.
// ---------------------------------------------------------------------------
function normalize(s: string): string[] {
  return s
    .split("\n")
    .map((l) => l.trim().replace(/\s+/g, " "))
    .filter((l) => l.length > 0);
}
function lineDiff(a: string, b: string): number {
  const A = new Set(normalize(a));
  const B = new Set(normalize(b));
  const intersect = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size;
  return 1 - intersect / union;
}

async function main() {
  const client = new Anthropic({ apiKey });
  const runs: Array<{
    n: number;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    htmlChars: number;
    html: string;
    lintOk: boolean;
    lintErrors: number;
  }> = [];

  const tmpDir = resolve(__dirname, "tmp");
  mkdirSync(tmpDir, { recursive: true });

  console.log(`Running ${N} calls (same prompt) ...\n`);

  for (let i = 1; i <= N; i++) {
    process.stdout.write(`  Run ${i}/${N} ... `);
    const t0 = Date.now();
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 6000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const latencyMs = Date.now() - t0;
    const text = (response.content.find((b) => b.type === "text") as { type: "text"; text: string }).text;
    const m = text.match(/```html\s*\n([\s\S]*?)\n```/);
    const html = m ? m[1].trim() : text.trim();

    // Drop into project shell + lint
    const sceneOut = resolve(__dirname, "project-shell/compositions/scene-beat-1.html");
    writeFileSync(sceneOut, html);

    const cli = resolve(ROOT, "packages/cli/dist/index.js");
    let lintOk = false;
    let lintErrors = -1;
    try {
      const out = execSync(`node "${cli}" scene lint --project "${resolve(__dirname, "project-shell")}" --json`, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
      const r = JSON.parse(out);
      lintOk = r.ok;
      lintErrors = r.errorCount ?? -1;
    } catch (err: any) {
      try { const r = JSON.parse(err.stdout || "{}"); lintOk = r.ok ?? false; lintErrors = r.errorCount ?? -1; } catch {}
    }

    const cost = (response.usage.input_tokens / 1_000_000) * 3 + (response.usage.output_tokens / 1_000_000) * 15;
    runs.push({
      n: i,
      latencyMs,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      costUsd: Number(cost.toFixed(4)),
      htmlChars: html.length,
      html,
      lintOk,
      lintErrors,
    });

    // archive
    writeFileSync(resolve(tmpDir, `pass-2-run-${i}.html`), html);

    console.log(`${(latencyMs/1000).toFixed(1)}s  $${cost.toFixed(4)}  lint=${lintOk ? "OK" : `FAIL(${lintErrors})`}  ${html.length}c`);
  }

  // Pairwise diffs
  console.log(`\nPairwise diffs (line-Jaccard, lower = more similar):`);
  const diffs: number[] = [];
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const d = lineDiff(runs[i].html, runs[j].html);
      diffs.push(d);
      console.log(`  run ${runs[i].n} ↔ run ${runs[j].n}: ${(d * 100).toFixed(1)}%`);
    }
  }
  const meanDiff = diffs.reduce((s, x) => s + x, 0) / diffs.length;
  const maxDiff = Math.max(...diffs);

  const passed = runs.filter((r) => r.lintOk).length;
  const totalCost = runs.reduce((s, r) => s + r.costUsd, 0);
  const meanLatency = runs.reduce((s, r) => s + r.latencyMs, 0) / runs.length;
  const meanChars = runs.reduce((s, r) => s + r.htmlChars, 0) / runs.length;

  console.log(`\n=== Pass 2 summary ===`);
  console.log(`Lint pass:       ${passed}/${runs.length}  (${((passed / runs.length) * 100).toFixed(0)}%)`);
  console.log(`Mean latency:    ${(meanLatency / 1000).toFixed(1)}s`);
  console.log(`Mean HTML chars: ${meanChars.toFixed(0)}`);
  console.log(`Total cost:      $${totalCost.toFixed(4)}  (${(totalCost / runs.length).toFixed(4)}/run)`);
  console.log(`Diff mean:       ${(meanDiff * 100).toFixed(1)}%`);
  console.log(`Diff max:        ${(maxDiff * 100).toFixed(1)}%`);

  // Decision criteria
  const passRate = passed / runs.length;
  console.log();
  if (passRate < 0.5) {
    console.log("VERDICT: BREAK — lint pass rate < 50%. v0.59 architecture needs spec change.");
  } else if (passRate < 0.8) {
    console.log("VERDICT: REDUCE — lint pass rate 50-80%. Needs retry-on-lint loop or scope reduction.");
  } else {
    console.log("VERDICT: GREEN — lint pass rate ≥ 80%. v0.59 baseline architecture viable.");
  }

  if (meanDiff < 0.3) {
    console.log("CACHE: viable — outputs converge enough that content-hash cache will hit on re-runs of identical input.");
  } else {
    console.log("CACHE: needs structural extraction — raw text differs too much; cache by extracted features (palette/easings/structure) instead of raw HTML.");
  }

  writeFileSync(resolve(tmpDir, "pass-2-summary.json"), JSON.stringify({
    n: N,
    passRate,
    meanLatencyMs: meanLatency,
    meanCharsHtml: meanChars,
    totalCostUsd: Number(totalCost.toFixed(4)),
    meanDiff: Number(meanDiff.toFixed(3)),
    maxDiff: Number(maxDiff.toFixed(3)),
    runs: runs.map(({ html, ...rest }) => rest),
  }, null, 2));
}

main().catch((err) => { console.error(err); process.exit(99); });
