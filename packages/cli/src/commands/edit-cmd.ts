/**
 * @module edit-cmd
 *
 * Top-level `vibe edit` command group for post-production editing.
 *
 * Commands:
 *   edit silence-cut    - Remove silent segments (FFmpeg / Gemini)
 *   edit jump-cut       - Remove filler words (Whisper + FFmpeg)
 *   edit caption        - Add styled captions (Whisper + FFmpeg)
 *   edit noise-reduce   - Audio/video noise removal (FFmpeg)
 *   edit fade           - Fade in/out effects (FFmpeg)
 *   edit translate-srt  - Translate SRT subtitles (Claude/OpenAI)
 *   edit grade          - Color grading (Claude + FFmpeg)
 *   edit text-overlay   - Text overlays (FFmpeg drawtext)
 *   edit speed-ramp     - Speed ramping (Whisper + Claude + FFmpeg)
 *   edit reframe        - Reframe aspect ratio (Claude Vision + FFmpeg)
 *   edit image          - Image editing (Gemini/OpenAI/Grok)
 *   edit interpolate    - Frame interpolation / slow motion (FFmpeg)
 *   edit upscale-video  - Video upscaling (FFmpeg / Replicate)
 *   edit fill-gaps      - Fill timeline gaps with AI video (Kling)
 *
 * @dependencies Whisper, Claude, Gemini, Kling, Replicate, FFmpeg
 */

import { Command } from "commander";
import { resolve, dirname } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import chalk from "chalk";
import ora from "ora";
import {
  WhisperProvider,
  ClaudeProvider,
  GeminiProvider,
  OpenAIImageProvider,
  GrokProvider,
} from "@vibeframe/ai-providers";
import { requireApiKey } from "../utils/api-key.js";
import { execSafe, commandExists } from "../utils/exec-safe.js";
import { formatTime } from "./ai-helpers.js";
import { applyTextOverlays, type TextOverlayStyle } from "./ai-edit.js";
import { registerEditCommands } from "./ai-edit-cli.js";
import { registerFillGapsCommand } from "./ai-fill-gaps.js";
import { isJsonMode, outputResult, exitWithError, usageError, notFoundError, apiError, generalError } from "./output.js";
import { rejectControlChars, validateOutputPath } from "./validate.js";

export const editCommand = new Command("edit")
  .alias("ed")
  .description(
    "Edit and post-process media (silence-cut, caption, grade, reframe, upscale...)"
  )
  .addHelpText(
    "after",
    `
Examples:
  $ vibe edit silence-cut interview.mp4 -o clean.mp4
  $ vibe edit caption video.mp4 -o captioned.mp4 -s bold
  $ vibe edit grade video.mp4 -o graded.mp4 --preset cinematic-warm
  $ vibe edit reframe landscape.mp4 -o vertical.mp4 -a 9:16
  $ vibe edit image photo.png "add sunset background" -o edited.png
  $ vibe edit text-overlay video.mp4 -t "Title" -s center-bold -o out.mp4
  $ vibe edit noise-reduce noisy.mp4 -o clean.mp4 -s high
  $ vibe edit fade video.mp4 -o faded.mp4 --fade-in 1 --fade-out 1

API Keys (varies by subcommand):
  No key needed       silence-cut, noise-reduce, fade, interpolate, text-overlay
  OPENAI_API_KEY      caption, jump-cut (Whisper transcription)
  ANTHROPIC_API_KEY   grade, speed-ramp, reframe (Claude analysis)
  GOOGLE_API_KEY      image editing (Gemini, default)

Run 'vibe schema edit.<command>' for structured parameter info.
`
  );

// ── edit silence-cut, jump-cut, caption, noise-reduce, fade, translate-srt ──

registerEditCommands(editCommand);

// ── edit fill-gaps ──────────────────────────────────────────────────────

registerFillGapsCommand(editCommand);

// ── edit grade ──────────────────────────────────────────────────────────

