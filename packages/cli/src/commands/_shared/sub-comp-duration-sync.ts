/**
 * @module _shared/sub-comp-duration-sync
 *
 * Propagate narration-synced beat durations INTO sub-composition HTML.
 *
 * The root sync (root-sync.ts) stretches each beat's clip window in
 * index.html to `max(storyboard duration, narration + 0.5s)` — but scenes
 * composed before the narration existed still carry the storyboard duration
 * in their own markup: the composition root's `data-duration`, end-aligned
 * inner `.clip` windows, and GSAP timeline anchor constants like
 * `const DUR = 7;`. The runtime then ends the scene early and the stretched
 * tail renders BLACK.
 *
 * The compose stage now pins prompts to the final duration
 * (ComposeBeatContext.finalDurationSec), so fresh scenes are born correct.
 * This module is the REPAIR path for already-composed scenes. It is
 * deliberately surgical:
 *
 *   1. Composition root `data-duration`   — always rewritten (attribute).
 *   2. End-aligned `.clip` `data-duration` — rewritten when start+duration
 *      lands on the OLD beat end (±0.01s); other clips are untouched.
 *   3. GSAP anchor const                  — rewritten only when exactly one
 *      `const NAME = <oldDur>;` exists and NAME is referenced in a timeline
 *      call. Anything ambiguous emits a SCENE_TIMELINE_DURATION_OUT_OF_SYNC
 *      warning for the host agent instead of risking a bad code edit.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { ReviewIssue } from "./review-report.js";
import { resolveSyncedBeatDuration, type RootSyncBeatInput } from "./root-sync.js";

export const SUB_COMP_SYNC_FIX_CODES = {
  rootDuration: "scene_duration_synced",
  clipDurations: "scene_clip_durations_synced",
  timelineConst: "scene_timeline_const_synced",
} as const;

const DURATION_EPSILON = 0.01;

export interface SubCompDurationSyncOutcome {
  oldDurationSec?: number;
  newDurationSec: number;
  changed: boolean;
  nextHtml?: string;
  fixCodes: string[];
  issues: ReviewIssue[];
}

export interface SubCompDurationSyncFileResult extends SubCompDurationSyncOutcome {
  /** Project-relative path, e.g. "compositions/scene-hook.html". */
  file: string;
  beatId: string;
}

/**
 * Pure core: rewrite one sub-composition's internal durations to
 * `newDurationSec`. Returns `changed: false` when the scene already matches
 * (±0.01s) or its root duration can't be located.
 */
export function syncSubCompositionDurationHtml(
  html: string,
  beatId: string,
  newDurationSec: number,
  fileRel?: string
): SubCompDurationSyncOutcome {
  const compositionId = `scene-${beatId}`;
  const file = fileRel ?? `compositions/${compositionId}.html`;
  const rootRe = new RegExp(
    `(<[^>]*data-composition-id="${escapeRegExp(compositionId)}"[^>]*data-duration=")([\\d.]+)(")`
  );
  const rootMatch = html.match(rootRe);
  if (!rootMatch) {
    return { newDurationSec, changed: false, fixCodes: [], issues: [] };
  }
  const oldDurationSec = Number(rootMatch[2]);
  if (!Number.isFinite(oldDurationSec) || Math.abs(oldDurationSec - newDurationSec) <= DURATION_EPSILON) {
    return { oldDurationSec, newDurationSec, changed: false, fixCodes: [], issues: [] };
  }

  const fixCodes: string[] = [];
  const issues: ReviewIssue[] = [];
  let next = html.replace(rootRe, `$1${newDurationSec}$3`);
  fixCodes.push(SUB_COMP_SYNC_FIX_CODES.rootDuration);

  // 2. End-aligned inner clips: class contains "clip", start+duration ≈ old end.
  let clipsTouched = false;
  next = next.replace(
    /(<[^>]*class="[^"]*\bclip\b[^"]*"[^>]*data-start=")([\d.]+)("[^>]*data-duration=")([\d.]+)(")/g,
    (full, pre, startStr, mid, durStr, post) => {
      const start = Number(startStr);
      const dur = Number(durStr);
      if (!Number.isFinite(start) || !Number.isFinite(dur)) return full;
      if (Math.abs(start + dur - oldDurationSec) > DURATION_EPSILON) return full;
      const nextDur = Number((newDurationSec - start).toFixed(2));
      if (nextDur <= 0) return full;
      clipsTouched = true;
      return `${pre}${startStr}${mid}${nextDur}${post}`;
    }
  );
  if (clipsTouched) fixCodes.push(SUB_COMP_SYNC_FIX_CODES.clipDurations);

  // 3. Timeline anchor consts inside <script> blocks.
  const constResult = rewriteTimelineConst(next, oldDurationSec, newDurationSec);
  next = constResult.html;
  if (constResult.rewritten) {
    fixCodes.push(SUB_COMP_SYNC_FIX_CODES.timelineConst);
  } else if (constResult.needsManualFix) {
    issues.push({
      severity: "warning",
      code: "SCENE_TIMELINE_DURATION_OUT_OF_SYNC",
      message:
        `${file}: data-duration was stretched ${oldDurationSec}s → ${newDurationSec}s ` +
        `(narration-synced), but the GSAP timeline could not be re-anchored automatically.`,
      file,
      beatId,
      fixOwner: "host-agent",
      suggestedFix:
        `Edit the scene's timeline so its total length equals the new data-duration ` +
        `(${newDurationSec}s) — update the duration constant or the end anchor tween.`,
    });
  }

  return {
    oldDurationSec,
    newDurationSec,
    changed: true,
    nextHtml: next,
    fixCodes,
    issues,
  };
}

