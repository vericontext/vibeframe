/**
 * @module _shared/segments-to-scenes
 *
 * Branch of the script-to-video pipeline that materialises a Hyperframes-style
 * scene project (HTML compositions + GSAP timelines) instead of an opaque MP4.
 * Triggered by `vibe pipeline script-to-video --format scenes`.
 *
 * **Scope (MVP 1 c5):** template-based scene HTML using the C2 emitters.
 * Claude-authored per-scene HTML with a lint-feedback retry loop is
 * intentionally deferred — the bet that matters ("expensive opaque MP4 → cheap
 * editable HTML") is delivered with templates alone, and the user can hand-
 * edit any scene afterwards via `vibe scene add --force` or by editing the
 * file directly.
 *
 * Inputs: storyboard segments, narration audio paths, image paths (any of
 * which may be missing). Outputs: a fully scaffolded scene project at
 * `outputDir`, ready for `vibe scene lint` / `vibe scene render`.
 */

import { rename, writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, basename, dirname, relative } from "node:path";
import {
  scaffoldSceneProject,
  aspectToDims,
  type SceneAspect,
} from "./scene-project.js";
import {
  emitSceneHtml,
  insertClipIntoRoot,
  type ScenePreset,
} from "./scene-html-emit.js";
import { runProjectLint, type ProjectLintResult } from "./scene-lint.js";
import type { StoryboardSegment, NarrationEntry } from "../ai-script-pipeline.js";

export interface SegmentsToScenesOptions {
  segments: StoryboardSegment[];
  /** Index-aligned with `segments`. Missing/failed entries → no narration audio. */
  narrationEntries?: NarrationEntry[];
  /** Index-aligned with `segments`. Empty string → image generation failed. */
  imagePaths?: string[];
  /** Absolute output directory (will be scaffolded as a scene project). */
  outputDir: string;
  /** Aspect ratio (drives canvas dims for both root + sub-comps). */
  aspectRatio?: SceneAspect;
  /** Project name (defaults to dir basename). */
  projectName?: string;
  /** Style preset applied to every scene (default `explainer`). */
  scenePreset?: ScenePreset;
  /** Optional progress sink — wired to `executeScriptToVideo`'s onProgress. */
  onProgress?: (msg: string) => void;
  /** When true (default), runs lint after emit and returns the result for
   *  visibility. Lint warnings/errors do NOT cause this function to fail. */
  lintAfter?: boolean;
}

export interface SegmentsToScenesResult {
  success: boolean;
  outputDir: string;
  scenesEmitted: number;
  /** Project-relative paths of every scene HTML written. */
  scenePaths: string[];
  /** Project-relative path of the root composition. */
  rootPath: string;
  /** Lint result when `lintAfter` is set. Surfaces warnings/errors but does
   *  not change `success`. */
  lintResult?: ProjectLintResult;
  /** 1-indexed scene numbers whose narration audio was missing. */
  missingNarration: number[];
  /** 1-indexed scene numbers whose image was missing. */
  missingImage: number[];
  error?: string;
}

const DEFAULT_PRESET: ScenePreset = "explainer";

/**
 * Pad an integer with leading zeros to a fixed width. `zeroPad(3, 2)` → "03".
 * Pure helper exposed for tests so the scene-id convention is locked in.
 */
export function zeroPad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/**
 * Build the canonical scene id for the i-th storyboard segment (1-indexed).
 * Used in both `compositions/scene-NN.html` and `data-composition-id`.
 */
export function sceneIdFromIndex(oneIndexedIndex: number): string {
  return `scene-${zeroPad(oneIndexedIndex)}`;
}

/**
 * Move a generated asset into the project's `assets/` directory, returning
 * the project-relative path the scene HTML should reference. If the asset is
 * already inside `assets/`, it's left alone. Missing files become `undefined`.
 */
async function relocateAsset(opts: {
  absSource: string | undefined;
  outputDir: string;
  destBasename: string;
}): Promise<string | undefined> {
  if (!opts.absSource || !existsSync(opts.absSource)) return undefined;
  const assetsDir = resolve(opts.outputDir, "assets");
  await mkdir(assetsDir, { recursive: true });
  const dest = resolve(assetsDir, opts.destBasename);
  if (resolve(opts.absSource) !== dest) {
    if (existsSync(dest)) {
      // The destination already has the asset (idempotent re-run). Leave it.
    } else {
      await rename(opts.absSource, dest);
    }
  }
  return relative(opts.outputDir, dest);
}

/**
 * Materialise a scene project from script-to-video pipeline outputs.
 *
 * Steps:
 *   1. Scaffold the bilingual scene project (vibe.project.yaml + index.html
 *      + hyperframes.json + compositions/ + assets/ + CLAUDE.md + .gitignore).
 *   2. Move narration `.mp3` and image `.png` files from the pipeline's flat
 *      output layout into `assets/`.
 *   3. For each segment, emit `compositions/scene-NN.html` via the C2
 *      `emitSceneHtml` template (default preset: `explainer`).
 *   4. Splice each scene into the root via `insertClipIntoRoot` so root
 *      `data-duration` grows to fit and clip start times stack correctly.
 *   5. Run `runProjectLint` (info only — does not fail the call).
 */
