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
 *   edit translate-srt  - Translate SRT subtitles (Claude or OpenAI)
 *   edit grade          - Color grading (Claude + FFmpeg)
 *   edit text-overlay   - Simple static text overlays (FFmpeg drawtext)
 *   edit motion-overlay - Designed motion graphics overlays (Remotion/Lottie)
 *   edit speed-ramp     - Speed ramping (Whisper + Claude + FFmpeg)
 *   edit reframe        - Reframe aspect ratio (Claude Vision + FFmpeg, or a free center crop)
 *   edit image          - Image editing (Gemini, OpenAI, or Grok)
 *   edit interpolate    - Frame interpolation / slow motion (FFmpeg)
 *   edit upscale        - Video upscaling (FFmpeg)
 *   edit fill-gaps      - Fill timeline gaps with AI video (Kling)
 *
 * @dependencies Whisper, Claude, Gemini, Kling, FFmpeg
 */

import { Command, Option } from "commander";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import chalk from "chalk";
import { findModel, modelAliases } from "@vibeframe/ai-providers";
import { requireApiKey } from "../utils/api-key.js";
import { execSafe, commandExists } from "../utils/exec-safe.js";
import { formatTime } from "./ai-helpers.js";
import { applyTextOverlays, type TextOverlayStyle } from "./ai-edit.js";
import { registerEditCommands } from "./ai-edit-cli.js";
import { registerFillGapsCommand } from "./ai-fill-gaps.js";
import { registerMotionOverlayCommand } from "./edit/motion-overlay.js";
import { failureFromError, spinner as createSpinner, isJsonMode, outputSuccess, exitWithError, usageError, apiError, generalError, providerFailure } from "./output.js";
import { rejectControlChars, validateOutputPath } from "./validate.js";
import { applyTiers } from "./_shared/cost-tier.js";
import { executeImageEdit } from "./ai-image.js";
import { IMAGE_PROVIDER_ENV, IMAGE_PROVIDER_LABELS } from "./_shared/image-jobs.js";
import { executeGrade, GRADE_PRESETS } from "./_shared/edit/grade.js";
import { executeSpeedRamp } from "./_shared/edit/speed-ramp.js";
import { executeReframe, REFRAME_FOCUS_MODES, type ReframeFocus } from "./_shared/edit/reframe.js";
import { executeUpscale } from "./_shared/edit/upscale.js";

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
  $ vibe edit caption video.mp4 -o captioned.mp4 --style bold
  $ vibe edit grade video.mp4 -o graded.mp4 --preset cinematic-warm
  $ vibe edit reframe landscape.mp4 -o vertical.mp4 -a 9:16
  $ vibe edit image photo.png "add sunset background" -o edited.png
  $ vibe edit text-overlay video.mp4 --text "Title" --style center-bold -o out.mp4  # static
  $ vibe edit motion-overlay video.mp4 "animated lower-third title" -o out.mp4
  $ vibe edit noise-reduce noisy.mp4 -o clean.mp4 --strength high
  $ vibe edit fade video.mp4 -o faded.mp4 --fade-in 1 --fade-out 1

API Keys (varies by subcommand):
  No key needed       silence-cut, noise-reduce, fade, interpolate, text-overlay,
                      upscale, grade --preset, reframe --focus center
  OPENAI_API_KEY      caption, jump-cut (Whisper transcription)
  ANTHROPIC_API_KEY   grade --style, speed-ramp, reframe (Claude analysis)
  GOOGLE_API_KEY      image editing (Gemini, default)

