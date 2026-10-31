/**
 * @module generate/video
 * @description `vibe generate video` (alias `vid`) — multi-provider video
 * generation (Seedance via fal.ai, Grok, Kling, Runway, and Gemini Omni).
 * Validation, provider choice, and the dry run live here;
 * generation itself is `executeVideoGenerate`, the same executor the MCP
 * tool and builds use.
 */

import type { Command } from "commander";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import chalk from "chalk";
import imageSize from "image-size";
import { estimateSeedanceVideoCostUsd, modelAliases, resolveSeedanceVariant } from "@vibeframe/ai-providers";
import { requireApiKey, hasConfiguredApiKey } from "../../utils/api-key.js";
import {
  checkModelLifecycle,
  videoDurationChoices,
  videoModelChoices,
  videoModelSpec,
  videoRequestProblem,
} from "../../utils/model-lifecycle.js";
import { hasTTY, prompt as promptText } from "../../utils/tty.js";
import {
  spinner as createSpinner,
  failureFromError,
  isJsonMode,
  lookupCostEstimateUpperBound,
  outputSuccess,
  printWarnings,
  log,
  exitWithError,
  providerFailure,
  usageError,
} from "../output.js";
import { rejectControlChars, validateOutputPath } from "../validate.js";
import { defaultOutputPath } from "../_shared/default-output.js";
import { loadProviderDefaults, resolveProvider } from "../../utils/provider-resolver.js";
import { executeVideoGenerate, type VideoGenerateOptions } from "../ai-video.js";
import { createAndWriteJobRecord } from "../_shared/status-jobs.js";
import { VIDEO_PROVIDER_ENV, VIDEO_PROVIDER_LABELS as PROVIDER_LABELS, meteredVideoCostUsd } from "../_shared/video-jobs.js";