export async function executeSegmentsToScenes(
  opts: SegmentsToScenesOptions,
): Promise<SegmentsToScenesResult> {
  const outputDir = resolve(opts.outputDir);
  const aspect: SceneAspect = opts.aspectRatio ?? "16:9";
  const dims = aspectToDims(aspect);
  const preset = opts.scenePreset ?? DEFAULT_PRESET;
  const projectName = opts.projectName ?? basename(outputDir);
  const totalDuration = opts.segments.reduce((sum, s) => sum + (s.duration || 0), 0) || 10;

  const baseError = (error: string): SegmentsToScenesResult => ({
    success: false,
    outputDir,
    scenesEmitted: 0,
    scenePaths: [],
    rootPath: resolve(outputDir, "index.html"),
    missingNarration: [],
    missingImage: [],
    error,
  });

  if (opts.segments.length === 0) {
    return baseError("No storyboard segments to convert.");
  }

  // Step 1: scaffold scene project (idempotent).
  opts.onProgress?.(`Scaffolding scene project at ${outputDir}...`);
  await scaffoldSceneProject({
    dir: outputDir,
    name: projectName,
    aspect,
    duration: totalDuration,
  });

  // Step 2-4: per-segment relocate + emit + insert.
  const scenePaths: string[] = [];
  const missingNarration: number[] = [];
  const missingImage: number[] = [];

  // Re-read the scaffolded root (we mutate sequentially via insertClipIntoRoot).
  const rootAbs = resolve(outputDir, "index.html");
  let rootHtml = await readFile(rootAbs, "utf-8");

  for (let i = 0; i < opts.segments.length; i++) {
    const segment = opts.segments[i];
    const oneIndexed = i + 1;
    const id = sceneIdFromIndex(oneIndexed);

    const narrationEntry = opts.narrationEntries?.[i];
    const imageAbsPath = opts.imagePaths?.[i];

    const audioRelPath = await relocateAsset({
      absSource: narrationEntry && !narrationEntry.failed ? (narrationEntry.path ?? undefined) : undefined,
      outputDir,
      destBasename: `narration-${zeroPad(oneIndexed)}.mp3`,
    });
    const imageRelPath = await relocateAsset({
      absSource: imageAbsPath && imageAbsPath.length > 0 ? imageAbsPath : undefined,
      outputDir,
      destBasename: `scene-${zeroPad(oneIndexed)}.png`,
    });

    if (!audioRelPath) missingNarration.push(oneIndexed);
    if (!imageRelPath) missingImage.push(oneIndexed);

    const headline = pickHeadline(segment, oneIndexed);
    const subhead = (segment.narration ?? "").trim() || segment.description.trim();
    const duration = segment.duration > 0 ? segment.duration : 5;

    const html = emitSceneHtml({
      id,
      preset,
      width: dims.width,
      height: dims.height,
      duration,
      headline,
      subhead,
      audioPath: audioRelPath,
      imagePath: imageRelPath,
    });
    const scenePath = resolve(outputDir, "compositions", `${id}.html`);
    await mkdir(dirname(scenePath), { recursive: true });
    await writeFile(scenePath, html, "utf-8");
    scenePaths.push(relative(outputDir, scenePath));

    opts.onProgress?.(`Scene ${oneIndexed}/${opts.segments.length}: emitted ${id} (preset=${preset})`);
  }

  // Step 4 (continued): build the running clip-stack into the root in order.
  let clipStart = 0;
  for (let i = 0; i < opts.segments.length; i++) {
    const segment = opts.segments[i];
    const id = sceneIdFromIndex(i + 1);
    const duration = segment.duration > 0 ? segment.duration : 5;
    // Explicit src — `id` already starts with "scene-", and the default src
    // derivation in buildClipReference would otherwise yield "scene-scene-NN".
    rootHtml = insertClipIntoRoot(rootHtml, {
      id,
      start: clipStart,
      duration,
      src: `compositions/${id}.html`,
    });
    clipStart += duration;
  }
  await writeFile(rootAbs, rootHtml, "utf-8");

  // Step 5: lint pass (advisory).
  let lintResult: ProjectLintResult | undefined;
  if (opts.lintAfter !== false) {
    opts.onProgress?.("Running scene lint...");
    try {
      lintResult = await runProjectLint({ projectDir: outputDir });
    } catch {
      // Surface lint failures as undefined — never fail the conversion itself.
    }
  }

  return {
    success: true,
    outputDir,
    scenesEmitted: opts.segments.length,
    scenePaths,
    rootPath: relative(outputDir, rootAbs) || rootAbs,
    lintResult,
    missingNarration,
    missingImage,
  };
}

/**
 * Heuristic for the visible scene headline. Storyboards rarely include an
 * explicit "title" field, so we derive one from the description's first
 * clause, falling back to a generic "Scene N" label.
 */
function pickHeadline(segment: StoryboardSegment, oneIndexed: number): string {
  const desc = (segment.description ?? "").trim();
  if (!desc) return `Scene ${oneIndexed}`;
  // First sentence (up to . ! ? or newline). Cap at 70 chars to avoid huge h1s.
  const sentence = desc.split(/[.!?\n]/).map((s) => s.trim()).find(Boolean) ?? desc;
  return sentence.length > 70 ? `${sentence.slice(0, 67)}…` : sentence;
}
