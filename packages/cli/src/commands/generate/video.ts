/**
 * @module generate/video
 * @description `vibe generate video` (alias `vid`) — multi-provider video
 * generation (Seedance via fal.ai, Grok, Kling, Runway, Gemini Omni, and Veo
 * until 2026-10-22). Validation, provider choice, and the dry run live here;
 * generation itself is `executeVideoGenerate`, the same executor the MCP
 * tool and builds use.
 */

import type { Command } from "commander";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import chalk from "chalk";
import ora from "ora";
import imageSize from "image-size";
import { estimateSeedanceVideoCostUsd, modelAliases, resolveSeedanceVariant } from "@vibeframe/ai-providers";
import { requireApiKey, hasConfiguredApiKey } from "../../utils/api-key.js";
import { checkModelLifecycle, videoModelSpec } from "../../utils/model-lifecycle.js";
import { hasTTY, prompt as promptText } from "../../utils/tty.js";
import {
  isJsonMode,
  lookupCostEstimateUpperBound,
  outputSuccess,
  printWarnings,
  log,
  exitWithError,
  apiError,
  providerFailure,
  usageError,
} from "../output.js";
import { rejectControlChars, validateOutputPath } from "../validate.js";
import { loadProviderDefaults, resolveProvider } from "../../utils/provider-resolver.js";
import { executeVideoGenerate, type VideoGenerateOptions } from "../ai-video.js";
import { createAndWriteJobRecord } from "../_shared/status-jobs.js";
import { VIDEO_PROVIDER_ENV } from "../_shared/video-jobs.js";

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  seedance: "Seedance via fal.ai",
  grok: "Grok Imagine",
  kling: "Kling",
  runway: "Runway",
  omni: "Gemini Omni 1.1 Flash",
  veo: "Veo 3.1",
};

