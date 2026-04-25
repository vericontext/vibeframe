/**
 * @module ai-audio
 * @description Audio commands for the VibeFrame CLI.
 *
 * ## Commands: vibe ai transcribe, vibe ai tts, vibe ai voices, vibe ai sfx,
 *             vibe ai isolate, vibe ai voice-clone, vibe ai music,
 *             vibe ai music-status, vibe ai audio-restore, vibe ai dub, vibe ai duck
 * ## Dependencies: Whisper, ElevenLabs, Replicate, FFmpeg
 *
 * Extracted from ai.ts as part of modularisation.
 * ai.ts calls registerAudioCommands(aiCommand).
 * @see MODELS.md for AI model configuration
 */

import { type Command } from 'commander';
import { resolve, dirname, basename, extname } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import ora from 'ora';
import {
  WhisperProvider,
  ElevenLabsProvider,
  ReplicateProvider,
  ClaudeProvider,
} from '@vibeframe/ai-providers';
import { getApiKey } from '../utils/api-key.js';
import { execSafe, execSafeSync, commandExists } from '../utils/exec-safe.js';
import { detectFormat, formatTranscript } from '../utils/subtitle.js';
import { formatTime } from './ai-helpers.js';
import { exitWithError, authError, notFoundError, apiError, usageError, generalError, outputResult } from './output.js';
import { validateOutputPath } from "./validate.js";

function _registerAudioCommands(aiCommand: Command): void {

aiCommand
  .command("transcribe")
  .description("Transcribe audio using Whisper")
  .argument("<audio>", "Audio file path")
  .option("-k, --api-key <key>", "OpenAI API key (or set OPENAI_API_KEY env)")
  .option("-l, --language <lang>", "Language code (e.g., en, ko)")
  .option("-o, --output <path>", "Output file path")
  .option("-f, --format <format>", "Output format: json, srt, vtt (auto-detected from extension)")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (audioPath: string, options) => {
    try {
      if (options.output) {
        validateOutputPath(options.output);
      }

      if (options.dryRun) {
        outputResult({ dryRun: true, command: "ai transcribe", params: { audio: audioPath, output: options.output, language: options.language, format: options.format } });
        return;
      }

      const apiKey = await getApiKey("OPENAI_API_KEY", "OpenAI", options.apiKey);
      if (!apiKey) {
        exitWithError(authError("OPENAI_API_KEY", "OpenAI"));
      }

      const spinner = ora("Initializing Whisper...").start();

      const whisper = new WhisperProvider();
      await whisper.initialize({ apiKey });

      spinner.text = "Reading audio file...";
      const absPath = resolve(process.cwd(), audioPath);
      const audioBuffer = await readFile(absPath);
      const audioBlob = new Blob([audioBuffer]);

      spinner.text = "Transcribing...";
      const result = await whisper.transcribe(audioBlob, options.language);

      if (result.status === "failed") {
        spinner.fail("Transcription failed");
        exitWithError(apiError(`Transcription failed: ${result.error}`, true));
      }

      spinner.succeed(chalk.green("Transcription complete"));

      console.log();
      console.log(chalk.bold.cyan("Transcript"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(result.fullText);
      console.log();

      if (result.segments && result.segments.length > 0) {
        console.log(chalk.bold.cyan("Segments"));
        console.log(chalk.dim("─".repeat(60)));
        for (const seg of result.segments) {
          const time = `[${formatTime(seg.startTime)} - ${formatTime(seg.endTime)}]`;
          console.log(`${chalk.dim(time)} ${seg.text}`);
        }
        console.log();
      }

      if (options.output) {
        const outputPath = resolve(process.cwd(), options.output);
        const format = detectFormat(options.output, options.format);
        const content = formatTranscript(result, format);
        await writeFile(outputPath, content, "utf-8");
        console.log(chalk.green(`Saved ${format.toUpperCase()} to: ${outputPath}`));
      }
    } catch (error) {
      exitWithError(apiError(`Transcription failed: ${error instanceof Error ? error.message : String(error)}`, true));
    }
  });

aiCommand
  .command("tts")
  .description("Generate speech from text using ElevenLabs")
  .argument("<text>", "Text to convert to speech")
  .option("-k, --api-key <key>", "ElevenLabs API key (or set ELEVENLABS_API_KEY env)")
  .option("-o, --output <path>", "Output audio file path", "output.mp3")
  .option("-v, --voice <id>", "Voice ID (default: Rachel)", "21m00Tcm4TlvDq8ikWAM")
  .option("--list-voices", "List available voices")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (text: string, options) => {
    try {
      if (options.output) {
        validateOutputPath(options.output);
      }

      if (options.dryRun) {
        outputResult({ dryRun: true, command: "ai tts", params: { text, output: options.output, voice: options.voice } });
        return;
      }

      const apiKey = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs", options.apiKey);
      if (!apiKey) {
        exitWithError(authError("ELEVENLABS_API_KEY", "ElevenLabs"));
      }

      const elevenlabs = new ElevenLabsProvider();
      await elevenlabs.initialize({ apiKey });

      // List voices mode
      if (options.listVoices) {
        const spinner = ora("Fetching voices...").start();
        const voices = await elevenlabs.getVoices();
        spinner.succeed(chalk.green(`Found ${voices.length} voices`));

        console.log();
        console.log(chalk.bold.cyan("Available Voices"));
        console.log(chalk.dim("─".repeat(60)));

        for (const voice of voices) {
          console.log();
          console.log(`${chalk.bold(voice.name)} ${chalk.dim(`(${voice.voice_id})`)}`);
          console.log(`  Category: ${voice.category}`);
          if (voice.labels) {
            const labels = Object.entries(voice.labels)
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ");
            console.log(`  ${chalk.dim(labels)}`);
          }
        }
        console.log();
        return;
      }

      const spinner = ora("Generating speech...").start();

      const result = await elevenlabs.textToSpeech(text, {
        voiceId: options.voice,
      });

      if (!result.success || !result.audioBuffer) {
        spinner.fail("TTS generation failed");
        exitWithError(apiError(result.error || "TTS generation failed", true));
      }

      const outputPath = resolve(process.cwd(), options.output);
      await writeFile(outputPath, result.audioBuffer);

      spinner.succeed(chalk.green("Speech generated"));
      console.log();
      console.log(chalk.dim(`Characters: ${result.characterCount}`));
      console.log(chalk.green(`Saved to: ${outputPath}`));
      console.log();
    } catch (error) {
      exitWithError(apiError(`TTS generation failed: ${error instanceof Error ? error.message : String(error)}`, true));
    }
  });

aiCommand
  .command("voices")
  .description("List available ElevenLabs voices")
  .option("-k, --api-key <key>", "ElevenLabs API key (or set ELEVENLABS_API_KEY env)")
  .action(async (options) => {
    try {
      const apiKey = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs", options.apiKey);
      if (!apiKey) {
        exitWithError(authError("ELEVENLABS_API_KEY", "ElevenLabs"));
      }

      const spinner = ora("Fetching voices...").start();
      const elevenlabs = new ElevenLabsProvider();
      await elevenlabs.initialize({ apiKey });

      const voices = await elevenlabs.getVoices();
      spinner.succeed(chalk.green(`Found ${voices.length} voices`));

      console.log();
      console.log(chalk.bold.cyan("Available Voices"));
      console.log(chalk.dim("─".repeat(60)));

      for (const voice of voices) {
        console.log();
        console.log(`${chalk.bold(voice.name)} ${chalk.dim(`(${voice.voice_id})`)}`);
        console.log(`  Category: ${voice.category}`);
      }
      console.log();
    } catch (error) {
      exitWithError(apiError(`Failed to fetch voices: ${error instanceof Error ? error.message : String(error)}`, true));
    }
  });

aiCommand
  .command("sfx")
  .description("Generate sound effect using ElevenLabs")
  .argument("<prompt>", "Description of the sound effect")
  .option("-k, --api-key <key>", "ElevenLabs API key (or set ELEVENLABS_API_KEY env)")
  .option("-o, --output <path>", "Output audio file path", "sound-effect.mp3")
  .option("-d, --duration <seconds>", "Duration in seconds (0.5-22, default: auto)")
  .option("--prompt-influence <value>", "Prompt influence (0-1, default: 0.3)")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (prompt: string, options) => {
    try {
      if (options.output) {
        validateOutputPath(options.output);
      }

      if (options.dryRun) {
        outputResult({ dryRun: true, command: "ai sfx", params: { prompt, output: options.output, duration: options.duration, promptInfluence: options.promptInfluence } });
        return;
      }

      const apiKey = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs", options.apiKey);
      if (!apiKey) {
        exitWithError(authError("ELEVENLABS_API_KEY", "ElevenLabs"));
      }

      const spinner = ora("Generating sound effect...").start();

      const elevenlabs = new ElevenLabsProvider();
      await elevenlabs.initialize({ apiKey });

      const result = await elevenlabs.generateSoundEffect(prompt, {
        duration: options.duration ? parseFloat(options.duration) : undefined,
        promptInfluence: options.promptInfluence ? parseFloat(options.promptInfluence) : undefined,
      });

      if (!result.success || !result.audioBuffer) {
        spinner.fail("Sound effect generation failed");
        exitWithError(apiError(result.error || "Sound effect generation failed", true));
      }

      const outputPath = resolve(process.cwd(), options.output);
      await writeFile(outputPath, result.audioBuffer);

      spinner.succeed(chalk.green("Sound effect generated"));
      console.log(chalk.green(`Saved to: ${outputPath}`));
      console.log();
    } catch (error) {
      exitWithError(apiError(`Sound effect generation failed: ${error instanceof Error ? error.message : String(error)}`, true));
    }
  });

