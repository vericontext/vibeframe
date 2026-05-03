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
 *   - T2I via OpenAI, Gemini, or Grok
 *   - No Whisper transcribe step (compose handles its own)
 *   - No root `index.html` synthesis — driver expects the project to
 *     already have one with sub-composition references.
 */

import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { config as loadDotenv } from "dotenv";
import {
  GeminiProvider,
  GrokProvider,
  OpenAIImageProvider,
  type ImageOptions,
} from "@vibeframe/ai-providers";

import { getAudioDuration } from "../../utils/audio.js";
import {
  executeComposeScenesWithSkills,
  type ComposeEffort,
  type ComposeProgressEvent,
  type ComposeScenesActionResult,
} from "./compose-scenes-skills.js";
import type { ComposerProvider } from "./composer-resolve.js";
import { getComposePrompts, type ComposePromptsBeat } from "./compose-prompts.js";
import { detectedAgentHosts } from "../../utils/agent-host-detect.js";
import { getApiKeyFromConfig } from "../../config/index.js";
import { executeSceneRender, type SceneRenderResult } from "./scene-render.js";
import { parseStoryboard, type Beat } from "./storyboard-parse.js";
import { scaffoldSceneProject } from "./scene-project.js";
import { createBuildPlan, type BuildPlanResult, type BuildStage } from "./build-plan.js";
import {
  isReadyAssetReference,
  resolveGenericAssetReference,
  resolveTypedAssetReference,
  type AssetReferenceCandidate,
} from "./build-asset-reference.js";
import { syncRootComposition, type RootSyncBeatInput } from "./root-sync.js";
import {
  backdropCacheDescriptor,
  type BuildAssetKind,
  imageRatioForSize,
  musicCacheDescriptor,
  narrationCacheDescriptor,
  normalizeMusicDuration,
  normalizeVideoDuration,
  videoCacheDescriptor,
} from "./build-cache.js";
import {
  assetMetadataPath,
  isFreshCanonicalAsset,
  readAssetMetadata,
  writeAssetMetadata,
  type AssetFreshness,
} from "./build-asset-metadata.js";
import { executeVideoGenerate } from "../ai-video.js";
import { executeMusic } from "../generate/music.js";
import { createAndWriteJobRecord, type JobRecord } from "./status-jobs.js";
import { executeSceneRepair, type SceneRepairResult } from "./scene-repair.js";
import { resolveTtsProvider, TtsKeyMissingError, type TtsProviderName } from "./tts-resolve.js";

export type BuildImageProvider = "openai" | "gemini" | "grok";

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
  | { type: "video-cached"; beatId: string; path: string }
  | { type: "video-generated"; beatId: string; path: string; provider: string }
  | { type: "video-pending"; beatId: string; jobId: string; provider: string }
  | { type: "video-failed"; beatId: string; error: string }
  | { type: "video-skipped"; beatId: string; reason: string }
  | { type: "music-cached"; beatId: string; path: string }
  | { type: "music-generated"; beatId: string; path: string; provider: string }
  | { type: "music-pending"; beatId: string; jobId: string; provider: string }
  | { type: "music-failed"; beatId: string; error: string }
  | { type: "music-skipped"; beatId: string; reason: string }
  | ComposeProgressEvent
  | { type: "render-start" }
  | { type: "render-done"; outputPath: string };

export type PrimitiveStatus =
  | "generated"
  | "cached"
  | "referenced"
  | "pending"
  | "skipped"
  | "failed"
  | "no-cue";

export interface BeatBuildOutcome {
  beatId: string;
  narrationStatus: PrimitiveStatus;
  narrationPath?: string;
  narrationError?: string;
  narrationDurationSec?: number;
  sceneDurationSec?: number;
  narrationText?: string;
  narrationVoice?: string;
  narrationProvider?: string;
  narrationCachePath?: string;
  narrationCacheKey?: string;
  narrationMetadataPath?: string;
  narrationFreshness?: AssetFreshness;
  narrationSourcePath?: string;
  backdropStatus: PrimitiveStatus;
  backdropPath?: string;
  backdropError?: string;
  backdropPrompt?: string;
  backdropProvider?: string;
  backdropCachePath?: string;
  backdropCacheKey?: string;
  backdropMetadataPath?: string;
  backdropFreshness?: AssetFreshness;
  backdropSourcePath?: string;
  videoStatus: PrimitiveStatus;
  videoPath?: string;
  videoJobId?: string;
  videoError?: string;
  videoPrompt?: string;
  videoProvider?: string;
  videoCachePath?: string;
  videoCacheKey?: string;
  videoMetadataPath?: string;
  videoFreshness?: AssetFreshness;
  videoSourcePath?: string;
  musicStatus: PrimitiveStatus;
  musicPath?: string;
  musicJobId?: string;
  musicError?: string;
  musicPrompt?: string;
  musicProvider?: string;
  musicCachePath?: string;
  musicCacheKey?: string;
  musicMetadataPath?: string;
  musicFreshness?: AssetFreshness;
  musicSourcePath?: string;
  musicDurationSec?: number;
}

export type BuildVideoProvider = "seedance" | "grok" | "kling" | "runway" | "veo";
export type BuildMusicProvider = "elevenlabs" | "replicate";

/**
 * Build mode dispatch (Phase H3 / Plan H).
 *
 * - `agent` — host agent (Claude Code, Cursor, Codex, Aider …) is the
 *   sole reasoner. The CLI runs primitives + render, but skips its own
 *   LLM compose call. If any `compositions/scene-<id>.html` is missing,
 *   `vibe scene build` returns a structured "needs author" plan from
 *   `getComposePrompts()` and exits successfully — the host agent is
 *   expected to fill the missing files and re-invoke. Otherwise lint +
 *   render proceed.
 * - `batch` — current internal-LLM path (PR #176, multi-provider). The
 *   CLI calls Claude / OpenAI / Gemini directly to produce HTML. Right
 *   choice for CI, headless automation, and "no agent host" contexts.
 * - `auto` (default) — pick `agent` when (a) `VIBE_BUILD_MODE=agent`
 *   forces it, OR (b) any agent host is detected via
 *   `detectedAgentHosts()`. Falls back to `batch`.
 */
export type SceneBuildMode = "agent" | "batch" | "auto";

export interface SceneBuildOptions {
  /** Project directory containing STORYBOARD.md, DESIGN.md, index.html. */
  projectDir: string;
  /**
   * Build mode dispatch. See {@link SceneBuildMode}. Default: `auto`.
   */
  mode?: SceneBuildMode;
  /** Compose effort tier — passed through to `compose-scenes-with-skills`. */
  effort?: ComposeEffort;
  /**
   * Composer LLM provider. Defaults to whatever `resolveComposer()` picks
   * based on env keys (claude > gemini > openai). Pass an explicit value
   * to require that provider's key.
   */
  composer?: ComposerProvider;
  skipNarration?: boolean;
  skipBackdrop?: boolean;
  skipRender?: boolean;
  /** Override frontmatter providers.tts. Defaults to "auto". */
  ttsProvider?: TtsProviderName;
  /** Voice override (TTS-provider-specific id). */
  voice?: string;
  /** Override frontmatter providers.image. */
  imageProvider?: BuildImageProvider;
  /** Video provider for per-beat `video` cues. */
  videoProvider?: BuildVideoProvider;
  /** Music provider for per-beat `music` cues. */
  musicProvider?: BuildMusicProvider;
  /** Skip AI video generation even when beats declare video cues. */
  skipVideo?: boolean;
  /** Skip music generation even when beats declare music cues. */
  skipMusic?: boolean;
  /** OpenAI image quality — see `vibe generate image --quality`. */
  imageQuality?: "standard" | "hd";
  /** OpenAI image size. Default 1536x1024 for cinematic 16:9-ish framing. */
  imageSize?: ImageOptions["size"];
  /** Force re-dispatch even when the asset already exists. */
  force?: boolean;
  /** Stage to run. `all` preserves the historical full build behavior. */
  stage?: BuildStage;
  /** Restrict asset/compose work to one beat id where supported. */
  beatId?: string;
  /** Hard USD cap checked before provider spend. */
  maxCostUsd?: number;
  /** Compose-scenes cache override (tests). */
  cacheDir?: string;
  /** Progress callback. */
  onProgress?: (e: SceneBuildProgressEvent) => void;
}

/**
 * Resulting state after dispatch. `phase` makes the agent contract
 * explicit:
 *   - `done` — render succeeded, MP4 at {@link outputPath}.
 *   - `compose-only` — `--skip-render` was set; compositions written.
 *   - `needs-author` — agent mode and one or more `compositions/*.html`
 *     missing. {@link composePrompts} carries the plan the host agent
 *     needs to author. Re-invoke `vibe scene build` after writing.
 *   - `failed` — primitives, compose, or render errored. {@link error}
 *     carries the message; {@link beats} reflects partial state.
 */
export type SceneBuildPhase =
  | "done"
  | "assets-only"
  | "pending-jobs"
  | "compose-only"
  | "sync-only"
  | "render-only"
  | "needs-author"
  | "failed";
export type BuildWorkflowStatus = "done" | "running" | "needs-author" | "failed" | "ready";
export type BuildCurrentStage = "assets" | "compose" | "sync" | "render" | "done";

export interface BuildBeatSummary {
  total: number;
  assetsReady: number;
  compositionsReady: number;
  needsAuthor: string[];
}

export interface StageReport {
  status: "pending" | "skipped" | "done" | "failed" | "needs-author" | "pending-jobs";
  costUsd: number;
  warnings: string[];
  retryWith: string[];
}

export type BuildSceneRepairStage = "compose" | "sync";

export interface BuildSceneRepairSummary {
  ran: boolean;
  stage: BuildSceneRepairStage | null;
  status: "skipped" | SceneRepairResult["status"];
  score: number | null;
  fixed: SceneRepairResult["fixed"];
  remainingIssues: SceneRepairResult["remainingIssues"];
  retryWith: string[];
}