Run 'vibe schema edit.<command>' for structured parameter info.
`
  );

// ── edit silence-cut, jump-cut, caption, noise-reduce, fade, translate-srt ──

registerEditCommands(editCommand);

// ── edit fill-gaps ──────────────────────────────────────────────────────

registerFillGapsCommand(editCommand);

// ── edit motion-overlay ─────────────────────────────────────────────────

registerMotionOverlayCommand(editCommand);

// ── edit grade ──────────────────────────────────────────────────────────

editCommand
  .command("grade")
  .description("Apply AI-generated color grading (Claude + FFmpeg)")
  .argument("<video>", "Video file path")
  .option("--style <prompt>", "Style description (e.g., 'cinematic warm')")
  .option("--preset <name>", `Built-in preset: ${GRADE_PRESETS.join(", ")}`)
  .option("-o, --output <path>", "Output video file path")
  .option("--analyze-only", "Show filter without applying")
  .option("-k, --api-key <key>", "Anthropic API key (or set ANTHROPIC_API_KEY env)")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (videoPath: string, options) => {
    const startedAt = Date.now();
    try {
      if (options.style) rejectControlChars(options.style);
      if (options.output) validateOutputPath(options.output);

      if (!options.style && !options.preset) {
        exitWithError(usageError(
          "Either --style or --preset is required",
          'Examples: vibe edit grade video.mp4 --style "warm sunset" or --preset cinematic-warm',
        ));
      }

      if (options.dryRun) {
        outputSuccess({
          command: "edit grade",
          startedAt,
          dryRun: true,
          data: {
            params: {
              videoPath: resolve(process.cwd(), videoPath),
              style: options.style || options.preset,
              analyzeOnly: options.analyzeOnly || false,
            },
          },
        });
        return;
      }

      // A custom style needs Claude; presets are built in. Resolve the key
      // up front (interactively in a terminal) so a missing key fails fast
      // with API_KEY_MISSING.
      const apiKey = options.preset
        ? undefined
        : await requireApiKey("ANTHROPIC_API_KEY", "Anthropic", options.apiKey);

      const spinner = createSpinner("Analyzing color grade...").start();
      const result = await executeGrade({
        videoPath,
        style: options.style,
        preset: options.preset,
        output: options.output,
        analyzeOnly: options.analyzeOnly,
        apiKey,
        onProgress: (message) => { spinner.text = message; },
      });
      if (!result.success) exitWithError(result.failure);
      spinner.succeed(chalk.green(result.outputPath ? "Color grade applied" : "Color grade analyzed"));

      if (isJsonMode()) {
        outputSuccess({
          command: "edit grade",
          startedAt,
          data: {
            style: result.style,
            description: result.description,
            ffmpegFilter: result.ffmpegFilter,
            ...(result.outputPath ? { outputPath: result.outputPath } : {}),
          },
        });
        return;
      }

      console.log();
      console.log(chalk.bold.cyan("Color Grade"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Style: ${result.style}`);
      console.log(`Description: ${result.description}`);
      console.log();
      console.log(chalk.dim("FFmpeg filter:"));
      console.log(chalk.cyan(result.ffmpegFilter));
      console.log();
      if (result.outputPath) {
        console.log(chalk.green(`Output: ${result.outputPath}`));
      } else {
        console.log(chalk.dim("Use without --analyze-only to apply the grade."));
      }
      console.log();
    } catch (error) {
      exitWithError(failureFromError(error, "Color grading failed"));
    }
  });

// ── edit text-overlay ───────────────────────────────────────────────────