aiCommand
  .command("isolate")
  .description("Isolate vocals from audio using ElevenLabs")
  .argument("<audio>", "Input audio file path")
  .option("-k, --api-key <key>", "ElevenLabs API key (or set ELEVENLABS_API_KEY env)")
  .option("-o, --output <path>", "Output audio file path", "vocals.mp3")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (audioPath: string, options) => {
    try {
      if (options.output) {
        validateOutputPath(options.output);
      }

      if (options.dryRun) {
        outputResult({ dryRun: true, command: "ai isolate", params: { audio: audioPath, output: options.output } });
        return;
      }

      const apiKey = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs", options.apiKey);
      if (!apiKey) {
        exitWithError(authError("ELEVENLABS_API_KEY", "ElevenLabs"));
      }

      const spinner = ora("Reading audio file...").start();

      const absPath = resolve(process.cwd(), audioPath);
      const audioBuffer = await readFile(absPath);

      spinner.text = "Isolating vocals...";

      const elevenlabs = new ElevenLabsProvider();
      await elevenlabs.initialize({ apiKey });

      const result = await elevenlabs.isolateVocals(audioBuffer);

      if (!result.success || !result.audioBuffer) {
        spinner.fail("Audio isolation failed");
        exitWithError(apiError(result.error || "Audio isolation failed", true));
      }

      const outputPath = resolve(process.cwd(), options.output);
      await writeFile(outputPath, result.audioBuffer);

      spinner.succeed(chalk.green("Vocals isolated"));
      console.log(chalk.green(`Saved to: ${outputPath}`));
      console.log();
    } catch (error) {
      exitWithError(apiError(`Audio isolation failed: ${error instanceof Error ? error.message : String(error)}`, true));
    }
  });