editCommand
  .command("grade")
  .description("Apply AI-generated color grading (Claude + FFmpeg)")
  .argument("<video>", "Video file path")
  .option("-s, --style <prompt>", "Style description (e.g., 'cinematic warm')")
  .option("--preset <name>", "Built-in preset: film-noir, vintage, cinematic-warm, cool-tones, high-contrast, pastel, cyberpunk, horror")
  .option("-o, --output <path>", "Output video file path")
  .option("--analyze-only", "Show filter without applying")
  .option("-k, --api-key <key>", "Anthropic API key (or set ANTHROPIC_API_KEY env)")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (videoPath: string, options) => {
    try {
      if (options.style) rejectControlChars(options.style);
      if (options.output) {
        validateOutputPath(options.output);
      }

      if (!options.style && !options.preset) {
        exitWithError(usageError(
          "Either --style or --preset is required",
          'Examples: vibe edit grade video.mp4 --style "warm sunset" or --preset cinematic-warm',
        ));
      }

      // Check FFmpeg
      if (!commandExists("ffmpeg")) {
        exitWithError(notFoundError("FFmpeg not found. Install with: brew install ffmpeg"));
      }

      if (options.dryRun) {
        outputResult({
          dryRun: true,
          command: "edit grade",
          params: {
            videoPath: resolve(process.cwd(), videoPath),
            style: options.style || options.preset,
            analyzeOnly: options.analyzeOnly || false,
          },
        });
        return;
      }

      const spinner = ora("Analyzing color grade...").start();

      // Get API key if using style (not preset)
      let gradeResult: { ffmpegFilter: string; description: string };

      if (options.preset) {
        const claude = new ClaudeProvider();
        gradeResult = await claude.analyzeColorGrade("", options.preset);
      } else {
        let apiKey: string;
        try {
          apiKey = await requireApiKey("ANTHROPIC_API_KEY", "Anthropic", options.apiKey);
        } catch (err) {
          spinner.fail((err as Error).message);
          return;
        }
        const claude = new ClaudeProvider();
        await claude.initialize({ apiKey });
        gradeResult = await claude.analyzeColorGrade(options.style);
      }

      spinner.succeed(chalk.green("Color grade analyzed"));

      if (isJsonMode()) {
        const absPath = resolve(process.cwd(), videoPath);
        const gradeOutputPath = options.output
          ? resolve(process.cwd(), options.output)
          : absPath.replace(/(\.[^.]+)$/, "-graded$1");
        outputResult({
          success: true,
          style: options.preset || options.style,
          description: gradeResult.description,
          ffmpegFilter: gradeResult.ffmpegFilter,
          outputPath: options.analyzeOnly ? undefined : gradeOutputPath,
        });
        return;
      }

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

      await execSafe("ffmpeg", ["-i", absPath, "-vf", gradeResult.ffmpegFilter, "-c:a", "copy", outputPath, "-y"], { timeout: 600000 });

      spinner.succeed(chalk.green("Color grade applied"));
      console.log(chalk.green(`Output: ${outputPath}`));
      console.log();
    } catch (error) {
      exitWithError(apiError(`Color grading failed: ${(error as Error).message}`));
    }
  });

// ── edit text-overlay ───────────────────────────────────────────────────

editCommand
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
  .option("--dry-run", "Preview parameters without executing")
  .action(async (videoPath: string, options) => {
    try {
      if (!options.text || options.text.length === 0) {
        exitWithError(usageError("At least one --text option is required", 'Example: vibe edit text-overlay video.mp4 -t "NEXUS AI" --style center-bold'));
      }

      for (const t of options.text) rejectControlChars(t);
      if (options.output) {
        validateOutputPath(options.output);
      }

      // Check FFmpeg
      if (!commandExists("ffmpeg")) {
        exitWithError(generalError("FFmpeg not found", "Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)"));
      }

      if (options.dryRun) {
        outputResult({
          dryRun: true,
          command: "edit text-overlay",
          params: {
            videoPath: resolve(process.cwd(), videoPath),
            texts: options.text,
            style: options.style,
            fontSize: options.fontSize ? parseInt(options.fontSize) : undefined,
            fontColor: options.fontColor,
            fade: parseFloat(options.fade),
            start: parseFloat(options.start),
            end: options.end ? parseFloat(options.end) : undefined,
          },
        });
        return;
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
        spinner.fail(result.error || "Text overlay failed");
        exitWithError(apiError(result.error || "Text overlay failed", true));
      }

      spinner.succeed(chalk.green("Text overlays applied"));

      if (isJsonMode()) {
        outputResult({
          success: true,
          style: options.style,
          texts: options.text,
          outputPath: result.outputPath,
        });
        return;
      }

      console.log();
      console.log(chalk.bold.cyan("Text Overlay"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Style: ${options.style}`);
      console.log(`Texts: ${options.text.join(", ")}`);
      console.log(`Output: ${result.outputPath}`);
      console.log();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Text overlay failed: ${msg}`));
    }
  });

