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

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { config as loadDotenv } from "dotenv";
import { OpenAIImageProvider, type ImageOptions } from "@vibeframe/ai-providers";

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
import { executeVideoGenerate } from "../ai-video.js";
import { executeMusic } from "../generate/music.js";
import { createAndWriteJobRecord, type JobRecord } from "./status-jobs.js";
import { executeSceneRepair, type SceneRepairResult } from "./scene-repair.js";
import { resolveTtsProvider, TtsKeyMissingError, type TtsProviderName } from "./tts-resolve.js";

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

export type PrimitiveStatus = "generated" | "cached" | "pending" | "skipped" | "failed" | "no-cue";

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
  backdropStatus: PrimitiveStatus;
  backdropPath?: string;
  backdropError?: string;
  backdropPrompt?: string;
  backdropProvider?: string;
  backdropCachePath?: string;
  videoStatus: PrimitiveStatus;
  videoPath?: string;
  videoJobId?: string;
  videoError?: string;
  videoPrompt?: string;
  videoProvider?: string;
  videoCachePath?: string;
  musicStatus: PrimitiveStatus;
  musicPath?: string;
  musicJobId?: string;
  musicError?: string;
  musicPrompt?: string;
  musicProvider?: string;
  musicCachePath?: string;
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
  /** Override frontmatter providers.image. Currently only "openai" supported. */
  imageProvider?: "openai";
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
    videoProvider: opts.videoProvider,
    musicProvider: opts.musicProvider,
    force: opts.force,
  });
  warnings.push(...buildPlan.warnings);
  retryWith.push(...buildPlan.retryWith);
  if (!buildPlan.validation.ok) {
    let invalidBeats: Beat[] = [];
    if (existsSync(storyboardPath)) {
      invalidBeats = parseStoryboard(await readFile(storyboardPath, "utf-8")).beats;
    }
    return finalizeBuildResult(projectDir, startedAt, {
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
    return failBeforePrimitives(
      `STORYBOARD.md not found at ${storyboardPath}. Run \`vibe scene init <dir>\` to create a starter, or add STORYBOARD.md with per-beat cues.`,
      startedAt
    );
  }
  const storyboardMd = await readFile(storyboardPath, "utf-8");
  const parsed = parseStoryboard(storyboardMd);
  if (parsed.beats.length === 0) {
    return failBeforePrimitives(
      `STORYBOARD.md at ${storyboardPath} has no \`## Beat …\` headings.`,
      startedAt
    );
  }
  const selectedBeat = opts.beatId
    ? parsed.beats.find((beat) => beat.id === opts.beatId)
    : undefined;
  if (opts.beatId && !selectedBeat) {
    return finalizeBuildResult(projectDir, startedAt, {
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
    return finalizeBuildResult(projectDir, startedAt, {
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
    (parsed.frontmatter?.providers?.tts as TtsProviderName | undefined) ??
    "auto";
  const imageProvider = (opts.imageProvider ??
    parsed.frontmatter?.providers?.image ??
    "openai") as "openai";
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
    return finalizeBuildResult(projectDir, startedAt, {
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

  if (selectedStage === "assets") {
    return finalizeBuildResult(projectDir, startedAt, {
      success: stageReports.assets.status !== "failed",
      phase: stageReports.assets.status === "failed" ? "failed" : "assets-only",
      mode,
      selectedStage,
      error: stageReports.assets.status === "failed" ? "asset generation failed" : undefined,
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
        return finalizeBuildResult(projectDir, startedAt, {
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
        return finalizeBuildResult(projectDir, startedAt, {
          success: false,
          phase: "failed",
          mode,
          selectedStage,
          error: `compose failed: ${composeResult.error ?? "unknown"}`,
          beats: beatOutcomes,
          composeData: composeResult.data,
          estimatedCostUsd: buildPlan.estimatedCostUsd,
          costUsd: stageReports.assets.costUsd,
          stageReports,
          warnings,
          retryWith,
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
      return finalizeBuildResult(projectDir, startedAt, {
        success: false,
        phase: "failed",
        mode,
        selectedStage,
        code: "SCENE_REPAIR_FAILED",
        error: "Scene repair failed after compose stage.",
        message: "Scene repair failed after compose stage.",
        suggestion:
          "Run `vibe scene repair --project <project> --json`, then edit remaining scene HTML findings.",
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
    return finalizeBuildResult(projectDir, startedAt, {
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
    await syncRootClipReferences(parsed.beats, projectDir, allOutcomes);
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
      return finalizeBuildResult(projectDir, startedAt, {
        success: false,
        phase: "failed",
        mode,
        selectedStage,
        code: "SCENE_REPAIR_FAILED",
        error: "Scene repair failed after sync stage.",
        message: "Scene repair failed after sync stage.",
        suggestion:
          "Run `vibe scene repair --project <project> --json`, then edit remaining scene HTML findings.",
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
    return finalizeBuildResult(projectDir, startedAt, {
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
      return finalizeBuildResult(projectDir, startedAt, {
        success: false,
        phase: "failed",
        mode,
        selectedStage,
        error: `render failed: ${renderResult.error ?? "unknown"}`,
        beats: beatOutcomes,
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
    outputPath = renderResult.outputPath;
    if (outputPath) onProgress({ type: "render-done", outputPath });
    stageReports.render.status = "done";
  } else {
    stageReports.render.status = "skipped";
  }

  return finalizeBuildResult(projectDir, startedAt, {
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
  imageProvider: "openai";
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
      backdropStatus: backdrop.status,
      backdropPath: backdrop.path,
      backdropError: backdrop.error,
      backdropPrompt: stringOrUndefined(beat.cues?.backdrop),
      backdropProvider: backdrop.provider,
      backdropCachePath: backdrop.cachePath,
      videoStatus: video.status,
      videoPath: video.path,
      videoJobId: video.job?.id,
      videoError: video.error,
      videoPrompt: stringOrUndefined(beat.cues?.video),
      videoProvider: video.provider,
      videoCachePath: video.cachePath,
      musicStatus: music.status,
      musicPath: music.path,
      musicJobId: music.job?.id,
      musicError: music.error,
      musicPrompt: stringOrUndefined(beat.cues?.music),
      musicProvider: music.provider,
      musicCachePath: music.cachePath,
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
}

async function dispatchNarration(beat: Beat, ctx: BeatDispatchContext): Promise<PrimitiveOutcome> {
  const text = beat.cues?.narration;
  if (!text) return { status: "no-cue" };

  // Idempotent check: any existing narration audio for this beat (mp3 or wav).
  for (const ext of ["mp3", "wav"] as const) {
    const rel = `assets/narration-${beat.id}.${ext}`;
    if (existsSync(join(ctx.projectDir, rel)) && !ctx.force) {
      ctx.onProgress({ type: "narration-cached", beatId: beat.id, path: rel });
      return {
        status: "cached",
        path: rel,
        durationSec: await safeAudioDuration(join(ctx.projectDir, rel)),
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

  const cacheRel = cacheAssetRel("narration", {
    beatId: beat.id,
    cue: text,
    provider: resolution.provider,
    voice: ctx.voice ?? beat.cues?.voice,
    ext: resolution.audioExtension,
  });
  const cacheAbs = join(ctx.projectDir, cacheRel);
  const rel = `assets/narration-${beat.id}.${resolution.audioExtension}`;
  const abs = join(ctx.projectDir, rel);
  if (existsSync(cacheAbs) && !ctx.force) {
    await mkdir(dirname(abs), { recursive: true });
    await copyFile(cacheAbs, abs);
    ctx.onProgress({ type: "narration-cached", beatId: beat.id, path: rel });
    return {
      status: "cached",
      path: rel,
      durationSec: await safeAudioDuration(abs),
      provider: resolution.provider,
      cachePath: cacheRel,
    };
  }

  const result = await resolution.call(text, { voice: ctx.voice });
  if (!result.success || !result.audioBuffer) {
    const error = result.error ?? "unknown TTS failure";
    ctx.onProgress({ type: "narration-failed", beatId: beat.id, error });
    return { status: "failed", error };
  }

  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, result.audioBuffer);
  await mkdir(dirname(cacheAbs), { recursive: true });
  await writeFile(cacheAbs, result.audioBuffer);
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
    cachePath: cacheRel,
  };
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
    return { status: "cached", path: rel, provider: ctx.imageProvider };
  }
  const cacheRel = cacheAssetRel("backdrop", {
    beatId: beat.id,
    cue: prompt,
    provider: ctx.imageProvider,
    quality: ctx.imageQuality,
    size: ctx.imageSize,
    ext: "png",
  });
  const cacheAbs = join(ctx.projectDir, cacheRel);
  if (existsSync(cacheAbs) && !ctx.force) {
    await mkdir(dirname(abs), { recursive: true });
    await copyFile(cacheAbs, abs);
    ctx.onProgress({ type: "backdrop-cached", beatId: beat.id, path: rel });
    return { status: "cached", path: rel, provider: ctx.imageProvider, cachePath: cacheRel };
  }

  loadSceneBuildEnv(ctx.projectDir);
  const apiKey =
    (await getApiKeyFromConfig("openai", { cwd: ctx.projectDir })) ??
    process.env.OPENAI_API_KEY ??
    "";
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
  const buffer = Buffer.from(result.images[0].base64, "base64");
  await writeFile(abs, buffer);
  await mkdir(dirname(cacheAbs), { recursive: true });
  await writeFile(cacheAbs, buffer);
  ctx.onProgress({
    type: "backdrop-generated",
    beatId: beat.id,
    path: rel,
    provider: "openai",
  });
  return { status: "generated", path: rel, provider: "openai", cachePath: cacheRel };
}

async function dispatchVideo(beat: Beat, ctx: BeatDispatchContext): Promise<PrimitiveOutcome> {
  const prompt = stringOrUndefined(beat.cues?.video);
  if (!prompt) return { status: "no-cue" };

  const rel = `assets/video-${beat.id}.mp4`;
  const abs = join(ctx.projectDir, rel);
  if (existsSync(abs) && !ctx.force) {
    ctx.onProgress({ type: "video-cached", beatId: beat.id, path: rel });
    return { status: "cached", path: rel, provider: ctx.videoProvider };
  }

  const cacheRel = cacheAssetRel("video", {
    beatId: beat.id,
    cue: prompt,
    provider: ctx.videoProvider,
    duration: normalizeVideoDuration(beat.duration),
    ratio: "16:9",
    ext: "mp4",
  });
  const cacheAbs = join(ctx.projectDir, cacheRel);
  if (existsSync(cacheAbs) && !ctx.force) {
    await mkdir(dirname(abs), { recursive: true });
    await copyFile(cacheAbs, abs);
    ctx.onProgress({ type: "video-cached", beatId: beat.id, path: rel });
    return { status: "cached", path: rel, provider: ctx.videoProvider, cachePath: cacheRel };
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
      cachePath: cacheRel,
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
  });
  ctx.onProgress({ type: "video-pending", beatId: beat.id, jobId: job.id, provider: job.provider });
  return { status: "pending", path: rel, job, provider: job.provider, cachePath: cacheRel };
}

async function dispatchMusic(beat: Beat, ctx: BeatDispatchContext): Promise<PrimitiveOutcome> {
  const prompt = stringOrUndefined(beat.cues?.music);
  if (!prompt) return { status: "no-cue" };

  const rel = `assets/music-${beat.id}.mp3`;
  const abs = join(ctx.projectDir, rel);
  if (existsSync(abs) && !ctx.force) {
    ctx.onProgress({ type: "music-cached", beatId: beat.id, path: rel });
    return { status: "cached", path: rel, provider: ctx.musicProvider };
  }

  const duration = normalizeMusicDuration(beat.duration);
  const cacheRel = cacheAssetRel("music", {
    beatId: beat.id,
    cue: prompt,
    provider: ctx.musicProvider,
    duration,
    ext: "mp3",
  });
  const cacheAbs = join(ctx.projectDir, cacheRel);
  if (existsSync(cacheAbs) && !ctx.force) {
    await mkdir(dirname(abs), { recursive: true });
    await copyFile(cacheAbs, abs);
    ctx.onProgress({ type: "music-cached", beatId: beat.id, path: rel });
    return { status: "cached", path: rel, provider: ctx.musicProvider, cachePath: cacheRel };
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
    });
    ctx.onProgress({
      type: "music-pending",
      beatId: beat.id,
      jobId: job.id,
      provider: job.provider,
    });
    return { status: "pending", path: rel, job, provider: job.provider, cachePath: cacheRel };
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
    cachePath: cacheRel,
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

function failBeforePrimitives(error: string, startedAt: number): SceneBuildResult {
  return {
    success: false,
    phase: "failed",
    mode: "batch",
    error,
    beats: [],
    totalLatencyMs: Date.now() - startedAt,
  };
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
      ? [
          `vibe scene repair --project ${projectDir} --json`,
          `vibe scene lint --project ${projectDir} --json`,
        ]
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
    return {
      beatId: beat.id,
      narrationStatus: narrationPath ? "cached" : beat.cues?.narration ? "skipped" : "no-cue",
      narrationPath: narrationPath ?? undefined,
      narrationText: stringOrUndefined(beat.cues?.narration),
      narrationVoice: stringOrUndefined(beat.cues?.voice),
      sceneDurationSec: beat.duration,
      backdropStatus: backdropPath ? "cached" : beat.cues?.backdrop ? "skipped" : "no-cue",
      backdropPath: backdropPath ?? undefined,
      backdropPrompt: stringOrUndefined(beat.cues?.backdrop),
      videoStatus: videoPath ? "cached" : beat.cues?.video ? "skipped" : "no-cue",
      videoPath: videoPath ?? undefined,
      videoPrompt: stringOrUndefined(beat.cues?.video),
      musicStatus: musicPath ? "cached" : beat.cues?.music ? "skipped" : "no-cue",
      musicPath: musicPath ?? undefined,
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

function cacheAssetRel(kind: string, parts: Record<string, unknown>): string {
  const ext = String(parts.ext ?? "bin");
  const key = createHash("sha256")
    .update(JSON.stringify({ kind, ...parts }))
    .digest("hex");
  return `.vibeframe/cache/assets/${kind}-${key}.${ext}`;
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

function normalizeVideoDuration(duration: number | undefined): number {
  if (!duration || !Number.isFinite(duration)) return 5;
  return Math.max(1, Math.min(15, Math.round(duration)));
}

function normalizeMusicDuration(duration: number | undefined): number {
  if (!duration || !Number.isFinite(duration)) return 8;
  return Math.max(1, Math.min(600, Math.round(duration)));
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

function toBuildReport(projectDir: string, result: SceneBuildResult): Record<string, unknown> {
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
    estimatedCostUsd: result.estimatedCostUsd ?? 0,
    costUsd: result.costUsd ?? 0,
    beats: result.beats.map((beat) => ({
      id: beat.beatId,
      narration: {
        text: beat.narrationText,
        voice: beat.narrationVoice,
        provider: beat.narrationProvider,
        path: beat.narrationPath,
        durationSec: beat.narrationDurationSec,
        sceneDurationSec: beat.sceneDurationSec,
        status: beat.narrationStatus,
        error: beat.narrationError,
        cachePath: beat.narrationCachePath,
      },
      backdrop: {
        prompt: beat.backdropPrompt,
        provider: beat.backdropProvider,
        path: beat.backdropPath,
        status: beat.backdropStatus,
        error: beat.backdropError,
        cachePath: beat.backdropCachePath,
      },
      video: {
        prompt: beat.videoPrompt,
        provider: beat.videoProvider,
        path: beat.videoPath,
        status: beat.videoStatus,
        jobId: beat.videoJobId,
        error: beat.videoError,
        cachePath: beat.videoCachePath,
      },
      music: {
        prompt: beat.musicPrompt,
        provider: beat.musicProvider,
        path: beat.musicPath,
        durationSec: beat.musicDurationSec,
        status: beat.musicStatus,
        jobId: beat.musicJobId,
        error: beat.musicError,
        cachePath: beat.musicCachePath,
      },
      narrationPath: beat.narrationPath,
      narrationDurationSec: beat.narrationDurationSec,
      sceneDurationSec: beat.sceneDurationSec,
      backdropPath: beat.backdropPath,
      videoPath: beat.videoPath,
      musicPath: beat.musicPath,
      compositionPath: `compositions/scene-${beat.beatId}.html`,
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
    })),
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

// ── Root index.html sync ────────────────────────────────────────────────

/**
 * Insert / replace `<div class="clip" data-composition-src=...>` tags in
 * the project's `index.html` so the root composition references the
 * scene HTML compose-scenes-with-skills just wrote.
 *
 * Why this is needed: `vibe scene init` scaffolds an `index.html` with
 * placeholder comments but no clip refs. `compose-scenes-with-skills`
 * writes per-beat HTML to `compositions/scene-<id>.html` but doesn't
 * touch the root. Without explicit refs, the Hyperframes producer
 * walks an empty `<div id="root">` and renders a 9-second black video.
 *
 * The sync is idempotent: it scans for the existing block and replaces
 * it wholesale. Project authors who hand-curate `index.html` should add
 * the marker comments below to keep `vibe scene build` from clobbering
 * unrelated content.
 *
 * No-op when `index.html` doesn't exist (caller hasn't run `scene init`).
 */
async function syncRootClipReferences(
  beats: Beat[],
  projectDir: string,
  outcomes: BeatBuildOutcome[]
): Promise<void> {
  const rootPath = join(projectDir, "index.html");
  if (!existsSync(rootPath)) return;

  const html = await readFile(rootPath, "utf-8");

  // Compute beat start times sequentially. Storyboard durations are minimums:
  // generated narration that runs longer extends the beat so speech does not
  // feel abruptly cut off at scene boundaries.
  let cursor = 0;
  const clipLines: string[] = [];
  const audioLines: string[] = [];
  for (const beat of beats) {
    const outcome = outcomes.find((o) => o.beatId === beat.id);
    const duration = await resolveBeatDuration({
      beatDuration: beat.duration,
      narrationPath: outcome?.narrationPath,
      projectDir,
    });
    const compositionId = `scene-${beat.id}`;
    clipLines.push(
      `      <div class="clip" data-composition-id="${compositionId}" data-composition-src="compositions/${compositionId}.html" data-start="${cursor}" data-duration="${duration}" data-track-index="0"></div>`
    );
    // If the dispatcher produced a narration audio file, wire it into the
    // root with absolute timing. Sub-composition `<audio>` elements aren't
    // muxed by the producer; root-level ones are.
    if (outcome?.narrationPath) {
      audioLines.push(
        `      <audio id="narration-${beat.id}" src="${outcome.narrationPath}" data-start="${cursor}" data-duration="${duration}" data-track-index="2"></audio>`
      );
    }
    cursor += duration;
  }

  const totalDuration = Number(cursor.toFixed(2));
  const block =
    "      <!-- vibe-scene-build: clip refs (auto-generated; safe to re-run) -->\n" +
    clipLines.join("\n") +
    (audioLines.length > 0 ? "\n" + audioLines.join("\n") : "") +
    "\n      <!-- /vibe-scene-build -->";

  let next: string;
  const markerRe = /\n? *<!-- vibe-scene-build: clip refs.*?<!-- \/vibe-scene-build -->/s;
  if (markerRe.test(html)) {
    // Replace previous block in place — idempotent re-runs.
    next = html.replace(markerRe, "\n" + block);
  } else {
    // First run: drop the block before the closing `</div>` of `id="root"`.
    // Falls back to inserting before `</body>` if the root structure isn't
    // recognisable — better than failing silently.
    const rootCloseRe = /(\n\s*<\/div>\s*\n\s*<script[^>]*>[\s\S]*window\.__timelines)/;
    if (rootCloseRe.test(html)) {
      next = html.replace(rootCloseRe, `\n${block}\n    $1`);
    } else {
      next = html.replace(/<\/body>/, `${block}\n  </body>`);
    }
  }

  // Update the root data-duration to match the new total. Pure regex —
  // we don't pull in a full HTML parser for one attribute.
  next = next.replace(/(id="root"[\s\S]*?data-duration=")([^"]*)(")/, `$1${totalDuration}$3`);

  if (next !== html) {
    await writeFile(rootPath, next, "utf-8");
  }
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