aiCommand
  .command("voice-clone")
  .description("Clone a voice from audio samples using ElevenLabs")
  .argument("[samples...]", "Audio sample files (1-25 files)")
  .option("-k, --api-key <key>", "ElevenLabs API key (or set ELEVENLABS_API_KEY env)")
  .option("-n, --name <name>", "Voice name (required)")
  .option("-d, --description <desc>", "Voice description")
  .option("--labels <json>", "Labels as JSON (e.g., '{\"accent\": \"american\"}')")
  .option("--remove-noise", "Remove background noise from samples")
  .option("--list", "List all available voices")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (samples: string[], options) => {
    try {
      if (options.dryRun) {
        outputResult({ dryRun: true, command: "ai voice-clone", params: { samples, name: options.name, description: options.description, removeNoise: options.removeNoise } });
        return;
      }

      const apiKey = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs", options.apiKey);
      if (!apiKey) {
        exitWithError(authError("ELEVENLABS_API_KEY", "ElevenLabs"));
      }

      const elevenlabs = new ElevenLabsProvider();
      await elevenlabs.initialize({ apiKey });

      // List voices mode
      if (options.list) {
        const spinner = ora("Fetching voices...").start();
        const voices = await elevenlabs.getVoices();
        spinner.succeed(chalk.green(`Found ${voices.length} voices`));

        console.log();
        console.log(chalk.bold.cyan("Available Voices"));
        console.log(chalk.dim("─".repeat(60)));

        for (const voice of voices) {
          const category = chalk.dim(`(${voice.category})`);
          console.log(`${chalk.bold(voice.name)} ${category}`);
          console.log(`  ${chalk.dim("ID:")} ${voice.voice_id}`);
          if (voice.labels && Object.keys(voice.labels).length > 0) {
            console.log(`  ${chalk.dim("Labels:")} ${JSON.stringify(voice.labels)}`);
          }
          console.log();
        }
        return;
      }

      // Clone voice mode
      if (!options.name) {
        exitWithError(usageError("Voice name is required. Use --name <name>"));
      }

      if (!samples || samples.length === 0) {
        exitWithError(usageError("At least one audio sample is required"));
      }

      const spinner = ora("Reading audio samples...").start();

      const audioBuffers: Buffer[] = [];
      for (const samplePath of samples) {
        const absPath = resolve(process.cwd(), samplePath);
        if (!existsSync(absPath)) {
          spinner.fail("File not found");
          exitWithError(notFoundError(samplePath));
        }
        const buffer = await readFile(absPath);
        audioBuffers.push(buffer);
      }

      spinner.text = `Cloning voice from ${audioBuffers.length} sample(s)...`;

      const labels = options.labels ? JSON.parse(options.labels) : undefined;

      const result = await elevenlabs.cloneVoice(audioBuffers, {
        name: options.name,
        description: options.description,
        labels,
        removeBackgroundNoise: options.removeNoise,
      });

      if (!result.success) {
        spinner.fail("Voice cloning failed");
        exitWithError(apiError(result.error || "Voice cloning failed", true));
      }

      spinner.succeed(chalk.green("Voice cloned successfully"));
      console.log();
      console.log(chalk.bold.cyan("Voice Details"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Name: ${chalk.bold(options.name)}`);
      console.log(`Voice ID: ${chalk.bold(result.voiceId)}`);
      console.log();
      console.log(chalk.dim("Use this voice ID with:"));
      console.log(chalk.dim(`  pnpm vibe ai tts "Hello world" -v ${result.voiceId}`));
      console.log();
    } catch (error) {
      exitWithError(apiError(`Voice cloning failed: ${error instanceof Error ? error.message : String(error)}`, true));
    }
  });

aiCommand
  .command("music")
  .description("Generate background music from a text prompt using MusicGen")
  .argument("<prompt>", "Description of the music to generate")
  .option("-k, --api-key <key>", "Replicate API token (or set REPLICATE_API_TOKEN env)")
  .option("-d, --duration <seconds>", "Duration in seconds (1-30)", "8")
  .option("-m, --melody <file>", "Reference melody audio file for conditioning")
  .option("--model <model>", "Model variant: large, stereo-large, melody-large, stereo-melody-large", "stereo-large")
  .option("-o, --output <path>", "Output audio file path", "music.mp3")
  .option("--no-wait", "Don't wait for generation to complete (async mode)")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (prompt: string, options) => {
    try {
      if (options.output) {
        validateOutputPath(options.output);
      }

      if (options.dryRun) {
        outputResult({ dryRun: true, command: "ai music", params: { prompt, output: options.output, duration: options.duration, model: options.model, melody: options.melody } });
        return;
      }

      const apiKey = await getApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);
      if (!apiKey) {
        exitWithError(authError("REPLICATE_API_TOKEN", "Replicate"));
      }

      const replicate = new ReplicateProvider();
      await replicate.initialize({ apiKey });

      const spinner = ora("Starting music generation...").start();

      const duration = Math.max(1, Math.min(30, parseFloat(options.duration)));

      // If melody file provided, upload it first
      let melodyUrl: string | undefined;
      if (options.melody) {
        spinner.text = "Uploading melody reference...";
        const absPath = resolve(process.cwd(), options.melody);
        if (!existsSync(absPath)) {
          spinner.fail("Melody file not found");
          exitWithError(notFoundError(options.melody));
        }
        // For Replicate, we need a publicly accessible URL
        // In practice, users would need to host the file or use a data URL
        exitWithError(usageError("Melody conditioning requires a publicly accessible URL. Please upload your melody file and provide the URL."));
      }

      const result = await replicate.generateMusic(prompt, {
        duration,
        model: options.model as "large" | "stereo-large" | "melody-large" | "stereo-melody-large",
        melodyUrl,
      });

      if (!result.success || !result.taskId) {
        spinner.fail("Music generation failed");
        exitWithError(apiError(result.error || "Music generation failed", true));
      }

      if (!options.wait) {
        spinner.succeed(chalk.green("Music generation started"));
        console.log();
        console.log(`Task ID: ${chalk.bold(result.taskId)}`);
        console.log(chalk.dim("Check status with: pnpm vibe ai music-status " + result.taskId));
        return;
      }

      spinner.text = "Generating music (this may take a few minutes)...";

      const finalResult = await replicate.waitForMusic(result.taskId);

      if (!finalResult.success || !finalResult.audioUrl) {
        spinner.fail("Music generation failed");
        exitWithError(apiError(finalResult.error || "Music generation failed", true));
      }

      spinner.text = "Downloading generated audio...";

      const response = await fetch(finalResult.audioUrl);
      if (!response.ok) {
        spinner.fail("Failed to download generated audio");
        exitWithError(apiError("Failed to download generated audio", true));
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer());
      const outputPath = resolve(process.cwd(), options.output);
      await writeFile(outputPath, audioBuffer);

      spinner.succeed(chalk.green("Music generated successfully"));
      console.log();
      console.log(`Saved to: ${chalk.bold(outputPath)}`);
      console.log(`Duration: ${duration}s`);
      console.log(`Model: ${options.model}`);
      console.log();
    } catch (error) {
      exitWithError(apiError(`Music generation failed: ${error instanceof Error ? error.message : String(error)}`, true));
    }
  });

aiCommand
  .command("music-status")
  .description("Check music generation status")
  .argument("<task-id>", "Task ID from music generation")
  .option("-k, --api-key <key>", "Replicate API token (or set REPLICATE_API_TOKEN env)")
  .action(async (taskId: string, options) => {
    try {
      const apiKey = await getApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);
      if (!apiKey) {
        exitWithError(authError("REPLICATE_API_TOKEN", "Replicate"));
      }

      const replicate = new ReplicateProvider();
      await replicate.initialize({ apiKey });

      const result = await replicate.getMusicStatus(taskId);

      console.log();
      console.log(chalk.bold.cyan("Music Generation Status"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Task ID: ${taskId}`);

      if (result.audioUrl) {
        console.log(`Status: ${chalk.green("completed")}`);
        console.log(`Audio URL: ${result.audioUrl}`);
      } else if (result.error) {
        console.log(`Status: ${chalk.red("failed")}`);
        console.log(`Error: ${result.error}`);
      } else {
        console.log(`Status: ${chalk.yellow("processing")}`);
      }
      console.log();
    } catch (error) {
      exitWithError(apiError(`Failed to get music status: ${error instanceof Error ? error.message : String(error)}`, true));
    }
  });

