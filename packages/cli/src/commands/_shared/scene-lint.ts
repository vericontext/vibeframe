/**
 * @module _shared/scene-lint
 *
 * In-process Hyperframes lint pipeline for VibeFrame scene projects. Wraps
 * `runHyperframeLint` from `@hyperframes/producer` (its public lint entry
 * point) and adapts the output to VibeFrame's two-tier file structure:
 *
 *   project/
 *     index.html              # root composition  → linted as-is
 *     compositions/*.html     # sub-compositions  → producer's lint emits two
 *                                                   spurious findings here, so
 *                                                   we filter them out.
 *
 * Two findings are filtered for sub-compositions because they encode the
 * inverse rule (sub-comps SHOULD be wrapped in `<template>` and SHOULD NOT
 * have an `<html>` wrapper):
 *   - `standalone_composition_wrapped_in_template`
 *   - `root_composition_missing_html_wrapper`
 *
 * Pure helpers are exported for unit testing; `runProjectLint` does the
 * filesystem walk + lint orchestration. Mechanical `--fix` is intentionally
 * conservative — only `timed_element_missing_clip_class` is auto-fixed in
 * MVP 1.
 */

import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import {
  runHyperframeLint,
  type PreparedHyperframeLintInput,
} from "@hyperframes/producer";

// ── Re-exported shape of producer's HyperframeLintResult ───────────────────
//
// We re-declare here (vs importing from `@hyperframes/core`) so VibeFrame
// only depends on the producer's public surface.

export type LintSeverity = "error" | "warning" | "info";

export interface LintFinding {
  code: string;
  severity: LintSeverity;
  message: string;
  file?: string;
  selector?: string;
  elementId?: string;
  fixHint?: string;
  snippet?: string;
}

export interface FileLintResult {
  /** Path relative to the project directory. */
  file: string;
  /** True for files under `compositions/` — used to filter false positives. */
  isSubComposition: boolean;
  findings: LintFinding[];
}

export interface FileFixResult {
  file: string;
  /** Codes that were mechanically fixed. */
  codes: string[];
}

export interface ProjectLintResult {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  files: FileLintResult[];
  fixed: FileFixResult[];
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Producer's two findings that are inverse-rules for sub-compositions. */
export const SUB_COMP_FALSE_POSITIVES: ReadonlySet<string> = new Set([
  "standalone_composition_wrapped_in_template",
  "root_composition_missing_html_wrapper",
]);

/**
 * Discover scene files in a project. Returns the root composition (or null
 * if missing) plus every `*.html` file under `compositions/` recursively.
 *
 * Paths returned are absolute. The caller derives project-relative paths via
 * `relative(projectDir, path)`.
 */
export async function discoverSceneFiles(opts: {
  projectDir: string;
  rootRel?: string;
}): Promise<{ root: string | null; subs: string[] }> {
  const projectDir = resolve(opts.projectDir);
  const rootAbs = resolve(projectDir, opts.rootRel ?? "index.html");
  const root = existsSync(rootAbs) ? rootAbs : null;

  const compsDir = resolve(projectDir, "compositions");
  const subs: string[] = [];
  if (existsSync(compsDir)) {
    await collectHtmlRecursive(compsDir, subs);
    subs.sort();
  }

  return { root, subs };
}

async function collectHtmlRecursive(dir: string, into: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectHtmlRecursive(full, into);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
      into.push(full);
    }
  }
}

/**
 * IEEE float noise threshold for clip-overlap findings. Authored timeline
 * values are exact to 2dp, but the producer computes each clip's end as
 * `start + duration` in binary floats — e.g. 8.26 + 10.98 =
 * 19.240000000000002, which it then flags as "overlapping" a clip starting
 * at 19.24. Anything under 5ms is float noise, not a real overlap.
 */
export const OVERLAP_EPSILON_SEC = 0.005;

