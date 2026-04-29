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
import { resolve, dirname, basename, extname } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import {
  WhisperProvider,
  ElevenLabsProvider,
  ClaudeProvider,
} from "@vibeframe/ai-providers";
import { getApiKey, requireApiKey } from "../utils/api-key.js";
import { execSafe, commandExists, execSafeSync } from "../utils/exec-safe.js";
import { detectFormat, formatTranscript } from "../utils/subtitle.js";
import { formatTime } from "./ai-helpers.js";
import { isJsonMode, outputSuccess, exitWithError, notFoundError, usageError, apiError, generalError } from "./output.js";
import { rejectControlChars, validateOutputPath } from "./validate.js";

export const audioCommand = new Command("audio")
  .alias("au")
  .description("Audio operations (transcribe, TTS, voice clone, ducking)")
  .addHelpText(
    "after",
    `
Examples:
  $ vibe audio transcribe interview.mp3 -o transcript.srt -f srt
  $ vibe audio transcribe video.mp4 -l ko                  # Specify language
  $ vibe audio list-voices                                  # List available voices
  $ vibe audio isolate song.mp3 -o vocals.mp3
  $ vibe audio clone-voice sample.mp3 -n "my-voice"
  $ vibe audio dub video.mp4 -l ko -o dubbed.mp4
  $ vibe audio duck music.mp3 --voice narration.mp3 -o ducked.mp3

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
    try {
      if (options.output) {
        validateOutputPath(options.output);
      }

      const apiKey = await requireApiKey("OPENAI_API_KEY", "OpenAI", options.apiKey);

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

      if (isJsonMode()) {
        outputSuccess({
          command: "audio transcribe",
          startedAt,
          data: {
            fullText: result.fullText,
            segments: result.segments,
            language: result.detectedLanguage,
            outputPath: options.output ? resolve(process.cwd(), options.output) : undefined,
          },
        });
        return;
      }

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
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(apiError(`Transcription failed: ${msg}`, true));
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
            voices: voices.map(v => ({ name: v.name, voiceId: v.voice_id, category: v.category, labels: v.labels })),
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
    try {
      if (options.dryRun) {
        outputSuccess({
          command: "audio isolate",
          startedAt,
          dryRun: true,
          data: { params: { audioPath } },
        });
        return;
      }

      if (options.output) {
        validateOutputPath(options.output);
      }

      const apiKey = await requireApiKey("ELEVENLABS_API_KEY", "ElevenLabs", options.apiKey);

      const spinner = ora("Reading audio file...").start();

      const absPath = resolve(process.cwd(), audioPath);
      const audioBuffer = await readFile(absPath);

      spinner.text = "Isolating vocals...";

      const elevenlabs = new ElevenLabsProvider();
      await elevenlabs.initialize({ apiKey });

      const result = await elevenlabs.isolateVocals(audioBuffer);

      if (!result.success || !result.audioBuffer) {
        spinner.fail(result.error || "Audio isolation failed");
        exitWithError(apiError(result.error || "Audio isolation failed", true));
      }

      const outputPath = resolve(process.cwd(), options.output);
      await writeFile(outputPath, result.audioBuffer);

      spinner.succeed(chalk.green("Vocals isolated"));

      if (isJsonMode()) {
        outputSuccess({
          command: "audio isolate",
          startedAt,
          data: { outputPath },
        });
        return;
      }

      console.log(chalk.green(`Saved to: ${outputPath}`));
      console.log();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(apiError(`Audio isolation failed: ${msg}`, true));
    }
  });

// ── audio clone-voice ──────────────────────────────────────────────────
// Renamed from `voice-clone` in v0.74 for verb-first consistency. The
// `voice-clone` alias was removed in v0.75.

audioCommand
  .command("clone-voice")
  .description("Clone a voice from audio samples using ElevenLabs")
  .argument("[samples...]", "Audio sample files (1-25 files)")
  .option("-k, --api-key <key>", "ElevenLabs API key (or set ELEVENLABS_API_KEY env)")
  .option("--name <name>", "Voice name (required)")
  .option("-d, --description <desc>", "Voice description")
  .option("--labels <json>", "Labels as JSON (e.g., '{\"accent\": \"american\"}')")
  .option("--remove-noise", "Remove background noise from samples")
  .option("--list", "List all available voices")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (samples: string[], options) => {
    const startedAt = Date.now();
    try {
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

      rejectControlChars(options.name);

      if (!samples || samples.length === 0) {
        exitWithError(usageError("At least one audio sample is required"));
      }

      const spinner = ora("Reading audio samples...").start();

      const audioBuffers: Buffer[] = [];
      for (const samplePath of samples) {
        const absPath = resolve(process.cwd(), samplePath);
        if (!existsSync(absPath)) {
          spinner.fail(`File not found: ${samplePath}`);
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
        spinner.fail(result.error || "Voice cloning failed");
        exitWithError(apiError(result.error || "Voice cloning failed", true));
      }

      spinner.succeed(chalk.green("Voice cloned successfully"));

      if (isJsonMode()) {
        outputSuccess({
          command: "audio clone-voice",
          startedAt,
          data: { name: options.name, voiceId: result.voiceId },
        });
        return;
      }

      console.log();
      console.log(chalk.bold.cyan("Voice Details"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Name: ${chalk.bold(options.name)}`);
      console.log(`Voice ID: ${chalk.bold(result.voiceId)}`);
      console.log();
      console.log(chalk.dim("Use this voice ID with:"));
      console.log(chalk.dim(`  pnpm vibe audio tts "Hello world" -v ${result.voiceId}`));
      console.log();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(apiError(`Voice cloning failed: ${msg}`, true));
    }
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
    try {
      if (options.dryRun) {
        outputSuccess({
          command: "audio dub",
          startedAt,
          dryRun: true,
          data: { params: { mediaPath, targetLanguage: options.language, sourceLanguage: options.source, voice: options.voice } },
        });
        return;
      }

      if (options.output) {
        validateOutputPath(options.output);
      }

      if (!options.language) {
        exitWithError(usageError("Target language is required. Use -l or --language"));
      }

      const absPath = resolve(process.cwd(), mediaPath);
      if (!existsSync(absPath)) {
        exitWithError(notFoundError(mediaPath));
      }

      // Check required API keys
      const openaiKey = await requireApiKey("OPENAI_API_KEY", "OpenAI");
      const anthropicKey = await requireApiKey("ANTHROPIC_API_KEY", "Anthropic");
      const elevenlabsKey = options.analyzeOnly
        ? await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs", undefined)
        : await requireApiKey("ELEVENLABS_API_KEY", "ElevenLabs");

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
        } catch {
          spinner.fail("Failed to extract audio from video");
          exitWithError(generalError("Failed to extract audio from video", "Ensure FFmpeg is installed."));
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

      let translatedSegments: Array<{ index: number; text: string; startTime: number; endTime: number }> = [];

      try {
        const storyboard = await claude.analyzeContent(
          `TRANSLATE to ${targetLangName}. Return the translated text only, preserving segment numbers:\n\n${segmentTexts}`,
          segments[segments.length - 1]?.endTime || 60
        );

        if (storyboard && storyboard.length > 0) {
          translatedSegments = segments.map((s, i) => ({
            index: i,
            text: storyboard[i]?.description || s.text,
            startTime: s.startTime,
            endTime: s.endTime,
          }));
        } else {
          translatedSegments = segments.map((s, i) => ({
            index: i,
            text: s.text,
            startTime: s.startTime,
            endTime: s.endTime,
          }));
        }
      } catch {
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

      const combinedBuffer = Buffer.concat(dubbedAudioBuffers.map((a) => a.buffer));

      const outputExt = isVideo ? ".mp3" : extname(absPath);
      const defaultOutputPath = resolve(
        dirname(absPath),
        `${basename(absPath, extname(absPath))}-${options.language}${outputExt}`
      );
      const finalOutputPath = resolve(process.cwd(), options.output || defaultOutputPath);

      await writeFile(finalOutputPath, combinedBuffer);

      spinner.succeed(chalk.green("Dubbing complete"));

      if (isJsonMode()) {
        outputSuccess({
          command: "audio dub",
          startedAt,
          data: {
            sourceLanguage: transcriptResult.detectedLanguage || options.source || "auto",
            targetLanguage: options.language,
            segmentCount: translatedSegments.length,
            outputPath: finalOutputPath,
          },
        });
        return;
      }

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
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(apiError(`Dubbing failed: ${msg}`, true));
    }
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
          data: { params: { musicPath, voicePath: options.voice, threshold, ratio, attack, release } },
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
        exitWithError(generalError("FFmpeg not found", "Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)"));
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

      if (isJsonMode()) {
        outputSuccess({
          command: "audio duck",
          startedAt,
          data: { musicPath: absMusic, voicePath: options.voice, threshold: thresholdDb, ratio, outputPath },
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