// ── edit speed-ramp ─────────────────────────────────────────────────────

editCommand
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
  .option("--dry-run", "Preview parameters without executing")
  .action(async (videoPath: string, options) => {
    try {
      if (options.output) {
        validateOutputPath(options.output);
      }

      // Check FFmpeg
      if (!commandExists("ffmpeg")) {
        exitWithError(generalError("FFmpeg not found", "Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)"));
      }

      if (options.dryRun) {
        outputResult({
          dryRun: true,
          command: "edit speed-ramp",
          params: {
            videoPath: resolve(process.cwd(), videoPath),
            style: options.style,
            minSpeed: parseFloat(options.minSpeed),
            maxSpeed: parseFloat(options.maxSpeed),
            analyzeOnly: options.analyzeOnly || false,
          },
        });
        return;
      }

      const openaiApiKey = await requireApiKey("OPENAI_API_KEY", "OpenAI");
      const claudeApiKey = await requireApiKey("ANTHROPIC_API_KEY", "Anthropic", options.apiKey);

      const absPath = resolve(process.cwd(), videoPath);

      // Step 1: Check for audio stream
      const spinner = ora("Extracting audio...").start();

      const { stdout: speedRampProbe } = await execSafe("ffprobe", [
        "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", absPath,
      ]);
      if (!speedRampProbe.trim()) {
        spinner.fail("Video has no audio track");
        exitWithError(usageError("Video has no audio stream. Speed ramping requires audio for content-aware analysis.", "Please use a video with an audio track."));
      }

      const tempAudio = absPath.replace(/(\.[^.]+)$/, "-temp-audio.mp3");

      await execSafe("ffmpeg", ["-i", absPath, "-vn", "-acodec", "libmp3lame", "-q:a", "2", tempAudio, "-y"]);

      // Step 2: Transcribe
      spinner.text = "Transcribing audio...";

      const whisper = new WhisperProvider();
      await whisper.initialize({ apiKey: openaiApiKey });

      const audioBuffer = await readFile(tempAudio);
      const audioBlob = new Blob([audioBuffer]);
      const transcript = await whisper.transcribe(audioBlob, options.language);

      if (!transcript.segments || transcript.segments.length === 0) {
        spinner.fail("No transcript segments found");
        exitWithError(apiError("No transcript segments found", true));
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
        const { unlink } = await import("node:fs/promises");
        await unlink(tempAudio);
      } catch { /* ignore cleanup errors */ }

      spinner.succeed(chalk.green(`Found ${speedResult.keyframes.length} speed keyframes`));

      if (isJsonMode()) {
        const avgSpeed = speedResult.keyframes.reduce((sum, kf) => sum + kf.speed, 0) / speedResult.keyframes.length;
        const speedRampOutputPath = options.output
          ? resolve(process.cwd(), options.output)
          : absPath.replace(/(\.[^.]+)$/, "-ramped$1");
        outputResult({
          success: true,
          keyframes: speedResult.keyframes,
          avgSpeed,
          outputPath: options.analyzeOnly ? undefined : speedRampOutputPath,
        });
        return;
      }

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

      if (atempo) {
        await execSafe("ffmpeg", ["-i", absPath, "-filter_complex", `[0:v]${setpts}[v];[0:a]${atempo}[a]`, "-map", "[v]", "-map", "[a]", outputPath, "-y"], { timeout: 600000 });
      } else {
        await execSafe("ffmpeg", ["-i", absPath, "-vf", setpts, "-an", outputPath, "-y"], { timeout: 600000 });
      }

      spinner.succeed(chalk.green("Speed ramp applied"));
      console.log(chalk.green(`Output: ${outputPath}`));
      console.log(chalk.dim(`Average speed: ${avgSpeed.toFixed(2)}x`));
      console.log();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Speed ramping failed: ${msg}`));
    }
  });

// ── edit reframe ────────────────────────────────────────────────────────

editCommand
  .command("reframe")
  .description("Auto-reframe video to different aspect ratio (Claude Vision + FFmpeg)")
  .argument("<video>", "Video file path")
  .option("-a, --aspect <ratio>", "Target aspect ratio: 9:16, 1:1, 4:5", "9:16")
  .option("-f, --focus <mode>", "Focus mode: auto, face, center, action", "auto")
  .option("-o, --output <path>", "Output video file path")
  .option("--analyze-only", "Show crop regions without applying")
  .option("--keyframes <path>", "Export keyframes to JSON file")
  .option("-k, --api-key <key>", "Anthropic API key (or set ANTHROPIC_API_KEY env)")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (videoPath: string, options) => {
    try {
      if (options.output) {
        validateOutputPath(options.output);
      }

      // Check FFmpeg
      if (!commandExists("ffmpeg")) {
        exitWithError(generalError("FFmpeg not found", "Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)"));
      }

      if (options.dryRun) {
        outputResult({
          dryRun: true,
          command: "edit reframe",
          params: {
            videoPath: resolve(process.cwd(), videoPath),
            aspect: options.aspect,
            focus: options.focus,
            analyzeOnly: options.analyzeOnly || false,
          },
        });
        return;
      }

      const absPath = resolve(process.cwd(), videoPath);

      // Get video dimensions
      const spinner = ora("Analyzing video...").start();

      const { stdout: probeOut } = await execSafe("ffprobe", [
        "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,duration", "-of", "csv=p=0", absPath,
      ]);
      const [width, height, durationStr] = probeOut.trim().split(",");
      const sourceWidth = parseInt(width);
      const sourceHeight = parseInt(height);
      const duration = parseFloat(durationStr);

      spinner.text = "Extracting keyframes...";

      // Extract keyframes every 2 seconds for analysis
      const keyframeInterval = 2;
      const numKeyframes = Math.ceil(duration / keyframeInterval);
      const tempDir = `/tmp/vibe-reframe-${Date.now()}`;
      const { mkdir: mkdirFs } = await import("node:fs/promises");
      await mkdirFs(tempDir, { recursive: true });

      await execSafe("ffmpeg", ["-i", absPath, "-vf", `fps=1/${keyframeInterval}`, "-frame_pts", "1", `${tempDir}/frame-%04d.jpg`, "-y"]);

      // Get API key
      let apiKey: string;
      try {
        apiKey = await requireApiKey("ANTHROPIC_API_KEY", "Anthropic", options.apiKey);
      } catch (err) {
        spinner.fail((err as Error).message);
        return;
      }
      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey });

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
        } catch {
          // Skip failed frames
        }

        // Small delay to avoid rate limiting
        await new Promise((r) => setTimeout(r, 200));
      }

      // Clean up temp files
      try {
        const { rm: rmFs } = await import("node:fs/promises");
        await rmFs(tempDir, { recursive: true, force: true });
      } catch { /* ignore cleanup errors */ }

      spinner.succeed(chalk.green(`Analyzed ${cropKeyframes.length} keyframes`));

      if (isJsonMode()) {
        const reframeOutputPath = options.output
          ? resolve(process.cwd(), options.output)
          : absPath.replace(/(\.[^.]+)$/, `-${options.aspect.replace(":", "x")}$1`);
        outputResult({
          success: true,
          sourceWidth,
          sourceHeight,
          aspect: options.aspect,
          cropKeyframes,
          outputPath: options.analyzeOnly ? undefined : reframeOutputPath,
        });
        return;
      }

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

      await execSafe("ffmpeg", ["-i", absPath, "-vf", `crop=${cropWidth}:${cropHeight}:${avgCropX}:${avgCropY}`, "-c:a", "copy", outputPath, "-y"], { timeout: 600000 });

      spinner.succeed(chalk.green("Reframe applied"));
      console.log(chalk.green(`Output: ${outputPath}`));
      console.log(chalk.dim(`Crop: ${cropWidth}x${cropHeight} at (${avgCropX}, ${avgCropY})`));
      console.log();
    } catch (error) {
      console.error(chalk.red("Reframe failed"));
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Reframe failed: ${msg}`));
    }
  });

