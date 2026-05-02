import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { resolve, join } from "node:path";
import { readFileSync, existsSync } from "node:fs";

import {
  executeSceneBuild,
  type SceneBuildMode,
  type SceneBuildProgressEvent,
  type SceneBuildResult,
  type BuildMusicProvider,
  type BuildVideoProvider,
} from "./_shared/scene-build.js";
import { createBuildPlan, type BuildPlanResult, type BuildStage } from "./_shared/build-plan.js";
import { parseStoryboard } from "./_shared/storyboard-parse.js";
import { exitWithError, generalError, isJsonMode, isQuietMode, outputSuccess, usageError } from "./output.js";

const VALID_MODES: SceneBuildMode[] = ["agent", "batch", "auto"];
const VALID_STAGES: BuildStage[] = ["assets", "compose", "sync", "render", "all"];
const VALID_VIDEO_PROVIDERS: BuildVideoProvider[] = ["seedance", "grok", "kling", "runway", "veo"];
const VALID_MUSIC_PROVIDERS: BuildMusicProvider[] = ["elevenlabs", "replicate"];

export const buildCommand = new Command("build")
  .description("Build a VibeFrame video project from STORYBOARD.md")
  .argument("[project-dir]", "Video project directory", ".")
  .option("--stage <stage>", `Build stage: ${VALID_STAGES.join("|")}`, "all")
  .option("--beat <id>", "Restrict asset/compose work to one beat id")
  .option("--mode <mode>", "Build mode: agent|batch|auto", "auto")
  .option("--effort <level>", "Compose effort tier (batch mode only): low|medium|high", "medium")
  .option("--composer <provider>", "Batch composer: claude|openai|gemini")
  .option("--max-cost <usd>", "Fail before provider spend when estimated cost exceeds this USD cap")
  .option("--skip-narration", "Don't dispatch TTS even when beats declare narration cues")
  .option("--skip-backdrop", "Don't dispatch image-gen even when beats declare backdrop cues")
  .option("--skip-video", "Don't dispatch video generation even when beats declare video cues")
  .option("--skip-music", "Don't dispatch music generation even when beats declare music cues")
  .option("--skip-render", "Compose only — don't render to MP4")
  .option("--tts <provider>", "TTS provider: auto|elevenlabs|kokoro")
  .option("--voice <id>", "Voice id")
  .option("--image-provider <name>", "Image provider: openai")
  .option("--video-provider <name>", `Video provider: ${VALID_VIDEO_PROVIDERS.join("|")}`)
  .option("--music-provider <name>", `Music provider: ${VALID_MUSIC_PROVIDERS.join("|")}`)
  .option("--quality <q>", "Image quality: standard|hd", "hd")
  .option("--image-size <s>", "Image size: 1024x1024|1536x1024|1024x1536", "1536x1024")
  .option("--force", "Re-dispatch primitives even when assets already exist")
  .option("--dry-run", "Preview parameters without dispatching")
  .addHelpText("after", `
Examples:
  $ vibe init my-video --profile agent
  $ vibe build my-video --mode agent --tts kokoro
  $ vibe build my-video --skip-render

Advanced equivalent: \`vibe scene build\`.`)
  .action(async (projectDirArg: string, options) => {
    const startedAt = Date.now();
    const projectDir = resolve(projectDirArg);
    const mode = String(options.mode ?? "auto") as SceneBuildMode;
    if (!VALID_MODES.includes(mode)) {
      exitWithError(usageError(`Invalid --mode: ${mode}`, `Must be one of: ${VALID_MODES.join(", ")}`));
    }
    const stage = String(options.stage ?? "all") as BuildStage;
    if (!VALID_STAGES.includes(stage)) {
      exitWithError(usageError(`Invalid --stage: ${stage}`, `Must be one of: ${VALID_STAGES.join(", ")}`));
    }
    const maxCostUsd = options.maxCost !== undefined ? Number.parseFloat(String(options.maxCost)) : undefined;
    if (maxCostUsd !== undefined && (!Number.isFinite(maxCostUsd) || maxCostUsd < 0)) {
      exitWithError(usageError(`Invalid --max-cost: ${String(options.maxCost)}`, "Must be a non-negative USD amount."));
    }
    const videoProvider = parseOptionalProvider(options.videoProvider, VALID_VIDEO_PROVIDERS, "video") as BuildVideoProvider | undefined;
    const musicProvider = parseOptionalProvider(options.musicProvider, VALID_MUSIC_PROVIDERS, "music") as BuildMusicProvider | undefined;

    const params = {
      projectDir,
      stage,
      beatId: options.beat,
      mode,
      effort: options.effort,
      composer: options.composer,
      maxCostUsd,
      skipNarration: options.skipNarration ?? false,
      skipBackdrop: options.skipBackdrop ?? false,
      skipVideo: options.skipVideo ?? false,
      skipMusic: options.skipMusic ?? false,
      skipRender: options.skipRender ?? false,
      ttsProvider: options.tts,
      voice: options.voice,
      imageProvider: options.imageProvider,
      videoProvider,
      musicProvider,
      imageQuality: options.quality,
      imageSize: options.imageSize,
      force: options.force ?? false,
    };

    if (options.dryRun) {
      const plan = await createBuildPlan({
        projectDir,
        stage,
        beat: options.beat,
        mode,
        skipNarration: options.skipNarration,
        skipBackdrop: options.skipBackdrop,
        skipVideo: options.skipVideo,
        skipMusic: options.skipMusic,
        videoProvider,
        musicProvider,
        force: options.force,
      });
      if (!plan.validation.ok) {
        const data = {
          params,
          plan,
          ...buildPlanValidationFailureData(plan),
        };
        if (isJsonMode() || isQuietMode()) {
          outputSuccess({
            command: "build",
            startedAt,
            dryRun: true,
            warnings: plan.warnings,
            data,
          });
          process.exitCode = 1;
          return;
        }
        printBuildDryRun(projectDirArg, params, plan);
        process.exitCode = 1;
        return;
      }
      if (maxCostUsd !== undefined && plan.estimatedCostUsd > maxCostUsd) {
        const warning = `Estimated cost $${plan.estimatedCostUsd.toFixed(2)} exceeds --max-cost $${maxCostUsd.toFixed(2)}.`;
        if (isJsonMode() || isQuietMode()) {
          const retryWith = [
            `vibe build ${projectDirArg} --stage ${stage} --skip-backdrop --json`,
            `vibe build ${projectDirArg} --stage ${stage} --max-cost ${plan.estimatedCostUsd} --json`,
          ];
          outputSuccess({
            command: "build",
            startedAt,
            dryRun: true,
            warnings: [warning],
            data: {
              params,
              plan,
              costCapUsd: maxCostUsd,
              code: "COST_CAP_EXCEEDED",
              message: warning,
              suggestion: "Raise --max-cost or reduce the stage/provider scope.",
              retryWith,
              recoverable: true,
            },
          });
          process.exitCode = 1;
          return;
        }
        console.log(chalk.red(warning));
        process.exitCode = 1;
        return;
      }
      if (!isJsonMode() && !isQuietMode()) {
        printBuildDryRun(projectDirArg, params, plan);
        return;
      }
      outputSuccess({
        command: "build",
        startedAt,
        dryRun: true,
        data: { params, plan },
      });
      return;
    }

    const spinner = isJsonMode() || isQuietMode() ? null : ora("Building video project...").start();
    const result = await executeSceneBuild({
      projectDir,
      mode,
      stage,
      beatId: options.beat,
      effort: options.effort,
      composer: options.composer,
      maxCostUsd,
      skipNarration: options.skipNarration,
      skipBackdrop: options.skipBackdrop,
      skipVideo: options.skipVideo,
      skipMusic: options.skipMusic,
      skipRender: options.skipRender,
      ttsProvider: options.tts,
      voice: options.voice,
      imageProvider: options.imageProvider,
      videoProvider,
      musicProvider,
      imageQuality: options.quality,
      imageSize: options.imageSize,
      force: options.force,
      onProgress: (e: SceneBuildProgressEvent) => {
        if (!spinner) return;
        if (e.type === "phase-start") spinner.text = `Phase: ${e.phase}...`;
        else if (e.type === "render-done") spinner.text = `Rendered: ${e.outputPath}`;
      },
    });

    if (!result.success) {
      spinner?.fail(`Build failed: ${result.error}`);
      if (isJsonMode()) {
        outputSuccess({ command: "build", startedAt, data: buildFailureData(result) });
        process.exitCode = 1;
        return;
      }
      exitWithError({
        ...generalError(result.error ?? "Build failed", result.suggestion),
        code: result.code ?? "ERROR",
        message: result.message,
        retryWith: result.retryWith,
        recoverable: result.recoverable,
        retryable: result.recoverable ?? false,
      });
    }

    if (isJsonMode() || isQuietMode()) {
      outputSuccess({ command: "build", startedAt, data: { ...result } });
      return;
    }

    if (result.phase === "needs-author") {
      printNeedsAuthor(result);
      return;
    }

    printBuildResult(spinner, result, projectDirArg);
  });

