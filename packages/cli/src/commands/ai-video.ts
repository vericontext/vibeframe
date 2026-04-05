/**
 * @module ai-video
 * @description Video generation and management commands for the VibeFrame CLI.
 *
 * ## Commands: vibe ai video, vibe ai video-status, vibe ai video-cancel,
 *             vibe ai kling, vibe ai kling-status, vibe ai video-extend
 * ## Dependencies: Runway, Kling, Veo (Gemini)
 *
 * Extracted from ai.ts as part of modularisation.
 * ai.ts calls registerVideoCommands(aiCommand).
 * @see MODELS.md for AI model configuration
 */

import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { GeminiProvider, GrokProvider, KlingProvider, RunwayProvider } from "@vibeframe/ai-providers";
import { getApiKey } from "../utils/api-key.js";
import { getApiKeyFromConfig } from "../config/index.js";
import { uploadToImgbb } from "./ai-script-pipeline.js";
import { downloadVideo } from "./ai-helpers.js";
import { exitWithError, authError, usageError, apiError, generalError, outputResult } from "./output.js";
import { validateOutputPath } from "./validate.js";

function getStatusColor(status: string): string {
  switch (status) {
    case "completed":
      return chalk.green(status);
    case "processing":
    case "running":
    case "in_progress":
      return chalk.yellow(status);
    case "failed":
    case "error":
      return chalk.red(status);
    default:
      return chalk.gray(status);
  }
}

