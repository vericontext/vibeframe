/**
 * @module _shared/scene-submit
 *
 * Host-authored scene submission — the missing half of agent-mode compose
 * for hosts that cannot write files (Claude Desktop and other MCP-only
 * surfaces). `build --mode agent` already returns a `needs-author` plan with
 * per-beat compose prompts; this executor accepts the HTML the host agent
 * authored, validates it with the SAME lint the batch composer uses, and
 * writes `compositions/scene-<id>.html` on pass. On lint errors nothing is
 * written and the findings are returned so the agent can fix and resubmit.
 *
 * Shared by the `vibe scene submit` CLI command and the `scene_submit`
 * MCP/agent tool.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { extractHtml, lintBeatHtml } from "./compose-scenes-skills.js";
import { applyMechanicalFixes, type LintFinding } from "./scene-lint.js";
import { parseStoryboard } from "./storyboard-parse.js";
import { resolveSyncedBeatDuration, loadProjectRootSyncBeats } from "./root-sync.js";

export interface SceneSubmitOptions {
  projectDir: string;
  beatId: string;
  /** Scene HTML — a bare `<template>` fragment, optionally ```html-fenced. */
  html: string;
  /** Lint only; never write. */
  validateOnly?: boolean;
}

export interface SceneSubmitResult {
  success: boolean;
  beatId: string;
  /** Project-relative path of the scene file. */
  scenePath: string;
  written: boolean;
  /** Lint codes auto-repaired before validation. */
  mechanicalFixes: string[];
  lint: { errorCount: number; warningCount: number; findings: LintFinding[] };
  warnings: string[];
  retryWith: string[];
  error?: string;
}

export async function executeSceneSubmit(opts: SceneSubmitOptions): Promise<SceneSubmitResult> {
  const projectDir = resolve(opts.projectDir);
  const beatId = opts.beatId.trim();
  const scenePath = `compositions/scene-${beatId}.html`;
  const base = {
    beatId,
    scenePath,
    written: false,
    mechanicalFixes: [] as string[],
    lint: { errorCount: 0, warningCount: 0, findings: [] as LintFinding[] },
    warnings: [] as string[],
    retryWith: [] as string[],
  };

  const storyboardPath = join(projectDir, "STORYBOARD.md");
  if (!existsSync(storyboardPath)) {
    return {
      ...base,
      success: false,
      error: `STORYBOARD.md not found at ${storyboardPath}. Run \`vibe init <dir>\` first.`,
    };
  }
  const parsed = parseStoryboard(await readFile(storyboardPath, "utf-8"));
  const beat = parsed.beats.find((b) => b.id === beatId);
  if (!beat) {
    const available = parsed.beats.map((b) => b.id).join(", ") || "(none)";
    return {
      ...base,
      success: false,
      error: `Beat "${beatId}" not found in STORYBOARD.md. Available beats: ${available}`,
    };
  }

  // Agents commonly return the fragment inside a ```html fence — accept both.
  let html: string;
  try {
    html = extractHtml(opts.html).trim();
  } catch {
    return {
      ...base,
      success: false,
      error:
        "Submitted content does not look like HTML. Send the bare <template> fragment " +
        "(optionally inside a ```html fence) with no surrounding prose.",
    };
  }
  if (!html) {
    return { ...base, success: false, error: "Submitted HTML is empty." };
  }
  if (!/^<template[\s>]/.test(html)) {
    base.warnings.push(
      "Submitted HTML does not start with a <template> root. Hyperframes sub-compositions " +
        "must be bare <template id=\"scene-<id>-template\"> fragments — full documents break parsing."
    );
  }

  const fixed = applyMechanicalFixes(html, lintBeatHtml(html, beatId).findings);
  html = fixed.html;
  base.mechanicalFixes = fixed.fixedCodes;

  const lint = lintBeatHtml(html, beatId);
  base.lint = lint;
  if (lint.errorCount > 0) {
    return {
      ...base,
      success: false,
      error:
        `Lint failed with ${lint.errorCount} error(s) — nothing was written. ` +
        `Fix the findings and resubmit.`,
      retryWith: [`scene_submit { beat: "${beatId}", html: <fixed HTML> }`],
    };
  }
  if (lint.warningCount > 0) {
    base.warnings.push(
      `${lint.warningCount} lint warning(s) — written anyway; see lint.findings.`
    );
  }

  // Black-tail guard: warn when the scene's data-duration disagrees with the
  // narration-synced beat duration. The sync-stage repair also catches this,
  // but surfacing it here lets the agent fix it at the source.
  try {
    const syncBeat = (await loadProjectRootSyncBeats(projectDir)).find((b) => b.id === beatId);
    if (syncBeat) {
      const expected = await resolveSyncedBeatDuration({
        projectDir,
        beatDuration: syncBeat.duration,
        narrationPath: syncBeat.narrationPath,
        sceneDurationSec: syncBeat.sceneDurationSec,
      });
      const declared = html.match(
        new RegExp(`data-composition-id="scene-${beatId}"[^>]*data-duration="([\\d.]+)"`)
      );
      const declaredSec = declared ? Number(declared[1]) : undefined;
      if (declaredSec !== undefined && Math.abs(declaredSec - expected) > 0.01) {
        base.warnings.push(
          `Scene data-duration is ${declaredSec}s but the narration-synced beat duration is ` +
            `${expected}s — the scene may end early (black tail) or run long. Prefer ` +
            `data-duration="${expected}" and anchor the timeline to it. ` +
            `(build stage sync will repair this deterministically.)`
        );
      }
    }
  } catch {
    // Duration advice is best-effort; never block a valid submission on it.
  }

  if (opts.validateOnly) {
    return { ...base, success: true };
  }

  const absPath = join(projectDir, scenePath);
  await mkdir(join(projectDir, "compositions"), { recursive: true });
  await writeFile(absPath, html.endsWith("\n") ? html : `${html}\n`, "utf-8");
  return {
    ...base,
    success: true,
    written: true,
    retryWith: [
      `vibe build ${projectDir} --stage sync --json`,
      `vibe render ${projectDir} --json`,
    ],
  };
}
