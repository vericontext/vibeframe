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
import { GeminiProvider, KlingProvider, RunwayProvider } from "@vibeframe/ai-providers";
import { getApiKey } from "../utils/api-key.js";

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
    .description("Generate video using AI (Runway, Kling, or Veo)")
    .argument("<prompt>", "Text prompt describing the video")
    .option("-p, --provider <provider>", "Provider: kling, runway, veo", "kling")
    .option("-k, --api-key <key>", "API key (or set RUNWAY_API_SECRET / KLING_API_KEY / GOOGLE_API_KEY env)")
    .option("-o, --output <path>", "Output file path (downloads video)")
    .option("-i, --image <path>", "Reference image for image-to-video")
    .option("-d, --duration <sec>", "Duration: 5 or 10 seconds", "5")
    .option("-r, --ratio <ratio>", "Aspect ratio: 16:9, 9:16, or 1:1", "16:9")
    .option("-s, --seed <number>", "Random seed for reproducibility (Runway only)")
    .option("-m, --mode <mode>", "Generation mode: std or pro (Kling only)", "std")
    .option("-n, --negative <prompt>", "Negative prompt - what to avoid (Kling only)")
    .option("--no-wait", "Start generation and return task ID without waiting")
    .action(async (prompt: string, options) => {
      try {
        const provider = options.provider.toLowerCase();
        const validProviders = ["runway", "kling", "veo"];
        if (!validProviders.includes(provider)) {
          console.error(chalk.red(`Invalid provider: ${provider}`));
          console.error(chalk.dim(`Available providers: ${validProviders.join(", ")}`));
          process.exit(1);
        }

        const envKeyMap: Record<string, string> = {
          runway: "RUNWAY_API_SECRET",
          kling: "KLING_API_KEY",
          veo: "GOOGLE_API_KEY",
        };
        const providerNameMap: Record<string, string> = {
          runway: "Runway",
          kling: "Kling",
          veo: "Veo",
        };
        const envKey = envKeyMap[provider];
        const providerName = providerNameMap[provider];
        const apiKey = await getApiKey(envKey, providerName, options.apiKey);
        if (!apiKey) {
          console.error(chalk.red(`${providerName} API key required.`));
          if (provider === "kling") {
            console.error(chalk.dim("Format: ACCESS_KEY:SECRET_KEY"));
          }
          console.error(chalk.dim(`Use --api-key or set ${envKey} environment variable`));
          process.exit(1);
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
            spinner.fail(chalk.red(result.error || "Failed to start generation"));
            process.exit(1);
          }

          console.log();
          console.log(chalk.bold.cyan("Video Generation Started"));
          console.log(chalk.dim("─".repeat(60)));
          console.log(`Provider: ${chalk.bold("Runway Gen-3")}`);
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
            spinner.fail(chalk.red("Invalid API key format. Use ACCESS_KEY:SECRET_KEY"));
            process.exit(1);
          }

          result = await kling.generateVideo(prompt, {
            prompt,
            referenceImage,
            duration: parseInt(options.duration) as 5 | 10,
            aspectRatio: options.ratio as "16:9" | "9:16" | "1:1",
            negativePrompt: options.negative,
            mode: options.mode as "std" | "pro",
          });

          if (result.status === "failed") {
            spinner.fail(chalk.red(result.error || "Failed to start generation"));
            process.exit(1);
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

          const veoDuration = parseInt(options.duration) <= 6 ? 6 : 8;
          result = await gemini.generateVideo(prompt, {
            prompt,
            referenceImage,
            duration: veoDuration,
            aspectRatio: options.ratio as "16:9" | "9:16",
            model: "veo-3.1-fast-generate-preview",
          });

          if (result.status === "failed") {
            spinner.fail(chalk.red(result.error || "Failed to start generation"));
            process.exit(1);
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
        }

        if (finalResult.status !== "completed") {
          spinner.fail(chalk.red(finalResult.error || "Generation failed"));
          process.exit(1);
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
            const response = await fetch(finalResult.videoUrl);
            const buffer = Buffer.from(await response.arrayBuffer());
            const outputPath = resolve(process.cwd(), options.output);
            await writeFile(outputPath, buffer);
            downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
          } catch {
            downloadSpinner.fail(chalk.red("Failed to download video"));
          }
        }
      } catch (error) {
        console.error(chalk.red("Video generation failed"));
        console.error(error);
        process.exit(1);
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
        const apiKey = await getApiKey("RUNWAY_API_SECRET", "Runway", options.apiKey);
        if (!apiKey) {
          console.error(chalk.red("Runway API key required"));
          process.exit(1);
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
            const response = await fetch(result.videoUrl);
            const buffer = Buffer.from(await response.arrayBuffer());
            const outputPath = resolve(process.cwd(), options.output);
            await writeFile(outputPath, buffer);
            downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
          } catch {
            downloadSpinner.fail(chalk.red("Failed to download video"));
          }
        }
      } catch (error) {
        console.error(chalk.red("Failed to get status"));
        console.error(error);
        process.exit(1);
      }
    });

  aiCommand
    .command("video-cancel")
    .description("Cancel Runway video generation")
    .argument("<task-id>", "Task ID to cancel")
    .option("-k, --api-key <key>", "Runway API key (or set RUNWAY_API_SECRET env)")
    .action(async (taskId: string, options) => {
      try {
        const apiKey = await getApiKey("RUNWAY_API_SECRET", "Runway", options.apiKey);
        if (!apiKey) {
          console.error(chalk.red("Runway API key required"));
          process.exit(1);
        }

        const spinner = ora("Cancelling generation...").start();

        const runway = new RunwayProvider();
        await runway.initialize({ apiKey });

        const success = await runway.cancelGeneration(taskId);

        if (success) {
          spinner.succeed(chalk.green("Generation cancelled"));
        } else {
          spinner.fail(chalk.red("Failed to cancel generation"));
          process.exit(1);
        }
      } catch (error) {
        console.error(chalk.red("Failed to cancel"));
        console.error(error);
        process.exit(1);
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
    .action(async (prompt: string, options) => {
      try {
        const apiKey = await getApiKey("KLING_API_KEY", "Kling", options.apiKey);
        if (!apiKey) {
          console.error(chalk.red("Kling API key required."));
          console.error(chalk.dim("Format: ACCESS_KEY:SECRET_KEY"));
          console.error(chalk.dim("Use --api-key or set KLING_API_KEY environment variable"));
          process.exit(1);
        }

        const spinner = ora("Initializing Kling AI...").start();

        const kling = new KlingProvider();
        await kling.initialize({ apiKey });

        if (!kling.isConfigured()) {
          spinner.fail(chalk.red("Invalid API key format. Use ACCESS_KEY:SECRET_KEY"));
          process.exit(1);
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

        spinner.text = "Starting video generation...";

        const result = await kling.generateVideo(prompt, {
          prompt,
          referenceImage,
          duration: parseInt(options.duration) as 5 | 10,
          aspectRatio: options.ratio as "16:9" | "9:16" | "1:1",
          negativePrompt: options.negative,
          mode: options.mode as "std" | "pro",
        });

        if (result.status === "failed") {
          spinner.fail(chalk.red(result.error || "Failed to start generation"));
          process.exit(1);
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
          console.log(chalk.dim(`  pnpm vibe ai kling-status ${result.id}${isImageToVideo ? " --type image2video" : ""}`));
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
          spinner.fail(chalk.red(finalResult.error || "Generation failed"));
          process.exit(1);
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
            const response = await fetch(finalResult.videoUrl);
            const buffer = Buffer.from(await response.arrayBuffer());
            const outputPath = resolve(process.cwd(), options.output);
            await writeFile(outputPath, buffer);
            downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
          } catch {
            downloadSpinner.fail(chalk.red("Failed to download video"));
          }
        }
      } catch (error) {
        console.error(chalk.red("Video generation failed"));
        console.error(error);
        process.exit(1);
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
        const apiKey = await getApiKey("KLING_API_KEY", "Kling", options.apiKey);
        if (!apiKey) {
          console.error(chalk.red("Kling API key required"));
          process.exit(1);
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
            const response = await fetch(result.videoUrl);
            const buffer = Buffer.from(await response.arrayBuffer());
            const outputPath = resolve(process.cwd(), options.output);
            await writeFile(outputPath, buffer);
            downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
          } catch {
            downloadSpinner.fail(chalk.red("Failed to download video"));
          }
        }
      } catch (error) {
        console.error(chalk.red("Failed to get status"));
        console.error(error);
        process.exit(1);
      }
    });

  aiCommand
    .command("video-extend")
    .description("Extend video duration using Kling AI (requires Kling video ID)")
    .argument("<video-id>", "Kling video ID (from generation result)")
    .option("-k, --api-key <key>", "Kling API key (ACCESS_KEY:SECRET_KEY) or set KLING_API_KEY env")
    .option("-o, --output <path>", "Output file path")
    .option("-p, --prompt <text>", "Continuation prompt")
    .option("-d, --duration <sec>", "Duration: 5 or 10 seconds", "5")
    .option("-n, --negative <prompt>", "Negative prompt (what to avoid)")
    .option("--no-wait", "Start generation and return task ID without waiting")
    .action(async (videoId: string, options) => {
      try {
        const apiKey = await getApiKey("KLING_API_KEY", "Kling", options.apiKey);
        if (!apiKey) {
          console.error(chalk.red("Kling API key required."));
          console.error(chalk.dim("Format: ACCESS_KEY:SECRET_KEY"));
          console.error(chalk.dim("Use --api-key or set KLING_API_KEY environment variable"));
          process.exit(1);
        }

        const spinner = ora("Initializing Kling AI...").start();

        const kling = new KlingProvider();
        await kling.initialize({ apiKey });

        if (!kling.isConfigured()) {
          spinner.fail(chalk.red("Invalid API key format. Use ACCESS_KEY:SECRET_KEY"));
          process.exit(1);
        }

        spinner.text = "Starting video extension...";

        const result = await kling.extendVideo(videoId, {
          prompt: options.prompt,
          negativePrompt: options.negative,
          duration: options.duration as "5" | "10",
        });

        if (result.status === "failed") {
          spinner.fail(chalk.red(result.error || "Failed to start extension"));
          process.exit(1);
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
          spinner.fail(chalk.red(finalResult.error || "Extension failed"));
          process.exit(1);
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
            const response = await fetch(finalResult.videoUrl);
            const buffer = Buffer.from(await response.arrayBuffer());
            const outputPath = resolve(process.cwd(), options.output);
            await writeFile(outputPath, buffer);
            downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
          } catch {
            downloadSpinner.fail(chalk.red("Failed to download video"));
          }
        }
      } catch (error) {
        console.error(chalk.red("Video extension failed"));
        console.error(error);
        process.exit(1);
      }
    });
}
