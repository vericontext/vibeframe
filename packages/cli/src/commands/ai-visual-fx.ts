/**
 * ai-visual-fx.ts — Visual effects commands for the VibeFrame CLI.
 *
 * Commands: grade, text-overlay, speed-ramp, reframe, style-transfer
 *
 * Extracted from ai.ts as part of modularisation.
 * ai.ts calls registerVisualFxCommands(aiCommand).
 */

import { type Command } from 'commander';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { execSync, exec } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';
import ora from 'ora';
import {
  WhisperProvider,
  ClaudeProvider,
  ReplicateProvider,
} from '@vibeframe/ai-providers';
import { getApiKey } from '../utils/api-key.js';
import { formatTime } from './ai-helpers.js';
import { applyTextOverlays, type TextOverlayStyle } from './ai-edit.js';

const execAsync = promisify(exec);

export function registerVisualFxCommands(ai: Command): void {

// ============================================================================
// Visual FX Commands
// ============================================================================
ai
  .command("grade")
  .description("Apply AI-generated color grading (Claude + FFmpeg)")
  .argument("<video>", "Video file path")
  .option("-s, --style <prompt>", "Style description (e.g., 'cinematic warm')")
  .option("-p, --preset <name>", "Built-in preset: film-noir, vintage, cinematic-warm, cool-tones, high-contrast, pastel, cyberpunk, horror")
  .option("-o, --output <path>", "Output video file path")
  .option("--analyze-only", "Show filter without applying")
  .option("-k, --api-key <key>", "Anthropic API key (or set ANTHROPIC_API_KEY env)")
  .action(async (videoPath: string, options) => {
    try {
      if (!options.style && !options.preset) {
        console.error(chalk.red("Either --style or --preset is required"));
        console.log(chalk.dim("Examples:"));
        console.log(chalk.dim('  pnpm vibe ai grade video.mp4 --style "warm sunset"'));
        console.log(chalk.dim("  pnpm vibe ai grade video.mp4 --preset cinematic-warm"));
        process.exit(1);
      }

      // Check FFmpeg
      try {
        execSync("ffmpeg -version", { stdio: "ignore" });
      } catch {
        console.error(chalk.red("FFmpeg not found. Please install FFmpeg."));
        process.exit(1);
      }

      const spinner = ora("Analyzing color grade...").start();

      // Get API key if using style (not preset)
      let gradeResult: { ffmpegFilter: string; description: string };

      if (options.preset) {
        const claude = new ClaudeProvider();
        gradeResult = await claude.analyzeColorGrade("", options.preset);
      } else {
        const apiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic", options.apiKey);
        const claude = new ClaudeProvider();
        await claude.initialize({ apiKey: apiKey || undefined });
        gradeResult = await claude.analyzeColorGrade(options.style);
      }

      spinner.succeed(chalk.green("Color grade analyzed"));
      console.log();
      console.log(chalk.bold.cyan("Color Grade"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Style: ${options.preset || options.style}`);
      console.log(`Description: ${gradeResult.description}`);
      console.log();
      console.log(chalk.dim("FFmpeg filter:"));
      console.log(chalk.cyan(gradeResult.ffmpegFilter));
      console.log();

      if (options.analyzeOnly) {
        console.log(chalk.dim("Use without --analyze-only to apply the grade."));
        return;
      }

      const absPath = resolve(process.cwd(), videoPath);
      const outputPath = options.output
        ? resolve(process.cwd(), options.output)
        : absPath.replace(/(\.[^.]+)$/, "-graded$1");

      spinner.start("Applying color grade...");

      const cmd = `ffmpeg -i "${absPath}" -vf "${gradeResult.ffmpegFilter}" -c:a copy "${outputPath}" -y`;
      await execAsync(cmd, { timeout: 600000 });

      spinner.succeed(chalk.green("Color grade applied"));
      console.log(chalk.green(`Output: ${outputPath}`));
      console.log();
    } catch (error) {
      console.error(chalk.red("Color grading failed"));
      console.error(error);
      process.exit(1);
    }
  });

// Text Overlay
ai
  .command("text-overlay")
  .description("Apply text overlays to video (FFmpeg drawtext)")
  .argument("<video>", "Video file path")
  .option("-t, --text <texts...>", "Text lines to overlay (repeat for multiple)")
  .option("-s, --style <style>", "Overlay style: lower-third, center-bold, subtitle, minimal", "lower-third")
  .option("--font-size <size>", "Font size in pixels (auto-calculated if omitted)")
  .option("--font-color <color>", "Font color (default: white)", "white")
  .option("--fade <seconds>", "Fade in/out duration in seconds", "0.3")
  .option("--start <seconds>", "Start time in seconds", "0")
  .option("--end <seconds>", "End time in seconds (default: video duration)")
  .option("-o, --output <path>", "Output video file path")
  .action(async (videoPath: string, options) => {
    try {
      if (!options.text || options.text.length === 0) {
        console.error(chalk.red("At least one --text option is required"));
        console.log(chalk.dim("Example:"));
        console.log(chalk.dim('  pnpm vibe ai text-overlay video.mp4 -t "NEXUS AI" -t "Intelligence, Unleashed" --style center-bold'));
        process.exit(1);
      }

      // Check FFmpeg
      try {
        execSync("ffmpeg -version", { stdio: "ignore" });
      } catch {
        console.error(chalk.red("FFmpeg not found. Please install FFmpeg."));
        process.exit(1);
      }

      const absPath = resolve(process.cwd(), videoPath);
      const outputPath = options.output
        ? resolve(process.cwd(), options.output)
        : absPath.replace(/(\.[^.]+)$/, "-overlay$1");

      const spinner = ora("Applying text overlays...").start();

      const result = await applyTextOverlays({
        videoPath: absPath,
        texts: options.text,
        outputPath,
        style: options.style as TextOverlayStyle,
        fontSize: options.fontSize ? parseInt(options.fontSize) : undefined,
        fontColor: options.fontColor,
        fadeDuration: parseFloat(options.fade),
        startTime: parseFloat(options.start),
        endTime: options.end ? parseFloat(options.end) : undefined,
      });

      if (!result.success) {
        spinner.fail(chalk.red(result.error || "Text overlay failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Text overlays applied"));
      console.log();
      console.log(chalk.bold.cyan("Text Overlay"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Style: ${options.style}`);
      console.log(`Texts: ${options.text.join(", ")}`);
      console.log(`Output: ${result.outputPath}`);
      console.log();
    } catch (error) {
      console.error(chalk.red("Text overlay failed"));
      console.error(error);
      process.exit(1);
    }
  });

// Speed Ramping
ai
  .command("speed-ramp")
  .description("Apply content-aware speed ramping (Whisper + Claude + FFmpeg)")
  .argument("<video>", "Video file path")
  .option("-o, --output <path>", "Output video file path")
  .option("-s, --style <style>", "Style: dramatic, smooth, action", "dramatic")
  .option("--min-speed <factor>", "Minimum speed factor", "0.25")
  .option("--max-speed <factor>", "Maximum speed factor", "4.0")
  .option("--analyze-only", "Show keyframes without applying")
  .option("-l, --language <lang>", "Language code for transcription")
  .option("-k, --api-key <key>", "Anthropic API key (or set ANTHROPIC_API_KEY env)")
  .action(async (videoPath: string, options) => {
    try {
      // Check FFmpeg
      try {
        execSync("ffmpeg -version", { stdio: "ignore" });
      } catch {
        console.error(chalk.red("FFmpeg not found. Please install FFmpeg."));
        process.exit(1);
      }

      const openaiApiKey = await getApiKey("OPENAI_API_KEY", "OpenAI");
      if (!openaiApiKey) {
        console.error(chalk.red("OpenAI API key required for Whisper transcription."));
        process.exit(1);
      }

      const claudeApiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic", options.apiKey);
      if (!claudeApiKey) {
        console.error(chalk.red("Anthropic API key required for speed analysis."));
        process.exit(1);
      }

      const absPath = resolve(process.cwd(), videoPath);

      // Step 1: Check for audio stream
      const spinner = ora("Extracting audio...").start();

      const { stdout: speedRampProbe } = await execAsync(
        `ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "${absPath}"`
      );
      if (!speedRampProbe.trim()) {
        spinner.fail(chalk.yellow("Video has no audio track — cannot use Whisper transcription"));
        console.log(chalk.yellow("\n⚠ This video has no audio stream."));
        console.log(chalk.dim("  Speed ramping requires audio for content-aware analysis."));
        console.log(chalk.dim("  Please use a video with an audio track.\n"));
        process.exit(1);
      }

      const tempAudio = absPath.replace(/(\.[^.]+)$/, "-temp-audio.mp3");

      await execAsync(`ffmpeg -i "${absPath}" -vn -acodec libmp3lame -q:a 2 "${tempAudio}" -y`);

      // Step 2: Transcribe
      spinner.text = "Transcribing audio...";

      const whisper = new WhisperProvider();
      await whisper.initialize({ apiKey: openaiApiKey });

      const audioBuffer = await readFile(tempAudio);
      const audioBlob = new Blob([audioBuffer]);
      const transcript = await whisper.transcribe(audioBlob, options.language);

      if (!transcript.segments || transcript.segments.length === 0) {
        spinner.fail(chalk.red("No transcript segments found"));
        process.exit(1);
      }

      // Step 3: Analyze with Claude
      spinner.text = "Analyzing for speed ramping...";

      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey: claudeApiKey });

      const speedResult = await claude.analyzeForSpeedRamp(transcript.segments, {
        style: options.style as "dramatic" | "smooth" | "action",
        minSpeed: parseFloat(options.minSpeed),
        maxSpeed: parseFloat(options.maxSpeed),
      });

      // Clean up temp file
      try {
        await execAsync(`rm "${tempAudio}"`);
      } catch { /* ignore cleanup errors */ }

      spinner.succeed(chalk.green(`Found ${speedResult.keyframes.length} speed keyframes`));

      console.log();
      console.log(chalk.bold.cyan("Speed Ramp Keyframes"));
      console.log(chalk.dim("─".repeat(60)));

      for (const kf of speedResult.keyframes) {
        const speedColor = kf.speed < 1 ? chalk.blue : kf.speed > 1 ? chalk.yellow : chalk.white;
        console.log(`  ${formatTime(kf.time)} → ${speedColor(`${kf.speed.toFixed(2)}x`)} - ${kf.reason}`);
      }
      console.log();

      if (options.analyzeOnly) {
        console.log(chalk.dim("Use without --analyze-only to apply speed ramps."));
        return;
      }

      if (speedResult.keyframes.length < 2) {
        console.log(chalk.yellow("Not enough keyframes for speed ramping."));
        return;
      }

      spinner.start("Applying speed ramps...");

      // Build FFmpeg filter for speed ramping (segment-based)
      const outputPath = options.output
        ? resolve(process.cwd(), options.output)
        : absPath.replace(/(\.[^.]+)$/, "-ramped$1");

      // For simplicity, we'll create segments and concatenate
      // A full implementation would use complex filter expressions
      // Here we use setpts with a simple approach

      // For demo, apply average speed or first segment's speed
      const avgSpeed = speedResult.keyframes.reduce((sum, kf) => sum + kf.speed, 0) / speedResult.keyframes.length;

      // Use setpts for speed change (1/speed for setpts)
      const setpts = `setpts=${(1 / avgSpeed).toFixed(3)}*PTS`;
      const atempo = avgSpeed >= 0.5 && avgSpeed <= 2.0 ? `atempo=${avgSpeed.toFixed(3)}` : "";

      let cmd: string;
      if (atempo) {
        cmd = `ffmpeg -i "${absPath}" -filter_complex "[0:v]${setpts}[v];[0:a]${atempo}[a]" -map "[v]" -map "[a]" "${outputPath}" -y`;
      } else {
        cmd = `ffmpeg -i "${absPath}" -vf "${setpts}" -an "${outputPath}" -y`;
      }

      await execAsync(cmd, { timeout: 600000 });

      spinner.succeed(chalk.green("Speed ramp applied"));
      console.log(chalk.green(`Output: ${outputPath}`));
      console.log(chalk.dim(`Average speed: ${avgSpeed.toFixed(2)}x`));
      console.log();
    } catch (error) {
      console.error(chalk.red("Speed ramping failed"));
      console.error(error);
      process.exit(1);
    }
  });

