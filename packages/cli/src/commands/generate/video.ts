/**
 * @module generate/video
 * @description `vibe generate video` (alias `vid`) — multi-provider video
 * generation. fal.ai (Seedance 2.0), Grok, Veo (Gemini), Kling, Runway.
 * Split out of `generate.ts` in v0.69 (Plan G Phase 2).
 */

import type { Command } from "commander";
import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import chalk from "chalk";
import ora from "ora";
import imageSize from "image-size";
import {
  GeminiProvider,
  GrokProvider,
  KlingProvider,
  RunwayProvider,
  FalProvider,
} from "@vibeframe/ai-providers";
import { requireApiKey, hasApiKey } from "../../utils/api-key.js";
import { hasTTY, prompt as promptText } from "../../utils/tty.js";
import { getApiKeyFromConfig } from "../../config/index.js";
import {
  isJsonMode,
  outputSuccess,
  log,
  exitWithError,
  apiError,
  authError,
  usageError,
} from "../output.js";
import { rejectControlChars, validateOutputPath } from "../validate.js";
import { resolveProvider } from "../../utils/provider-resolver.js";
import { uploadToImgbb } from "../ai-script-pipeline.js";
import { downloadVideo } from "../ai-helpers.js";

export function registerVideoCommand(parent: Command): void {
  parent
    .command("video")
    .alias("vid")
    .description("Generate video using AI (Seedance, Grok, Kling, Runway, or Veo)")
    .argument("[prompt]", "Text prompt describing the video (interactive if omitted)")
    .option("-p, --provider <provider>", "Provider: seedance (ByteDance Seedance 2.0 via fal.ai), grok, kling, runway, veo. `fal` is a backwards-compatible alias for seedance.")
    .option("-k, --api-key <key>", "API key (or set FAL_KEY / XAI_API_KEY / RUNWAY_API_SECRET / KLING_API_KEY / GOOGLE_API_KEY env)")
    .option("-o, --output <path>", "Output file path (downloads video)")
    .option("-i, --image <path>", "Reference image for image-to-video")
    .option(
      "-d, --duration <sec>",
      "Duration in seconds. Seedance accepts 4-15 (`fal` alias supported); Kling accepts 5 or 10; Veo maps to 6 or 8.",
      "5",
    )
    .option("-r, --ratio <ratio>", "Aspect ratio: 16:9, 9:16, or 1:1 (auto-detected from image if omitted)")
    .option("-s, --seed <number>", "Random seed for reproducibility (Runway only)")
    .option("-m, --mode <mode>", "Generation mode: std or pro (Kling only)", "std")
    .option("--seedance-model <model>", "Seedance variant: quality or fast (fal.ai only)", "quality")
    .option("-n, --negative <prompt>", "Negative prompt - what to avoid (Kling/Veo)")
    .option("--resolution <res>", "Video resolution: 720p, 1080p, 4k (Veo only)")
    .option("--last-frame <path>", "Last frame image for frame interpolation (Veo only)")
    .option("--ref-images <paths...>", "Reference images for character consistency (Veo 3.1 only, max 3)")
    .option("--person <mode>", "Person generation: allow_all, allow_adult (Veo only)")
    .option("--veo-model <model>", "Veo model: 3.0, 3.1, 3.1-fast (default: 3.1-fast)", "3.1-fast")
    .option("--runway-model <model>", "Runway model: gen4.5 (default, text+image-to-video), gen4_turbo (image-to-video only)", "gen4.5")
    .option("--no-wait", "Start generation and return task ID without waiting")
    .option("--dry-run", "Preview parameters without executing")
    .addHelpText("after", `
Examples:
  $ vibe generate video "dancing cat" -o cat.mp4                      # Seedance when FAL_KEY is set
  $ vibe gen vid "cinematic city timelapse" -o city.mp4 -p seedance   # Seedance via fal.ai
  $ vibe gen vid "city timelapse" -o city.mp4 -p kling                # Kling
  $ vibe gen vid "epic scene" -i frame.png -o out.mp4 -p runway       # Image-to-video
  $ vibe gen vid "ocean waves" -o waves.mp4 -p veo --resolution 1080p # Veo
  $ vibe gen vid "sunset" -o sun.mp4 -d 10 --dry-run --json`)
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
              usageError(
                "Prompt argument is required.",
                "Usage: vibe generate video <prompt>",
              ),
            );
          }
        }
        rejectControlChars(prompt);
        if (options.output) {
          validateOutputPath(options.output);
        }

        // Resolve provider:
        //  - explicit -p flag wins (validated, then key-presence checked)
        //  - no flag → VIDEO_PROVIDERS priority list (Seedance via fal.ai > grok > veo > kling > runway)
        //  - if no keys at all → keep grok as last-resort default so the
        //    later requireApiKey() prints a friendly Grok-specific message
        const validProviders = ["runway", "kling", "veo", "grok", "seedance", "fal"];
        const videoEnvMap: Record<string, string> = {
          grok: "XAI_API_KEY",
          veo: "GOOGLE_API_KEY",
          kling: "KLING_API_KEY",
          runway: "RUNWAY_API_SECRET",
          seedance: "FAL_KEY",
          fal: "FAL_KEY",
        };
        let provider: string;
        if (options.provider) {
          provider = options.provider.toLowerCase();
          if (!validProviders.includes(provider)) {
            exitWithError(
              usageError(
                `Invalid provider: ${provider}`,
              "Available providers: seedance, grok, kling, runway, veo. `fal` is a backwards-compatible alias for seedance.",
              ),
            );
          }
          if (
            videoEnvMap[provider] &&
            !hasApiKey(videoEnvMap[provider]) &&
            !options.apiKey
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

        // Read image early so we can auto-detect aspect ratio before dry-run
        let referenceImage: string | undefined;
        let isImageToVideo = false;
        if (options.image) {
          const imagePath = resolve(process.cwd(), options.image);
          const imageBuffer = await readFile(imagePath);
          const ext = options.image.toLowerCase().split(".").pop();
          const mimeTypes: Record<string, string> = {
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            png: "image/png",
            gif: "image/gif",
            webp: "image/webp",
          };
          const mimeType = mimeTypes[ext || "png"] || "image/png";
          referenceImage = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
          isImageToVideo = true;

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
                `Auto-detected aspect ratio: ${options.ratio} (${dimensions.width}x${dimensions.height})`,
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

        if (options.dryRun) {
          outputSuccess({
            command: "generate video",
            startedAt,
            dryRun: true,
            data: {
              params: {
                prompt,
                provider: provider === "fal" ? "seedance" : provider,
                duration: options.duration,
                ratio: options.ratio,
                image: options.image,
                mode: options.mode,
                negative: options.negative,
                resolution: options.resolution,
                veoModel: options.veoModel,
                seedanceModel: options.seedanceModel,
              },
            },
          });
          return;
        }

        const envKeyMap: Record<string, string> = {
          runway: "RUNWAY_API_SECRET",
          kling: "KLING_API_KEY",
          veo: "GOOGLE_API_KEY",
          grok: "XAI_API_KEY",
          seedance: "FAL_KEY",
          fal: "FAL_KEY",
        };
        const providerNameMap: Record<string, string> = {
          runway: "Runway",
          kling: "Kling",
          veo: "Veo",
          grok: "Grok",
          seedance: "Seedance 2.0 via fal.ai",
          fal: "Seedance 2.0 via fal.ai",
        };
        const envKey = envKeyMap[provider];
        const providerName = providerNameMap[provider];
        const apiKey = await requireApiKey(envKey, providerName, options.apiKey);

        // Runway gen4_turbo requires an input image; gen4.5 supports text-to-video
        const runwayModel = (options.runwayModel as string) || "gen4.5";
        if (provider === "runway" && !options.image && runwayModel !== "gen4.5") {
          exitWithError(
            usageError(
              `Runway ${runwayModel} requires an input image. Use -i <image> or use gen4.5 for text-to-video.`,
            ),
          );
        }

        const spinner = ora(`Initializing ${providerName}...`).start();

        spinner.text = "Starting video generation...";

        let result;
        let finalResult;

        if (provider === "runway") {
          const runway = new RunwayProvider();
          await runway.initialize({ apiKey });

          result = await runway.generateVideo(prompt, {
            prompt,
            referenceImage,
            model: runwayModel,
            duration: parseInt(options.duration),
            aspectRatio: options.ratio as "16:9" | "9:16",
            seed: options.seed ? parseInt(options.seed) : undefined,
          });

          if (result.status === "failed") {
            spinner.fail(result.error || "Failed to start generation");
            exitWithError(apiError(result.error || "Failed to start generation", true));
          }

          console.log();
          console.log(chalk.bold.cyan("Video Generation Started"));
          console.log(chalk.dim("─".repeat(60)));
          console.log(`Provider: ${chalk.bold(`Runway ${runwayModel}`)}`);
          console.log(`Task ID: ${chalk.bold(result.id)}`);

          if (!options.wait) {
            spinner.succeed(chalk.green("Generation started"));
            console.log();
            console.log(chalk.dim("Check status with:"));
            console.log(chalk.dim(`  vibe generate video-status ${result.id} -p runway`));
            console.log();
            return;
          }

          spinner.text = "Generating video (this may take 1-2 minutes)...";

          finalResult = await runway.waitForCompletion(
            result.id,
            (status) => {
              if (status.progress !== undefined) {
                spinner.text = `Generating video... ${status.progress}%`;
              }
            },
            300000,
          );
        } else if (provider === "kling") {
          const kling = new KlingProvider();
          await kling.initialize({ apiKey });

          if (!kling.isConfigured()) {
            spinner.fail("Invalid API key format");
            exitWithError(authError("KLING_API_KEY", "Kling"));
          }

          // Kling v2.x requires image URL, not base64 — auto-upload to ImgBB
          let klingImage = referenceImage;
          if (klingImage && klingImage.startsWith("data:")) {
            spinner.text = "Uploading image to ImgBB for Kling...";
            const imgbbKey = (await getApiKeyFromConfig("imgbb")) || process.env.IMGBB_API_KEY;
            if (!imgbbKey) {
              spinner.fail("ImgBB API key required");
              exitWithError(authError("IMGBB_API_KEY", "ImgBB"));
            }
            const base64Data = klingImage.split(",")[1];
            const imageBuffer = Buffer.from(base64Data, "base64");
            const uploadResult = await uploadToImgbb(imageBuffer, imgbbKey);
            if (!uploadResult.success || !uploadResult.url) {
              spinner.fail("ImgBB upload failed");
              exitWithError(apiError(`ImgBB upload failed: ${uploadResult.error}`, true));
            }
            klingImage = uploadResult.url;
            spinner.text = "Starting video generation...";
          }

          result = await kling.generateVideo(prompt, {
            prompt,
            referenceImage: klingImage,
            duration: parseInt(options.duration) as 5 | 10,
            aspectRatio: options.ratio as "16:9" | "9:16" | "1:1",
            negativePrompt: options.negative,
            mode: options.mode as "std" | "pro",
          });

          if (result.status === "failed") {
            spinner.fail(result.error || "Failed to start generation");
            exitWithError(apiError(result.error || "Failed to start generation", true));
          }

          console.log();
          console.log(chalk.bold.cyan("Video Generation Started"));
          console.log(chalk.dim("─".repeat(60)));
          console.log(`Provider: ${chalk.bold("Kling AI")}`);
          console.log(`Task ID: ${chalk.bold(result.id)}`);
          console.log(`Type: ${isImageToVideo ? "image2video" : "text2video"}`);

          if (!options.wait) {
            spinner.succeed(chalk.green("Generation started"));
            console.log();
            console.log(chalk.dim("Check status with:"));
            console.log(
              chalk.dim(
                `  vibe generate video-status ${result.id} -p kling${isImageToVideo ? " --type image2video" : ""}`,
              ),
            );
            console.log();
            return;
          }

          spinner.text = "Generating video (this may take 2-5 minutes)...";

          const taskType = isImageToVideo ? "image2video" : "text2video";
          finalResult = await kling.waitForCompletion(
            result.id,
            taskType,
            (status) => {
              spinner.text = `Generating video... ${status.status}`;
            },
            600000,
          );
        } else if (provider === "veo") {
          const gemini = new GeminiProvider();
          await gemini.initialize({ apiKey });

          // Map Veo model alias to full model ID
          const veoModelMap: Record<string, string> = {
            "3.0": "veo-3.0-generate-preview",
            "3.1": "veo-3.1-generate-preview",
            "3.1-fast": "veo-3.1-fast-generate-preview",
          };
          const veoModel =
            veoModelMap[options.veoModel] || "veo-3.1-fast-generate-preview";

          const veoDuration = parseInt(options.duration) <= 6 ? 6 : 8;

          // Prepare last frame if provided
          let lastFrame: string | undefined;
          if (options.lastFrame) {
            const lastFramePath = resolve(process.cwd(), options.lastFrame);
            const lastFrameBuffer = await readFile(lastFramePath);
            const ext = options.lastFrame.toLowerCase().split(".").pop();
            const mimeType =
              ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext || "png"}`;
            lastFrame = `data:${mimeType};base64,${lastFrameBuffer.toString("base64")}`;
          }

          // Prepare reference images if provided
          let refImages: Array<{ base64: string; mimeType: string }> | undefined;
          if (options.refImages && options.refImages.length > 0) {
            refImages = [];
            for (const refPath of options.refImages.slice(0, 3)) {
              const absRefPath = resolve(process.cwd(), refPath);
              const refBuffer = await readFile(absRefPath);
              const ext = refPath.toLowerCase().split(".").pop();
              const mimeType =
                ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext || "png"}`;
              refImages.push({ base64: refBuffer.toString("base64"), mimeType });
            }
          }

          result = await gemini.generateVideo(prompt, {
            prompt,
            referenceImage,
            duration: veoDuration,
            aspectRatio: options.ratio as "16:9" | "9:16" | "1:1",
            model: veoModel as
              | "veo-3.0-generate-preview"
              | "veo-3.1-generate-preview"
              | "veo-3.1-fast-generate-preview",
            negativePrompt: options.negative,
            resolution: options.resolution as "720p" | "1080p" | "4k" | undefined,
            lastFrame,
            referenceImages: refImages,
            personGeneration: options.person as "allow_all" | "allow_adult" | undefined,
          });

          if (result.status === "failed") {
            spinner.fail(result.error || "Failed to start generation");
            exitWithError(apiError(result.error || "Failed to start generation", true));
          }

          console.log();
          console.log(chalk.bold.cyan("Video Generation Started"));
          console.log(chalk.dim("─".repeat(60)));
          console.log(`Provider: ${chalk.bold("Google Veo 3.1")}`);
          console.log(`Task ID: ${chalk.bold(result.id)}`);

          if (!options.wait) {
            spinner.succeed(chalk.green("Generation started"));
            console.log();
            console.log(chalk.dim("Veo generation is synchronous - video URL available above"));
            console.log();
            return;
          }

          spinner.text = "Generating video (this may take 1-3 minutes)...";
          finalResult = await gemini.waitForVideoCompletion(
            result.id,
            (status) => {
              spinner.text = `Generating video... ${status.status}`;
            },
            300000,
          );
        } else if (provider === "grok") {
          const grok = new GrokProvider();
          await grok.initialize({ apiKey });

          result = await grok.generateVideo(prompt, {
            prompt,
            referenceImage,
            duration: parseInt(options.duration),
            aspectRatio: options.ratio as "16:9" | "9:16" | "1:1",
          });

          if (result.status === "failed") {
            spinner.fail(result.error || "Failed to start generation");
            exitWithError(apiError(result.error || "Failed to start generation", true));
          }

          console.log();
          console.log(chalk.bold.cyan("Video Generation Started"));
          console.log(chalk.dim("─".repeat(60)));
          console.log(`Provider: ${chalk.bold("xAI Grok Imagine")}`);
          console.log(`Task ID: ${chalk.bold(result.id)}`);

          if (!options.wait) {
            spinner.succeed(chalk.green("Generation started"));
            console.log();
            console.log(chalk.dim("Check status with:"));
            console.log(chalk.dim(`  vibe generate video-status ${result.id} -p grok`));
            console.log();
            return;
          }

          spinner.text = "Generating video (this may take 1-3 minutes)...";
          finalResult = await grok.waitForCompletion(
            result.id,
            (status) => {
              spinner.text = `Generating video... ${status.status}`;
            },
            300000,
          );
        } else if (provider === "fal" || provider === "seedance") {
          // fal.ai → ByteDance Seedance 2.0 (Artificial Analysis #2 on
          // both video leaderboards). The fal client's `subscribe` blocks
          // until the queue produces a final URL, so we don't need a
          // separate wait/poll loop like the other providers.
          const fal = new FalProvider();
          await fal.initialize({ apiKey });

          // Seedance 2.0 image-to-video needs an HTTPS URL. base64 / data
          // URIs aren't accepted, so reuse the same ImgBB upload trick
          // Kling uses when an image was passed via `-i`.
          let falImage = referenceImage;
          if (falImage && falImage.startsWith("data:")) {
            spinner.text = "Uploading image to ImgBB for Seedance...";
            const imgbbKey = (await getApiKeyFromConfig("imgbb")) || process.env.IMGBB_API_KEY;
            if (!imgbbKey) {
              spinner.fail("ImgBB API key required for Seedance image-to-video");
              exitWithError(authError("IMGBB_API_KEY", "ImgBB"));
            }
            const base64Data = falImage.split(",")[1];
            const imageBuffer = Buffer.from(base64Data, "base64");
            const uploadResult = await uploadToImgbb(imageBuffer, imgbbKey);
            if (!uploadResult.success || !uploadResult.url) {
              spinner.fail("ImgBB upload failed");
              exitWithError(apiError(`ImgBB upload failed: ${uploadResult.error}`, true));
            }
            falImage = uploadResult.url;
          }

          spinner.text = "Generating video with fal.ai Seedance 2.0 (this may take 1-3 minutes)...";
          const seedanceModel = String(options.seedanceModel ?? "quality").toLowerCase();
          const falModel =
            seedanceModel === "fast" || seedanceModel === "seedance-2.0-fast"
              ? "seedance-2.0-fast"
              : "seedance-2.0";
          result = await fal.generateVideo(prompt, {
            prompt,
            referenceImage: falImage,
            duration: options.duration ? parseInt(options.duration) : undefined,
            aspectRatio: options.ratio as "16:9" | "9:16" | "1:1" | "4:5",
            negativePrompt: options.negative,
            model: falModel,
          });
          finalResult = result;
        }

        if (!finalResult || finalResult.status !== "completed") {
          spinner.fail(finalResult?.error || "Generation failed");
          exitWithError(apiError(finalResult?.error || "Generation failed", true));
        }

        spinner.succeed(chalk.green("Video generated"));

        if (isJsonMode()) {
          let outputPath: string | undefined;
          if (options.output && finalResult.videoUrl) {
            const buffer = await downloadVideo(finalResult.videoUrl, apiKey);
            outputPath = resolve(process.cwd(), options.output);
            await writeFile(outputPath, buffer);
          }
          outputSuccess({
            command: "generate video",
            startedAt,
            data: {
              provider,
              taskId: result?.id,
              videoUrl: finalResult.videoUrl,
              duration: finalResult.duration,
              outputPath,
            },
          });
          return;
        }

        console.log();
        if (finalResult.videoUrl) {
          console.log(`Video URL: ${finalResult.videoUrl}`);
        }
        if (finalResult.duration) {
          console.log(`Duration: ${finalResult.duration}s`);
        }
        console.log();

        if (options.output && finalResult.videoUrl) {
          const downloadSpinner = ora("Downloading video...").start();
          try {
            const buffer = await downloadVideo(finalResult.videoUrl, apiKey);
            const outputPath = resolve(process.cwd(), options.output);
            await writeFile(outputPath, buffer);
            downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
          } catch (err) {
            downloadSpinner.fail(
              chalk.red(
                `Failed to download video: ${err instanceof Error ? err.message : err}`,
              ),
            );
          }
        }
      } catch (error) {
        exitWithError(apiError(`Video generation failed: ${(error as Error).message}`));
      }
    });
}
