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
 *   edit image          - Multi-image editing (Gemini)
 *   edit upscale        - Image upscaling (Stability AI)
 *   edit remove-bg      - Background removal (Stability AI)
 *   edit outpaint       - Outpainting (Stability AI)
 *   edit replace        - Search and replace in images (Stability AI)
 *   edit interpolate    - Frame interpolation / slow motion (FFmpeg)
 *   edit upscale-video  - Video upscaling (FFmpeg / Replicate)
 *   edit fill-gaps      - Fill timeline gaps with AI video (Kling)
 *
 * @dependencies Whisper, Claude, Gemini, Stability, Kling, Replicate, FFmpeg
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
  StabilityProvider,
} from "@vibeframe/ai-providers";
import { getApiKey } from "../utils/api-key.js";
import { execSafe, commandExists } from "../utils/exec-safe.js";
import { formatTime } from "./ai-helpers.js";
import { applyTextOverlays, type TextOverlayStyle } from "./ai-edit.js";
import { registerEditCommands } from "./ai-edit-cli.js";
import { registerFillGapsCommand } from "./ai-fill-gaps.js";
import { isJsonMode, outputResult } from "./output.js";

export const editCommand = new Command("edit").description(
  "Edit and post-process media (silence-cut, caption, grade, reframe, upscale...)"
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
      if (!options.style && !options.preset) {
        console.error(chalk.red("Either --style or --preset is required"));
        console.log(chalk.dim("Examples:"));
        console.log(chalk.dim('  pnpm vibe edit grade video.mp4 --style "warm sunset"'));
        console.log(chalk.dim("  pnpm vibe edit grade video.mp4 --preset cinematic-warm"));
        process.exit(1);
      }

      // Check FFmpeg
      if (!commandExists("ffmpeg")) {
        console.error(chalk.red("FFmpeg not found. Please install FFmpeg."));
        process.exit(1);
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
        const apiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic", options.apiKey);
        const claude = new ClaudeProvider();
        await claude.initialize({ apiKey: apiKey || undefined });
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
      console.error(chalk.red("Color grading failed"));
      console.error(error);
      process.exit(1);
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
        console.error(chalk.red("At least one --text option is required"));
        console.log(chalk.dim("Example:"));
        console.log(chalk.dim('  pnpm vibe edit text-overlay video.mp4 -t "NEXUS AI" -t "Intelligence, Unleashed" --style center-bold'));
        process.exit(1);
      }

      // Check FFmpeg
      if (!commandExists("ffmpeg")) {
        console.error(chalk.red("FFmpeg not found. Please install FFmpeg."));
        process.exit(1);
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
        spinner.fail(chalk.red(result.error || "Text overlay failed"));
        process.exit(1);
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
      console.error(chalk.red("Text overlay failed"));
      console.error(error);
      process.exit(1);
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
      // Check FFmpeg
      if (!commandExists("ffmpeg")) {
        console.error(chalk.red("FFmpeg not found. Please install FFmpeg."));
        process.exit(1);
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

      const { stdout: speedRampProbe } = await execSafe("ffprobe", [
        "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", absPath,
      ]);
      if (!speedRampProbe.trim()) {
        spinner.fail(chalk.yellow("Video has no audio track — cannot use Whisper transcription"));
        console.log(chalk.yellow("\nThis video has no audio stream."));
        console.log(chalk.dim("  Speed ramping requires audio for content-aware analysis."));
        console.log(chalk.dim("  Please use a video with an audio track.\n"));
        process.exit(1);
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
      console.error(chalk.red("Speed ramping failed"));
      console.error(error);
      process.exit(1);
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
      // Check FFmpeg
      if (!commandExists("ffmpeg")) {
        console.error(chalk.red("FFmpeg not found. Please install FFmpeg."));
        process.exit(1);
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
      console.error(error);
      process.exit(1);
    }
  });

// ── edit image (Gemini multi-image editing) ─────────────────────────────

editCommand
  .command("image")
  .description("Edit image(s) using Gemini (Nano Banana)")
  .argument("<images...>", "Input image file(s) followed by edit prompt")
  .option("-k, --api-key <key>", "Google API key (or set GOOGLE_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "edited.png")
  .option("-m, --model <model>", "Model: flash (max 3 images), 3.1-flash / latest (max 3 images), pro (max 14 images)", "flash")
  .option("-r, --ratio <ratio>", "Output aspect ratio")
  .option("-s, --size <resolution>", "Resolution: 1K, 2K, 4K (Pro model only)")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (args: string[], options) => {
    try {
      // Last argument is the prompt, rest are image paths
      if (args.length < 2) {
        console.error(chalk.red("Need at least one image and a prompt"));
        process.exit(1);
      }

      const prompt = args[args.length - 1];
      const imagePaths = args.slice(0, -1);

      if (options.dryRun) {
        outputResult({
          dryRun: true,
          command: "edit image",
          params: {
            imagePaths: imagePaths.map((p: string) => resolve(process.cwd(), p)),
            prompt,
            model: options.model,
            ratio: options.ratio,
            size: options.size,
          },
        });
        return;
      }

      const apiKey = await getApiKey("GOOGLE_API_KEY", "Google", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Google API key required."));
        process.exit(1);
      }

      const spinner = ora(`Reading ${imagePaths.length} image(s)...`).start();

      // Load all images
      const imageBuffers: Buffer[] = [];
      for (const imagePath of imagePaths) {
        const absPath = resolve(process.cwd(), imagePath);
        const buffer = await readFile(absPath);
        imageBuffers.push(buffer);
      }

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

      let result = await gemini.editImage(imageBuffers, prompt, {
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

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail(chalk.red(result.error || "Image editing failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Image edited"));

      if (isJsonMode()) {
        outputResult({
          success: true,
          model: result.model || options.model,
          outputPath: resolve(process.cwd(), options.output),
        });
        // Still save the file before returning
        const img = result.images![0];
        if (img.base64) {
          const outputPath = resolve(process.cwd(), options.output);
          await mkdir(dirname(outputPath), { recursive: true });
          const buffer = Buffer.from(img.base64, "base64");
          await writeFile(outputPath, buffer);
        }
        return;
      }

      if (result.model) {
        console.log(chalk.dim(`Model: ${result.model}`));
      }

      const img = result.images[0];
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
        await mkdir(dirname(outputPath), { recursive: true });
        const buffer = Buffer.from(img.base64, "base64");
        await writeFile(outputPath, buffer);
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      console.error(chalk.red("Image editing failed"));
      console.error(error);
      process.exit(1);
    }
  });

// ── edit upscale (Stability AI image upscale) ───────────────────────────

editCommand
  .command("upscale")
  .description("Upscale image using Stability AI")
  .argument("<image>", "Input image file path")
  .option("-k, --api-key <key>", "Stability AI API key (or set STABILITY_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "upscaled.png")
  .option("-t, --type <type>", "Upscale type: fast, conservative, creative", "fast")
  .option("-c, --creativity <value>", "Creativity (0-0.35, for creative upscale)")
  .option("-f, --format <format>", "Output format: png, jpeg, webp", "png")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (imagePath: string, options) => {
    try {
      if (options.dryRun) {
        outputResult({
          dryRun: true,
          command: "edit upscale",
          params: {
            imagePath: resolve(process.cwd(), imagePath),
            type: options.type,
            creativity: options.creativity ? parseFloat(options.creativity) : undefined,
            format: options.format,
          },
        });
        return;
      }

      const apiKey = await getApiKey("STABILITY_API_KEY", "Stability AI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Stability AI API key required"));
        process.exit(1);
      }

      const spinner = ora("Reading image...").start();

      const absPath = resolve(process.cwd(), imagePath);
      const imageBuffer = await readFile(absPath);

      spinner.text = "Upscaling image...";

      const stability = new StabilityProvider();
      await stability.initialize({ apiKey });

      const result = await stability.upscaleImage(imageBuffer, {
        type: options.type as "fast" | "conservative" | "creative",
        creativity: options.creativity ? parseFloat(options.creativity) : undefined,
        outputFormat: options.format,
      });

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail(chalk.red(result.error || "Upscale failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Image upscaled"));

      if (isJsonMode()) {
        const img = result.images[0];
        if (img.base64) {
          const outputPath = resolve(process.cwd(), options.output);
          await mkdir(dirname(outputPath), { recursive: true });
          const buffer = Buffer.from(img.base64, "base64");
          await writeFile(outputPath, buffer);
        }
        outputResult({
          success: true,
          outputPath: resolve(process.cwd(), options.output),
        });
        return;
      }

      const img = result.images[0];
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
        await mkdir(dirname(outputPath), { recursive: true });
        const buffer = Buffer.from(img.base64, "base64");
        await writeFile(outputPath, buffer);
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      console.error(chalk.red("Upscale failed"));
      console.error(error);
      process.exit(1);
    }
  });

// ── edit remove-bg (Stability AI background removal) ────────────────────

editCommand
  .command("remove-bg")
  .description("Remove background from image using Stability AI")
  .argument("<image>", "Input image file path")
  .option("-k, --api-key <key>", "Stability AI API key (or set STABILITY_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "no-bg.png")
  .option("-f, --format <format>", "Output format: png, webp", "png")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (imagePath: string, options) => {
    try {
      if (options.dryRun) {
        outputResult({
          dryRun: true,
          command: "edit remove-bg",
          params: {
            imagePath: resolve(process.cwd(), imagePath),
            format: options.format,
          },
        });
        return;
      }

      const apiKey = await getApiKey("STABILITY_API_KEY", "Stability AI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Stability AI API key required"));
        process.exit(1);
      }

      const spinner = ora("Reading image...").start();

      const absPath = resolve(process.cwd(), imagePath);
      const imageBuffer = await readFile(absPath);

      spinner.text = "Removing background...";

      const stability = new StabilityProvider();
      await stability.initialize({ apiKey });

      const result = await stability.removeBackground(imageBuffer, options.format as "png" | "webp");

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail(chalk.red(result.error || "Background removal failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Background removed"));

      if (isJsonMode()) {
        const img = result.images[0];
        if (img.base64) {
          const outputPath = resolve(process.cwd(), options.output);
          await mkdir(dirname(outputPath), { recursive: true });
          const buffer = Buffer.from(img.base64, "base64");
          await writeFile(outputPath, buffer);
        }
        outputResult({
          success: true,
          outputPath: resolve(process.cwd(), options.output),
        });
        return;
      }

      const img = result.images[0];
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
        await mkdir(dirname(outputPath), { recursive: true });
        const buffer = Buffer.from(img.base64, "base64");
        await writeFile(outputPath, buffer);
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      console.error(chalk.red("Background removal failed"));
      console.error(error);
      process.exit(1);
    }
  });

