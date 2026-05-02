import { Command } from "commander";
import chalk from "chalk";
import { resolve } from "node:path";

import { createBuildPlan, type BuildPlanResult, type BuildStage } from "./_shared/build-plan.js";
import { exitWithError, isJsonMode, outputSuccess, usageError } from "./output.js";

const VALID_STAGES: BuildStage[] = ["assets", "compose", "sync", "render", "all"];
const VALID_MODES = ["agent", "batch", "auto"] as const;
const VALID_TTS_PROVIDERS = ["auto", "elevenlabs", "kokoro"] as const;
const VALID_VIDEO_PROVIDERS = ["seedance", "grok", "kling", "runway", "veo"] as const;
const VALID_MUSIC_PROVIDERS = ["elevenlabs", "replicate"] as const;
const VALID_COMPOSERS = ["claude", "openai", "gemini"] as const;
const VALID_IMAGE_QUALITIES = ["standard", "hd"] as const;

export const planCommand = new Command("plan")
  .description("Read STORYBOARD.md and show build plan, costs, missing cues, and provider needs")
  .argument("[project-dir]", "Video project directory", ".")
  .option("--stage <stage>", `Stage to plan: ${VALID_STAGES.join("|")}`, "all")
  .option("--beat <id>", "Restrict the plan to one beat")
  .option("--mode <mode>", "Build mode: agent|batch|auto", "auto")
  .option("--skip-narration", "Don't include narration generation in the plan")
  .option("--skip-backdrop", "Don't include backdrop image generation in the plan")
  .option("--skip-video", "Don't include video generation in the plan")
  .option("--skip-music", "Don't include music generation in the plan")
  .option("--tts <provider>", "TTS provider: auto|elevenlabs|kokoro")
  .option("--voice <id>", "Voice id")
  .option("--image-provider <name>", "Image provider: openai")
  .option("--video-provider <name>", `Video provider: ${VALID_VIDEO_PROVIDERS.join("|")}`)
  .option("--music-provider <name>", `Music provider: ${VALID_MUSIC_PROVIDERS.join("|")}`)
  .option("--quality <q>", "Image quality: standard|hd")
  .option("--image-size <s>", "Image size: 1024x1024|1536x1024|1024x1536")
  .option("--composer <provider>", "Batch composer: claude|openai|gemini")
  .option("--force", "Plan regeneration even when outputs already exist")
  .option("--max-cost <usd>", "Fail if estimated cost exceeds this USD cap")
  .action(async (projectDirArg: string, options) => {
    const startedAt = Date.now();
    const stage = String(options.stage ?? "all") as BuildStage;
    if (!VALID_STAGES.includes(stage)) {
      exitWithError(
        usageError(`Invalid --stage: ${stage}`, `Must be one of: ${VALID_STAGES.join(", ")}`)
      );
    }
    const mode = String(options.mode ?? "auto");
    if (!VALID_MODES.includes(mode as (typeof VALID_MODES)[number])) {
      exitWithError(usageError(`Invalid --mode: ${mode}`, "Must be one of: agent, batch, auto"));
    }
    const ttsProvider = parseOptionalProvider(options.tts, VALID_TTS_PROVIDERS, "tts");
    const videoProvider = parseOptionalProvider(
      options.videoProvider,
      VALID_VIDEO_PROVIDERS,
      "video"
    );
    const musicProvider = parseOptionalProvider(
      options.musicProvider,
      VALID_MUSIC_PROVIDERS,
      "music"
    );
    const composer = parseOptionalProvider(options.composer, VALID_COMPOSERS, "composer");
    const imageQuality = parseOptionalProvider(options.quality, VALID_IMAGE_QUALITIES, "quality");
    const maxCost =
      options.maxCost !== undefined ? Number.parseFloat(String(options.maxCost)) : undefined;
    if (maxCost !== undefined && (!Number.isFinite(maxCost) || maxCost < 0)) {
      exitWithError(
        usageError(
          `Invalid --max-cost: ${String(options.maxCost)}`,
          "Must be a non-negative USD amount."
        )
      );
    }

    const projectDir = resolve(projectDirArg);
    const plan = await createBuildPlan({
      projectDir,
      stage,
      beat: options.beat,
      mode: mode as "agent" | "batch" | "auto",
      skipNarration: options.skipNarration,
      skipBackdrop: options.skipBackdrop,
      skipVideo: options.skipVideo,
      skipMusic: options.skipMusic,
      ttsProvider,
      voice: options.voice,
      imageProvider: options.imageProvider,
      imageQuality,
      imageSize: options.imageSize,
      videoProvider,
      musicProvider,
      composer,
      force: options.force,
    });

    if (!plan.validation.ok) {
      const data = validationFailureData(plan);
      if (isJsonMode()) {
        outputSuccess({
          command: "plan",
          startedAt,
          data,
          warnings: plan.warnings,
        });
        process.exitCode = 1;
        return;
      }
      printPlan(projectDirArg, stage, plan);
      process.exitCode = 1;
      return;
    }

    if (maxCost !== undefined && plan.estimatedCostUsd > maxCost) {
      const warning = `Estimated cost $${plan.estimatedCostUsd.toFixed(2)} exceeds --max-cost $${maxCost.toFixed(2)}.`;
      const data = {
        ...plan,
        costCapUsd: maxCost,
        code: "COST_CAP_EXCEEDED",
        message: warning,
        suggestion: "Raise --max-cost or reduce the stage/provider scope.",
        recoverable: true,
        retryWith: [
          ...plan.retryWith,
          `vibe plan ${projectDirArg} --stage ${stage} --skip-backdrop --json`,
          `vibe build ${projectDirArg} --stage ${stage} --max-cost ${plan.estimatedCostUsd} --json`,
        ].filter((value, index, all) => value.length > 0 && all.indexOf(value) === index),
      };
      if (isJsonMode()) {
        outputSuccess({
          command: "plan",
          startedAt,
          data,
          warnings: [warning],
        });
        process.exitCode = 1;
        return;
      }
      exitWithError(
        usageError(
          `Estimated cost $${plan.estimatedCostUsd.toFixed(2)} exceeds --max-cost $${maxCost.toFixed(2)}.`,
          `Raise --max-cost or reduce the stage/provider scope.`
        )
      );
    }

    if (isJsonMode()) {
      outputSuccess({
        command: "plan",
        startedAt,
        data: { ...plan },
        costUsd: 0,
        warnings: plan.warnings,
      });
      return;
    }

    printPlan(projectDirArg, stage, plan);
  });

