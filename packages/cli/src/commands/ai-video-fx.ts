/**
 * @module ai-video-fx
 * @description Video FX commands (upscale, interpolate, inpaint, track-object).
 *
 * ## Commands: vibe ai upscale, vibe ai interpolate, vibe ai inpaint, vibe ai track-object
 * ## Dependencies: Replicate
 *
 * Extracted from ai.ts as part of modularisation.
 * ai.ts re-exports all public types and functions from this module.
 * @see MODELS.md for AI model configuration
 */

import { type Command } from "commander";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { ReplicateProvider } from "@vibeframe/ai-providers";
import { getApiKey } from "../utils/api-key.js";
import { execSafe } from "../utils/exec-safe.js";
import { downloadVideo } from "./ai-helpers.js";
import { exitWithError, usageError, authError, apiError, generalError, outputResult } from "./output.js";
import { validateOutputPath } from "./validate.js";

// ── Register all video FX commands ───────────────────────────────────────────

export function registerVideoFxCommands(ai: Command): void {
  // Video Upscale command
  ai.command("video-upscale")
    .description("Upscale video resolution using AI or FFmpeg")
    .argument("<video>", "Video file path")
    .option("-o, --output <path>", "Output file path")
    .option("-s, --scale <factor>", "Scale factor: 2 or 4", "2")
    .option("-m, --model <model>", "Model: real-esrgan, topaz", "real-esrgan")
    .option("--ffmpeg", "Use FFmpeg lanczos (free, no API)")
    .option("-k, --api-key <key>", "Replicate API token (or set REPLICATE_API_TOKEN env)")
    .option("--no-wait", "Start processing and return task ID without waiting")
    .option("--dry-run", "Preview parameters without executing")
    .action(async (videoPath: string, options) => {
      try {
        if (options.output) {
          validateOutputPath(options.output);
        }

        const absPath = resolve(process.cwd(), videoPath);
        const scale = parseInt(options.scale);

        if (scale !== 2 && scale !== 4) {
          exitWithError(usageError("Scale must be 2 or 4"));
        }

        if (options.dryRun) {
          outputResult({ dryRun: true, command: "ai video-upscale", params: { video: videoPath, output: options.output, scale: options.scale, model: options.model, ffmpeg: options.ffmpeg } });
          return;
        }

        // Use FFmpeg if requested (free fallback)
        if (options.ffmpeg) {
          const outputPath = options.output
            ? resolve(process.cwd(), options.output)
            : absPath.replace(/(\.[^.]+)$/, `-upscaled-${scale}x$1`);

          const spinner = ora(`Upscaling video with FFmpeg (${scale}x)...`).start();

          try {
            // Get original dimensions
            const { stdout: probeOut } = await execSafe("ffprobe", [
              "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", absPath,
            ]);
            const [width, height] = probeOut.trim().split(",").map(Number);
            const newWidth = width * scale;
            const newHeight = height * scale;

            // Use lanczos scaling
            await execSafe("ffmpeg", ["-i", absPath, "-vf", `scale=${newWidth}:${newHeight}:flags=lanczos`, "-c:a", "copy", outputPath, "-y"]);

            spinner.succeed(chalk.green(`Upscaled to ${newWidth}x${newHeight}`));
            console.log(`Output: ${outputPath}`);
          } catch (err) {
            spinner.fail("FFmpeg upscaling failed");
            const msg = err instanceof Error ? err.message : String(err);
            exitWithError(generalError(`FFmpeg upscaling failed: ${msg}`));
          }
          return;
        }

        // Use Replicate API
        const apiKey = await getApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);
        if (!apiKey) {
          exitWithError(authError("REPLICATE_API_TOKEN", "Replicate"));
        }

        const spinner = ora("Initializing Replicate...").start();

        const { ReplicateProvider } = await import("@vibeframe/ai-providers");
        const replicate = new ReplicateProvider();
        await replicate.initialize({ apiKey });

        // For Replicate, we need a URL. Upload to temporary hosting or require URL
        spinner.text = "Note: Replicate requires video URL. Reading file...";

        // For now, we'll show an error suggesting URL or ffmpeg
        spinner.fail("Replicate requires a video URL");
        exitWithError(usageError("Replicate requires a video URL", "Use --ffmpeg for local processing, or upload video to a URL."));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        exitWithError(generalError(`Video upscaling failed: ${msg}`));
      }
    });

  // Frame Interpolation (Slow Motion)
  ai.command("video-interpolate")
    .description("Create slow motion with frame interpolation (FFmpeg)")
    .argument("<video>", "Video file path")
    .option("-o, --output <path>", "Output file path")
    .option("-f, --factor <number>", "Slow motion factor: 2, 4, or 8", "2")
    .option("--fps <number>", "Target output FPS")
    // `-q` shorthand intentionally omitted: collides with global `vibe -q,--quiet`.
    .option("--quality <mode>", "Quality: fast or quality", "quality")
    .option("--dry-run", "Preview parameters without executing")
    .action(async (videoPath: string, options) => {
      try {
        if (options.output) {
          validateOutputPath(options.output);
        }

        const absPath = resolve(process.cwd(), videoPath);
        const factor = parseInt(options.factor);

        if (![2, 4, 8].includes(factor)) {
          exitWithError(usageError("Factor must be 2, 4, or 8"));
        }

        if (options.dryRun) {
          outputResult({ dryRun: true, command: "ai video-interpolate", params: { video: videoPath, output: options.output, factor: options.factor, fps: options.fps, quality: options.quality } });
          return;
        }

        const outputPath = options.output
          ? resolve(process.cwd(), options.output)
          : absPath.replace(/(\.[^.]+)$/, `-slow${factor}x$1`);

        const spinner = ora(`Creating ${factor}x slow motion...`).start();

        try {
          // Get original FPS
          const { stdout: fpsOut } = await execSafe("ffprobe", [
            "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "default=noprint_wrappers=1:nokey=1", absPath,
          ]);
          const [num, den] = fpsOut.trim().split("/").map(Number);
          const originalFps = num / (den || 1);

          // Calculate target FPS
          const targetFps = options.fps ? parseInt(options.fps) : originalFps * factor;

          // Use minterpolate for frame interpolation
          const mi = options.quality === "fast" ? "mi_mode=mci" : "mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1";

          spinner.text = `Interpolating frames (${originalFps.toFixed(1)} → ${targetFps}fps)...`;

          // First interpolate frames, then slow down
          await execSafe("ffmpeg", ["-i", absPath, "-filter:v", `minterpolate='${mi}:fps=${targetFps}',setpts=${factor}*PTS`, "-an", outputPath, "-y"], { timeout: 600000 });

          spinner.succeed(chalk.green(`Created ${factor}x slow motion`));
          console.log();
          console.log(chalk.dim("─".repeat(60)));
          console.log(`Original FPS: ${originalFps.toFixed(1)}`);
          console.log(`Interpolated FPS: ${targetFps}`);
          console.log(`Slow factor: ${factor}x`);
          console.log(`Output: ${outputPath}`);
          console.log();
        } catch (err: unknown) {
          spinner.fail("Frame interpolation failed");
          if (err instanceof Error && err.message.includes("timeout")) {
            exitWithError(generalError("Frame interpolation timed out", "Try with a shorter video or --quality fast"));
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            exitWithError(generalError(`Frame interpolation failed: ${msg}`));
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        exitWithError(generalError(`Frame interpolation failed: ${msg}`));
      }
    });

  // Video Inpainting (Object Removal)
  ai.command("video-inpaint")
    .description("Remove objects from video using AI inpainting")
    .argument("<video>", "Video file path or URL")
    .option("-o, --output <path>", "Output file path")
    .option("-t, --target <description>", "Object to remove (text description)")
    .option("-m, --mask <path>", "Mask video file path (white = remove)")
    .option("-k, --api-key <key>", "Replicate API token (or set REPLICATE_API_TOKEN env)")
    .option("--provider <name>", "Provider: replicate", "replicate")
    .option("--no-wait", "Start processing and return task ID without waiting")
    .option("--dry-run", "Preview parameters without executing")
    .action(async (videoPath: string, options) => {
      try {
        if (options.output) {
          validateOutputPath(options.output);
        }

        if (!options.target && !options.mask) {
          exitWithError(usageError("Either --target or --mask is required", 'Example: vibe ai video-inpaint video.mp4 --target "watermark"'));
        }

        if (options.dryRun) {
          outputResult({ dryRun: true, command: "ai video-inpaint", params: { video: videoPath, output: options.output, target: options.target, mask: options.mask, provider: options.provider } });
          return;
        }

        const apiKey = await getApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);
        if (!apiKey) {
          exitWithError(authError("REPLICATE_API_TOKEN", "Replicate"));
        }

        const spinner = ora("Initializing Replicate...").start();

        const { ReplicateProvider } = await import("@vibeframe/ai-providers");
        const replicate = new ReplicateProvider();
        await replicate.initialize({ apiKey });

        // Check if video is URL or file
        let videoUrl: string;
        if (videoPath.startsWith("http://") || videoPath.startsWith("https://")) {
          videoUrl = videoPath;
        } else {
          spinner.fail("Video inpainting requires a video URL");
          exitWithError(usageError("Video inpainting requires a video URL", "Upload your video to a URL and try again."));
        }

        let maskVideo: string | undefined;
        if (options.mask) {
          if (options.mask.startsWith("http://") || options.mask.startsWith("https://")) {
            maskVideo = options.mask;
          } else {
            spinner.fail("Mask must also be a URL");
            exitWithError(usageError("Mask must also be a URL"));
          }
        }

        spinner.text = "Starting video inpainting...";

        const result = await replicate.inpaintVideo(videoUrl, {
          target: options.target,
          maskVideo,
        });

        if (result.status === "failed") {
          spinner.fail(result.error || "Failed to start inpainting");
          exitWithError(apiError(result.error || "Failed to start inpainting", true));
        }

        console.log();
        console.log(chalk.bold.cyan("Video Inpainting Started"));
        console.log(chalk.dim("─".repeat(60)));
        console.log(`Task ID: ${chalk.bold(result.id)}`);

        if (!options.wait) {
          spinner.succeed(chalk.green("Inpainting started"));
          console.log();
          console.log(chalk.dim("Check status with:"));
          console.log(chalk.dim(`  curl -s -H "Authorization: Bearer $REPLICATE_API_TOKEN" https://api.replicate.com/v1/predictions/${result.id}`));
          console.log();
          return;
        }

        spinner.text = "Processing video (this may take several minutes)...";

        const finalResult = await replicate.waitForCompletion(
          result.id,
          (status) => {
            spinner.text = `Processing... ${status.status}`;
          },
          600000
        );

        if (finalResult.status !== "completed") {
          spinner.fail(finalResult.error || "Inpainting failed");
          exitWithError(apiError(finalResult.error || "Inpainting failed", true));
        }

        spinner.succeed(chalk.green("Video inpainting complete"));

        console.log();
        if (finalResult.videoUrl) {
          console.log(`Video URL: ${finalResult.videoUrl}`);

          // Download if output specified
          if (options.output) {
            const downloadSpinner = ora("Downloading video...").start();
            try {
              const buffer = await downloadVideo(finalResult.videoUrl);
              const outputPath = resolve(process.cwd(), options.output);
              await writeFile(outputPath, buffer);
              downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
            } catch (err) {
              downloadSpinner.fail(chalk.red("Failed to download video"));
            }
          }
        }
        console.log();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        exitWithError(apiError(`Video inpainting failed: ${msg}`, true));
      }
    });

  // Object Tracking
  ai.command("track-object")
    .description("Track objects in video (Replicate SAM-2)")
    .argument("<video>", "Video file path or URL")
    .option("-p, --point <x,y>", "Point to track (x,y coordinates)")
    .option("-b, --box <x,y,w,h>", "Bounding box to track (x,y,width,height)")
    .option("--prompt <text>", "Object description to track")
    .option("-o, --output <path>", "Output JSON or MP4 file path", "track.json")
    .option("-v, --visualize", "Output video with tracking overlay")
    .option("--no-wait", "Start processing without waiting")
    .option("-k, --api-key <key>", "Replicate API token (or set REPLICATE_API_TOKEN env)")
    .option("--dry-run", "Preview parameters without executing")
    .action(async (videoPath: string, options) => {
      try {
        if (options.output) {
          validateOutputPath(options.output);
        }

        if (!options.point && !options.box && !options.prompt) {
          exitWithError(usageError("Tracking target required. Use --point, --box, or --prompt"));
        }

        if (options.dryRun) {
          outputResult({ dryRun: true, command: "ai track-object", params: { video: videoPath, output: options.output, point: options.point, box: options.box, prompt: options.prompt, visualize: options.visualize } });
          return;
        }

        const apiKey = await getApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);
        if (!apiKey) {
          exitWithError(authError("REPLICATE_API_TOKEN", "Replicate"));
        }

        const spinner = ora("Initializing object tracking...").start();

        const replicate = new ReplicateProvider();
        await replicate.initialize({ apiKey });

        // Video must be URL
        let videoUrl: string;
        if (videoPath.startsWith("http://") || videoPath.startsWith("https://")) {
          videoUrl = videoPath;
        } else {
          spinner.fail("Video must be a URL for Replicate processing");
          exitWithError(usageError("Video must be a URL for Replicate processing.", "Upload your video to a URL and try again."));
        }

        // Parse tracking target
        let point: [number, number] | undefined;
        let box: [number, number, number, number] | undefined;

        if (options.point) {
          const [x, y] = options.point.split(",").map(Number);
          point = [x, y];
        }

        if (options.box) {
          const [x, y, w, h] = options.box.split(",").map(Number);
          box = [x, y, w, h];
        }

        spinner.text = "Starting object tracking...";

        const result = await replicate.trackObject({
          videoUrl,
          point,
          box,
          prompt: options.prompt,
        });

        if (result.status === "failed") {
          spinner.fail(result.error || "Object tracking failed");
          exitWithError(apiError(result.error || "Object tracking failed", true));
        }

        console.log();
        console.log(chalk.bold.cyan("Object Tracking Started"));
        console.log(chalk.dim("─".repeat(60)));
        console.log(`Task ID: ${chalk.bold(result.id)}`);
        if (point) console.log(`Point: ${point[0]}, ${point[1]}`);
        if (box) console.log(`Box: ${box[0]}, ${box[1]}, ${box[2]}, ${box[3]}`);
        if (options.prompt) console.log(`Prompt: ${options.prompt}`);

        if (!options.wait) {
          spinner.succeed(chalk.green("Tracking started"));
          console.log();
          console.log(chalk.dim("Check status with:"));
          console.log(chalk.dim(`  curl -s -H "Authorization: Bearer $REPLICATE_API_TOKEN" https://api.replicate.com/v1/predictions/${result.id}`));
          console.log();
          return;
        }

        spinner.text = "Processing tracking (this may take several minutes)...";

        const finalResult = await replicate.getTrackingResult(result.id);

        // Poll for completion
        let pollResult = finalResult;
        const startTime = Date.now();
        const maxWait = 600000;

        while (pollResult.status !== "completed" && pollResult.status !== "failed" && Date.now() - startTime < maxWait) {
          await new Promise((r) => setTimeout(r, 3000));
          pollResult = await replicate.getTrackingResult(result.id);
          spinner.text = `Processing... ${pollResult.status}`;
        }

        if (pollResult.status !== "completed") {
          spinner.fail(pollResult.error || "Tracking failed or timed out");
          exitWithError(apiError(pollResult.error || "Tracking failed or timed out", true));
        }

        spinner.succeed(chalk.green("Object tracking complete"));

        console.log();
        if (pollResult.maskUrl) {
          console.log(`Mask URL: ${pollResult.maskUrl}`);

          const outputPath = resolve(process.cwd(), options.output);
          if (options.visualize || options.output.endsWith(".mp4")) {
            const downloadSpinner = ora("Downloading tracking mask...").start();
            try {
              const response = await fetch(pollResult.maskUrl);
              const buffer = Buffer.from(await response.arrayBuffer());
              await writeFile(outputPath, buffer);
              downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
            } catch (err) {
              downloadSpinner.fail(chalk.red("Failed to download mask"));
            }
          } else {
            // Save tracking data as JSON
            const trackData = {
              taskId: result.id,
              maskUrl: pollResult.maskUrl,
              trackingData: pollResult.trackingData,
            };
            await writeFile(outputPath, JSON.stringify(trackData, null, 2));
            console.log(chalk.green(`Tracking data saved to: ${outputPath}`));
          }
        }
        console.log();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        exitWithError(apiError(`Object tracking failed: ${msg}`, true));
      }
    });
}