type BuildDryRunParams = {
  projectDir: string;
  stage: BuildStage;
  beatId: unknown;
  mode: SceneBuildMode;
  effort: unknown;
  composer: unknown;
  maxCostUsd: unknown;
  skipNarration: boolean;
  skipBackdrop: boolean;
  skipVideo: boolean;
  skipMusic: boolean;
  skipRender: boolean;
  ttsProvider: unknown;
  voice: unknown;
  imageProvider: unknown;
  videoProvider: unknown;
  musicProvider: unknown;
  imageQuality: unknown;
  imageSize: unknown;
  force: boolean;
};

function printBuildDryRun(projectDirArg: string, params: BuildDryRunParams, plan?: Awaited<ReturnType<typeof createBuildPlan>>): void {
  console.log();
  console.log(chalk.bold.cyan("VibeFrame Build - dry run"));
  console.log(chalk.dim("-".repeat(60)));
  console.log(`  Project:       ${chalk.bold(projectDirArg)}`);
  console.log(`  Stage:         ${chalk.bold(params.stage)}`);
  if (params.beatId) console.log(`  Beat:          ${chalk.bold(String(params.beatId))}`);
  console.log(`  Mode:          ${chalk.bold(params.mode)}`);
  if (params.maxCostUsd !== undefined) console.log(`  Max cost:      ${chalk.bold(`$${String(params.maxCostUsd)}`)}`);
  console.log(`  Composer:      ${chalk.bold(String(params.composer ?? "auto"))}`);
  console.log(`  TTS:           ${chalk.bold(String(params.ttsProvider ?? "auto"))}${params.skipNarration ? chalk.dim(" (skipped)") : ""}`);
  console.log(`  Image:         ${chalk.bold(String(params.imageProvider ?? "openai"))} ${chalk.dim(`${params.imageQuality} ${params.imageSize}`)}${params.skipBackdrop ? chalk.dim(" (skipped)") : ""}`);
  console.log(`  Video:         ${chalk.bold(String(params.videoProvider ?? "auto"))}${params.skipVideo ? chalk.dim(" (skipped)") : ""}`);
  console.log(`  Music:         ${chalk.bold(String(params.musicProvider ?? "auto"))}${params.skipMusic ? chalk.dim(" (skipped)") : ""}`);
  console.log(`  Render:        ${chalk.bold(params.skipRender ? "skip" : "yes")}`);
  console.log(`  Regenerate:    ${chalk.bold(params.force ? "yes" : "cache when possible")}`);

  // Pre-render cost rollup. Counts beats from STORYBOARD.md and applies
  // the same per-primitive midpoints we use for `vibe agent --budget-usd`.
  // Conservative — overestimates so a $5 budget doesn't blow past $5.
  const estimate = estimateBuildCost(params);
  if (plan) {
    console.log();
    console.log(chalk.bold.cyan("Estimated cost"));
    console.log(chalk.dim("-".repeat(60)));
    console.log(`  Status:        ${plan.status === "invalid" ? chalk.red(plan.status) : chalk.green(plan.status)}`);
    console.log(`  Beats:         ${chalk.bold(plan.beats.length)}`);
    console.log(`  Missing:       ${chalk.bold(plan.missing.length > 0 ? plan.missing.join(", ") : "none")}`);
    console.log(`  Providers:     ${chalk.bold(plan.providers.length > 0 ? plan.providers.join(", ") : "none")}`);
    console.log(`  ${chalk.bold("Total:")}         ${chalk.bold(`$${plan.estimatedCostUsd.toFixed(2)}`)}`);
    if (plan.validation.issues.length > 0) {
      console.log();
      for (const issue of plan.validation.issues) {
        const color = issue.severity === "error" ? chalk.red : chalk.yellow;
        console.log(color(`  [${issue.code}] ${issue.message}`));
      }
    }
    if (plan.nextCommands.length > 0) {
      console.log();
      console.log(chalk.bold.cyan("Next"));
      console.log(chalk.dim("-".repeat(60)));
      for (const command of plan.nextCommands) console.log(`  ${command}`);
    }
  } else if (estimate) {
    console.log();
    console.log(chalk.bold.cyan("Estimated cost (tier-derived, conservative)"));
    console.log(chalk.dim("-".repeat(60)));
    console.log(`  Beats:         ${chalk.bold(estimate.beats)}`);
    if (!params.skipNarration) {
      console.log(`  Narration:     ${chalk.cyan(`$${estimate.narrationUsd.toFixed(2)}`)} ${chalk.dim(`(${estimate.beats} × low)`)}`);
    }
    if (!params.skipBackdrop) {
      console.log(`  Backdrops:     ${chalk.yellow(`$${estimate.backdropUsd.toFixed(2)}`)} ${chalk.dim(`(${estimate.beats} × high)`)}`);
    }
    if (params.mode !== "agent") {
      console.log(`  Compose (LLM): ${chalk.cyan(`$${estimate.composeUsd.toFixed(2)}`)} ${chalk.dim(`(${estimate.beats} × ~$0.06 batch mode)`)}`);
    } else {
      console.log(`  Compose:       ${chalk.dim(`$0.00 (agent mode — host LLM does composition)`)}`);
    }
    console.log(`  ${chalk.bold("Total:")}         ${chalk.bold(`$${estimate.totalUsd.toFixed(2)}`)}`);
  }

  console.log();
  console.log(chalk.dim("No assets, provider calls, or video files were created."));
}

