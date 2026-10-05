/**
 * @module audio
 *
 * Top-level `vibe audio` command group for audio operations.
 *
 * Commands:
 *   audio transcribe   - Transcribe audio using Whisper
 *   audio list-voices  - List available ElevenLabs voices
 *   audio isolate      - Isolate vocals from audio (ElevenLabs)
 *   audio clone-voice  - Clone a voice from audio samples (ElevenLabs)
 *   audio dub          - Dub audio/video to another language (Whisper + Claude + ElevenLabs)
 *   audio duck         - Auto-duck background music when voice is present (FFmpeg)
 *
 * @dependencies Whisper (OpenAI), ElevenLabs, Claude (Anthropic), FFmpeg
 */

import { Command } from "commander";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import { ElevenLabsProvider } from "@vibeframe/ai-providers";
import { requireApiKey } from "../utils/api-key.js";
import { execSafe, commandExists } from "../utils/exec-safe.js";
import { applyTiers } from "./_shared/cost-tier.js";
import { formatTime } from "./ai-helpers.js";
import {
  isJsonMode,
  outputSuccess,
  exitWithError,
  notFoundError,
  usageError,
  apiError,
  generalError,
  providerFailure,
} from "./output.js";
import { rejectControlChars, validateOutputPath } from "./validate.js";
import { executeDub, executeIsolate, executeTranscribe, executeVoiceClone } from "./ai-audio.js";

export const audioCommand = new Command("audio")
  .alias("au")
  .description("Audio operations (transcribe, dub, duck, isolate, voice clone)")
  .addHelpText(
    "after",
    `
Examples:
  $ vibe audio transcribe interview.mp3 -o transcript.srt --format srt
  $ vibe audio transcribe video.mp4 -l ko                  # Specify language
  $ vibe audio list-voices                                  # List available voices
  $ vibe audio isolate song.mp3 -o vocals.mp3
  $ vibe audio clone-voice sample.mp3 --name "my-voice"
  $ vibe audio dub video.mp4 -l ko -o dubbed.mp4
  $ vibe audio duck music.mp3 --voice narration.mp3 -o ducked.mp3

Consent:
  clone-voice requires explicit user permission for the sampled voice.

API Keys:
  OPENAI_API_KEY      transcribe (Whisper)
  ELEVENLABS_API_KEY  list-voices, isolate, clone-voice
  OPENAI_API_KEY + ANTHROPIC_API_KEY + ELEVENLABS_API_KEY  dub (full pipeline)
  No key needed       duck (FFmpeg only)

Run 'vibe schema audio.<command>' for structured parameter info.
`
  );

// ── audio transcribe ───────────────────────────────────────────────────

audioCommand
  .command("transcribe")
  .description("Transcribe audio using Whisper")
  .argument("<audio>", "Audio file path")
  .option("-k, --api-key <key>", "OpenAI API key (or set OPENAI_API_KEY env)")
  .option("-l, --language <lang>", "Language code (e.g., en, ko)")
  .option("-o, --output <path>", "Output file path")
  .option("--format <format>", "Output format: json, srt, vtt (auto-detected from extension)")
  .action(async (audioPath: string, options) => {
    const startedAt = Date.now();
    if (options.output) validateOutputPath(options.output);
    if (!existsSync(resolve(process.cwd(), audioPath))) {
      exitWithError(notFoundError(resolve(process.cwd(), audioPath)));
    }
    const apiKey = await requireApiKey("OPENAI_API_KEY", "OpenAI", options.apiKey);
    const spinner = isJsonMode() ? null : ora("Transcribing...").start();
    const result = await executeTranscribe({
      audioPath,
      language: options.language,
      output: options.output,
      format: options.format,
      apiKey,
    });
    if (!result.success) {
      spinner?.fail("Transcription failed");
      exitWithError(providerFailure(`Transcription failed: ${result.error}`, result.errorKind));
    }

    if (isJsonMode()) {
      outputSuccess({
        command: "audio transcribe",
        startedAt,
        data: {
          fullText: result.text,
          segments: result.segments,
          language: result.detectedLanguage,
          outputPath: result.outputPath,
        },
      });
      return;
    }

    spinner?.succeed(chalk.green("Transcription complete"));
    console.log();
    console.log(chalk.bold.cyan("Transcript"));
    console.log(chalk.dim("─".repeat(60)));
    console.log(result.text);
    console.log();
    if (result.segments && result.segments.length > 0) {
      console.log(chalk.bold.cyan("Segments"));
      console.log(chalk.dim("─".repeat(60)));
      for (const seg of result.segments) {
        console.log(`${chalk.dim(`[${formatTime(seg.startTime)} - ${formatTime(seg.endTime)}]`)} ${seg.text}`);
      }
      console.log();
    }
    if (result.outputPath) {
      console.log(chalk.green(`Saved ${(result.format ?? "json").toUpperCase()} to: ${result.outputPath}`));
    }
  });