export interface SceneBuildResult {
  success: boolean;
  /** Final phase reached — see {@link SceneBuildPhase}. */
  phase: SceneBuildPhase;
  /** Mode the dispatcher actually ran (after auto-resolve). */
  mode: "agent" | "batch";
  code?: string;
  error?: string;
  message?: string;
  suggestion?: string;
  recoverable?: boolean;
  validation?: BuildPlanResult["validation"];
  providerResolution?: BuildPlanResult["providerResolution"];
  beats: BeatBuildOutcome[];
  /** MP4 path when `skipRender` is false and render succeeded. */
  outputPath?: string;
  composeData?: ComposeScenesActionResult["data"];
  renderResult?: SceneRenderResult;
  /**
   * Populated only in agent mode when {@link phase} === `"needs-author"`.
   * The host agent should consume this to write each beat's HTML, then
   * re-run `vibe scene build`.
   */
  composePrompts?: {
    skillReference: string | null;
    designReference: string;
    storyboardReference: string;
    compositionsDir: string;
    instructions: string[];
    beats: ComposePromptsBeat[];
    bundleVersion: string;
    warnings: string[];
  };
  selectedStage?: BuildStage;
  status?: BuildWorkflowStatus;
  currentStage?: BuildCurrentStage;
  beatSummary?: BuildBeatSummary;
  estimatedCostUsd?: number;
  costUsd?: number;
  stageReports?: Record<"assets" | "compose" | "sync" | "render", StageReport>;
  sceneRepair?: BuildSceneRepairSummary;
  jobs?: JobRecord[];
  warnings?: string[];
  retryWith?: string[];
  reportPath?: string;
  /** Wall-clock total. */
  totalLatencyMs: number;
}

// ── Driver ───────────────────────────────────────────────────────────────

