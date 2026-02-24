/**
 * ai-edit-cli.ts — CLI command registrations for video/audio editing commands.
 *
 * Commands: silence-cut, caption, noise-reduce, fade, translate-srt, jump-cut
 *
 * This file contains only the Commander.js command definitions (UI layer).
 * All execute functions and types live in ai-edit.ts.
 *
 * Extracted from ai-edit.ts as part of modularisation.
 * ai.ts calls registerEditCommands(aiCommand).
 */

import { type Command } from 'commander';
import { resolve, extname, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';
import { getApiKey } from '../utils/api-key.js';
import {
  executeSilenceCut,
  executeCaption,
  executeNoiseReduce,
  executeFade,
  executeTranslateSrt,
  executeJumpCut,
  type CaptionStyle,
} from './ai-edit.js';

// ── Command registrations ───────────────────────────────────────────────────

export function registerEditCommands(aiCommand: Command): void {
// ============================================================================

aiCommand
  .command("silence-cut")
  .description("Remove silent segments from video (FFmpeg default, or Gemini for smart detection)")
  .argument("<video>", "Video file path")
  .option("-o, --output <path>", "Output file path (default: <name>-cut.<ext>)")
  .option("-n, --noise <dB>", "Silence threshold in dB (default: -30)", "-30")
  .option("-d, --min-duration <seconds>", "Minimum silence duration to cut (default: 0.5)", "0.5")
  .option("-p, --padding <seconds>", "Padding around non-silent segments (default: 0.1)", "0.1")
  .option("--analyze-only", "Only detect silence, don't cut")
  .option("--use-gemini", "Use Gemini Video Understanding for context-aware silence detection")
  .option("-m, --model <model>", "Gemini model (default: flash)")
  .option("--low-res", "Low resolution mode for longer videos (Gemini only)")
  .option("-k, --api-key <key>", "Google API key override (or set GOOGLE_API_KEY env)")
  .action(async (videoPath: string, options) => {
    try {
      const absVideoPath = resolve(process.cwd(), videoPath);
      if (!existsSync(absVideoPath)) {
        console.error(chalk.red(`Video not found: ${absVideoPath}`));
        process.exit(1);
      }

      // Check FFmpeg
      try {
        execSync("ffmpeg -version", { stdio: "ignore" });
      } catch {
        console.error(chalk.red("FFmpeg not found. Please install FFmpeg."));
        process.exit(1);
      }

      const ext = extname(videoPath);
      const name = basename(videoPath, ext);
      const outputPath = options.output || `${name}-cut${ext}`;

      const useGemini = options.useGemini || false;
      const spinnerText = useGemini
        ? "Analyzing video with Gemini (visual + audio)..."
        : "Detecting silence...";
      const spinner = ora(spinnerText).start();

      const result = await executeSilenceCut({
        videoPath: absVideoPath,
        outputPath: resolve(process.cwd(), outputPath),
        noiseThreshold: parseFloat(options.noise),
        minDuration: parseFloat(options.minDuration),
        padding: parseFloat(options.padding),
        analyzeOnly: options.analyzeOnly || false,
        useGemini,
        model: options.model,
        lowRes: options.lowRes,
        apiKey: options.apiKey,
      });

      if (!result.success) {
        spinner.fail(chalk.red(result.error || "Silence cut failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Silence detection complete"));

      console.log();
      console.log(chalk.bold.cyan("Silence Analysis"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Detection method: ${chalk.bold(result.method === "gemini" ? "Gemini Video Understanding" : "FFmpeg silencedetect")}`);
      console.log(`Total duration: ${chalk.bold(result.totalDuration!.toFixed(1))}s`);
      console.log(`Silent periods: ${chalk.bold(String(result.silentPeriods!.length))}`);
      console.log(`Silent duration: ${chalk.bold(result.silentDuration!.toFixed(1))}s`);
      console.log(`Non-silent duration: ${chalk.bold((result.totalDuration! - result.silentDuration!).toFixed(1))}s`);

      if (result.silentPeriods!.length > 0) {
        console.log();
        console.log(chalk.dim("Silent periods:"));
        for (const period of result.silentPeriods!) {
          console.log(chalk.dim(`  ${period.start.toFixed(2)}s - ${period.end.toFixed(2)}s (${period.duration.toFixed(2)}s)`));
        }
      }

      if (!options.analyzeOnly && result.outputPath) {
        console.log();
        console.log(chalk.green(`Output: ${result.outputPath}`));
        console.log(chalk.dim(`Removed ${result.silentDuration!.toFixed(1)}s of silence`));
      }
      console.log();
    } catch (error) {
      console.error(chalk.red("Silence cut failed"));
      console.error(error);
      process.exit(1);
    }
  });

// ============================================================================
// Caption Command
// ============================================================================

aiCommand
  .command("caption")
  .description("Transcribe and burn styled captions onto video (Whisper + FFmpeg)")
  .argument("<video>", "Video file path")
  .option("-o, --output <path>", "Output file path (default: <name>-captioned.<ext>)")
  .option("-s, --style <style>", "Caption style: minimal, bold, outline, karaoke (default: bold)", "bold")
  .option("--font-size <pixels>", "Override auto-calculated font size")
  .option("--color <color>", "Font color (default: white)", "white")
  .option("-l, --language <lang>", "Language code for transcription (e.g., en, ko)")
  .option("--position <pos>", "Caption position: top, center, bottom (default: bottom)", "bottom")
  .option("-k, --api-key <key>", "OpenAI API key (or set OPENAI_API_KEY env)")
  .action(async (videoPath: string, options) => {
    try {
      const absVideoPath = resolve(process.cwd(), videoPath);
      if (!existsSync(absVideoPath)) {
        console.error(chalk.red(`Video not found: ${absVideoPath}`));
        process.exit(1);
      }

      // Check FFmpeg
      try {
        execSync("ffmpeg -version", { stdio: "ignore" });
      } catch {
        console.error(chalk.red("FFmpeg not found. Please install FFmpeg."));
        process.exit(1);
      }

      const apiKey = await getApiKey("OPENAI_API_KEY", "OpenAI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("OpenAI API key required for Whisper transcription."));
        console.error(chalk.dim("Use --api-key or set OPENAI_API_KEY"));
        process.exit(1);
      }

      const ext = extname(videoPath);
      const name = basename(videoPath, ext);
      const outputPath = options.output || `${name}-captioned${ext}`;

      const spinner = ora("Starting caption process...").start();

      const result = await executeCaption({
        videoPath: absVideoPath,
        outputPath: resolve(process.cwd(), outputPath),
        style: options.style as CaptionStyle,
        fontSize: options.fontSize ? parseInt(options.fontSize) : undefined,
        fontColor: options.color,
        language: options.language,
        position: options.position as "top" | "center" | "bottom",
        apiKey,
      });

      if (!result.success) {
        spinner.fail(chalk.red(result.error || "Caption failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Captions applied"));

      console.log();
      console.log(chalk.bold.cyan("Caption Result"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Segments transcribed: ${chalk.bold(String(result.segmentCount))}`);
      console.log(`Style: ${chalk.bold(options.style || "bold")}`);
      console.log(`Output: ${chalk.green(result.outputPath!)}`);
      if (result.srtPath) {
        console.log(`SRT file: ${chalk.dim(result.srtPath)}`);
      }
      console.log();
    } catch (error) {
      console.error(chalk.red("Caption failed"));
      console.error(error);
      process.exit(1);
    }
  });

// ============================================================================
// Noise Reduce Command
// ============================================================================

aiCommand
  .command("noise-reduce")
  .description("Remove background noise from audio/video using FFmpeg (no API key needed)")
  .argument("<input>", "Audio or video file path")
  .option("-o, --output <path>", "Output file path (default: <name>-denoised.<ext>)")
  .option("-s, --strength <level>", "Noise reduction strength: low, medium, high (default: medium)", "medium")
  .option("-n, --noise-floor <dB>", "Custom noise floor in dB (overrides strength preset)")
  .action(async (inputPath: string, options) => {
    try {
      const absInputPath = resolve(process.cwd(), inputPath);
      if (!existsSync(absInputPath)) {
        console.error(chalk.red(`File not found: ${absInputPath}`));
        process.exit(1);
      }

      try {
        execSync("ffmpeg -version", { stdio: "ignore" });
      } catch {
        console.error(chalk.red("FFmpeg not found. Please install FFmpeg."));
        process.exit(1);
      }

      const ext = extname(inputPath);
      const name = basename(inputPath, ext);
      const outputPath = options.output || `${name}-denoised${ext}`;

      const spinner = ora("Applying noise reduction...").start();

      const result = await executeNoiseReduce({
        inputPath: absInputPath,
        outputPath: resolve(process.cwd(), outputPath),
        strength: options.strength as "low" | "medium" | "high",
        noiseFloor: options.noiseFloor ? parseFloat(options.noiseFloor) : undefined,
      });

      if (!result.success) {
        spinner.fail(chalk.red(result.error || "Noise reduction failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Noise reduction complete"));

      console.log();
      console.log(chalk.bold.cyan("Noise Reduction Result"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Input duration: ${chalk.bold(result.inputDuration!.toFixed(1))}s`);
      console.log(`Strength: ${chalk.bold(options.strength || "medium")}`);
      console.log(`Output: ${chalk.green(result.outputPath!)}`);
      console.log();
    } catch (error) {
      console.error(chalk.red("Noise reduction failed"));
      console.error(error);
      process.exit(1);
    }
  });

// ============================================================================
// Fade Command
// ============================================================================

aiCommand
  .command("fade")
  .description("Apply fade in/out effects to video (FFmpeg only, no API key needed)")
  .argument("<video>", "Video file path")
  .option("-o, --output <path>", "Output file path (default: <name>-faded.<ext>)")
  .option("--fade-in <seconds>", "Fade-in duration in seconds (default: 1)", "1")
  .option("--fade-out <seconds>", "Fade-out duration in seconds (default: 1)", "1")
  .option("--audio-only", "Apply fade to audio only (video stream copied)")
  .option("--video-only", "Apply fade to video only (audio stream copied)")
  .action(async (videoPath: string, options) => {
    try {
      const absVideoPath = resolve(process.cwd(), videoPath);
      if (!existsSync(absVideoPath)) {
        console.error(chalk.red(`Video not found: ${absVideoPath}`));
        process.exit(1);
      }

      try {
        execSync("ffmpeg -version", { stdio: "ignore" });
      } catch {
        console.error(chalk.red("FFmpeg not found. Please install FFmpeg."));
        process.exit(1);
      }

      const ext = extname(videoPath);
      const name = basename(videoPath, ext);
      const outputPath = options.output || `${name}-faded${ext}`;

      const spinner = ora("Applying fade effects...").start();

      const result = await executeFade({
        videoPath: absVideoPath,
        outputPath: resolve(process.cwd(), outputPath),
        fadeIn: parseFloat(options.fadeIn),
        fadeOut: parseFloat(options.fadeOut),
        audioOnly: options.audioOnly || false,
        videoOnly: options.videoOnly || false,
      });

      if (!result.success) {
        spinner.fail(chalk.red(result.error || "Fade failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Fade effects applied"));

      console.log();
      console.log(chalk.bold.cyan("Fade Result"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Total duration: ${chalk.bold(result.totalDuration!.toFixed(1))}s`);
      if (result.fadeInApplied) console.log(`Fade-in: ${chalk.bold(options.fadeIn)}s`);
      if (result.fadeOutApplied) console.log(`Fade-out: ${chalk.bold(options.fadeOut)}s`);
      console.log(`Output: ${chalk.green(result.outputPath!)}`);
      console.log();
    } catch (error) {
      console.error(chalk.red("Fade failed"));
      console.error(error);
      process.exit(1);
    }
  });

// ============================================================================
// Translate SRT Command
// ============================================================================

aiCommand
  .command("translate-srt")
  .description("Translate SRT subtitle file to another language (Claude/OpenAI)")
  .argument("<srt>", "SRT file path")
  .option("-t, --target <language>", "Target language (e.g., ko, es, fr, ja, zh)")
  .option("-o, --output <path>", "Output file path (default: <name>-<target>.srt)")
  .option("-p, --provider <provider>", "Translation provider: claude, openai (default: claude)", "claude")
  .option("--source <language>", "Source language (auto-detected if omitted)")
  .option("-k, --api-key <key>", "API key (or set ANTHROPIC_API_KEY / OPENAI_API_KEY env)")
  .action(async (srtPath: string, options) => {
    try {
      if (!options.target) {
        console.error(chalk.red("Target language required. Use -t or --target"));
        process.exit(1);
      }

      const absSrtPath = resolve(process.cwd(), srtPath);
      if (!existsSync(absSrtPath)) {
        console.error(chalk.red(`SRT file not found: ${absSrtPath}`));
        process.exit(1);
      }

      const provider = options.provider || "claude";
      const envKey = provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
      const providerName = provider === "openai" ? "OpenAI" : "Anthropic";

      const apiKey = await getApiKey(envKey, providerName, options.apiKey);
      if (!apiKey) {
        console.error(chalk.red(`${providerName} API key required for translation.`));
        console.error(chalk.dim(`Use --api-key or set ${envKey}`));
        process.exit(1);
      }

      const ext = extname(srtPath);
      const name = basename(srtPath, ext);
      const outputPath = options.output || `${name}-${options.target}${ext}`;

      const spinner = ora(`Translating to ${options.target}...`).start();

      const result = await executeTranslateSrt({
        srtPath: absSrtPath,
        outputPath: resolve(process.cwd(), outputPath),
        targetLanguage: options.target,
        provider: provider as "claude" | "openai",
        sourceLanguage: options.source,
        apiKey,
      });

      if (!result.success) {
        spinner.fail(chalk.red(result.error || "Translation failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Translation complete"));

      console.log();
      console.log(chalk.bold.cyan("Translation Result"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Segments translated: ${chalk.bold(String(result.segmentCount))}`);
      if (result.sourceLanguage) console.log(`Source language: ${chalk.bold(result.sourceLanguage)}`);
      console.log(`Target language: ${chalk.bold(result.targetLanguage!)}`);
      console.log(`Output: ${chalk.green(result.outputPath!)}`);
      console.log();
    } catch (error) {
      console.error(chalk.red("Translation failed"));
      console.error(error);
      process.exit(1);
    }
  });

// ============================================================================
// Jump Cut Command
// ============================================================================

aiCommand
  .command("jump-cut")
  .description("Remove filler words (um, uh, like, etc.) from video using Whisper word-level timestamps")
  .argument("<video>", "Video file path")
  .option("-o, --output <path>", "Output file path (default: <name>-jumpcut.<ext>)")
  .option("--fillers <words>", "Comma-separated filler words to detect")
  .option("-p, --padding <seconds>", "Padding around cuts in seconds (default: 0.05)", "0.05")
  .option("-l, --language <lang>", "Language code for transcription (e.g., en, ko)")
  .option("--analyze-only", "Only detect fillers, don't cut")
  .option("-k, --api-key <key>", "OpenAI API key (or set OPENAI_API_KEY env)")
  .action(async (videoPath: string, options) => {
    try {
      const absVideoPath = resolve(process.cwd(), videoPath);
      if (!existsSync(absVideoPath)) {
        console.error(chalk.red(`Video not found: ${absVideoPath}`));
        process.exit(1);
      }

      // Check FFmpeg
      try {
        execSync("ffmpeg -version", { stdio: "ignore" });
      } catch {
        console.error(chalk.red("FFmpeg not found. Please install FFmpeg."));
        process.exit(1);
      }

      const apiKey = await getApiKey("OPENAI_API_KEY", "OpenAI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("OpenAI API key required for Whisper transcription."));
        console.error(chalk.dim("Use --api-key or set OPENAI_API_KEY"));
        process.exit(1);
      }

      const ext = extname(videoPath);
      const name = basename(videoPath, ext);
      const outputPath = options.output || `${name}-jumpcut${ext}`;

      const fillers = options.fillers
        ? options.fillers.split(",").map((f: string) => f.trim())
        : undefined;

      const spinner = ora("Transcribing with word-level timestamps...").start();

      const result = await executeJumpCut({
        videoPath: absVideoPath,
        outputPath: resolve(process.cwd(), outputPath),
        fillers,
        padding: parseFloat(options.padding),
        language: options.language,
        analyzeOnly: options.analyzeOnly || false,
        apiKey,
      });

      if (!result.success) {
        spinner.fail(chalk.red(result.error || "Jump cut failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Filler detection complete"));

      console.log();
      console.log(chalk.bold.cyan("Filler Word Analysis"));
      console.log(chalk.dim("-".repeat(60)));
      console.log(`Total duration: ${chalk.bold(result.totalDuration!.toFixed(1))}s`);
      console.log(`Filler words found: ${chalk.bold(String(result.fillerCount))}`);
      console.log(`Filler duration: ${chalk.bold(result.fillerDuration!.toFixed(1))}s`);
      console.log(`Clean duration: ${chalk.bold((result.totalDuration! - result.fillerDuration!).toFixed(1))}s`);

      if (result.fillers && result.fillers.length > 0) {
        console.log();
        console.log(chalk.dim("Detected fillers:"));
        for (const filler of result.fillers) {
          console.log(chalk.dim(`  "${filler.word}" at ${filler.start.toFixed(2)}s - ${filler.end.toFixed(2)}s`));
        }
      }

      if (!options.analyzeOnly && result.outputPath) {
        console.log();
        console.log(chalk.green(`Output: ${result.outputPath}`));
        console.log(chalk.dim(`Removed ${result.fillerDuration!.toFixed(1)}s of filler words`));
      }
      console.log();
    } catch (error) {
      console.error(chalk.red("Jump cut failed"));
      console.error(error);
      process.exit(1);
    }
  });


}