// ── edit image (Gemini multi-image editing) ─────────────────────────────

editCommand
  .command("image")
  .description("Edit image(s) using AI (Gemini/OpenAI/Grok)")
  .argument("<images...>", "Input image file(s) followed by edit prompt")
  .option("-p, --provider <provider>", "Provider: gemini (default), openai, grok", "gemini")
  .option("-k, --api-key <key>", "API key (or set env variable)")
  .option("-o, --output <path>", "Output file path", "edited.png")
  .option("-m, --model <model>", "Model: flash/3.1-flash/latest/pro (Gemini only)", "flash")
  .option("-r, --ratio <ratio>", "Output aspect ratio")
  .option("-s, --size <resolution>", "Resolution: 1K, 2K, 4K (Gemini Pro only)")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (args: string[], options) => {
    try {
      // Last argument is the prompt, rest are image paths
      if (args.length < 2) {
        exitWithError(usageError("Need at least one image and a prompt"));
      }

      const prompt = args[args.length - 1];
      rejectControlChars(prompt);
      if (options.output) {
        validateOutputPath(options.output);
      }
      const imagePaths = args.slice(0, -1);
      const provider = options.provider as string;

      // Grok only supports 1 image
      if (provider === "grok" && imagePaths.length > 1) {
        exitWithError(usageError("Grok supports only 1 input image for editing.", "Use -p gemini (up to 14 images) or -p openai (up to 16 images) for multi-image editing."));
      }

      if (options.dryRun) {
        outputResult({
          dryRun: true,
          command: "edit image",
          params: {
            imagePaths: imagePaths.map((p: string) => resolve(process.cwd(), p)),
            prompt,
            provider,
            model: options.model,
            ratio: options.ratio,
            size: options.size,
          },
        });
        return;
      }

      // Provider-specific API key resolution
      const apiKeyMap: Record<string, { envVar: string; label: string }> = {
        gemini: { envVar: "GOOGLE_API_KEY", label: "Google" },
        openai: { envVar: "OPENAI_API_KEY", label: "OpenAI" },
        grok: { envVar: "XAI_API_KEY", label: "xAI" },
      };
      const keyInfo = apiKeyMap[provider] || apiKeyMap.gemini;
      const apiKey = await requireApiKey(keyInfo.envVar, keyInfo.label, options.apiKey);

      const spinner = ora(`Reading ${imagePaths.length} image(s)...`).start();

      // Load all images
      const imageBuffers: Buffer[] = [];
      for (const imagePath of imagePaths) {
        const absPath = resolve(process.cwd(), imagePath);
        const buffer = await readFile(absPath);
        imageBuffers.push(buffer);
      }

      let result: import("@vibeframe/ai-providers").ImageResult;

      if (provider === "openai") {
        spinner.text = "Editing with GPT Image 1.5...";
        const openaiImage = new OpenAIImageProvider();
        await openaiImage.initialize({ apiKey });
        result = await openaiImage.editImage(imageBuffers, prompt);
      } else if (provider === "grok") {
        spinner.text = "Editing with Grok Imagine...";
        const grok = new GrokProvider();
        await grok.initialize({ apiKey });
        result = await grok.editImage(imageBuffers[0], prompt, {
          aspectRatio: options.ratio,
        });
      } else {
        // Gemini (default)
        const editModelNames: Record<string, string> = {
          flash: "gemini-2.5-flash-image",
          "3.1-flash": "gemini-3.1-flash-image-preview",
          latest: "gemini-3.1-flash-image-preview",
          pro: "gemini-3-pro-image-preview",
        };
        const editModelName = editModelNames[options.model] || editModelNames.flash;
        spinner.text = `Editing with ${editModelName}...`;

        const gemini = new GeminiProvider();
        await gemini.initialize({ apiKey });

        result = await gemini.editImage(imageBuffers, prompt, {
          model: options.model,
          aspectRatio: options.ratio,
          resolution: options.size,
        });

        // Auto-fallback: if latest/3.1-flash fails, retry with flash
        const fallbackModels = ["latest", "3.1-flash"];
        if (!result.success && fallbackModels.includes(options.model)) {
          spinner.text = `${chalk.dim(result.error || `${editModelName} failed`)} — retrying with flash...`;
          result = await gemini.editImage(imageBuffers, prompt, {
            model: "flash",
            aspectRatio: options.ratio,
            resolution: options.size,
          });
        }
      }

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail(result.error || "Image editing failed");
        exitWithError(apiError(result.error || "Image editing failed", true));
      }

      spinner.succeed(chalk.green("Image edited"));

      // Save image — handle both base64 and URL responses
      const img = result.images[0];
      const outputPath = resolve(process.cwd(), options.output);

      const saveImage = async () => {
        await mkdir(dirname(outputPath), { recursive: true });
        if (img.base64) {
          const buffer = Buffer.from(img.base64, "base64");
          await writeFile(outputPath, buffer);
        } else if (img.url) {
          const resp = await fetch(img.url);
          const arrayBuf = await resp.arrayBuffer();
          await writeFile(outputPath, Buffer.from(arrayBuf));
        }
      };

      // Gemini results may include a `model` field
      const resultModel = (result as { model?: string }).model;

      if (isJsonMode()) {
        outputResult({
          success: true,
          provider,
          model: resultModel || options.model,
          outputPath,
        });
        await saveImage();
        return;
      }

      if (resultModel) {
        console.log(chalk.dim(`Model: ${resultModel}`));
      }

      await saveImage();
      console.log(chalk.green(`Saved to: ${outputPath}`));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(apiError(`Image editing failed: ${msg}`, true));
    }
  });