export async function executeSceneBuild(opts: SceneBuildOptions): Promise<SceneBuildResult> {
  const startedAt = Date.now();
  const projectDir = resolve(opts.projectDir);
  const onProgress = opts.onProgress ?? (() => {});
  const mode = resolveSceneBuildMode(opts);
  const selectedStage = opts.stage ?? (opts.skipRender ? "sync" : "all");
  const stageReports = createEmptyStageReports();
  const warnings: string[] = [];
  const retryWith: string[] = [];
  let sceneRepair = skippedSceneRepairSummary();

  const storyboardPath = join(projectDir, "STORYBOARD.md");
  const buildPlan = await createBuildPlan({
    projectDir,
    stage: selectedStage,
    beat: opts.beatId,
    mode,
    skipNarration: opts.skipNarration,
    skipBackdrop: opts.skipBackdrop,
    skipVideo: opts.skipVideo,
    skipMusic: opts.skipMusic,
    ttsProvider: opts.ttsProvider,
    voice: opts.voice,
    imageProvider: opts.imageProvider,
    imageQuality: opts.imageQuality,
    imageSize: opts.imageSize,
    videoProvider: opts.videoProvider,
    musicProvider: opts.musicProvider,
    composer: opts.composer,
    force: opts.force,
  });
  warnings.push(...buildPlan.warnings);
  retryWith.push(...buildPlan.retryWith);
  const finishBuildResult = (result: SceneBuildResult) =>
    finalizeBuildResult(projectDir, startedAt, {
      providerResolution: buildPlan.providerResolution,
      ...result,
    });

  if (!buildPlan.validation.ok) {
    let invalidBeats: Beat[] = [];
    if (existsSync(storyboardPath)) {
      invalidBeats = parseStoryboard(await readFile(storyboardPath, "utf-8")).beats;
    }
    return finishBuildResult({
      success: false,
      phase: "failed",
      mode,
      selectedStage,
      code: "STORYBOARD_VALIDATION_FAILED",
      error: `${buildPlan.summary.validationErrors} storyboard validation error(s).`,
      message: `${buildPlan.summary.validationErrors} storyboard validation error(s).`,
      suggestion:
        "Run storyboard validate, then fix STORYBOARD.md or use storyboard revise --dry-run.",
      recoverable: true,
      validation: buildPlan.validation,
      beats: collectExistingBeatOutcomes(invalidBeats, projectDir),
      estimatedCostUsd: buildPlan.estimatedCostUsd,
      costUsd: 0,
      stageReports,
      warnings,
      retryWith,
      status: "failed",
      currentStage: "assets",
      totalLatencyMs: Date.now() - startedAt,
    });
  }

  if (!existsSync(storyboardPath)) {
    return finishBuildResult({
      success: false,
      phase: "failed",
      mode,
      selectedStage,
      error: `STORYBOARD.md not found at ${storyboardPath}. Run \`vibe scene init <dir>\` to create a starter, or add STORYBOARD.md with per-beat cues.`,
      beats: [],
      stageReports,
      warnings,
      retryWith,
      totalLatencyMs: Date.now() - startedAt,
    });
  }
  const storyboardMd = await readFile(storyboardPath, "utf-8");
  const parsed = parseStoryboard(storyboardMd);
  if (parsed.beats.length === 0) {
    return finishBuildResult({
      success: false,
      phase: "failed",
      mode,
      selectedStage,
      error: `STORYBOARD.md at ${storyboardPath} has no \`## Beat …\` headings.`,
      beats: [],
      stageReports,
      warnings,
      retryWith,
      totalLatencyMs: Date.now() - startedAt,
    });
  }
  const selectedBeat = opts.beatId
    ? parsed.beats.find((beat) => beat.id === opts.beatId)
    : undefined;
  if (opts.beatId && !selectedBeat) {
    return finishBuildResult({
      success: false,
      phase: "failed",
      mode,
      selectedStage,
      error: `Beat "${opts.beatId}" not found. Available: ${parsed.beats.map((beat) => beat.id).join(", ")}`,
      beats: [],
      stageReports,
      warnings,
      retryWith: [...retryWith, `vibe storyboard list ${projectDir} --json`],
      totalLatencyMs: Date.now() - startedAt,
    });
  }
  const activeBeats = selectedBeat ? [selectedBeat] : parsed.beats;
  if (opts.maxCostUsd !== undefined && buildPlan.estimatedCostUsd > opts.maxCostUsd) {
    retryWith.push(
      `vibe build ${projectDir} --stage ${selectedStage} --skip-backdrop --json`,
      `vibe build ${projectDir} --stage ${selectedStage} --max-cost ${buildPlan.estimatedCostUsd} --json`
    );
    return finishBuildResult({
      success: false,
      phase: "failed",
      mode,
      selectedStage,
      error: `Estimated cost $${buildPlan.estimatedCostUsd.toFixed(2)} exceeds --max-cost $${opts.maxCostUsd.toFixed(2)}.`,
      beats: [],
      estimatedCostUsd: buildPlan.estimatedCostUsd,
      costUsd: 0,
      stageReports,
      warnings,
      retryWith,
      totalLatencyMs: Date.now() - startedAt,
    });
  }

  // Resolve providers — CLI flags > frontmatter > defaults.
  const frontmatterProviders = parsed.frontmatter?.providers as Record<string, unknown> | undefined;
  const ttsProvider =
    opts.ttsProvider ??
    (stringOrUndefined(frontmatterProviders?.tts) as TtsProviderName | undefined) ??
    buildPlan.config.config.providers.narration ??
    "auto";
  const imageProvider = (opts.imageProvider ??
    stringOrUndefined(frontmatterProviders?.image) ??
    buildPlan.config.config.providers.image ??
    "openai") as BuildImageProvider;
  const videoProvider = resolveBuildVideoProvider(
    opts.videoProvider ??
      stringOrUndefined(frontmatterProviders?.video) ??
      buildPlan.config.config.providers.video
  );
  const musicProvider = resolveBuildMusicProvider(
    opts.musicProvider ??
      stringOrUndefined(frontmatterProviders?.music) ??
      buildPlan.config.config.providers.music
  );
  const voice = opts.voice ?? parsed.frontmatter?.voice;

  let beatOutcomes: BeatBuildOutcome[] = collectExistingBeatOutcomes(parsed.beats, projectDir);
  let pendingJobs: JobRecord[] = [];
  if (shouldRunStage(selectedStage, "assets")) {
    onProgress({ type: "phase-start", phase: "primitives" });
    const primitiveResults = await Promise.all(
      activeBeats.map((beat) =>
        buildBeatPrimitives(beat, {
          projectDir,
          ttsProvider,
          voice: beat.cues?.voice ? String(beat.cues.voice) : voice,
          imageProvider,
          videoProvider,
          musicProvider,
          imageQuality: opts.imageQuality ?? "hd",
          imageSize: opts.imageSize ?? "1536x1024",
          skipNarration: opts.skipNarration ?? false,
          skipBackdrop: opts.skipBackdrop ?? false,
          skipVideo: opts.skipVideo ?? false,
          skipMusic: opts.skipMusic ?? false,
          force: opts.force ?? false,
          onProgress,
        })
      )
    );
    beatOutcomes = primitiveResults.map((result) => result.outcome);
    pendingJobs = primitiveResults.flatMap((result) => result.jobs);
    const assetFailed = beatOutcomes.some(
      (beat) =>
        beat.narrationStatus === "failed" ||
        beat.backdropStatus === "failed" ||
        beat.videoStatus === "failed" ||
        beat.musicStatus === "failed"
    );
    stageReports.assets.status = assetFailed
      ? "failed"
      : pendingJobs.length > 0
        ? "pending-jobs"
        : "done";
    stageReports.assets.costUsd = estimateActualAssetCost(beatOutcomes);
    stageReports.assets.retryWith = pendingJobs.map(
      (job) => `vibe status job ${job.id} --project ${projectDir} --json`
    );
  } else {
    stageReports.assets.status = "skipped";
  }

  if (stageReports.assets.status === "pending-jobs") {
    const statusRetry = [
      ...retryWith,
      `vibe status project ${projectDir} --refresh --json`,
      ...pendingJobs.map((job) => `vibe status job ${job.id} --project ${projectDir} --json`),
      `vibe build ${projectDir} --stage assets --json`,
    ];
    return finishBuildResult({
      success: true,
      phase: "pending-jobs",
      mode,
      selectedStage,
      beats: beatOutcomes,
      jobs: pendingJobs,
      estimatedCostUsd: buildPlan.estimatedCostUsd,
      costUsd: stageReports.assets.costUsd,
      stageReports,
      warnings,
      retryWith: statusRetry,
      totalLatencyMs: Date.now() - startedAt,
    });
  }

  if (stageReports.assets.status === "failed") {
    const failure = summarizeAssetFailure(beatOutcomes, projectDir);
    stageReports.assets.retryWith = unique([
      ...stageReports.assets.retryWith,
      ...failure.retryWith,
    ]);
    return finishBuildResult({
      success: false,
      phase: "failed",
      mode,
      selectedStage,
      code: failure.code,
      error: failure.message,
      message: failure.message,
      suggestion: failure.suggestion,
      recoverable: true,
      beats: beatOutcomes,
      jobs: pendingJobs,
      estimatedCostUsd: buildPlan.estimatedCostUsd,
      costUsd: stageReports.assets.costUsd,
      stageReports,
      warnings,
      retryWith: unique([...retryWith, ...failure.retryWith]),
      status: "failed",
      currentStage: "assets",
      totalLatencyMs: Date.now() - startedAt,
    });
  }

  if (selectedStage === "assets") {
    return finishBuildResult({
      success: true,
      phase: "assets-only",
      mode,
      selectedStage,
      beats: beatOutcomes,
      estimatedCostUsd: buildPlan.estimatedCostUsd,
      costUsd: stageReports.assets.costUsd,
      stageReports,
      jobs: pendingJobs,
      warnings,
      retryWith,
      totalLatencyMs: Date.now() - startedAt,
    });
  }

  // ── Phase 2: compose ──────────────────────────────────────────────────
  // Mode dispatch: agent mode hands authorship to the host agent. We
  // check whether each beat's compositions/scene-<id>.html exists and,
  // if any are missing, return a `needs-author` plan from
  // `getComposePrompts()`. The host agent fills in the files and
  // re-invokes `vibe scene build`; this branch then sees all files
  // present and skips straight to lint+render.
  let composeData: ComposeScenesActionResult["data"] | undefined;
  if (shouldRunStage(selectedStage, "compose")) {
    if (mode === "agent") {
      const compositionsDir = join(projectDir, "compositions");
      const missingBeats = activeBeats.filter(
        (b) => !existsSync(join(compositionsDir, `scene-${b.id}.html`))
      );
      if (missingBeats.length > 0) {
        const plan = await getComposePrompts({ projectDir, beatId: opts.beatId });
        stageReports.compose.status = "needs-author";
        return finishBuildResult({
          success: true,
          phase: "needs-author",
          mode,
          selectedStage,
          beats: beatOutcomes,
          composePrompts: plan.success
            ? {
                skillReference: plan.skillReference,
                designReference: plan.designReference,
                storyboardReference: plan.storyboardReference,
                compositionsDir: plan.compositionsDir,
                instructions: plan.instructions,
                beats: plan.beats,
                bundleVersion: plan.bundleVersion,
                warnings: plan.warnings,
              }
            : undefined,
          estimatedCostUsd: buildPlan.estimatedCostUsd,
          costUsd: stageReports.assets.costUsd,
          stageReports,
          warnings,
          retryWith: [
            ...retryWith,
            `vibe scene compose-prompts ${projectDir}${opts.beatId ? ` --beat ${opts.beatId}` : ""} --json`,
          ],
          totalLatencyMs: Date.now() - startedAt,
        });
      }
      // All compositions present — fall through to render (no compose call).
      onProgress({ type: "phase-start", phase: "compose" });
      stageReports.compose.status = "done";
    } else {
      // batch — current internal-LLM compose path (PR #176, multi-provider).
      onProgress({ type: "phase-start", phase: "compose" });
      const composeResult = await executeComposeScenesWithSkills(
        {
          project: ".",
          effort: opts.effort,
          composer: opts.composer,
          cacheDir: opts.cacheDir,
          onProgress: (e) => onProgress(e),
        },
        projectDir
      );
      if (!composeResult.success) {
        stageReports.compose.status = "failed";
        const composeRetryWith = unique([
          ...retryWith,
          `vibe build ${projectDir}${opts.beatId ? ` --beat ${opts.beatId}` : ""} --stage compose --json`,
          `vibe scene compose-prompts ${projectDir}${opts.beatId ? ` --beat ${opts.beatId}` : ""} --json`,
        ]);
        stageReports.compose.retryWith = unique([
          ...stageReports.compose.retryWith,
          ...composeRetryWith,
        ]);
        return finishBuildResult({
          success: false,
          phase: "failed",
          mode,
          selectedStage,
          code: "COMPOSE_FAILED",
          error: `compose failed: ${composeResult.error ?? "unknown"}`,
          message: `compose failed: ${composeResult.error ?? "unknown"}`,
          suggestion: "Retry compose, or use compose-prompts for host-agent authored scene files.",
          recoverable: true,
          beats: beatOutcomes,
          composeData: composeResult.data,
          estimatedCostUsd: buildPlan.estimatedCostUsd,
          costUsd: stageReports.assets.costUsd,
          stageReports,
          warnings,
          retryWith: composeRetryWith,
          status: "failed",
          currentStage: "compose",
          totalLatencyMs: Date.now() - startedAt,
        });
      }
      composeData = composeResult.data;
      stageReports.compose.status = "done";
      stageReports.compose.costUsd =
        (composeResult.data as { costUsd?: number } | undefined)?.costUsd ?? 0;
    }
  } else {
    stageReports.compose.status = "skipped";
  }

  if (stageReports.compose.status === "done") {
    const repair = await runBuildSceneRepair(projectDir, "compose", false);
    sceneRepair = mergeSceneRepairSummaries(sceneRepair, repair);
    applySceneRepairToStage(stageReports.compose, repair);
    warnings.push(...sceneRepairWarnings(repair));
    retryWith.push(...repair.retryWith);
    if (repair.status === "fail") {
      stageReports.compose.status = "failed";
      return finishBuildResult({
        success: false,
        phase: "failed",
        mode,
        selectedStage,
        code: "SCENE_REPAIR_FAILED",
        error: "Scene repair failed after compose stage.",
        message: "Scene repair failed after compose stage.",
        suggestion:
          "Run `vibe scene repair <project> --json`, then edit remaining scene HTML findings.",
        recoverable: true,
        beats: beatOutcomes,
        composeData,
        estimatedCostUsd: buildPlan.estimatedCostUsd,
        costUsd: stageReports.assets.costUsd + stageReports.compose.costUsd,
        stageReports,
        sceneRepair,
        warnings,
        retryWith,
        status: "failed",
        currentStage: "compose",
        totalLatencyMs: Date.now() - startedAt,
      });
    }
  }

  if (selectedStage === "compose") {
    return finishBuildResult({
      success: true,
      phase: "compose-only",
      mode,
      selectedStage,
      beats: beatOutcomes,
      composeData,
      estimatedCostUsd: buildPlan.estimatedCostUsd,
      costUsd: stageReports.assets.costUsd + stageReports.compose.costUsd,
      stageReports,
      sceneRepair,
      warnings,
      retryWith,
      totalLatencyMs: Date.now() - startedAt,
    });
  }

  // ── Phase 2.5: ensure render scaffold + wire scene compositions ──────
  // Both batch and agent modes need this — agents that just authored
  // composition HTML still need them referenced from the root index for
  // the producer to find them.
  if (shouldRunStage(selectedStage, "sync")) {
    if (!existsSync(join(projectDir, "index.html"))) {
      await scaffoldSceneProject({
        dir: projectDir,
        name: projectDir.split(/[\\/]/).filter(Boolean).pop(),
        profile: "full",
      });
    }
    const allOutcomes = mergeBeatOutcomes(
      collectExistingBeatOutcomes(parsed.beats, projectDir),
      beatOutcomes
    );
    await syncRootComposition({
      projectDir,
      beats: rootSyncBeatsFromOutcomes(parsed.beats, allOutcomes),
    });
    stageReports.sync.status = "done";
    beatOutcomes = mergeBeatOutcomes(allOutcomes, beatOutcomes);
  } else {
    stageReports.sync.status = "skipped";
  }

  if (stageReports.sync.status === "done") {
    const repair = await runBuildSceneRepair(projectDir, "sync", true);
    sceneRepair = mergeSceneRepairSummaries(sceneRepair, repair);
    applySceneRepairToStage(stageReports.sync, repair);
    warnings.push(...sceneRepairWarnings(repair));
    retryWith.push(...repair.retryWith);
    if (repair.status === "fail") {
      stageReports.sync.status = "failed";
      return finishBuildResult({
        success: false,
        phase: "failed",
        mode,
        selectedStage,
        code: "SCENE_REPAIR_FAILED",
        error: "Scene repair failed after sync stage.",
        message: "Scene repair failed after sync stage.",
        suggestion:
          "Run `vibe scene repair <project> --json`, then edit remaining scene HTML findings.",
        recoverable: true,
        beats: beatOutcomes,
        composeData,
        estimatedCostUsd: buildPlan.estimatedCostUsd,
        costUsd: stageReports.assets.costUsd + stageReports.compose.costUsd,
        stageReports,
        sceneRepair,
        warnings,
        retryWith,
        status: "failed",
        currentStage: "sync",
        totalLatencyMs: Date.now() - startedAt,
      });
    }
  }

  if (selectedStage === "sync" || opts.skipRender) {
    return finishBuildResult({
      success: true,
      phase: "sync-only",
      mode,
      selectedStage,
      beats: beatOutcomes,
      composeData,
      estimatedCostUsd: buildPlan.estimatedCostUsd,
      costUsd: stageReports.assets.costUsd + stageReports.compose.costUsd,
      stageReports,
      sceneRepair,
      warnings,
      retryWith,
      totalLatencyMs: Date.now() - startedAt,
    });
  }

  // ── Phase 3: render (optional) ────────────────────────────────────────
  let outputPath: string | undefined;
  let renderResult: SceneRenderResult | undefined;
  if (shouldRunStage(selectedStage, "render")) {
    onProgress({ type: "phase-start", phase: "render" });
    onProgress({ type: "render-start" });
    renderResult = await executeSceneRender({ projectDir });
    if (!renderResult.success) {
      stageReports.render.status = "failed";
      const renderRetryWith = unique([
        ...retryWith,
        ...(renderResult.retryWith ?? []),
        `vibe inspect project ${projectDir} --json`,
        `vibe build ${projectDir} --stage sync --json`,
        `vibe build ${projectDir} --stage render --json`,
        `vibe render ${projectDir} --json`,
      ]);
      stageReports.render.retryWith = unique([
        ...stageReports.render.retryWith,
        ...renderRetryWith,
      ]);
      return finishBuildResult({
        success: false,
        phase: "failed",
        mode,
        selectedStage,
        code: renderResult.code ?? "RENDER_FAILED",
        error: `render failed: ${renderResult.error ?? "unknown"}`,
        message: `render failed: ${renderResult.error ?? "unknown"}`,
        suggestion: "Inspect project readiness, rerun sync if needed, then retry render.",
        recoverable: true,
        beats: beatOutcomes,
        composeData,
        renderResult,
        estimatedCostUsd: buildPlan.estimatedCostUsd,
        costUsd: stageReports.assets.costUsd + stageReports.compose.costUsd,
        stageReports,
        sceneRepair,
        warnings,
        retryWith: renderRetryWith,
        status: "failed",
        currentStage: "render",
        totalLatencyMs: Date.now() - startedAt,
      });
    }
    outputPath = renderResult.outputPath;
    if (outputPath) onProgress({ type: "render-done", outputPath });
    stageReports.render.status = "done";
  } else {
    stageReports.render.status = "skipped";
  }

  return finishBuildResult({
    success: true,
    phase: selectedStage === "render" ? "render-only" : "done",
    mode,
    selectedStage,
    beats: beatOutcomes,
    outputPath,
    composeData,
    renderResult,
    estimatedCostUsd: buildPlan.estimatedCostUsd,
    costUsd: stageReports.assets.costUsd + stageReports.compose.costUsd,
    stageReports,
    sceneRepair,
    warnings,
    retryWith,
    totalLatencyMs: Date.now() - startedAt,
  });
}