function validationFailureData(plan: BuildPlanResult): Record<string, unknown> {
  return {
    ...plan,
    code: "STORYBOARD_VALIDATION_FAILED",
    message: `${plan.summary.validationErrors} storyboard validation error(s).`,
    suggestion:
      "Run storyboard validate, then fix STORYBOARD.md or use storyboard revise --dry-run.",
    recoverable: true,
    retryWith: plan.retryWith,
  };
}

function printPlan(projectDirArg: string, stage: BuildStage, plan: BuildPlanResult): void {
  console.log();
  console.log(chalk.bold.cyan("VibeFrame Plan"));
  console.log(chalk.dim("-".repeat(60)));
  console.log(`  Project:       ${projectDirArg}`);
  console.log(`  Stage:         ${stage}`);
  console.log(
    `  Status:        ${plan.status === "invalid" ? chalk.red(plan.status) : chalk.green(plan.status)}`
  );
  console.log(`  Mode:          ${plan.mode}`);
  console.log(`  Beats:         ${plan.beats.length}${plan.beat ? ` (${plan.beat})` : ""}`);
  console.log(`  Missing:       ${plan.missing.length > 0 ? plan.missing.join(", ") : "none"}`);
  console.log(`  Providers:     ${plan.providers.length > 0 ? plan.providers.join(", ") : "none"}`);
  console.log(`  Est. cost:     $${plan.estimatedCostUsd.toFixed(2)}`);
  if (plan.providerResolution.length > 0) {
    const missingKeys = plan.providerResolution
      .filter((resolution) => resolution.requiresKey && !resolution.configured)
      .map((resolution) => `${resolution.kind}:${resolution.resolved}`);
    console.log(
      `  Provider keys: ${missingKeys.length > 0 ? chalk.yellow(`missing ${missingKeys.join(", ")}`) : "ready"}`
    );
  }
  if (plan.warnings.length > 0) {
    console.log();
    for (const warning of plan.warnings) console.log(chalk.yellow(`  Warning: ${warning}`));
  }
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
}

function parseOptionalProvider<T extends string>(
  value: unknown,
  valid: readonly T[],
  flag: string
): T | undefined {
  if (value === undefined) return undefined;
  const provider = String(value).toLowerCase();
  if (valid.includes(provider as T)) return provider as T;
  exitWithError(
    usageError(`Invalid --${flag}: ${String(value)}`, `Must be one of: ${valid.join(", ")}`)
  );
}