export function registerVideoCommand(parent: Command): void {
  parent
    .command("video")
    .alias("vid")
    .description("Generate video using AI (Seedance, Grok, Kling, Runway, or Gemini Omni)")
    .argument("[prompt]", "Text prompt describing the video (interactive if omitted)")
    .option(
      "-p, --provider <provider>",
      "Provider: seedance (ByteDance Seedance 2.0 via fal.ai), grok, kling, runway, omni (Gemini Omni 1.1 Flash)"
    )
    .option(
      "-k, --api-key <key>",
      "API key (or set FAL_API_KEY / XAI_API_KEY / RUNWAY_API_SECRET / KLING_API_KEY / GOOGLE_API_KEY env)"
    )
    .option("-o, --output <path>", "Output file path (default: video.mp4, or the next free video-N.mp4)")
    .option("-i, --image <path>", "Reference image for image-to-video")
    .option(
      "-d, --duration <sec>",
      `Duration in seconds. Seedance accepts 4-15; Kling: ${videoDurationChoices("kling")}.`,
      "5"
    )
    .option(
      "-r, --ratio <ratio>",
      "Aspect ratio: 16:9, 9:16, or 1:1 (auto-detected from image if omitted)"
    )
    .option("--seed <number>", "Random seed for reproducibility (Runway only)")
    .option("--mode <mode>", "Generation mode: std (720p) or pro (1080p) (Kling only; --resolution wins)", "std")
    .option(
      "--seedance-model <model>",
      "Seedance variant: quality (2.0), fast, or 2.5 (fal.ai only)",
      "quality"
    )
    .option("--grok-model <model>", "Grok video model: 1.5 (default), lite, classic", "1.5")
    .option("--kling-model <model>", `Kling model: ${videoModelChoices("kling")}`, "v3")
    .option("--negative <prompt>", "Negative prompt - what to avoid (Seedance/Kling)")
    .option("--resolution <res>", "Video resolution: 480p, 720p, 1080p, or 4k depending on provider")
    .option("--last-frame <path>", "Ending frame image for Seedance or Kling 4.0 (same as --end-image)")
    .option("--end-image <path>", "Ending frame image for image-to-video (Seedance, Kling 4.0)")
    .option(
      "--ref-images <paths...>",
      "Reference images for Seedance reference-to-video"
    )
    .option("--ref-videos <paths...>", "Reference videos for Seedance reference-to-video")
    .option("--ref-audio <paths...>", "Reference audio for Seedance reference-to-video")
    .option("--no-generate-audio", "Disable native audio when the provider supports it")
    .option(
      "--runway-model <model>",
      "Runway model: gen4.5 (default, text+image-to-video), gen4_turbo (image-to-video only)",
      "gen4.5"
    )
    .option("--no-wait", "Start generation and return task ID without waiting")
    .option("--dry-run", "Preview parameters without executing")
    .addHelpText(
      "after",
      `
Examples:
  $ vibe generate video "dancing cat" -o cat.mp4                      # Seedance when FAL_API_KEY is set
  $ vibe gen vid "cinematic city timelapse" -o city.mp4 -p seedance   # Seedance via fal.ai
  $ vibe gen vid "city timelapse" -o city.mp4 -p kling                # Kling
  $ vibe gen vid "city timelapse" -p kling --kling-model 4.0 -d 3 --dry-run --json  # Kling 4.0 estimate
  $ vibe gen vid "epic scene" -i frame.png -o out.mp4 -p runway       # Image-to-video
  $ vibe gen vid "ocean waves" -o waves.mp4 -p omni                  # Gemini Omni
  $ vibe gen vid "sunset" -o sun.mp4 -d 10 --dry-run --json`
    )
    .action(async (prompt: string | undefined, options) => {
      const startedAt = Date.now();
      try {
        // Interactive prompt if no argument provided
        if (!prompt) {
          if (hasTTY()) {
            prompt = await promptText(chalk.cyan("Describe your video: "));
            if (!prompt?.trim()) {
              exitWithError(usageError("Prompt is required."));
            }
          } else {
            exitWithError(
              usageError("Prompt argument is required.", "Usage: vibe generate video <prompt>")
            );
          }
        }
        rejectControlChars(prompt);
        if (options.output) {
          validateOutputPath(options.output);
        }
        await loadProviderDefaults();

        // Validate duration up-front so dry-run doesn't echo invalid params.
        // Without this, `vibe generate video "..." --duration -1 --dry-run`
        // would happily print a -1s plan, and a user copy-pasting without
        // `--dry-run` would kick off a paid call with bad input.
        if (options.duration !== undefined) {
          const d = parseFloat(options.duration);
          if (!Number.isFinite(d) || d <= 0 || d > 60) {
            exitWithError(
              usageError(
                `Invalid --duration: ${options.duration}`,
                "Must be a positive number ≤ 60 seconds."
              )
            );
          }
        }

        // Resolve provider:
        //  - explicit -p flag wins and is never swapped for another paid
        //    provider; a missing key fails the real run (API_KEY_MISSING)
        //  - no flag → VIDEO_PROVIDERS priority list (Seedance via fal.ai > grok > omni > kling > runway)
        //  - if no keys at all → keep grok as last-resort default so the
        //    later requireApiKey() prints a friendly Grok-specific message
        const validProviders = ["runway", "kling", "grok", "seedance", "omni"];
        let provider: string;
        if (options.provider) {
          provider = options.provider.toLowerCase();
          if (!validProviders.includes(provider)) {
            exitWithError(
              usageError(
                `Invalid provider: ${provider}`,
                provider === "veo"
                  ? "Veo 3.1 shut down on 2026-10-22; use `-p omni` (Gemini Omni) on the same GOOGLE_API_KEY."
                  : provider === "fal"
                    ? "`fal` was renamed to `seedance`; use `-p seedance` (same FAL_API_KEY)."
                    : "Available providers: seedance, grok, kling, runway, omni."
              )
            );
          }
        } else {
          const resolved = resolveProvider("video");
          provider = resolved?.name ?? "grok";
        }

        // Read the image early so the aspect ratio is known before the dry run.
        if (options.image) {
          const imageBuffer = await readFile(resolve(process.cwd(), options.image));

          // Auto-detect aspect ratio from image dimensions when not explicitly set
          if (!options.ratio) {
            const dimensions = imageSize(imageBuffer);
            if (dimensions.width && dimensions.height) {
              const ratio = dimensions.width / dimensions.height;
              if (ratio > 1.2) {
                options.ratio = "16:9";
              } else if (ratio < 0.8) {
                options.ratio = "9:16";
              } else {
                options.ratio = "1:1";
              }
              log(
                `Auto-detected aspect ratio: ${options.ratio} (${dimensions.width}x${dimensions.height})`
              );
            }
          }
        }

        // Default to 16:9 when no image and no explicit ratio
        if (!options.ratio) {
          options.ratio = "16:9";
        }

        // Runway only supports 16:9 and 9:16 - clamp 1:1 to 16:9
        if (provider === "runway" && options.ratio === "1:1") {
          log(`${provider} does not support 1:1 — falling back to 16:9`);
          options.ratio = "16:9";
        }

        // Reject unknown model aliases before any dry run or spend, so agents
        // learn about a typo from the dry run instead of the real call.
        const modelSpec = videoModelSpec(provider, options);
        if (!modelSpec) {
          exitWithError(
            usageError(`Unknown ${provider} model. Valid: ${modelAliases(provider, "video").join(", ")}.`)
          );
        }
        // The model's own length and resolution limits (Kling 4.0: 3-30 s,
        // 720p/1080p), so a dry run never prices a request the provider refuses.
        const requestProblem = videoRequestProblem(modelSpec, {
          duration: options.duration !== undefined ? parseFloat(options.duration) : undefined,
          resolution: options.resolution,
        });
        if (requestProblem) exitWithError(usageError(requestProblem));
        const lifecycleWarnings = checkModelLifecycle(modelSpec);
        if (!options.dryRun) printWarnings(lifecycleWarnings);

        if (options.dryRun) {
          // An explicit -p is never swapped for another paid provider, so a
          // missing key fails the real run; say so here, before any spend.
          if (!(await hasConfiguredApiKey(VIDEO_PROVIDER_ENV[provider], options.apiKey))) {
            lifecycleWarnings.push(
              `${VIDEO_PROVIDER_ENV[provider]} is not set; the real run will fail until it is (vibe setup).`
            );
          }
          // Replace the flat cost-tier upper bound with what the run will
          // cost so agents can gate spend precisely: Seedance's token-accurate
          // estimate, or list price x the usage a metering provider (Kling)
          // records. Other providers fall back to the tier bound.
          let costUsd: number | undefined;
          if (provider === "seedance") {
            costUsd = realRunCost(provider, options).costUsd;
          } else {
            try {
              costUsd = await meteredVideoCostUsd(provider, {
                prompt,
                model: modelSpec.id,
                durationSec: parseFloat(options.duration),
                aspectRatio: options.ratio,
                resolution: options.resolution,
                // A placeholder: the real run uploads the local frame first.
                image: options.image ? "https://dry-run.invalid/frame.png" : undefined,
                negativePrompt: options.negative,
                generateAudio: options.generateAudio,
                providerOptions: provider === "kling" ? { mode: options.mode } : undefined,
              });
            } catch (error) {
              // The provider would refuse this request: say so now, before any spend.
              exitWithError(failureFromError(error, "Video generation would fail"));
            }
          }
          outputSuccess({
            command: "generate video",
            startedAt,
            dryRun: true,
            costUsd,
            warnings: lifecycleWarnings,
            data: {
              params: {
                prompt,
                provider,
                duration: options.duration,
                ratio: options.ratio,
                image: options.image,
                mode: provider === "kling" ? options.mode : undefined,
                negative: options.negative,
                resolution: options.resolution,
                model: videoModelSpec(provider, options)?.id,
                refImages: options.refImages,
                refVideos: options.refVideos,
                refAudio: options.refAudio,
                generateAudio: options.generateAudio,
              },
            },
          });
          return;
        }

        const providerLabel = PROVIDER_LABELS[provider] ?? provider;
        // Without -o the video still lands on disk (video.mp4, video-2.mp4,
        // ...): provider URLs expire, and a --no-wait job downloads here too.
        const output: string = options.output ?? defaultOutputPath("video.mp4");
        const apiKey = await requireApiKey(VIDEO_PROVIDER_ENV[provider], providerLabel, options.apiKey);
        const spinner = isJsonMode() ? null : createSpinner(`Starting ${providerLabel} video generation...`).start();

        const result = await executeVideoGenerate({
          prompt,
          provider: provider as VideoGenerateOptions["provider"],
          image: options.image,
          endImage: options.endImage ?? options.lastFrame,
          refImages: options.refImages,
          refVideos: options.refVideos,
          refAudio: options.refAudio,
          duration: parseFloat(options.duration),
          ratio: options.ratio,
          seed: options.seed !== undefined ? parseInt(options.seed, 10) : undefined,
          mode: provider === "kling" ? options.mode : undefined,
          negative: options.negative,
          resolution: options.resolution,
          runwayModel: options.runwayModel,
          seedanceModel: options.seedanceModel,
          grokModel: options.grokModel,
          klingModel: options.klingModel,
          generateAudio: options.generateAudio,
          output,
          wait: options.wait,
          apiKey,
          onSubmitted: (job) => {
            if (!spinner) return;
            spinner.stopAndPersist({ symbol: chalk.green("✔"), text: `${providerLabel} accepted the job (task ${job.id})` });
            spinner.start("Generating video (usually 1-3 minutes)...");
          },
          onProgress: (state) => {
            if (!spinner) return;
            spinner.text =
              state.status === "completed"
                ? "Downloading video..."
                : state.progress !== undefined
                  ? `Generating video... ${Math.round(state.progress)}%`
                  : `Generating video... ${state.status}`;
          },
        });

        if (!result.success) {
          spinner?.fail(result.error ?? "Generation failed");
          const task = result.taskId ? ` (${provider} task ${result.taskId})` : "";
          exitWithError(providerFailure(`${result.error ?? "Generation failed"}${task}`, result.errorKind));
        }

        // Still running (--no-wait, or the wait ran out): record the job so
        // `vibe status job` can poll, download, and cache it.
        if (result.status !== "completed") {
          const job = await createAndWriteJobRecord({
            jobType: "generate-video",
            provider,
            providerTaskId: result.taskId!,
            providerJob: result.job,
            status: "running",
            command: "generate video --no-wait",
            prompt,
            outputPath: output,
          });
          spinner?.succeed(chalk.green(`Generation started: ${providerLabel} task ${result.taskId}`));
          if (isJsonMode()) {
            // Submitted work is billed whether or not this call waits for it.
            const { warnings: costWarnings, ...cost } = realRunCostFields(result.metered, provider, options);
            outputSuccess({
              command: "generate video",
              startedAt,
              // Undefined for a metered job: outputSuccess then prices the meter.
              costUsd: cost.costUsd,
              costEstimated: cost.costEstimated,
              warnings: [...lifecycleWarnings, ...costWarnings],
              data: {
                provider,
                taskId: result.taskId,
                status: job.status,
                jobId: job.id,
                statusCommand: job.retryWith[0],
              },
            });
            return;
          }
          console.log(chalk.dim(`  Check it with: ${job.retryWith[0]}`));
          return;
        }

        spinner?.succeed(chalk.green("Video generated"));
        const { warnings: costWarnings, ...cost } = realRunCostFields(result.metered, provider, options);
        if (isJsonMode()) {
          outputSuccess({
            command: "generate video",
            startedAt,
            // Undefined for a metered job: outputSuccess then prices the meter.
            costUsd: cost.costUsd,
            costEstimated: cost.costEstimated,
            warnings: [...lifecycleWarnings, ...costWarnings],
            data: {
              provider,
              taskId: result.taskId,
              videoUrl: result.videoUrl,
              duration: result.duration,
              outputPath: result.outputPath,
            },
          });
          return;
        }
        console.log();
        if (result.videoUrl) console.log(`Video URL: ${result.videoUrl}`);
        if (result.duration) console.log(`Duration: ${result.duration}s`);
        if (result.outputPath) console.log(chalk.green(`Saved to: ${result.outputPath}`));
        console.log();
      } catch (error) {
        exitWithError(failureFromError(error, "Video generation failed"));
      }
    });
}