// ── Per-beat primitive dispatch ──────────────────────────────────────────

interface BeatDispatchContext {
  projectDir: string;
  ttsProvider: TtsProviderName;
  voice?: string;
  imageProvider: BuildImageProvider;
  videoProvider: BuildVideoProvider;
  musicProvider: BuildMusicProvider;
  imageQuality: "standard" | "hd";
  imageSize: ImageOptions["size"];
  skipNarration: boolean;
  skipBackdrop: boolean;
  skipVideo: boolean;
  skipMusic: boolean;
  force: boolean;
  onProgress: (e: SceneBuildProgressEvent) => void;
}

interface BeatPrimitiveResult {
  outcome: BeatBuildOutcome;
  jobs: JobRecord[];
}

async function buildBeatPrimitives(
  beat: Beat,
  ctx: BeatDispatchContext
): Promise<BeatPrimitiveResult> {
  const [narration, backdrop, video, music] = await Promise.all([
    ctx.skipNarration
      ? skipped("narration", beat.id, "--skip-narration", ctx)
      : dispatchNarration(beat, ctx),
    ctx.skipBackdrop
      ? skipped("backdrop", beat.id, "--skip-backdrop", ctx)
      : dispatchBackdrop(beat, ctx),
    ctx.skipVideo ? skipped("video", beat.id, "--skip-video", ctx) : dispatchVideo(beat, ctx),
    ctx.skipMusic ? skipped("music", beat.id, "--skip-music", ctx) : dispatchMusic(beat, ctx),
  ]);
  return {
    outcome: {
      beatId: beat.id,
      narrationStatus: narration.status,
      narrationPath: narration.path,
      narrationError: narration.error,
      narrationDurationSec: narration.durationSec,
      sceneDurationSec: narration.path
        ? await resolveBeatDuration({
            beatDuration: beat.duration,
            narrationPath: narration.path,
            projectDir: ctx.projectDir,
          })
        : beat.duration,
      narrationText: stringOrUndefined(beat.cues?.narration),
      narrationVoice: stringOrUndefined(beat.cues?.voice) ?? ctx.voice,
      narrationProvider: narration.provider,
      narrationCachePath: narration.cachePath,
      narrationCacheKey: narration.cacheKey,
      narrationMetadataPath: narration.metadataPath,
      narrationFreshness: narration.freshness,
      narrationSourcePath: narration.sourcePath,
      backdropStatus: backdrop.status,
      backdropPath: backdrop.path,
      backdropError: backdrop.error,
      backdropPrompt: stringOrUndefined(beat.cues?.backdrop),
      backdropProvider: backdrop.provider,
      backdropCachePath: backdrop.cachePath,
      backdropCacheKey: backdrop.cacheKey,
      backdropMetadataPath: backdrop.metadataPath,
      backdropFreshness: backdrop.freshness,
      backdropSourcePath: backdrop.sourcePath,
      videoStatus: video.status,
      videoPath: video.path,
      videoJobId: video.job?.id,
      videoError: video.error,
      videoPrompt: stringOrUndefined(beat.cues?.video),
      videoProvider: video.provider,
      videoCachePath: video.cachePath,
      videoCacheKey: video.cacheKey,
      videoMetadataPath: video.metadataPath,
      videoFreshness: video.freshness,
      videoSourcePath: video.sourcePath,
      musicStatus: music.status,
      musicPath: music.path,
      musicJobId: music.job?.id,
      musicError: music.error,
      musicPrompt: stringOrUndefined(beat.cues?.music),
      musicProvider: music.provider,
      musicCachePath: music.cachePath,
      musicCacheKey: music.cacheKey,
      musicMetadataPath: music.metadataPath,
      musicFreshness: music.freshness,
      musicSourcePath: music.sourcePath,
      musicDurationSec: music.durationSec,
    },
    jobs: [video.job, music.job].filter((job): job is JobRecord => Boolean(job)),
  };
}

interface PrimitiveOutcome {
  status: PrimitiveStatus;
  path?: string;
  error?: string;
  durationSec?: number;
  job?: JobRecord;
  provider?: string;
  cachePath?: string;
  cacheKey?: string;
  metadataPath?: string;
  freshness?: AssetFreshness;
  sourcePath?: string;
}

async function referencePrimitiveOutcome(
  kind: BuildAssetKind,
  beat: Beat,
  ctx: BeatDispatchContext,
  reference: AssetReferenceCandidate
): Promise<PrimitiveOutcome> {
  const sourcePath = reference.relPath ?? reference.raw;
  if (!isReadyAssetReference(reference)) {
    const error = reference.error ?? `Invalid ${kind} asset reference "${reference.raw}".`;
    emitPrimitiveFailed(kind, beat.id, error, ctx);
    return { status: "failed", error, provider: "local", sourcePath };
  }

  return {
    status: "referenced",
    path: reference.relPath,
    sourcePath,
    provider: "local",
    freshness: "referenced",
    durationSec:
      kind === "narration" || kind === "music"
        ? await safeAudioDuration(reference.absPath)
        : undefined,
  };
}

function assetReferenceForBeat(
  projectDir: string,
  kind: BuildAssetKind,
  beat: Beat
): AssetReferenceCandidate | null {
  const cue = beat.cues ?? {};
  const typed = resolveTypedAssetReference(projectDir, kind, cue[kind]);
  if (typed) return typed;
  if (stringOrUndefined(cue[kind])) return null;
  const generic = resolveGenericAssetReference(projectDir, cue.asset);
  return generic?.kind === kind ? generic : null;
}

function emitPrimitiveFailed(
  kind: BuildAssetKind,
  beatId: string,
  error: string,
  ctx: BeatDispatchContext
): void {
  switch (kind) {
    case "narration":
      ctx.onProgress({ type: "narration-failed", beatId, error });
      return;
    case "backdrop":
      ctx.onProgress({ type: "backdrop-failed", beatId, error });
      return;
    case "video":
      ctx.onProgress({ type: "video-failed", beatId, error });
      return;
    case "music":
      ctx.onProgress({ type: "music-failed", beatId, error });
      return;
  }
}

