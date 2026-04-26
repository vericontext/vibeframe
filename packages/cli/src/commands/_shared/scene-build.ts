/**
 * @module _shared/scene-build
 *
 * v0.60 one-shot driver: read STORYBOARD.md (with frontmatter + per-beat
 * cues from C2), dispatch the AI primitives the cues call for, run
 * `compose-scenes-with-skills`, then optionally render to MP4.
 *
 * The intent is to make the storyboard the single source of truth — `vibe
 * scene build` walks it and produces an MP4. Per-beat cues drive TTS +
 * image generation; project frontmatter sets defaults. CLI flags override.
 *
 * Idempotent: assets that already exist on disk are reused unless `force`.
 *
 * Scope held tight for v0.60:
 *   - TTS via `resolveTtsProvider` (ElevenLabs / Kokoro auto-fallback)
 *   - T2I via OpenAI gpt-image-2 only (Gemini/Grok routing in a follow-up)
 *   - No Whisper transcribe step (compose handles its own)
 *   - No root `index.html` synthesis — driver expects the project to
 *     already have one with sub-composition references.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { OpenAIImageProvider, type ImageOptions } from "@vibeframe/ai-providers";

import {
  executeComposeScenesWithSkills,
  type ComposeEffort,
  type ComposeProgressEvent,
  type ComposeScenesActionResult,
} from "./compose-scenes-skills.js";
import { executeSceneRender, type SceneRenderResult } from "./scene-render.js";
import { parseStoryboard, type Beat } from "./storyboard-parse.js";
import {
  resolveTtsProvider,
  TtsKeyMissingError,
  type TtsProviderName,
} from "./tts-resolve.js";

// ── Public types ─────────────────────────────────────────────────────────

export type SceneBuildProgressEvent =
  | { type: "phase-start"; phase: "primitives" | "compose" | "render" }
  | { type: "narration-cached"; beatId: string; path: string }
  | { type: "narration-generated"; beatId: string; path: string; provider: string }
  | { type: "narration-failed"; beatId: string; error: string }
  | { type: "narration-skipped"; beatId: string; reason: string }
  | { type: "backdrop-cached"; beatId: string; path: string }
  | { type: "backdrop-generated"; beatId: string; path: string; provider: string }
  | { type: "backdrop-failed"; beatId: string; error: string }
  | { type: "backdrop-skipped"; beatId: string; reason: string }
  | ComposeProgressEvent
  | { type: "render-start" }
  | { type: "render-done"; outputPath: string };

export type PrimitiveStatus =
  | "generated"
  | "cached"
  | "skipped"
  | "failed"
  | "no-cue";

export interface BeatBuildOutcome {
  beatId: string;
  narrationStatus: PrimitiveStatus;
  narrationPath?: string;
  narrationError?: string;
  backdropStatus: PrimitiveStatus;
  backdropPath?: string;
  backdropError?: string;
}

export interface SceneBuildOptions {
  /** Project directory containing STORYBOARD.md, DESIGN.md, index.html. */
  projectDir: string;
  /** Compose effort tier — passed through to `compose-scenes-with-skills`. */
  effort?: ComposeEffort;
  skipNarration?: boolean;
  skipBackdrop?: boolean;
  skipRender?: boolean;
  /** Override frontmatter providers.tts. Defaults to "auto". */
  ttsProvider?: TtsProviderName;
  /** Voice override (TTS-provider-specific id). */
  voice?: string;
  /** Override frontmatter providers.image. Currently only "openai" supported. */
  imageProvider?: "openai";
  /** OpenAI image quality — see `vibe generate image --quality`. */
  imageQuality?: "standard" | "hd";
  /** OpenAI image size. Default 1536x1024 for cinematic 16:9-ish framing. */
  imageSize?: ImageOptions["size"];
  /** Force re-dispatch even when the asset already exists. */
  force?: boolean;
  /** Compose-scenes cache override (tests). */
  cacheDir?: string;
  /** Progress callback. */
  onProgress?: (e: SceneBuildProgressEvent) => void;
}

export interface SceneBuildResult {
  success: boolean;
  error?: string;
  beats: BeatBuildOutcome[];
  /** MP4 path when `skipRender` is false and render succeeded. */
  outputPath?: string;
  composeData?: ComposeScenesActionResult["data"];
  renderResult?: SceneRenderResult;
  /** Wall-clock total. */
  totalLatencyMs: number;
}