export function registerVideoCommand(parent: Command): void {
  parent
    .command("video")
    .alias("vid")
    .description("Generate video using AI (Seedance, Grok, Kling, Runway, Veo, or Gemini Omni)")
    .argument("[prompt]", "Text prompt describing the video (interactive if omitted)")
    .option(
      "-p, --provider <provider>",
      "Provider: seedance (ByteDance Seedance 2.0 via fal.ai), grok, kling, runway, omni (Gemini Omni 1.1 Flash; Google default), veo (Veo 3.1 preview, shuts down 2026-10-22). `fal` is a deprecated v0.x alias for seedance and will be removed in 1.0."
    )
    .option(
      "-k, --api-key <key>",
      "API key (or set FAL_API_KEY / XAI_API_KEY / RUNWAY_API_SECRET / KLING_API_KEY / GOOGLE_API_KEY env)"
    )
    .option("-o, --output <path>", "Output file path (downloads video)")
    .option("-i, --image <path>", "Reference image for image-to-video")
    .option(
      "-d, --duration <sec>",
      "Duration in seconds. Seedance accepts 4-15; Kling accepts 5 or 10; Veo maps to 6 or 8.",
      "5"
    )
    .option(
      "-r, --ratio <ratio>",
      "Aspect ratio: 16:9, 9:16, or 1:1 (auto-detected from image if omitted)"
    )
    .option("--seed <number>", "Random seed for reproducibility (Runway only)")
    .option("--mode <mode>", "Generation mode: std or pro (Kling only)", "std")
    .option(
      "--seedance-model <model>",
      "Seedance variant: quality (2.0), fast, or 2.5 (fal.ai only)",
      "quality"
    )
    .option("--grok-model <model>", "Grok video model: 1.5 (default), lite, classic", "1.5")
    .option("--kling-model <model>", "Kling model: v3 (default), v2.6, v2.5-turbo", "v3")
    .option("--negative <prompt>", "Negative prompt - what to avoid (Kling/Veo)")
    .option("--resolution <res>", "Video resolution: 480p, 720p, 1080p, or 4k depending on provider")
    .option("--last-frame <path>", "Last frame image for frame interpolation (Veo) or Seedance end frame")
    .option("--end-image <path>", "Ending frame image for Seedance image-to-video")
    .option(
      "--ref-images <paths...>",
      "Reference images for Seedance reference-to-video or Veo character consistency"
    )
    .option("--ref-videos <paths...>", "Reference videos for Seedance reference-to-video")
    .option("--ref-audio <paths...>", "Reference audio for Seedance reference-to-video")
    .option("--no-generate-audio", "Disable native audio when the provider supports it")
    .option("--person <mode>", "Person generation: allow_all, allow_adult (Veo only)")
    .option("--veo-model <model>", "Veo model: 3.1, 3.1-fast (default: 3.1-fast)", "3.1-fast")
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
  $ vibe gen vid "epic scene" -i frame.png -o out.mp4 -p runway       # Image-to-video
  $ vibe gen vid "ocean waves" -o waves.mp4 -p veo --resolution 1080p # Veo
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
        //  - explicit -p flag wins (validated, then key-presence checked)
        //  - no flag → VIDEO_PROVIDERS priority list (Seedance via fal.ai > grok > veo > kling > runway)
        //  - if no keys at all → keep grok as last-resort default so the
        //    later requireApiKey() prints a friendly Grok-specific message
        // `fal` is intentionally still in validProviders so users hitting it
        // get the deprecation warning (below) instead of "Invalid provider".
        // It is NOT in videoEnvMap because the warning translates to seedance
        // before any map lookup runs.
        const validProviders = ["runway", "kling", "veo", "grok", "seedance", "fal", "omni"];
        const videoEnvMap: Record<string, string> = {
          grok: "XAI_API_KEY",
          veo: "GOOGLE_API_KEY",
          omni: "GOOGLE_API_KEY",
          kling: "KLING_API_KEY",
          runway: "RUNWAY_API_SECRET",
          seedance: "FAL_API_KEY",
        };
        let provider: string;
        if (options.provider) {
          provider = options.provider.toLowerCase();
          if (!validProviders.includes(provider)) {
            exitWithError(
              usageError(
                `Invalid provider: ${provider}`,
                "Available providers: seedance, grok, kling, runway, omni, veo. `fal` is a deprecated alias for seedance."
              )
            );
          }
          // Soft-deprecation: `-p fal` was the v0.x id; canonical is now
          // `seedance`. Warn once on stderr (not log/spinner — those go to
          // stdout in JSON mode), translate to canonical, then continue.
          // Review this alias at the 1.0 cut.
          if (provider === "fal") {
            process.stderr.write(
              chalk.yellow(
                "Note: `-p fal` is a deprecated alias for `-p seedance` and will be removed in 1.0.\n"
              )
            );
            provider = "seedance";
          }
          if (
            videoEnvMap[provider] &&
            !(await hasConfiguredApiKey(videoEnvMap[provider], options.apiKey))
          ) {
            const resolved = resolveProvider("video");
            if (resolved) {
              log(chalk.dim(`  ${provider} key not found. Using ${resolved.label} instead.`));
              provider = resolved.name;
            }
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

        // Veo and Runway only support 16:9 and 9:16 — clamp 1:1 to 16:9
        if ((provider === "veo" || provider === "runway") && options.ratio === "1:1") {
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
        const lifecycleWarnings = checkModelLifecycle(modelSpec);
        if (!options.dryRun) printWarnings(lifecycleWarnings);

        if (options.dryRun) {
          // For Seedance, replace the flat cost-tier upper bound with a
          // token-accurate estimate so agents can gate spend precisely. Other
          // providers fall back to the tier bound (costUsd left undefined).
          const costUsd =
            provider === "seedance" || provider === "fal"
              ? realRunCost(provider, options).costUsd
              : undefined;
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
        const apiKey = await requireApiKey(VIDEO_PROVIDER_ENV[provider], providerLabel, options.apiKey);
        const spinner = isJsonMode() ? null : ora(`Starting ${providerLabel} video generation...`).start();

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
          veoModel: options.veoModel,
          runwayModel: options.runwayModel,
          seedanceModel: options.seedanceModel,
          grokModel: options.grokModel,
          klingModel: options.klingModel,
          generateAudio: options.generateAudio,
          personGeneration: options.person,
          output: options.output,
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
                ? options.output
                  ? "Downloading video..."
                  : "Video ready"
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
            outputPath: options.output,
          });
          spinner?.succeed(chalk.green(`Generation started: ${providerLabel} task ${result.taskId}`));
          if (isJsonMode()) {
            outputSuccess({
              command: "generate video",
              startedAt,
              warnings: lifecycleWarnings,
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
        const cost = realRunCost(provider, options);
        if (isJsonMode()) {
          outputSuccess({
            command: "generate video",
            startedAt,
            costUsd: cost.costUsd,
            warnings: [...lifecycleWarnings, ...cost.warnings],
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
        exitWithError(apiError(`Video generation failed: ${(error as Error).message}`));
      }
    });
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
  if (provider === "seedance" || provider === "fal") {
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