async function dispatchNarration(beat: Beat, ctx: BeatDispatchContext): Promise<PrimitiveOutcome> {
  const reference = assetReferenceForBeat(ctx.projectDir, "narration", beat);
  if (reference) return referencePrimitiveOutcome("narration", beat, ctx, reference);

  const text = stringOrUndefined(beat.cues?.narration);
  if (!text) return { status: "no-cue" };
  const metadataPath = assetMetadataPath("narration", beat.id);
  const voice = ctx.voice ?? stringOrUndefined(beat.cues?.voice);

  const existingRel = firstExisting(ctx.projectDir, [
    `assets/narration-${beat.id}.mp3`,
    `assets/narration-${beat.id}.wav`,
  ]);
  if (existingRel && !ctx.force) {
    const metadata = readAssetMetadata(ctx.projectDir, "narration", beat.id);
    if (!metadata || (metadata.cue === text && (!voice || metadata.options?.voice === voice))) {
      ctx.onProgress({ type: "narration-cached", beatId: beat.id, path: existingRel });
      return {
        status: "cached",
        path: existingRel,
        durationSec: await safeAudioDuration(join(ctx.projectDir, existingRel)),
        provider: metadata?.provider,
        cachePath: metadata?.cachePath,
        cacheKey: metadata?.cacheKey,
        metadataPath,
        freshness: metadata ? "fresh" : "unknown",
      };
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

  const cache = narrationCacheDescriptor({
    beatId: beat.id,
    cue: text,
    provider: resolution.provider,
    voice,
    ext: resolution.audioExtension,
  });
  const cacheAbs = join(ctx.projectDir, cache.path);
  const rel = `assets/narration-${beat.id}.${resolution.audioExtension}`;
  const abs = join(ctx.projectDir, rel);
  if (
    existingRel &&
    !ctx.force &&
    isFreshCanonicalAsset({
      projectDir: ctx.projectDir,
      kind: "narration",
      beatId: beat.id,
      cue: text,
      provider: resolution.provider,
      options: { voice },
      cacheKey: cache.key,
    })
  ) {
    ctx.onProgress({ type: "narration-cached", beatId: beat.id, path: existingRel });
    return {
      status: "cached",
      path: existingRel,
      durationSec: await safeAudioDuration(join(ctx.projectDir, existingRel)),
      provider: resolution.provider,
      cachePath: cache.path,
      cacheKey: cache.key,
      metadataPath,
      freshness: "fresh",
    };
  }
  if (existsSync(cacheAbs) && !ctx.force) {
    await mkdir(dirname(abs), { recursive: true });
    await copyFile(cacheAbs, abs);
    await writeAssetMetadata({
      projectDir: ctx.projectDir,
      kind: "narration",
      beatId: beat.id,
      cue: text,
      provider: resolution.provider,
      options: { voice },
      cacheKey: cache.key,
      canonicalPath: rel,
      cachePath: cache.path,
    });
    ctx.onProgress({ type: "narration-cached", beatId: beat.id, path: rel });
    return {
      status: "cached",
      path: rel,
      durationSec: await safeAudioDuration(abs),
      provider: resolution.provider,
      cachePath: cache.path,
      cacheKey: cache.key,
      metadataPath,
      freshness: "fresh",
    };
  }

  const result = await resolution.call(text, { voice });
  if (!result.success || !result.audioBuffer) {
    const error = result.error ?? "unknown TTS failure";
    ctx.onProgress({ type: "narration-failed", beatId: beat.id, error });
    return { status: "failed", error };
  }

  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, result.audioBuffer);
  await mkdir(dirname(cacheAbs), { recursive: true });
  await writeFile(cacheAbs, result.audioBuffer);
  await writeAssetMetadata({
    projectDir: ctx.projectDir,
    kind: "narration",
    beatId: beat.id,
    cue: text,
    provider: resolution.provider,
    options: { voice },
    cacheKey: cache.key,
    canonicalPath: rel,
    cachePath: cache.path,
  });
  ctx.onProgress({
    type: "narration-generated",
    beatId: beat.id,
    path: rel,
    provider: resolution.provider,
  });
  return {
    status: "generated",
    path: rel,
    durationSec: await safeAudioDuration(abs),
    provider: resolution.provider,
    cachePath: cache.path,
    cacheKey: cache.key,
    metadataPath,
    freshness: "fresh",
  };
}

async function dispatchBackdrop(beat: Beat, ctx: BeatDispatchContext): Promise<PrimitiveOutcome> {
  const reference = assetReferenceForBeat(ctx.projectDir, "backdrop", beat);
  if (reference) return referencePrimitiveOutcome("backdrop", beat, ctx, reference);

  const prompt = stringOrUndefined(beat.cues?.backdrop);
  if (!prompt) return { status: "no-cue" };

  const rel = `assets/backdrop-${beat.id}.png`;
  const abs = join(ctx.projectDir, rel);
  const size = ctx.imageSize ?? "1536x1024";
  const ratio = imageRatioForSize(size);
  const metadataOptions = { quality: ctx.imageQuality, size, ratio };
  const cache = backdropCacheDescriptor({
    beatId: beat.id,
    cue: prompt,
    provider: ctx.imageProvider,
    quality: ctx.imageQuality,
    size,
    ratio,
  });
  const metadataPath = assetMetadataPath("backdrop", beat.id);
  if (existsSync(abs) && !ctx.force) {
    const metadata = readAssetMetadata(ctx.projectDir, "backdrop", beat.id);
    if (
      !metadata ||
      isFreshCanonicalAsset({
        projectDir: ctx.projectDir,
        kind: "backdrop",
        beatId: beat.id,
        cue: prompt,
        provider: ctx.imageProvider,
        options: metadataOptions,
        cacheKey: cache.key,
      })
    ) {
      ctx.onProgress({ type: "backdrop-cached", beatId: beat.id, path: rel });
      return {
        status: "cached",
        path: rel,
        provider: metadata?.provider ?? ctx.imageProvider,
        cachePath: metadata?.cachePath ?? cache.path,
        cacheKey: metadata?.cacheKey ?? cache.key,
        metadataPath,
        freshness: metadata ? "fresh" : "unknown",
      };
    }
  }
  const cacheAbs = join(ctx.projectDir, cache.path);
  if (existsSync(cacheAbs) && !ctx.force) {
    await mkdir(dirname(abs), { recursive: true });
    await copyFile(cacheAbs, abs);
    await writeAssetMetadata({
      projectDir: ctx.projectDir,
      kind: "backdrop",
      beatId: beat.id,
      cue: prompt,
      provider: ctx.imageProvider,
      options: metadataOptions,
      cacheKey: cache.key,
      canonicalPath: rel,
      cachePath: cache.path,
    });
    ctx.onProgress({ type: "backdrop-cached", beatId: beat.id, path: rel });
    return {
      status: "cached",
      path: rel,
      provider: ctx.imageProvider,
      cachePath: cache.path,
      cacheKey: cache.key,
      metadataPath,
      freshness: "fresh",
    };
  }

  const generated = await generateBackdropImage(prompt, ctx, ratio);
  if (!generated.success) {
    const error = generated.error;
    ctx.onProgress({ type: "backdrop-failed", beatId: beat.id, error });
    return { status: "failed", error };
  }

  await mkdir(dirname(abs), { recursive: true });
  const buffer = generated.buffer;
  await writeFile(abs, buffer);
  await mkdir(dirname(cacheAbs), { recursive: true });
  await writeFile(cacheAbs, buffer);
  await writeAssetMetadata({
    projectDir: ctx.projectDir,
    kind: "backdrop",
    beatId: beat.id,
    cue: prompt,
    provider: ctx.imageProvider,
    options: metadataOptions,
    cacheKey: cache.key,
    canonicalPath: rel,
    cachePath: cache.path,
  });
  ctx.onProgress({
    type: "backdrop-generated",
    beatId: beat.id,
    path: rel,
    provider: ctx.imageProvider,
  });
  return {
    status: "generated",
    path: rel,
    provider: ctx.imageProvider,
    cachePath: cache.path,
    cacheKey: cache.key,
    metadataPath,
    freshness: "fresh",
  };
}

interface GeneratedImageData {
  base64?: string;
  url?: string;
}

type GeneratedBackdropResult =
  | { success: true; buffer: Buffer }
  | { success: false; error: string };

async function generateBackdropImage(
  prompt: string,
  ctx: BeatDispatchContext,
  ratio: string
): Promise<GeneratedBackdropResult> {
  loadSceneBuildEnv(ctx.projectDir);
  const keyInfo = imageProviderKeyInfo(ctx.imageProvider);
  const apiKey =
    (await getApiKeyFromConfig(keyInfo.configKey, { cwd: ctx.projectDir })) ??
    process.env[keyInfo.envVar] ??
    "";
  if (!apiKey) {
    return {
      success: false,
      error: `${keyInfo.envVar} not set — cannot dispatch backdrop with ${ctx.imageProvider}`,
    };
  }

  if (ctx.imageProvider === "openai") {
    const provider = new OpenAIImageProvider();
    await provider.initialize({ apiKey });
    const result = await provider.generateImage(prompt, {
      model: "gpt-image-2",
      size: ctx.imageSize,
      quality: ctx.imageQuality,
    });
    return imageBufferFromResult(result);
  }

  if (ctx.imageProvider === "gemini") {
    const provider = new GeminiProvider();
    await provider.initialize({ apiKey });
    const result = await provider.generateImage(prompt, {
      model: "flash",
      aspectRatio: ratio as "1:1" | "2:3" | "3:2" | "16:9",
    });
    return imageBufferFromResult(result);
  }

  const provider = new GrokProvider();
  await provider.initialize({ apiKey });
  const result = await provider.generateImage(prompt, {
    aspectRatio: ratio,
    n: 1,
  });
  return imageBufferFromResult(result);
}

async function imageBufferFromResult(result: {
  success: boolean;
  error?: string;
  images?: GeneratedImageData[];
}): Promise<GeneratedBackdropResult> {
  const image = result.images?.[0];
  if (!result.success || !image) {
    return { success: false, error: result.error ?? "no image data returned" };
  }
  if (image.base64) return { success: true, buffer: Buffer.from(image.base64, "base64") };
  if (image.url) {
    const response = await fetch(image.url);
    if (!response.ok) {
      return { success: false, error: `failed to download image: HTTP ${response.status}` };
    }
    return { success: true, buffer: Buffer.from(await response.arrayBuffer()) };
  }
  return { success: false, error: "no image data returned" };
}

function imageProviderKeyInfo(provider: BuildImageProvider): { configKey: string; envVar: string } {
  if (provider === "gemini") return { configKey: "google", envVar: "GOOGLE_API_KEY" };
  if (provider === "grok") return { configKey: "xai", envVar: "XAI_API_KEY" };
  return { configKey: "openai", envVar: "OPENAI_API_KEY" };
}

async function dispatchVideo(beat: Beat, ctx: BeatDispatchContext): Promise<PrimitiveOutcome> {
  const reference = assetReferenceForBeat(ctx.projectDir, "video", beat);
  if (reference) return referencePrimitiveOutcome("video", beat, ctx, reference);

  const prompt = stringOrUndefined(beat.cues?.video);
  if (!prompt) return { status: "no-cue" };

  const rel = `assets/video-${beat.id}.mp4`;
  const abs = join(ctx.projectDir, rel);
  const cache = videoCacheDescriptor({
    beatId: beat.id,
    cue: prompt,
    provider: ctx.videoProvider,
    duration: normalizeVideoDuration(beat.duration),
  });
  const metadataPath = assetMetadataPath("video", beat.id);
  if (existsSync(abs) && !ctx.force) {
    const metadata = readAssetMetadata(ctx.projectDir, "video", beat.id);
    if (
      !metadata ||
      isFreshCanonicalAsset({
        projectDir: ctx.projectDir,
        kind: "video",
        beatId: beat.id,
        cue: prompt,
        provider: ctx.videoProvider,
        options: { duration: normalizeVideoDuration(beat.duration), ratio: "16:9" },
        cacheKey: cache.key,
      })
    ) {
      ctx.onProgress({ type: "video-cached", beatId: beat.id, path: rel });
      return {
        status: "cached",
        path: rel,
        provider: metadata?.provider ?? ctx.videoProvider,
        cachePath: metadata?.cachePath ?? cache.path,
        cacheKey: metadata?.cacheKey ?? cache.key,
        metadataPath,
        freshness: metadata ? "fresh" : "unknown",
      };
    }
  }
  const cacheAbs = join(ctx.projectDir, cache.path);
  if (existsSync(cacheAbs) && !ctx.force) {
    await mkdir(dirname(abs), { recursive: true });
    await copyFile(cacheAbs, abs);
    await writeAssetMetadata({
      projectDir: ctx.projectDir,
      kind: "video",
      beatId: beat.id,
      cue: prompt,
      provider: ctx.videoProvider,
      options: { duration: normalizeVideoDuration(beat.duration), ratio: "16:9" },
      cacheKey: cache.key,
      canonicalPath: rel,
      cachePath: cache.path,
    });
    ctx.onProgress({ type: "video-cached", beatId: beat.id, path: rel });
    return {
      status: "cached",
      path: rel,
      provider: ctx.videoProvider,
      cachePath: cache.path,
      cacheKey: cache.key,
      metadataPath,
      freshness: "fresh",
    };
  }

  loadSceneBuildEnv(ctx.projectDir);
  const result = await executeVideoGenerate({
    prompt,
    provider: ctx.videoProvider,
    duration: normalizeVideoDuration(beat.duration),
    ratio: "16:9",
    output: abs,
    wait: false,
    apiKey: await apiKeyForVideoProvider(ctx.videoProvider, ctx.projectDir),
  });
  if (!result.success || !result.taskId) {
    const error = result.error ?? "video generation did not return a task id";
    ctx.onProgress({ type: "video-failed", beatId: beat.id, error });
    return { status: "failed", error };
  }

  if (result.status === "completed" && existsSync(abs)) {
    await mkdir(dirname(cacheAbs), { recursive: true });
    await copyFile(abs, cacheAbs);
    await writeAssetMetadata({
      projectDir: ctx.projectDir,
      kind: "video",
      beatId: beat.id,
      cue: prompt,
      provider: result.provider ?? ctx.videoProvider,
      options: { duration: normalizeVideoDuration(beat.duration), ratio: "16:9" },
      cacheKey: cache.key,
      canonicalPath: rel,
      cachePath: cache.path,
    });
    ctx.onProgress({
      type: "video-generated",
      beatId: beat.id,
      path: rel,
      provider: result.provider ?? ctx.videoProvider,
    });
    return {
      status: "generated",
      path: rel,
      provider: result.provider ?? ctx.videoProvider,
      cachePath: cache.path,
      cacheKey: cache.key,
      metadataPath,
      freshness: "fresh",
    };
  }

  const job = await createAndWriteJobRecord({
    jobType: "generate-video",
    provider: result.provider ?? ctx.videoProvider,
    providerTaskId: result.taskId,
    providerTaskType: "text2video",
    status: "running",
    projectDir: ctx.projectDir,
    workingDirectory: ctx.projectDir,
    command: "build --stage assets",
    prompt,
    resultUrl: result.videoUrl,
    beatId: beat.id,
    outputPath: abs,
    cachePath: cacheAbs,
    assetKind: "video",
    assetCue: prompt,
    assetOptions: { duration: normalizeVideoDuration(beat.duration), ratio: "16:9" },
    cacheKey: cache.key,
    canonicalPath: rel,
    metadataPath,
  });
  ctx.onProgress({ type: "video-pending", beatId: beat.id, jobId: job.id, provider: job.provider });
  return {
    status: "pending",
    path: rel,
    job,
    provider: job.provider,
    cachePath: cache.path,
    cacheKey: cache.key,
    metadataPath,
  };
}

async function dispatchMusic(beat: Beat, ctx: BeatDispatchContext): Promise<PrimitiveOutcome> {
  const reference = assetReferenceForBeat(ctx.projectDir, "music", beat);
  if (reference) return referencePrimitiveOutcome("music", beat, ctx, reference);

  const prompt = stringOrUndefined(beat.cues?.music);
  if (!prompt) return { status: "no-cue" };

  const rel = `assets/music-${beat.id}.mp3`;
  const abs = join(ctx.projectDir, rel);
  const duration = normalizeMusicDuration(beat.duration);
  const cache = musicCacheDescriptor({
    beatId: beat.id,
    cue: prompt,
    provider: ctx.musicProvider,
    duration,
  });
  const metadataPath = assetMetadataPath("music", beat.id);
  if (existsSync(abs) && !ctx.force) {
    const metadata = readAssetMetadata(ctx.projectDir, "music", beat.id);
    if (
      !metadata ||
      isFreshCanonicalAsset({
        projectDir: ctx.projectDir,
        kind: "music",
        beatId: beat.id,
        cue: prompt,
        provider: ctx.musicProvider,
        options: { duration },
        cacheKey: cache.key,
      })
    ) {
      ctx.onProgress({ type: "music-cached", beatId: beat.id, path: rel });
      return {
        status: "cached",
        path: rel,
        provider: metadata?.provider ?? ctx.musicProvider,
        durationSec: await safeAudioDuration(abs),
        cachePath: metadata?.cachePath ?? cache.path,
        cacheKey: metadata?.cacheKey ?? cache.key,
        metadataPath,
        freshness: metadata ? "fresh" : "unknown",
      };
    }
  }
  const cacheAbs = join(ctx.projectDir, cache.path);
  if (existsSync(cacheAbs) && !ctx.force) {
    await mkdir(dirname(abs), { recursive: true });
    await copyFile(cacheAbs, abs);
    await writeAssetMetadata({
      projectDir: ctx.projectDir,
      kind: "music",
      beatId: beat.id,
      cue: prompt,
      provider: ctx.musicProvider,
      options: { duration },
      cacheKey: cache.key,
      canonicalPath: rel,
      cachePath: cache.path,
    });
    ctx.onProgress({ type: "music-cached", beatId: beat.id, path: rel });
    return {
      status: "cached",
      path: rel,
      provider: ctx.musicProvider,
      cachePath: cache.path,
      cacheKey: cache.key,
      metadataPath,
      freshness: "fresh",
    };
  }

  loadSceneBuildEnv(ctx.projectDir);
  const result = await executeMusic({
    prompt,
    provider: ctx.musicProvider,
    duration,
    output: abs,
    wait: ctx.musicProvider === "replicate" ? false : true,
  });
  if (!result.success) {
    const error = result.error ?? "music generation failed";
    ctx.onProgress({ type: "music-failed", beatId: beat.id, error });
    return { status: "failed", error };
  }

  if (ctx.musicProvider === "replicate" && result.taskId) {
    const job = await createAndWriteJobRecord({
      jobType: "generate-music",
      provider: "replicate",
      providerTaskId: result.taskId,
      status: "running",
      projectDir: ctx.projectDir,
      workingDirectory: ctx.projectDir,
      command: "build --stage assets",
      prompt,
      beatId: beat.id,
      outputPath: abs,
      cachePath: cacheAbs,
      assetKind: "music",
      assetCue: prompt,
      assetOptions: { duration },
      cacheKey: cache.key,
      canonicalPath: rel,
      metadataPath,
    });
    ctx.onProgress({
      type: "music-pending",
      beatId: beat.id,
      jobId: job.id,
      provider: job.provider,
    });
    return {
      status: "pending",
      path: rel,
      job,
      provider: job.provider,
      cachePath: cache.path,
      cacheKey: cache.key,
      metadataPath,
    };
  }

  if (!existsSync(abs)) {
    const error = result.outputPath
      ? `music output was not written at ${abs}`
      : "music generation did not return an output file";
    ctx.onProgress({ type: "music-failed", beatId: beat.id, error });
    return { status: "failed", error };
  }

  await mkdir(dirname(cacheAbs), { recursive: true });
  await copyFile(abs, cacheAbs);
  await writeAssetMetadata({
    projectDir: ctx.projectDir,
    kind: "music",
    beatId: beat.id,
    cue: prompt,
    provider: result.provider ?? ctx.musicProvider,
    options: { duration },
    cacheKey: cache.key,
    canonicalPath: rel,
    cachePath: cache.path,
  });
  ctx.onProgress({
    type: "music-generated",
    beatId: beat.id,
    path: rel,
    provider: result.provider ?? ctx.musicProvider,
  });
  return {
    status: "generated",
    path: rel,
    durationSec: duration,
    provider: result.provider ?? ctx.musicProvider,
    cachePath: cache.path,
    cacheKey: cache.key,
    metadataPath,
    freshness: "fresh",
  };
}

function loadSceneBuildEnv(projectDir: string): void {
  loadDotenv({ path: join(projectDir, ".env"), quiet: true });
  loadDotenv({ path: resolve(process.cwd(), ".env"), quiet: true });

  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      loadDotenv({ path: join(dir, ".env"), quiet: true });
      return;
    }
    dir = dirname(dir);
  }
}