// ── Driver ───────────────────────────────────────────────────────────────

export async function executeSceneBuild(opts: SceneBuildOptions): Promise<SceneBuildResult> {
  const startedAt = Date.now();
  const projectDir = resolve(opts.projectDir);
  const onProgress = opts.onProgress ?? (() => {});

  const storyboardPath = join(projectDir, "STORYBOARD.md");
  if (!existsSync(storyboardPath)) {
    return failBeforePrimitives(`STORYBOARD.md not found at ${storyboardPath}`, startedAt);
  }
  const storyboardMd = await readFile(storyboardPath, "utf-8");
  const parsed = parseStoryboard(storyboardMd);
  if (parsed.beats.length === 0) {
    return failBeforePrimitives(
      `STORYBOARD.md at ${storyboardPath} has no \`## Beat …\` headings.`,
      startedAt,
    );
  }

  // Resolve providers — CLI flags > frontmatter > defaults.
  const ttsProvider = opts.ttsProvider
    ?? (parsed.frontmatter?.providers?.tts as TtsProviderName | undefined)
    ?? "auto";
  const imageProvider = (opts.imageProvider
    ?? parsed.frontmatter?.providers?.image
    ?? "openai") as "openai";
  const voice = opts.voice ?? parsed.frontmatter?.voice;

  // ── Phase 1: per-beat primitive fanout ────────────────────────────────
  onProgress({ type: "phase-start", phase: "primitives" });
  const beatOutcomes = await Promise.all(
    parsed.beats.map((beat) => buildBeatPrimitives(beat, {
      projectDir,
      ttsProvider,
      voice,
      imageProvider,
      imageQuality: opts.imageQuality ?? "hd",
      imageSize: opts.imageSize ?? "1536x1024",
      skipNarration: opts.skipNarration ?? false,
      skipBackdrop: opts.skipBackdrop ?? false,
      force: opts.force ?? false,
      onProgress,
    })),
  );

  // ── Phase 2: compose ──────────────────────────────────────────────────
  onProgress({ type: "phase-start", phase: "compose" });
  const composeResult = await executeComposeScenesWithSkills(
    {
      project: ".",
      effort: opts.effort,
      cacheDir: opts.cacheDir,
      onProgress: (e) => onProgress(e),
    },
    projectDir,
  );
  if (!composeResult.success) {
    return {
      success: false,
      error: `compose failed: ${composeResult.error ?? "unknown"}`,
      beats: beatOutcomes,
      composeData: composeResult.data,
      totalLatencyMs: Date.now() - startedAt,
    };
  }

  // ── Phase 3: render (optional) ────────────────────────────────────────
  let outputPath: string | undefined;
  let renderResult: SceneRenderResult | undefined;
  if (!opts.skipRender) {
    onProgress({ type: "phase-start", phase: "render" });
    onProgress({ type: "render-start" });
    renderResult = await executeSceneRender({ projectDir });
    if (!renderResult.success) {
      return {
        success: false,
        error: `render failed: ${renderResult.error ?? "unknown"}`,
        beats: beatOutcomes,
        composeData: composeResult.data,
        renderResult,
        totalLatencyMs: Date.now() - startedAt,
      };
    }
    outputPath = renderResult.outputPath;
    if (outputPath) onProgress({ type: "render-done", outputPath });
  }

  return {
    success: true,
    beats: beatOutcomes,
    outputPath,
    composeData: composeResult.data,
    renderResult,
    totalLatencyMs: Date.now() - startedAt,
  };
}

// ── Per-beat primitive dispatch ──────────────────────────────────────────

interface BeatDispatchContext {
  projectDir: string;
  ttsProvider: TtsProviderName;
  voice?: string;
  imageProvider: "openai";
  imageQuality: "standard" | "hd";
  imageSize: ImageOptions["size"];
  skipNarration: boolean;
  skipBackdrop: boolean;
  force: boolean;
  onProgress: (e: SceneBuildProgressEvent) => void;
}

