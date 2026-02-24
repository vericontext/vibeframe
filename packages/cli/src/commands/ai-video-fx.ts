/**
 * ai-video-fx.ts — Video FX commands (upscale, interpolate, inpaint, track-object).
 *
 * Extracted from ai.ts as part of modularisation.
 * ai.ts re-exports all public types and functions from this module.
 */

import { type Command } from "commander";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import chalk from "chalk";
import ora from "ora";
import { ReplicateProvider } from "@vibeframe/ai-providers";
import { getApiKey } from "../utils/api-key.js";

const execAsync = promisify(exec);

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
    .action(async (videoPath: string, options) => {
      try {
        const absPath = resolve(process.cwd(), videoPath);
        const scale = parseInt(options.scale);

        if (scale !== 2 && scale !== 4) {
          console.error(chalk.red("Scale must be 2 or 4"));
          process.exit(1);
        }

        // Use FFmpeg if requested (free fallback)
        if (options.ffmpeg) {
          const outputPath = options.output
            ? resolve(process.cwd(), options.output)
            : absPath.replace(/(\.[^.]+)$/, `-upscaled-${scale}x$1`);

          const spinner = ora(`Upscaling video with FFmpeg (${scale}x)...`).start();

          try {
            // Get original dimensions
            const { stdout: probeOut } = await execAsync(
              `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${absPath}"`
            );
            const [width, height] = probeOut.trim().split(",").map(Number);
            const newWidth = width * scale;
            const newHeight = height * scale;

            // Use lanczos scaling
            await execAsync(
              `ffmpeg -i "${absPath}" -vf "scale=${newWidth}:${newHeight}:flags=lanczos" -c:a copy "${outputPath}" -y`
            );

            spinner.succeed(chalk.green(`Upscaled to ${newWidth}x${newHeight}`));
            console.log(`Output: ${outputPath}`);
          } catch (err) {
            spinner.fail(chalk.red("FFmpeg upscaling failed"));
            console.error(err);
            process.exit(1);
          }
          return;
        }

        // Use Replicate API
        const apiKey = await getApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);
        if (!apiKey) {
          console.error(chalk.red("Replicate API token required for AI upscaling."));
          console.error(chalk.dim("Use --api-key or set REPLICATE_API_TOKEN"));
          console.error(chalk.dim("Or use --ffmpeg for free FFmpeg upscaling"));
          process.exit(1);
        }

        const spinner = ora("Initializing Replicate...").start();

        const { ReplicateProvider } = await import("@vibeframe/ai-providers");
        const replicate = new ReplicateProvider();
        await replicate.initialize({ apiKey });

        // For Replicate, we need a URL. Upload to temporary hosting or require URL
        spinner.text = "Note: Replicate requires video URL. Reading file...";

        // For now, we'll show an error suggesting URL or ffmpeg
        spinner.fail(chalk.yellow("Replicate requires a video URL"));
        console.log();
        console.log(chalk.dim("Options:"));
        console.log(chalk.dim("  1. Use --ffmpeg for local processing"));
        console.log(chalk.dim("  2. Upload video to a URL and run:"));
        console.log(chalk.dim(`     pnpm vibe ai video-upscale https://example.com/video.mp4 -s ${scale}`));
        console.log();
        process.exit(1);
      } catch (error) {
        console.error(chalk.red("Video upscaling failed"));
        console.error(error);
        process.exit(1);
      }
    });

  // Frame Interpolation (Slow Motion)
  ai.command("video-interpolate")
    .description("Create slow motion with frame interpolation (FFmpeg)")
    .argument("<video>", "Video file path")
    .option("-o, --output <path>", "Output file path")
    .option("-f, --factor <number>", "Slow motion factor: 2, 4, or 8", "2")
    .option("--fps <number>", "Target output FPS")
    .option("-q, --quality <mode>", "Quality: fast or quality", "quality")
    .action(async (videoPath: string, options) => {
      try {
        const absPath = resolve(process.cwd(), videoPath);
        const factor = parseInt(options.factor);

        if (![2, 4, 8].includes(factor)) {
          console.error(chalk.red("Factor must be 2, 4, or 8"));
          process.exit(1);
        }

        const outputPath = options.output
          ? resolve(process.cwd(), options.output)
          : absPath.replace(/(\.[^.]+)$/, `-slow${factor}x$1`);

        const spinner = ora(`Creating ${factor}x slow motion...`).start();

        try {
          // Get original FPS
          const { stdout: fpsOut } = await execAsync(
            `ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of default=noprint_wrappers=1:nokey=1 "${absPath}"`
          );
          const [num, den] = fpsOut.trim().split("/").map(Number);
          const originalFps = num / (den || 1);

          // Calculate target FPS
          const targetFps = options.fps ? parseInt(options.fps) : originalFps * factor;

          // Use minterpolate for frame interpolation
          const mi = options.quality === "fast" ? "mi_mode=mci" : "mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1";

          spinner.text = `Interpolating frames (${originalFps.toFixed(1)} → ${targetFps}fps)...`;

          // First interpolate frames, then slow down
          await execAsync(
            `ffmpeg -i "${absPath}" -filter:v "minterpolate='${mi}:fps=${targetFps}',setpts=${factor}*PTS" -an "${outputPath}" -y`,
            { timeout: 600000 } // 10 minute timeout
          );

          spinner.succeed(chalk.green(`Created ${factor}x slow motion`));
          console.log();
          console.log(chalk.dim("─".repeat(60)));
          console.log(`Original FPS: ${originalFps.toFixed(1)}`);
          console.log(`Interpolated FPS: ${targetFps}`);
          console.log(`Slow factor: ${factor}x`);
          console.log(`Output: ${outputPath}`);
          console.log();
        } catch (err: unknown) {
          spinner.fail(chalk.red("Frame interpolation failed"));
          if (err instanceof Error && err.message.includes("timeout")) {
            console.error(chalk.yellow("Processing timed out. Try with a shorter video or --quality fast"));
          } else {
            console.error(err);
          }
          process.exit(1);
        }
      } catch (error) {
        console.error(chalk.red("Frame interpolation failed"));
        console.error(error);
        process.exit(1);
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
    .option("--provider <name>", "Provider: replicate or stability", "replicate")
    .option("--no-wait", "Start processing and return task ID without waiting")
    .action(async (videoPath: string, options) => {
      try {
        if (!options.target && !options.mask) {
          console.error(chalk.red("Either --target or --mask is required"));
          console.error(chalk.dim("Examples:"));
          console.error(chalk.dim('  pnpm vibe ai video-inpaint video.mp4 --target "watermark"'));
          console.error(chalk.dim("  pnpm vibe ai video-inpaint video.mp4 --mask mask.mp4"));
          process.exit(1);
        }

        const apiKey = await getApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);
        if (!apiKey) {
          console.error(chalk.red("Replicate API token required for video inpainting."));
          console.error(chalk.dim("Use --api-key or set REPLICATE_API_TOKEN"));
          process.exit(1);
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
          spinner.fail(chalk.yellow("Video inpainting requires a video URL"));
          console.log();
          console.log(chalk.dim("Upload your video to a URL and run:"));
          console.log(chalk.dim(`  pnpm vibe ai video-inpaint https://example.com/video.mp4 --mask https://example.com/mask.mp4`));
          console.log();
          process.exit(1);
        }

        let maskVideo: string | undefined;
        if (options.mask) {
          if (options.mask.startsWith("http://") || options.mask.startsWith("https://")) {
            maskVideo = options.mask;
          } else {
            spinner.fail(chalk.yellow("Mask must also be a URL"));
            process.exit(1);
          }
        }

        spinner.text = "Starting video inpainting...";

        const result = await replicate.inpaintVideo(videoUrl, {
          target: options.target,
          maskVideo,
        });

        if (result.status === "failed") {
          spinner.fail(chalk.red(result.error || "Failed to start inpainting"));
          process.exit(1);
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
          spinner.fail(chalk.red(finalResult.error || "Inpainting failed"));
          process.exit(1);
        }

        spinner.succeed(chalk.green("Video inpainting complete"));

        console.log();
        if (finalResult.videoUrl) {
          console.log(`Video URL: ${finalResult.videoUrl}`);

          // Download if output specified
          if (options.output) {
            const downloadSpinner = ora("Downloading video...").start();
            try {
              const response = await fetch(finalResult.videoUrl);
              const buffer = Buffer.from(await response.arrayBuffer());
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
        console.error(chalk.red("Video inpainting failed"));
        console.error(error);
        process.exit(1);
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
    .action(async (videoPath: string, options) => {
      try {
        if (!options.point && !options.box && !options.prompt) {
          console.error(chalk.red("Tracking target required. Use --point, --box, or --prompt"));
          console.log(chalk.dim("Examples:"));
          console.log(chalk.dim("  pnpm vibe ai track-object video.mp4 --point 500,300"));
          console.log(chalk.dim("  pnpm vibe ai track-object video.mp4 --box 100,100,200,200"));
          console.log(chalk.dim('  pnpm vibe ai track-object video.mp4 --prompt "the person"'));
          process.exit(1);
        }

        const apiKey = await getApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);
        if (!apiKey) {
          console.error(chalk.red("Replicate API token required."));
          console.error(chalk.dim("Set REPLICATE_API_TOKEN environment variable"));
          process.exit(1);
        }

        const spinner = ora("Initializing object tracking...").start();

        const replicate = new ReplicateProvider();
        await replicate.initialize({ apiKey });

        // Video must be URL
        let videoUrl: string;
        if (videoPath.startsWith("http://") || videoPath.startsWith("https://")) {
          videoUrl = videoPath;
        } else {
          spinner.fail(chalk.yellow("Video must be a URL for Replicate processing."));
          console.log(chalk.dim("Upload your video to a URL and try again."));
          process.exit(1);
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
          spinner.fail(chalk.red(result.error || "Object tracking failed"));
          process.exit(1);
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
          spinner.fail(chalk.red(pollResult.error || "Tracking failed or timed out"));
          process.exit(1);
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
        console.error(chalk.red("Object tracking failed"));
        console.error(error);
        process.exit(1);
      }
    });
}