editCommand
  .command("text-overlay")
  .description("Apply simple static text burn-in to video (FFmpeg drawtext)")
  .argument("<video>", "Video file path")
  .option("--text <texts...>", "Text lines to overlay (repeat for multiple)")
  .option("--style <style>", "Overlay style: lower-third, center-bold, subtitle, minimal", "lower-third")
  .option("--font-size <size>", "Font size in pixels (auto-calculated if omitted)")
  .option("--font-color <color>", "Font color (default: white)", "white")
  .option("--fade <seconds>", "Fade in/out duration in seconds", "0.3")
  .option("--start <seconds>", "Start time in seconds", "0")
  .option("--end <seconds>", "End time in seconds (default: video duration)")
  .option("-o, --output <path>", "Output video file path")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (videoPath: string, options) => {
    const startedAt = Date.now();
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
        outputSuccess({
          command: "edit text-overlay",
          startedAt,
          dryRun: true,
          data: {
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
          },
        });
        return;
      }

      const absPath = resolve(process.cwd(), videoPath);
      const outputPath = options.output
        ? resolve(process.cwd(), options.output)
        : absPath.replace(/(\.[^.]+)$/, "-overlay$1");

      const spinner = createSpinner("Applying text overlays...").start();

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
        outputSuccess({
          command: "edit text-overlay",
          startedAt,
          data: {
            style: options.style,
            texts: options.text,
            outputPath: result.outputPath,
          },
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
  .option("--style <style>", "Style: dramatic, smooth, action", "dramatic")
  .option("--min-speed <factor>", "Minimum speed factor", "0.25")
  .option("--max-speed <factor>", "Maximum speed factor", "4.0")
  .option("--analyze-only", "Show keyframes without applying")
  .option("-l, --language <lang>", "Language code for transcription")
  .option("-k, --api-key <key>", "Anthropic API key (or set ANTHROPIC_API_KEY env)")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (videoPath: string, options) => {
    const startedAt = Date.now();
    try {
      if (options.output) validateOutputPath(options.output);

      if (options.dryRun) {
        outputSuccess({
          command: "edit speed-ramp",
          startedAt,
          dryRun: true,
          data: {
            params: {
              videoPath: resolve(process.cwd(), videoPath),
              style: options.style,
              minSpeed: parseFloat(options.minSpeed),
              maxSpeed: parseFloat(options.maxSpeed),
              analyzeOnly: options.analyzeOnly || false,
            },
          },
        });
        return;
      }

      // Resolve both keys up front (interactively in a terminal) so a missing
      // key fails fast with API_KEY_MISSING.
      const openaiApiKey = await requireApiKey("OPENAI_API_KEY", "OpenAI");
      const apiKey = await requireApiKey("ANTHROPIC_API_KEY", "Anthropic", options.apiKey);

      const spinner = createSpinner("Checking audio...").start();
      const result = await executeSpeedRamp({
        videoPath,
        output: options.output,
        style: options.style,
        minSpeed: parseFloat(options.minSpeed),
        maxSpeed: parseFloat(options.maxSpeed),
        analyzeOnly: options.analyzeOnly,
        language: options.language,
        apiKey,
        openaiApiKey,
        onProgress: (message) => { spinner.text = message; },
      });
      if (!result.success) exitWithError(result.failure);
      spinner.succeed(chalk.green(result.outputPath ? "Speed ramp applied" : `Found ${result.keyframes.length} speed keyframes`));

      if (isJsonMode()) {
        outputSuccess({
          command: "edit speed-ramp",
          startedAt,
          data: {
            keyframes: result.keyframes,
            avgSpeed: result.avgSpeed,
            ...(result.outputPath ? { outputPath: result.outputPath } : {}),
          },
        });
        return;
      }

      console.log();
      console.log(chalk.bold.cyan("Speed Ramp Keyframes"));
      console.log(chalk.dim("─".repeat(60)));
      for (const kf of result.keyframes) {
        const speedColor = kf.speed < 1 ? chalk.blue : kf.speed > 1 ? chalk.yellow : chalk.white;
        console.log(`  ${formatTime(kf.time)} → ${speedColor(`${kf.speed.toFixed(2)}x`)} - ${kf.reason}`);
      }
      console.log();
      if (result.outputPath) {
        console.log(chalk.green(`Output: ${result.outputPath}`));
        console.log(chalk.dim(`Average speed: ${result.avgSpeed.toFixed(2)}x`));
      } else {
        console.log(chalk.dim("Use without --analyze-only to apply speed ramps."));
      }
      console.log();
    } catch (error) {
      exitWithError(failureFromError(error, "Speed ramping failed", { fallback: "general" }));
    }
  });

// ── edit reframe ────────────────────────────────────────────────────────

editCommand
  .command("reframe")
  .description("Reframe video to a different aspect ratio (Claude Vision + FFmpeg; --focus center is free)")
  .argument("<video>", "Video file path")
  .option("-a, --aspect <ratio>", "Target aspect ratio: 9:16, 1:1, 4:5", "9:16")
  .option("--focus <mode>", "Focus mode: auto, face, center, action (center is a free FFmpeg crop; the others use Claude Vision)", "auto")
  .option("-o, --output <path>", "Output video file path")
  .option("--analyze-only", "Show crop regions without applying")
  .option("--keyframes <path>", "Export keyframes to JSON file")
  .option("-k, --api-key <key>", "Anthropic API key (or set ANTHROPIC_API_KEY env)")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (videoPath: string, options) => {
    const startedAt = Date.now();
    try {
      if (options.output) validateOutputPath(options.output);
      if (options.keyframes) validateOutputPath(options.keyframes);
      if (!(REFRAME_FOCUS_MODES as readonly string[]).includes(options.focus)) {
        exitWithError(usageError(`Invalid focus mode: ${options.focus}`, `Available modes: ${REFRAME_FOCUS_MODES.join(", ")}`));
      }
      const focus = options.focus as ReframeFocus;

      if (options.dryRun) {
        outputSuccess({
          command: "edit reframe",
          startedAt,
          dryRun: true,
          // The center crop is FFmpeg only; the vision modes cost up to the estimate.
          ...(focus === "center" ? { costUsd: 0 } : {}),
          data: {
            params: {
              videoPath: resolve(process.cwd(), videoPath),
              aspect: options.aspect,
              focus,
              analyzeOnly: options.analyzeOnly || false,
            },
          },
        });
        return;
      }

      // The vision modes need Claude. Resolve the key up front (interactively
      // in a terminal) so a missing key fails fast with API_KEY_MISSING.
      const apiKey = focus === "center"
        ? undefined
        : await requireApiKey("ANTHROPIC_API_KEY", "Anthropic", options.apiKey);

      const spinner = createSpinner("Analyzing video...").start();
      const result = await executeReframe({
        videoPath,
        aspect: options.aspect,
        focus,
        output: options.output,
        analyzeOnly: options.analyzeOnly,
        apiKey,
        onProgress: (message) => { spinner.text = message; },
      });
      if (!result.success) exitWithError(result.failure);
      spinner.succeed(chalk.green(result.outputPath ? "Reframe applied" : `Analyzed ${result.keyframeCount} keyframe(s)`));

      const keyframesPath = options.keyframes ? resolve(process.cwd(), options.keyframes) : undefined;
      if (keyframesPath) await writeFile(keyframesPath, JSON.stringify(result.cropKeyframes, null, 2));

      if (isJsonMode()) {
        outputSuccess({
          command: "edit reframe",
          startedAt,
          data: {
            sourceWidth: result.sourceWidth,
            sourceHeight: result.sourceHeight,
            aspect: result.targetAspect,
            focus: result.focus,
            crop: result.crop,
            cropKeyframes: result.cropKeyframes,
            ...(keyframesPath ? { keyframesPath } : {}),
            ...(result.outputPath ? { outputPath: result.outputPath } : {}),
          },
        });
        return;
      }

      console.log();
      console.log(chalk.bold.cyan("Reframe"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Source: ${result.sourceWidth}x${result.sourceHeight}`);
      console.log(`Target: ${result.targetAspect}`);
      console.log(`Focus: ${result.focus}`);
      if (result.focus !== "center") {
        const avgConf = result.cropKeyframes.reduce((sum, kf) => sum + kf.confidence, 0) / result.cropKeyframes.length;
        console.log(`Average confidence: ${(avgConf * 100).toFixed(0)}%`);
        console.log();
        console.log(chalk.dim("Sample keyframes:"));
        for (const kf of result.cropKeyframes.slice(0, 5)) {
          console.log(`  ${formatTime(kf.time)} → crop=${kf.cropX},${kf.cropY} (${kf.subjectDescription})`);
        }
        if (result.cropKeyframes.length > 5) {
          console.log(chalk.dim(`  ... and ${result.cropKeyframes.length - 5} more`));
        }
      }
      console.log(chalk.dim(`Crop: ${result.crop.width}x${result.crop.height} at (${result.crop.x}, ${result.crop.y})`));
      console.log();
      if (keyframesPath) console.log(chalk.green(`Keyframes saved to: ${keyframesPath}`));
      if (result.outputPath) {
        console.log(chalk.green(`Output: ${result.outputPath}`));
      } else {
        console.log(chalk.dim("Use without --analyze-only to apply reframe."));
      }
      console.log();
    } catch (error) {
      exitWithError(failureFromError(error, "Reframe failed", { fallback: "general" }));
    }
  });

// ── edit image (multi-image editing on any image provider) ──────────────

editCommand
  .command("image")
  .description("Edit image(s) using AI (Gemini, OpenAI, or Grok)")
  .argument("<images...>", "Input image file(s) followed by edit prompt")
  .option("-p, --provider <provider>", "Provider: gemini (default), openai, grok", "gemini")
  .option("-k, --api-key <key>", "API key (or set env variable)")
  .option("-o, --output <path>", "Output file path", "edited.png")
  .option("-m, --model <model>", "Model: flash (default), lite, pro (Gemini); 2.5, flare, 2 (OpenAI); pro (Grok)")
  .option("-r, --ratio <ratio>", "Output aspect ratio")
  .option("--size <resolution>", "Resolution: 1K, 2K, 4K (Gemini Pro only)")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (args: string[], options) => {
    const startedAt = Date.now();
    // Last argument is the prompt, the rest are image paths
    if (args.length < 2) {
      exitWithError(usageError("Need at least one image and a prompt"));
    }
    const prompt = args[args.length - 1];
    rejectControlChars(prompt);
    if (options.output) validateOutputPath(options.output);
    const imagePaths = args.slice(0, -1);
    const provider = String(options.provider || "gemini").toLowerCase();
    if (!IMAGE_PROVIDER_ENV[provider]) {
      exitWithError(usageError(`Invalid provider: ${provider}`, `Available providers: ${Object.keys(IMAGE_PROVIDER_ENV).join(", ")}`));
    }
    const modelSpec = findModel(provider, "image", options.model);
    if (!modelSpec) {
      exitWithError(usageError(`Unknown ${provider} image model "${options.model}". Valid: ${modelAliases(provider, "image").join(", ")}.`));
    }

    if (options.dryRun) {
      outputSuccess({
        command: "edit image",
        startedAt,
        dryRun: true,
        data: {
          params: {
            imagePaths: imagePaths.map((p: string) => resolve(process.cwd(), p)),
            prompt,
            provider,
            model: modelSpec.id,
            ratio: options.ratio,
            size: options.size,
          },
        },
      });
      return;
    }

    const label = IMAGE_PROVIDER_LABELS[provider];
    const apiKey = await requireApiKey(IMAGE_PROVIDER_ENV[provider], label, options.apiKey);
    const spinner = isJsonMode() ? null : createSpinner(`Editing ${imagePaths.length} image(s) with ${label} ${modelSpec.label}...`).start();
    const result = await executeImageEdit({
      imagePaths,
      prompt,
      provider,
      model: options.model,
      ratio: options.ratio,
      resolution: options.size,
      output: options.output,
      apiKey,
    });
    if (!result.success) {
      spinner?.fail(result.error ?? "Image editing failed");
      exitWithError(providerFailure(result.error ?? "Image editing failed", result.errorKind));
    }

    if (isJsonMode()) {
      outputSuccess({
        command: "edit image",
        startedAt,
        data: { provider, model: result.model, outputPath: result.outputPath },
      });
      return;
    }
    spinner?.succeed(chalk.green("Image edited"));
    console.log(chalk.green(`Saved to: ${result.outputPath}`));
  });

// ── edit interpolate (frame interpolation / slow motion) ────────────────

editCommand
  .command("interpolate")
  .description("Create slow motion with frame interpolation (FFmpeg)")
  .argument("<video>", "Video file path")
  .option("-o, --output <path>", "Output file path")
  .option("--factor <number>", "Slow motion factor: 2, 4, or 8", "2")
  .option("--fps <number>", "Target output FPS")
  // Renamed from `--quality` in v0.78. `--quality` clashed semantically
  // with `generate image --quality standard|hd` and `render --quality
  // draft|standard|high` — those describe output quality presets, this
  // describes a speed/quality tradeoff. `--mode` is unambiguous.
  .option("--mode <mode>", "Speed/quality tradeoff: fast or quality", "quality")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (videoPath: string, options) => {
    const startedAt = Date.now();
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
        outputSuccess({
          command: "edit interpolate",
          startedAt,
          dryRun: true,
          data: {
            params: {
              videoPath: absPath,
              factor,
              fps: options.fps ? parseInt(options.fps) : undefined,
              mode: options.mode,
            },
          },
        });
        return;
      }

      const outputPath = options.output
        ? resolve(process.cwd(), options.output)
        : absPath.replace(/(\.[^.]+)$/, `-slow${factor}x$1`);

      const spinner = createSpinner(`Creating ${factor}x slow motion...`).start();

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
        const mi = options.mode === "fast" ? "mi_mode=mci" : "mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1";

        spinner.text = `Interpolating frames (${originalFps.toFixed(1)} → ${targetFps}fps)...`;

        // First interpolate frames, then slow down
        await execSafe("ffmpeg", ["-i", absPath, "-filter:v", `minterpolate='${mi}:fps=${targetFps}',setpts=${factor}*PTS`, "-an", outputPath, "-y"], { timeout: 600000 });

        spinner.succeed(chalk.green(`Created ${factor}x slow motion`));

        if (isJsonMode()) {
          outputSuccess({
            command: "edit interpolate",
            startedAt,
            data: {
              originalFps,
              targetFps,
              factor,
              outputPath,
            },
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

// ── edit upscale (video upscaling) ────────────────────────────────

editCommand
  .command("upscale")
  .description("Upscale video resolution (FFmpeg Lanczos, free)")
  .argument("<video>", "Video file path")
  .option("-o, --output <path>", "Output file path")
  .option("--scale <factor>", "Scale factor: 2 or 4", "2")
  // FFmpeg is the only engine now; kept so existing scripts keep working.
  .addOption(new Option("--ffmpeg", "(deprecated) no-op: FFmpeg is the only upscale engine").hideHelp())
  .option("--dry-run", "Preview parameters without executing")
  .action(async (videoPath: string, options) => {
    const startedAt = Date.now();
    try {
      if (options.output) validateOutputPath(options.output);

      const scale = Number(options.scale);
      if (scale !== 2 && scale !== 4) {
        exitWithError(usageError("Scale must be 2 or 4"));
      }

      if (options.dryRun) {
        outputSuccess({
          command: "edit upscale",
          startedAt,
          dryRun: true,
          data: {
            params: {
              videoPath: resolve(process.cwd(), videoPath),
              scale,
            },
          },
        });
        return;
      }

      const spinner = createSpinner(`Upscaling video (${scale}x)...`).start();
      const result = await executeUpscale({
        videoPath,
        output: options.output,
        scale,
        onProgress: (message) => { spinner.text = message; },
      });
      if (!result.success) exitWithError(result.failure);
      spinner.succeed(chalk.green(`Upscaled to ${result.targetRes}`));

      if (isJsonMode()) {
        outputSuccess({
          command: "edit upscale",
          startedAt,
          data: {
            dimensions: result.targetRes,
            originalDimensions: result.originalRes,
            outputPath: result.outputPath,
          },
        });
        return;
      }

      console.log(chalk.green(`Output: ${result.outputPath}`));
    } catch (error) {
      exitWithError(failureFromError(error, "Video upscaling failed", { fallback: "general" }));
    }
  });

// ── Cost-tier annotations ──────────────────────────────────────────────────
// Applied at module-bottom so tier metadata stays next to the catalog.
// These tiers feed schema/help output.
applyTiers(editCommand, {
  // free — FFmpeg only
  "noise-reduce": "free",
  "fade": "free",
  "text-overlay": "free",
  "interpolate": "free",
  "upscale": "free",
  // low — Whisper / single LLM call
  "silence-cut": "low",
  "caption": "low",
  "translate-srt": "low",
  "jump-cut": "low",
  "grade": "low",
  "speed-ramp": "low",
  "motion-overlay": "low",
  // high — vision LLM or image gen
  "reframe": "high",
  "image": "high",
  // very-high — video gen per gap
  "fill-gaps": "very-high",
});

// ── Exported execute functions ─────────────────────────────────────────────

// The grade, speed-ramp, reframe, and upscale executors live in
// `_shared/edit/` next to the other edit executors; the CLI actions above
// call them, and they are re-exported here for the MCP manifest and the
// YAML pipeline.
export { executeGrade, GRADE_PRESETS } from "./_shared/edit/grade.js";
export type { GradeOptions, GradeResult, GradePreset } from "./_shared/edit/grade.js";
export { executeSpeedRamp, SPEED_RAMP_STYLES } from "./_shared/edit/speed-ramp.js";
export type { SpeedRampOptions, SpeedRampResult, SpeedRampStyle, SpeedKeyframe } from "./_shared/edit/speed-ramp.js";
export { executeReframe, REFRAME_FOCUS_MODES } from "./_shared/edit/reframe.js";
export type { ReframeOptions, ReframeResult, ReframeFocus, ReframeCrop, ReframeCropKeyframe } from "./_shared/edit/reframe.js";
export { executeUpscale } from "./_shared/edit/upscale.js";
export type { UpscaleOptions, UpscaleResult } from "./_shared/edit/upscale.js";

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