// ── edit outpaint (Stability AI outpainting) ────────────────────────────

editCommand
  .command("outpaint")
  .description("Extend image canvas (outpainting) using Stability AI")
  .argument("<image>", "Input image file path")
  .option("-k, --api-key <key>", "Stability AI API key (or set STABILITY_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "outpainted.png")
  .option("--left <pixels>", "Pixels to extend on the left (0-2000)")
  .option("--right <pixels>", "Pixels to extend on the right (0-2000)")
  .option("--up <pixels>", "Pixels to extend upward (0-2000)")
  .option("--down <pixels>", "Pixels to extend downward (0-2000)")
  .option("--prompt <text>", "Prompt for the extended area")
  .option("-c, --creativity <value>", "Creativity level (0-1, default: 0.5)")
  .option("-f, --format <format>", "Output format: png, jpeg, webp", "png")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (imagePath: string, options) => {
    try {
      const left = options.left ? parseInt(options.left) : 0;
      const right = options.right ? parseInt(options.right) : 0;
      const up = options.up ? parseInt(options.up) : 0;
      const down = options.down ? parseInt(options.down) : 0;

      if (options.dryRun) {
        outputResult({
          dryRun: true,
          command: "edit outpaint",
          params: {
            imagePath: resolve(process.cwd(), imagePath),
            left,
            right,
            up,
            down,
            prompt: options.prompt,
            creativity: options.creativity ? parseFloat(options.creativity) : undefined,
          },
        });
        return;
      }

      if (left === 0 && right === 0 && up === 0 && down === 0) {
        console.error(chalk.red("At least one direction (--left, --right, --up, --down) must be specified"));
        process.exit(1);
      }

      const apiKey = await getApiKey("STABILITY_API_KEY", "Stability AI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Stability AI API key required"));
        process.exit(1);
      }

      const spinner = ora("Reading image...").start();

      const absPath = resolve(process.cwd(), imagePath);
      const imageBuffer = await readFile(absPath);

      spinner.text = "Extending image...";

      const stability = new StabilityProvider();
      await stability.initialize({ apiKey });

      const result = await stability.outpaint(imageBuffer, {
        left,
        right,
        up,
        down,
        prompt: options.prompt,
        creativity: options.creativity ? parseFloat(options.creativity) : undefined,
        outputFormat: options.format,
      });

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail(chalk.red(result.error || "Outpainting failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Image extended"));

      if (isJsonMode()) {
        const img = result.images![0];
        if (img.base64) {
          const outputPath = resolve(process.cwd(), options.output);
          await mkdir(dirname(outputPath), { recursive: true });
          const buffer = Buffer.from(img.base64, "base64");
          await writeFile(outputPath, buffer);
        }
        outputResult({
          success: true,
          seed: result.images![0]?.seed,
          outputPath: resolve(process.cwd(), options.output),
        });
        return;
      }

      const img = result.images[0];
      if (img.seed) {
        console.log(chalk.dim(`Seed: ${img.seed}`));
      }
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
        await mkdir(dirname(outputPath), { recursive: true });
        const buffer = Buffer.from(img.base64, "base64");
        await writeFile(outputPath, buffer);
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      console.error(chalk.red("Outpainting failed"));
      console.error(error);
      process.exit(1);
    }
  });