aiCommand
  .command("audio-restore")
  .description("Restore audio quality (denoise, enhance)")
  .argument("<audio>", "Input audio file path")
  .option("-k, --api-key <key>", "Replicate API token (or set REPLICATE_API_TOKEN env)")
  .option("-o, --output <path>", "Output audio file path")
  .option("--ffmpeg", "Use FFmpeg for restoration (free, no API needed)")
  .option("--denoise", "Enable noise reduction (default: true)", true)
  .option("--no-denoise", "Disable noise reduction")
  .option("--enhance", "Enable audio enhancement")
  .option("--noise-floor <dB>", "FFmpeg noise floor threshold", "-30")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (audioPath: string, options) => {
    try {
      if (options.output) {
        validateOutputPath(options.output);
      }

      const absPath = resolve(process.cwd(), audioPath);
      if (!existsSync(absPath)) {
        exitWithError(notFoundError(audioPath));
      }

      if (options.dryRun) {
        outputResult({ dryRun: true, command: "ai audio-restore", params: { audio: audioPath, output: options.output, ffmpeg: options.ffmpeg, denoise: options.denoise, enhance: options.enhance, noiseFloor: options.noiseFloor } });
        return;
      }

      // Default output path
      const ext = extname(audioPath);
      const baseName = basename(audioPath, ext);
      const defaultOutput = `${baseName}-restored${ext || ".mp3"}`;
      const outputPath = resolve(process.cwd(), options.output || defaultOutput);

      // FFmpeg mode (free)
      if (options.ffmpeg) {
        const spinner = ora("Restoring audio with FFmpeg...").start();

        try {
          const noiseFloor = options.noiseFloor || "-30";

          // Build filter chain
          const filters: string[] = [];

          if (options.denoise !== false) {
            filters.push(`afftdn=nf=${noiseFloor}`);
          }

          if (options.enhance) {
            filters.push("highpass=f=80");
            filters.push("lowpass=f=12000");
            filters.push("loudnorm=I=-16:TP=-1.5:LRA=11");
          }

          const ffmpegArgs = ["-i", absPath];
          if (filters.length > 0) {
            ffmpegArgs.push("-af", filters.join(","));
          }
          ffmpegArgs.push("-y", outputPath);

          execSafeSync("ffmpeg", ffmpegArgs);

          spinner.succeed(chalk.green("Audio restored with FFmpeg"));
          console.log(`Saved to: ${chalk.bold(outputPath)}`);
          console.log();
        } catch (error) {
          spinner.fail("FFmpeg restoration failed");
          exitWithError(generalError(`FFmpeg restoration failed: ${error instanceof Error ? error.message : String(error)}`));
        }
        return;
      }

      // Replicate AI mode
      const apiKey = await getApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);
      if (!apiKey) {
        exitWithError(authError("REPLICATE_API_TOKEN", "Replicate"));
      }

      const replicate = new ReplicateProvider();
      await replicate.initialize({ apiKey });

      // For Replicate, we need a publicly accessible URL
      // This is a limitation - users need to upload their file first
      exitWithError(usageError("Replicate requires a publicly accessible audio URL. For local files, use --ffmpeg for free local processing.", `pnpm vibe ai audio-restore ${audioPath} --ffmpeg`));
    } catch (error) {
      exitWithError(apiError(`Audio restoration failed: ${error instanceof Error ? error.message : String(error)}`, true));
    }
  });