/**
 * Conservative anchor-const rewrite. Targets `const NAME = <oldDur>;` inside
 * <script> blocks where NAME is also referenced in a timeline call line.
 * Anything other than exactly one such candidate is reported, not edited.
 */
function rewriteTimelineConst(
  html: string,
  oldDurationSec: number,
  newDurationSec: number
): { html: string; rewritten: boolean; needsManualFix: boolean } {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  const scriptBody = scripts.map((m) => m[1]).join("\n");
  if (!scriptBody.trim()) return { html, rewritten: false, needsManualFix: false };

  const constRe = /const\s+([A-Za-z_$][\w$]*)\s*=\s*(\d+(?:\.\d+)?)\s*;/g;
  const candidates: string[] = [];
  for (const match of scriptBody.matchAll(constRe)) {
    const value = Number(match[2]);
    if (Math.abs(value - oldDurationSec) <= DURATION_EPSILON) {
      const name = match[1];
      const referencedInTimeline = scriptBody
        .split("\n")
        .some(
          (line) =>
            !line.includes(`const ${name}`) &&
            new RegExp(`\\b${escapeRegExp(name)}\\b`).test(line) &&
            /(\btl\.|\bgsap\.|\.fromTo\(|\.to\(|\.from\(|\.set\()/.test(line)
        );
      if (referencedInTimeline) candidates.push(name);
    }
  }

  if (candidates.length === 1) {
    const name = candidates[0];
    const target = new RegExp(
      `(const\\s+${escapeRegExp(name)}\\s*=\\s*)\\d+(?:\\.\\d+)?(\\s*;)`
    );
    return { html: html.replace(target, `$1${newDurationSec}$2`), rewritten: true, needsManualFix: false };
  }

  // No candidate const: the timeline may still anchor via literal durations
  // (e.g. a ken-burns tween `duration: 7`). Flag for manual fix when the old
  // duration appears as a literal in timeline-ish positions; otherwise assume
  // the timeline derives its length from the (already-fixed) attributes.
  const literalAnchor = new RegExp(
    `(duration:\\s*|,\\s*)${escapeRegExp(String(oldDurationSec))}\\b`
  );
  const needsManualFix = candidates.length > 1 || literalAnchor.test(scriptBody);
  return { html, rewritten: false, needsManualFix };
}

/** I/O wrapper: plan duration sync for every beat's composition file. */
export async function createSubCompDurationSyncPlans(opts: {
  projectDir: string;
  beats: RootSyncBeatInput[];
}): Promise<SubCompDurationSyncFileResult[]> {
  const projectDir = resolve(opts.projectDir);
  const results: SubCompDurationSyncFileResult[] = [];
  for (const beat of opts.beats) {
    const fileRel = `compositions/scene-${beat.id}.html`;
    const filePath = join(projectDir, fileRel);
    if (!existsSync(filePath)) continue;
    const newDurationSec = await resolveSyncedBeatDuration({
      projectDir,
      beatDuration: beat.duration,
      narrationPath: beat.narrationPath,
      sceneDurationSec: beat.sceneDurationSec,
    });
    const html = await readFile(filePath, "utf-8");
    const outcome = syncSubCompositionDurationHtml(html, beat.id, newDurationSec, fileRel);
    results.push({ ...outcome, file: fileRel, beatId: beat.id });
  }
  return results;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