async function skipped(
  kind: "narration" | "backdrop" | "video" | "music",
  beatId: string,
  reason: string,
  ctx: BeatDispatchContext
): Promise<PrimitiveOutcome> {
  ctx.onProgress({ type: `${kind}-skipped` as const, beatId, reason });
  return { status: "skipped" };
}

function createEmptyStageReports(): Record<"assets" | "compose" | "sync" | "render", StageReport> {
  return {
    assets: { status: "pending", costUsd: 0, warnings: [], retryWith: [] },
    compose: { status: "pending", costUsd: 0, warnings: [], retryWith: [] },
    sync: { status: "pending", costUsd: 0, warnings: [], retryWith: [] },
    render: { status: "pending", costUsd: 0, warnings: [], retryWith: [] },
  };
}

function skippedSceneRepairSummary(): BuildSceneRepairSummary {
  return {
    ran: false,
    stage: null,
    status: "skipped",
    score: null,
    fixed: [],
    remainingIssues: [],
    retryWith: [],
  };
}

function summarizeAssetFailure(
  outcomes: BeatBuildOutcome[],
  projectDir: string
): { code: string; message: string; suggestion: string; retryWith: string[] } {
  const failure = firstAssetFailure(outcomes);
  const error = failure?.error ?? "Asset generation failed.";
  const code = classifyAssetFailure(error);
  const beatClause = failure?.beatId ? ` for beat "${failure.beatId}"` : "";
  const retryBeat = failure?.beatId ? ` --beat ${failure.beatId}` : "";
  if (code === "ASSET_REFERENCE_INVALID") {
    return {
      code,
      message: `Asset reference failed${beatClause}: ${error}`,
      suggestion:
        "Fix the storyboard asset reference so it points inside the project, then rebuild assets.",
      retryWith: [
        `vibe storyboard validate ${projectDir} --json`,
        `vibe build ${projectDir}${retryBeat} --stage assets --json`,
      ],
    };
  }
  if (code === "MISSING_API_KEY") {
    return {
      code,
      message: `Asset provider credentials are missing${beatClause}: ${error}`,
      suggestion: "Configure the missing provider key, then rebuild assets.",
      retryWith: [
        "vibe setup --full",
        `vibe build ${projectDir}${retryBeat} --stage assets --json`,
      ],
    };
  }
  return {
    code,
    message: `Asset generation failed${beatClause}: ${error}`,
    suggestion:
      "Retry the assets stage; use --force if cached partial outputs should be regenerated.",
    retryWith: [`vibe build ${projectDir}${retryBeat} --stage assets --force --json`],
  };
}