/** True for overlapping_clips_same_track findings whose overlap is float noise. */
export function isEpsilonOverlapFinding(finding: LintFinding): boolean {
  if (finding.code !== "overlapping_clips_same_track") return false;
  const match = finding.message.match(
    /clip ending at ([\d.eE+-]+)s overlaps with clip starting at ([\d.eE+-]+)s/
  );
  if (!match) return false;
  const end = Number(match[1]);
  const start = Number(match[2]);
  return Number.isFinite(end) && Number.isFinite(start) && end - start < OVERLAP_EPSILON_SEC;
}

/**
 * Drop known false positives: float-epsilon clip overlaps (all files) and
 * the producer findings that are inverse-rules for sub-comp files. Other
 * findings pass through unchanged.
 */
export function filterSubCompFalsePositives(
  findings: LintFinding[],
  isSubComposition: boolean,
): LintFinding[] {
  const noEpsilon = findings.filter((f) => !isEpsilonOverlapFinding(f));
  if (!isSubComposition) return noEpsilon;
  return noEpsilon.filter((f) => !SUB_COMP_FALSE_POSITIVES.has(f.code));
}

/**
 * VibeFrame-side finding: inner phase clips inside a sub-composition.
 *
 * The producer's screenshot render mode does NOT toggle the visibility of
 * `.clip` elements INSIDE a sub-composition by their `data-start` window —
 * a scene split into clip phases (0-10s, 10-26s) renders BOTH phases
 * simultaneously and text stacks on top of itself. Root index.html clips
 * are unaffected (their windows work); this rule only applies to
 * sub-composition internals. Phase changes must instead be driven by GSAP
 * (animate the old phase out with autoAlpha, the new one in) inside
 * full-window clips.
 */
export function findInternalPhaseClipFindings(html: string): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const tagMatch of html.matchAll(/<[a-z][a-z0-9-]*\s[^>]*>/gi)) {
    const tag = tagMatch[0];
    if (!/class="[^"]*\bclip\b[^"]*"/i.test(tag)) continue;
    const startAttr = tag.match(/data-start="([^"]+)"/i);
    if (!startAttr) continue;
    const start = Number(startAttr[1]);
    if (!Number.isFinite(start) || start === 0) continue;
    findings.push({
      code: "internal_phase_clip_unsupported",
      severity: "error",
      message:
        `Inner .clip has data-start="${startAttr[1]}". The renderer does not toggle ` +
        `internal clip visibility inside sub-compositions, so phased clips render ` +
        `ALL phases at once (overlapping text).`,
      fixHint:
        'Give every inner .clip data-start="0" spanning the full beat, and drive phase ' +
        "changes with GSAP autoAlpha instead (animate the previous phase out, the next one in).",
      snippet: tag.slice(0, 120),
    });
  }
  return findings;
}

/**
 * Append VibeFrame-side findings for sub-composition HTML. Call at every
 * lint site (batch composer, scene_submit, scene repair, project lint) so
 * all authoring paths share the exact same contract.
 */
export function withVibeframeSubCompFindings(
  findings: LintFinding[],
  html: string,
  isSubComposition: boolean,
): LintFinding[] {
  if (!isSubComposition) return findings;
  return [...findings, ...findInternalPhaseClipFindings(html)];
}

/**
 * Apply mechanical `--fix` rewrites for known-safe finding codes. Returns the
 * (possibly unchanged) HTML and the list of codes that were fixed at least
 * once.
 *
 * MVP 1 only auto-fixes `timed_element_missing_clip_class` — adding the
 * `clip` class to elements that already carry timing attributes.
 *
 * Other "registration"/"paused" fixes are intentionally NOT mechanical —
 * they require structural reasoning (where to insert the `window.__timelines`
 * block, how to convert an unpaused timeline) that goes beyond a regex.
 * The lint output still surfaces them with `fixHint` for the agent or human
 * to apply.
 */
export function applyMechanicalFixes(
  html: string,
  findings: LintFinding[],
): { html: string; fixedCodes: string[] } {
  const fixedCodes = new Set<string>();
  let updated = html;

  if (findings.some((f) => f.code === "timed_element_missing_clip_class")) {
    const next = addClipClassToTimedElements(updated);
    if (next !== updated) {
      updated = next;
      fixedCodes.add("timed_element_missing_clip_class");
    }
  }

  return { html: updated, fixedCodes: [...fixedCodes] };
}