// ── audio list-voices ──────────────────────────────────────────────────
// Renamed from `voices` in v0.74 for verb-first leaf consistency
// (Microsoft CLI design guidance §3.3). The `voices` alias was removed
// in v0.75.

audioCommand
  .command("list-voices")
  .description("List available ElevenLabs voices")
  .option("-k, --api-key <key>", "ElevenLabs API key (or set ELEVENLABS_API_KEY env)")
  .action(async (options) => {
    const startedAt = Date.now();
    try {
      const apiKey = await requireApiKey("ELEVENLABS_API_KEY", "ElevenLabs", options.apiKey);

      const spinner = ora("Fetching voices...").start();
      const elevenlabs = new ElevenLabsProvider();
      await elevenlabs.initialize({ apiKey });

      const voices = await elevenlabs.getVoices();
      spinner.succeed(chalk.green(`Found ${voices.length} voices`));

      if (isJsonMode()) {
        outputSuccess({
          command: "audio list-voices",
          startedAt,
          data: {
            voices: voices.map((v) => ({
              name: v.name,
              voiceId: v.voice_id,
              category: v.category,
              labels: v.labels,
            })),
          },
        });
        return;
      }

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
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(apiError(`Failed to fetch voices: ${msg}`, true));
    }
  });

// ── audio isolate ──────────────────────────────────────────────────────

audioCommand
  .command("isolate")
  .description("Isolate vocals from audio using ElevenLabs")
  .argument("<audio>", "Input audio file path")
  .option("-k, --api-key <key>", "ElevenLabs API key (or set ELEVENLABS_API_KEY env)")
  .option("-o, --output <path>", "Output audio file path", "vocals.mp3")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (audioPath: string, options) => {
    const startedAt = Date.now();
    if (options.dryRun) {
      outputSuccess({ command: "audio isolate", startedAt, dryRun: true, data: { params: { audioPath, output: options.output } } });
      return;
    }
    if (options.output) validateOutputPath(options.output);
    if (!existsSync(resolve(process.cwd(), audioPath))) {
      exitWithError(notFoundError(resolve(process.cwd(), audioPath)));
    }
    const apiKey = await requireApiKey("ELEVENLABS_API_KEY", "ElevenLabs", options.apiKey);
    const spinner = isJsonMode() ? null : ora("Isolating vocals...").start();
    const result = await executeIsolate({ audioPath, output: options.output, apiKey });
    if (!result.success) {
      spinner?.fail(result.error ?? "Audio isolation failed");
      exitWithError(providerFailure(result.error ?? "Audio isolation failed", result.errorKind));
    }
    if (isJsonMode()) {
      outputSuccess({ command: "audio isolate", startedAt, data: { outputPath: result.outputPath } });
      return;
    }
    spinner?.succeed(chalk.green("Vocals isolated"));
    console.log(chalk.green(`Saved to: ${result.outputPath}`));
  });

// ── audio clone-voice ──────────────────────────────────────────────────
// Renamed from `voice-clone` in v0.74 for verb-first consistency. The
// `voice-clone` alias was removed in v0.75.