function firstAssetFailure(
  outcomes: BeatBuildOutcome[]
): { beatId: string; kind: BuildAssetKind; error: string } | null {
  for (const outcome of outcomes) {
    for (const kind of ["narration", "backdrop", "video", "music"] as const) {
      const status = outcome[`${kind}Status`];
      const error = outcome[`${kind}Error`];
      if (status === "failed") {
        return {
          beatId: outcome.beatId,
          kind,
          error: typeof error === "string" && error.length > 0 ? error : `${kind} failed`,
        };
      }
    }
  }
  return null;
}

function classifyAssetFailure(error: string): string {
  if (/asset reference/i.test(error)) return "ASSET_REFERENCE_INVALID";
  if (/(api[_ -]?key|missing.*key|set .*key|no .*key|credentials?)/i.test(error)) {
    return "MISSING_API_KEY";
  }
  return "ASSET_GENERATION_FAILED";
}

async function runBuildSceneRepair(
  projectDir: string,
  stage: BuildSceneRepairStage,
  includeRoot: boolean
): Promise<BuildSceneRepairSummary> {
  const result = await executeSceneRepair({
    projectDir,
    includeRoot,
  });
  const retryWith = unique([
    ...result.retryWith,
    ...(result.status === "fail"
      ? [`vibe scene repair ${projectDir} --json`, `vibe scene lint --project ${projectDir} --json`]
      : []),
  ]);
  return {
    ran: true,
    stage,
    status: result.status,
    score: result.score,
    fixed: result.fixed,
    remainingIssues: result.remainingIssues,
    retryWith,
  };
}

function mergeSceneRepairSummaries(
  previous: BuildSceneRepairSummary,
  next: BuildSceneRepairSummary
): BuildSceneRepairSummary {
  return {
    ran: previous.ran || next.ran,
    stage: next.stage,
    status: next.status,
    score: next.score,
    fixed: [...previous.fixed, ...next.fixed],
    remainingIssues: next.remainingIssues,
    retryWith: unique([...previous.retryWith, ...next.retryWith]),
  };
}

function applySceneRepairToStage(report: StageReport, repair: BuildSceneRepairSummary): void {
  report.warnings.push(...sceneRepairWarnings(repair));
  report.retryWith = unique([...report.retryWith, ...repair.retryWith]);
}

function sceneRepairWarnings(repair: BuildSceneRepairSummary): string[] {
  if (!repair.ran || repair.status === "skipped" || repair.status === "pass") return [];
  const stage = repair.stage ?? "compose";
  const count = repair.remainingIssues.length;
  if (repair.status === "fail") {
    return [`Scene repair failed after ${stage} stage with ${count} remaining issue(s).`];
  }
  return [`Scene repair left ${count} warning/info issue(s) after ${stage} stage.`];
}

function unique(items: Array<string | undefined | null>): string[] {
  return [
    ...new Set(items.filter((item): item is string => typeof item === "string" && item.length > 0)),
  ];
}

function shouldRunStage(selected: BuildStage, stage: Exclude<BuildStage, "all">): boolean {
  if (selected === "all") return true;
  return selected === stage;
}

function estimateActualAssetCost(outcomes: BeatBuildOutcome[]): number {
  let cost = 0;
  for (const outcome of outcomes) {
    if (outcome.narrationStatus === "generated") cost += 0.05;
    if (outcome.backdropStatus === "generated") cost += 3;
    if (outcome.videoStatus === "generated" || outcome.videoStatus === "pending") cost += 5;
    if (outcome.musicStatus === "generated" || outcome.musicStatus === "pending") cost += 0.5;
  }
  return Number(cost.toFixed(2));
}

function collectExistingBeatOutcomes(beats: Beat[], projectDir: string): BeatBuildOutcome[] {
  return beats.map((beat) => {
    const narrationReference = assetReferenceForBeat(projectDir, "narration", beat);
    const backdropReference = assetReferenceForBeat(projectDir, "backdrop", beat);
    const videoReference = assetReferenceForBeat(projectDir, "video", beat);
    const musicReference = assetReferenceForBeat(projectDir, "music", beat);
    const narrationPath = firstExisting(projectDir, [
      `assets/narration-${beat.id}.mp3`,
      `assets/narration-${beat.id}.wav`,
    ]);
    const backdropPath = firstExisting(projectDir, [`assets/backdrop-${beat.id}.png`]);
    const videoPath = firstExisting(projectDir, [`assets/video-${beat.id}.mp4`]);
    const musicPath = firstExisting(projectDir, [
      `assets/music-${beat.id}.mp3`,
      `assets/music-${beat.id}.wav`,
    ]);
    const narrationReferencePath = isReadyAssetReference(narrationReference)
      ? narrationReference.relPath
      : null;
    const backdropReferencePath = isReadyAssetReference(backdropReference)
      ? backdropReference.relPath
      : null;
    const videoReferencePath = isReadyAssetReference(videoReference)
      ? videoReference.relPath
      : null;
    const musicReferencePath = isReadyAssetReference(musicReference)
      ? musicReference.relPath
      : null;
    return {
      beatId: beat.id,
      narrationStatus: narrationReference
        ? narrationReferencePath
          ? "referenced"
          : "failed"
        : narrationPath
          ? "cached"
          : beat.cues?.narration
            ? "skipped"
            : "no-cue",
      narrationPath: narrationReferencePath ?? narrationPath ?? undefined,
      narrationError:
        narrationReference && !narrationReferencePath ? narrationReference.error : undefined,
      narrationSourcePath: narrationReferencePath ?? undefined,
      narrationProvider: narrationReference ? "local" : undefined,
      narrationText: stringOrUndefined(beat.cues?.narration),
      narrationVoice: stringOrUndefined(beat.cues?.voice),
      sceneDurationSec: beat.duration,
      backdropStatus: backdropReference
        ? backdropReferencePath
          ? "referenced"
          : "failed"
        : backdropPath
          ? "cached"
          : beat.cues?.backdrop
            ? "skipped"
            : "no-cue",
      backdropPath: backdropReferencePath ?? backdropPath ?? undefined,
      backdropError:
        backdropReference && !backdropReferencePath ? backdropReference.error : undefined,
      backdropSourcePath: backdropReferencePath ?? undefined,
      backdropProvider: backdropReference ? "local" : undefined,
      backdropPrompt: stringOrUndefined(beat.cues?.backdrop),
      videoStatus: videoReference
        ? videoReferencePath
          ? "referenced"
          : "failed"
        : videoPath
          ? "cached"
          : beat.cues?.video
            ? "skipped"
            : "no-cue",
      videoPath: videoReferencePath ?? videoPath ?? undefined,
      videoError: videoReference && !videoReferencePath ? videoReference.error : undefined,
      videoSourcePath: videoReferencePath ?? undefined,
      videoProvider: videoReference ? "local" : undefined,
      videoPrompt: stringOrUndefined(beat.cues?.video),
      musicStatus: musicReference
        ? musicReferencePath
          ? "referenced"
          : "failed"
        : musicPath
          ? "cached"
          : beat.cues?.music
            ? "skipped"
            : "no-cue",
      musicPath: musicReferencePath ?? musicPath ?? undefined,
      musicError: musicReference && !musicReferencePath ? musicReference.error : undefined,
      musicSourcePath: musicReferencePath ?? undefined,
      musicProvider: musicReference ? "local" : undefined,
      musicPrompt: stringOrUndefined(beat.cues?.music),
    };
  });
}

function mergeBeatOutcomes(
  base: BeatBuildOutcome[],
  updates: BeatBuildOutcome[]
): BeatBuildOutcome[] {
  const byId = new Map(base.map((outcome) => [outcome.beatId, outcome]));
  for (const update of updates) {
    byId.set(update.beatId, { ...(byId.get(update.beatId) ?? {}), ...update });
  }
  return [...byId.values()];
}

function firstExisting(projectDir: string, relPaths: string[]): string | null {
  for (const rel of relPaths) {
    if (existsSync(join(projectDir, rel))) return rel;
  }
  return null;
}

async function safeAudioDuration(absPath: string): Promise<number | undefined> {
  try {
    return Number((await getAudioDuration(absPath)).toFixed(2));
  } catch {
    return undefined;
  }
}

function resolveBuildVideoProvider(value: unknown): BuildVideoProvider {
  const provider = String(value ?? "seedance").toLowerCase();
  if (provider === "fal") return "seedance";
  if (
    provider === "seedance" ||
    provider === "grok" ||
    provider === "kling" ||
    provider === "runway" ||
    provider === "veo"
  ) {
    return provider;
  }
  return "seedance";
}