// Auto Reframe
ai
  .command("reframe")
  .description("Auto-reframe video to different aspect ratio (Claude Vision + FFmpeg)")
  .argument("<video>", "Video file path")
  .option("-a, --aspect <ratio>", "Target aspect ratio: 9:16, 1:1, 4:5", "9:16")
  .option("-f, --focus <mode>", "Focus mode: auto, face, center, action", "auto")
  .option("-o, --output <path>", "Output video file path")
  .option("--analyze-only", "Show crop regions without applying")
  .option("--keyframes <path>", "Export keyframes to JSON file")
  .option("-k, --api-key <key>", "Anthropic API key (or set ANTHROPIC_API_KEY env)")
  .action(async (videoPath: string, options) => {
    try {
      // Check FFmpeg
      try {
        execSync("ffmpeg -version", { stdio: "ignore" });
      } catch {
        console.error(chalk.red("FFmpeg not found. Please install FFmpeg."));
        process.exit(1);
      }

      const absPath = resolve(process.cwd(), videoPath);

      // Get video dimensions
      const spinner = ora("Analyzing video...").start();

      const { stdout: probeOut } = await execAsync(
        `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration -of csv=p=0 "${absPath}"`
      );
      const [width, height, durationStr] = probeOut.trim().split(",");
      const sourceWidth = parseInt(width);
      const sourceHeight = parseInt(height);
      const duration = parseFloat(durationStr);

      spinner.text = "Extracting keyframes...";

      // Extract keyframes every 2 seconds for analysis
      const keyframeInterval = 2;
      const numKeyframes = Math.ceil(duration / keyframeInterval);
      const tempDir = `/tmp/vibe-reframe-${Date.now()}`;
      await execAsync(`mkdir -p "${tempDir}"`);

      await execAsync(
        `ffmpeg -i "${absPath}" -vf "fps=1/${keyframeInterval}" -frame_pts 1 "${tempDir}/frame-%04d.jpg" -y`
      );

      // Get API key
      const apiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic", options.apiKey);
      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey: apiKey || undefined });

      // Analyze keyframes
      spinner.text = "Analyzing frames for subject tracking...";

      const cropKeyframes: Array<{
        time: number;
        cropX: number;
        cropY: number;
        cropWidth: number;
        cropHeight: number;
        confidence: number;
        subjectDescription: string;
      }> = [];

      for (let i = 1; i <= numKeyframes && i <= 30; i++) {
        // Limit to 30 frames
        const framePath = `${tempDir}/frame-${i.toString().padStart(4, "0")}.jpg`;

        try {
          const frameBuffer = await readFile(framePath);
          const frameBase64 = frameBuffer.toString("base64");

          const result = await claude.analyzeFrameForReframe(frameBase64, options.aspect, {
            focusMode: options.focus,
            sourceWidth,
            sourceHeight,
            mimeType: "image/jpeg",
          });

          cropKeyframes.push({
            time: (i - 1) * keyframeInterval,
            ...result,
          });

          spinner.text = `Analyzing frames... ${i}/${Math.min(numKeyframes, 30)}`;
        } catch (e) {
          // Skip failed frames
        }

        // Small delay to avoid rate limiting
        await new Promise((r) => setTimeout(r, 200));
      }

      // Clean up temp files
      try {
        await execAsync(`rm -rf "${tempDir}"`);
      } catch { /* ignore cleanup errors */ }

      spinner.succeed(chalk.green(`Analyzed ${cropKeyframes.length} keyframes`));

      console.log();
      console.log(chalk.bold.cyan("Reframe Analysis"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Source: ${sourceWidth}x${sourceHeight}`);
      console.log(`Target: ${options.aspect}`);
      console.log(`Focus: ${options.focus}`);
      console.log();

      if (cropKeyframes.length > 0) {
        const avgConf = cropKeyframes.reduce((sum, kf) => sum + kf.confidence, 0) / cropKeyframes.length;
        console.log(`Average confidence: ${(avgConf * 100).toFixed(0)}%`);
        console.log();
        console.log(chalk.dim("Sample keyframes:"));
        for (const kf of cropKeyframes.slice(0, 5)) {
          console.log(`  ${formatTime(kf.time)} → crop=${kf.cropX},${kf.cropY} (${kf.subjectDescription})`);
        }
        if (cropKeyframes.length > 5) {
          console.log(chalk.dim(`  ... and ${cropKeyframes.length - 5} more`));
        }
      }
      console.log();

      // Export keyframes if requested
      if (options.keyframes) {
        const keyframesPath = resolve(process.cwd(), options.keyframes);
        await writeFile(keyframesPath, JSON.stringify(cropKeyframes, null, 2));
        console.log(chalk.green(`Keyframes saved to: ${keyframesPath}`));
      }

      if (options.analyzeOnly) {
        console.log(chalk.dim("Use without --analyze-only to apply reframe."));
        return;
      }

      // Apply reframe using average crop position
      const avgCropX = Math.round(cropKeyframes.reduce((sum, kf) => sum + kf.cropX, 0) / cropKeyframes.length);
      const avgCropY = Math.round(cropKeyframes.reduce((sum, kf) => sum + kf.cropY, 0) / cropKeyframes.length);
      const cropWidth = cropKeyframes[0]?.cropWidth || sourceWidth;
      const cropHeight = cropKeyframes[0]?.cropHeight || sourceHeight;

      const outputPath = options.output
        ? resolve(process.cwd(), options.output)
        : absPath.replace(/(\.[^.]+)$/, `-${options.aspect.replace(":", "x")}$1`);

      spinner.start("Applying reframe...");

      const cmd = `ffmpeg -i "${absPath}" -vf "crop=${cropWidth}:${cropHeight}:${avgCropX}:${avgCropY}" -c:a copy "${outputPath}" -y`;
      await execAsync(cmd, { timeout: 600000 });

      spinner.succeed(chalk.green("Reframe applied"));
      console.log(chalk.green(`Output: ${outputPath}`));
      console.log(chalk.dim(`Crop: ${cropWidth}x${cropHeight} at (${avgCropX}, ${avgCropY})`));
      console.log();
    } catch (error) {
      console.error(chalk.red("Reframe failed"));
      console.error(error);
      process.exit(1);
    }
  });

// Style Transfer
ai
  .command("style-transfer")
  .description("Apply artistic style transfer to video (Replicate)")
  .argument("<video>", "Video file path or URL")
  .option("-s, --style <path/prompt>", "Style reference image path or text prompt")
  .option("-o, --output <path>", "Output video file path")
  .option("--strength <value>", "Transfer strength (0-1)", "0.5")
  .option("--no-wait", "Start processing without waiting")
  .option("-k, --api-key <key>", "Replicate API token (or set REPLICATE_API_TOKEN env)")
  .action(async (videoPath: string, options) => {
    try {
      if (!options.style) {
        console.error(chalk.red("Style required. Use --style <image-path> or --style <prompt>"));
        process.exit(1);
      }

      const apiKey = await getApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Replicate API token required."));
        console.error(chalk.dim("Set REPLICATE_API_TOKEN environment variable"));
        process.exit(1);
      }

      const spinner = ora("Initializing style transfer...").start();

      const replicate = new ReplicateProvider();
      await replicate.initialize({ apiKey });

      // Determine if style is an image path or text prompt
      let styleRef: string | undefined;
      let stylePrompt: string | undefined;

      if (options.style.startsWith("http://") || options.style.startsWith("https://")) {
        styleRef = options.style;
      } else if (existsSync(resolve(process.cwd(), options.style))) {
        // It's a local file - need to upload or base64
        spinner.fail(chalk.yellow("Local style images must be URLs for Replicate."));
        console.log(chalk.dim("Upload your style image to a URL and try again."));
        process.exit(1);
      } else {
        // Treat as text prompt
        stylePrompt = options.style;
      }

      // Video must be URL
      let videoUrl: string;
      if (videoPath.startsWith("http://") || videoPath.startsWith("https://")) {
        videoUrl = videoPath;
      } else {
        spinner.fail(chalk.yellow("Video must be a URL for Replicate processing."));
        console.log(chalk.dim("Upload your video to a URL and try again."));
        process.exit(1);
      }

      spinner.text = "Starting style transfer...";

      const result = await replicate.styleTransferVideo({
        videoUrl,
        styleRef,
        stylePrompt,
        strength: parseFloat(options.strength),
      });

      if (result.status === "failed") {
        spinner.fail(chalk.red(result.error || "Style transfer failed"));
        process.exit(1);
      }

      console.log();
      console.log(chalk.bold.cyan("Style Transfer Started"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Task ID: ${chalk.bold(result.id)}`);
      console.log(`Style: ${stylePrompt || styleRef}`);
      console.log(`Strength: ${options.strength}`);

      if (!options.wait) {
        spinner.succeed(chalk.green("Style transfer started"));
        console.log();
        console.log(chalk.dim("Check status with:"));
        console.log(chalk.dim(`  curl -s -H "Authorization: Bearer $REPLICATE_API_TOKEN" https://api.replicate.com/v1/predictions/${result.id}`));
        console.log();
        return;
      }

      spinner.text = "Processing style transfer (this may take several minutes)...";

      const finalResult = await replicate.waitForCompletion(
        result.id,
        (status) => {
          spinner.text = `Processing... ${status.status}`;
        },
        600000
      );

      if (finalResult.status !== "completed") {
        spinner.fail(chalk.red(finalResult.error || "Style transfer failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Style transfer complete"));

      console.log();
      if (finalResult.videoUrl) {
        console.log(`Video URL: ${finalResult.videoUrl}`);

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
      console.error(chalk.red("Style transfer failed"));
      console.error(error);
      process.exit(1);
    }
  });

} // end registerVisualFxCommands