// ── edit interpolate (frame interpolation / slow motion) ────────────────

editCommand
  .command("interpolate")
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
        outputResult({
          dryRun: true,
          command: "edit interpolate",
          params: {
            videoPath: absPath,
            factor,
            fps: options.fps ? parseInt(options.fps) : undefined,
            quality: options.quality,
          },
        });
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

        if (isJsonMode()) {
          outputResult({
            success: true,
            originalFps,
            targetFps,
            factor,
            outputPath,
          });
          return;
        }

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

// ── edit upscale-video (video upscaling) ────────────────────────────────

editCommand
  .command("upscale-video")
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
        outputResult({
          dryRun: true,
          command: "edit upscale-video",
          params: {
            videoPath: absPath,
            scale,
            model: options.model,
            ffmpeg: options.ffmpeg || false,
          },
        });
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

          if (isJsonMode()) {
            outputResult({
              success: true,
              dimensions: `${newWidth}x${newHeight}`,
              outputPath,
            });
            return;
          }

          console.log(`Output: ${outputPath}`);
        } catch (err) {
          spinner.fail("FFmpeg upscaling failed");
          const msg = err instanceof Error ? err.message : String(err);
          exitWithError(generalError(`FFmpeg upscaling failed: ${msg}`));
        }
        return;
      }

      // Use Replicate API
      const apiKey = await requireApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);

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