function resolveBuildMusicProvider(value: unknown): BuildMusicProvider {
  const provider = String(value ?? "elevenlabs").toLowerCase();
  return provider === "replicate" ? "replicate" : "elevenlabs";
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

async function apiKeyForVideoProvider(
  provider: BuildVideoProvider,
  projectDir: string
): Promise<string | undefined> {
  const providerKey =
    provider === "seedance"
      ? "fal"
      : provider === "grok"
        ? "xai"
        : provider === "veo"
          ? "google"
          : provider;
  return getApiKeyFromConfig(providerKey, { cwd: projectDir });
}

async function finalizeBuildResult(
  projectDir: string,
  startedAt: number,
  result: SceneBuildResult
): Promise<SceneBuildResult> {
  const reportPath = join(projectDir, "build-report.json");
  if (result.stageReports) {
    for (const report of Object.values(result.stageReports)) {
      if (report.status === "pending") report.status = "skipped";
    }
  }
  const withMeta: SceneBuildResult = {
    ...result,
    status: result.status ?? buildWorkflowStatus(result),
    currentStage: result.currentStage ?? buildCurrentStage(result),
    beatSummary: result.beatSummary ?? summarizeBuildBeats(projectDir, result.beats),
    sceneRepair: result.sceneRepair ?? skippedSceneRepairSummary(),
    reportPath,
    totalLatencyMs: Date.now() - startedAt,
  };
  try {
    await writeFile(
      reportPath,
      JSON.stringify(toBuildReport(projectDir, withMeta), null, 2) + "\n",
      "utf-8"
    );
  } catch {
    // Report writing should not hide the underlying build result.
  }
  return withMeta;
}

export type BuildReport = ReturnType<typeof toBuildReport>;

function toBuildReport(projectDir: string, result: SceneBuildResult) {
  let beatCursor = 0;
  return {
    schemaVersion: "1",
    kind: "build",
    project: projectDir,
    phase: result.phase,
    status: result.status ?? buildWorkflowStatus(result),
    currentStage: result.currentStage ?? buildCurrentStage(result),
    mode: result.mode,
    selectedStage: result.selectedStage ?? "all",
    success: result.success,
    code: result.code,
    error: result.error,
    message: result.message,
    suggestion: result.suggestion,
    recoverable: result.recoverable,
    validation: result.validation,
    providerResolution: result.providerResolution ?? [],
    estimatedCostUsd: result.estimatedCostUsd ?? 0,
    costUsd: result.costUsd ?? 0,
    beats: result.beats.map((beat) => {
      const composition = buildReportComposition(projectDir, result, beat.beatId);
      const sceneDurationSec = normalizeReportDuration(beat.sceneDurationSec);
      const startSec = Number(beatCursor.toFixed(3));
      const endSec = Number((beatCursor + sceneDurationSec).toFixed(3));
      beatCursor = endSec;
      return {
        id: beat.beatId,
        startSec,
        endSec,
        sceneDurationSec,
        narration: {
          text: beat.narrationText,
          voice: beat.narrationVoice,
          provider: beat.narrationProvider,
          path: beat.narrationPath,
          sourcePath: beat.narrationSourcePath,
          durationSec: beat.narrationDurationSec,
          sceneDurationSec,
          status: beat.narrationStatus,
          error: beat.narrationError,
          cachePath: beat.narrationCachePath,
          cacheKey: beat.narrationCacheKey,
          metadataPath: beat.narrationMetadataPath,
          freshness: beat.narrationFreshness,
        },
        backdrop: {
          prompt: beat.backdropPrompt,
          provider: beat.backdropProvider,
          path: beat.backdropPath,
          sourcePath: beat.backdropSourcePath,
          status: beat.backdropStatus,
          error: beat.backdropError,
          cachePath: beat.backdropCachePath,
          cacheKey: beat.backdropCacheKey,
          metadataPath: beat.backdropMetadataPath,
          freshness: beat.backdropFreshness,
        },
        video: {
          prompt: beat.videoPrompt,
          provider: beat.videoProvider,
          path: beat.videoPath,
          sourcePath: beat.videoSourcePath,
          status: beat.videoStatus,
          jobId: beat.videoJobId,
          error: beat.videoError,
          cachePath: beat.videoCachePath,
          cacheKey: beat.videoCacheKey,
          metadataPath: beat.videoMetadataPath,
          freshness: beat.videoFreshness,
        },
        music: {
          prompt: beat.musicPrompt,
          provider: beat.musicProvider,
          path: beat.musicPath,
          sourcePath: beat.musicSourcePath,
          durationSec: beat.musicDurationSec,
          status: beat.musicStatus,
          jobId: beat.musicJobId,
          error: beat.musicError,
          cachePath: beat.musicCachePath,
          cacheKey: beat.musicCacheKey,
          metadataPath: beat.musicMetadataPath,
          freshness: beat.musicFreshness,
        },
        composition,
        narrationPath: beat.narrationPath,
        narrationDurationSec: beat.narrationDurationSec,
        backdropPath: beat.backdropPath,
        videoPath: beat.videoPath,
        musicPath: beat.musicPath,
        compositionPath: composition.path,
        narrationStatus: beat.narrationStatus,
        backdropStatus: beat.backdropStatus,
        videoStatus: beat.videoStatus,
        videoJobId: beat.videoJobId,
        musicStatus: beat.musicStatus,
        musicJobId: beat.musicJobId,
        narrationError: beat.narrationError,
        backdropError: beat.backdropError,
        videoError: beat.videoError,
        musicError: beat.musicError,
      };
    }),
    beatSummary: result.beatSummary ?? summarizeBuildBeats(projectDir, result.beats),
    jobs: (result.jobs ?? []).map((job) => ({
      id: job.id,
      jobType: job.jobType,
      status: job.status,
      provider: job.provider,
      providerTaskId: job.providerTaskId,
      providerTaskType: job.providerTaskType,
      beatId: job.beatId,
      outputPath: job.outputPath,
      cachePath: job.cachePath,
      cacheKey: job.cacheKey,
      canonicalPath: job.canonicalPath,
      metadataPath: job.metadataPath,
      retryWith: job.retryWith,
    })),
    outputPath: result.outputPath,
    sceneRepair: result.sceneRepair ?? skippedSceneRepairSummary(),
    stageReports: result.stageReports,
    warnings: result.warnings ?? [],
    retryWith: result.retryWith ?? [],
    totalLatencyMs: result.totalLatencyMs,
  };
}

function normalizeReportDuration(value: number | undefined): number {
  return Number((value ?? 0).toFixed(3));
}

type ComposeWrittenEntry = NonNullable<ComposeScenesActionResult["data"]>["written"][number];
type BuildReportCompositionStatus =
  | "generated"
  | "cached"
  | "exists"
  | "needs-author"
  | "skipped"
  | "failed";

function buildReportComposition(
  projectDir: string,
  result: SceneBuildResult,
  beatId: string
): {
  path: string;
  exists: boolean;
  status: BuildReportCompositionStatus;
  cacheKey?: string;
} {
  const path = `compositions/scene-${beatId}.html`;
  const exists = existsSync(join(projectDir, path));
  const written = composeWrittenEntry(result, beatId);
  if (written) {
    return {
      path,
      exists,
      status: written.cached ? "cached" : "generated",
      cacheKey: written.cacheKey,
    };
  }
  if (result.stageReports?.compose.status === "failed") return { path, exists, status: "failed" };
  if (result.phase === "needs-author" && !exists) return { path, exists, status: "needs-author" };
  if (exists) return { path, exists, status: "exists" };
  if (result.stageReports?.compose.status === "skipped") return { path, exists, status: "skipped" };
  return { path, exists, status: "needs-author" };
}

function composeWrittenEntry(
  result: SceneBuildResult,
  beatId: string
): ComposeWrittenEntry | undefined {
  return result.composeData?.written.find((entry) => entry.beatId === beatId);
}

function buildWorkflowStatus(result: SceneBuildResult): BuildWorkflowStatus {
  if (!result.success || result.phase === "failed") return "failed";
  if (result.phase === "pending-jobs") return "running";
  if (result.phase === "needs-author") return "needs-author";
  if (result.phase === "done") return "done";
  return "ready";
}

function buildCurrentStage(result: SceneBuildResult): BuildCurrentStage {
  const reports = result.stageReports;
  if (reports?.assets.status === "pending-jobs" || reports?.assets.status === "failed")
    return "assets";
  if (reports?.compose.status === "needs-author" || reports?.compose.status === "failed")
    return "compose";
  if (reports?.sync.status === "failed") return "sync";
  if (reports?.render.status === "failed") return "render";

  switch (result.phase) {
    case "pending-jobs":
      return "assets";
    case "assets-only":
    case "needs-author":
      return "compose";
    case "compose-only":
      return "sync";
    case "sync-only":
      return "render";
    case "done":
    case "render-only":
      return "done";
    case "failed":
      return result.selectedStage && result.selectedStage !== "all"
        ? result.selectedStage
        : "assets";
  }
}

function summarizeBuildBeats(projectDir: string, beats: BeatBuildOutcome[]): BuildBeatSummary {
  const needsAuthor: string[] = [];
  let assetsReady = 0;
  let compositionsReady = 0;

  for (const beat of beats) {
    if (beatAssetsReady(beat)) assetsReady += 1;
    const compositionPath = join(projectDir, "compositions", `scene-${beat.beatId}.html`);
    if (existsSync(compositionPath)) {
      compositionsReady += 1;
    } else {
      needsAuthor.push(beat.beatId);
    }
  }

  return {
    total: beats.length,
    assetsReady,
    compositionsReady,
    needsAuthor,
  };
}

function beatAssetsReady(beat: BeatBuildOutcome): boolean {
  return [beat.narrationStatus, beat.backdropStatus, beat.videoStatus, beat.musicStatus].every(
    (status) => status !== "pending" && status !== "failed"
  );
}

function rootSyncBeatsFromOutcomes(
  beats: Beat[],
  outcomes: BeatBuildOutcome[]
): RootSyncBeatInput[] {
  return beats.map((beat) => {
    const outcome = outcomes.find((item) => item.beatId === beat.id);
    return {
      id: beat.id,
      duration: beat.duration,
      narrationPath: outcome?.narrationPath,
      musicPath: outcome?.musicPath,
      sceneDurationSec:
        outcome?.narrationDurationSec !== undefined || outcome?.sceneDurationSec !== beat.duration
          ? outcome?.sceneDurationSec
          : undefined,
    };
  });
}

/**
 * Decide which build mode to actually run. `auto` (default) prefers
 * `agent` whenever an agent host is detected — assumption: if the user
 * has Claude Code / Cursor / Codex / Aider installed, they're driving
 * VibeFrame from there and want the agent to do reasoning. Falls back to
 * `batch` for headless / CI contexts where no agent host is reachable.
 *
 * `VIBE_BUILD_MODE` env var overrides everything (`agent` or `batch`).
 * Useful for CI that has Claude installed but wants the deterministic
 * batch path, or for an agent that wants to force batch for benchmarking.
 */
export function resolveSceneBuildMode(opts: { mode?: SceneBuildMode }): "agent" | "batch" {
  const envOverride = process.env.VIBE_BUILD_MODE?.toLowerCase();
  if (envOverride === "agent" || envOverride === "batch") return envOverride;

  const requested = opts.mode ?? "auto";
  if (requested === "agent") return "agent";
  if (requested === "batch") return "batch";

  // auto — pick agent when any host is present, batch otherwise.
  return detectedAgentHosts().length > 0 ? "agent" : "batch";
}

async function resolveBeatDuration(opts: {
  beatDuration?: number;
  narrationPath?: string;
  projectDir: string;
}): Promise<number> {
  const storyboardMin = opts.beatDuration ?? 3;
  if (!opts.narrationPath) return Number(storyboardMin.toFixed(2));

  try {
    const audioDuration = await getAudioDuration(join(opts.projectDir, opts.narrationPath));
    return Number(Math.max(storyboardMin, audioDuration + 0.5).toFixed(2));
  } catch {
    return Number(storyboardMin.toFixed(2));
  }
}