function buildFailureData(result: SceneBuildResult): Record<string, unknown> {
  const message = result.error ?? "Build failed";
  const retryWith = result.retryWith ?? [];
  return {
    ...result,
    code: result.code ?? (result.phase === "needs-author" ? "NEEDS_AUTHOR" : "BUILD_FAILED"),
    message,
    suggestion: result.suggestion ?? (retryWith.length > 0 ? "Run one of retryWith to continue or repair the build." : undefined),
    retryWith,
    recoverable: result.recoverable ?? retryWith.length > 0,
  };
}

function buildPlanValidationFailureData(plan: BuildPlanResult): Record<string, unknown> {
  return {
    code: "STORYBOARD_VALIDATION_FAILED",
    message: `${plan.summary.validationErrors} storyboard validation error(s).`,
    suggestion: "Run storyboard validate, then fix STORYBOARD.md or use storyboard revise --dry-run.",
    retryWith: plan.retryWith,
    recoverable: true,
    validation: plan.validation,
    summary: plan.summary,
    nextCommands: plan.nextCommands,
  };
}

/**
 * Sum a conservative USD estimate for a build run. Returns `null` when
 * the storyboard isn't readable yet (e.g. fresh `vibe init` run); the
 * dry-run page just omits the section in that case.
 */
function estimateBuildCost(params: BuildDryRunParams): {
  beats: number;
  narrationUsd: number;
  backdropUsd: number;
  videoUsd: number;
  musicUsd: number;
  composeUsd: number;
  totalUsd: number;
} | null {
  const storyboardPath = join(params.projectDir, "STORYBOARD.md");
  if (!existsSync(storyboardPath)) return null;
  let beats = 0;
  try {
    const md = readFileSync(storyboardPath, "utf-8");
    beats = parseStoryboard(md).beats.length;
  } catch {
    return null;
  }
  if (beats === 0) return null;

  // Per-beat costs from the same TIER_USD_ESTIMATE we use for the
  // agent budget. Compose batch mode is cheaper than the tier table
  // suggests (~$0.058/beat measured) — use the empirical midpoint
  // rather than the high-tier ceiling.
  const TTS_PER_BEAT = 0.05;
  const IMAGE_PER_BEAT = 3;
  const VIDEO_PER_BEAT = 5;
  const MUSIC_PER_BEAT = 0.5;
  const COMPOSE_PER_BEAT_BATCH = 0.06;

  const narrationUsd = params.skipNarration ? 0 : beats * TTS_PER_BEAT;
  const backdropUsd = params.skipBackdrop ? 0 : beats * IMAGE_PER_BEAT;
  const videoUsd = params.skipVideo ? 0 : beats * VIDEO_PER_BEAT;
  const musicUsd = params.skipMusic ? 0 : beats * MUSIC_PER_BEAT;
  const composeUsd = params.mode === "agent" ? 0 : beats * COMPOSE_PER_BEAT_BATCH;
  return {
    beats,
    narrationUsd,
    backdropUsd,
    videoUsd,
    musicUsd,
    composeUsd,
    totalUsd: narrationUsd + backdropUsd + videoUsd + musicUsd + composeUsd,
  };
}