// ── Exported execute functions ─────────────────────────────────────────────


// ============================================================================
// Color Grade
// ============================================================================

export interface GradeOptions {
  videoPath: string;
  style?: string;
  preset?: string;
  output?: string;
  analyzeOnly?: boolean;
  apiKey?: string;
}

export interface GradeResult {
  success: boolean;
  outputPath?: string;
  style?: string;
  description?: string;
  ffmpegFilter?: string;
  error?: string;
}

export async function executeGrade(options: GradeOptions): Promise<GradeResult> {
  const { videoPath, style, preset, output, analyzeOnly, apiKey } = options;

  try {
    if (!style && !preset) return { success: false, error: "Either style or preset is required" };
    if (!commandExists("ffmpeg")) return { success: false, error: "FFmpeg not found" };

    const absPath = resolve(process.cwd(), videoPath);
    let gradeResult: { ffmpegFilter: string; description: string };

    if (preset) {
      const claude = new ClaudeProvider();
      gradeResult = await claude.analyzeColorGrade("", preset);
    } else {
      const key = apiKey || process.env.ANTHROPIC_API_KEY;
      if (!key) return { success: false, error: "ANTHROPIC_API_KEY required for custom style grading" };
      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey: key });
      gradeResult = await claude.analyzeColorGrade(style!);
    }

    if (analyzeOnly) {
      return { success: true, style: preset || style, description: gradeResult.description, ffmpegFilter: gradeResult.ffmpegFilter };
    }

    const outputPath = output ? resolve(process.cwd(), output) : absPath.replace(/(\.[^.]+)$/, "-graded$1");
    await execSafe("ffmpeg", ["-i", absPath, "-vf", gradeResult.ffmpegFilter, "-c:a", "copy", outputPath, "-y"], { timeout: 600000 });

    return { success: true, outputPath, style: preset || style, description: gradeResult.description, ffmpegFilter: gradeResult.ffmpegFilter };
  } catch (error) {
    return { success: false, error: `Color grading failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}


// ============================================================================
// Speed Ramp
// ============================================================================

export interface SpeedRampOptions {
  videoPath: string;
  output?: string;
  style?: "dramatic" | "smooth" | "action";
  minSpeed?: number;
  maxSpeed?: number;
  analyzeOnly?: boolean;
  language?: string;
  apiKey?: string;
}

export interface SpeedRampResult {
  success: boolean;
  outputPath?: string;
  keyframes?: Array<{ time: number; speed: number; reason: string }>;
  avgSpeed?: number;
  error?: string;
}

export async function executeSpeedRamp(options: SpeedRampOptions): Promise<SpeedRampResult> {
  const { videoPath, output, style = "dramatic", minSpeed = 0.25, maxSpeed = 4.0, analyzeOnly, language, apiKey } = options;

  try {
    if (!commandExists("ffmpeg")) return { success: false, error: "FFmpeg not found" };

    const openaiKey = process.env.OPENAI_API_KEY;
    const claudeKey = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!openaiKey) return { success: false, error: "OPENAI_API_KEY required for Whisper transcription" };
    if (!claudeKey) return { success: false, error: "ANTHROPIC_API_KEY required for Claude analysis" };

    const absPath = resolve(process.cwd(), videoPath);

    // Extract audio
    const tempAudio = absPath.replace(/(\.[^.]+)$/, "-temp-audio.mp3");
    await execSafe("ffmpeg", ["-i", absPath, "-vn", "-acodec", "libmp3lame", "-q:a", "2", tempAudio, "-y"]);

    // Transcribe
    const whisper = new WhisperProvider();
    await whisper.initialize({ apiKey: openaiKey });
    const audioBuffer = await readFile(tempAudio);
    const transcript = await whisper.transcribe(new Blob([audioBuffer]), language);

    // Cleanup temp
    try { const { unlink } = await import("node:fs/promises"); await unlink(tempAudio); } catch { /* best-effort */ }

    if (!transcript.segments || transcript.segments.length === 0) {
      return { success: false, error: "No transcript segments found" };
    }

    // Analyze with Claude
    const claude = new ClaudeProvider();
    await claude.initialize({ apiKey: claudeKey });
    const speedResult = await claude.analyzeForSpeedRamp(transcript.segments, { style, minSpeed, maxSpeed });

    const avgSpeed = speedResult.keyframes.reduce((sum: number, kf: { speed: number }) => sum + kf.speed, 0) / speedResult.keyframes.length;

    if (analyzeOnly) {
      return { success: true, keyframes: speedResult.keyframes, avgSpeed };
    }

    if (speedResult.keyframes.length < 2) {
      return { success: false, error: "Not enough keyframes for speed ramping" };
    }

    const outputPath = output ? resolve(process.cwd(), output) : absPath.replace(/(\.[^.]+)$/, "-ramped$1");
    const setpts = `setpts=${(1 / avgSpeed).toFixed(3)}*PTS`;
    const atempo = avgSpeed >= 0.5 && avgSpeed <= 2.0 ? `atempo=${avgSpeed.toFixed(3)}` : "";

    if (atempo) {
      await execSafe("ffmpeg", ["-i", absPath, "-filter_complex", `[0:v]${setpts}[v];[0:a]${atempo}[a]`, "-map", "[v]", "-map", "[a]", outputPath, "-y"], { timeout: 600000 });
    } else {
      await execSafe("ffmpeg", ["-i", absPath, "-vf", setpts, "-an", outputPath, "-y"], { timeout: 600000 });
    }

    return { success: true, outputPath, keyframes: speedResult.keyframes, avgSpeed };
  } catch (error) {
    return { success: false, error: `Speed ramping failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}


// ============================================================================
// Reframe
// ============================================================================

export interface ReframeOptions {
  videoPath: string;
  aspect?: string;
  focus?: "auto" | "face" | "center" | "action";
  output?: string;
  analyzeOnly?: boolean;
  apiKey?: string;
}

export interface ReframeResult {
  success: boolean;
  outputPath?: string;
  sourceAspect?: string;
  targetAspect?: string;
  keyframeCount?: number;
  error?: string;
}

export async function executeReframe(options: ReframeOptions): Promise<ReframeResult> {
  const { videoPath, aspect = "9:16", output, analyzeOnly } = options;

  try {
    if (!commandExists("ffmpeg")) return { success: false, error: "FFmpeg not found" };

    const absPath = resolve(process.cwd(), videoPath);

    // Get video dimensions
    const { stdout: probeOut } = await execSafe("ffprobe", [
      "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,duration", "-of", "csv=p=0", absPath,
    ]);
    const [widthStr, heightStr] = probeOut.trim().split(",");
    const sourceWidth = parseInt(widthStr);
    const sourceHeight = parseInt(heightStr);

    // Parse target aspect ratio
    const [tw, th] = aspect.split(":").map(Number);
    const targetRatio = tw / th;
    let cropWidth: number, cropHeight: number;

    if (targetRatio > sourceWidth / sourceHeight) {
      cropWidth = sourceWidth;
      cropHeight = Math.round(sourceWidth / targetRatio);
    } else {
      cropHeight = sourceHeight;
      cropWidth = Math.round(sourceHeight * targetRatio);
    }

    // Center crop (simple reframe without AI for MCP — Claude Vision analysis is expensive per frame)
    const cropX = Math.round((sourceWidth - cropWidth) / 2);
    const cropY = Math.round((sourceHeight - cropHeight) / 2);

    if (analyzeOnly) {
      return {
        success: true,
        sourceAspect: `${sourceWidth}:${sourceHeight}`,
        targetAspect: aspect,
        keyframeCount: 1,
      };
    }

    const outputPath = output ? resolve(process.cwd(), output) : absPath.replace(/(\.[^.]+)$/, `-${aspect.replace(":", "x")}$1`);
    await execSafe("ffmpeg", ["-i", absPath, "-vf", `crop=${cropWidth}:${cropHeight}:${cropX}:${cropY}`, "-c:a", "copy", outputPath, "-y"], { timeout: 600000 });

    return { success: true, outputPath, sourceAspect: `${sourceWidth}:${sourceHeight}`, targetAspect: aspect };
  } catch (error) {
    return { success: false, error: `Reframe failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}


// ============================================================================
// Interpolate (Slow Motion)
// ============================================================================

export interface InterpolateOptions {
  videoPath: string;
  output?: string;
  factor?: number;
  fps?: number;
  quality?: "fast" | "quality";
}

export interface InterpolateResult {
  success: boolean;
  outputPath?: string;
  originalFps?: number;
  targetFps?: number;
  factor?: number;
  error?: string;
}

export async function executeInterpolate(options: InterpolateOptions): Promise<InterpolateResult> {
  const { videoPath, output, factor = 2, quality = "quality" } = options;

  try {
    if (!commandExists("ffmpeg")) return { success: false, error: "FFmpeg not found" };
    if (![2, 4, 8].includes(factor)) return { success: false, error: "Factor must be 2, 4, or 8" };

    const absPath = resolve(process.cwd(), videoPath);

    const { stdout: fpsOut } = await execSafe("ffprobe", [
      "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "default=noprint_wrappers=1:nokey=1", absPath,
    ]);
    const [num, den] = fpsOut.trim().split("/").map(Number);
    const originalFps = num / (den || 1);
    const targetFps = options.fps || originalFps * factor;

    const mi = quality === "fast" ? "mi_mode=mci" : "mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1";
    const outputPath = output ? resolve(process.cwd(), output) : absPath.replace(/(\.[^.]+)$/, `-slow${factor}x$1`);

    await execSafe("ffmpeg", ["-i", absPath, "-filter:v", `minterpolate='${mi}:fps=${targetFps}',setpts=${factor}*PTS`, "-an", outputPath, "-y"], { timeout: 600000 });

    return { success: true, outputPath, originalFps, targetFps, factor };
  } catch (error) {
    return { success: false, error: `Frame interpolation failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}


// ============================================================================
// Upscale Video
// ============================================================================

export interface UpscaleOptions {
  videoPath: string;
  output?: string;
  scale?: number;
  quality?: "fast" | "quality";
}

export interface UpscaleResult {
  success: boolean;
  outputPath?: string;
  originalRes?: string;
  targetRes?: string;
  error?: string;
}

export async function executeUpscale(options: UpscaleOptions): Promise<UpscaleResult> {
  const { videoPath, output, scale = 2, quality = "quality" } = options;

  try {
    if (!commandExists("ffmpeg")) return { success: false, error: "FFmpeg not found" };

    const absPath = resolve(process.cwd(), videoPath);

    const { stdout: probeOut } = await execSafe("ffprobe", [
      "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", absPath,
    ]);
    const [w, h] = probeOut.trim().split(",").map(Number);
    const targetW = w * scale;
    const targetH = h * scale;

    const scaleFilter = quality === "quality" ? `scale=${targetW}:${targetH}:flags=lanczos` : `scale=${targetW}:${targetH}`;
    const outputPath = output ? resolve(process.cwd(), output) : absPath.replace(/(\.[^.]+)$/, `-${scale}x$1`);

    await execSafe("ffmpeg", ["-i", absPath, "-vf", scaleFilter, "-c:a", "copy", outputPath, "-y"], { timeout: 600000 });

    return { success: true, outputPath, originalRes: `${w}x${h}`, targetRes: `${targetW}x${targetH}` };
  } catch (error) {
    return { success: false, error: `Upscale failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