export function registerVideoCommands(aiCommand: Command): void {
  aiCommand
    .command("video")
    .description("Generate video using AI (Grok, Runway, Kling, or Veo)")
    .argument("<prompt>", "Text prompt describing the video")
    .option("-p, --provider <provider>", "Provider: grok, kling, runway, veo", "kling")
    .option("-k, --api-key <key>", "API key (or set RUNWAY_API_SECRET / KLING_API_KEY / GOOGLE_API_KEY env)")
    .option("-o, --output <path>", "Output file path (downloads video)")
    .option("-i, --image <path>", "Reference image for image-to-video")
    .option("-d, --duration <sec>", "Duration: 5 or 10 seconds", "5")
    .option("-r, --ratio <ratio>", "Aspect ratio: 16:9, 9:16, or 1:1", "16:9")
    .option("-s, --seed <number>", "Random seed for reproducibility (Runway only)")
    .option("-m, --mode <mode>", "Generation mode: std or pro (Kling only)", "std")
    .option("-n, --negative <prompt>", "Negative prompt - what to avoid (Kling/Veo)")
    .option("--resolution <res>", "Video resolution: 720p, 1080p, 4k (Veo only)")
    .option("--last-frame <path>", "Last frame image for frame interpolation (Veo only)")
    .option("--ref-images <paths...>", "Reference images for character consistency (Veo 3.1 only, max 3)")
    .option("--person <mode>", "Person generation: allow_all, allow_adult (Veo only)")
    .option("--veo-model <model>", "Veo model: 3.0, 3.1, 3.1-fast (default: 3.1-fast)", "3.1-fast")
    .option("--runway-model <model>", "Runway model: gen4.5 (default, text+image-to-video), gen4_turbo (image-to-video only)", "gen4.5")
    .option("--no-wait", "Start generation and return task ID without waiting")
    .option("--dry-run", "Preview parameters without executing")
    .action(async (prompt: string, options) => {
      try {
        if (options.output) {
          validateOutputPath(options.output);
        }

        const provider = options.provider.toLowerCase();
        const validProviders = ["grok", "runway", "kling", "veo"];
        if (!validProviders.includes(provider)) {
          exitWithError(usageError(`Invalid provider: ${provider}`, `Available providers: ${validProviders.join(", ")}`));
        }

        if (options.dryRun) {
          outputResult({ dryRun: true, command: "ai video", params: { prompt, provider, output: options.output, image: options.image, duration: options.duration, ratio: options.ratio, mode: options.mode, runwayModel: options.runwayModel, veoModel: options.veoModel } });
          return;
        }

        const envKeyMap: Record<string, string> = {
          grok: "XAI_API_KEY",
          runway: "RUNWAY_API_SECRET",
          kling: "KLING_API_KEY",
          veo: "GOOGLE_API_KEY",
        };
        const providerNameMap: Record<string, string> = {
          grok: "Grok",
          runway: "Runway",
          kling: "Kling",
          veo: "Veo",
        };
        const envKey = envKeyMap[provider];
        const providerName = providerNameMap[provider];
        const apiKey = await getApiKey(envKey, providerName, options.apiKey);
        if (!apiKey) {
          exitWithError(authError(envKey, providerName));
        }

        // Runway gen4_turbo requires an input image (gen4.5 supports text-to-video)
        const runwayModel = options.runwayModel || "gen4.5";
        if (provider === "runway" && !options.image && runwayModel === "gen4_turbo") {
          exitWithError(usageError("Runway gen4_turbo requires an input image. Use -i <image> to specify.", "Tip: Use gen4.5 (default) for text-to-video, or provide -i <image>"));
        }

        const spinner = ora(`Initializing ${providerName}...`).start();

        let referenceImage: string | undefined;
        let isImageToVideo = false;
        if (options.image) {
          spinner.text = "Reading reference image...";
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
        }

        spinner.text = "Starting video generation...";

        let result;
        let finalResult;

        if (provider === "runway") {
          const runway = new RunwayProvider();
          await runway.initialize({ apiKey });

          result = await runway.generateVideo(prompt, {
            prompt,
            referenceImage,
            duration: parseInt(options.duration) as 5 | 10,
            aspectRatio: options.ratio as "16:9" | "9:16",
            seed: options.seed ? parseInt(options.seed) : undefined,
          });

          if (result.status === "failed") {
            spinner.fail(result.error || "Failed to start generation");
            exitWithError(apiError(result.error || "Failed to start Runway generation", true));
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
            console.log(chalk.dim(`  vibe ai video-status ${result.id}`));
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
            300000
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
              spinner.fail("Kling requires image URL. Set IMGBB_API_KEY for auto-upload.");
              exitWithError(authError("IMGBB_API_KEY", "ImgBB"));
            }
            // Extract raw base64 from data URI
            const base64Data = klingImage.split(",")[1];
            const imageBuffer = Buffer.from(base64Data, "base64");
            const uploadResult = await uploadToImgbb(imageBuffer, imgbbKey);
            if (!uploadResult.success || !uploadResult.url) {
              spinner.fail(`ImgBB upload failed: ${uploadResult.error}`);
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
            exitWithError(apiError(result.error || "Failed to start Kling generation", true));
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
            console.log(chalk.dim(`  vibe ai kling-status ${result.id}${isImageToVideo ? " --type image2video" : ""}`));
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
            600000
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
          const veoModel = veoModelMap[options.veoModel] || "veo-3.1-fast-generate-preview";

          const veoDuration = parseInt(options.duration) <= 6 ? 6 : 8;

          // Prepare last frame if provided
          let lastFrame: string | undefined;
          if (options.lastFrame) {
            const lastFramePath = resolve(process.cwd(), options.lastFrame);
            const lastFrameBuffer = await readFile(lastFramePath);
            const ext = options.lastFrame.toLowerCase().split(".").pop();
            const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext || "png"}`;
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
              const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext || "png"}`;
              refImages.push({ base64: refBuffer.toString("base64"), mimeType });
            }
          }

          result = await gemini.generateVideo(prompt, {
            prompt,
            referenceImage,
            duration: veoDuration,
            aspectRatio: options.ratio as "16:9" | "9:16" | "1:1",
            model: veoModel as "veo-3.0-generate-preview" | "veo-3.1-generate-preview" | "veo-3.1-fast-generate-preview",
            negativePrompt: options.negative,
            resolution: options.resolution as "720p" | "1080p" | "4k" | undefined,
            lastFrame,
            referenceImages: refImages,
            personGeneration: options.person as "allow_all" | "allow_adult" | undefined,
          });

          if (result.status === "failed") {
            spinner.fail(result.error || "Failed to start generation");
            exitWithError(apiError(result.error || "Failed to start Veo generation", true));
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
            300000
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
            exitWithError(apiError(result.error || "Failed to start Grok generation", true));
          }

          console.log();
          console.log(chalk.bold.cyan("Video Generation Started"));
          console.log(chalk.dim("─".repeat(60)));
          console.log(`Provider: ${chalk.bold("Grok Imagine")}`);
          console.log(`Task ID: ${chalk.bold(result.id)}`);

          if (!options.wait) {
            spinner.succeed(chalk.green("Generation started"));
            console.log();
            return;
          }

          spinner.text = "Generating video (this may take 1-3 minutes)...";

          finalResult = await grok.waitForCompletion(
            result.id,
            (status) => {
              spinner.text = `Generating video... ${status.status}`;
            },
            300000
          );
        }

        if (!finalResult || finalResult.status !== "completed") {
          spinner.fail(finalResult?.error || "Generation failed");
          exitWithError(apiError(finalResult?.error || "Video generation failed", true));
        }

        spinner.succeed(chalk.green("Video generated"));

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
            downloadSpinner.fail(chalk.red(`Failed to download video: ${err instanceof Error ? err.message : err}`));
          }
        }
      } catch (error) {
        exitWithError(generalError(error instanceof Error ? error.message : "Video generation failed"));
      }
    });

  aiCommand
    .command("video-status")
    .description("Check Runway video generation status")
    .argument("<task-id>", "Task ID from video generation")
    .option("-k, --api-key <key>", "Runway API key (or set RUNWAY_API_SECRET env)")
    .option("-w, --wait", "Wait for completion")
    .option("-o, --output <path>", "Download video when complete")
    .action(async (taskId: string, options) => {
      try {
        if (options.output) {
          validateOutputPath(options.output);
        }

        const apiKey = await getApiKey("RUNWAY_API_SECRET", "Runway", options.apiKey);
        if (!apiKey) {
          exitWithError(authError("RUNWAY_API_SECRET", "Runway"));
        }

        const spinner = ora("Checking status...").start();

        const runway = new RunwayProvider();
        await runway.initialize({ apiKey });

        let result = await runway.getGenerationStatus(taskId);

        if (options.wait && result.status !== "completed" && result.status !== "failed" && result.status !== "cancelled") {
          spinner.text = "Waiting for completion...";
          result = await runway.waitForCompletion(
            taskId,
            (status) => {
              if (status.progress !== undefined) {
                spinner.text = `Generating... ${status.progress}%`;
              }
            }
          );
        }

        spinner.stop();

        console.log();
        console.log(chalk.bold.cyan("Generation Status"));
        console.log(chalk.dim("─".repeat(60)));
        console.log(`Task ID: ${taskId}`);
        console.log(`Status: ${getStatusColor(result.status)}`);
        if (result.progress !== undefined) {
          console.log(`Progress: ${result.progress}%`);
        }
        if (result.videoUrl) {
          console.log(`Video URL: ${result.videoUrl}`);
        }
        if (result.error) {
          console.log(`Error: ${chalk.red(result.error)}`);
        }
        console.log();

        if (options.output && result.videoUrl) {
          const downloadSpinner = ora("Downloading video...").start();
          try {
            const buffer = await downloadVideo(result.videoUrl, apiKey);
            const outputPath = resolve(process.cwd(), options.output);
            await writeFile(outputPath, buffer);
            downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
          } catch (err) {
            downloadSpinner.fail(chalk.red(`Failed to download video: ${err instanceof Error ? err.message : err}`));
          }
        }
      } catch (error) {
        exitWithError(generalError(error instanceof Error ? error.message : "Failed to get status"));
      }
    });

  aiCommand
    .command("video-cancel")
    .description("Cancel Runway video generation")
    .argument("<task-id>", "Task ID to cancel")
    .option("-k, --api-key <key>", "Runway API key (or set RUNWAY_API_SECRET env)")
    .option("--dry-run", "Preview parameters without executing")
    .action(async (taskId: string, options) => {
      try {
        if (options.dryRun) {
          outputResult({ dryRun: true, command: "ai video-cancel", params: { taskId } });
          return;
        }

        const apiKey = await getApiKey("RUNWAY_API_SECRET", "Runway", options.apiKey);
        if (!apiKey) {
          exitWithError(authError("RUNWAY_API_SECRET", "Runway"));
        }

        const spinner = ora("Cancelling generation...").start();

        const runway = new RunwayProvider();
        await runway.initialize({ apiKey });

        const success = await runway.cancelGeneration(taskId);

        if (success) {
          spinner.succeed(chalk.green("Generation cancelled"));
        } else {
          spinner.fail("Failed to cancel generation");
          exitWithError(apiError("Failed to cancel generation", true));
        }
      } catch (error) {
        exitWithError(generalError(error instanceof Error ? error.message : "Failed to cancel generation"));
      }
    });

  aiCommand
    .command("kling")
    .description("Generate video using Kling AI")
    .argument("<prompt>", "Text prompt describing the video")
    .option("-k, --api-key <key>", "Kling API key (ACCESS_KEY:SECRET_KEY) or set KLING_API_KEY env")
    .option("-o, --output <path>", "Output file path (downloads video)")
    .option("-i, --image <path>", "Reference image for image-to-video")
    .option("-d, --duration <sec>", "Duration: 5 or 10 seconds", "5")
    .option("-r, --ratio <ratio>", "Aspect ratio: 16:9, 9:16, or 1:1", "16:9")
    .option("-m, --mode <mode>", "Generation mode: std (standard) or pro", "pro")
    .option("-n, --negative <prompt>", "Negative prompt (what to avoid)")
    .option("--no-wait", "Start generation and return task ID without waiting")
    .option("--dry-run", "Preview parameters without executing")
    .action(async (prompt: string, options) => {
      try {
        if (options.output) {
          validateOutputPath(options.output);
        }

        if (options.dryRun) {
          outputResult({ dryRun: true, command: "ai kling", params: { prompt, output: options.output, image: options.image, duration: options.duration, ratio: options.ratio, mode: options.mode, negative: options.negative } });
          return;
        }

        const apiKey = await getApiKey("KLING_API_KEY", "Kling", options.apiKey);
        if (!apiKey) {
          exitWithError(authError("KLING_API_KEY", "Kling"));
        }

        const spinner = ora("Initializing Kling AI...").start();

        const kling = new KlingProvider();
        await kling.initialize({ apiKey });

        if (!kling.isConfigured()) {
          spinner.fail("Invalid API key format");
          exitWithError(authError("KLING_API_KEY", "Kling"));
        }

        let referenceImage: string | undefined;
        let isImageToVideo = false;
        if (options.image) {
          spinner.text = "Reading reference image...";
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
        }

        // Kling v2.x requires image URL, not base64 — auto-upload to ImgBB
        let klingImage = referenceImage;
        if (klingImage && klingImage.startsWith("data:")) {
          spinner.text = "Uploading image to ImgBB for Kling...";
          const imgbbKey = (await getApiKeyFromConfig("imgbb")) || process.env.IMGBB_API_KEY;
          if (!imgbbKey) {
            spinner.fail("Kling requires image URL. Set IMGBB_API_KEY for auto-upload.");
            exitWithError(authError("IMGBB_API_KEY", "ImgBB"));
          }
          const base64Data = klingImage.split(",")[1];
          const imageBuffer = Buffer.from(base64Data, "base64");
          const uploadResult = await uploadToImgbb(imageBuffer, imgbbKey);
          if (!uploadResult.success || !uploadResult.url) {
            spinner.fail(`ImgBB upload failed: ${uploadResult.error}`);
            exitWithError(apiError(`ImgBB upload failed: ${uploadResult.error}`, true));
          }
          klingImage = uploadResult.url;
        }

        spinner.text = "Starting video generation...";

        const result = await kling.generateVideo(prompt, {
          prompt,
          referenceImage: klingImage,
          duration: parseInt(options.duration) as 5 | 10,
          aspectRatio: options.ratio as "16:9" | "9:16" | "1:1",
          negativePrompt: options.negative,
          mode: options.mode as "std" | "pro",
        });

        if (result.status === "failed") {
          spinner.fail(result.error || "Failed to start generation");
          exitWithError(apiError(result.error || "Failed to start Kling generation", true));
        }

        console.log();
        console.log(chalk.bold.cyan("Kling Video Generation Started"));
        console.log(chalk.dim("─".repeat(60)));
        console.log(`Task ID: ${chalk.bold(result.id)}`);
        console.log(`Type: ${isImageToVideo ? "image2video" : "text2video"}`);

        if (!options.wait) {
          spinner.succeed(chalk.green("Generation started"));
          console.log();
          console.log(chalk.dim("Check status with:"));
          console.log(chalk.dim(`  vibe ai kling-status ${result.id}${isImageToVideo ? " --type image2video" : ""}`));
          console.log();
          return;
        }

        spinner.text = "Generating video (this may take 2-5 minutes)...";

        const taskType = isImageToVideo ? "image2video" : "text2video";
        const finalResult = await kling.waitForCompletion(
          result.id,
          taskType,
          (status) => {
            spinner.text = `Generating video... ${status.status}`;
          },
          600000
        );

        if (finalResult.status !== "completed") {
          spinner.fail(finalResult.error || "Generation failed");
          exitWithError(apiError(finalResult.error || "Kling video generation failed", true));
        }

        spinner.succeed(chalk.green("Video generated"));

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
            downloadSpinner.fail(chalk.red(`Failed to download video: ${err instanceof Error ? err.message : err}`));
          }
        }
      } catch (error) {
        exitWithError(generalError(error instanceof Error ? error.message : "Video generation failed"));
      }
    });

  aiCommand
    .command("kling-status")
    .description("Check Kling video generation status")
    .argument("<task-id>", "Task ID from video generation")
    .option("-k, --api-key <key>", "Kling API key (or set KLING_API_KEY env)")
    .option("-t, --type <type>", "Task type: text2video or image2video", "text2video")
    .option("-w, --wait", "Wait for completion")
    .option("-o, --output <path>", "Download video when complete")
    .action(async (taskId: string, options) => {
      try {
        if (options.output) {
          validateOutputPath(options.output);
        }

        const apiKey = await getApiKey("KLING_API_KEY", "Kling", options.apiKey);
        if (!apiKey) {
          exitWithError(authError("KLING_API_KEY", "Kling"));
        }

        const spinner = ora("Checking status...").start();

        const kling = new KlingProvider();
        await kling.initialize({ apiKey });

        const taskType = options.type as "text2video" | "image2video";
        let result = await kling.getGenerationStatus(taskId, taskType);

        if (options.wait && result.status !== "completed" && result.status !== "failed" && result.status !== "cancelled") {
          spinner.text = "Waiting for completion...";
          result = await kling.waitForCompletion(
            taskId,
            taskType,
            (status) => {
              spinner.text = `Generating... ${status.status}`;
            }
          );
        }

        spinner.stop();

        console.log();
        console.log(chalk.bold.cyan("Kling Generation Status"));
        console.log(chalk.dim("─".repeat(60)));
        console.log(`Task ID: ${taskId}`);
        console.log(`Type: ${taskType}`);
        console.log(`Status: ${getStatusColor(result.status)}`);
        if (result.videoUrl) {
          console.log(`Video URL: ${result.videoUrl}`);
        }
        if (result.duration) {
          console.log(`Duration: ${result.duration}s`);
        }
        if (result.error) {
          console.log(`Error: ${chalk.red(result.error)}`);
        }
        console.log();

        if (options.output && result.videoUrl) {
          const downloadSpinner = ora("Downloading video...").start();
          try {
            const buffer = await downloadVideo(result.videoUrl, apiKey);
            const outputPath = resolve(process.cwd(), options.output);
            await writeFile(outputPath, buffer);
            downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
          } catch (err) {
            downloadSpinner.fail(chalk.red(`Failed to download video: ${err instanceof Error ? err.message : err}`));
          }
        }
      } catch (error) {
        exitWithError(generalError(error instanceof Error ? error.message : "Failed to get Kling status"));
      }
    });

  aiCommand
    .command("video-extend")
    .description("Extend video duration using Kling AI (requires Kling video ID)")
    .argument("<video-id>", "Kling video ID (from generation result)")
    .option("-k, --api-key <key>", "Kling API key (ACCESS_KEY:SECRET_KEY) or set KLING_API_KEY env")
    .option("-o, --output <path>", "Output file path")
    .option("--prompt <text>", "Continuation prompt")
    .option("-d, --duration <sec>", "Duration: 5 or 10 seconds", "5")
    .option("-n, --negative <prompt>", "Negative prompt (what to avoid)")
    .option("--no-wait", "Start generation and return task ID without waiting")
    .option("--dry-run", "Preview parameters without executing")
    .action(async (videoId: string, options) => {
      try {
        if (options.output) {
          validateOutputPath(options.output);
        }

        if (options.dryRun) {
          outputResult({ dryRun: true, command: "ai video-extend", params: { videoId, output: options.output, prompt: options.prompt, duration: options.duration, negative: options.negative } });
          return;
        }

        const apiKey = await getApiKey("KLING_API_KEY", "Kling", options.apiKey);
        if (!apiKey) {
          exitWithError(authError("KLING_API_KEY", "Kling"));
        }

        const spinner = ora("Initializing Kling AI...").start();

        const kling = new KlingProvider();
        await kling.initialize({ apiKey });

        if (!kling.isConfigured()) {
          spinner.fail("Invalid API key format");
          exitWithError(authError("KLING_API_KEY", "Kling"));
        }

        spinner.text = "Starting video extension...";

        const result = await kling.extendVideo(videoId, {
          prompt: options.prompt,
          negativePrompt: options.negative,
          duration: options.duration as "5" | "10",
        });

        if (result.status === "failed") {
          spinner.fail(result.error || "Failed to start extension");
          exitWithError(apiError(result.error || "Failed to start Kling video extension", true));
        }

        console.log();
        console.log(chalk.bold.cyan("Video Extension Started"));
        console.log(chalk.dim("─".repeat(60)));
        console.log(`Task ID: ${chalk.bold(result.id)}`);

        if (!options.wait) {
          spinner.succeed(chalk.green("Extension started"));
          console.log();
          console.log(chalk.dim("Check status with:"));
          console.log(chalk.dim(`  pnpm vibe ai video-extend-status ${result.id}`));
          console.log();
          return;
        }

        spinner.text = "Extending video (this may take 2-5 minutes)...";

        const finalResult = await kling.waitForExtendCompletion(
          result.id,
          (status) => {
            spinner.text = `Extending video... ${status.status}`;
          },
          600000
        );

        if (finalResult.status !== "completed") {
          spinner.fail(finalResult.error || "Extension failed");
          exitWithError(apiError(finalResult.error || "Kling video extension failed", true));
        }

        spinner.succeed(chalk.green("Video extended"));

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
            downloadSpinner.fail(chalk.red(`Failed to download video: ${err instanceof Error ? err.message : err}`));
          }
        }
      } catch (error) {
        exitWithError(generalError(error instanceof Error ? error.message : "Video extension failed"));
      }
    });

  aiCommand
    .command("veo-extend")
    .description("Extend a Veo video using the operation name from a previous generation")
    .argument("<operation-name>", "Veo operation name (from generation result)")
    .option("-k, --api-key <key>", "Google API key (or set GOOGLE_API_KEY env)")
    .option("-o, --output <path>", "Output file path")
    .option("--prompt <text>", "Continuation prompt")
    .option("-d, --duration <sec>", "Duration: 4, 6, or 8 seconds", "6")
    .option("--veo-model <model>", "Veo model: 3.0, 3.1, 3.1-fast", "3.1")
    .option("--no-wait", "Start extension and return operation name without waiting")
    .option("--dry-run", "Preview parameters without executing")
    .action(async (operationName: string, options) => {
      try {
        if (options.output) {
          validateOutputPath(options.output);
        }

        if (options.dryRun) {
          outputResult({ dryRun: true, command: "ai veo-extend", params: { operationName, output: options.output, prompt: options.prompt, duration: options.duration, veoModel: options.veoModel } });
          return;
        }

        const apiKey = await getApiKey("GOOGLE_API_KEY", "Google", options.apiKey);
        if (!apiKey) {
          exitWithError(authError("GOOGLE_API_KEY", "Google"));
        }

        const spinner = ora("Initializing Veo...").start();

        const gemini = new GeminiProvider();
        await gemini.initialize({ apiKey });

        const veoModelMap: Record<string, string> = {
          "3.0": "veo-3.0-generate-preview",
          "3.1": "veo-3.1-generate-preview",
          "3.1-fast": "veo-3.1-fast-generate-preview",
        };
        const veoModel = veoModelMap[options.veoModel] || "veo-3.1-generate-preview";

        spinner.text = "Starting video extension...";

        const result = await gemini.extendVideo(operationName, options.prompt, {
          duration: parseInt(options.duration) as 4 | 6 | 8,
          model: veoModel as "veo-3.0-generate-preview" | "veo-3.1-generate-preview" | "veo-3.1-fast-generate-preview",
        });

        if (result.status === "failed") {
          spinner.fail(result.error || "Failed to start extension");
          exitWithError(apiError(result.error || "Failed to start Veo video extension", true));
        }

        console.log();
        console.log(chalk.bold.cyan("Veo Video Extension Started"));
        console.log(chalk.dim("─".repeat(60)));
        console.log(`Operation: ${chalk.bold(result.id)}`);

        if (!options.wait) {
          spinner.succeed(chalk.green("Extension started"));
          console.log();
          console.log(chalk.dim("Check status or wait with:"));
          console.log(chalk.dim(`  vibe ai veo-extend ${result.id} --wait`));
          console.log();
          return;
        }

        spinner.text = "Extending video (this may take 1-3 minutes)...";
        const finalResult = await gemini.waitForVideoCompletion(
          result.id,
          (status) => {
            spinner.text = `Extending video... ${status.status}`;
          },
          300000
        );

        if (finalResult.status !== "completed") {
          spinner.fail(finalResult.error || "Extension failed");
          exitWithError(apiError(finalResult.error || "Veo video extension failed", true));
        }

        spinner.succeed(chalk.green("Video extended"));

        console.log();
        if (finalResult.videoUrl) {
          console.log(`Video URL: ${finalResult.videoUrl}`);
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
            downloadSpinner.fail(chalk.red(`Failed to download video: ${err instanceof Error ? err.message : err}`));
          }
        }
      } catch (error) {
        exitWithError(generalError(error instanceof Error ? error.message : "Video extension failed"));
      }
    });
}