function printNeedsAuthor(result: SceneBuildResult): void {
  console.log(chalk.cyan("Agent authoring required"));
  console.log();
  console.log(chalk.bold.cyan("Missing compositions"));
  console.log(chalk.dim("-".repeat(60)));
  const missing = result.composePrompts?.beats.filter((beat) => !beat.exists) ?? [];
  if (missing.length === 0) {
    console.log(chalk.dim("  No missing files were reported. Re-run `vibe build` to continue."));
  } else {
    for (const beat of missing) {
      const dur = beat.duration !== undefined ? chalk.dim(` ${beat.duration}s`) : "";
      console.log(`  ${chalk.bold(beat.id)}${dur} -> ${beat.outputPath}`);
    }
  }
  console.log();
  console.log(chalk.bold.cyan("Next"));
  console.log(chalk.dim("-".repeat(60)));
  console.log("  Ask your coding agent to author the missing HTML files.");
  console.log("  Then run: vibe build");
  console.log(chalk.dim("  Use `vibe build --mode batch` when you want the CLI to call an LLM composer instead."));
}

function printBuildResult(spinner: ReturnType<typeof ora> | null, result: SceneBuildResult, projectDirArg: string): void {
  spinner?.succeed(chalk.green(result.phase === "pending-jobs" ? "Build paused for async jobs" : result.outputPath ? `Build complete: ${result.outputPath}` : "Build complete"));
  console.log();
  console.log(chalk.bold.cyan("Beats"));
  console.log(chalk.dim("-".repeat(60)));
  for (const beat of result.beats) {
    const narration = formatPrimitiveStatus(beat.narrationStatus, beat.narrationPath);
    const backdrop = formatPrimitiveStatus(beat.backdropStatus, beat.backdropPath);
    const video = formatPrimitiveStatus(beat.videoStatus, beat.videoPath);
    const music = formatPrimitiveStatus(beat.musicStatus, beat.musicPath);
    console.log(`  ${chalk.bold(beat.beatId.padEnd(12))} narration: ${narration}   backdrop: ${backdrop}   video: ${video}   music: ${music}`);
    if (beat.narrationError) console.log(chalk.red(`    ! narration: ${beat.narrationError}`));
    if (beat.backdropError) console.log(chalk.red(`    ! backdrop: ${beat.backdropError}`));
    if (beat.videoError) console.log(chalk.red(`    ! video: ${beat.videoError}`));
    if (beat.musicError) console.log(chalk.red(`    ! music: ${beat.musicError}`));
    if (beat.videoJobId) console.log(chalk.dim(`    video job: vibe status job ${beat.videoJobId} --json`));
    if (beat.musicJobId) console.log(chalk.dim(`    music job: vibe status job ${beat.musicJobId} --json`));
  }
  if (result.composeData) {
    console.log();
    console.log(chalk.bold.cyan("Compose"));
    console.log(chalk.dim("-".repeat(60)));
    console.log(`  beats     ${result.composeData.beats}`);
    console.log(`  cache     ${result.composeData.cacheHits} hit / ${result.composeData.beats - result.composeData.cacheHits} fresh`);
    console.log(`  cost      $${result.composeData.totalCostUsd.toFixed(4)}`);
  }
  console.log();
  console.log(chalk.bold.cyan("Next"));
  console.log(chalk.dim("-".repeat(60)));
  if (result.outputPath) {
    console.log(`  Watch: ${result.outputPath}`);
  } else if (result.phase === "pending-jobs") {
    console.log(`  Poll: vibe status project ${projectDirArg} --refresh --json`);
    console.log(`  Resume: vibe build ${projectDirArg} --stage assets --json`);
  } else {
    console.log(`  Render: vibe render ${projectDirArg}`);
  }
  console.log(chalk.dim(`  Total: ${(result.totalLatencyMs / 1000).toFixed(1)}s`));
}

function formatPrimitiveStatus(status: string, path?: string): string {
  switch (status) {
    case "generated":
      return chalk.green(path ?? "generated");
    case "cached":
      return chalk.dim(path ?? "cached");
    case "pending":
      return chalk.yellow(path ? `pending -> ${path}` : "pending");
    case "skipped":
      return chalk.dim("skipped");
    case "missing":
      return chalk.yellow("missing cue");
    case "failed":
      return chalk.red("failed");
    default:
      return status;
  }
}

function parseOptionalProvider<T extends string>(value: unknown, valid: readonly T[], label: string): T | undefined {
  if (value === undefined) return undefined;
  const provider = String(value).toLowerCase();
  if (valid.includes(provider as T)) return provider as T;
  exitWithError(usageError(`Invalid --${label}-provider: ${String(value)}`, `Must be one of: ${valid.join(", ")}`));
}