async function buildBeatPrimitives(beat: Beat, ctx: BeatDispatchContext): Promise<BeatBuildOutcome> {
  const [narration, backdrop] = await Promise.all([
    ctx.skipNarration
      ? skipped("narration", beat.id, "--skip-narration", ctx)
      : dispatchNarration(beat, ctx),
    ctx.skipBackdrop
      ? skipped("backdrop", beat.id, "--skip-backdrop", ctx)
      : dispatchBackdrop(beat, ctx),
  ]);
  return {
    beatId: beat.id,
    narrationStatus: narration.status,
    narrationPath: narration.path,
    narrationError: narration.error,
    backdropStatus: backdrop.status,
    backdropPath: backdrop.path,
    backdropError: backdrop.error,
  };
}

interface PrimitiveOutcome {
  status: PrimitiveStatus;
  path?: string;
  error?: string;
}

async function dispatchNarration(beat: Beat, ctx: BeatDispatchContext): Promise<PrimitiveOutcome> {
  const text = beat.cues?.narration;
  if (!text) return { status: "no-cue" };

  // Idempotent check: any existing narration audio for this beat (mp3 or wav).
  for (const ext of ["mp3", "wav"] as const) {
    const rel = `assets/narration-${beat.id}.${ext}`;
    if (existsSync(join(ctx.projectDir, rel)) && !ctx.force) {
      ctx.onProgress({ type: "narration-cached", beatId: beat.id, path: rel });
      return { status: "cached", path: rel };
    }
  }

  let resolution;
  try {
    resolution = await resolveTtsProvider(ctx.ttsProvider);
  } catch (err) {
    const error = err instanceof TtsKeyMissingError ? err.message : (err as Error).message;
    ctx.onProgress({ type: "narration-failed", beatId: beat.id, error });
    return { status: "failed", error };
  }

  const result = await resolution.call(text, { voice: ctx.voice });
  if (!result.success || !result.audioBuffer) {
    const error = result.error ?? "unknown TTS failure";
    ctx.onProgress({ type: "narration-failed", beatId: beat.id, error });
    return { status: "failed", error };
  }

  const rel = `assets/narration-${beat.id}.${resolution.audioExtension}`;
  const abs = join(ctx.projectDir, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, result.audioBuffer);
  ctx.onProgress({
    type: "narration-generated",
    beatId: beat.id,
    path: rel,
    provider: resolution.provider,
  });
  return { status: "generated", path: rel };
}

async function dispatchBackdrop(beat: Beat, ctx: BeatDispatchContext): Promise<PrimitiveOutcome> {
  const prompt = beat.cues?.backdrop;
  if (!prompt) return { status: "no-cue" };

  if (ctx.imageProvider !== "openai") {
    const error = `image provider "${ctx.imageProvider}" not yet supported (use openai)`;
    ctx.onProgress({ type: "backdrop-failed", beatId: beat.id, error });
    return { status: "failed", error };
  }

  const rel = `assets/backdrop-${beat.id}.png`;
  const abs = join(ctx.projectDir, rel);
  if (existsSync(abs) && !ctx.force) {
    ctx.onProgress({ type: "backdrop-cached", beatId: beat.id, path: rel });
    return { status: "cached", path: rel };
  }

  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) {
    const error = "OPENAI_API_KEY not set — cannot dispatch backdrop";
    ctx.onProgress({ type: "backdrop-failed", beatId: beat.id, error });
    return { status: "failed", error };
  }

  const provider = new OpenAIImageProvider();
  await provider.initialize({ apiKey });
  const result = await provider.generateImage(prompt, {
    model: "gpt-image-2",
    size: ctx.imageSize,
    quality: ctx.imageQuality,
  });
  if (!result.success || !result.images?.[0]?.base64) {
    const error = result.error ?? "no image data returned";
    ctx.onProgress({ type: "backdrop-failed", beatId: beat.id, error });
    return { status: "failed", error };
  }

  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, Buffer.from(result.images[0].base64, "base64"));
  ctx.onProgress({
    type: "backdrop-generated",
    beatId: beat.id,
    path: rel,
    provider: "openai",
  });
  return { status: "generated", path: rel };
}

async function skipped(
  kind: "narration" | "backdrop",
  beatId: string,
  reason: string,
  ctx: BeatDispatchContext,
): Promise<PrimitiveOutcome> {
  ctx.onProgress({ type: `${kind}-skipped` as const, beatId, reason });
  return { status: "skipped" };
}

function failBeforePrimitives(error: string, startedAt: number): SceneBuildResult {
  return {
    success: false,
    error,
    beats: [],
    totalLatencyMs: Date.now() - startedAt,
  };
}