audioCommand
  .command("clone-voice")
  .description("Clone a voice from audio samples using ElevenLabs (requires explicit consent)")
  .argument("[samples...]", "Audio sample files (1-25 files)")
  .option("-k, --api-key <key>", "ElevenLabs API key (or set ELEVENLABS_API_KEY env)")
  .option("--name <name>", "Voice name (required)")
  .option("-d, --description <desc>", "Voice description")
  .option("--labels <json>", 'Labels as JSON (e.g., \'{"accent": "american"}\')')
  .option("--remove-noise", "Remove background noise from samples")
  .option("--list", "List all available voices")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (samples: string[], options) => {
    const startedAt = Date.now();
    if (options.dryRun) {
      outputSuccess({
        command: "audio clone-voice",
        startedAt,
        dryRun: true,
        data: { params: { samples: samples?.length, name: options.name } },
      });
      return;
    }
    const apiKey = await requireApiKey("ELEVENLABS_API_KEY", "ElevenLabs", options.apiKey);

    if (options.list) {
      const elevenlabs = new ElevenLabsProvider();
      await elevenlabs.initialize({ apiKey });
      const spinner = ora("Fetching voices...").start();
      const voices = await elevenlabs.getVoices();
      spinner.succeed(chalk.green(`Found ${voices.length} voices`));
      console.log();
      console.log(chalk.bold.cyan("Available Voices"));
      console.log(chalk.dim("─".repeat(60)));
      for (const voice of voices) {
        console.log(`${chalk.bold(voice.name)} ${chalk.dim(`(${voice.category})`)}`);
        console.log(`  ${chalk.dim("ID:")} ${voice.voice_id}`);
        if (voice.labels && Object.keys(voice.labels).length > 0) {
          console.log(`  ${chalk.dim("Labels:")} ${JSON.stringify(voice.labels)}`);
        }
        console.log();
      }
      return;
    }

    if (!options.name) exitWithError(usageError("Voice name is required. Use --name <name>"));
    rejectControlChars(options.name);
    if (!samples || samples.length === 0) exitWithError(usageError("At least one audio sample is required"));
    for (const samplePath of samples) {
      if (!existsSync(resolve(process.cwd(), samplePath))) exitWithError(notFoundError(samplePath));
    }
    let labels: Record<string, string> | undefined;
    try {
      labels = options.labels ? JSON.parse(options.labels) : undefined;
    } catch {
      exitWithError(usageError(`--labels is not valid JSON: ${options.labels}`));
    }

    const spinner = isJsonMode() ? null : ora(`Cloning voice from ${samples.length} sample(s)...`).start();
    const result = await executeVoiceClone({
      samplePaths: samples,
      name: options.name,
      description: options.description,
      labels,
      removeNoise: options.removeNoise,
      apiKey,
    });
    if (!result.success) {
      spinner?.fail(result.error ?? "Voice cloning failed");
      exitWithError(providerFailure(result.error ?? "Voice cloning failed", result.errorKind));
    }
    if (isJsonMode()) {
      outputSuccess({ command: "audio clone-voice", startedAt, data: { name: options.name, voiceId: result.voiceId } });
      return;
    }
    spinner?.succeed(chalk.green("Voice cloned successfully"));
    console.log();
    console.log(chalk.bold.cyan("Voice Details"));
    console.log(chalk.dim("─".repeat(60)));
    console.log(`Name: ${chalk.bold(options.name)}`);
    console.log(`Voice ID: ${chalk.bold(result.voiceId)}`);
    console.log();
    console.log(chalk.dim("Use this voice with:"));
    console.log(chalk.dim(`  vibe generate narration "Hello world" -p elevenlabs --voice ${result.voiceId}`));
  });

// ── audio dub ──────────────────────────────────────────────────────────