/**
 * The cost fields of a real run's envelope. A provider that metered the job
 * (Kling records the billed seconds at their resolution) gets none, so
 * `outputSuccess` reports the metered usage times the catalog price; every
 * other provider gets the `realRunCost` estimate, flagged as one.
 */
export function realRunCostFields(
  metered: boolean | undefined,
  provider: string,
  options: Parameters<typeof realRunCost>[1]
): { costUsd?: number; costEstimated?: boolean; warnings: string[] } {
  if (metered) return { warnings: [] };
  const cost = realRunCost(provider, options);
  return { costUsd: cost.costUsd, costEstimated: true, warnings: cost.warnings };
}

/**
 * Cost figure for a REAL (non-dry-run) generation envelope.
 *
 * Seedance has a token-accurate estimator; every other provider reports the
 * command's tier upper bound with a warning naming it an estimate. Without
 * this the success envelope defaulted to costUsd 0, which an agent budget
 * loop reads as "free" - the hybrid-brew dogfood run billed Runway twice
 * while reporting $0.
 */
export function realRunCost(provider: string, options: {
  duration?: string;
  resolution?: string;
  ratio?: string;
  seedanceModel?: string;
  refVideos?: string[];
}): { costUsd: number; warnings: string[] } {
  if (provider === "seedance") {
    const variant = resolveSeedanceVariant(options.seedanceModel);
    return {
      costUsd: estimateSeedanceVideoCostUsd({
        durationSec: Number(options.duration) || 5,
        resolution: options.resolution,
        aspectRatio: options.ratio,
        fast: variant === "seedance-2.0-fast",
        v25: variant === "seedance-2.5",
        hasVideoReference: Boolean(options.refVideos),
      }),
      warnings: [],
    };
  }
  return {
    costUsd: lookupCostEstimateUpperBound("generate video") ?? 5,
    warnings: [
      `costUsd is the tier upper bound for ${provider} - actual provider billing is typically lower and is not metered here.`,
    ],
  };
}