// ── edit replace (Stability AI search and replace) ──────────────────────

editCommand
  .command("replace")
  .description("Search and replace objects in image using Stability AI")
  .argument("<image>", "Input image file path")
  .argument("<search>", "What to search for in the image")
  .argument("<replace>", "What to replace it with")
  .option("-k, --api-key <key>", "Stability AI API key (or set STABILITY_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "replaced.png")
  .option("-n, --negative <prompt>", "Negative prompt (what to avoid)")
  .option("-s, --seed <number>", "Random seed for reproducibility")
  .option("-f, --format <format>", "Output format: png, jpeg, webp", "png")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (imagePath: string, search: string, replaceText: string, options) => {
    try {
      if (options.dryRun) {
        outputResult({
          dryRun: true,
          command: "edit replace",
          params: {
            imagePath: resolve(process.cwd(), imagePath),
            search,
            replace: replaceText,
            negative: options.negative,
            seed: options.seed ? parseInt(options.seed) : undefined,
          },
        });
        return;
      }

      const apiKey = await getApiKey("STABILITY_API_KEY", "Stability AI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Stability AI API key required"));
        process.exit(1);
      }

      const spinner = ora("Reading image...").start();

      const absPath = resolve(process.cwd(), imagePath);
      const imageBuffer = await readFile(absPath);

      spinner.text = "Replacing objects...";

      const stability = new StabilityProvider();
      await stability.initialize({ apiKey });

      const result = await stability.searchAndReplace(imageBuffer, search, replaceText, {
        negativePrompt: options.negative,
        seed: options.seed ? parseInt(options.seed) : undefined,
        outputFormat: options.format,
      });

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail(chalk.red(result.error || "Search and replace failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Objects replaced"));

      if (isJsonMode()) {
        const img = result.images![0];
        if (img.base64) {
          const outputPath = resolve(process.cwd(), options.output);
          await mkdir(dirname(outputPath), { recursive: true });
          const buffer = Buffer.from(img.base64, "base64");
          await writeFile(outputPath, buffer);
        }
        outputResult({
          success: true,
          seed: result.images![0]?.seed,
          outputPath: resolve(process.cwd(), options.output),
        });
        return;
      }

      const img = result.images[0];
      if (img.seed) {
        console.log(chalk.dim(`Seed: ${img.seed}`));
      }
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
        await mkdir(dirname(outputPath), { recursive: true });
        const buffer = Buffer.from(img.base64, "base64");
        await writeFile(outputPath, buffer);
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      console.error(chalk.red("Search and replace failed"));
      console.error(error);
      process.exit(1);
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
  .option("-q, --quality <mode>", "Quality: fast or quality", "quality")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (videoPath: string, options) => {
    try {
      const absPath = resolve(process.cwd(), videoPath);
      const factor = parseInt(options.factor);

      if (![2, 4, 8].includes(factor)) {
        console.error(chalk.red("Factor must be 2, 4, or 8"));
        process.exit(1);
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
      const absPath = resolve(process.cwd(), videoPath);
      const scale = parseInt(options.scale);

      if (scale !== 2 && scale !== 4) {
        console.error(chalk.red("Scale must be 2 or 4"));
        process.exit(1);
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
      console.log(chalk.dim(`     pnpm vibe edit upscale-video https://example.com/video.mp4 -s ${scale}`));
      console.log();
      process.exit(1);
    } catch (error) {
      console.error(chalk.red("Video upscaling failed"));
      console.error(error);
      process.exit(1);
    }
  });