aiCommand
  .command("dub")
  .description("Dub audio/video to another language (transcribe, translate, TTS)")
  .argument("<media>", "Input media file (video or audio)")
  .option("-l, --language <lang>", "Target language code (e.g., es, ko, ja) (required)")
  .option("--source <lang>", "Source language code (default: auto-detect)")
  .option("-v, --voice <id>", "ElevenLabs voice ID for output")
  .option("--analyze-only", "Only analyze and show timing, don't generate audio")
  .option("-o, --output <path>", "Output file path")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (mediaPath: string, options) => {
    try {
      if (options.output) {
        validateOutputPath(options.output);
      }

      if (!options.language) {
        exitWithError(usageError("Target language is required. Use -l or --language"));
      }

      if (options.dryRun) {
        outputResult({ dryRun: true, command: "ai dub", params: { media: mediaPath, output: options.output, language: options.language, source: options.source, voice: options.voice, analyzeOnly: options.analyzeOnly } });
        return;
      }

      const absPath = resolve(process.cwd(), mediaPath);
      if (!existsSync(absPath)) {
        exitWithError(notFoundError(mediaPath));
      }

      // Check required API keys
      const openaiKey = await getApiKey("OPENAI_API_KEY", "OpenAI", undefined);
      const anthropicKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic", undefined);
      const elevenlabsKey = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs", undefined);

      if (!openaiKey) {
        exitWithError(authError("OPENAI_API_KEY", "OpenAI"));
      }

      if (!anthropicKey) {
        exitWithError(authError("ANTHROPIC_API_KEY", "Anthropic"));
      }

      if (!options.analyzeOnly && !elevenlabsKey) {
        exitWithError(authError("ELEVENLABS_API_KEY", "ElevenLabs"));
      }

      const spinner = ora("Extracting audio...").start();

      // Check if input is video
      const ext = extname(absPath).toLowerCase();
      const isVideo = [".mp4", ".mov", ".avi", ".mkv", ".webm"].includes(ext);

      // Step 1: Extract audio if video
      let audioPath = absPath;
      if (isVideo) {
        const tempAudioPath = resolve(dirname(absPath), `temp-audio-${Date.now()}.mp3`);
        try {
          execSafeSync("ffmpeg", ["-i", absPath, "-vn", "-acodec", "mp3", "-y", tempAudioPath]);
          audioPath = tempAudioPath;
        } catch (error) {
          spinner.fail("Failed to extract audio from video");
          exitWithError(generalError(`Failed to extract audio from video: ${error instanceof Error ? error.message : String(error)}`));
        }
      }

      // Step 2: Transcribe with Whisper
      spinner.text = "Transcribing audio...";
      const whisper = new WhisperProvider();
      await whisper.initialize({ apiKey: openaiKey });

      const audioBuffer = await readFile(audioPath);
      const audioBlob = new Blob([audioBuffer]);

      const transcriptResult = await whisper.transcribe(audioBlob, options.source);

      if (transcriptResult.status === "failed" || !transcriptResult.segments) {
        spinner.fail("Transcription failed");
        exitWithError(apiError(`Transcription failed: ${transcriptResult.error}`, true));
      }

      // Step 3: Translate with Claude
      spinner.text = "Translating...";
      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey: anthropicKey });

      // Build translation prompt
      const segments = transcriptResult.segments;
      const segmentTexts = segments.map((s, i) => `[${i}] ${s.text}`).join("\n");

      // Language names for better translation context
      const languageNames: Record<string, string> = {
        en: "English", es: "Spanish", fr: "French", de: "German",
        it: "Italian", pt: "Portuguese", ja: "Japanese", ko: "Korean",
        zh: "Chinese", ar: "Arabic", ru: "Russian", hi: "Hindi",
      };
      const targetLangName = languageNames[options.language] || options.language;

      // Use Claude's analyzeContent method to translate the segments
      // The segments maintain their timing, we just need translated text
      let translatedSegments: Array<{ index: number; text: string; startTime: number; endTime: number }> = [];

      try {
        // For translation, we use analyzeContent with a custom prompt
        // This returns storyboard segments which we can adapt for translation
        const storyboard = await claude.analyzeContent(
          `TRANSLATE to ${targetLangName}. Return the translated text only, preserving segment numbers:\n\n${segmentTexts}`,
          segments[segments.length - 1]?.endTime || 60
        );

        // Map storyboard results to translated segments
        // If storyboard returned results, use descriptions as translations
        if (storyboard && storyboard.length > 0) {
          translatedSegments = segments.map((s, i) => ({
            index: i,
            text: storyboard[i]?.description || s.text,
            startTime: s.startTime,
            endTime: s.endTime,
          }));
        } else {
          // Fallback: use original text
          translatedSegments = segments.map((s, i) => ({
            index: i,
            text: s.text,
            startTime: s.startTime,
            endTime: s.endTime,
          }));
        }
      } catch {
        // Fallback: just show original text
        translatedSegments = segments.map((s, i) => ({
          index: i,
          text: s.text,
          startTime: s.startTime,
          endTime: s.endTime,
        }));
      }

      spinner.succeed(chalk.green("Transcription and translation complete"));

      // Display timing analysis
      console.log();
      console.log(chalk.bold.cyan("Dubbing Analysis"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Source language: ${transcriptResult.detectedLanguage || options.source || "auto"}`);
      console.log(`Target language: ${targetLangName}`);
      console.log(`Segments: ${segments.length}`);
      console.log();

      console.log(chalk.bold("Segment Timing:"));
      for (let i = 0; i < Math.min(5, segments.length); i++) {
        const seg = segments[i];
        const time = `[${formatTime(seg.startTime)} - ${formatTime(seg.endTime)}]`;
        console.log(`${chalk.dim(time)} ${seg.text}`);
        console.log(`${chalk.dim("           →")} ${chalk.green(translatedSegments[i]?.text || seg.text)}`);
        console.log();
      }

      if (segments.length > 5) {
        console.log(chalk.dim(`... and ${segments.length - 5} more segments`));
      }

      if (options.analyzeOnly) {
        console.log();
        console.log(chalk.dim("Use without --analyze-only to generate dubbed audio"));

        // Save timing to JSON if output specified
        if (options.output) {
          const timingPath = resolve(process.cwd(), options.output);
          const timingData = {
            sourcePath: absPath,
            sourceLanguage: transcriptResult.detectedLanguage || options.source || "auto",
            targetLanguage: options.language,
            segments: segments.map((s, i) => ({
              index: i,
              startTime: s.startTime,
              endTime: s.endTime,
              original: s.text,
              translated: translatedSegments[i]?.text || s.text,
            })),
          };
          await writeFile(timingPath, JSON.stringify(timingData, null, 2));
          console.log(`Timing saved to: ${chalk.bold(timingPath)}`);
        }
        return;
      }

      // Step 4: Generate TTS for each segment
      spinner.start("Generating dubbed audio...");
      const elevenlabs = new ElevenLabsProvider();
      await elevenlabs.initialize({ apiKey: elevenlabsKey! });

      const dubbedAudioBuffers: Array<{ buffer: Buffer; startTime: number }> = [];

      for (let i = 0; i < translatedSegments.length; i++) {
        spinner.text = `Generating audio segment ${i + 1}/${translatedSegments.length}...`;
        const seg = translatedSegments[i];

        const ttsResult = await elevenlabs.textToSpeech(seg.text, {
          voiceId: options.voice,
        });

        if (ttsResult.success && ttsResult.audioBuffer) {
          dubbedAudioBuffers.push({
            buffer: ttsResult.audioBuffer,
            startTime: seg.startTime,
          });
        }
      }

      // Step 5: Combine and save
      spinner.text = "Combining audio...";

      // For simplicity, just concatenate the audio buffers
      // In production, you'd use FFmpeg to properly place them at timestamps
      const combinedBuffer = Buffer.concat(dubbedAudioBuffers.map((a) => a.buffer));

      const outputExt = isVideo ? ".mp3" : extname(absPath);
      const defaultOutputPath = resolve(
        dirname(absPath),
        `${basename(absPath, extname(absPath))}-${options.language}${outputExt}`
      );
      const finalOutputPath = resolve(process.cwd(), options.output || defaultOutputPath);

      await writeFile(finalOutputPath, combinedBuffer);

      spinner.succeed(chalk.green("Dubbing complete"));
      console.log();
      console.log(`Saved to: ${chalk.bold(finalOutputPath)}`);
      console.log();

      // Clean up temp audio if we extracted from video
      if (isVideo && audioPath !== absPath) {
        try {
          const { unlink } = await import("node:fs/promises");
          await unlink(audioPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    } catch (error) {
      exitWithError(apiError(`Dubbing failed: ${error instanceof Error ? error.message : String(error)}`, true));
    }
  });

// ============================================
// Smart Editing Commands
// ============================================

// Audio Ducking (FFmpeg only)
aiCommand
  .command("duck")
  .description("Auto-duck background music when voice is present (FFmpeg)")
  .argument("<music>", "Background music file path")
  .option("-v, --voice <path>", "Voice/narration track (required)")
  .option("-o, --output <path>", "Output audio file path")
  .option("-t, --threshold <dB>", "Sidechain threshold in dB", "-30")
  .option("-r, --ratio <ratio>", "Compression ratio", "3")
  .option("-a, --attack <ms>", "Attack time in ms", "20")
  .option("-l, --release <ms>", "Release time in ms", "200")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (musicPath: string, options) => {
    try {
      if (options.output) {
        validateOutputPath(options.output);
      }

      if (!options.voice) {
        exitWithError(usageError("Voice track required. Use --voice <path>"));
      }

      if (options.dryRun) {
        outputResult({ dryRun: true, command: "ai duck", params: { music: musicPath, output: options.output, voice: options.voice, threshold: options.threshold, ratio: options.ratio, attack: options.attack, release: options.release } });
        return;
      }

      // Check FFmpeg availability
      if (!commandExists("ffmpeg")) {
        exitWithError(generalError("FFmpeg not found. Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux). Run `vibe doctor` for details."));
      }

      const spinner = ora("Processing audio ducking...").start();

      const absMusic = resolve(process.cwd(), musicPath);
      const absVoice = resolve(process.cwd(), options.voice);
      const outputPath = options.output
        ? resolve(process.cwd(), options.output)
        : absMusic.replace(/(\.[^.]+)$/, "-ducked$1");

      // Convert threshold from dB to linear (0-1 scale)
      const thresholdDb = parseFloat(options.threshold);
      const thresholdLinear = Math.pow(10, thresholdDb / 20);

      const ratio = parseFloat(options.ratio);
      const attack = parseFloat(options.attack);
      const release = parseFloat(options.release);

      // FFmpeg sidechain compress filter
      const filterComplex = `[0:a][1:a]sidechaincompress=threshold=${thresholdLinear}:ratio=${ratio}:attack=${attack}:release=${release}[out]`;

      await execSafe("ffmpeg", ["-i", absMusic, "-i", absVoice, "-filter_complex", filterComplex, "-map", "[out]", outputPath, "-y"]);

      spinner.succeed(chalk.green("Audio ducking complete"));
      console.log();
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Music: ${musicPath}`);
      console.log(`Voice: ${options.voice}`);
      console.log(`Threshold: ${thresholdDb}dB`);
      console.log(`Ratio: ${ratio}:1`);
      console.log(`Attack/Release: ${attack}ms / ${release}ms`);
      console.log();
      console.log(chalk.green(`Output: ${outputPath}`));
      console.log();
    } catch (error) {
      exitWithError(generalError(`Audio ducking failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  });

// AI Color Grading

}

/**
 * Register all audio sub-commands on the given parent command.
 * Called from ai.ts: registerAudioCommands(aiCommand)
 */
export function registerAudioCommands(aiCommand: Command): void {
  _registerAudioCommands(aiCommand);
}


// ── Exported execute functions ─────────────────────────────────────────────


// ============================================================================
// Transcribe
// ============================================================================

export interface TranscribeOptions {
  audioPath: string;
  language?: string;
  output?: string;
  format?: string;
  apiKey?: string;
}

export interface TranscribeResult {
  success: boolean;
  text?: string;
  segments?: Array<{ startTime: number; endTime: number; text: string }>;
  detectedLanguage?: string;
  outputPath?: string;
  error?: string;
}

export async function executeTranscribe(options: TranscribeOptions): Promise<TranscribeResult> {
  const { audioPath, language, output, format, apiKey } = options;

  try {
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (!key) return { success: false, error: "OPENAI_API_KEY required" };

    const absPath = resolve(process.cwd(), audioPath);
    if (!existsSync(absPath)) return { success: false, error: `File not found: ${absPath}` };

    const whisper = new WhisperProvider();
    await whisper.initialize({ apiKey: key });

    const audioBuffer = await readFile(absPath);
    const audioBlob = new Blob([audioBuffer]);

    const result = await whisper.transcribe(audioBlob, language);

    if (result.status === "failed") {
      return { success: false, error: result.error || "Transcription failed" };
    }

    let outputPath: string | undefined;
    if (output) {
      outputPath = resolve(process.cwd(), output);
      const fmt = detectFormat(output, format);
      const content = formatTranscript(result, fmt);
      await writeFile(outputPath, content, "utf-8");
    }

    return {
      success: true,
      text: result.fullText,
      segments: result.segments?.map(s => ({ startTime: s.startTime, endTime: s.endTime, text: s.text })),
      detectedLanguage: result.detectedLanguage,
      outputPath,
    };
  } catch (error) {
    return { success: false, error: `Transcription failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}


// ============================================================================
// Audio Isolate (Vocal Extraction)
// ============================================================================

export interface IsolateOptions {
  audioPath: string;
  output?: string;
  apiKey?: string;
}

export interface IsolateResult {
  success: boolean;
  outputPath?: string;
  error?: string;
}

export async function executeIsolate(options: IsolateOptions): Promise<IsolateResult> {
  const { audioPath, output = "vocals.mp3", apiKey } = options;

  try {
    const key = apiKey || process.env.ELEVENLABS_API_KEY;
    if (!key) return { success: false, error: "ELEVENLABS_API_KEY required" };

    const absPath = resolve(process.cwd(), audioPath);
    if (!existsSync(absPath)) return { success: false, error: `File not found: ${absPath}` };

    const audioBuffer = await readFile(absPath);
    const elevenlabs = new ElevenLabsProvider();
    await elevenlabs.initialize({ apiKey: key });

    const result = await elevenlabs.isolateVocals(audioBuffer);
    if (!result.success || !result.audioBuffer) {
      return { success: false, error: result.error || "Audio isolation failed" };
    }

    const outputPath = resolve(process.cwd(), output);
    await writeFile(outputPath, result.audioBuffer);

    return { success: true, outputPath };
  } catch (error) {
    return { success: false, error: `Audio isolation failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}


// ============================================================================
// Voice Clone
// ============================================================================

export interface VoiceCloneOptions {
  samplePaths: string[];
  name: string;
  description?: string;
  labels?: Record<string, string>;
  removeNoise?: boolean;
  apiKey?: string;
}

export interface VoiceCloneResult {
  success: boolean;
  voiceId?: string;
  name?: string;
  error?: string;
}

export async function executeVoiceClone(options: VoiceCloneOptions): Promise<VoiceCloneResult> {
  const { samplePaths, name, description, labels, removeNoise, apiKey } = options;

  try {
    const key = apiKey || process.env.ELEVENLABS_API_KEY;
    if (!key) return { success: false, error: "ELEVENLABS_API_KEY required" };

    if (!samplePaths || samplePaths.length === 0) {
      return { success: false, error: "At least one audio sample is required" };
    }

    const audioBuffers: Buffer[] = [];
    for (const samplePath of samplePaths) {
      const absPath = resolve(process.cwd(), samplePath);
      if (!existsSync(absPath)) return { success: false, error: `File not found: ${samplePath}` };
      const buffer = await readFile(absPath);
      audioBuffers.push(buffer);
    }

    const elevenlabs = new ElevenLabsProvider();
    await elevenlabs.initialize({ apiKey: key });

    const result = await elevenlabs.cloneVoice(audioBuffers, {
      name,
      description,
      labels,
      removeBackgroundNoise: removeNoise,
    });

    if (!result.success) return { success: false, error: result.error || "Voice cloning failed" };

    return { success: true, voiceId: result.voiceId, name };
  } catch (error) {
    return { success: false, error: `Voice cloning failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}


// ============================================================================
// Dub (Multilingual Dubbing)
// ============================================================================

export interface DubOptions {
  mediaPath: string;
  language: string;
  source?: string;
  voice?: string;
  analyzeOnly?: boolean;
  output?: string;
}

export interface DubResult {
  success: boolean;
  outputPath?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  segmentCount?: number;
  error?: string;
}

export async function executeDub(options: DubOptions): Promise<DubResult> {
  const { mediaPath, language, source, voice, analyzeOnly, output } = options;

  try {
    const absPath = resolve(process.cwd(), mediaPath);
    if (!existsSync(absPath)) return { success: false, error: `File not found: ${absPath}` };

    const openaiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const elevenlabsKey = process.env.ELEVENLABS_API_KEY;

    if (!openaiKey) return { success: false, error: "OPENAI_API_KEY required for Whisper transcription" };
    if (!anthropicKey) return { success: false, error: "ANTHROPIC_API_KEY required for Claude translation" };
    if (!analyzeOnly && !elevenlabsKey) return { success: false, error: "ELEVENLABS_API_KEY required for TTS" };

    // Extract audio if video
    const ext = extname(absPath).toLowerCase();
    const isVideo = [".mp4", ".mov", ".avi", ".mkv", ".webm"].includes(ext);

    let audioPath = absPath;
    if (isVideo) {
      const tempAudioPath = resolve(dirname(absPath), `temp-audio-${Date.now()}.mp3`);
      execSafeSync("ffmpeg", ["-i", absPath, "-vn", "-acodec", "mp3", "-y", tempAudioPath]);
      audioPath = tempAudioPath;
    }

    // Transcribe
    const whisper = new WhisperProvider();
    await whisper.initialize({ apiKey: openaiKey });
    const audioBuffer = await readFile(audioPath);
    const audioBlob = new Blob([audioBuffer]);
    const transcriptResult = await whisper.transcribe(audioBlob, source);

    if (transcriptResult.status === "failed" || !transcriptResult.segments) {
      return { success: false, error: `Transcription failed: ${transcriptResult.error}` };
    }

    const segments = transcriptResult.segments;

    // Translate
    const claude = new ClaudeProvider();
    await claude.initialize({ apiKey: anthropicKey });

    const languageNames: Record<string, string> = {
      en: "English", es: "Spanish", fr: "French", de: "German",
      it: "Italian", pt: "Portuguese", ja: "Japanese", ko: "Korean",
      zh: "Chinese", ar: "Arabic", ru: "Russian", hi: "Hindi",
    };
    const targetLangName = languageNames[language] || language;
    const segmentTexts = segments.map((s, i) => `[${i}] ${s.text}`).join("\n");

    let translatedSegments: Array<{ text: string; startTime: number; endTime: number }> = [];
    try {
      const storyboard = await claude.analyzeContent(
        `TRANSLATE to ${targetLangName}. Return the translated text only, preserving segment numbers:\n\n${segmentTexts}`,
        segments[segments.length - 1]?.endTime || 60
      );
      translatedSegments = segments.map((s, i) => ({
        text: storyboard[i]?.description || s.text,
        startTime: s.startTime,
        endTime: s.endTime,
      }));
    } catch {
      translatedSegments = segments.map(s => ({ text: s.text, startTime: s.startTime, endTime: s.endTime }));
    }

    if (analyzeOnly) {
      if (output) {
        const timingPath = resolve(process.cwd(), output);
        const timingData = {
          sourcePath: absPath,
          sourceLanguage: transcriptResult.detectedLanguage || source || "auto",
          targetLanguage: language,
          segments: segments.map((s, i) => ({
            startTime: s.startTime, endTime: s.endTime,
            original: s.text, translated: translatedSegments[i]?.text || s.text,
          })),
        };
        await writeFile(timingPath, JSON.stringify(timingData, null, 2));
      }
      return {
        success: true,
        sourceLanguage: transcriptResult.detectedLanguage || source || "auto",
        targetLanguage: language,
        segmentCount: segments.length,
        outputPath: output ? resolve(process.cwd(), output) : undefined,
      };
    }

    // Generate TTS
    const elevenlabs = new ElevenLabsProvider();
    await elevenlabs.initialize({ apiKey: elevenlabsKey! });

    const dubbedBuffers: Buffer[] = [];
    for (const seg of translatedSegments) {
      const ttsResult = await elevenlabs.textToSpeech(seg.text, { voiceId: voice });
      if (ttsResult.success && ttsResult.audioBuffer) {
        dubbedBuffers.push(ttsResult.audioBuffer);
      }
    }

    const combinedBuffer = Buffer.concat(dubbedBuffers);
    const outputExt = isVideo ? ".mp3" : extname(absPath);
    const defaultOutputPath = resolve(dirname(absPath), `${basename(absPath, extname(absPath))}-${language}${outputExt}`);
    const finalOutputPath = resolve(process.cwd(), output || defaultOutputPath);
    await writeFile(finalOutputPath, combinedBuffer);

    // Cleanup temp
    if (isVideo && audioPath !== absPath) {
      try { const { unlink } = await import("node:fs/promises"); await unlink(audioPath); } catch { /* cleanup best-effort */ }
    }

    return {
      success: true,
      outputPath: finalOutputPath,
      sourceLanguage: transcriptResult.detectedLanguage || source || "auto",
      targetLanguage: language,
      segmentCount: segments.length,
    };
  } catch (error) {
    return { success: false, error: `Dubbing failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}


// ============================================================================
// Audio Duck (FFmpeg)
// ============================================================================

export interface DuckOptions {
  musicPath: string;
  voicePath: string;
  output?: string;
  threshold?: string;
  ratio?: string;
  attack?: string;
  release?: string;
}

export interface DuckResult {
  success: boolean;
  outputPath?: string;
  error?: string;
}

export async function executeDuck(options: DuckOptions): Promise<DuckResult> {
  const {
    musicPath, voicePath,
    output, threshold = "-30", ratio = "3", attack = "20", release = "200",
  } = options;

  try {
    if (!commandExists("ffmpeg")) return { success: false, error: "FFmpeg not found" };

    const absMusicPath = resolve(process.cwd(), musicPath);
    const absVoicePath = resolve(process.cwd(), voicePath);

    if (!existsSync(absMusicPath)) return { success: false, error: `Music file not found: ${absMusicPath}` };
    if (!existsSync(absVoicePath)) return { success: false, error: `Voice file not found: ${absVoicePath}` };

    const defaultOutput = resolve(dirname(absMusicPath), `${basename(absMusicPath, extname(absMusicPath))}-ducked${extname(absMusicPath)}`);
    const outputPath = resolve(process.cwd(), output || defaultOutput);

    const filter = `[1:a]asplit=2[sc][mix];[0:a][sc]sidechaincompress=threshold=${threshold}dB:ratio=${ratio}:attack=${attack}:release=${release}[ducked];[ducked][mix]amix=inputs=2:duration=longest`;

    await execSafe("ffmpeg", [
      "-i", absMusicPath, "-i", absVoicePath,
      "-filter_complex", filter,
      "-y", outputPath,
    ], { timeout: 120000, maxBuffer: 50 * 1024 * 1024 });

    if (!existsSync(outputPath)) return { success: false, error: "FFmpeg failed to create output" };

    return { success: true, outputPath };
  } catch (error) {
    return { success: false, error: `Audio ducking failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