audioCommand
  .command("dub")
  .description("Dub audio/video to another language (transcribe, translate, TTS)")
  .argument("<media>", "Input media file (video or audio)")
  .option("-l, --language <lang>", "Target language code (e.g., es, ko, ja) (required)")
  .option("--source <lang>", "Source language code (default: auto-detect)")
  .option("--voice <id>", "ElevenLabs voice ID for output")
  .option("--analyze-only", "Only analyze and show timing, don't generate audio")
  .option("-o, --output <path>", "Output file path")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (mediaPath: string, options) => {
    const startedAt = Date.now();
    if (options.dryRun) {
      outputSuccess({
        command: "audio dub",
        startedAt,
        dryRun: true,
        data: { params: { mediaPath, targetLanguage: options.language, sourceLanguage: options.source, voice: options.voice } },
      });
      return;
    }
    if (options.output) validateOutputPath(options.output);
    if (!options.language) exitWithError(usageError("Target language is required. Use -l or --language"));
    if (!existsSync(resolve(process.cwd(), mediaPath))) exitWithError(notFoundError(mediaPath));
    // Ask for every key up front, so a run never fails halfway for a missing one.
    await requireApiKey("OPENAI_API_KEY", "OpenAI");
    await requireApiKey("ANTHROPIC_API_KEY", "Anthropic");
    if (!options.analyzeOnly) await requireApiKey("ELEVENLABS_API_KEY", "ElevenLabs");

    const spinner = isJsonMode() ? null : ora("Transcribing, translating, and dubbing...").start();
    const result = await executeDub({
      mediaPath,
      language: options.language,
      source: options.source,
      voice: options.voice,
      analyzeOnly: options.analyzeOnly,
      output: options.output,
    });
    if (!result.success) {
      spinner?.fail("Dubbing failed");
      exitWithError(providerFailure(result.error ?? "Dubbing failed", result.errorKind));
    }
    if (isJsonMode()) {
      outputSuccess({
        command: "audio dub",
        startedAt,
        data: {
          sourceLanguage: result.sourceLanguage,
          targetLanguage: result.targetLanguage,
          segmentCount: result.segmentCount,
          segments: result.segments,
          outputPath: result.outputPath,
        },
      });
      return;
    }
    spinner?.succeed(chalk.green(options.analyzeOnly ? "Transcription and translation complete" : "Dubbing complete"));
    console.log();
    console.log(chalk.bold.cyan("Dubbing Analysis"));
    console.log(chalk.dim("─".repeat(60)));
    console.log(`Source language: ${result.sourceLanguage}`);
    console.log(`Target language: ${result.targetLanguage}`);
    console.log(`Segments: ${result.segmentCount}`);
    console.log();
    for (const seg of (result.segments ?? []).slice(0, 5)) {
      console.log(`${chalk.dim(`[${formatTime(seg.startTime)} - ${formatTime(seg.endTime)}]`)} ${seg.original}`);
      console.log(`${chalk.dim("           →")} ${chalk.green(seg.translated)}`);
      console.log();
    }
    if ((result.segmentCount ?? 0) > 5) console.log(chalk.dim(`... and ${(result.segmentCount ?? 0) - 5} more segments`));
    if (options.analyzeOnly) {
      console.log(chalk.dim("Use without --analyze-only to generate dubbed audio"));
      if (result.outputPath) console.log(`Timing saved to: ${chalk.bold(result.outputPath)}`);
      return;
    }
    console.log(`Saved to: ${chalk.bold(result.outputPath)}`);
  });

// ── audio duck ─────────────────────────────────────────────────────────

audioCommand
  .command("duck")
  .description("Auto-duck background music when voice is present (FFmpeg)")
  .argument("<music>", "Background music file path")
  .option("--voice <path>", "Voice/narration track (required)")
  .option("-o, --output <path>", "Output audio file path")
  .option("--threshold <dB>", "Sidechain threshold in dB", "-30")
  .option("-r, --ratio <ratio>", "Compression ratio", "3")
  .option("-a, --attack <ms>", "Attack time in ms", "20")
  .option("-l, --release <ms>", "Release time in ms", "200")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (musicPath: string, options) => {
    const startedAt = Date.now();
    try {
      if (options.dryRun) {
        const threshold = parseFloat(options.threshold);
        const ratio = parseFloat(options.ratio);
        const attack = parseFloat(options.attack);
        const release = parseFloat(options.release);
        outputSuccess({
          command: "audio duck",
          startedAt,
          dryRun: true,
          data: {
            params: { musicPath, voicePath: options.voice, threshold, ratio, attack, release },
          },
        });
        return;
      }

      if (options.output) {
        validateOutputPath(options.output);
      }

      if (!options.voice) {
        exitWithError(usageError("Voice track required. Use --voice <path>"));
      }

      // Check FFmpeg availability
      if (!commandExists("ffmpeg")) {
        exitWithError(
          generalError(
            "FFmpeg not found",
            "Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)"
          )
        );
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

      await execSafe("ffmpeg", [
        "-i",
        absMusic,
        "-i",
        absVoice,
        "-filter_complex",
        filterComplex,
        "-map",
        "[out]",
        outputPath,
        "-y",
      ]);

      spinner.succeed(chalk.green("Audio ducking complete"));

      if (isJsonMode()) {
        outputSuccess({
          command: "audio duck",
          startedAt,
          data: {
            musicPath: absMusic,
            voicePath: options.voice,
            threshold: thresholdDb,
            ratio,
            outputPath,
          },
        });
        return;
      }

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
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Audio ducking failed: ${msg}`));
    }
  });

// Cost-tier annotations for schema/help output.
applyTiers(audioCommand, {
  transcribe: "low",
  "list-voices": "low",
  isolate: "low",
  "clone-voice": "low",
  dub: "high",
  duck: "free",
});