/**
 * Add `class="clip"` (or merge into an existing `class="..."`) on every
 * element that has both `data-start` and `data-duration` but no `clip` class.
 *
 * Skips `<audio>` and `<video>` elements — those have timing attributes but
 * use their own track-management semantics, and the lint rule already exempts
 * them.
 */
function addClipClassToTimedElements(html: string): string {
  return html.replace(/<([a-z][a-z0-9-]*)([^>]*)>/gi, (full, tag: string, attrs: string) => {
    const lower = tag.toLowerCase();
    if (lower === "audio" || lower === "video") return full;
    if (!/\sdata-start="/.test(attrs)) return full;
    if (!/\sdata-duration="/.test(attrs)) return full;
    const classMatch = attrs.match(/\sclass="([^"]*)"/);
    if (classMatch) {
      const classes = classMatch[1].split(/\s+/).filter(Boolean);
      if (classes.includes("clip")) return full;
      const merged = [...classes, "clip"].join(" ");
      return `<${tag}${attrs.replace(/\sclass="[^"]*"/, ` class="${merged}"`)}>`;
    }
    return `<${tag} class="clip"${attrs}>`;
  });
}

// ---------------------------------------------------------------------------
// File-system orchestration
// ---------------------------------------------------------------------------

export interface RunProjectLintOptions {
  projectDir: string;
  rootRel?: string;
  /** Apply mechanical fixes and write files back. */
  fix?: boolean;
}

/**
 * Walk the project, lint every HTML file, optionally apply mechanical fixes,
 * and return aggregated counts. Throws only on FS errors; lint errors are
 * surfaced as findings, not exceptions.
 */
export async function runProjectLint(opts: RunProjectLintOptions): Promise<ProjectLintResult> {
  const projectDir = resolve(opts.projectDir);
  const { root, subs } = await discoverSceneFiles({ projectDir, rootRel: opts.rootRel });

  const files: FileLintResult[] = [];
  const fixed: FileFixResult[] = [];

  const targets: Array<{ abs: string; isSub: boolean }> = [];
  if (root) targets.push({ abs: root, isSub: false });
  for (const sub of subs) targets.push({ abs: sub, isSub: true });

  for (const { abs, isSub } of targets) {
    const rel = relative(projectDir, abs) || abs;
    const html = await readFile(abs, "utf-8");

    const prepared: PreparedHyperframeLintInput = {
      html,
      entryFile: rel,
      source: "projectDir",
    };
    const raw = runHyperframeLint(prepared);
    const findings = withVibeframeSubCompFindings(
      filterSubCompFalsePositives(raw.findings as LintFinding[], isSub),
      html,
      isSub
    );

    if (opts.fix && findings.length > 0) {
      const { html: nextHtml, fixedCodes } = applyMechanicalFixes(html, findings);
      if (fixedCodes.length > 0) {
        await writeFile(abs, nextHtml, "utf-8");
        fixed.push({ file: rel, codes: fixedCodes });
        // Re-lint after fix so the result reflects what's left.
        const reLinted = runHyperframeLint({ ...prepared, html: nextHtml });
        files.push({
          file: rel,
          isSubComposition: isSub,
          findings: withVibeframeSubCompFindings(
            filterSubCompFalsePositives(reLinted.findings as LintFinding[], isSub),
            nextHtml,
            isSub
          ),
        });
        continue;
      }
    }

    files.push({ file: rel, isSubComposition: isSub, findings });
  }

  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  for (const f of files) {
    for (const finding of f.findings) {
      if (finding.severity === "error") errorCount++;
      else if (finding.severity === "warning") warningCount++;
      else infoCount++;
    }
  }

  return {
    ok: errorCount === 0,
    errorCount,
    warningCount,
    infoCount,
    files,
    fixed,
  };
}

/** True if `root` exists and is a regular file. Used by callers that want to
 *  pre-validate before invoking `runProjectLint`. */
export async function rootExists(projectDir: string, rootRel = "index.html"): Promise<boolean> {
  const abs = resolve(projectDir, rootRel);
  try {
    const s = await stat(abs);
    return s.isFile();
  } catch {
    return false;
  }
}
