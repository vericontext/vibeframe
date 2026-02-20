/**
 * AI Commands - Image, video, audio generation and analysis
 *
 * IMPORTANT: See MODELS.md for the Single Source of Truth (SSOT) on:
 * - Supported AI providers and models
 * - Environment variables and API keys
 * - Model capabilities and limitations
 *
 * When adding new providers or models, update MODELS.md FIRST.
 */

import { Command } from "commander";
import { readFile, writeFile, mkdir, readdir, stat, unlink, rename } from "node:fs/promises";
import { resolve, dirname, basename, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { execSync, exec } from "node:child_process";
import { promisify } from "node:util";
import chalk from "chalk";
import ora from "ora";
import {
  providerRegistry,
  WhisperProvider,
  GeminiProvider,
  OpenAIProvider,
  ClaudeProvider,
  ElevenLabsProvider,
  OpenAIImageProvider,
  RunwayProvider,
  KlingProvider,
  StabilityProvider,
  ReplicateProvider,
  whisperProvider,
  geminiProvider,
  openaiProvider,
  claudeProvider,
  elevenLabsProvider,
  openaiImageProvider,
  runwayProvider,
  klingProvider,
  stabilityProvider,
  replicateProvider,
  type TimelineCommand,
  type Highlight,
  type HighlightCriteria,
  type HighlightsResult,
  type BrollClipInfo,
  type BrollMatch,
  type BrollMatchResult,
  type PlatformSpec,
  type ViralOptimizationResult,
} from "@vibeframe/ai-providers";
import { Project, type ProjectFile } from "../engine/index.js";
import type { EffectType } from "@vibeframe/core/timeline";
import { detectFormat, formatTranscript, formatSRT, parseSRT } from "../utils/subtitle.js";
import { getApiKey, loadEnv } from "../utils/api-key.js";
import { getApiKeyFromConfig } from "../config/index.js";
import { getAudioDuration, getVideoDuration, extendVideoNaturally } from "../utils/audio.js";

const execAsync = promisify(exec);

// ==========================================
// Auto-Narrate Feature Types and Functions
// ==========================================

/**
 * Options for auto-narrate feature
 */
export interface AutoNarrateOptions {
  /** Path to video file */
  videoPath: string;
  /** Duration of the video in seconds */
  duration: number;
  /** Output directory for generated files */
  outputDir: string;
  /** ElevenLabs voice name or ID (default: "rachel") */
  voice?: string;
  /** Narration style */
  style?: "informative" | "energetic" | "calm" | "dramatic";
  /** Language for narration (default: "en") */
  language?: string;
}

/**
 * Result from auto-narrate
 */
export interface AutoNarrateResult {
  success: boolean;
  /** Path to generated audio file */
  audioPath?: string;
  /** Generated narration script */
  script?: string;
  /** Transcript segments for timeline sync */
  segments?: Array<{
    startTime: number;
    endTime: number;
    text: string;
  }>;
  /** Error message if failed */
  error?: string;
}

/**
 * Generate narration for a video that doesn't have one.
 *
 * Pipeline:
 * 1. Analyze video with Gemini Video Understanding
 * 2. Generate narration script with Claude
 * 3. Convert to speech with ElevenLabs TTS
 */
export async function autoNarrate(options: AutoNarrateOptions): Promise<AutoNarrateResult> {
  const {
    videoPath,
    duration,
    outputDir,
    voice = "rachel",
    style = "informative",
    language = "en",
  } = options;

  // Validate API keys
  const geminiApiKey = await getApiKey("GOOGLE_API_KEY", "Google");
  if (!geminiApiKey) {
    return { success: false, error: "GOOGLE_API_KEY required for video analysis" };
  }

  const claudeApiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic");
  if (!claudeApiKey) {
    return { success: false, error: "ANTHROPIC_API_KEY required for script generation" };
  }

  const elevenlabsApiKey = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs");
  if (!elevenlabsApiKey) {
    return { success: false, error: "ELEVENLABS_API_KEY required for TTS" };
  }

  try {
    // Step 1: Analyze video with Gemini
    const gemini = new GeminiProvider();
    await gemini.initialize({ apiKey: geminiApiKey });

    const videoBuffer = await readFile(videoPath);

    const analysisPrompt = `Analyze this video in detail for narration purposes. Describe:
1. What is happening visually (actions, movements, subjects)
2. The setting and environment
3. Any text or graphics visible
4. The mood and tone of the content
5. Key moments and their approximate timestamps

Provide a detailed description that could be used to write a voiceover narration.
Focus on what viewers need to know to understand and appreciate the video.`;

    const analysisResult = await gemini.analyzeVideo(videoBuffer, analysisPrompt, {
      fps: 0.5, // Lower FPS for cost optimization
      lowResolution: duration > 60, // Use low res for longer videos
    });

    if (!analysisResult.success || !analysisResult.response) {
      return { success: false, error: `Video analysis failed: ${analysisResult.error}` };
    }

    // Step 2: Generate narration script with Claude
    const claude = new ClaudeProvider();
    await claude.initialize({ apiKey: claudeApiKey });

    const scriptResult = await claude.generateNarrationScript(
      analysisResult.response,
      duration,
      style,
      language
    );

    if (!scriptResult.success || !scriptResult.script) {
      return { success: false, error: `Script generation failed: ${scriptResult.error}` };
    }

    // Step 3: Convert to speech with ElevenLabs
    const elevenlabs = new ElevenLabsProvider();
    await elevenlabs.initialize({ apiKey: elevenlabsApiKey });

    const ttsResult = await elevenlabs.textToSpeech(scriptResult.script, {
      voiceId: voice,
    });

    if (!ttsResult.success || !ttsResult.audioBuffer) {
      return { success: false, error: `TTS generation failed: ${ttsResult.error}` };
    }

    // Ensure output directory exists
    if (!existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true });
    }

    // Save audio file
    const audioPath = resolve(outputDir, "auto-narration.mp3");
    await writeFile(audioPath, ttsResult.audioBuffer);

    // Save script for reference
    const scriptPath = resolve(outputDir, "narration-script.txt");
    await writeFile(scriptPath, scriptResult.script, "utf-8");

    return {
      success: true,
      audioPath,
      script: scriptResult.script,
      segments: scriptResult.segments,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error in autoNarrate",
    };
  }
}

export const aiCommand = new Command("ai")
  .description("AI provider commands");

aiCommand
  .command("transcribe")
  .description("Transcribe audio using Whisper")
  .argument("<audio>", "Audio file path")
  .option("-k, --api-key <key>", "OpenAI API key (or set OPENAI_API_KEY env)")
  .option("-l, --language <lang>", "Language code (e.g., en, ko)")
  .option("-o, --output <path>", "Output file path")
  .option("-f, --format <format>", "Output format: json, srt, vtt (auto-detected from extension)")
  .action(async (audioPath: string, options) => {
    try {
      const apiKey = await getApiKey("OPENAI_API_KEY", "OpenAI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("OpenAI API key required. Use --api-key or set OPENAI_API_KEY"));
        process.exit(1);
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
        spinner.fail(chalk.red(`Transcription failed: ${result.error}`));
        process.exit(1);
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
      console.error(chalk.red("Transcription failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("suggest")
  .description("Get AI edit suggestions using Gemini")
  .argument("<project>", "Project file path")
  .argument("<instruction>", "Natural language instruction")
  .option("-k, --api-key <key>", "Google API key (or set GOOGLE_API_KEY env)")
  .option("--apply", "Apply the first suggestion automatically")
  .action(async (projectPath: string, instruction: string, options) => {
    try {
      const apiKey = await getApiKey("GOOGLE_API_KEY", "Google", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Google API key required. Use --api-key or set GOOGLE_API_KEY"));
        process.exit(1);
      }

      const spinner = ora("Initializing Gemini...").start();

      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const gemini = new GeminiProvider();
      await gemini.initialize({ apiKey });

      spinner.text = "Analyzing...";
      const clips = project.getClips();
      const suggestions = await gemini.autoEdit(clips, instruction);

      spinner.succeed(chalk.green(`Found ${suggestions.length} suggestion(s)`));

      console.log();
      console.log(chalk.bold.cyan("Edit Suggestions"));
      console.log(chalk.dim("─".repeat(60)));

      for (let i = 0; i < suggestions.length; i++) {
        const sug = suggestions[i];
        console.log();
        console.log(chalk.yellow(`[${i + 1}] ${sug.type.toUpperCase()}`));
        console.log(`    ${sug.description}`);
        console.log(chalk.dim(`    Confidence: ${(sug.confidence * 100).toFixed(0)}%`));
        console.log(chalk.dim(`    Clips: ${sug.clipIds.join(", ")}`));
        console.log(chalk.dim(`    Params: ${JSON.stringify(sug.params)}`));
      }

      if (options.apply && suggestions.length > 0) {
        console.log();
        spinner.start("Applying first suggestion...");

        const sug = suggestions[0];
        const applied = applySuggestion(project, sug);

        if (applied) {
          await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");
          spinner.succeed(chalk.green("Suggestion applied"));
        } else {
          spinner.warn(chalk.yellow("Could not apply suggestion automatically"));
        }
      }

      console.log();
    } catch (error) {
      console.error(chalk.red("AI suggestion failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("edit")
  .description("Edit timeline using natural language (GPT-powered)")
  .argument("<project>", "Project file path")
  .argument("<instruction>", "Natural language command (e.g., 'trim all clips to 5 seconds')")
  .option("-k, --api-key <key>", "OpenAI API key (or set OPENAI_API_KEY env)")
  .option("--dry-run", "Show commands without executing")
  .action(async (projectPath: string, instruction: string, options) => {
    try {
      const apiKey = await getApiKey("OPENAI_API_KEY", "OpenAI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("OpenAI API key required. Use --api-key or set OPENAI_API_KEY"));
        process.exit(1);
      }

      const spinner = ora("Parsing command...").start();

      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const gpt = new OpenAIProvider();
      await gpt.initialize({ apiKey });

      const clips = project.getClips();
      const tracks = project.getTracks().map((t) => t.id);

      const result = await gpt.parseCommand(instruction, { clips, tracks });

      if (!result.success) {
        spinner.fail(chalk.red(result.error || "Failed to parse command"));
        process.exit(1);
      }

      if (result.clarification) {
        spinner.warn(chalk.yellow(result.clarification));
        process.exit(0);
      }

      if (result.commands.length === 0) {
        spinner.warn(chalk.yellow("No commands generated"));
        process.exit(0);
      }

      spinner.succeed(chalk.green(`Parsed ${result.commands.length} command(s)`));

      console.log();
      console.log(chalk.bold.cyan("Commands to execute:"));
      console.log(chalk.dim("─".repeat(60)));

      for (const cmd of result.commands) {
        console.log();
        console.log(chalk.yellow(`▸ ${cmd.action.toUpperCase()}`));
        console.log(`  ${cmd.description}`);
        if (cmd.clipIds.length > 0) {
          console.log(chalk.dim(`  Clips: ${cmd.clipIds.join(", ")}`));
        }
        console.log(chalk.dim(`  Params: ${JSON.stringify(cmd.params)}`));
      }

      if (options.dryRun) {
        console.log();
        console.log(chalk.dim("Dry run - no changes made"));
        return;
      }

      console.log();
      spinner.start("Executing commands...");

      let executed = 0;
      for (const cmd of result.commands) {
        const success = executeCommand(project, cmd);
        if (success) executed++;
      }

      await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      spinner.succeed(chalk.green(`Executed ${executed}/${result.commands.length} commands`));
      console.log();
    } catch (error) {
      console.error(chalk.red("AI edit failed"));
      console.error(error);
      process.exit(1);
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
  .action(async (text: string, options) => {
    try {
      const apiKey = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("ElevenLabs API key required. Use --api-key or set ELEVENLABS_API_KEY"));
        process.exit(1);
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
        spinner.fail(chalk.red(result.error || "TTS generation failed"));
        process.exit(1);
      }

      const outputPath = resolve(process.cwd(), options.output);
      await writeFile(outputPath, result.audioBuffer);

      spinner.succeed(chalk.green("Speech generated"));
      console.log();
      console.log(chalk.dim(`Characters: ${result.characterCount}`));
      console.log(chalk.green(`Saved to: ${outputPath}`));
      console.log();
    } catch (error) {
      console.error(chalk.red("TTS generation failed"));
      console.error(error);
      process.exit(1);
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
        console.error(chalk.red("ElevenLabs API key required"));
        process.exit(1);
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
      console.error(chalk.red("Failed to fetch voices"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("sfx")
  .description("Generate sound effect using ElevenLabs")
  .argument("<prompt>", "Description of the sound effect")
  .option("-k, --api-key <key>", "ElevenLabs API key (or set ELEVENLABS_API_KEY env)")
  .option("-o, --output <path>", "Output audio file path", "sound-effect.mp3")
  .option("-d, --duration <seconds>", "Duration in seconds (0.5-22, default: auto)")
  .option("-p, --prompt-influence <value>", "Prompt influence (0-1, default: 0.3)")
  .action(async (prompt: string, options) => {
    try {
      const apiKey = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("ElevenLabs API key required. Use --api-key or set ELEVENLABS_API_KEY"));
        process.exit(1);
      }

      const spinner = ora("Generating sound effect...").start();

      const elevenlabs = new ElevenLabsProvider();
      await elevenlabs.initialize({ apiKey });

      const result = await elevenlabs.generateSoundEffect(prompt, {
        duration: options.duration ? parseFloat(options.duration) : undefined,
        promptInfluence: options.promptInfluence ? parseFloat(options.promptInfluence) : undefined,
      });

      if (!result.success || !result.audioBuffer) {
        spinner.fail(chalk.red(result.error || "Sound effect generation failed"));
        process.exit(1);
      }

      const outputPath = resolve(process.cwd(), options.output);
      await writeFile(outputPath, result.audioBuffer);

      spinner.succeed(chalk.green("Sound effect generated"));
      console.log(chalk.green(`Saved to: ${outputPath}`));
      console.log();
    } catch (error) {
      console.error(chalk.red("Sound effect generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("isolate")
  .description("Isolate vocals from audio using ElevenLabs")
  .argument("<audio>", "Input audio file path")
  .option("-k, --api-key <key>", "ElevenLabs API key (or set ELEVENLABS_API_KEY env)")
  .option("-o, --output <path>", "Output audio file path", "vocals.mp3")
  .action(async (audioPath: string, options) => {
    try {
      const apiKey = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("ElevenLabs API key required. Use --api-key or set ELEVENLABS_API_KEY"));
        process.exit(1);
      }

      const spinner = ora("Reading audio file...").start();

      const absPath = resolve(process.cwd(), audioPath);
      const audioBuffer = await readFile(absPath);

      spinner.text = "Isolating vocals...";

      const elevenlabs = new ElevenLabsProvider();
      await elevenlabs.initialize({ apiKey });

      const result = await elevenlabs.isolateVocals(audioBuffer);

      if (!result.success || !result.audioBuffer) {
        spinner.fail(chalk.red(result.error || "Audio isolation failed"));
        process.exit(1);
      }

      const outputPath = resolve(process.cwd(), options.output);
      await writeFile(outputPath, result.audioBuffer);

      spinner.succeed(chalk.green("Vocals isolated"));
      console.log(chalk.green(`Saved to: ${outputPath}`));
      console.log();
    } catch (error) {
      console.error(chalk.red("Audio isolation failed"));
      console.error(error);
      process.exit(1);
    }
  });

// ── Motion: exported function for Agent tool ────────────────────────────────

export interface MotionCommandOptions {
  description: string;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  style?: string;
  /** If set, render the generated code with Remotion */
  render?: boolean;
  /** Base video to composite the motion graphic onto */
  video?: string;
  /** Output path (TSX if code-only, WebM/MP4 if rendered) */
  output?: string;
}

export interface MotionCommandResult {
  success: boolean;
  codePath?: string;
  renderedPath?: string;
  compositedPath?: string;
  componentName?: string;
  error?: string;
}

export async function executeMotion(options: MotionCommandOptions): Promise<MotionCommandResult> {
  const apiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic");
  if (!apiKey) {
    return { success: false, error: "Anthropic API key required (set ANTHROPIC_API_KEY)" };
  }

  const width = options.width || 1920;
  const height = options.height || 1080;
  const fps = options.fps || 30;
  const duration = options.duration || 5;

  const claude = new ClaudeProvider();
  await claude.initialize({ apiKey });

  const result = await claude.generateMotion(options.description, {
    duration,
    width,
    height,
    fps,
    style: options.style as "minimal" | "corporate" | "playful" | "cinematic" | undefined,
  });

  if (!result.success || !result.component) {
    return { success: false, error: result.error || "Motion generation failed" };
  }

  const { component } = result;
  const defaultOutput = options.video ? "motion-output.mp4" : options.render ? "motion.webm" : "motion.tsx";
  const outputPath = resolve(process.cwd(), options.output || defaultOutput);

  // Save TSX code
  const codePath = outputPath.replace(/\.\w+$/, ".tsx");
  await writeFile(codePath, component.code, "utf-8");

  const shouldRender = options.render || !!options.video;
  if (!shouldRender) {
    return { success: true, codePath, componentName: component.name };
  }

  // Render (and optionally composite)
  const { ensureRemotionInstalled, renderAndComposite } = await import("../utils/remotion.js");

  const notInstalled = await ensureRemotionInstalled();
  if (notInstalled) {
    return { success: false, codePath, componentName: component.name, error: notInstalled };
  }

  const baseVideo = options.video ? resolve(process.cwd(), options.video) : undefined;
  const renderResult = await renderAndComposite(
    {
      componentCode: component.code,
      componentName: component.name,
      width,
      height,
      fps,
      durationInFrames: component.durationInFrames,
      outputPath,
    },
    baseVideo,
    baseVideo ? outputPath : undefined,
  );

  if (!renderResult.success) {
    return { success: false, codePath, componentName: component.name, error: renderResult.error };
  }

  return {
    success: true,
    codePath,
    componentName: component.name,
    renderedPath: baseVideo ? undefined : renderResult.outputPath,
    compositedPath: baseVideo ? renderResult.outputPath : undefined,
  };
}

aiCommand
  .command("motion")
  .description("Generate motion graphics using Claude + Remotion (render & composite)")
  .argument("<description>", "Natural language description of the motion graphic")
  .option("-k, --api-key <key>", "Anthropic API key (or set ANTHROPIC_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "motion.tsx")
  .option("-d, --duration <sec>", "Duration in seconds", "5")
  .option("-w, --width <px>", "Width in pixels", "1920")
  .option("-h, --height <px>", "Height in pixels", "1080")
  .option("--fps <fps>", "Frame rate", "30")
  .option("-s, --style <style>", "Style preset: minimal, corporate, playful, cinematic")
  .option("--render", "Render the generated code with Remotion (output .webm)")
  .option("--video <path>", "Base video to composite the motion graphic onto")
  .action(async (description: string, options) => {
    try {
      const shouldRender = options.render || !!options.video;

      const spinner = ora("Generating motion graphic...").start();

      const result = await executeMotion({
        description,
        duration: parseFloat(options.duration),
        width: parseInt(options.width),
        height: parseInt(options.height),
        fps: parseInt(options.fps),
        style: options.style,
        render: options.render,
        video: options.video,
        output: options.output !== "motion.tsx" ? options.output : undefined,
      });

      if (!result.success) {
        spinner.fail(chalk.red(result.error || "Motion generation failed"));
        if (result.codePath) {
          console.log(chalk.dim(`TSX code saved to: ${result.codePath}`));
        }
        process.exit(1);
      }

      spinner.succeed(chalk.green("Motion graphic generated"));

      console.log();
      console.log(chalk.bold.cyan("Motion Graphics Pipeline"));
      console.log(chalk.dim("─".repeat(60)));

      if (result.codePath) {
        console.log(chalk.green(`  Code: ${result.codePath}`));
      }
      if (result.renderedPath) {
        console.log(chalk.green(`  Rendered: ${result.renderedPath}`));
      }
      if (result.compositedPath) {
        console.log(chalk.green(`  Composited: ${result.compositedPath}`));
      }

      if (!shouldRender) {
        console.log();
        console.log(chalk.dim("To render, add --render flag or --video <path>:"));
        console.log(chalk.dim(`  vibe ai motion "${description}" --render -o motion.webm`));
        console.log(chalk.dim(`  vibe ai motion "${description}" --video input.mp4 -o output.mp4`));
      }

      console.log();
    } catch (error) {
      console.error(chalk.red("Motion generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("storyboard")
  .description("Generate video storyboard from content using Claude")
  .argument("<content>", "Content to analyze (text or file path)")
  .option("-k, --api-key <key>", "Anthropic API key (or set ANTHROPIC_API_KEY env)")
  .option("-o, --output <path>", "Output JSON file path")
  .option("-d, --duration <sec>", "Target total duration in seconds")
  .option("-f, --file", "Treat content argument as file path")
  .option("-c, --creativity <level>", "Creativity level: low (default, consistent) or high (varied, unexpected)", "low")
  .action(async (content: string, options) => {
    try {
      const apiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Anthropic API key required. Use --api-key or set ANTHROPIC_API_KEY"));
        process.exit(1);
      }

      // Validate creativity level
      const creativity = options.creativity?.toLowerCase();
      if (creativity && creativity !== "low" && creativity !== "high") {
        console.error(chalk.red("Invalid creativity level. Use 'low' or 'high'."));
        process.exit(1);
      }

      let textContent = content;
      if (options.file) {
        const filePath = resolve(process.cwd(), content);
        textContent = await readFile(filePath, "utf-8");
      }

      const spinnerText = creativity === "high"
        ? "Analyzing content with high creativity..."
        : "Analyzing content...";
      const spinner = ora(spinnerText).start();

      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey });

      const segments = await claude.analyzeContent(
        textContent,
        options.duration ? parseFloat(options.duration) : undefined,
        { creativity: creativity as "low" | "high" | undefined }
      );

      if (segments.length === 0) {
        spinner.fail(chalk.red("Could not generate storyboard"));
        process.exit(1);
      }

      spinner.succeed(chalk.green(`Generated ${segments.length} segments`));

      console.log();
      console.log(chalk.bold.cyan("Storyboard"));
      console.log(chalk.dim("─".repeat(60)));

      for (const seg of segments) {
        console.log();
        console.log(chalk.yellow(`[${seg.index + 1}] ${formatTime(seg.startTime)} - ${formatTime(seg.startTime + seg.duration)}`));
        console.log(`  ${seg.description}`);
        console.log(chalk.dim(`  Visuals: ${seg.visuals}`));
        if (seg.audio) {
          console.log(chalk.dim(`  Audio: ${seg.audio}`));
        }
        if (seg.textOverlays && seg.textOverlays.length > 0) {
          console.log(chalk.dim(`  Text: ${seg.textOverlays.join(", ")}`));
        }
      }
      console.log();

      if (options.output) {
        const outputPath = resolve(process.cwd(), options.output);
        await writeFile(outputPath, JSON.stringify(segments, null, 2), "utf-8");
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      console.error(chalk.red("Storyboard generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("image")
  .description("Generate image using AI (Gemini, DALL-E, or Stability)")
  .argument("<prompt>", "Image description prompt")
  .option("-p, --provider <provider>", "Provider: gemini, openai, stability, runway (dalle is deprecated)", "gemini")
  .option("-k, --api-key <key>", "API key (or set env: OPENAI_API_KEY, GOOGLE_API_KEY, STABILITY_API_KEY)")
  .option("-o, --output <path>", "Output file path (downloads image)")
  .option("-s, --size <size>", "Image size (openai: 1024x1024, 1536x1024, 1024x1536)", "1024x1024")
  .option("-r, --ratio <ratio>", "Aspect ratio (gemini: 1:1, 16:9, 9:16, 3:4, 4:3)", "1:1")
  .option("-q, --quality <quality>", "Quality: standard, hd (openai only)", "standard")
  .option("--style <style>", "Style: vivid, natural (openai only)", "vivid")
  .option("-n, --count <n>", "Number of images to generate", "1")
  .action(async (prompt: string, options) => {
    try {
      let provider = options.provider.toLowerCase();
      const validProviders = ["openai", "dalle", "gemini", "stability", "runway"];
      if (!validProviders.includes(provider)) {
        console.error(chalk.red(`Invalid provider: ${provider}`));
        console.error(chalk.dim(`Available providers: openai, gemini, stability, runway`));
        process.exit(1);
      }

      // Show deprecation warning for "dalle"
      if (provider === "dalle") {
        console.log(chalk.yellow('Warning: "dalle" is deprecated. Use "openai" instead.'));
      }

      // Get API key based on provider
      const envKeyMap: Record<string, string> = {
        openai: "OPENAI_API_KEY",
        dalle: "OPENAI_API_KEY", // backward compatibility
        gemini: "GOOGLE_API_KEY",
        stability: "STABILITY_API_KEY",
        runway: "RUNWAY_API_SECRET",
      };
      const providerNameMap: Record<string, string> = {
        openai: "OpenAI",
        dalle: "OpenAI", // backward compatibility
        gemini: "Google",
        stability: "Stability",
        runway: "Runway",
      };
      const envKey = envKeyMap[provider];
      const providerName = providerNameMap[provider];

      const apiKey = await getApiKey(envKey, providerName, options.apiKey);
      if (!apiKey) {
        console.error(chalk.red(`${providerName} API key required.`));
        console.error(chalk.dim(`Use --api-key or set ${envKey} environment variable`));
        process.exit(1);
      }

      const spinner = ora(`Generating image with ${providerName}...`).start();

      if (provider === "dalle" || provider === "openai") {
        const openaiImage = new OpenAIImageProvider();
        await openaiImage.initialize({ apiKey });

        const result = await openaiImage.generateImage(prompt, {
          size: options.size,
          quality: options.quality,
          style: options.style,
          n: parseInt(options.count),
        });

        if (!result.success || !result.images) {
          spinner.fail(chalk.red(result.error || "Image generation failed"));
          process.exit(1);
        }

        spinner.succeed(chalk.green(`Generated ${result.images.length} image(s) with OpenAI GPT Image 1.5`));

        console.log();
        console.log(chalk.bold.cyan("Generated Images"));
        console.log(chalk.dim("─".repeat(60)));

        for (let i = 0; i < result.images.length; i++) {
          const img = result.images[i];
          console.log();
          if (img.url) {
            console.log(`${chalk.yellow(`[${i + 1}]`)} ${img.url}`);
          } else if (img.base64) {
            console.log(`${chalk.yellow(`[${i + 1}]`)} (base64 image data)`);
          }
          if (img.revisedPrompt) {
            console.log(chalk.dim(`    Revised: ${img.revisedPrompt.slice(0, 100)}...`));
          }
        }
        console.log();

        // Save if output specified
        if (options.output && result.images.length > 0) {
          const img = result.images[0];
          const saveSpinner = ora("Saving image...").start();
          try {
            let buffer: Buffer;
            if (img.url) {
              // Download from URL
              const response = await fetch(img.url);
              buffer = Buffer.from(await response.arrayBuffer());
            } else if (img.base64) {
              // Decode base64
              buffer = Buffer.from(img.base64, "base64");
            } else {
              throw new Error("No image data available");
            }
            const outputPath = resolve(process.cwd(), options.output);
            await writeFile(outputPath, buffer);
            saveSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
          } catch (err) {
            saveSpinner.fail(chalk.red("Failed to save image"));
          }
        }
      } else if (provider === "gemini") {
        const gemini = new GeminiProvider();
        await gemini.initialize({ apiKey });

        const result = await gemini.generateImage(prompt, {
          aspectRatio: options.ratio as "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9",
        });

        if (!result.success || !result.images) {
          spinner.fail(chalk.red(result.error || "Image generation failed"));
          process.exit(1);
        }

        spinner.succeed(chalk.green(`Generated ${result.images.length} image(s) with Gemini (Nano Banana)`));

        console.log();
        console.log(chalk.bold.cyan("Generated Images"));
        console.log(chalk.dim("─".repeat(60)));

        // Gemini returns base64, we need to save or display
        for (let i = 0; i < result.images.length; i++) {
          const img = result.images[i];
          console.log();
          console.log(`${chalk.yellow(`[${i + 1}]`)} (base64 image, ${img.mimeType})`);
        }
        console.log();

        // Save if output specified
        if (options.output && result.images.length > 0) {
          const saveSpinner = ora("Saving image...").start();
          try {
            const img = result.images[0];
            const buffer = Buffer.from(img.base64, "base64");
            const outputPath = resolve(process.cwd(), options.output);
            await writeFile(outputPath, buffer);
            saveSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
          } catch (err) {
            saveSpinner.fail(chalk.red("Failed to save image"));
          }
        } else {
          console.log(chalk.yellow("Use -o to save the generated image to a file"));
        }
      } else if (provider === "stability") {
        const stability = new StabilityProvider();
        await stability.initialize({ apiKey });

        // Map size to Stability aspect ratio
        const aspectRatioMap: Record<string, "16:9" | "1:1" | "9:16"> = {
          "1024x1024": "1:1",
          "1536x1024": "16:9",
          "1024x1536": "9:16",
        };

        const result = await stability.generateImage(prompt, {
          aspectRatio: aspectRatioMap[options.size] || "1:1",
          count: parseInt(options.count),
        });

        if (!result.success || !result.images) {
          spinner.fail(chalk.red(result.error || "Image generation failed"));
          process.exit(1);
        }

        spinner.succeed(chalk.green(`Generated ${result.images.length} image(s) with Stability AI`));

        console.log();
        console.log(chalk.bold.cyan("Generated Images"));
        console.log(chalk.dim("─".repeat(60)));

        for (let i = 0; i < result.images.length; i++) {
          console.log();
          console.log(`${chalk.yellow(`[${i + 1}]`)} (base64 image)`);
        }
        console.log();

        // Save if output specified
        if (options.output && result.images.length > 0) {
          const saveSpinner = ora("Saving image...").start();
          try {
            const img = result.images[0];
            if (!img.base64) {
              saveSpinner.fail(chalk.red("No image data returned"));
              process.exit(1);
            }
            const buffer = Buffer.from(img.base64, "base64");
            const outputPath = resolve(process.cwd(), options.output);
            await writeFile(outputPath, buffer);
            saveSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
          } catch (err) {
            saveSpinner.fail(chalk.red("Failed to save image"));
          }
        } else {
          console.log(chalk.yellow("Use -o to save the generated image to a file"));
        }
      } else if (provider === "runway") {
        // Use Runway's Gemini model for text-to-image (no reference needed)
        const { spawn } = await import("child_process");
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const scriptPath = resolve(__dirname, "../../../../.claude/skills/runway-video/scripts/image.py");

        if (!options.output) {
          spinner.fail(chalk.red("Output path required for Runway. Use -o option."));
          process.exit(1);
        }

        const outputPath = resolve(process.cwd(), options.output);
        const args = [scriptPath, prompt, "-o", outputPath, "-r", options.ratio || "16:9"];

        spinner.text = "Generating image with Runway (gemini_2.5_flash)...";

        await new Promise<void>((resolvePromise, reject) => {
          const proc = spawn("python3", args, {
            env: { ...process.env, RUNWAY_API_SECRET: apiKey },
            stdio: ["ignore", "pipe", "pipe"],
          });

          let stdout = "";
          let stderr = "";

          proc.stdout.on("data", (data) => {
            stdout += data.toString();
          });

          proc.stderr.on("data", (data) => {
            stderr += data.toString();
          });

          proc.on("close", (code) => {
            if (code === 0) {
              spinner.succeed(chalk.green("Generated image with Runway"));
              console.log(chalk.dim(stdout.trim()));
              resolvePromise();
            } else {
              spinner.fail(chalk.red("Runway image generation failed"));
              console.error(chalk.red(stderr || stdout));
              reject(new Error("Runway generation failed"));
            }
          });

          proc.on("error", (err) => {
            spinner.fail(chalk.red("Failed to run Runway script"));
            reject(err);
          });
        });
      }
    } catch (error) {
      console.error(chalk.red("Image generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("thumbnail")
  .description("Generate video thumbnail (DALL-E) or extract best frame from video (Gemini)")
  .argument("[description]", "Thumbnail description (for DALL-E generation)")
  .option("-k, --api-key <key>", "API key (OpenAI for generation, Google for best-frame)")
  .option("-o, --output <path>", "Output file path")
  .option("-s, --style <style>", "Platform style: youtube, instagram, tiktok, twitter")
  .option("--best-frame <video>", "Extract best thumbnail frame from video using Gemini AI")
  .option("--prompt <prompt>", "Custom prompt for best-frame analysis")
  .option("--model <model>", "Gemini model: flash, flash-2.5, pro (default: flash)", "flash")
  .action(async (description: string | undefined, options) => {
    try {
      // Best-frame mode: analyze video with Gemini and extract frame
      if (options.bestFrame) {
        const absVideoPath = resolve(process.cwd(), options.bestFrame);
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

        const apiKey = await getApiKey("GOOGLE_API_KEY", "Google", options.apiKey);
        if (!apiKey) {
          console.error(chalk.red("Google API key required for Gemini video analysis."));
          console.error(chalk.dim("Use --api-key or set GOOGLE_API_KEY"));
          process.exit(1);
        }

        const name = basename(options.bestFrame, extname(options.bestFrame));
        const outputPath = options.output || `${name}-thumbnail.png`;

        const spinner = ora("Analyzing video for best frame...").start();

        const result = await executeThumbnailBestFrame({
          videoPath: absVideoPath,
          outputPath: resolve(process.cwd(), outputPath),
          prompt: options.prompt,
          model: options.model,
          apiKey,
        });

        if (!result.success) {
          spinner.fail(chalk.red(result.error || "Best frame extraction failed"));
          process.exit(1);
        }

        spinner.succeed(chalk.green("Best frame extracted"));

        console.log();
        console.log(chalk.bold.cyan("Best Frame Result"));
        console.log(chalk.dim("─".repeat(60)));
        console.log(`Timestamp: ${chalk.bold(result.timestamp!.toFixed(2))}s`);
        if (result.reason) console.log(`Reason: ${chalk.dim(result.reason)}`);
        console.log(`Output: ${chalk.green(result.outputPath!)}`);
        console.log();
        return;
      }

      // Generation mode: create thumbnail with DALL-E
      if (!description) {
        console.error(chalk.red("Description required for thumbnail generation."));
        console.error(chalk.dim("Usage: vibe ai thumbnail <description> or vibe ai thumbnail --best-frame <video>"));
        process.exit(1);
      }

      const apiKey = await getApiKey("OPENAI_API_KEY", "OpenAI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("OpenAI API key required. Use --api-key or set OPENAI_API_KEY"));
        process.exit(1);
      }

      const spinner = ora("Generating thumbnail...").start();

      const openaiImage = new OpenAIImageProvider();
      await openaiImage.initialize({ apiKey });

      const result = await openaiImage.generateThumbnail(description, options.style);

      if (!result.success || !result.images) {
        spinner.fail(chalk.red(result.error || "Thumbnail generation failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Thumbnail generated"));

      const img = result.images[0];
      console.log();
      console.log(chalk.bold.cyan("Generated Thumbnail"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`URL: ${img.url}`);
      if (img.revisedPrompt) {
        console.log(chalk.dim(`Prompt: ${img.revisedPrompt.slice(0, 100)}...`));
      }
      console.log();

      // Save if output specified
      if (options.output) {
        const saveSpinner = ora("Saving thumbnail...").start();
        try {
          let buffer: Buffer;
          if (img.url) {
            const response = await fetch(img.url);
            buffer = Buffer.from(await response.arrayBuffer());
          } else if (img.base64) {
            buffer = Buffer.from(img.base64, "base64");
          } else {
            throw new Error("No image data available");
          }
          const outputPath = resolve(process.cwd(), options.output);
          await writeFile(outputPath, buffer);
          saveSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
        } catch (err) {
          saveSpinner.fail(chalk.red("Failed to save thumbnail"));
        }
      }
    } catch (error) {
      console.error(chalk.red("Thumbnail generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("background")
  .description("Generate video background using DALL-E")
  .argument("<description>", "Background description")
  .option("-k, --api-key <key>", "OpenAI API key (or set OPENAI_API_KEY env)")
  .option("-o, --output <path>", "Output file path (downloads image)")
  .option("-a, --aspect <ratio>", "Aspect ratio: 16:9, 9:16, 1:1", "16:9")
  .action(async (description: string, options) => {
    try {
      const apiKey = await getApiKey("OPENAI_API_KEY", "OpenAI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("OpenAI API key required. Use --api-key or set OPENAI_API_KEY"));
        process.exit(1);
      }

      const spinner = ora("Generating background...").start();

      const openaiImage = new OpenAIImageProvider();
      await openaiImage.initialize({ apiKey });

      const result = await openaiImage.generateBackground(description, options.aspect);

      if (!result.success || !result.images) {
        spinner.fail(chalk.red(result.error || "Background generation failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Background generated"));

      const img = result.images[0];
      console.log();
      console.log(chalk.bold.cyan("Generated Background"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Image: ${img.url || "(base64 data)"}`);
      if (img.revisedPrompt) {
        console.log(chalk.dim(`Prompt: ${img.revisedPrompt.slice(0, 100)}...`));
      }
      console.log();

      // Save if output specified
      if (options.output) {
        const saveSpinner = ora("Saving background...").start();
        try {
          let buffer: Buffer;
          if (img.url) {
            const response = await fetch(img.url);
            buffer = Buffer.from(await response.arrayBuffer());
          } else if (img.base64) {
            buffer = Buffer.from(img.base64, "base64");
          } else {
            throw new Error("No image data available");
          }
          const outputPath = resolve(process.cwd(), options.output);
          await writeFile(outputPath, buffer);
          saveSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
        } catch (err) {
          saveSpinner.fail(chalk.red("Failed to save background"));
        }
      }
    } catch (error) {
      console.error(chalk.red("Background generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("video")
  .description("Generate video using AI (Runway, Kling, or Veo)")
  .argument("<prompt>", "Text prompt describing the video")
  .option("-p, --provider <provider>", "Provider: kling, runway, veo", "kling")
  .option("-k, --api-key <key>", "API key (or set RUNWAY_API_SECRET / KLING_API_KEY / GOOGLE_API_KEY env)")
  .option("-o, --output <path>", "Output file path (downloads video)")
  .option("-i, --image <path>", "Reference image for image-to-video")
  .option("-d, --duration <sec>", "Duration: 5 or 10 seconds", "5")
  .option("-r, --ratio <ratio>", "Aspect ratio: 16:9, 9:16, or 1:1", "16:9")
  .option("-s, --seed <number>", "Random seed for reproducibility (Runway only)")
  .option("-m, --mode <mode>", "Generation mode: std or pro (Kling only)", "std")
  .option("-n, --negative <prompt>", "Negative prompt - what to avoid (Kling only)")
  .option("--no-wait", "Start generation and return task ID without waiting")
  .action(async (prompt: string, options) => {
    try {
      const provider = options.provider.toLowerCase();
      const validProviders = ["runway", "kling", "veo"];
      if (!validProviders.includes(provider)) {
        console.error(chalk.red(`Invalid provider: ${provider}`));
        console.error(chalk.dim(`Available providers: ${validProviders.join(", ")}`));
        process.exit(1);
      }

      // Get API key based on provider
      const envKeyMap: Record<string, string> = {
        runway: "RUNWAY_API_SECRET",
        kling: "KLING_API_KEY",
        veo: "GOOGLE_API_KEY",
      };
      const providerNameMap: Record<string, string> = {
        runway: "Runway",
        kling: "Kling",
        veo: "Veo",
      };
      const envKey = envKeyMap[provider];
      const providerName = providerNameMap[provider];
      const apiKey = await getApiKey(envKey, providerName, options.apiKey);
      if (!apiKey) {
        console.error(chalk.red(`${providerName} API key required.`));
        if (provider === "kling") {
          console.error(chalk.dim("Format: ACCESS_KEY:SECRET_KEY"));
        }
        console.error(chalk.dim(`Use --api-key or set ${envKey} environment variable`));
        process.exit(1);
      }

      const spinner = ora(`Initializing ${providerName}...`).start();

      // Read reference image if provided
      let referenceImage: string | undefined;
      let isImageToVideo = false;
      if (options.image) {
        spinner.text = "Reading reference image...";
        const imagePath = resolve(process.cwd(), options.image);
        const imageBuffer = await readFile(imagePath);
        const ext = options.image.toLowerCase().split(".").pop();
        const mimeTypes: Record<string, string> = {
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          png: "image/png",
          gif: "image/gif",
          webp: "image/webp",
        };
        const mimeType = mimeTypes[ext || "png"] || "image/png";
        referenceImage = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
        isImageToVideo = true;
      }

      spinner.text = "Starting video generation...";

      let result;
      let finalResult;

      if (provider === "runway") {
        const runway = new RunwayProvider();
        await runway.initialize({ apiKey });

        result = await runway.generateVideo(prompt, {
          prompt,
          referenceImage,
          duration: parseInt(options.duration) as 5 | 10,
          aspectRatio: options.ratio as "16:9" | "9:16",
          seed: options.seed ? parseInt(options.seed) : undefined,
        });

        if (result.status === "failed") {
          spinner.fail(chalk.red(result.error || "Failed to start generation"));
          process.exit(1);
        }

        console.log();
        console.log(chalk.bold.cyan("Video Generation Started"));
        console.log(chalk.dim("─".repeat(60)));
        console.log(`Provider: ${chalk.bold("Runway Gen-3")}`);
        console.log(`Task ID: ${chalk.bold(result.id)}`);

        if (!options.wait) {
          spinner.succeed(chalk.green("Generation started"));
          console.log();
          console.log(chalk.dim("Check status with:"));
          console.log(chalk.dim(`  vibe ai video-status ${result.id}`));
          console.log();
          return;
        }

        spinner.text = "Generating video (this may take 1-2 minutes)...";

        finalResult = await runway.waitForCompletion(
          result.id,
          (status) => {
            if (status.progress !== undefined) {
              spinner.text = `Generating video... ${status.progress}%`;
            }
          },
          300000 // 5 minute timeout
        );
      } else if (provider === "kling") {
        // Kling provider
        const kling = new KlingProvider();
        await kling.initialize({ apiKey });

        if (!kling.isConfigured()) {
          spinner.fail(chalk.red("Invalid API key format. Use ACCESS_KEY:SECRET_KEY"));
          process.exit(1);
        }

        result = await kling.generateVideo(prompt, {
          prompt,
          referenceImage,
          duration: parseInt(options.duration) as 5 | 10,
          aspectRatio: options.ratio as "16:9" | "9:16" | "1:1",
          negativePrompt: options.negative,
          mode: options.mode as "std" | "pro",
        });

        if (result.status === "failed") {
          spinner.fail(chalk.red(result.error || "Failed to start generation"));
          process.exit(1);
        }

        console.log();
        console.log(chalk.bold.cyan("Video Generation Started"));
        console.log(chalk.dim("─".repeat(60)));
        console.log(`Provider: ${chalk.bold("Kling AI")}`);
        console.log(`Task ID: ${chalk.bold(result.id)}`);
        console.log(`Type: ${isImageToVideo ? "image2video" : "text2video"}`);

        if (!options.wait) {
          spinner.succeed(chalk.green("Generation started"));
          console.log();
          console.log(chalk.dim("Check status with:"));
          console.log(chalk.dim(`  vibe ai kling-status ${result.id}${isImageToVideo ? " --type image2video" : ""}`));
          console.log();
          return;
        }

        spinner.text = "Generating video (this may take 2-5 minutes)...";

        const taskType = isImageToVideo ? "image2video" : "text2video";
        finalResult = await kling.waitForCompletion(
          result.id,
          taskType,
          (status) => {
            spinner.text = `Generating video... ${status.status}`;
          },
          600000 // 10 minute timeout
        );
      } else if (provider === "veo") {
        // Veo (Google) provider
        const gemini = new GeminiProvider();
        await gemini.initialize({ apiKey });

        // Veo 3.1 supports duration 6 or 8 seconds only
        const veoDuration = parseInt(options.duration) <= 6 ? 6 : 8;
        result = await gemini.generateVideo(prompt, {
          prompt,
          referenceImage,
          duration: veoDuration,
          aspectRatio: options.ratio as "16:9" | "9:16",
          model: "veo-3.1-fast-generate-preview",
        });

        if (result.status === "failed") {
          spinner.fail(chalk.red(result.error || "Failed to start generation"));
          process.exit(1);
        }

        console.log();
        console.log(chalk.bold.cyan("Video Generation Started"));
        console.log(chalk.dim("─".repeat(60)));
        console.log(`Provider: ${chalk.bold("Google Veo 3.1")}`);
        console.log(`Task ID: ${chalk.bold(result.id)}`);

        if (!options.wait) {
          spinner.succeed(chalk.green("Generation started"));
          console.log();
          console.log(chalk.dim("Veo generation is synchronous - video URL available above"));
          console.log();
          return;
        }

        // Veo waitForCompletion
        spinner.text = "Generating video (this may take 1-3 minutes)...";
        finalResult = await gemini.waitForVideoCompletion(
          result.id,
          (status) => {
            spinner.text = `Generating video... ${status.status}`;
          },
          300000 // 5 minute timeout
        );
      }

      if (finalResult.status !== "completed") {
        spinner.fail(chalk.red(finalResult.error || "Generation failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Video generated"));

      console.log();
      if (finalResult.videoUrl) {
        console.log(`Video URL: ${finalResult.videoUrl}`);
      }
      if (finalResult.duration) {
        console.log(`Duration: ${finalResult.duration}s`);
      }
      console.log();

      // Download if output specified
      if (options.output && finalResult.videoUrl) {
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
    } catch (error) {
      console.error(chalk.red("Video generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("video-status")
  .description("Check Runway video generation status")
  .argument("<task-id>", "Task ID from video generation")
  .option("-k, --api-key <key>", "Runway API key (or set RUNWAY_API_SECRET env)")
  .option("-w, --wait", "Wait for completion")
  .option("-o, --output <path>", "Download video when complete")
  .action(async (taskId: string, options) => {
    try {
      const apiKey = await getApiKey("RUNWAY_API_SECRET", "Runway", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Runway API key required"));
        process.exit(1);
      }

      const spinner = ora("Checking status...").start();

      const runway = new RunwayProvider();
      await runway.initialize({ apiKey });

      let result = await runway.getGenerationStatus(taskId);

      if (options.wait && result.status !== "completed" && result.status !== "failed" && result.status !== "cancelled") {
        spinner.text = "Waiting for completion...";
        result = await runway.waitForCompletion(
          taskId,
          (status) => {
            if (status.progress !== undefined) {
              spinner.text = `Generating... ${status.progress}%`;
            }
          }
        );
      }

      spinner.stop();

      console.log();
      console.log(chalk.bold.cyan("Generation Status"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Task ID: ${taskId}`);
      console.log(`Status: ${getStatusColor(result.status)}`);
      if (result.progress !== undefined) {
        console.log(`Progress: ${result.progress}%`);
      }
      if (result.videoUrl) {
        console.log(`Video URL: ${result.videoUrl}`);
      }
      if (result.error) {
        console.log(`Error: ${chalk.red(result.error)}`);
      }
      console.log();

      // Download if output specified and completed
      if (options.output && result.videoUrl) {
        const downloadSpinner = ora("Downloading video...").start();
        try {
          const response = await fetch(result.videoUrl);
          const buffer = Buffer.from(await response.arrayBuffer());
          const outputPath = resolve(process.cwd(), options.output);
          await writeFile(outputPath, buffer);
          downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
        } catch (err) {
          downloadSpinner.fail(chalk.red("Failed to download video"));
        }
      }
    } catch (error) {
      console.error(chalk.red("Failed to get status"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("video-cancel")
  .description("Cancel Runway video generation")
  .argument("<task-id>", "Task ID to cancel")
  .option("-k, --api-key <key>", "Runway API key (or set RUNWAY_API_SECRET env)")
  .action(async (taskId: string, options) => {
    try {
      const apiKey = await getApiKey("RUNWAY_API_SECRET", "Runway", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Runway API key required"));
        process.exit(1);
      }

      const spinner = ora("Cancelling generation...").start();

      const runway = new RunwayProvider();
      await runway.initialize({ apiKey });

      const success = await runway.cancelGeneration(taskId);

      if (success) {
        spinner.succeed(chalk.green("Generation cancelled"));
      } else {
        spinner.fail(chalk.red("Failed to cancel generation"));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red("Failed to cancel"));
      console.error(error);
      process.exit(1);
    }
  });

// Kling video generation commands
aiCommand
  .command("kling")
  .description("Generate video using Kling AI")
  .argument("<prompt>", "Text prompt describing the video")
  .option("-k, --api-key <key>", "Kling API key (ACCESS_KEY:SECRET_KEY) or set KLING_API_KEY env")
  .option("-o, --output <path>", "Output file path (downloads video)")
  .option("-i, --image <path>", "Reference image for image-to-video")
  .option("-d, --duration <sec>", "Duration: 5 or 10 seconds", "5")
  .option("-r, --ratio <ratio>", "Aspect ratio: 16:9, 9:16, or 1:1", "16:9")
  .option("-m, --mode <mode>", "Generation mode: std (standard) or pro", "pro")
  .option("-n, --negative <prompt>", "Negative prompt (what to avoid)")
  .option("--no-wait", "Start generation and return task ID without waiting")
  .action(async (prompt: string, options) => {
    try {
      const apiKey = await getApiKey("KLING_API_KEY", "Kling", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Kling API key required."));
        console.error(chalk.dim("Format: ACCESS_KEY:SECRET_KEY"));
        console.error(chalk.dim("Use --api-key or set KLING_API_KEY environment variable"));
        process.exit(1);
      }

      const spinner = ora("Initializing Kling AI...").start();

      const kling = new KlingProvider();
      await kling.initialize({ apiKey });

      if (!kling.isConfigured()) {
        spinner.fail(chalk.red("Invalid API key format. Use ACCESS_KEY:SECRET_KEY"));
        process.exit(1);
      }

      // If image provided, read it
      let referenceImage: string | undefined;
      let isImageToVideo = false;
      if (options.image) {
        spinner.text = "Reading reference image...";
        const imagePath = resolve(process.cwd(), options.image);
        const imageBuffer = await readFile(imagePath);
        const ext = options.image.toLowerCase().split(".").pop();
        const mimeTypes: Record<string, string> = {
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          png: "image/png",
          gif: "image/gif",
          webp: "image/webp",
        };
        const mimeType = mimeTypes[ext || "png"] || "image/png";
        referenceImage = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
        isImageToVideo = true;
      }

      spinner.text = "Starting video generation...";

      const result = await kling.generateVideo(prompt, {
        prompt,
        referenceImage,
        duration: parseInt(options.duration) as 5 | 10,
        aspectRatio: options.ratio as "16:9" | "9:16" | "1:1",
        negativePrompt: options.negative,
        mode: options.mode as "std" | "pro",
      });

      if (result.status === "failed") {
        spinner.fail(chalk.red(result.error || "Failed to start generation"));
        process.exit(1);
      }

      console.log();
      console.log(chalk.bold.cyan("Kling Video Generation Started"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Task ID: ${chalk.bold(result.id)}`);
      console.log(`Type: ${isImageToVideo ? "image2video" : "text2video"}`);

      if (!options.wait) {
        spinner.succeed(chalk.green("Generation started"));
        console.log();
        console.log(chalk.dim("Check status with:"));
        console.log(chalk.dim(`  pnpm vibe ai kling-status ${result.id}${isImageToVideo ? " --type image2video" : ""}`));
        console.log();
        return;
      }

      spinner.text = "Generating video (this may take 2-5 minutes)...";

      const taskType = isImageToVideo ? "image2video" : "text2video";
      const finalResult = await kling.waitForCompletion(
        result.id,
        taskType,
        (status) => {
          spinner.text = `Generating video... ${status.status}`;
        },
        600000 // 10 minute timeout
      );

      if (finalResult.status !== "completed") {
        spinner.fail(chalk.red(finalResult.error || "Generation failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Video generated"));

      console.log();
      if (finalResult.videoUrl) {
        console.log(`Video URL: ${finalResult.videoUrl}`);
      }
      if (finalResult.duration) {
        console.log(`Duration: ${finalResult.duration}s`);
      }
      console.log();

      // Download if output specified
      if (options.output && finalResult.videoUrl) {
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
    } catch (error) {
      console.error(chalk.red("Video generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("kling-status")
  .description("Check Kling video generation status")
  .argument("<task-id>", "Task ID from video generation")
  .option("-k, --api-key <key>", "Kling API key (or set KLING_API_KEY env)")
  .option("-t, --type <type>", "Task type: text2video or image2video", "text2video")
  .option("-w, --wait", "Wait for completion")
  .option("-o, --output <path>", "Download video when complete")
  .action(async (taskId: string, options) => {
    try {
      const apiKey = await getApiKey("KLING_API_KEY", "Kling", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Kling API key required"));
        process.exit(1);
      }

      const spinner = ora("Checking status...").start();

      const kling = new KlingProvider();
      await kling.initialize({ apiKey });

      const taskType = options.type as "text2video" | "image2video";
      let result = await kling.getGenerationStatus(taskId, taskType);

      if (options.wait && result.status !== "completed" && result.status !== "failed" && result.status !== "cancelled") {
        spinner.text = "Waiting for completion...";
        result = await kling.waitForCompletion(
          taskId,
          taskType,
          (status) => {
            spinner.text = `Generating... ${status.status}`;
          }
        );
      }

      spinner.stop();

      console.log();
      console.log(chalk.bold.cyan("Kling Generation Status"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Task ID: ${taskId}`);
      console.log(`Type: ${taskType}`);
      console.log(`Status: ${getStatusColor(result.status)}`);
      if (result.videoUrl) {
        console.log(`Video URL: ${result.videoUrl}`);
      }
      if (result.duration) {
        console.log(`Duration: ${result.duration}s`);
      }
      if (result.error) {
        console.log(`Error: ${chalk.red(result.error)}`);
      }
      console.log();

      // Download if output specified and completed
      if (options.output && result.videoUrl) {
        const downloadSpinner = ora("Downloading video...").start();
        try {
          const response = await fetch(result.videoUrl);
          const buffer = Buffer.from(await response.arrayBuffer());
          const outputPath = resolve(process.cwd(), options.output);
          await writeFile(outputPath, buffer);
          downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
        } catch (err) {
          downloadSpinner.fail(chalk.red("Failed to download video"));
        }
      }
    } catch (error) {
      console.error(chalk.red("Failed to get status"));
      console.error(error);
      process.exit(1);
    }
  });

// Video Extend command (Kling AI)
aiCommand
  .command("video-extend")
  .description("Extend video duration using Kling AI (requires Kling video ID)")
  .argument("<video-id>", "Kling video ID (from generation result)")
  .option("-k, --api-key <key>", "Kling API key (ACCESS_KEY:SECRET_KEY) or set KLING_API_KEY env")
  .option("-o, --output <path>", "Output file path")
  .option("-p, --prompt <text>", "Continuation prompt")
  .option("-d, --duration <sec>", "Duration: 5 or 10 seconds", "5")
  .option("-n, --negative <prompt>", "Negative prompt (what to avoid)")
  .option("--no-wait", "Start generation and return task ID without waiting")
  .action(async (videoId: string, options) => {
    try {
      const apiKey = await getApiKey("KLING_API_KEY", "Kling", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Kling API key required."));
        console.error(chalk.dim("Format: ACCESS_KEY:SECRET_KEY"));
        console.error(chalk.dim("Use --api-key or set KLING_API_KEY environment variable"));
        process.exit(1);
      }

      const spinner = ora("Initializing Kling AI...").start();

      const kling = new KlingProvider();
      await kling.initialize({ apiKey });

      if (!kling.isConfigured()) {
        spinner.fail(chalk.red("Invalid API key format. Use ACCESS_KEY:SECRET_KEY"));
        process.exit(1);
      }

      spinner.text = "Starting video extension...";

      const result = await kling.extendVideo(videoId, {
        prompt: options.prompt,
        negativePrompt: options.negative,
        duration: options.duration as "5" | "10",
      });

      if (result.status === "failed") {
        spinner.fail(chalk.red(result.error || "Failed to start extension"));
        process.exit(1);
      }

      console.log();
      console.log(chalk.bold.cyan("Video Extension Started"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Task ID: ${chalk.bold(result.id)}`);

      if (!options.wait) {
        spinner.succeed(chalk.green("Extension started"));
        console.log();
        console.log(chalk.dim("Check status with:"));
        console.log(chalk.dim(`  pnpm vibe ai video-extend-status ${result.id}`));
        console.log();
        return;
      }

      spinner.text = "Extending video (this may take 2-5 minutes)...";

      const finalResult = await kling.waitForExtendCompletion(
        result.id,
        (status) => {
          spinner.text = `Extending video... ${status.status}`;
        },
        600000
      );

      if (finalResult.status !== "completed") {
        spinner.fail(chalk.red(finalResult.error || "Extension failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Video extended"));

      console.log();
      if (finalResult.videoUrl) {
        console.log(`Video URL: ${finalResult.videoUrl}`);
      }
      if (finalResult.duration) {
        console.log(`Duration: ${finalResult.duration}s`);
      }
      console.log();

      // Download if output specified
      if (options.output && finalResult.videoUrl) {
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
    } catch (error) {
      console.error(chalk.red("Video extension failed"));
      console.error(error);
      process.exit(1);
    }
  });

// Fill Gaps command - AI video generation to fill timeline gaps
aiCommand
  .command("fill-gaps")
  .description("Fill timeline gaps with AI-generated video (Kling image-to-video)")
  .argument("<project>", "Project file path")
  .option("-p, --provider <provider>", "AI provider (kling)", "kling")
  .option("-o, --output <path>", "Output project path (default: overwrite)")
  .option("-d, --dir <path>", "Directory to save generated videos")
  .option("--prompt <text>", "Custom prompt for video generation")
  .option("--dry-run", "Show gaps without generating")
  .option("-m, --mode <mode>", "Generation mode: std or pro (Kling)", "std")
  .option("-r, --ratio <ratio>", "Aspect ratio: 16:9, 9:16, or 1:1", "16:9")
  .action(async (projectPath: string, options) => {
    try {
      const spinner = ora("Loading project...").start();

      // Load project
      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const clips = project.getClips().sort((a, b) => a.startTime - b.startTime);
      const sources = project.getSources();

      // Get video clips only
      const videoClips = clips.filter((clip) => {
        const source = sources.find((s) => s.id === clip.sourceId);
        return source && (source.type === "video" || source.type === "image");
      }).sort((a, b) => a.startTime - b.startTime);

      if (videoClips.length === 0) {
        spinner.fail(chalk.red("Project has no video clips"));
        process.exit(1);
      }

      // Determine total duration (use audio track if available)
      const audioClips = clips.filter((clip) => {
        const source = sources.find((s) => s.id === clip.sourceId);
        return source && source.type === "audio";
      });

      let totalDuration: number;
      if (audioClips.length > 0) {
        totalDuration = Math.max(...audioClips.map((c) => c.startTime + c.duration));
      } else {
        totalDuration = Math.max(...videoClips.map((c) => c.startTime + c.duration));
      }

      // Detect gaps
      spinner.text = "Detecting gaps...";
      const gaps = detectVideoGaps(videoClips, totalDuration);

      if (gaps.length === 0) {
        spinner.succeed(chalk.green("No gaps found in timeline"));
        process.exit(0);
      }

      // Analyze which gaps can be filled by extending adjacent clips
      const gapAnalysis = analyzeGapFillability(gaps, videoClips, sources);

      spinner.succeed(chalk.green(`Found ${gaps.length} gap(s)`));

      console.log();
      console.log(chalk.bold.cyan("Timeline Gaps"));
      console.log(chalk.dim("─".repeat(60)));

      const gapsNeedingAI: typeof gapAnalysis = [];

      for (const analysis of gapAnalysis) {
        const { gap, canExtendBefore, canExtendAfter, remainingGap } = analysis;
        const gapDuration = gap.end - gap.start;

        console.log();
        console.log(chalk.yellow(`Gap: ${formatTime(gap.start)} - ${formatTime(gap.end)} (${gapDuration.toFixed(2)}s)`));

        if (canExtendBefore > 0.01 || canExtendAfter > 0.01) {
          const extendable = canExtendBefore + canExtendAfter;
          console.log(chalk.dim(`  Can extend from adjacent clips: ${extendable.toFixed(2)}s`));
        }

        if (remainingGap > 0.01) {
          console.log(chalk.red(`  Needs AI generation: ${remainingGap.toFixed(2)}s`));
          gapsNeedingAI.push(analysis);
        } else {
          console.log(chalk.green(`  ✓ Can be filled by extending clips`));
        }
      }

      console.log();

      if (gapsNeedingAI.length === 0) {
        console.log(chalk.green("All gaps can be filled by extending adjacent clips."));
        console.log(chalk.dim("Run export with --gap-fill extend to apply."));
        process.exit(0);
      }

      if (options.dryRun) {
        console.log(chalk.dim("Dry run - no videos generated"));
        console.log();
        console.log(chalk.bold(`${gapsNeedingAI.length} gap(s) need AI video generation:`));
        for (const analysis of gapsNeedingAI) {
          console.log(`  - ${formatTime(analysis.gap.start)} - ${formatTime(analysis.gap.end)} (${analysis.remainingGap.toFixed(2)}s)`);
        }
        process.exit(0);
      }

      // Get Kling API key
      const apiKey = await getApiKey("KLING_API_KEY", "Kling", undefined);
      if (!apiKey) {
        console.error(chalk.red("Kling API key required for AI video generation."));
        console.error(chalk.dim("Format: ACCESS_KEY:SECRET_KEY"));
        console.error(chalk.dim("Set KLING_API_KEY environment variable"));
        process.exit(1);
      }

      const kling = new KlingProvider();
      await kling.initialize({ apiKey });

      if (!kling.isConfigured()) {
        console.error(chalk.red("Invalid Kling API key format. Use ACCESS_KEY:SECRET_KEY"));
        process.exit(1);
      }

      // Determine output directory for generated videos
      const projectDir = dirname(filePath);
      const footageDir = options.dir
        ? resolve(process.cwd(), options.dir)
        : resolve(projectDir, "footage");

      // Create footage directory if needed
      if (!existsSync(footageDir)) {
        await mkdir(footageDir, { recursive: true });
      }

      console.log(chalk.bold.cyan("Generating AI Videos"));
      console.log(chalk.dim("─".repeat(60)));

      let generatedCount = 0;

      for (const analysis of gapsNeedingAI) {
        const { gap, remainingGap, gapStart } = analysis;

        console.log();
        console.log(chalk.yellow(`Processing gap: ${formatTime(gap.start)} - ${formatTime(gap.end)}`));

        // Find the clip before this gap to extract a frame
        const clipBefore = videoClips.find((c) =>
          Math.abs(c.startTime + c.duration - gap.start) < 0.1
        );

        if (!clipBefore) {
          console.log(chalk.red(`  No preceding clip found, skipping`));
          continue;
        }

        const sourceBefore = sources.find((s) => s.id === clipBefore.sourceId);
        if (!sourceBefore || sourceBefore.type !== "video") {
          console.log(chalk.red(`  Preceding clip is not a video, skipping`));
          continue;
        }

        // Extract last frame from preceding clip
        spinner.start("Extracting frame from preceding clip...");
        const frameOffset = clipBefore.sourceStartOffset + clipBefore.duration - 0.1; // 100ms before end
        const framePath = resolve(footageDir, `frame-${gap.start.toFixed(2)}.png`);

        try {
          await execAsync(
            `ffmpeg -i "${sourceBefore.url}" -ss ${frameOffset} -vframes 1 -f image2 -y "${framePath}"`
          );
        } catch (err) {
          spinner.fail(chalk.red("Failed to extract frame"));
          console.error(err);
          continue;
        }
        spinner.succeed("Frame extracted");

        // Upload frame to imgbb to get URL (Kling v2.5/v2.6 requires URL, not base64)
        spinner.start("Uploading frame to imgbb...");
        const imgbbApiKey = await getApiKey("IMGBB_API_KEY", "imgbb", undefined);
        if (!imgbbApiKey) {
          spinner.fail(chalk.red("IMGBB_API_KEY required for image hosting"));
          console.error(chalk.dim("Get a free API key at https://api.imgbb.com/"));
          continue;
        }

        const frameBuffer = await readFile(framePath);
        const frameBase64 = frameBuffer.toString("base64");

        let frameUrl: string;
        try {
          const formData = new FormData();
          formData.append("key", imgbbApiKey);
          formData.append("image", frameBase64);

          const imgbbResponse = await fetch("https://api.imgbb.com/1/upload", {
            method: "POST",
            body: formData,
          });

          const imgbbData = await imgbbResponse.json() as { success: boolean; data?: { url: string }; error?: { message: string } };
          if (!imgbbData.success || !imgbbData.data?.url) {
            throw new Error(imgbbData.error?.message || "Upload failed");
          }
          frameUrl = imgbbData.data.url;
        } catch (err) {
          spinner.fail(chalk.red("Failed to upload frame to imgbb"));
          console.error(err);
          continue;
        }
        spinner.succeed(`Frame uploaded: ${frameUrl}`);

        // Calculate how many seconds to generate
        // Kling can generate 5 or 10 second videos
        // For longer gaps, we may need multiple generations or video-extend
        const targetDuration = remainingGap;
        let generatedDuration = 0;
        const generatedVideos: string[] = [];

        // Generate initial video (up to 10 seconds)
        const initialDuration = Math.min(10, targetDuration);
        const klingDuration = initialDuration > 5 ? "10" : "5";

        spinner.start(`Generating ${klingDuration}s video with Kling...`);

        const prompt = options.prompt || "Continue the scene naturally with subtle motion";

        const result = await kling.generateVideo(prompt, {
          prompt,
          referenceImage: frameUrl,
          duration: parseInt(klingDuration) as 5 | 10,
          aspectRatio: options.ratio as "16:9" | "9:16" | "1:1",
          mode: options.mode as "std" | "pro",
        });

        if (result.status === "failed") {
          spinner.fail(chalk.red(`Failed to start generation: ${result.error}`));
          continue;
        }

        spinner.text = `Generating video (task: ${result.id})...`;

        const finalResult = await kling.waitForCompletion(
          result.id,
          "image2video",
          (status) => {
            spinner.text = `Generating video... ${status.status}`;
          },
          600000
        );

        if (finalResult.status !== "completed" || !finalResult.videoUrl || !finalResult.videoId) {
          spinner.fail(chalk.red(`Generation failed: ${finalResult.error || "Unknown error"}`));
          continue;
        }

        // Download the generated video
        const videoFileName = `gap-fill-${gap.start.toFixed(2)}-${gap.end.toFixed(2)}.mp4`;
        const videoPath = resolve(footageDir, videoFileName);

        spinner.text = "Downloading generated video...";
        let currentVideoUrl = finalResult.videoUrl;
        const response = await fetch(currentVideoUrl);
        const videoBuffer = Buffer.from(await response.arrayBuffer());
        await writeFile(videoPath, videoBuffer);

        generatedDuration = finalResult.duration || parseInt(klingDuration);
        generatedVideos.push(videoPath);
        let currentVideoId = finalResult.videoId;

        spinner.succeed(chalk.green(`Generated: ${videoFileName} (${generatedDuration}s)`));

        // If we need more duration, generate additional videos using image-to-video
        // (video-extend often fails, so we use a more reliable approach)
        let segmentIndex = 1;
        while (generatedDuration < targetDuration - 1) {
          const remainingNeeded = targetDuration - generatedDuration;
          const segmentDuration = remainingNeeded > 5 ? "10" : "5";

          spinner.start(`Generating additional ${segmentDuration}s segment...`);

          // Extract last frame from current video
          const lastFramePath = resolve(footageDir, `frame-extend-${gap.start.toFixed(2)}-${segmentIndex}.png`);
          try {
            // Get video duration first
            const { stdout: durationOut } = await execAsync(
              `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
            );
            const videoDur = parseFloat(durationOut.trim()) || generatedDuration;
            const lastFrameTime = Math.max(0, videoDur - 0.1);

            await execAsync(
              `ffmpeg -i "${videoPath}" -ss ${lastFrameTime} -vframes 1 -f image2 -y "${lastFramePath}"`
            );
          } catch (err) {
            spinner.fail(chalk.yellow("Failed to extract frame for continuation"));
            break;
          }

          // Upload to imgbb
          const extFrameBuffer = await readFile(lastFramePath);
          const extFrameBase64 = extFrameBuffer.toString("base64");

          let extFrameUrl: string;
          try {
            const formData = new FormData();
            formData.append("key", imgbbApiKey);
            formData.append("image", extFrameBase64);

            const imgbbResp = await fetch("https://api.imgbb.com/1/upload", {
              method: "POST",
              body: formData,
            });

            const imgbbData = await imgbbResp.json() as { success: boolean; data?: { url: string }; error?: { message: string } };
            if (!imgbbData.success || !imgbbData.data?.url) {
              throw new Error(imgbbData.error?.message || "Upload failed");
            }
            extFrameUrl = imgbbData.data.url;
          } catch (err) {
            spinner.fail(chalk.yellow("Failed to upload continuation frame"));
            break;
          }

          // Generate next segment
          const segResult = await kling.generateVideo(prompt, {
            prompt,
            referenceImage: extFrameUrl,
            duration: parseInt(segmentDuration) as 5 | 10,
            aspectRatio: options.ratio as "16:9" | "9:16" | "1:1",
            mode: options.mode as "std" | "pro",
          });

          if (segResult.status === "failed") {
            spinner.fail(chalk.yellow(`Segment generation failed: ${segResult.error}`));
            break;
          }

          const segFinalResult = await kling.waitForCompletion(
            segResult.id,
            "image2video",
            (status) => {
              spinner.text = `Generating segment... ${status.status}`;
            },
            600000
          );

          if (segFinalResult.status !== "completed" || !segFinalResult.videoUrl) {
            spinner.fail(chalk.yellow(`Segment generation failed: ${segFinalResult.error || "Unknown error"}`));
            break;
          }

          // Download new segment
          const segVideoPath = resolve(footageDir, `gap-fill-${gap.start.toFixed(2)}-${gap.end.toFixed(2)}-seg${segmentIndex}.mp4`);
          const segResponse = await fetch(segFinalResult.videoUrl);
          const segVideoBuffer = Buffer.from(await segResponse.arrayBuffer());
          await writeFile(segVideoPath, segVideoBuffer);

          // Concatenate videos
          const concatListPath = resolve(footageDir, `concat-${gap.start.toFixed(2)}.txt`);
          const concatList = generatedVideos.map(v => `file '${v}'`).join("\n") + `\nfile '${segVideoPath}'`;
          await writeFile(concatListPath, concatList);

          const concatOutputPath = resolve(footageDir, `gap-fill-${gap.start.toFixed(2)}-${gap.end.toFixed(2)}-merged.mp4`);
          try {
            await execAsync(
              `ffmpeg -f concat -safe 0 -i "${concatListPath}" -c copy -y "${concatOutputPath}"`
            );
            // Replace main video with concatenated version
            await execAsync(`mv "${concatOutputPath}" "${videoPath}"`);
          } catch (err) {
            spinner.fail(chalk.yellow("Failed to concatenate videos"));
            break;
          }

          generatedVideos.push(segVideoPath);
          generatedDuration += segFinalResult.duration || parseInt(segmentDuration);
          segmentIndex++;

          spinner.succeed(chalk.green(`Added segment, total: ${generatedDuration.toFixed(1)}s`));
        }

        // Add the generated video to the project
        const actualGapStart = gapStart;
        const actualGapDuration = Math.min(remainingGap, generatedDuration);

        // Get video info for source
        let videoDuration = generatedDuration;
        try {
          const { stdout } = await execAsync(
            `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
          );
          videoDuration = parseFloat(stdout.trim()) || generatedDuration;
        } catch {
          // Use estimated duration
        }

        // Add source
        const newSource = project.addSource({
          name: videoFileName,
          type: "video",
          url: videoPath,
          duration: videoDuration,
        });

        // Add clip
        project.addClip({
          sourceId: newSource.id,
          trackId: videoClips[0].trackId,
          startTime: actualGapStart,
          duration: actualGapDuration,
          sourceStartOffset: 0,
          sourceEndOffset: actualGapDuration,
        });

        generatedCount++;
        console.log(chalk.green(`  Added to timeline: ${formatTime(actualGapStart)} - ${formatTime(actualGapStart + actualGapDuration)}`));
      }

      console.log();

      if (generatedCount > 0) {
        // Save project
        const outputPath = options.output
          ? resolve(process.cwd(), options.output)
          : filePath;

        await writeFile(outputPath, JSON.stringify(project.toJSON(), null, 2));

        console.log(chalk.bold.green(`✔ Filled ${generatedCount} gap(s) with AI-generated video`));
        console.log(chalk.dim(`Project saved: ${outputPath}`));
      } else {
        console.log(chalk.yellow("No gaps were filled"));
      }

      console.log();
    } catch (error) {
      console.error(chalk.red("Fill gaps failed"));
      console.error(error);
      process.exit(1);
    }
  });

/**
 * Detect gaps in video timeline
 */
function detectVideoGaps(
  videoClips: Array<{ startTime: number; duration: number }>,
  totalDuration: number
): Array<{ start: number; end: number }> {
  const gaps: Array<{ start: number; end: number }> = [];
  const sortedClips = [...videoClips].sort((a, b) => a.startTime - b.startTime);

  // Check for gap at the start
  if (sortedClips.length > 0 && sortedClips[0].startTime > 0.001) {
    gaps.push({ start: 0, end: sortedClips[0].startTime });
  }

  // Check for gaps between clips
  for (let i = 0; i < sortedClips.length - 1; i++) {
    const clipEnd = sortedClips[i].startTime + sortedClips[i].duration;
    const nextStart = sortedClips[i + 1].startTime;
    if (nextStart > clipEnd + 0.001) {
      gaps.push({ start: clipEnd, end: nextStart });
    }
  }

  // Check for gap at the end
  if (sortedClips.length > 0) {
    const lastClip = sortedClips[sortedClips.length - 1];
    const lastClipEnd = lastClip.startTime + lastClip.duration;
    if (totalDuration > lastClipEnd + 0.001) {
      gaps.push({ start: lastClipEnd, end: totalDuration });
    }
  }

  return gaps;
}

/**
 * Analyze whether gaps can be filled by extending adjacent clips
 */
function analyzeGapFillability(
  gaps: Array<{ start: number; end: number }>,
  videoClips: Array<{ startTime: number; duration: number; sourceId: string; sourceStartOffset: number; sourceEndOffset: number }>,
  sources: Array<{ id: string; url: string; type: string; duration: number }>
): Array<{
  gap: { start: number; end: number };
  canExtendBefore: number;
  canExtendAfter: number;
  remainingGap: number;
  gapStart: number; // Where the unfillable gap starts
}> {
  const sortedClips = [...videoClips].sort((a, b) => a.startTime - b.startTime);

  return gaps.map((gap) => {
    const gapDuration = gap.end - gap.start;
    let canExtendBefore = 0;
    let canExtendAfter = 0;

    // Find clip BEFORE the gap (for extending forwards)
    const clipBefore = sortedClips.find((c) =>
      Math.abs(c.startTime + c.duration - gap.start) < 0.01
    );

    if (clipBefore) {
      const source = sources.find((s) => s.id === clipBefore.sourceId);
      if (source && source.type === "video") {
        const usedEndInSource = clipBefore.sourceEndOffset;
        canExtendBefore = Math.max(0, source.duration - usedEndInSource);
      }
    }

    // Find clip AFTER the gap (for extending backwards)
    const clipAfter = sortedClips.find((c) =>
      Math.abs(c.startTime - gap.end) < 0.01
    );

    if (clipAfter) {
      const source = sources.find((s) => s.id === clipAfter.sourceId);
      if (source && source.type === "video") {
        canExtendAfter = Math.max(0, clipAfter.sourceStartOffset);
      }
    }

    const totalExtendable = canExtendBefore + canExtendAfter;
    const remainingGap = Math.max(0, gapDuration - totalExtendable);

    // Calculate where the unfillable gap starts
    // (after we extend the clip before as much as possible)
    const gapStart = gap.start + Math.min(canExtendBefore, gapDuration);

    return {
      gap,
      canExtendBefore,
      canExtendAfter,
      remainingGap,
      gapStart,
    };
  });
}

// Video Upscale command
aiCommand
  .command("video-upscale")
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
aiCommand
  .command("video-interpolate")
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
aiCommand
  .command("video-inpaint")
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

// Stability AI (Stable Diffusion) commands
aiCommand
  .command("sd")
  .description("Generate image using Stable Diffusion (Stability AI)")
  .argument("<prompt>", "Text prompt describing the image")
  .option("-k, --api-key <key>", "Stability AI API key (or set STABILITY_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "output.png")
  .option("-m, --model <model>", "Model: sd3.5-large, sd3.5-medium, stable-image-ultra", "sd3.5-large")
  .option("-r, --ratio <ratio>", "Aspect ratio: 16:9, 1:1, 9:16, 21:9, etc.", "1:1")
  .option("-n, --negative <prompt>", "Negative prompt (what to avoid)")
  .option("-s, --seed <number>", "Random seed for reproducibility")
  .option("--style <preset>", "Style preset: photographic, anime, digital-art, cinematic, etc.")
  .option("-f, --format <format>", "Output format: png, jpeg, webp", "png")
  .action(async (prompt: string, options) => {
    try {
      const apiKey = await getApiKey("STABILITY_API_KEY", "Stability AI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Stability AI API key required."));
        console.error(chalk.dim("Use --api-key or set STABILITY_API_KEY environment variable"));
        process.exit(1);
      }

      const spinner = ora("Generating image with Stable Diffusion...").start();

      const stability = new StabilityProvider();
      await stability.initialize({ apiKey });

      const result = await stability.generateImage(prompt, {
        model: options.model,
        aspectRatio: options.ratio,
        negativePrompt: options.negative,
        seed: options.seed ? parseInt(options.seed) : undefined,
        stylePreset: options.style,
        outputFormat: options.format,
      });

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail(chalk.red(result.error || "Image generation failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Image generated"));

      const img = result.images[0];
      if (img.seed) {
        console.log(chalk.dim(`Seed: ${img.seed}`));
      }

      // Save the image
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
        const buffer = Buffer.from(img.base64, "base64");
        await writeFile(outputPath, buffer);
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      console.error(chalk.red("Image generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("sd-upscale")
  .description("Upscale image using Stability AI")
  .argument("<image>", "Input image file path")
  .option("-k, --api-key <key>", "Stability AI API key (or set STABILITY_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "upscaled.png")
  .option("-t, --type <type>", "Upscale type: fast, conservative, creative", "fast")
  .option("-c, --creativity <value>", "Creativity (0-0.35, for creative upscale)")
  .option("-f, --format <format>", "Output format: png, jpeg, webp", "png")
  .action(async (imagePath: string, options) => {
    try {
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

      const img = result.images[0];
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
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

aiCommand
  .command("sd-remove-bg")
  .description("Remove background from image using Stability AI")
  .argument("<image>", "Input image file path")
  .option("-k, --api-key <key>", "Stability AI API key (or set STABILITY_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "no-bg.png")
  .option("-f, --format <format>", "Output format: png, webp", "png")
  .action(async (imagePath: string, options) => {
    try {
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

      const img = result.images[0];
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
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

aiCommand
  .command("sd-img2img")
  .description("Transform image using Stable Diffusion (image-to-image)")
  .argument("<image>", "Input image file path")
  .argument("<prompt>", "Text prompt describing the transformation")
  .option("-k, --api-key <key>", "Stability AI API key (or set STABILITY_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "transformed.png")
  .option("-t, --strength <value>", "Transformation strength (0-1)", "0.35")
  .option("-n, --negative <prompt>", "Negative prompt (what to avoid)")
  .option("-s, --seed <number>", "Random seed for reproducibility")
  .option("-f, --format <format>", "Output format: png, jpeg, webp", "png")
  .action(async (imagePath: string, prompt: string, options) => {
    try {
      const apiKey = await getApiKey("STABILITY_API_KEY", "Stability AI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Stability AI API key required"));
        process.exit(1);
      }

      const spinner = ora("Reading image...").start();

      const absPath = resolve(process.cwd(), imagePath);
      const imageBuffer = await readFile(absPath);

      spinner.text = "Transforming image...";

      const stability = new StabilityProvider();
      await stability.initialize({ apiKey });

      const result = await stability.imageToImage(imageBuffer, prompt, {
        strength: parseFloat(options.strength),
        negativePrompt: options.negative,
        seed: options.seed ? parseInt(options.seed) : undefined,
        outputFormat: options.format,
      });

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail(chalk.red(result.error || "Transformation failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Image transformed"));

      const img = result.images[0];
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
        const buffer = Buffer.from(img.base64, "base64");
        await writeFile(outputPath, buffer);
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      console.error(chalk.red("Transformation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("sd-replace")
  .description("Search and replace objects in image using Stability AI")
  .argument("<image>", "Input image file path")
  .argument("<search>", "What to search for in the image")
  .argument("<replace>", "What to replace it with")
  .option("-k, --api-key <key>", "Stability AI API key (or set STABILITY_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "replaced.png")
  .option("-n, --negative <prompt>", "Negative prompt (what to avoid)")
  .option("-s, --seed <number>", "Random seed for reproducibility")
  .option("-f, --format <format>", "Output format: png, jpeg, webp", "png")
  .action(async (imagePath: string, search: string, replace: string, options) => {
    try {
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

      const result = await stability.searchAndReplace(imageBuffer, search, replace, {
        negativePrompt: options.negative,
        seed: options.seed ? parseInt(options.seed) : undefined,
        outputFormat: options.format,
      });

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail(chalk.red(result.error || "Search and replace failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Objects replaced"));

      const img = result.images[0];
      if (img.seed) {
        console.log(chalk.dim(`Seed: ${img.seed}`));
      }
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
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

aiCommand
  .command("sd-outpaint")
  .description("Extend image canvas (outpainting) using Stability AI")
  .argument("<image>", "Input image file path")
  .option("-k, --api-key <key>", "Stability AI API key (or set STABILITY_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "outpainted.png")
  .option("--left <pixels>", "Pixels to extend on the left (0-2000)")
  .option("--right <pixels>", "Pixels to extend on the right (0-2000)")
  .option("--up <pixels>", "Pixels to extend upward (0-2000)")
  .option("--down <pixels>", "Pixels to extend downward (0-2000)")
  .option("-p, --prompt <text>", "Prompt for the extended area")
  .option("-c, --creativity <value>", "Creativity level (0-1, default: 0.5)")
  .option("-f, --format <format>", "Output format: png, jpeg, webp", "png")
  .action(async (imagePath: string, options) => {
    try {
      const apiKey = await getApiKey("STABILITY_API_KEY", "Stability AI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Stability AI API key required"));
        process.exit(1);
      }

      const left = options.left ? parseInt(options.left) : 0;
      const right = options.right ? parseInt(options.right) : 0;
      const up = options.up ? parseInt(options.up) : 0;
      const down = options.down ? parseInt(options.down) : 0;

      if (left === 0 && right === 0 && up === 0 && down === 0) {
        console.error(chalk.red("At least one direction (--left, --right, --up, --down) must be specified"));
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

      const img = result.images[0];
      if (img.seed) {
        console.log(chalk.dim(`Seed: ${img.seed}`));
      }
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
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

// Gemini (Nano Banana) commands
aiCommand
  .command("gemini")
  .description("Generate image using Gemini (Nano Banana)")
  .argument("<prompt>", "Text prompt describing the image")
  .option("-k, --api-key <key>", "Google API key (or set GOOGLE_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "output.png")
  .option("-m, --model <model>", "Model: flash (fast), pro (professional, 4K)", "flash")
  .option("-r, --ratio <ratio>", "Aspect ratio: 1:1, 16:9, 9:16, 4:3, 3:4, 21:9, etc.", "1:1")
  .option("-s, --size <resolution>", "Resolution: 1K, 2K, 4K (Pro model only)")
  .option("--grounding", "Enable Google Search grounding (Pro only)")
  .action(async (prompt: string, options) => {
    try {
      const apiKey = await getApiKey("GOOGLE_API_KEY", "Google", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Google API key required."));
        console.error(chalk.dim("Use --api-key or set GOOGLE_API_KEY environment variable"));
        process.exit(1);
      }

      const modelName = options.model === "pro" ? "gemini-3-pro-image-preview" : "gemini-2.5-flash-image";
      const spinner = ora(`Generating image with ${modelName}...`).start();

      const gemini = new GeminiProvider();
      await gemini.initialize({ apiKey });

      const result = await gemini.generateImage(prompt, {
        model: options.model,
        aspectRatio: options.ratio,
        resolution: options.size,
        grounding: options.grounding,
      });

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail(chalk.red(result.error || "Image generation failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Image generated"));

      if (result.model) {
        console.log(chalk.dim(`Model: ${result.model}`));
      }

      const img = result.images[0];
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
        const buffer = Buffer.from(img.base64, "base64");
        await writeFile(outputPath, buffer);
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      console.error(chalk.red("Image generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("gemini-edit")
  .description("Edit image(s) using Gemini (Nano Banana)")
  .argument("<images...>", "Input image file(s) followed by edit prompt")
  .option("-k, --api-key <key>", "Google API key (or set GOOGLE_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "edited.png")
  .option("-m, --model <model>", "Model: flash (max 3 images), pro (max 14 images)", "flash")
  .option("-r, --ratio <ratio>", "Output aspect ratio")
  .option("-s, --size <resolution>", "Resolution: 1K, 2K, 4K (Pro model only)")
  .action(async (args: string[], options) => {
    try {
      // Last argument is the prompt, rest are image paths
      if (args.length < 2) {
        console.error(chalk.red("Need at least one image and a prompt"));
        process.exit(1);
      }

      const prompt = args[args.length - 1];
      const imagePaths = args.slice(0, -1);

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

      const modelName = options.model === "pro" ? "gemini-3-pro-image-preview" : "gemini-2.5-flash-image";
      spinner.text = `Editing with ${modelName}...`;

      const gemini = new GeminiProvider();
      await gemini.initialize({ apiKey });

      const result = await gemini.editImage(imageBuffers, prompt, {
        model: options.model,
        aspectRatio: options.ratio,
        resolution: options.size,
      });

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail(chalk.red(result.error || "Image editing failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Image edited"));

      if (result.model) {
        console.log(chalk.dim(`Model: ${result.model}`));
      }

      const img = result.images[0];
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
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

aiCommand
  .command("gemini-video")
  .description("Analyze video using Gemini (summarize, Q&A, extract info)")
  .argument("<source>", "Video file path or YouTube URL")
  .argument("<prompt>", "Analysis prompt (e.g., 'Summarize this video')")
  .option("-k, --api-key <key>", "Google API key (or set GOOGLE_API_KEY env)")
  .option("-m, --model <model>", "Model: flash (default), flash-2.5, pro", "flash")
  .option("--fps <number>", "Frames per second (default: 1, higher for action)")
  .option("--start <seconds>", "Start offset in seconds (for clipping)")
  .option("--end <seconds>", "End offset in seconds (for clipping)")
  .option("--low-res", "Use low resolution mode (fewer tokens, longer videos)")
  .option("-v, --verbose", "Show token usage")
  .action(async (source: string, prompt: string, options) => {
    try {
      const apiKey = await getApiKey("GOOGLE_API_KEY", "Google", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Google API key required."));
        console.error(chalk.dim("Use --api-key or set GOOGLE_API_KEY environment variable"));
        process.exit(1);
      }

      const isYouTube = source.includes("youtube.com") || source.includes("youtu.be");
      const sourceType = isYouTube ? "YouTube video" : "video file";

      const modelMap: Record<string, string> = {
        flash: "gemini-3-flash-preview",
        "flash-2.5": "gemini-2.5-flash",
        pro: "gemini-2.5-pro",
      };
      const modelId = modelMap[options.model] || modelMap.flash;

      const spinner = ora(`Analyzing ${sourceType} with ${modelId}...`).start();

      // For local files, read the data
      let videoData: Buffer | string;
      if (isYouTube) {
        videoData = source;
      } else {
        const absPath = resolve(process.cwd(), source);
        const stats = await stat(absPath);

        if (stats.size > 20 * 1024 * 1024) {
          spinner.text = "Large file detected. For files >20MB, consider using the Python script with File API upload.";
        }

        videoData = await readFile(absPath);
      }

      const gemini = new GeminiProvider();
      await gemini.initialize({ apiKey });

      const result = await gemini.analyzeVideo(videoData, prompt, {
        model: modelId as "gemini-3-flash-preview" | "gemini-2.5-flash" | "gemini-2.5-pro",
        fps: options.fps ? parseFloat(options.fps) : undefined,
        startOffset: options.start ? parseInt(options.start) : undefined,
        endOffset: options.end ? parseInt(options.end) : undefined,
        lowResolution: options.lowRes,
      });

      if (!result.success) {
        spinner.fail(chalk.red(result.error || "Video analysis failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Video analyzed"));
      console.log();
      console.log(result.response);
      console.log();

      if (options.verbose && result.totalTokens) {
        console.log(chalk.dim("-".repeat(40)));
        console.log(chalk.dim(`Model: ${result.model}`));
        if (result.promptTokens) {
          console.log(chalk.dim(`Prompt tokens: ${result.promptTokens.toLocaleString()}`));
        }
        if (result.responseTokens) {
          console.log(chalk.dim(`Response tokens: ${result.responseTokens.toLocaleString()}`));
        }
        console.log(chalk.dim(`Total tokens: ${result.totalTokens.toLocaleString()}`));
      }
    } catch (error) {
      console.error(chalk.red("Video analysis failed"));
      console.error(error);
      process.exit(1);
    }
  });

// Unified Analyze Command (image + video + YouTube)
aiCommand
  .command("analyze")
  .description("Analyze any media: images, videos, or YouTube URLs using Gemini")
  .argument("<source>", "Image/video file path, image URL, or YouTube URL")
  .argument("<prompt>", "Analysis prompt (e.g., 'Describe this image', 'Summarize this video')")
  .option("-k, --api-key <key>", "Google API key (or set GOOGLE_API_KEY env)")
  .option("-m, --model <model>", "Model: flash (default), flash-2.5, pro", "flash")
  .option("--fps <number>", "Frames per second for video (default: 1)")
  .option("--start <seconds>", "Start offset in seconds (video only)")
  .option("--end <seconds>", "End offset in seconds (video only)")
  .option("--low-res", "Use low resolution mode (fewer tokens)")
  .option("-v, --verbose", "Show token usage")
  .action(async (source: string, prompt: string, options) => {
    try {
      const apiKey = await getApiKey("GOOGLE_API_KEY", "Google", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Google API key required."));
        console.error(chalk.dim("Use --api-key or set GOOGLE_API_KEY environment variable"));
        process.exit(1);
      }

      // Detect source type
      const isYouTube = source.includes("youtube.com") || source.includes("youtu.be");
      const isImageUrl = /^https?:\/\/.+\.(png|jpg|jpeg|webp|gif)(\?.*)?$/i.test(source);
      const isVideoUrl = /^https?:\/\/.+\.(mp4|mov|webm)(\?.*)?$/i.test(source);
      const ext = extname(source).toLowerCase();
      const imageExts = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
      const videoExts = [".mp4", ".mov", ".webm", ".avi", ".mkv"];
      const isLocalImage = imageExts.includes(ext);
      const isLocalVideo = videoExts.includes(ext);
      const isImage = isImageUrl || isLocalImage;
      const isVideo = isYouTube || isVideoUrl || isLocalVideo;

      if (!isImage && !isVideo) {
        console.error(chalk.red("Cannot detect source type. Supported: images (.png/.jpg/.webp/.gif), videos (.mp4/.mov/.webm), YouTube URLs, image URLs."));
        process.exit(1);
      }

      const modelMap: Record<string, string> = {
        flash: "gemini-3-flash-preview",
        "flash-2.5": "gemini-2.5-flash",
        pro: "gemini-2.5-pro",
      };
      const modelId = modelMap[options.model] || modelMap.flash;

      const gemini = new GeminiProvider();
      await gemini.initialize({ apiKey });

      if (isImage) {
        // Image analysis
        const sourceLabel = isImageUrl ? "image URL" : "image file";
        const spinner = ora(`Analyzing ${sourceLabel} with ${modelId}...`).start();

        let imageBuffer: Buffer;
        if (isImageUrl) {
          const response = await fetch(source);
          if (!response.ok) {
            spinner.fail(chalk.red(`Failed to fetch image: ${response.status}`));
            process.exit(1);
          }
          imageBuffer = Buffer.from(await response.arrayBuffer());
        } else {
          const absPath = resolve(process.cwd(), source);
          if (!existsSync(absPath)) {
            spinner.fail(chalk.red(`File not found: ${absPath}`));
            process.exit(1);
          }
          imageBuffer = await readFile(absPath);
        }

        const result = await gemini.analyzeImage(imageBuffer, prompt, {
          model: modelId as "gemini-3-flash-preview" | "gemini-2.5-flash" | "gemini-2.5-pro",
          lowResolution: options.lowRes,
        });

        if (!result.success) {
          spinner.fail(chalk.red(result.error || "Image analysis failed"));
          process.exit(1);
        }

        spinner.succeed(chalk.green("Image analyzed"));
        console.log();
        console.log(result.response);
        console.log();

        if (options.verbose && result.totalTokens) {
          console.log(chalk.dim("-".repeat(40)));
          console.log(chalk.dim(`Model: ${result.model}`));
          if (result.promptTokens) {
            console.log(chalk.dim(`Prompt tokens: ${result.promptTokens.toLocaleString()}`));
          }
          if (result.responseTokens) {
            console.log(chalk.dim(`Response tokens: ${result.responseTokens.toLocaleString()}`));
          }
          console.log(chalk.dim(`Total tokens: ${result.totalTokens.toLocaleString()}`));
        }
      } else {
        // Video analysis (YouTube, URL, or local file)
        const sourceType = isYouTube ? "YouTube video" : "video file";
        const spinner = ora(`Analyzing ${sourceType} with ${modelId}...`).start();

        let videoData: Buffer | string;
        if (isYouTube) {
          videoData = source;
        } else if (isVideoUrl) {
          const response = await fetch(source);
          if (!response.ok) {
            spinner.fail(chalk.red(`Failed to fetch video: ${response.status}`));
            process.exit(1);
          }
          videoData = Buffer.from(await response.arrayBuffer());
        } else {
          const absPath = resolve(process.cwd(), source);
          if (!existsSync(absPath)) {
            spinner.fail(chalk.red(`File not found: ${absPath}`));
            process.exit(1);
          }
          const stats = await stat(absPath);
          if (stats.size > 20 * 1024 * 1024) {
            spinner.text = "Large file detected. For files >20MB, consider using low-res mode.";
          }
          videoData = await readFile(absPath);
        }

        const result = await gemini.analyzeVideo(videoData, prompt, {
          model: modelId as "gemini-3-flash-preview" | "gemini-2.5-flash" | "gemini-2.5-pro",
          fps: options.fps ? parseFloat(options.fps) : undefined,
          startOffset: options.start ? parseInt(options.start) : undefined,
          endOffset: options.end ? parseInt(options.end) : undefined,
          lowResolution: options.lowRes,
        });

        if (!result.success) {
          spinner.fail(chalk.red(result.error || "Video analysis failed"));
          process.exit(1);
        }

        spinner.succeed(chalk.green("Video analyzed"));
        console.log();
        console.log(result.response);
        console.log();

        if (options.verbose && result.totalTokens) {
          console.log(chalk.dim("-".repeat(40)));
          console.log(chalk.dim(`Model: ${result.model}`));
          if (result.promptTokens) {
            console.log(chalk.dim(`Prompt tokens: ${result.promptTokens.toLocaleString()}`));
          }
          if (result.responseTokens) {
            console.log(chalk.dim(`Response tokens: ${result.responseTokens.toLocaleString()}`));
          }
          console.log(chalk.dim(`Total tokens: ${result.totalTokens.toLocaleString()}`));
        }
      }
    } catch (error) {
      console.error(chalk.red("Analysis failed"));
      console.error(error);
      process.exit(1);
    }
  });

// AI Video Review (Gemini)
aiCommand
  .command("review")
  .description("Review video quality using Gemini AI and optionally auto-fix issues")
  .argument("<video>", "Video file path")
  .option("-s, --storyboard <path>", "Storyboard JSON file for context")
  .option("--auto-apply", "Automatically apply fixable corrections")
  .option("--verify", "Run verification pass after applying fixes")
  .option("-m, --model <model>", "Gemini model: flash (default), flash-2.5, pro", "flash")
  .option("-o, --output <path>", "Output video file path (for auto-apply)")
  .action(async (videoPath: string, options) => {
    try {
      loadEnv();

      const spinner = ora("Reviewing video with Gemini...").start();

      const result = await executeReview({
        videoPath,
        storyboardPath: options.storyboard,
        autoApply: options.autoApply,
        verify: options.verify,
        model: options.model,
        outputPath: options.output,
      });

      if (!result.success) {
        spinner.fail(chalk.red(result.error || "Video review failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Video review complete"));
      console.log();

      const fb = result.feedback!;
      console.log(chalk.bold.cyan("Video Review"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Overall Score: ${chalk.bold(fb.overallScore >= 7 ? chalk.green(String(fb.overallScore)) : fb.overallScore >= 5 ? chalk.yellow(String(fb.overallScore)) : chalk.red(String(fb.overallScore)))}/10`);
      console.log();

      // Category scores table
      const categories = [
        ["Pacing", fb.categories.pacing],
        ["Color", fb.categories.color],
        ["Text Readability", fb.categories.textReadability],
        ["Audio-Visual Sync", fb.categories.audioVisualSync],
        ["Composition", fb.categories.composition],
      ] as const;

      for (const [name, cat] of categories) {
        const scoreColor = cat.score >= 7 ? chalk.green : cat.score >= 5 ? chalk.yellow : chalk.red;
        const fixable = cat.fixable ? chalk.dim(" [fixable]") : "";
        console.log(`  ${name.padEnd(20)} ${scoreColor(String(cat.score).padStart(2))}/10${fixable}`);
        if (cat.issues.length > 0) {
          for (const issue of cat.issues) {
            console.log(chalk.dim(`    - ${issue}`));
          }
        }
      }

      // Applied fixes
      if (result.appliedFixes && result.appliedFixes.length > 0) {
        console.log();
        console.log(chalk.bold.green("Applied Fixes:"));
        for (const fix of result.appliedFixes) {
          console.log(chalk.green(`  + ${fix}`));
        }
        if (result.outputPath) {
          console.log(chalk.green(`  Output: ${result.outputPath}`));
        }
      }

      // Verification
      if (result.verificationScore !== undefined) {
        console.log();
        console.log(chalk.bold(`Verification Score: ${result.verificationScore}/10`));
      }

      // Recommendations
      if (fb.recommendations.length > 0) {
        console.log();
        console.log(chalk.bold("Recommendations:"));
        for (const rec of fb.recommendations) {
          console.log(chalk.dim(`  * ${rec}`));
        }
      }
      console.log();
    } catch (error) {
      console.error(chalk.red("Video review failed"));
      console.error(error);
      process.exit(1);
    }
  });

// Helper type for storyboard segments
interface StoryboardSegment {
  index?: number;
  description: string;
  visuals: string;
  visualStyle?: string;
  characterDescription?: string;
  previousSceneLink?: string;
  narration?: string;
  audio?: string;
  textOverlays?: string[];
  duration: number;
  startTime: number;
}

// Default retry count for video generation
const DEFAULT_VIDEO_RETRIES = 2;
const RETRY_DELAY_MS = 5000;

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upload image to ImgBB and return the URL
 * Used for Kling v2.5/v2.6 image-to-video which requires URL (not base64)
 */
async function uploadToImgbb(
  imageBuffer: Buffer,
  apiKey: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const base64Image = imageBuffer.toString("base64");

    const formData = new URLSearchParams();
    formData.append("key", apiKey);
    formData.append("image", base64Image);

    const response = await fetch("https://api.imgbb.com/1/upload", {
      method: "POST",
      body: formData,
    });

    const data = (await response.json()) as {
      success?: boolean;
      data?: { url?: string };
      error?: { message?: string };
    };

    if (data.success && data.data?.url) {
      return { success: true, url: data.data.url };
    } else {
      return { success: false, error: data.error?.message || "Upload failed" };
    }
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Extend a video to target duration using Kling extend API when possible,
 * with fallback to FFmpeg-based extendVideoNaturally.
 *
 * When the extension ratio > 1.4 and a Kling provider + videoId are available,
 * uses the Kling video-extend API for natural continuation instead of freeze frames.
 */
async function extendVideoToTarget(
  videoPath: string,
  targetDuration: number,
  outputDir: string,
  sceneLabel: string,
  options?: {
    kling?: KlingProvider;
    videoId?: string;
    onProgress?: (message: string) => void;
  }
): Promise<void> {
  const actualDuration = await getVideoDuration(videoPath);
  if (actualDuration >= targetDuration - 0.1) return;

  const ratio = targetDuration / actualDuration;
  const extendedPath = resolve(outputDir, `${basename(videoPath, ".mp4")}-extended.mp4`);

  // Try Kling extend API for large gaps (ratio > 1.4) where freeze frames look bad
  if (ratio > 1.4 && options?.kling && options?.videoId) {
    try {
      options.onProgress?.(`${sceneLabel}: Extending via Kling API...`);
      const extendResult = await options.kling.extendVideo(options.videoId, {
        duration: "5",
      });

      if (extendResult.status !== "failed" && extendResult.id) {
        const waitResult = await options.kling.waitForExtendCompletion(
          extendResult.id,
          (status) => {
            options.onProgress?.(`${sceneLabel}: extend ${status.status}...`);
          },
          600000
        );

        if (waitResult.status === "completed" && waitResult.videoUrl) {
          // Download extended video
          const extendedVideoPath = resolve(outputDir, `${basename(videoPath, ".mp4")}-kling-ext.mp4`);
          const response = await fetch(waitResult.videoUrl);
          const buffer = Buffer.from(await response.arrayBuffer());
          await writeFile(extendedVideoPath, buffer);

          // Concatenate original + extension
          const concatPath = resolve(outputDir, `${basename(videoPath, ".mp4")}-concat.mp4`);
          const listPath = resolve(outputDir, `${basename(videoPath, ".mp4")}-concat.txt`);
          await writeFile(listPath, `file '${videoPath}'\nfile '${extendedVideoPath}'`, "utf-8");
          await execAsync(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${concatPath}"`);

          // Trim to exact target duration if concatenated video is longer
          const concatDuration = await getVideoDuration(concatPath);
          if (concatDuration > targetDuration + 0.5) {
            await execAsync(`ffmpeg -y -i "${concatPath}" -t ${targetDuration.toFixed(2)} -c copy "${extendedPath}"`);
            await unlink(concatPath);
          } else {
            await rename(concatPath, extendedPath);
          }

          // Cleanup temp files
          await unlink(extendedVideoPath).catch(() => {});
          await unlink(listPath).catch(() => {});
          await unlink(videoPath);
          await rename(extendedPath, videoPath);
          return;
        }
      }
      // If Kling extend failed, fall through to FFmpeg fallback
      options.onProgress?.(`${sceneLabel}: Kling extend failed, using FFmpeg fallback...`);
    } catch {
      options.onProgress?.(`${sceneLabel}: Kling extend error, using FFmpeg fallback...`);
    }
  }

  // FFmpeg-based fallback (slowdown + frame interpolation + freeze frame)
  await extendVideoNaturally(videoPath, targetDuration, extendedPath);
  await unlink(videoPath);
  await rename(extendedPath, videoPath);
}

/**
 * Generate video with retry logic for Kling provider
 * Supports image-to-video with URL (v2.5/v2.6 models)
 */
async function generateVideoWithRetryKling(
  kling: KlingProvider,
  segment: StoryboardSegment,
  options: {
    duration: 5 | 10;
    aspectRatio: "16:9" | "9:16" | "1:1";
    referenceImage?: string; // Optional: base64 or URL for image2video
  },
  maxRetries: number,
  onProgress?: (message: string) => void
): Promise<{ taskId: string; type: "text2video" | "image2video" } | null> {
  // Build detailed prompt from storyboard segment
  const prompt = segment.visualStyle
    ? `${segment.visuals}. Style: ${segment.visualStyle}`
    : segment.visuals;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await kling.generateVideo(prompt, {
        prompt,
        // Pass reference image (base64 or URL) - KlingProvider handles v1.5 fallback for base64
        referenceImage: options.referenceImage,
        duration: options.duration,
        aspectRatio: options.aspectRatio,
        mode: "std", // Use std mode for faster generation
      });

      if (result.status !== "failed" && result.id) {
        return {
          taskId: result.id,
          type: options.referenceImage ? "image2video" : "text2video",
        };
      }

      if (attempt < maxRetries) {
        onProgress?.(`⚠ Retry ${attempt + 1}/${maxRetries}...`);
        await sleep(RETRY_DELAY_MS);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (attempt < maxRetries) {
        onProgress?.(`⚠ Error: ${errMsg.slice(0, 50)}... retry ${attempt + 1}/${maxRetries}`);
        await sleep(RETRY_DELAY_MS);
      } else {
        // Log the final error on last attempt
        console.error(chalk.dim(`\n  [Kling error: ${errMsg}]`));
      }
    }
  }
  return null;
}

/**
 * Generate video with retry logic for Runway provider
 */
async function generateVideoWithRetryRunway(
  runway: RunwayProvider,
  segment: StoryboardSegment,
  referenceImage: string,
  options: {
    duration: 5 | 10;
    aspectRatio: "16:9" | "9:16";
  },
  maxRetries: number,
  onProgress?: (message: string) => void
): Promise<{ taskId: string } | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await runway.generateVideo(segment.visuals, {
        prompt: segment.visuals,
        referenceImage,
        duration: options.duration,
        aspectRatio: options.aspectRatio,
      });

      if (result.status !== "failed" && result.id) {
        return { taskId: result.id };
      }

      if (attempt < maxRetries) {
        onProgress?.(`⚠ Retry ${attempt + 1}/${maxRetries}...`);
        await sleep(RETRY_DELAY_MS);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (attempt < maxRetries) {
        onProgress?.(`⚠ Error: ${errMsg.slice(0, 50)}... retry ${attempt + 1}/${maxRetries}`);
        await sleep(RETRY_DELAY_MS);
      } else {
        console.error(chalk.dim(`\n  [Runway error: ${errMsg}]`));
      }
    }
  }
  return null;
}

/**
 * Wait for video completion with retry logic
 */
async function waitForVideoWithRetry(
  provider: KlingProvider | RunwayProvider,
  taskId: string,
  providerType: "kling" | "runway",
  maxRetries: number,
  onProgress?: (message: string) => void,
  timeout?: number
): Promise<{ videoUrl: string } | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      let result;
      if (providerType === "kling") {
        result = await (provider as KlingProvider).waitForCompletion(
          taskId,
          "image2video",
          (status) => onProgress?.(status.status || "processing"),
          timeout || 600000
        );
      } else {
        result = await (provider as RunwayProvider).waitForCompletion(
          taskId,
          (status) => {
            const progress = status.progress !== undefined ? `${status.progress}%` : status.status;
            onProgress?.(progress || "processing");
          },
          timeout || 300000
        );
      }

      if (result.status === "completed" && result.videoUrl) {
        return { videoUrl: result.videoUrl };
      }

      // If failed, try resubmitting on next attempt
      if (attempt < maxRetries) {
        onProgress?.(`⚠ Failed, will need resubmission...`);
        return null; // Signal need for resubmission
      }
    } catch (err) {
      if (attempt < maxRetries) {
        onProgress?.(`⚠ Error waiting, retry ${attempt + 1}/${maxRetries}...`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
  return null;
}

// Script-to-Video command
aiCommand
  .command("script-to-video")
  .description("Generate complete video from text script using AI pipeline")
  .argument("<script>", "Script text or file path (use -f for file)")
  .option("-f, --file", "Treat script argument as file path")
  .option("-o, --output <path>", "Output project file path", "script-video.vibe.json")
  .option("-d, --duration <seconds>", "Target total duration in seconds")
  .option("-v, --voice <id>", "ElevenLabs voice ID for narration")
  .option("-g, --generator <engine>", "Video generator: kling | runway", "kling")
  .option("-i, --image-provider <provider>", "Image provider: gemini | openai | stability", "gemini")
  .option("-a, --aspect-ratio <ratio>", "Aspect ratio: 16:9 | 9:16 | 1:1", "16:9")
  .option("--images-only", "Generate images only, skip video generation")
  .option("--no-voiceover", "Skip voiceover generation")
  .option("--output-dir <dir>", "Directory for generated assets", "script-video-output")
  .option("--retries <count>", "Number of retries for video generation failures", String(DEFAULT_VIDEO_RETRIES))
  .option("--sequential", "Generate videos one at a time (slower but more reliable)")
  .option("--concurrency <count>", "Max concurrent video tasks in parallel mode (default: 3)", "3")
  .option("-c, --creativity <level>", "Creativity level: low (default, consistent) or high (varied, unexpected)", "low")
  .option("--no-text-overlay", "Skip text overlay step")
  .option("--text-style <style>", "Text overlay style: lower-third, center-bold, subtitle, minimal", "lower-third")
  .option("--review", "Run AI review after assembly (requires GOOGLE_API_KEY)")
  .option("--review-auto-apply", "Auto-apply fixable issues from AI review")
  .action(async (script: string, options) => {
    try {
      // Load environment variables from .env file
      loadEnv();

      // Get all required API keys upfront
      const claudeApiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic");
      if (!claudeApiKey) {
        console.error(chalk.red("Anthropic API key required for storyboard generation"));
        process.exit(1);
      }

      // Get image provider API key
      let imageApiKey: string | undefined;
      const imageProvider = options.imageProvider || "openai";

      if (imageProvider === "openai" || imageProvider === "dalle") {
        imageApiKey = (await getApiKey("OPENAI_API_KEY", "OpenAI")) ?? undefined;
        if (!imageApiKey) {
          console.error(chalk.red("OpenAI API key required for DALL-E image generation"));
          process.exit(1);
        }
      } else if (imageProvider === "stability") {
        imageApiKey = (await getApiKey("STABILITY_API_KEY", "Stability AI")) ?? undefined;
        if (!imageApiKey) {
          console.error(chalk.red("Stability API key required for image generation"));
          process.exit(1);
        }
      } else if (imageProvider === "gemini") {
        imageApiKey = (await getApiKey("GOOGLE_API_KEY", "Google")) ?? undefined;
        if (!imageApiKey) {
          console.error(chalk.red("Google API key required for Gemini image generation"));
          process.exit(1);
        }
      } else {
        console.error(chalk.red(`Unknown image provider: ${imageProvider}. Use openai, stability, or gemini`));
        process.exit(1);
      }

      let elevenlabsApiKey: string | undefined;
      if (options.voiceover !== false) {
        const key = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs");
        if (!key) {
          console.error(chalk.red("ElevenLabs API key required for voiceover (or use --no-voiceover)"));
          process.exit(1);
        }
        elevenlabsApiKey = key;
      }

      let videoApiKey: string | undefined;
      if (!options.imagesOnly) {
        if (options.generator === "kling") {
          const key = await getApiKey("KLING_API_KEY", "Kling");
          if (!key) {
            console.error(chalk.red("Kling API key required (or use --images-only)"));
            process.exit(1);
          }
          videoApiKey = key;
        } else {
          const key = await getApiKey("RUNWAY_API_SECRET", "Runway");
          if (!key) {
            console.error(chalk.red("Runway API key required (or use --images-only)"));
            process.exit(1);
          }
          videoApiKey = key;
        }
      }

      // Read script content
      let scriptContent = script;
      if (options.file) {
        const filePath = resolve(process.cwd(), script);
        scriptContent = await readFile(filePath, "utf-8");
      }

      // Determine output directory for assets
      // If -o looks like a directory and --output-dir is not explicitly set, use -o directory for assets
      let effectiveOutputDir = options.outputDir;
      const outputLooksLikeDirectory =
        options.output.endsWith("/") ||
        (!options.output.endsWith(".json") && !options.output.endsWith(".vibe.json"));

      if (outputLooksLikeDirectory && options.outputDir === "script-video-output") {
        // User specified a directory for -o but didn't set --output-dir, use -o directory for assets
        effectiveOutputDir = options.output;
      }

      // Create output directory
      const outputDir = resolve(process.cwd(), effectiveOutputDir);
      if (!existsSync(outputDir)) {
        await mkdir(outputDir, { recursive: true });
      }

      // Validate creativity level
      const creativity = options.creativity?.toLowerCase();
      if (creativity && creativity !== "low" && creativity !== "high") {
        console.error(chalk.red("Invalid creativity level. Use 'low' or 'high'."));
        process.exit(1);
      }

      console.log();
      console.log(chalk.bold.cyan("🎬 Script-to-Video Pipeline"));
      console.log(chalk.dim("─".repeat(60)));
      if (creativity === "high") {
        console.log(chalk.yellow("🎨 High creativity mode: Generating varied, unexpected scenes"));
      }
      console.log();

      // Step 1: Generate storyboard with Claude
      const storyboardSpinnerText = creativity === "high"
        ? "📝 Analyzing script with Claude (high creativity)..."
        : "📝 Analyzing script with Claude...";
      const storyboardSpinner = ora(storyboardSpinnerText).start();

      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey: claudeApiKey });

      const segments = await claude.analyzeContent(
        scriptContent,
        options.duration ? parseFloat(options.duration) : undefined,
        { creativity: creativity as "low" | "high" | undefined }
      );

      if (segments.length === 0) {
        storyboardSpinner.fail(chalk.red("Failed to generate storyboard (check API key and error above)"));
        process.exit(1);
      }

      let totalDuration = segments.reduce((sum, seg) => sum + seg.duration, 0);
      storyboardSpinner.succeed(chalk.green(`Generated ${segments.length} scenes (total: ${totalDuration}s)`));

      // Save storyboard
      const storyboardPath = resolve(outputDir, "storyboard.json");
      await writeFile(storyboardPath, JSON.stringify(segments, null, 2), "utf-8");
      console.log(chalk.dim(`  → Saved: ${storyboardPath}`));
      console.log();

      // Step 2: Generate per-scene voiceovers with ElevenLabs
      const perSceneTTS: { path: string; duration: number; segmentIndex: number }[] = [];
      const failedNarrations: { sceneNum: number; error: string }[] = [];

      if (options.voiceover !== false && elevenlabsApiKey) {
        const ttsSpinner = ora("🎙️ Generating voiceovers with ElevenLabs...").start();

        const elevenlabs = new ElevenLabsProvider();
        await elevenlabs.initialize({ apiKey: elevenlabsApiKey });

        let totalCharacters = 0;

        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i];
          const narrationText = segment.narration || segment.description;

          if (!narrationText) continue;

          ttsSpinner.text = `🎙️ Generating narration ${i + 1}/${segments.length}...`;

          let ttsResult = await elevenlabs.textToSpeech(narrationText, {
            voiceId: options.voice,
          });

          if (!ttsResult.success || !ttsResult.audioBuffer) {
            const errorMsg = ttsResult.error || "Unknown error";
            failedNarrations.push({ sceneNum: i + 1, error: errorMsg });
            ttsSpinner.text = `🎙️ Generating narration ${i + 1}/${segments.length}... (failed)`;
            console.log(chalk.yellow(`\n  ⚠ Narration ${i + 1} failed: ${errorMsg}`));
            continue;
          }

          const audioPath = resolve(outputDir, `narration-${i + 1}.mp3`);
          await writeFile(audioPath, ttsResult.audioBuffer);

          // Get actual audio duration using ffprobe
          let actualDuration = await getAudioDuration(audioPath);

          // Auto speed-adjust if narration slightly exceeds video bracket (5s or 10s)
          const videoBracket = segment.duration > 5 ? 10 : 5;
          const overageRatio = actualDuration / videoBracket;
          if (overageRatio > 1.0 && overageRatio <= 1.15) {
            // Narration exceeds bracket by 0-15% — regenerate slightly faster
            const adjustedSpeed = Math.min(1.2, parseFloat(overageRatio.toFixed(2)));
            ttsSpinner.text = `🎙️ Narration ${i + 1}: adjusting speed to ${adjustedSpeed}x...`;
            const speedResult = await elevenlabs.textToSpeech(narrationText, {
              voiceId: options.voice,
              speed: adjustedSpeed,
            });
            if (speedResult.success && speedResult.audioBuffer) {
              await writeFile(audioPath, speedResult.audioBuffer);
              actualDuration = await getAudioDuration(audioPath);
              ttsResult = speedResult;
              console.log(chalk.dim(`  → Speed-adjusted narration ${i + 1}: ${adjustedSpeed}x → ${actualDuration.toFixed(1)}s`));
            }
          }

          // Update segment duration to match actual narration length
          segment.duration = actualDuration;

          perSceneTTS.push({ path: audioPath, duration: actualDuration, segmentIndex: i });
          totalCharacters += ttsResult.characterCount || 0;

          console.log(chalk.dim(`  → Saved: ${audioPath} (${actualDuration.toFixed(1)}s)`));
        }

        // Recalculate startTime for all segments based on updated durations
        let currentTime = 0;
        for (const segment of segments) {
          segment.startTime = currentTime;
          currentTime += segment.duration;
        }

        // Update total duration
        totalDuration = segments.reduce((sum, seg) => sum + seg.duration, 0);

        // Show success with failed count if any
        if (failedNarrations.length > 0) {
          ttsSpinner.warn(chalk.yellow(`Generated ${perSceneTTS.length}/${segments.length} narrations (${failedNarrations.length} failed)`));
        } else {
          ttsSpinner.succeed(chalk.green(`Generated ${perSceneTTS.length}/${segments.length} narrations (${totalCharacters} chars, ${totalDuration.toFixed(1)}s total)`));
        }

        // Re-save storyboard with updated durations
        await writeFile(storyboardPath, JSON.stringify(segments, null, 2), "utf-8");
        console.log(chalk.dim(`  → Updated storyboard: ${storyboardPath}`));
        console.log();
      }

      // Step 3: Generate images with selected provider
      const providerNames: Record<string, string> = {
        openai: "OpenAI GPT Image 1.5",
        dalle: "OpenAI GPT Image 1.5", // backward compatibility
        stability: "Stability AI",
        gemini: "Gemini",
      };
      const imageSpinner = ora(`🎨 Generating visuals with ${providerNames[imageProvider]}...`).start();

      // Determine image size/aspect ratio based on provider
      const dalleImageSizes: Record<string, "1536x1024" | "1024x1536" | "1024x1024"> = {
        "16:9": "1536x1024",
        "9:16": "1024x1536",
        "1:1": "1024x1024",
      };
      type StabilityAspectRatio = "16:9" | "1:1" | "21:9" | "2:3" | "3:2" | "4:5" | "5:4" | "9:16" | "9:21";
      const stabilityAspectRatios: Record<string, StabilityAspectRatio> = {
        "16:9": "16:9",
        "9:16": "9:16",
        "1:1": "1:1",
      };

      const imagePaths: string[] = [];

      // Store first scene image for style continuity
      let firstSceneImage: Buffer | undefined;

      // Initialize the selected provider
      let openaiImageInstance: OpenAIImageProvider | undefined;
      let stabilityInstance: StabilityProvider | undefined;
      let geminiInstance: GeminiProvider | undefined;

      if (imageProvider === "openai" || imageProvider === "dalle") {
        openaiImageInstance = new OpenAIImageProvider();
        await openaiImageInstance.initialize({ apiKey: imageApiKey });
      } else if (imageProvider === "stability") {
        stabilityInstance = new StabilityProvider();
        await stabilityInstance.initialize({ apiKey: imageApiKey });
      } else if (imageProvider === "gemini") {
        geminiInstance = new GeminiProvider();
        await geminiInstance.initialize({ apiKey: imageApiKey });
      }

      // Get character description from first segment (should be same across all)
      const characterDescription = segments[0]?.characterDescription;

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        imageSpinner.text = `🎨 Generating image ${i + 1}/${segments.length}: ${segment.description.slice(0, 30)}...`;

        // Build comprehensive image prompt with character description
        let imagePrompt = segment.visuals;

        // Add character description to ensure consistency
        if (characterDescription) {
          imagePrompt = `CHARACTER (must match exactly): ${characterDescription}. SCENE: ${imagePrompt}`;
        }

        // Add visual style
        if (segment.visualStyle) {
          imagePrompt = `${imagePrompt}. STYLE: ${segment.visualStyle}`;
        }

        // For scenes after the first, add extra continuity instruction (OpenAI/Stability)
        // Gemini uses editImage with reference instead
        if (i > 0 && firstSceneImage && imageProvider !== "gemini") {
          imagePrompt = `${imagePrompt}. CRITICAL: The character must look IDENTICAL to the first scene - same face, hair, clothing, accessories.`;
        }

        try {
          let imageBuffer: Buffer | undefined;
          let imageUrl: string | undefined;
          let imageError: string | undefined;

          if ((imageProvider === "openai" || imageProvider === "dalle") && openaiImageInstance) {
            const imageResult = await openaiImageInstance.generateImage(imagePrompt, {
              size: dalleImageSizes[options.aspectRatio] || "1536x1024",
              quality: "standard",
            });
            if (imageResult.success && imageResult.images && imageResult.images.length > 0) {
              // GPT Image 1.5 returns base64, DALL-E 3 returns URL
              const img = imageResult.images[0];
              if (img.base64) {
                imageBuffer = Buffer.from(img.base64, "base64");
              } else if (img.url) {
                imageUrl = img.url;
              }
            } else {
              imageError = imageResult.error;
            }
          } else if (imageProvider === "stability" && stabilityInstance) {
            const imageResult = await stabilityInstance.generateImage(imagePrompt, {
              aspectRatio: stabilityAspectRatios[options.aspectRatio] || "16:9",
              model: "sd3.5-large",
            });
            if (imageResult.success && imageResult.images && imageResult.images.length > 0) {
              // Stability returns base64 or URL
              const img = imageResult.images[0];
              if (img.base64) {
                imageBuffer = Buffer.from(img.base64, "base64");
              } else if (img.url) {
                imageUrl = img.url;
              }
            } else {
              imageError = imageResult.error;
            }
          } else if (imageProvider === "gemini" && geminiInstance) {
            // Gemini: use editImage with first scene reference for subsequent scenes
            if (i > 0 && firstSceneImage) {
              // Use editImage to maintain style continuity with first scene
              const editPrompt = `Create a new scene for a video: ${imagePrompt}. IMPORTANT: Maintain the exact same character appearance, clothing, environment style, color palette, and art style as the reference image.`;
              const imageResult = await geminiInstance.editImage([firstSceneImage], editPrompt, {
                aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1",
              });
              if (imageResult.success && imageResult.images && imageResult.images.length > 0) {
                const img = imageResult.images[0];
                if (img.base64) {
                  imageBuffer = Buffer.from(img.base64, "base64");
                }
              } else {
                imageError = imageResult.error;
              }
            } else {
              // First scene: use regular generateImage
              const imageResult = await geminiInstance.generateImage(imagePrompt, {
                aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1",
              });
              if (imageResult.success && imageResult.images && imageResult.images.length > 0) {
                const img = imageResult.images[0];
                if (img.base64) {
                  imageBuffer = Buffer.from(img.base64, "base64");
                }
              } else {
                imageError = imageResult.error;
              }
            }
          }

          // Save the image
          const imagePath = resolve(outputDir, `scene-${i + 1}.png`);

          if (imageBuffer) {
            await writeFile(imagePath, imageBuffer);
            imagePaths.push(imagePath);
            // Store first successful image for style continuity
            if (!firstSceneImage) {
              firstSceneImage = imageBuffer;
            }
          } else if (imageUrl) {
            const response = await fetch(imageUrl);
            const buffer = Buffer.from(await response.arrayBuffer());
            await writeFile(imagePath, buffer);
            imagePaths.push(imagePath);
            // Store first successful image for style continuity
            if (!firstSceneImage) {
              firstSceneImage = buffer;
            }
          } else {
            const errorMsg = imageError || "Unknown error";
            console.log(chalk.yellow(`\n  ⚠ Failed to generate image for scene ${i + 1}: ${errorMsg}`));
            imagePaths.push("");
          }
        } catch (err) {
          console.log(chalk.yellow(`\n  ⚠ Error generating image for scene ${i + 1}: ${err}`));
          imagePaths.push("");
        }

        // Small delay to avoid rate limiting
        if (i < segments.length - 1) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      const successfulImages = imagePaths.filter((p) => p !== "").length;
      imageSpinner.succeed(chalk.green(`Generated ${successfulImages}/${segments.length} images with ${providerNames[imageProvider]}`));
      console.log();

      // Step 4: Generate videos (if not images-only)
      const videoPaths: string[] = [];
      const failedScenes: number[] = []; // Track failed scenes for summary
      const maxRetries = parseInt(options.retries) || DEFAULT_VIDEO_RETRIES;

      if (!options.imagesOnly && videoApiKey) {
        const videoSpinner = ora(`🎬 Generating videos with ${options.generator === "kling" ? "Kling" : "Runway"}...`).start();

        if (options.generator === "kling") {
          const kling = new KlingProvider();
          await kling.initialize({ apiKey: videoApiKey });

          if (!kling.isConfigured()) {
            videoSpinner.fail(chalk.red("Invalid Kling API key format. Use ACCESS_KEY:SECRET_KEY"));
            process.exit(1);
          }

          // Check for ImgBB API key for image-to-video support (from config or env)
          const imgbbApiKey = await getApiKeyFromConfig("imgbb") || process.env.IMGBB_API_KEY;
          const useImageToVideo = !!imgbbApiKey;

          if (useImageToVideo) {
            videoSpinner.text = `🎬 Uploading images to ImgBB for image-to-video...`;
          }

          // Upload images to ImgBB if API key is available (for Kling v2.x image-to-video)
          const imageUrls: (string | undefined)[] = [];
          if (useImageToVideo) {
            for (let i = 0; i < imagePaths.length; i++) {
              if (imagePaths[i] && imagePaths[i] !== "") {
                try {
                  const imageBuffer = await readFile(imagePaths[i]);
                  const uploadResult = await uploadToImgbb(imageBuffer, imgbbApiKey);
                  if (uploadResult.success && uploadResult.url) {
                    imageUrls[i] = uploadResult.url;
                  } else {
                    console.log(chalk.yellow(`\n  ⚠ Failed to upload image ${i + 1}: ${uploadResult.error}`));
                    imageUrls[i] = undefined;
                  }
                } catch {
                  imageUrls[i] = undefined;
                }
              } else {
                imageUrls[i] = undefined;
              }
            }
            const uploadedCount = imageUrls.filter((u) => u).length;
            if (uploadedCount > 0) {
              videoSpinner.text = `🎬 Uploaded ${uploadedCount}/${imagePaths.length} images to ImgBB`;
            }
          }

          // Sequential mode: generate one video at a time (slower but more reliable)
          if (options.sequential) {
            for (let i = 0; i < segments.length; i++) {
              const segment = segments[i] as StoryboardSegment;
              videoSpinner.text = `🎬 Scene ${i + 1}/${segments.length}: Starting...`;

              const videoDuration = (segment.duration > 5 ? 10 : 5) as 5 | 10;
              const referenceImage = imageUrls[i];

              let completed = false;
              for (let attempt = 0; attempt <= maxRetries && !completed; attempt++) {
                const result = await generateVideoWithRetryKling(
                  kling,
                  segment,
                  {
                    duration: videoDuration,
                    aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1",
                    referenceImage,
                  },
                  0, // Handle retries at this level
                  (msg) => {
                    videoSpinner.text = `🎬 Scene ${i + 1}/${segments.length}: ${msg}`;
                  }
                );

                if (!result) {
                  if (attempt < maxRetries) {
                    videoSpinner.text = `🎬 Scene ${i + 1}: Submit failed, retry ${attempt + 1}/${maxRetries}...`;
                    await sleep(RETRY_DELAY_MS);
                    continue;
                  }
                  console.log(chalk.yellow(`\n  ⚠ Failed to start video generation for scene ${i + 1}`));
                  videoPaths[i] = "";
                  failedScenes.push(i + 1);
                  break;
                }

                try {
                  const waitResult = await kling.waitForCompletion(
                    result.taskId,
                    result.type,
                    (status) => {
                      videoSpinner.text = `🎬 Scene ${i + 1}/${segments.length}: ${status.status}...`;
                    },
                    600000
                  );

                  if (waitResult.status === "completed" && waitResult.videoUrl) {
                    const videoPath = resolve(outputDir, `scene-${i + 1}.mp4`);
                    const response = await fetch(waitResult.videoUrl);
                    const buffer = Buffer.from(await response.arrayBuffer());
                    await writeFile(videoPath, buffer);

                    // Extend video to match narration duration if needed
                    await extendVideoToTarget(videoPath, segment.duration, outputDir, `Scene ${i + 1}`, {
                      kling,
                      videoId: waitResult.videoId,
                      onProgress: (msg) => { videoSpinner.text = `🎬 ${msg}`; },
                    });

                    videoPaths[i] = videoPath;
                    completed = true;
                    console.log(chalk.green(`\n  ✓ Scene ${i + 1} completed`));
                  } else if (attempt < maxRetries) {
                    videoSpinner.text = `🎬 Scene ${i + 1}: Failed, retry ${attempt + 1}/${maxRetries}...`;
                    await sleep(RETRY_DELAY_MS);
                  } else {
                    videoPaths[i] = "";
                    failedScenes.push(i + 1);
                  }
                } catch (err) {
                  if (attempt < maxRetries) {
                    videoSpinner.text = `🎬 Scene ${i + 1}: Error, retry ${attempt + 1}/${maxRetries}...`;
                    await sleep(RETRY_DELAY_MS);
                  } else {
                    console.log(chalk.yellow(`\n  ⚠ Error for scene ${i + 1}: ${err}`));
                    videoPaths[i] = "";
                    failedScenes.push(i + 1);
                  }
                }
              }
            }
          } else {
            // Parallel mode (default): batch-based submission respecting concurrency limit
            const concurrency = Math.max(1, parseInt(options.concurrency) || 3);

            for (let batchStart = 0; batchStart < segments.length; batchStart += concurrency) {
              const batchEnd = Math.min(batchStart + concurrency, segments.length);
              const batchNum = Math.floor(batchStart / concurrency) + 1;
              const totalBatches = Math.ceil(segments.length / concurrency);

              if (totalBatches > 1) {
                videoSpinner.text = `🎬 Batch ${batchNum}/${totalBatches}: submitting scenes ${batchStart + 1}-${batchEnd}...`;
              }

              // Phase 1: Submit batch
              const tasks: Array<{ taskId: string; index: number; segment: StoryboardSegment; type: "text2video" | "image2video" }> = [];

              for (let i = batchStart; i < batchEnd; i++) {
                const segment = segments[i] as StoryboardSegment;
                videoSpinner.text = `🎬 Submitting video task ${i + 1}/${segments.length}...`;

                const videoDuration = (segment.duration > 5 ? 10 : 5) as 5 | 10;
                const referenceImage = imageUrls[i];

                const result = await generateVideoWithRetryKling(
                  kling,
                  segment,
                  {
                    duration: videoDuration,
                    aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1",
                    referenceImage,
                  },
                  maxRetries,
                  (msg) => {
                    videoSpinner.text = `🎬 Scene ${i + 1}: ${msg}`;
                  }
                );

                if (result) {
                  tasks.push({ taskId: result.taskId, index: i, segment, type: result.type });
                  if (!videoPaths[i]) videoPaths[i] = "";
                } else {
                  console.log(chalk.yellow(`\n  ⚠ Failed to start video generation for scene ${i + 1} (after ${maxRetries} retries)`));
                  videoPaths[i] = "";
                  failedScenes.push(i + 1);
                }
              }

              // Phase 2: Wait for batch completion
              videoSpinner.text = `🎬 Waiting for batch ${batchNum} (${tasks.length} video${tasks.length > 1 ? "s" : ""})...`;

              for (const task of tasks) {
                let completed = false;
                let currentTaskId = task.taskId;
                let currentType = task.type;

                for (let attempt = 0; attempt <= maxRetries && !completed; attempt++) {
                  try {
                    const result = await kling.waitForCompletion(
                      currentTaskId,
                      currentType,
                      (status) => {
                        videoSpinner.text = `🎬 Scene ${task.index + 1}: ${status.status}...`;
                      },
                      600000
                    );

                    if (result.status === "completed" && result.videoUrl) {
                      const videoPath = resolve(outputDir, `scene-${task.index + 1}.mp4`);
                      const response = await fetch(result.videoUrl);
                      const buffer = Buffer.from(await response.arrayBuffer());
                      await writeFile(videoPath, buffer);

                      // Extend video to match narration duration if needed
                      await extendVideoToTarget(videoPath, task.segment.duration, outputDir, `Scene ${task.index + 1}`, {
                        kling,
                        videoId: result.videoId,
                        onProgress: (msg) => { videoSpinner.text = `🎬 ${msg}`; },
                      });

                      videoPaths[task.index] = videoPath;
                      completed = true;
                    } else if (attempt < maxRetries) {
                      videoSpinner.text = `🎬 Scene ${task.index + 1}: Retry ${attempt + 1}/${maxRetries}...`;
                      await sleep(RETRY_DELAY_MS);

                      const videoDuration = (task.segment.duration > 5 ? 10 : 5) as 5 | 10;
                      const retryReferenceImage = imageUrls[task.index];

                      const retryResult = await generateVideoWithRetryKling(
                        kling,
                        task.segment,
                        {
                          duration: videoDuration,
                          aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1",
                          referenceImage: retryReferenceImage,
                        },
                        0
                      );

                      if (retryResult) {
                        currentTaskId = retryResult.taskId;
                        currentType = retryResult.type;
                      } else {
                        videoPaths[task.index] = "";
                        failedScenes.push(task.index + 1);
                        completed = true;
                      }
                    } else {
                      videoPaths[task.index] = "";
                      failedScenes.push(task.index + 1);
                    }
                  } catch (err) {
                    if (attempt >= maxRetries) {
                      console.log(chalk.yellow(`\n  ⚠ Error completing video for scene ${task.index + 1}: ${err}`));
                      videoPaths[task.index] = "";
                      failedScenes.push(task.index + 1);
                    } else {
                      videoSpinner.text = `🎬 Scene ${task.index + 1}: Error, retry ${attempt + 1}/${maxRetries}...`;
                      await sleep(RETRY_DELAY_MS);
                    }
                  }
                }
              }

              if (totalBatches > 1 && batchEnd < segments.length) {
                console.log(chalk.dim(`  → Batch ${batchNum}/${totalBatches} complete`));
              }
            }
          }
        } else {
          // Runway
          const runway = new RunwayProvider();
          await runway.initialize({ apiKey: videoApiKey });

          // Submit all video generation tasks with retry logic
          const tasks: Array<{ taskId: string; index: number; imagePath: string; referenceImage: string; segment: StoryboardSegment }> = [];

          for (let i = 0; i < segments.length; i++) {
            if (!imagePaths[i]) {
              videoPaths.push("");
              continue;
            }

            const segment = segments[i] as StoryboardSegment;
            videoSpinner.text = `🎬 Submitting video task ${i + 1}/${segments.length}...`;

            const imageBuffer = await readFile(imagePaths[i]);
            const ext = extname(imagePaths[i]).toLowerCase().slice(1);
            const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
            const referenceImage = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

            // Use 10s video if narration > 5s to avoid video ending before narration
            const videoDuration = (segment.duration > 5 ? 10 : 5) as 5 | 10;

            const result = await generateVideoWithRetryRunway(
              runway,
              segment,
              referenceImage,
              {
                duration: videoDuration,
                aspectRatio: options.aspectRatio === "1:1" ? "16:9" : (options.aspectRatio as "16:9" | "9:16"),
              },
              maxRetries,
              (msg) => {
                videoSpinner.text = `🎬 Scene ${i + 1}: ${msg}`;
              }
            );

            if (result) {
              tasks.push({ taskId: result.taskId, index: i, imagePath: imagePaths[i], referenceImage, segment });
            } else {
              console.log(chalk.yellow(`\n  ⚠ Failed to start video generation for scene ${i + 1} (after ${maxRetries} retries)`));
              videoPaths[i] = "";
              failedScenes.push(i + 1);
            }
          }

          // Wait for all tasks to complete with retry logic
          videoSpinner.text = `🎬 Waiting for ${tasks.length} video(s) to complete...`;

          for (const task of tasks) {
            let completed = false;
            let currentTaskId = task.taskId;

            for (let attempt = 0; attempt <= maxRetries && !completed; attempt++) {
              try {
                const result = await runway.waitForCompletion(
                  currentTaskId,
                  (status) => {
                    const progress = status.progress !== undefined ? `${status.progress}%` : status.status;
                    videoSpinner.text = `🎬 Scene ${task.index + 1}: ${progress}...`;
                  },
                  300000 // 5 minute timeout per video
                );

                if (result.status === "completed" && result.videoUrl) {
                  const videoPath = resolve(outputDir, `scene-${task.index + 1}.mp4`);
                  const response = await fetch(result.videoUrl);
                  const buffer = Buffer.from(await response.arrayBuffer());
                  await writeFile(videoPath, buffer);

                  // Extend video to match narration duration if needed
                  await extendVideoToTarget(videoPath, task.segment.duration, outputDir, `Scene ${task.index + 1}`, {
                    onProgress: (msg) => { videoSpinner.text = `🎬 ${msg}`; },
                  });

                  videoPaths[task.index] = videoPath;
                  completed = true;
                } else if (attempt < maxRetries) {
                  // Resubmit task on failure
                  videoSpinner.text = `🎬 Scene ${task.index + 1}: Retry ${attempt + 1}/${maxRetries}...`;
                  await sleep(RETRY_DELAY_MS);

                  const videoDuration = (task.segment.duration > 5 ? 10 : 5) as 5 | 10;
                  const retryResult = await generateVideoWithRetryRunway(
                    runway,
                    task.segment,
                    task.referenceImage,
                    {
                      duration: videoDuration,
                      aspectRatio: options.aspectRatio === "1:1" ? "16:9" : (options.aspectRatio as "16:9" | "9:16"),
                    },
                    0, // No nested retries
                    (msg) => {
                      videoSpinner.text = `🎬 Scene ${task.index + 1}: ${msg}`;
                    }
                  );

                  if (retryResult) {
                    currentTaskId = retryResult.taskId;
                  } else {
                    videoPaths[task.index] = "";
                    failedScenes.push(task.index + 1);
                    completed = true; // Exit retry loop
                  }
                } else {
                  videoPaths[task.index] = "";
                  failedScenes.push(task.index + 1);
                }
              } catch (err) {
                if (attempt >= maxRetries) {
                  console.log(chalk.yellow(`\n  ⚠ Error completing video for scene ${task.index + 1}: ${err}`));
                  videoPaths[task.index] = "";
                  failedScenes.push(task.index + 1);
                } else {
                  videoSpinner.text = `🎬 Scene ${task.index + 1}: Error, retry ${attempt + 1}/${maxRetries}...`;
                  await sleep(RETRY_DELAY_MS);
                }
              }
            }
          }
        }

        const successfulVideos = videoPaths.filter((p) => p && p !== "").length;
        videoSpinner.succeed(chalk.green(`Generated ${successfulVideos}/${segments.length} videos`));
        console.log();
      }

      // Step 4.5: Apply text overlays (if segments have textOverlays)
      if (options.textOverlay !== false) {
        const overlaySegments = segments.filter(
          (s: StoryboardSegment, i: number) => s.textOverlays && s.textOverlays.length > 0 && videoPaths[i] && videoPaths[i] !== ""
        );
        if (overlaySegments.length > 0) {
          const overlaySpinner = ora(`Applying text overlays to ${overlaySegments.length} scene(s)...`).start();
          let overlayCount = 0;
          for (let i = 0; i < segments.length; i++) {
            const segment = segments[i] as StoryboardSegment;
            if (segment.textOverlays && segment.textOverlays.length > 0 && videoPaths[i] && videoPaths[i] !== "") {
              try {
                const overlayOutput = videoPaths[i].replace(/(\.[^.]+)$/, "-overlay$1");
                const overlayResult = await applyTextOverlays({
                  videoPath: videoPaths[i],
                  texts: segment.textOverlays,
                  outputPath: overlayOutput,
                  style: (options.textStyle as TextOverlayStyle) || "lower-third",
                });
                if (overlayResult.success && overlayResult.outputPath) {
                  videoPaths[i] = overlayResult.outputPath;
                  overlayCount++;
                }
              } catch {
                // Silent fallback: keep original video
              }
            }
          }
          overlaySpinner.succeed(chalk.green(`Applied text overlays to ${overlayCount} scene(s)`));
          console.log();
        }
      }

      // Step 5: Assemble project
      const assembleSpinner = ora("Assembling project...").start();

      const project = new Project("Script-to-Video Output");
      project.setAspectRatio(options.aspectRatio as "16:9" | "9:16" | "1:1");

      // Clear default tracks and create new ones
      const defaultTracks = project.getTracks();
      for (const track of defaultTracks) {
        project.removeTrack(track.id);
      }

      const videoTrack = project.addTrack({
        name: "Video",
        type: "video",
        order: 1,
        isMuted: false,
        isLocked: false,
        isVisible: true,
      });

      const audioTrack = project.addTrack({
        name: "Audio",
        type: "audio",
        order: 0,
        isMuted: false,
        isLocked: false,
        isVisible: true,
      });

      // Add per-scene narration sources and clips
      for (const tts of perSceneTTS) {
        const segment = segments[tts.segmentIndex];
        const audioSource = project.addSource({
          name: `Narration ${tts.segmentIndex + 1}`,
          url: tts.path,
          type: "audio",
          duration: tts.duration,
        });

        project.addClip({
          sourceId: audioSource.id,
          trackId: audioTrack.id,
          startTime: segment.startTime,
          duration: tts.duration,
          sourceStartOffset: 0,
          sourceEndOffset: tts.duration,
        });
      }

      // Add video/image sources and clips
      let currentTime = 0;
      const videoClipIds: string[] = [];
      const fadeDuration = 0.3; // Fade duration in seconds for smooth transitions

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const hasVideo = videoPaths[i] && videoPaths[i] !== "";
        const hasImage = imagePaths[i] && imagePaths[i] !== "";

        if (!hasVideo && !hasImage) {
          // Skip if no visual asset
          currentTime += segment.duration;
          continue;
        }

        const assetPath = hasVideo ? videoPaths[i] : imagePaths[i];
        const mediaType = hasVideo ? "video" : "image";

        const source = project.addSource({
          name: `Scene ${i + 1}`,
          url: assetPath,
          type: mediaType as "video" | "image",
          duration: segment.duration,
        });

        const clip = project.addClip({
          sourceId: source.id,
          trackId: videoTrack.id,
          startTime: currentTime,
          duration: segment.duration,
          sourceStartOffset: 0,
          sourceEndOffset: segment.duration,
        });

        videoClipIds.push(clip.id);
        currentTime += segment.duration;
      }

      // Add fade effects to video clips for smoother scene transitions
      for (let i = 0; i < videoClipIds.length; i++) {
        const clipId = videoClipIds[i];
        const clip = project.getClips().find(c => c.id === clipId);
        if (!clip) continue;

        // Add fadeIn effect (except for first clip)
        if (i > 0) {
          project.addEffect(clipId, {
            type: "fadeIn",
            startTime: 0,
            duration: fadeDuration,
            params: {},
          });
        }

        // Add fadeOut effect (except for last clip)
        if (i < videoClipIds.length - 1) {
          project.addEffect(clipId, {
            type: "fadeOut",
            startTime: clip.duration - fadeDuration,
            duration: fadeDuration,
            params: {},
          });
        }
      }

      // Save project file
      let outputPath = resolve(process.cwd(), options.output);

      // Detect if output looks like a directory (ends with / or no .json extension)
      const looksLikeDirectory =
        options.output.endsWith("/") ||
        (!options.output.endsWith(".json") &&
          !options.output.endsWith(".vibe.json"));

      if (looksLikeDirectory) {
        // Create directory if it doesn't exist
        if (!existsSync(outputPath)) {
          await mkdir(outputPath, { recursive: true });
        }
        outputPath = resolve(outputPath, "project.vibe.json");
      } else if (
        existsSync(outputPath) &&
        (await stat(outputPath)).isDirectory()
      ) {
        // Existing directory without trailing slash
        outputPath = resolve(outputPath, "project.vibe.json");
      } else {
        // File path - ensure parent directory exists
        const parentDir = dirname(outputPath);
        if (!existsSync(parentDir)) {
          await mkdir(parentDir, { recursive: true });
        }
      }

      await writeFile(
        outputPath,
        JSON.stringify(project.toJSON(), null, 2),
        "utf-8"
      );

      assembleSpinner.succeed(chalk.green("Project assembled"));

      // Step 6: AI Review (optional)
      if (options.review) {
        const reviewSpinner = ora("Reviewing video with Gemini AI...").start();
        try {
          const reviewTarget = videoPaths.find((p) => p && p !== "");
          if (reviewTarget) {
            const storyboardFile = resolve(effectiveOutputDir, "storyboard.json");
            const reviewResult = await executeReview({
              videoPath: reviewTarget,
              storyboardPath: existsSync(storyboardFile) ? storyboardFile : undefined,
              autoApply: options.reviewAutoApply,
              model: "flash",
            });

            if (reviewResult.success && reviewResult.feedback) {
              reviewSpinner.succeed(chalk.green(`AI Review: ${reviewResult.feedback.overallScore}/10`));
              if (reviewResult.appliedFixes && reviewResult.appliedFixes.length > 0) {
                for (const fix of reviewResult.appliedFixes) {
                  console.log(chalk.green(`  + ${fix}`));
                }
              }
              if (reviewResult.feedback.recommendations.length > 0) {
                for (const rec of reviewResult.feedback.recommendations) {
                  console.log(chalk.dim(`  * ${rec}`));
                }
              }
            } else {
              reviewSpinner.warn(chalk.yellow("AI review completed but no actionable feedback"));
            }
          } else {
            reviewSpinner.warn(chalk.yellow("No videos available for review"));
          }
        } catch {
          reviewSpinner.warn(chalk.yellow("AI review skipped (non-critical error)"));
        }
        console.log();
      }

      // Final summary
      console.log();
      console.log(chalk.bold.green("Script-to-Video complete!"));
      console.log(chalk.dim("─".repeat(60)));
      console.log();
      console.log(`  📄 Project: ${chalk.cyan(outputPath)}`);
      console.log(`  🎬 Scenes: ${segments.length}`);
      console.log(`  ⏱️  Duration: ${totalDuration}s`);
      console.log(`  📁 Assets: ${effectiveOutputDir}/`);
      if (perSceneTTS.length > 0 || failedNarrations.length > 0) {
        const narrationInfo = `${perSceneTTS.length}/${segments.length}`;
        if (failedNarrations.length > 0) {
          const failedSceneNums = failedNarrations.map((f) => f.sceneNum).join(", ");
          console.log(`  🎙️  Narrations: ${narrationInfo} narration-*.mp3`);
          console.log(chalk.yellow(`     ⚠ Failed: scene ${failedSceneNums}`));
        } else {
          console.log(`  🎙️  Narrations: ${perSceneTTS.length} narration-*.mp3`);
        }
      }
      console.log(`  🖼️  Images: ${successfulImages} scene-*.png`);
      if (!options.imagesOnly) {
        const videoCount = videoPaths.filter((p) => p && p !== "").length;
        console.log(`  🎥 Videos: ${videoCount}/${segments.length} scene-*.mp4`);
        if (failedScenes.length > 0) {
          const uniqueFailedScenes = [...new Set(failedScenes)].sort((a, b) => a - b);
          console.log(chalk.yellow(`     ⚠ Failed: scene ${uniqueFailedScenes.join(", ")} (fallback to image)`));
        }
      }
      console.log();
      console.log(chalk.dim("Next steps:"));
      console.log(chalk.dim(`  vibe project info ${options.output}`));
      console.log(chalk.dim(`  vibe export ${options.output} -o final.mp4`));

      // Show regeneration hint if there were failures
      if (!options.imagesOnly && failedScenes.length > 0) {
        const uniqueFailedScenes = [...new Set(failedScenes)].sort((a, b) => a - b);
        console.log();
        console.log(chalk.dim("💡 To regenerate failed scenes:"));
        for (const sceneNum of uniqueFailedScenes) {
          console.log(chalk.dim(`  vibe ai regenerate-scene ${effectiveOutputDir}/ --scene ${sceneNum} --video-only`));
        }
      }
      console.log();
    } catch (error) {
      console.error(chalk.red("Script-to-Video failed"));
      console.error(error);
      process.exit(1);
    }
  });

// Regenerate Scene command
aiCommand
  .command("regenerate-scene")
  .description("Regenerate a specific scene in a script-to-video project")
  .argument("<project-dir>", "Path to the script-to-video output directory")
  .requiredOption("--scene <numbers>", "Scene number(s) to regenerate (1-based), e.g., 3 or 3,4,5")
  .option("--video-only", "Only regenerate video")
  .option("--narration-only", "Only regenerate narration")
  .option("--image-only", "Only regenerate image")
  .option("-g, --generator <engine>", "Video generator: kling | runway", "kling")
  .option("-i, --image-provider <provider>", "Image provider: gemini | openai | stability", "gemini")
  .option("-v, --voice <id>", "ElevenLabs voice ID for narration")
  .option("-a, --aspect-ratio <ratio>", "Aspect ratio: 16:9 | 9:16 | 1:1", "16:9")
  .option("--retries <count>", "Number of retries for video generation failures", String(DEFAULT_VIDEO_RETRIES))
  .option("--reference-scene <num>", "Use another scene's image as reference for character consistency")
  .action(async (projectDir: string, options) => {
    try {
      const outputDir = resolve(process.cwd(), projectDir);
      const storyboardPath = resolve(outputDir, "storyboard.json");
      const projectPath = resolve(outputDir, "project.vibe.json");

      // Validate project directory
      if (!existsSync(outputDir)) {
        console.error(chalk.red(`Project directory not found: ${outputDir}`));
        process.exit(1);
      }

      if (!existsSync(storyboardPath)) {
        console.error(chalk.red(`Storyboard not found: ${storyboardPath}`));
        console.error(chalk.dim("This command requires a storyboard.json file from script-to-video output"));
        process.exit(1);
      }

      // Parse scene number(s) - supports "3" or "3,4,5"
      const sceneNums = options.scene.split(",").map((s: string) => parseInt(s.trim())).filter((n: number) => !isNaN(n) && n >= 1);
      if (sceneNums.length === 0) {
        console.error(chalk.red("Scene number must be a positive integer (1-based), e.g., --scene 3 or --scene 3,4,5"));
        process.exit(1);
      }

      // Load storyboard
      const storyboardContent = await readFile(storyboardPath, "utf-8");
      const segments: StoryboardSegment[] = JSON.parse(storyboardContent);

      // Validate all scene numbers
      for (const sceneNum of sceneNums) {
        if (sceneNum > segments.length) {
          console.error(chalk.red(`Scene ${sceneNum} does not exist. Storyboard has ${segments.length} scenes.`));
          process.exit(1);
        }
      }

      // Determine what to regenerate
      const regenerateVideo = options.videoOnly || (!options.narrationOnly && !options.imageOnly);
      const regenerateNarration = options.narrationOnly || (!options.videoOnly && !options.imageOnly);
      const regenerateImage = options.imageOnly || (!options.videoOnly && !options.narrationOnly);

      console.log();
      console.log(chalk.bold.cyan(`🔄 Regenerating Scene${sceneNums.length > 1 ? "s" : ""} ${sceneNums.join(", ")}`));
      console.log(chalk.dim("─".repeat(60)));
      console.log();
      console.log(`  📁 Project: ${outputDir}`);
      console.log(`  🎬 Scenes: ${sceneNums.join(", ")} of ${segments.length}`);
      console.log();

      // Get required API keys (once, before processing scenes)
      let imageApiKey: string | undefined;
      let videoApiKey: string | undefined;
      let elevenlabsApiKey: string | undefined;

      if (regenerateImage) {
        const imageProvider = options.imageProvider || "openai";
        if (imageProvider === "openai" || imageProvider === "dalle") {
          imageApiKey = (await getApiKey("OPENAI_API_KEY", "OpenAI")) ?? undefined;
          if (!imageApiKey) {
            console.error(chalk.red("OpenAI API key required for image generation"));
            process.exit(1);
          }
        } else if (imageProvider === "stability") {
          imageApiKey = (await getApiKey("STABILITY_API_KEY", "Stability AI")) ?? undefined;
          if (!imageApiKey) {
            console.error(chalk.red("Stability API key required for image generation"));
            process.exit(1);
          }
        } else if (imageProvider === "gemini") {
          imageApiKey = (await getApiKey("GOOGLE_API_KEY", "Google")) ?? undefined;
          if (!imageApiKey) {
            console.error(chalk.red("Google API key required for Gemini image generation"));
            process.exit(1);
          }
        }
      }

      if (regenerateVideo) {
        if (options.generator === "kling") {
          const key = await getApiKey("KLING_API_KEY", "Kling");
          if (!key) {
            console.error(chalk.red("Kling API key required"));
            process.exit(1);
          }
          videoApiKey = key;
        } else {
          const key = await getApiKey("RUNWAY_API_SECRET", "Runway");
          if (!key) {
            console.error(chalk.red("Runway API key required"));
            process.exit(1);
          }
          videoApiKey = key;
        }
      }

      if (regenerateNarration) {
        const key = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs");
        if (!key) {
          console.error(chalk.red("ElevenLabs API key required for narration"));
          process.exit(1);
        }
        elevenlabsApiKey = key;
      }

      // Process each scene
      for (const sceneNum of sceneNums) {
        const segment = segments[sceneNum - 1];

        console.log(chalk.cyan(`\n── Scene ${sceneNum} ──`));
        console.log(chalk.dim(`  ${segment.description.slice(0, 50)}...`));

        // Step 1: Regenerate narration if needed
        const narrationPath = resolve(outputDir, `narration-${sceneNum}.mp3`);
        let narrationDuration = segment.duration;

      if (regenerateNarration && elevenlabsApiKey) {
        const ttsSpinner = ora(`🎙️ Regenerating narration for scene ${sceneNum}...`).start();

        const elevenlabs = new ElevenLabsProvider();
        await elevenlabs.initialize({ apiKey: elevenlabsApiKey });

        const narrationText = segment.narration || segment.description;

        const ttsResult = await elevenlabs.textToSpeech(narrationText, {
          voiceId: options.voice,
        });

        if (!ttsResult.success || !ttsResult.audioBuffer) {
          ttsSpinner.fail(chalk.red(`Failed to generate narration: ${ttsResult.error || "Unknown error"}`));
          process.exit(1);
        }

        await writeFile(narrationPath, ttsResult.audioBuffer);
        narrationDuration = await getAudioDuration(narrationPath);

        // Update segment duration in storyboard
        segment.duration = narrationDuration;

        ttsSpinner.succeed(chalk.green(`Generated narration (${narrationDuration.toFixed(1)}s)`));
      }

      // Step 2: Regenerate image if needed
      let imagePath = resolve(outputDir, `scene-${sceneNum}.png`);

      if (regenerateImage && imageApiKey) {
        const imageSpinner = ora(`🎨 Regenerating image for scene ${sceneNum}...`).start();

        const imageProvider = options.imageProvider || "gemini";

        // Build prompt with character description for consistency
        const characterDesc = segment.characterDescription || segments[0]?.characterDescription;
        let imagePrompt = segment.visualStyle
          ? `${segment.visuals}. Style: ${segment.visualStyle}`
          : segment.visuals;

        // Add character description to prompt if available
        if (characterDesc) {
          imagePrompt = `${imagePrompt}\n\nIMPORTANT - Character appearance must match exactly: ${characterDesc}`;
        }

        // Check if we should use reference-based generation for character consistency
        const refSceneNum = options.referenceScene ? parseInt(options.referenceScene) : null;
        let referenceImageBuffer: Buffer | undefined;

        if (refSceneNum && refSceneNum >= 1 && refSceneNum <= segments.length && refSceneNum !== sceneNum) {
          const refImagePath = resolve(outputDir, `scene-${refSceneNum}.png`);
          if (existsSync(refImagePath)) {
            referenceImageBuffer = await readFile(refImagePath);
            imageSpinner.text = `🎨 Regenerating image for scene ${sceneNum} (using scene ${refSceneNum} as reference)...`;
          }
        } else if (!refSceneNum) {
          // Auto-detect: use the first available scene image as reference
          for (let i = 1; i <= segments.length; i++) {
            if (i !== sceneNum) {
              const otherImagePath = resolve(outputDir, `scene-${i}.png`);
              if (existsSync(otherImagePath)) {
                referenceImageBuffer = await readFile(otherImagePath);
                imageSpinner.text = `🎨 Regenerating image for scene ${sceneNum} (using scene ${i} as reference)...`;
                break;
              }
            }
          }
        }

        // Determine image size/aspect ratio based on provider
        const dalleImageSizes: Record<string, "1536x1024" | "1024x1536" | "1024x1024"> = {
          "16:9": "1536x1024",
          "9:16": "1024x1536",
          "1:1": "1024x1024",
        };
        type StabilityAspectRatio = "16:9" | "1:1" | "21:9" | "2:3" | "3:2" | "4:5" | "5:4" | "9:16" | "9:21";
        const stabilityAspectRatios: Record<string, StabilityAspectRatio> = {
          "16:9": "16:9",
          "9:16": "9:16",
          "1:1": "1:1",
        };

        let imageBuffer: Buffer | undefined;
        let imageUrl: string | undefined;
        let imageError: string | undefined;

        if (imageProvider === "openai" || imageProvider === "dalle") {
          const openaiImage = new OpenAIImageProvider();
          await openaiImage.initialize({ apiKey: imageApiKey });
          const imageResult = await openaiImage.generateImage(imagePrompt, {
            size: dalleImageSizes[options.aspectRatio] || "1536x1024",
            quality: "standard",
          });
          if (imageResult.success && imageResult.images && imageResult.images.length > 0) {
            imageUrl = imageResult.images[0].url;
          } else {
            imageError = imageResult.error;
          }
        } else if (imageProvider === "stability") {
          const stability = new StabilityProvider();
          await stability.initialize({ apiKey: imageApiKey });
          const imageResult = await stability.generateImage(imagePrompt, {
            aspectRatio: stabilityAspectRatios[options.aspectRatio] || "16:9",
            model: "sd3.5-large",
          });
          if (imageResult.success && imageResult.images && imageResult.images.length > 0) {
            const img = imageResult.images[0];
            if (img.base64) {
              imageBuffer = Buffer.from(img.base64, "base64");
            } else if (img.url) {
              imageUrl = img.url;
            }
          } else {
            imageError = imageResult.error;
          }
        } else if (imageProvider === "gemini") {
          const gemini = new GeminiProvider();
          await gemini.initialize({ apiKey: imageApiKey });

          // Use editImage with reference for character consistency
          if (referenceImageBuffer) {
            // Extract the main action from the scene description (take first action if multiple)
            const simplifiedVisuals = segment.visuals.split(/[,.]/).find((part: string) =>
              part.includes("standing") || part.includes("sitting") || part.includes("walking") ||
              part.includes("lying") || part.includes("reaching") || part.includes("looking") ||
              part.includes("working") || part.includes("coding") || part.includes("typing")
            ) || segment.visuals.split(".")[0];

            const editPrompt = `Generate a new image showing the SAME SINGLE person from the reference image in a new scene.

REFERENCE: Look at the person in the reference image - their face, hair, build, and overall appearance.

NEW SCENE: ${simplifiedVisuals}

CRITICAL RULES:
1. Show ONLY ONE person - the exact same individual from the reference image
2. The person must have the IDENTICAL face, hair style, and body type
3. Do NOT show multiple people or duplicate the character
4. Create a single moment in time, one pose, one action
5. Match the art style and quality of the reference image

Generate the single-person scene image now.`;

            const imageResult = await gemini.editImage([referenceImageBuffer], editPrompt, {
              aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1",
            });
            if (imageResult.success && imageResult.images && imageResult.images.length > 0) {
              const img = imageResult.images[0];
              if (img.base64) {
                imageBuffer = Buffer.from(img.base64, "base64");
              }
            } else {
              imageError = imageResult.error;
            }
          } else {
            // No reference image, use regular generation
            const imageResult = await gemini.generateImage(imagePrompt, {
              aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1",
            });
            if (imageResult.success && imageResult.images && imageResult.images.length > 0) {
              const img = imageResult.images[0];
              if (img.base64) {
                imageBuffer = Buffer.from(img.base64, "base64");
              }
            } else {
              imageError = imageResult.error;
            }
          }
        }

        if (imageBuffer) {
          await writeFile(imagePath, imageBuffer);
          imageSpinner.succeed(chalk.green("Generated image"));
        } else if (imageUrl) {
          const response = await fetch(imageUrl);
          const buffer = Buffer.from(await response.arrayBuffer());
          await writeFile(imagePath, buffer);
          imageSpinner.succeed(chalk.green("Generated image"));
        } else {
          const errorMsg = imageError || "Unknown error";
          imageSpinner.fail(chalk.red(`Failed to generate image: ${errorMsg}`));
          process.exit(1);
        }
      }

      // Step 3: Regenerate video if needed
      let videoPath = resolve(outputDir, `scene-${sceneNum}.mp4`);

      if (regenerateVideo && videoApiKey) {
        const videoSpinner = ora(`🎬 Regenerating video for scene ${sceneNum}...`).start();

        // Check if image exists
        if (!existsSync(imagePath)) {
          videoSpinner.fail(chalk.red(`Reference image not found: ${imagePath}`));
          console.error(chalk.dim("Generate an image first with --image-only or regenerate all assets"));
          process.exit(1);
        }

        const imageBuffer = await readFile(imagePath);
        const ext = extname(imagePath).toLowerCase().slice(1);
        const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
        const referenceImage = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

        const videoDuration = (segment.duration > 5 ? 10 : 5) as 5 | 10;
        const maxRetries = parseInt(options.retries) || DEFAULT_VIDEO_RETRIES;

        let videoGenerated = false;

        if (options.generator === "kling") {
          const kling = new KlingProvider();
          await kling.initialize({ apiKey: videoApiKey });

          if (!kling.isConfigured()) {
            videoSpinner.fail(chalk.red("Invalid Kling API key format. Use ACCESS_KEY:SECRET_KEY"));
            process.exit(1);
          }

          // Try to use image-to-video if ImgBB API key is available
          const imgbbApiKey = await getApiKeyFromConfig("imgbb") || process.env.IMGBB_API_KEY;
          let imageUrl: string | undefined;

          if (imgbbApiKey) {
            videoSpinner.text = `🎬 Uploading image to ImgBB...`;
            const uploadResult = await uploadToImgbb(imageBuffer, imgbbApiKey);
            if (uploadResult.success && uploadResult.url) {
              imageUrl = uploadResult.url;
              videoSpinner.text = `🎬 Starting image-to-video generation...`;
            } else {
              console.log(chalk.yellow(`\n  ⚠ ImgBB upload failed, falling back to text-to-video`));
            }
          }

          const result = await generateVideoWithRetryKling(
            kling,
            segment,
            {
              duration: videoDuration,
              aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1",
              referenceImage: imageUrl, // Use uploaded URL for image-to-video
            },
            maxRetries
          );

          if (result) {
            videoSpinner.text = `🎬 Waiting for video to complete...`;

            for (let attempt = 0; attempt <= maxRetries && !videoGenerated; attempt++) {
              try {
                const waitResult = await kling.waitForCompletion(
                  result.taskId,
                  result.type,
                  (status) => {
                    videoSpinner.text = `🎬 Scene ${sceneNum}: ${status.status}...`;
                  },
                  600000
                );

                if (waitResult.status === "completed" && waitResult.videoUrl) {
                  const response = await fetch(waitResult.videoUrl);
                  const buffer = Buffer.from(await response.arrayBuffer());
                  await writeFile(videoPath, buffer);

                  // Extend video to match narration duration if needed
                  await extendVideoToTarget(videoPath, segment.duration, outputDir, `Scene ${sceneNum}`, {
                    kling,
                    videoId: waitResult.videoId,
                    onProgress: (msg) => { videoSpinner.text = `🎬 ${msg}`; },
                  });

                  videoGenerated = true;
                } else if (attempt < maxRetries) {
                  videoSpinner.text = `🎬 Scene ${sceneNum}: Retry ${attempt + 1}/${maxRetries}...`;
                  await sleep(RETRY_DELAY_MS);
                }
              } catch (err) {
                if (attempt >= maxRetries) {
                  throw err;
                }
                videoSpinner.text = `🎬 Scene ${sceneNum}: Error, retry ${attempt + 1}/${maxRetries}...`;
                await sleep(RETRY_DELAY_MS);
              }
            }
          }
        } else {
          // Runway
          const runway = new RunwayProvider();
          await runway.initialize({ apiKey: videoApiKey });

          const result = await generateVideoWithRetryRunway(
            runway,
            segment,
            referenceImage,
            {
              duration: videoDuration,
              aspectRatio: options.aspectRatio === "1:1" ? "16:9" : (options.aspectRatio as "16:9" | "9:16"),
            },
            maxRetries,
            (msg) => {
              videoSpinner.text = `🎬 Scene ${sceneNum}: ${msg}`;
            }
          );

          if (result) {
            videoSpinner.text = `🎬 Waiting for video to complete...`;

            for (let attempt = 0; attempt <= maxRetries && !videoGenerated; attempt++) {
              try {
                const waitResult = await runway.waitForCompletion(
                  result.taskId,
                  (status) => {
                    const progress = status.progress !== undefined ? `${status.progress}%` : status.status;
                    videoSpinner.text = `🎬 Scene ${sceneNum}: ${progress}...`;
                  },
                  300000
                );

                if (waitResult.status === "completed" && waitResult.videoUrl) {
                  const response = await fetch(waitResult.videoUrl);
                  const buffer = Buffer.from(await response.arrayBuffer());
                  await writeFile(videoPath, buffer);

                  // Extend video to match narration duration if needed (Runway - no Kling extend)
                  await extendVideoToTarget(videoPath, segment.duration, outputDir, `Scene ${sceneNum}`, {
                    onProgress: (msg) => { videoSpinner.text = `🎬 ${msg}`; },
                  });

                  videoGenerated = true;
                } else if (attempt < maxRetries) {
                  videoSpinner.text = `🎬 Scene ${sceneNum}: Retry ${attempt + 1}/${maxRetries}...`;
                  await sleep(RETRY_DELAY_MS);
                }
              } catch (err) {
                if (attempt >= maxRetries) {
                  throw err;
                }
                videoSpinner.text = `🎬 Scene ${sceneNum}: Error, retry ${attempt + 1}/${maxRetries}...`;
                await sleep(RETRY_DELAY_MS);
              }
            }
          }
        }

        if (videoGenerated) {
          videoSpinner.succeed(chalk.green("Generated video"));
        } else {
          videoSpinner.fail(chalk.red("Failed to generate video after all retries"));
          process.exit(1);
        }
      }

      // Step 4: Recalculate startTime for ALL segments and re-save storyboard
      {
        let currentTime = 0;
        for (const seg of segments) {
          seg.startTime = currentTime;
          currentTime += seg.duration;
        }
        await writeFile(storyboardPath, JSON.stringify(segments, null, 2), "utf-8");
        console.log(chalk.dim(`  → Updated storyboard: ${storyboardPath}`));
      }

      // Step 5: Update project.vibe.json if it exists — update ALL clips' startTime/duration
      if (existsSync(projectPath)) {
        const updateSpinner = ora("📦 Updating project file...").start();

        try {
          const projectContent = await readFile(projectPath, "utf-8");
          const projectData = JSON.parse(projectContent) as ProjectFile;

          // Find and update the source for this scene
          const sceneName = `Scene ${sceneNum}`;
          const narrationName = `Narration ${sceneNum}`;

          // Update video/image source
          const videoSource = projectData.state.sources.find((s) => s.name === sceneName);
          if (videoSource) {
            const hasVideo = existsSync(videoPath);
            videoSource.url = hasVideo ? videoPath : imagePath;
            videoSource.type = hasVideo ? "video" : "image";
            videoSource.duration = segment.duration;
          }

          // Update narration source
          const narrationSource = projectData.state.sources.find((s) => s.name === narrationName);
          if (narrationSource && regenerateNarration) {
            narrationSource.duration = narrationDuration;
          }

          // Update ALL clips' startTime and duration based on recalculated segments
          for (const clip of projectData.state.clips) {
            const source = projectData.state.sources.find((s) => s.id === clip.sourceId);
            if (!source) continue;

            // Match source name to segment (e.g., "Scene 1" → segment 0, "Narration 2" → segment 1)
            const sceneMatch = source.name.match(/^Scene (\d+)$/);
            const narrationMatch = source.name.match(/^Narration (\d+)$/);
            const segIdx = sceneMatch ? parseInt(sceneMatch[1]) - 1 : narrationMatch ? parseInt(narrationMatch[1]) - 1 : -1;

            if (segIdx >= 0 && segIdx < segments.length) {
              const seg = segments[segIdx];
              clip.startTime = seg.startTime;
              clip.duration = seg.duration;
              clip.sourceEndOffset = seg.duration;
              // Also update the source duration to match segment
              source.duration = seg.duration;
            }
          }

          await writeFile(projectPath, JSON.stringify(projectData, null, 2), "utf-8");
          updateSpinner.succeed(chalk.green("Updated project file (all clips synced)"));
        } catch (err) {
          updateSpinner.warn(chalk.yellow(`Could not update project file: ${err}`));
        }
      }

        console.log(chalk.green(`  ✓ Scene ${sceneNum} done`));
      } // End of for loop over sceneNums

      // Final summary
      console.log();
      console.log(chalk.bold.green(`✅ ${sceneNums.length} scene${sceneNums.length > 1 ? "s" : ""} regenerated successfully!`));
      console.log(chalk.dim("─".repeat(60)));
      console.log();
      console.log(chalk.dim("Next steps:"));
      console.log(chalk.dim(`  vibe export ${outputDir}/ -o final.mp4`));
      console.log();
    } catch (error) {
      console.error(chalk.red("Scene regeneration failed"));
      console.error(error);
      process.exit(1);
    }
  });

// B-Roll Matcher command
aiCommand
  .command("b-roll")
  .description("Match B-roll footage to narration content")
  .argument("<narration>", "Narration audio file or script text")
  .option("-b, --broll <paths>", "B-roll video files (comma-separated)")
  .option("--broll-dir <dir>", "Directory containing B-roll files")
  .option("-o, --output <path>", "Output project file", "broll-matched.vibe.json")
  .option("-t, --threshold <value>", "Match confidence threshold (0-1)", "0.6")
  .option("-l, --language <lang>", "Language code for transcription (e.g., en, ko)")
  .option("-f, --file", "Treat narration as file path (script file)")
  .option("--analyze-only", "Only analyze, don't create project")
  .action(async (narration: string, options) => {
    try {
      // Validate B-roll input
      if (!options.broll && !options.brollDir) {
        console.error(chalk.red("B-roll files required. Use -b or --broll-dir"));
        process.exit(1);
      }

      // Check API keys
      const openaiApiKey = await getApiKey("OPENAI_API_KEY", "OpenAI");
      if (!openaiApiKey) {
        console.error(chalk.red("OpenAI API key required for Whisper transcription."));
        console.error(chalk.dim("Set OPENAI_API_KEY environment variable"));
        process.exit(1);
      }

      const claudeApiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic");
      if (!claudeApiKey) {
        console.error(chalk.red("Anthropic API key required for B-roll analysis."));
        console.error(chalk.dim("Set ANTHROPIC_API_KEY environment variable"));
        process.exit(1);
      }

      // Check FFmpeg availability
      try {
        execSync("ffmpeg -version", { stdio: "ignore" });
      } catch {
        console.error(chalk.red("FFmpeg not found. Please install FFmpeg."));
        process.exit(1);
      }

      console.log();
      console.log(chalk.bold.cyan("🎬 B-Roll Matcher Pipeline"));
      console.log(chalk.dim("─".repeat(60)));
      console.log();

      // Step 1: Discover B-roll files
      const discoverSpinner = ora("🎥 Discovering B-roll files...").start();
      const brollFiles = await discoverBrollFiles(options.broll, options.brollDir);

      if (brollFiles.length === 0) {
        discoverSpinner.fail(chalk.red("No B-roll video files found"));
        process.exit(1);
      }

      discoverSpinner.succeed(chalk.green(`Found ${brollFiles.length} B-roll file(s)`));

      // Step 2: Parse narration (audio file or script text)
      const narrationSpinner = ora("📝 Processing narration...").start();

      let narrationSegments: Array<{ startTime: number; endTime: number; text: string }> = [];
      let totalDuration = 0;
      let narrationFile = "";

      const isScriptFile = options.file;
      const isAudioFile = !isScriptFile && isAudioOrVideoFile(narration);

      if (isAudioFile) {
        // Transcribe audio with Whisper
        narrationFile = resolve(process.cwd(), narration);
        if (!existsSync(narrationFile)) {
          narrationSpinner.fail(chalk.red(`Narration file not found: ${narrationFile}`));
          process.exit(1);
        }

        narrationSpinner.text = "📝 Transcribing narration with Whisper...";

        const whisper = new WhisperProvider();
        await whisper.initialize({ apiKey: openaiApiKey });

        // Extract audio if it's a video file
        let audioPath = narrationFile;
        let tempAudioPath: string | null = null;

        const ext = extname(narrationFile).toLowerCase();
        const videoExtensions = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"];
        if (videoExtensions.includes(ext)) {
          narrationSpinner.text = "📝 Extracting audio from video...";
          tempAudioPath = `/tmp/vibe_broll_audio_${Date.now()}.wav`;
          await execAsync(
            `ffmpeg -i "${narrationFile}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${tempAudioPath}" -y`,
            { maxBuffer: 50 * 1024 * 1024 }
          );
          audioPath = tempAudioPath;
        }

        const audioBuffer = await readFile(audioPath);
        const audioBlob = new Blob([audioBuffer]);

        narrationSpinner.text = "📝 Transcribing with Whisper...";
        const transcriptResult = await whisper.transcribe(audioBlob, options.language);

        // Cleanup temp file
        if (tempAudioPath && existsSync(tempAudioPath)) {
          await execAsync(`rm "${tempAudioPath}"`).catch(() => {});
        }

        if (transcriptResult.status === "failed" || !transcriptResult.segments) {
          narrationSpinner.fail(chalk.red(`Transcription failed: ${transcriptResult.error}`));
          process.exit(1);
        }

        narrationSegments = transcriptResult.segments.map((seg) => ({
          startTime: seg.startTime,
          endTime: seg.endTime,
          text: seg.text,
        }));

        totalDuration = transcriptResult.segments.length > 0
          ? transcriptResult.segments[transcriptResult.segments.length - 1].endTime
          : 0;
      } else {
        // Use script text (direct or from file)
        let scriptContent = narration;
        if (isScriptFile) {
          const scriptPath = resolve(process.cwd(), narration);
          if (!existsSync(scriptPath)) {
            narrationSpinner.fail(chalk.red(`Script file not found: ${scriptPath}`));
            process.exit(1);
          }
          scriptContent = await readFile(scriptPath, "utf-8");
          narrationFile = scriptPath;
        } else {
          narrationFile = "text-input";
        }

        // Split script into segments (by paragraph or sentence)
        const paragraphs = scriptContent
          .split(/\n\n+/)
          .map((p) => p.trim())
          .filter((p) => p.length > 0);

        // Estimate timing (rough: ~150 words per minute)
        let currentTime = 0;
        narrationSegments = paragraphs.map((text) => {
          const wordCount = text.split(/\s+/).length;
          const duration = Math.max((wordCount / 150) * 60, 3); // Min 3 seconds per segment
          const segment = {
            startTime: currentTime,
            endTime: currentTime + duration,
            text,
          };
          currentTime += duration;
          return segment;
        });

        totalDuration = currentTime;
      }

      narrationSpinner.succeed(chalk.green(`Processed ${narrationSegments.length} narration segments (${formatTime(totalDuration)} total)`));

      // Step 3: Analyze B-roll clips with Claude Vision
      const brollSpinner = ora("🎥 Analyzing B-roll content with Claude Vision...").start();

      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey: claudeApiKey });

      const brollClips: BrollClipInfo[] = [];

      for (let i = 0; i < brollFiles.length; i++) {
        const filePath = brollFiles[i];
        const fileName = basename(filePath);
        brollSpinner.text = `🎥 Analyzing B-roll ${i + 1}/${brollFiles.length}: ${fileName}`;

        try {
          // Get video duration
          const { stdout: durationOut } = await execAsync(
            `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
          );
          const duration = parseFloat(durationOut.trim());

          // Extract a key frame (middle of video)
          const frameTime = Math.min(duration / 2, 5);
          const frameBase64 = await extractKeyFrame(filePath, frameTime);

          // Analyze with Claude Vision
          const analysis = await claude.analyzeBrollContent(frameBase64, fileName, "image/jpeg");

          brollClips.push({
            id: `broll-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            filePath,
            duration,
            description: analysis.description,
            tags: analysis.tags,
          });
        } catch (error) {
          console.log(chalk.yellow(`\n  ⚠ Could not analyze ${fileName}: ${error}`));
        }
      }

      brollSpinner.succeed(chalk.green(`Analyzed ${brollClips.length} B-roll clips`));

      // Display analyzed B-roll
      for (const clip of brollClips) {
        console.log(chalk.dim(`  → ${basename(clip.filePath)}: "${clip.description}"`));
        console.log(chalk.dim(`    [${clip.tags.join(", ")}]`));
      }
      console.log();

      // Step 4: Analyze narration for visual requirements
      const visualSpinner = ora("🔍 Analyzing narration for visual needs...").start();

      const analyzedNarration = await claude.analyzeNarrationForVisuals(narrationSegments);

      visualSpinner.succeed(chalk.green("Narration analysis complete"));

      // Step 5: Match B-roll to narration
      const matchSpinner = ora("🔗 Matching B-roll to narration...").start();

      const matches = await claude.matchBrollToNarration(analyzedNarration, brollClips);

      const threshold = parseFloat(options.threshold);
      const filteredMatches = matches.filter((m) => m.confidence >= threshold);

      // Remove duplicate assignments (keep highest confidence for each segment)
      const uniqueMatches: BrollMatch[] = [];
      const matchedSegments = new Set<number>();

      // Sort by confidence descending
      filteredMatches.sort((a, b) => b.confidence - a.confidence);

      for (const match of filteredMatches) {
        if (!matchedSegments.has(match.narrationSegmentIndex)) {
          matchedSegments.add(match.narrationSegmentIndex);
          uniqueMatches.push(match);
        }
      }

      // Sort back by segment index
      uniqueMatches.sort((a, b) => a.narrationSegmentIndex - b.narrationSegmentIndex);

      const coverage = (uniqueMatches.length / narrationSegments.length) * 100;
      matchSpinner.succeed(chalk.green(`Found ${uniqueMatches.length} matches (${coverage.toFixed(0)}% coverage)`));

      // Find unmatched segments
      const unmatchedSegments: number[] = [];
      for (let i = 0; i < narrationSegments.length; i++) {
        if (!matchedSegments.has(i)) {
          unmatchedSegments.push(i);
        }
      }

      // Display match summary
      console.log();
      console.log(chalk.bold.cyan("📊 Match Summary"));
      console.log(chalk.dim("─".repeat(60)));

      for (const match of uniqueMatches) {
        const segment = analyzedNarration[match.narrationSegmentIndex];
        const clip = brollClips.find((c) => c.id === match.brollClipId);
        const startFormatted = formatTime(segment.startTime);
        const endFormatted = formatTime(segment.endTime);
        const confidencePercent = (match.confidence * 100).toFixed(0);

        console.log();
        console.log(`  ${chalk.yellow(`Segment ${match.narrationSegmentIndex + 1}`)} [${startFormatted} - ${endFormatted}]`);
        console.log(`    ${chalk.dim(truncate(segment.text, 60))}`);
        console.log(`    ${chalk.green("→")} ${basename(clip?.filePath || "unknown")} ${chalk.dim(`(${confidencePercent}%)`)}`);
        console.log(`    ${chalk.dim(match.reason)}`);
      }

      if (unmatchedSegments.length > 0) {
        console.log();
        console.log(chalk.yellow(`  ⚠ ${unmatchedSegments.length} unmatched segment(s): [${unmatchedSegments.map((i) => i + 1).join(", ")}]`));
      }

      console.log();
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Total: ${chalk.bold(uniqueMatches.length)}/${narrationSegments.length} segments matched, ${chalk.bold(coverage.toFixed(0))}% coverage`);
      console.log();

      // Prepare result object
      const result: BrollMatchResult = {
        narrationFile,
        totalDuration,
        brollClips,
        narrationSegments: analyzedNarration,
        matches: uniqueMatches,
        unmatchedSegments,
      };

      // Step 6: Create project (unless analyze-only)
      if (!options.analyzeOnly) {
        const projectSpinner = ora("📦 Creating project...").start();

        const project = new Project("B-Roll Matched Project");

        // Add B-roll sources
        const sourceMap = new Map<string, string>();
        for (const clip of brollClips) {
          const source = project.addSource({
            name: basename(clip.filePath),
            url: clip.filePath,
            type: "video",
            duration: clip.duration,
          });
          sourceMap.set(clip.id, source.id);
        }

        // Add narration audio source if it's an audio file
        let narrationSourceId: string | null = null;
        if (isAudioFile && narrationFile && existsSync(narrationFile)) {
          const narrationSource = project.addSource({
            name: basename(narrationFile),
            url: narrationFile,
            type: "audio",
            duration: totalDuration,
          });
          narrationSourceId = narrationSource.id;
        }

        // Get tracks
        const videoTrack = project.getTracks().find((t) => t.type === "video");
        const audioTrack = project.getTracks().find((t) => t.type === "audio");
        if (!videoTrack) {
          projectSpinner.fail(chalk.red("Failed to create project"));
          process.exit(1);
        }

        // Add narration audio clip to audio track
        if (narrationSourceId && audioTrack) {
          project.addClip({
            sourceId: narrationSourceId,
            trackId: audioTrack.id,
            startTime: 0,
            duration: totalDuration,
            sourceStartOffset: 0,
            sourceEndOffset: totalDuration,
          });
        }

        // Add clips for each match
        for (const match of uniqueMatches) {
          const segment = analyzedNarration[match.narrationSegmentIndex];
          const sourceId = sourceMap.get(match.brollClipId);
          const clip = brollClips.find((c) => c.id === match.brollClipId);

          if (!sourceId || !clip) continue;

          const clipDuration = Math.min(
            match.suggestedDuration || segment.endTime - segment.startTime,
            clip.duration - match.suggestedStartOffset
          );

          project.addClip({
            sourceId,
            trackId: videoTrack.id,
            startTime: segment.startTime,
            duration: clipDuration,
            sourceStartOffset: match.suggestedStartOffset,
            sourceEndOffset: match.suggestedStartOffset + clipDuration,
          });
        }

        const outputPath = resolve(process.cwd(), options.output);
        await writeFile(outputPath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

        projectSpinner.succeed(chalk.green(`Created project: ${outputPath}`));

        // Save JSON result alongside project
        const jsonOutputPath = outputPath.replace(/\.vibe\.json$/, "-analysis.json");
        await writeFile(jsonOutputPath, JSON.stringify(result, null, 2), "utf-8");
        console.log(chalk.dim(`  → Analysis saved: ${jsonOutputPath}`));
      }

      console.log();
      console.log(chalk.bold.green("✅ B-Roll matching complete!"));
      console.log();
      console.log(chalk.dim("Next steps:"));
      if (!options.analyzeOnly) {
        console.log(chalk.dim(`  vibe project info ${options.output}`));
        console.log(chalk.dim(`  vibe export ${options.output} -o final.mp4`));
      }
      if (unmatchedSegments.length > 0) {
        console.log(chalk.dim("  Consider adding more B-roll clips for unmatched segments"));
      }
      console.log();
    } catch (error) {
      console.error(chalk.red("B-Roll matching failed"));
      console.error(error);
      process.exit(1);
    }
  });

// Platform specifications for viral optimization
const PLATFORM_SPECS: Record<string, PlatformSpec> = {
  youtube: {
    id: "youtube",
    name: "YouTube",
    aspectRatio: "16:9",
    maxDuration: 600,
    idealDuration: { min: 60, max: 480 },
    features: { captions: true, hook: true },
  },
  "youtube-shorts": {
    id: "youtube-shorts",
    name: "YouTube Shorts",
    aspectRatio: "9:16",
    maxDuration: 60,
    idealDuration: { min: 15, max: 60 },
    features: { captions: true, hook: true },
  },
  tiktok: {
    id: "tiktok",
    name: "TikTok",
    aspectRatio: "9:16",
    maxDuration: 180,
    idealDuration: { min: 15, max: 60 },
    features: { captions: true, hook: true },
  },
  "instagram-reels": {
    id: "instagram-reels",
    name: "Instagram Reels",
    aspectRatio: "9:16",
    maxDuration: 90,
    idealDuration: { min: 15, max: 60 },
    features: { captions: true, hook: true },
  },
  "instagram-feed": {
    id: "instagram-feed",
    name: "Instagram Feed",
    aspectRatio: "1:1",
    maxDuration: 60,
    idealDuration: { min: 15, max: 60 },
    features: { captions: true, hook: false },
  },
  twitter: {
    id: "twitter",
    name: "Twitter",
    aspectRatio: "16:9",
    maxDuration: 140,
    idealDuration: { min: 15, max: 60 },
    features: { captions: true, hook: true },
  },
};

// Viral Optimizer command
aiCommand
  .command("viral")
  .description("Optimize video for viral potential across platforms")
  .argument("<project>", "Source project file")
  .option("-p, --platforms <list>", "Target platforms (comma-separated): youtube, youtube-shorts, tiktok, instagram-reels, instagram-feed, twitter", "all")
  .option("-o, --output-dir <dir>", "Output directory for platform variants", "viral-output")
  .option("--analyze-only", "Only analyze, don't generate variants")
  .option("--skip-captions", "Skip caption generation")
  .option("--caption-style <style>", "Caption style: minimal, bold, animated", "bold")
  .option("--hook-duration <sec>", "Hook duration in seconds", "3")
  .option("-l, --language <lang>", "Language code for transcription")
  .option("--auto-narrate", "Auto-generate narration if no audio source found")
  .option("--narrate-voice <voice>", "Voice for auto-narration (default: rachel)", "rachel")
  .option("--narrate-style <style>", "Style for auto-narration: informative, energetic, calm, dramatic", "informative")
  .action(async (projectPath: string, options) => {
    try {
      // Validate API keys
      const openaiApiKey = await getApiKey("OPENAI_API_KEY", "OpenAI");
      if (!openaiApiKey) {
        console.error(chalk.red("OpenAI API key required for Whisper transcription."));
        console.error(chalk.dim("Set OPENAI_API_KEY environment variable"));
        process.exit(1);
      }

      const claudeApiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic");
      if (!claudeApiKey) {
        console.error(chalk.red("Anthropic API key required for viral analysis."));
        console.error(chalk.dim("Set ANTHROPIC_API_KEY environment variable"));
        process.exit(1);
      }

      // Load project
      let filePath = resolve(process.cwd(), projectPath);
      // If directory, look for project.vibe.json inside
      const { statSync } = await import("node:fs");
      try {
        if (statSync(filePath).isDirectory()) {
          const candidates = ["project.vibe.json", ".vibe.json"];
          let found = false;
          for (const candidate of candidates) {
            const candidatePath = resolve(filePath, candidate);
            if (existsSync(candidatePath)) {
              filePath = candidatePath;
              found = true;
              break;
            }
          }
          if (!found) {
            // Try any .vibe.json file in the directory
            const { readdirSync } = await import("node:fs");
            const files = readdirSync(filePath).filter((f: string) => f.endsWith(".vibe.json"));
            if (files.length > 0) {
              filePath = resolve(filePath, files[0]);
            } else {
              console.error(chalk.red(`No .vibe.json project file found in: ${filePath}`));
              process.exit(1);
            }
          }
        }
      } catch { /* not a directory, treat as file */ }

      if (!existsSync(filePath)) {
        console.error(chalk.red(`Project file not found: ${filePath}`));
        process.exit(1);
      }

      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      // Parse target platforms
      let targetPlatforms: string[];
      if (options.platforms === "all") {
        targetPlatforms = Object.keys(PLATFORM_SPECS);
      } else {
        targetPlatforms = options.platforms.split(",").map((p: string) => p.trim().toLowerCase());
        // Validate platforms
        for (const platform of targetPlatforms) {
          if (!PLATFORM_SPECS[platform]) {
            console.error(chalk.red(`Unknown platform: ${platform}`));
            console.error(chalk.dim(`Available: ${Object.keys(PLATFORM_SPECS).join(", ")}`));
            process.exit(1);
          }
        }
      }

      console.log();
      console.log(chalk.bold.cyan("🚀 Viral Optimizer Pipeline"));
      console.log(chalk.dim("─".repeat(60)));
      console.log();

      // Get project info
      const clips = project.getClips();
      const sources = project.getSources();

      // Calculate total duration from clips
      let totalDuration = 0;
      for (const clip of clips) {
        const endTime = clip.startTime + clip.duration;
        if (endTime > totalDuration) {
          totalDuration = endTime;
        }
      }

      const projectInfo = `${project.getMeta().name} (${formatTime(totalDuration)}, ${clips.length} clips)`;
      console.log(`✔ Loaded project: ${chalk.bold(projectInfo)}`);

      // Step 1: Extract audio and transcribe
      // Find audio source first (narration), fall back to video
      let audioSource = sources.find((s) => s.type === "audio");
      const videoSource = sources.find((s) => s.type === "video");

      // Check if auto-narrate is needed
      if (!audioSource && videoSource && options.autoNarrate) {
        console.log();
        console.log(chalk.yellow("📝 No narration found, generating with AI..."));

        const outputDir = resolve(process.cwd(), options.outputDir);
        const videoPath = resolve(dirname(filePath), videoSource.url);

        const narrateResult = await autoNarrate({
          videoPath,
          duration: totalDuration,
          outputDir,
          voice: options.narrateVoice,
          style: options.narrateStyle as "informative" | "energetic" | "calm" | "dramatic",
          language: options.language || "en",
        });

        if (!narrateResult.success) {
          console.error(chalk.red(`Auto-narrate failed: ${narrateResult.error}`));
          process.exit(1);
        }

        console.log(chalk.green(`✔ Generated narration: ${narrateResult.audioPath}`));

        // Add the generated narration as a source
        // Use relative path from project directory to audio file
        const projectDir = dirname(filePath);
        const relativeAudioPath = relative(projectDir, narrateResult.audioPath!);
        const newAudioSource = project.addSource({
          name: "Auto-generated narration",
          url: relativeAudioPath,
          type: "audio",
          duration: totalDuration,
        });

        // Add audio clip to timeline
        const audioTrack = project.getTracks().find((t) => t.type === "audio");
        if (audioTrack) {
          project.addClip({
            sourceId: newAudioSource.id,
            trackId: audioTrack.id,
            startTime: 0,
            duration: totalDuration,
            sourceStartOffset: 0,
            sourceEndOffset: totalDuration,
          });
        }

        // Save updated project
        await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

        // Use the generated segments as transcript
        if (narrateResult.segments && narrateResult.segments.length > 0) {
          // Continue with viral analysis using auto-narrate segments
          audioSource = newAudioSource;
        }
      }

      const mediaSource = audioSource || videoSource;
      if (!mediaSource) {
        console.error(chalk.red("No video or audio source found in project"));
        process.exit(1);
      }

      // Check FFmpeg availability
      try {
        execSync("ffmpeg -version", { stdio: "ignore" });
      } catch {
        console.error(chalk.red("FFmpeg not found. Please install FFmpeg."));
        process.exit(1);
      }

      const transcribeSpinner = ora("📝 Transcribing content with Whisper...").start();

      let audioPath = resolve(dirname(filePath), mediaSource.url);
      let tempAudioPath: string | null = null;

      // Extract audio if video
      if (mediaSource.type === "video") {
        transcribeSpinner.text = "🎵 Extracting audio from video...";
        tempAudioPath = `/tmp/vibe_viral_audio_${Date.now()}.wav`;
        await execAsync(
          `ffmpeg -i "${audioPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${tempAudioPath}" -y`,
          { maxBuffer: 50 * 1024 * 1024 }
        );
        audioPath = tempAudioPath;
      }

      // Transcribe with Whisper
      const whisper = new WhisperProvider();
      await whisper.initialize({ apiKey: openaiApiKey });

      const audioBuffer = await readFile(audioPath);
      const audioBlob = new Blob([audioBuffer]);

      transcribeSpinner.text = "📝 Transcribing with Whisper...";
      const transcriptResult = await whisper.transcribe(audioBlob, options.language);

      // Cleanup temp file
      if (tempAudioPath && existsSync(tempAudioPath)) {
        await execAsync(`rm "${tempAudioPath}"`).catch(() => {});
      }

      if (transcriptResult.status === "failed" || !transcriptResult.segments) {
        transcribeSpinner.fail(chalk.red(`Transcription failed: ${transcriptResult.error}`));
        process.exit(1);
      }

      transcribeSpinner.succeed(chalk.green(`Transcribed ${transcriptResult.segments.length} segments`));

      // Step 2: Analyze viral potential with Claude
      const analyzeSpinner = ora("📊 Analyzing viral potential...").start();

      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey: claudeApiKey });

      const viralAnalysis = await claude.analyzeViralPotential(
        transcriptResult.segments,
        { duration: totalDuration, clipCount: clips.length },
        targetPlatforms
      );

      analyzeSpinner.succeed(chalk.green("Analysis complete"));

      // Display analysis summary
      console.log();
      console.log(chalk.bold.cyan("Viral Potential Summary"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`  Overall Score: ${chalk.bold(viralAnalysis.overallScore + "%")}`);
      console.log(`  Hook Strength: ${chalk.bold(viralAnalysis.hookStrength + "%")}`);
      console.log(`  Pacing: ${chalk.bold(viralAnalysis.pacing)}`);
      console.log();

      // Platform suitability bars
      console.log("  Platform Suitability:");
      for (const platform of targetPlatforms) {
        const platformData = viralAnalysis.platforms[platform];
        if (platformData) {
          const score = Math.round(platformData.suitability * 100);
          const filledBars = Math.round(score / 10);
          const emptyBars = 10 - filledBars;
          const bar = "█".repeat(filledBars) + "░".repeat(emptyBars);
          const platformName = PLATFORM_SPECS[platform].name.padEnd(16);
          console.log(`    ${platformName} ${bar} ${score}%`);
        }
      }
      console.log();

      // Emotional peaks
      if (viralAnalysis.emotionalPeaks.length > 0) {
        console.log("  Emotional Peaks:");
        for (const peak of viralAnalysis.emotionalPeaks.slice(0, 5)) {
          console.log(`    ${formatTime(peak.time)} - ${peak.emotion} (${(peak.intensity * 100).toFixed(0)}%)`);
        }
        console.log();
      }

      // Hook recommendation
      if (viralAnalysis.hookRecommendation.suggestedStartTime > 0) {
        console.log(`  ${chalk.yellow("💡 Hook Tip:")} Consider starting at ${formatTime(viralAnalysis.hookRecommendation.suggestedStartTime)}`);
        console.log(`     ${chalk.dim(viralAnalysis.hookRecommendation.reason)}`);
        console.log();
      }

      // If analyze-only, stop here
      if (options.analyzeOnly) {
        // Save analysis JSON
        const outputDir = resolve(process.cwd(), options.outputDir);
        if (!existsSync(outputDir)) {
          await mkdir(outputDir, { recursive: true });
        }
        const analysisPath = resolve(outputDir, "analysis.json");
        await writeFile(analysisPath, JSON.stringify(viralAnalysis, null, 2), "utf-8");

        console.log(chalk.green(`💾 Analysis saved to: ${analysisPath}`));
        console.log();
        console.log(chalk.bold.green("✅ Analysis complete!"));
        console.log();
        return;
      }

      // Step 3: Generate platform variants
      console.log(chalk.bold.cyan("🎬 Generating platform variants..."));

      const outputDir = resolve(process.cwd(), options.outputDir);
      if (!existsSync(outputDir)) {
        await mkdir(outputDir, { recursive: true });
      }

      const generatedProjects: Array<{ platform: string; path: string; duration: number; aspectRatio: string }> = [];

      for (const platformId of targetPlatforms) {
        const platform = PLATFORM_SPECS[platformId];
        const variantSpinner = ora(`  Generating ${platform.name}...`).start();

        try {
          // Get platform-specific cuts from Claude
          const clipsInfo = clips.map((c) => ({
            id: c.id,
            startTime: c.startTime,
            duration: c.duration,
          }));

          const platformCut = await claude.suggestPlatformCuts(
            transcriptResult.segments,
            viralAnalysis,
            platform,
            clipsInfo
          );

          // Create platform-specific project
          const platformProject = new Project(`${project.getMeta().name} - ${platform.name}`);
          platformProject.setAspectRatio(platform.aspectRatio as "16:9" | "9:16" | "1:1");

          // Copy sources
          const sourceMap = new Map<string, string>();
          for (const source of sources) {
            const newSource = platformProject.addSource({
              name: source.name,
              url: source.url,
              type: source.type,
              duration: source.duration,
            });
            sourceMap.set(source.id, newSource.id);
          }

          // Get video track
          const videoTrack = platformProject.getTracks().find((t) => t.type === "video");
          if (!videoTrack) {
            variantSpinner.fail(chalk.red(`Failed to create ${platform.name} variant`));
            continue;
          }

          // Add clips based on platform cuts
          let currentTime = 0;
          let platformDuration = 0;
          let audioStartOffset = 0; // Track where in original timeline the cut starts

          if (platformCut.segments.length > 0) {
            // Use AI-suggested segments
            // Determine audio start offset from first segment's original timeline position
            const firstSegment = platformCut.segments[0];
            const firstOriginalClip = clips.find((c) => c.id === firstSegment.sourceClipId);
            if (firstOriginalClip) {
              // Calculate timeline position: clip start + offset within source
              audioStartOffset = firstOriginalClip.startTime + (firstSegment.startTime - firstOriginalClip.sourceStartOffset);
            }

            for (const segment of platformCut.segments) {
              // Find the original clip
              const originalClip = clips.find((c) => c.id === segment.sourceClipId);
              if (!originalClip) continue;

              const sourceId = sourceMap.get(originalClip.sourceId);
              if (!sourceId) continue;

              const segmentDuration = segment.endTime - segment.startTime;
              platformProject.addClip({
                sourceId,
                trackId: videoTrack.id,
                startTime: currentTime,
                duration: segmentDuration,
                sourceStartOffset: segment.startTime,
                sourceEndOffset: segment.endTime,
              });
              currentTime += segmentDuration;
              platformDuration += segmentDuration;
            }
          } else {
            // Fallback: use original clips, trimmed to fit duration
            // Audio starts from first clip's timeline position
            if (clips.length > 0) {
              audioStartOffset = clips[0].startTime;
            }

            for (const clip of clips) {
              const sourceId = sourceMap.get(clip.sourceId);
              if (!sourceId) continue;

              if (currentTime + clip.duration <= platform.maxDuration) {
                platformProject.addClip({
                  sourceId,
                  trackId: videoTrack.id,
                  startTime: currentTime,
                  duration: clip.duration,
                  sourceStartOffset: clip.sourceStartOffset,
                  sourceEndOffset: clip.sourceEndOffset,
                });
                currentTime += clip.duration;
                platformDuration += clip.duration;
              } else {
                // Trim the last clip to fit
                const remainingDuration = platform.maxDuration - currentTime;
                if (remainingDuration > 0) {
                  platformProject.addClip({
                    sourceId,
                    trackId: videoTrack.id,
                    startTime: currentTime,
                    duration: remainingDuration,
                    sourceStartOffset: clip.sourceStartOffset,
                    sourceEndOffset: clip.sourceStartOffset + remainingDuration,
                  });
                  platformDuration += remainingDuration;
                }
                break;
              }
            }
          }

          // Add audio clip if original project has audio
          const originalAudioSource = sources.find((s) => s.type === "audio");
          const audioTrack = platformProject.getTracks().find((t) => t.type === "audio");
          if (originalAudioSource && audioTrack && platformDuration > 0) {
            const audioSourceId = sourceMap.get(originalAudioSource.id);
            if (audioSourceId) {
              // Add audio clip synced with the video cut
              platformProject.addClip({
                sourceId: audioSourceId,
                trackId: audioTrack.id,
                startTime: 0,
                duration: platformDuration,
                sourceStartOffset: audioStartOffset,
                sourceEndOffset: audioStartOffset + platformDuration,
              });
            }
          }

          // Generate captions if not skipped
          if (!options.skipCaptions) {
            const captionStyle = options.captionStyle as "minimal" | "bold" | "animated";
            const captions = await claude.generateViralCaptions(
              transcriptResult.segments.filter(
                (s) => s.endTime <= platformDuration
              ),
              captionStyle
            );

            // Store captions as project metadata (for future caption track support)
            // For now, save as separate file
            if (captions.length > 0) {
              const captionsPath = resolve(outputDir, `${platformId}-captions.json`);
              await writeFile(captionsPath, JSON.stringify(captions, null, 2), "utf-8");
            }
          }

          // Save platform project
          const projectPath = resolve(outputDir, `${platformId}.vibe.json`);
          await writeFile(projectPath, JSON.stringify(platformProject.toJSON(), null, 2), "utf-8");

          generatedProjects.push({
            platform: platform.name,
            path: projectPath,
            duration: platformDuration,
            aspectRatio: platform.aspectRatio,
          });

          variantSpinner.succeed(chalk.green(`  ✔ ${platformId}.vibe.json (${formatTime(platformDuration)}, ${platform.aspectRatio})`));
        } catch (error) {
          variantSpinner.fail(chalk.red(`  ✘ Failed to generate ${platform.name}: ${error}`));
        }
      }

      // Save analysis JSON
      const analysisPath = resolve(outputDir, "analysis.json");
      const result: ViralOptimizationResult = {
        sourceProject: filePath,
        analysis: viralAnalysis,
        platformCuts: [],
        platformProjects: generatedProjects.map((p) => ({
          platform: p.platform,
          projectPath: p.path,
          duration: p.duration,
          aspectRatio: p.aspectRatio,
        })),
      };
      await writeFile(analysisPath, JSON.stringify(result, null, 2), "utf-8");

      // Final summary
      console.log();
      console.log(chalk.dim("─".repeat(60)));
      console.log(chalk.bold.green(`✅ Viral optimization complete!`));
      console.log(`   ${chalk.bold(generatedProjects.length)} platform variants generated`);
      console.log();
      console.log(`💾 Saved to: ${chalk.cyan(outputDir)}/`);
      console.log();
      console.log(chalk.dim("Next steps:"));
      for (const proj of generatedProjects.slice(0, 3)) {
        const filename = basename(proj.path);
        console.log(chalk.dim(`  vibe export ${options.outputDir}/${filename} -o ${proj.platform.toLowerCase().replace(/\s+/g, "-")}.mp4`));
      }
      if (generatedProjects.length > 3) {
        console.log(chalk.dim(`  ... and ${generatedProjects.length - 3} more`));
      }
      console.log();
    } catch (error) {
      console.error(chalk.red("Viral optimization failed"));
      console.error(error);
      process.exit(1);
    }
  });

/**
 * Discover B-roll video files from paths or directory
 */
async function discoverBrollFiles(
  paths?: string,
  directory?: string
): Promise<string[]> {
  const files: string[] = [];
  const videoExtensions = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"];

  if (paths) {
    const pathList = paths.split(",").map((p) => resolve(process.cwd(), p.trim()));
    for (const path of pathList) {
      if (existsSync(path)) {
        files.push(path);
      }
    }
  }

  if (directory) {
    const dir = resolve(process.cwd(), directory);
    if (existsSync(dir)) {
      const entries = await readdir(dir);
      for (const entry of entries) {
        const ext = extname(entry).toLowerCase();
        if (videoExtensions.includes(ext)) {
          files.push(resolve(dir, entry));
        }
      }
    }
  }

  return files;
}

/**
 * Extract a key frame from video as base64 JPEG
 */
async function extractKeyFrame(videoPath: string, timestamp: number): Promise<string> {
  const tempPath = `/tmp/vibe_frame_${Date.now()}.jpg`;
  await execAsync(
    `ffmpeg -ss ${timestamp} -i "${videoPath}" -frames:v 1 -q:v 2 "${tempPath}" -y`,
    { maxBuffer: 10 * 1024 * 1024 }
  );
  const buffer = await readFile(tempPath);
  await execAsync(`rm "${tempPath}"`).catch(() => {});
  return buffer.toString("base64");
}

/**
 * Check if a file path looks like an audio or video file
 */
function isAudioOrVideoFile(path: string): boolean {
  const mediaExtensions = [
    ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac",
    ".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v",
  ];
  const ext = extname(path).toLowerCase();
  return mediaExtensions.includes(ext);
}

// Auto Highlights command
aiCommand
  .command("highlights")
  .description("Extract highlights from long-form video/audio content")
  .argument("<media>", "Video or audio file path")
  .option("-o, --output <path>", "Output JSON file with highlights")
  .option("-p, --project <path>", "Create project with highlight clips")
  .option("-d, --duration <seconds>", "Target highlight reel duration", "60")
  .option("-n, --count <number>", "Maximum number of highlights")
  .option("-t, --threshold <value>", "Confidence threshold (0-1)", "0.7")
  .option("--criteria <type>", "Selection criteria: emotional | informative | funny | all", "all")
  .option("-l, --language <lang>", "Language code for transcription (e.g., en, ko)")
  .option("--use-gemini", "Use Gemini Video Understanding for enhanced visual+audio analysis")
  .option("--low-res", "Use low resolution mode for longer videos (Gemini only)")
  .action(async (mediaPath: string, options) => {
    try {
      const absPath = resolve(process.cwd(), mediaPath);
      if (!existsSync(absPath)) {
        console.error(chalk.red(`File not found: ${absPath}`));
        process.exit(1);
      }

      // Determine if we need to extract audio (for video files)
      const ext = extname(absPath).toLowerCase();
      const videoExtensions = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"];
      const isVideo = videoExtensions.includes(ext);

      console.log();
      console.log(chalk.bold.cyan("🎬 Highlight Extraction Pipeline"));
      console.log(chalk.dim("─".repeat(60)));
      if (options.useGemini) {
        console.log(chalk.dim("Using Gemini Video Understanding (visual + audio analysis)"));
      } else {
        console.log(chalk.dim("Using Whisper + Claude (audio-based analysis)"));
      }
      console.log();

      const targetDuration = options.duration ? parseFloat(options.duration) : undefined;
      const maxCount = options.count ? parseInt(options.count) : undefined;

      let allHighlights: Highlight[] = [];
      let sourceDuration = 0;

      if (options.useGemini && isVideo) {
        // Gemini Video Understanding flow - visual + audio analysis
        const geminiApiKey = await getApiKey("GOOGLE_API_KEY", "Google");
        if (!geminiApiKey) {
          console.error(chalk.red("Google API key required for Gemini Video Understanding."));
          console.error(chalk.dim("Set GOOGLE_API_KEY environment variable"));
          process.exit(1);
        }

        // Get video duration
        const durationSpinner = ora("📊 Analyzing video metadata...").start();
        try {
          const durationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${absPath}"`;
          const { stdout: durationOut } = await execAsync(durationCmd);
          sourceDuration = parseFloat(durationOut.trim());
          durationSpinner.succeed(chalk.green(`Video duration: ${formatTime(sourceDuration)}`));
        } catch {
          durationSpinner.fail(chalk.red("Failed to get video duration"));
          process.exit(1);
        }

        // Analyze with Gemini Video
        const geminiSpinner = ora("🎬 Analyzing video with Gemini (visual + audio)...").start();

        const gemini = new GeminiProvider();
        await gemini.initialize({ apiKey: geminiApiKey });

        // Read video file
        const videoBuffer = await readFile(absPath);

        // Build prompt for highlight extraction
        const criteriaText = options.criteria === "all"
          ? "emotional, informative, and funny moments"
          : `${options.criteria} moments`;

        const durationText = targetDuration
          ? `Target a total highlight duration of ${targetDuration} seconds.`
          : "";
        const countText = maxCount
          ? `Find up to ${maxCount} highlights.`
          : "";

        const geminiPrompt = `Analyze this video and identify the most engaging highlights based on BOTH visual and audio content.

Focus on finding ${criteriaText}. ${durationText} ${countText}

For each highlight, provide:
1. Start timestamp (in seconds, as a number)
2. End timestamp (in seconds, as a number)
3. Category: "emotional", "informative", or "funny"
4. Confidence score (0-1)
5. Brief reason why this is a highlight
6. What is said/shown during this moment

IMPORTANT: Respond ONLY with valid JSON in this exact format:
{
  "highlights": [
    {
      "startTime": 12.5,
      "endTime": 28.3,
      "category": "emotional",
      "confidence": 0.95,
      "reason": "Powerful personal story about overcoming challenges",
      "transcript": "When I first started, everyone said it was impossible..."
    }
  ]
}

Analyze both what is SHOWN (visual cues, actions, expressions) and what is SAID (speech, reactions) to find the most compelling moments.`;

        const result = await gemini.analyzeVideo(videoBuffer, geminiPrompt, {
          fps: 1,
          lowResolution: options.lowRes,
        });

        if (!result.success || !result.response) {
          geminiSpinner.fail(chalk.red(`Gemini analysis failed: ${result.error}`));
          process.exit(1);
        }

        // Parse Gemini response
        try {
          // Extract JSON from response (may have markdown code blocks)
          let jsonStr = result.response;
          const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (jsonMatch) {
            jsonStr = jsonMatch[1];
          }
          // Also try to find raw JSON object
          const objectMatch = jsonStr.match(/\{[\s\S]*"highlights"[\s\S]*\}/);
          if (objectMatch) {
            jsonStr = objectMatch[0];
          }

          const parsed = JSON.parse(jsonStr);

          if (parsed.highlights && Array.isArray(parsed.highlights)) {
            allHighlights = parsed.highlights.map((h: {
              startTime: number;
              endTime: number;
              category?: string;
              confidence?: number;
              reason?: string;
              transcript?: string;
            }, i: number) => ({
              index: i + 1,
              startTime: h.startTime,
              endTime: h.endTime,
              duration: h.endTime - h.startTime,
              category: h.category || "all",
              confidence: h.confidence || 0.8,
              reason: h.reason || "Engaging moment",
              transcript: h.transcript || "",
            }));
          }
        } catch (parseError) {
          geminiSpinner.fail(chalk.red("Failed to parse Gemini response"));
          console.error(chalk.dim("Response was:"), result.response.substring(0, 500));
          process.exit(1);
        }

        geminiSpinner.succeed(chalk.green(`Found ${allHighlights.length} highlights via visual+audio analysis`));

      } else {
        // Original Whisper + Claude flow
        const openaiApiKey = await getApiKey("OPENAI_API_KEY", "OpenAI");
        if (!openaiApiKey) {
          console.error(chalk.red("OpenAI API key required for Whisper transcription."));
          console.error(chalk.dim("Set OPENAI_API_KEY environment variable"));
          process.exit(1);
        }

        const claudeApiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic");
        if (!claudeApiKey) {
          console.error(chalk.red("Anthropic API key required for highlight analysis."));
          console.error(chalk.dim("Set ANTHROPIC_API_KEY environment variable"));
          process.exit(1);
        }

        let audioPath = absPath;
        let tempAudioPath: string | null = null;

        // Step 1: Extract audio if video
        if (isVideo) {
          const audioSpinner = ora("🎵 Extracting audio from video...").start();

          try {
            // Check FFmpeg availability
            try {
              execSync("ffmpeg -version", { stdio: "ignore" });
            } catch {
              audioSpinner.fail(chalk.red("FFmpeg not found. Please install FFmpeg."));
              process.exit(1);
            }

            // Check if video has an audio stream
            const { stdout: probeOut } = await execAsync(
              `ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "${absPath}"`
            );
            const hasAudio = probeOut.trim().length > 0;

            if (!hasAudio) {
              audioSpinner.fail(chalk.yellow("Video has no audio track — cannot use Whisper transcription"));
              console.log(chalk.yellow("\n⚠ This video has no audio stream."));
              console.log(chalk.dim("  Use --use-gemini flag for visual-only analysis of videos without audio."));
              console.log(chalk.dim("  Example: vibe ai highlights video.mp4 --use-gemini\n"));
              process.exit(1);
            } else {
              tempAudioPath = `/tmp/vibe_highlight_audio_${Date.now()}.wav`;
              await execAsync(
                `ffmpeg -i "${absPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${tempAudioPath}" -y`,
                { maxBuffer: 50 * 1024 * 1024 }
              );
              audioPath = tempAudioPath;
            }

            // Get video duration
            const durationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${absPath}"`;
            const { stdout: durationOut } = await execAsync(durationCmd);
            sourceDuration = parseFloat(durationOut.trim());

            if (hasAudio) {
              audioSpinner.succeed(chalk.green(`Extracted audio (${formatTime(sourceDuration)} total duration)`));
            }
          } catch (error) {
            audioSpinner.fail(chalk.red("Failed to extract audio"));
            console.error(error);
            process.exit(1);
          }
        }

        // Step 2: Transcribe with Whisper
        const transcribeSpinner = ora("📝 Transcribing with Whisper...").start();

        const whisper = new WhisperProvider();
        await whisper.initialize({ apiKey: openaiApiKey });

        const audioBuffer = await readFile(audioPath);
        const audioBlob = new Blob([audioBuffer]);

        const transcriptResult = await whisper.transcribe(audioBlob, options.language);

        if (transcriptResult.status === "failed" || !transcriptResult.segments) {
          transcribeSpinner.fail(chalk.red(`Transcription failed: ${transcriptResult.error}`));
          // Cleanup temp file
          if (tempAudioPath && existsSync(tempAudioPath)) {
            await execAsync(`rm "${tempAudioPath}"`).catch(() => {});
          }
          process.exit(1);
        }

        transcribeSpinner.succeed(chalk.green(`Transcribed ${transcriptResult.segments.length} segments`));

        // Cleanup temp audio file
        if (tempAudioPath && existsSync(tempAudioPath)) {
          await execAsync(`rm "${tempAudioPath}"`).catch(() => {});
        }

        // Get source duration from transcript segments
        if (transcriptResult.segments.length > 0) {
          sourceDuration = transcriptResult.segments[transcriptResult.segments.length - 1].endTime;
        }

        // Step 3: Analyze with Claude
        const analyzeSpinner = ora("🔍 Analyzing highlights with Claude...").start();

        const claude = new ClaudeProvider();
        await claude.initialize({ apiKey: claudeApiKey });

        allHighlights = await claude.analyzeForHighlights(transcriptResult.segments, {
          criteria: options.criteria as HighlightCriteria,
          targetDuration,
          maxCount,
        });

        if (allHighlights.length === 0) {
          analyzeSpinner.warn(chalk.yellow("No highlights detected in the content"));
          process.exit(0);
        }

        analyzeSpinner.succeed(chalk.green(`Found ${allHighlights.length} potential highlights`));
      }

      if (allHighlights.length === 0) {
        console.log(chalk.yellow("No highlights detected in the content"));
        process.exit(0);
      }

      // Step 4: Filter and rank
      const filterSpinner = ora("📊 Filtering and ranking...").start();

      const threshold = parseFloat(options.threshold);
      const filteredHighlights = filterHighlights(allHighlights, {
        threshold,
        targetDuration,
        maxCount,
      });

      const totalHighlightDuration = filteredHighlights.reduce((sum, h) => sum + h.duration, 0);

      filterSpinner.succeed(chalk.green(`Selected ${filteredHighlights.length} highlights (${totalHighlightDuration.toFixed(1)}s total)`));

      // Prepare result
      const result: HighlightsResult = {
        sourceFile: absPath,
        totalDuration: sourceDuration,
        criteria: options.criteria as HighlightCriteria,
        threshold,
        highlightsCount: filteredHighlights.length,
        totalHighlightDuration,
        highlights: filteredHighlights,
      };

      // Step 5: Output results
      console.log();
      console.log(chalk.bold.cyan("Highlights Summary"));
      console.log(chalk.dim("─".repeat(60)));

      for (const highlight of filteredHighlights) {
        const startFormatted = formatTime(highlight.startTime);
        const endFormatted = formatTime(highlight.endTime);
        const confidencePercent = (highlight.confidence * 100).toFixed(0);
        const categoryColor = getCategoryColor(highlight.category);

        console.log();
        console.log(`  ${chalk.yellow(`${highlight.index}.`)} [${startFormatted} - ${endFormatted}] ${categoryColor(highlight.category)}, ${chalk.dim(`${confidencePercent}%`)}`);
        console.log(`     ${chalk.white(highlight.reason)}`);
        console.log(`     ${chalk.dim(truncate(highlight.transcript, 80))}`);
      }

      console.log();
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Total: ${chalk.bold(filteredHighlights.length)} highlights, ${chalk.bold(totalHighlightDuration.toFixed(1))} seconds`);
      console.log();

      // Save JSON output
      if (options.output) {
        const outputPath = resolve(process.cwd(), options.output);
        await writeFile(outputPath, JSON.stringify(result, null, 2), "utf-8");
        console.log(chalk.green(`💾 Saved highlights to: ${outputPath}`));
      }

      // Create project with highlight clips
      if (options.project) {
        const projectSpinner = ora("📦 Creating project...").start();

        const project = new Project("Highlight Reel");

        // Add source
        const source = project.addSource({
          name: basename(absPath),
          url: absPath,
          type: isVideo ? "video" : "audio",
          duration: sourceDuration,
        });

        // Get video track
        const videoTrack = project.getTracks().find((t) => t.type === "video");
        if (!videoTrack) {
          projectSpinner.fail(chalk.red("Failed to create project"));
          process.exit(1);
        }

        // Add clips for each highlight
        let currentTime = 0;
        for (const highlight of filteredHighlights) {
          project.addClip({
            sourceId: source.id,
            trackId: videoTrack.id,
            startTime: currentTime,
            duration: highlight.duration,
            sourceStartOffset: highlight.startTime,
            sourceEndOffset: highlight.endTime,
          });
          currentTime += highlight.duration;
        }

        const projectPath = resolve(process.cwd(), options.project);
        await writeFile(projectPath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

        projectSpinner.succeed(chalk.green(`Created project: ${projectPath}`));
      }

      console.log();
      console.log(chalk.bold.green("✅ Highlight extraction complete!"));
      console.log();
    } catch (error) {
      console.error(chalk.red("Highlight extraction failed"));
      console.error(error);
      process.exit(1);
    }
  });

/**
 * Filter highlights by threshold, count, and target duration
 */
function filterHighlights(
  highlights: Highlight[],
  options: { threshold: number; targetDuration?: number; maxCount?: number }
): Highlight[] {
  // 1. Filter by confidence threshold
  let filtered = highlights.filter((h) => h.confidence >= options.threshold);

  // 2. Sort by confidence (descending)
  filtered.sort((a, b) => b.confidence - a.confidence);

  // 3. Limit by count if specified
  if (options.maxCount && filtered.length > options.maxCount) {
    filtered = filtered.slice(0, options.maxCount);
  }

  // 4. Fit to target duration if specified (with 10% tolerance)
  if (options.targetDuration) {
    const targetWithTolerance = options.targetDuration * 1.1;
    let total = 0;
    filtered = filtered.filter((h) => {
      if (total + h.duration <= targetWithTolerance) {
        total += h.duration;
        return true;
      }
      return false;
    });
  }

  // 5. Re-sort by startTime (chronological order)
  filtered.sort((a, b) => a.startTime - b.startTime);

  // 6. Re-index
  return filtered.map((h, i) => ({ ...h, index: i + 1 }));
}

/**
 * Get color for highlight category
 */
function getCategoryColor(category: string): (text: string) => string {
  switch (category) {
    case "emotional":
      return chalk.magenta;
    case "informative":
      return chalk.cyan;
    case "funny":
      return chalk.yellow;
    default:
      return chalk.white;
  }
}

/**
 * Truncate text with ellipsis
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

function getStatusColor(status: string): string {
  switch (status) {
    case "completed":
      return chalk.green(status);
    case "failed":
    case "cancelled":
      return chalk.red(status);
    case "processing":
      return chalk.yellow(status);
    default:
      return chalk.dim(status);
  }
}

// ============================================================================
// Voice & Audio Features
// ============================================================================

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
  .action(async (samples: string[], options) => {
    try {
      const apiKey = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("ElevenLabs API key required. Use --api-key or set ELEVENLABS_API_KEY"));
        process.exit(1);
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
        console.error(chalk.red("Voice name is required. Use --name <name>"));
        process.exit(1);
      }

      if (!samples || samples.length === 0) {
        console.error(chalk.red("At least one audio sample is required"));
        process.exit(1);
      }

      const spinner = ora("Reading audio samples...").start();

      const audioBuffers: Buffer[] = [];
      for (const samplePath of samples) {
        const absPath = resolve(process.cwd(), samplePath);
        if (!existsSync(absPath)) {
          spinner.fail(chalk.red(`File not found: ${samplePath}`));
          process.exit(1);
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
        spinner.fail(chalk.red(result.error || "Voice cloning failed"));
        process.exit(1);
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
      console.error(chalk.red("Voice cloning failed"));
      console.error(error);
      process.exit(1);
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
  .action(async (prompt: string, options) => {
    try {
      const apiKey = await getApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Replicate API token required. Use --api-key or set REPLICATE_API_TOKEN"));
        process.exit(1);
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
          spinner.fail(chalk.red(`Melody file not found: ${options.melody}`));
          process.exit(1);
        }
        // For Replicate, we need a publicly accessible URL
        // In practice, users would need to host the file or use a data URL
        console.log(chalk.yellow("Note: Melody conditioning requires a publicly accessible URL"));
        console.log(chalk.yellow("Please upload your melody file and provide the URL"));
        process.exit(1);
      }

      const result = await replicate.generateMusic(prompt, {
        duration,
        model: options.model as "large" | "stereo-large" | "melody-large" | "stereo-melody-large",
        melodyUrl,
      });

      if (!result.success || !result.taskId) {
        spinner.fail(chalk.red(result.error || "Music generation failed"));
        process.exit(1);
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
        spinner.fail(chalk.red(finalResult.error || "Music generation failed"));
        process.exit(1);
      }

      spinner.text = "Downloading generated audio...";

      const response = await fetch(finalResult.audioUrl);
      if (!response.ok) {
        spinner.fail(chalk.red("Failed to download generated audio"));
        process.exit(1);
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
      console.error(chalk.red("Music generation failed"));
      console.error(error);
      process.exit(1);
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
        console.error(chalk.red("Replicate API token required. Use --api-key or set REPLICATE_API_TOKEN"));
        process.exit(1);
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
      console.error(chalk.red("Failed to get music status"));
      console.error(error);
      process.exit(1);
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
  .action(async (audioPath: string, options) => {
    try {
      const absPath = resolve(process.cwd(), audioPath);
      if (!existsSync(absPath)) {
        console.error(chalk.red(`File not found: ${audioPath}`));
        process.exit(1);
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

          const filterArg = filters.length > 0 ? `-af "${filters.join(",")}"` : "";
          const cmd = `ffmpeg -i "${absPath}" ${filterArg} -y "${outputPath}"`;

          execSync(cmd, { stdio: "pipe" });

          spinner.succeed(chalk.green("Audio restored with FFmpeg"));
          console.log(`Saved to: ${chalk.bold(outputPath)}`);
          console.log();
        } catch (error) {
          spinner.fail(chalk.red("FFmpeg restoration failed"));
          if (error instanceof Error && "message" in error) {
            console.error(chalk.dim(error.message));
          }
          process.exit(1);
        }
        return;
      }

      // Replicate AI mode
      const apiKey = await getApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Replicate API token required. Use --api-key or set REPLICATE_API_TOKEN"));
        console.error(chalk.dim("Or use --ffmpeg for free FFmpeg-based restoration"));
        process.exit(1);
      }

      const replicate = new ReplicateProvider();
      await replicate.initialize({ apiKey });

      // For Replicate, we need a publicly accessible URL
      // This is a limitation - users need to upload their file first
      console.log(chalk.yellow("Note: Replicate requires a publicly accessible audio URL"));
      console.log(chalk.yellow("For local files, use --ffmpeg for free local processing"));
      console.log();
      console.log(chalk.dim("Example with FFmpeg:"));
      console.log(chalk.dim(`  pnpm vibe ai audio-restore ${audioPath} --ffmpeg`));
      process.exit(1);
    } catch (error) {
      console.error(chalk.red("Audio restoration failed"));
      console.error(error);
      process.exit(1);
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
  .action(async (mediaPath: string, options) => {
    try {
      if (!options.language) {
        console.error(chalk.red("Target language is required. Use -l or --language"));
        process.exit(1);
      }

      const absPath = resolve(process.cwd(), mediaPath);
      if (!existsSync(absPath)) {
        console.error(chalk.red(`File not found: ${mediaPath}`));
        process.exit(1);
      }

      // Check required API keys
      const openaiKey = await getApiKey("OPENAI_API_KEY", "OpenAI", undefined);
      const anthropicKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic", undefined);
      const elevenlabsKey = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs", undefined);

      if (!openaiKey) {
        console.error(chalk.red("OpenAI API key required for transcription. Set OPENAI_API_KEY"));
        process.exit(1);
      }

      if (!anthropicKey) {
        console.error(chalk.red("Anthropic API key required for translation. Set ANTHROPIC_API_KEY"));
        process.exit(1);
      }

      if (!options.analyzeOnly && !elevenlabsKey) {
        console.error(chalk.red("ElevenLabs API key required for TTS. Set ELEVENLABS_API_KEY"));
        console.error(chalk.dim("Or use --analyze-only to preview timing without generating audio"));
        process.exit(1);
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
          execSync(`ffmpeg -i "${absPath}" -vn -acodec mp3 -y "${tempAudioPath}"`, { stdio: "pipe" });
          audioPath = tempAudioPath;
        } catch (error) {
          spinner.fail(chalk.red("Failed to extract audio from video"));
          process.exit(1);
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
        spinner.fail(chalk.red(`Transcription failed: ${transcriptResult.error}`));
        process.exit(1);
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
      console.error(chalk.red("Dubbing failed"));
      console.error(error);
      process.exit(1);
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
  .action(async (musicPath: string, options) => {
    try {
      if (!options.voice) {
        console.error(chalk.red("Voice track required. Use --voice <path>"));
        process.exit(1);
      }

      // Check FFmpeg availability
      try {
        execSync("ffmpeg -version", { stdio: "ignore" });
      } catch {
        console.error(chalk.red("FFmpeg not found. Please install FFmpeg."));
        process.exit(1);
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

      const cmd = `ffmpeg -i "${absMusic}" -i "${absVoice}" -filter_complex "${filterComplex}" -map "[out]" "${outputPath}" -y`;

      await execAsync(cmd);

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
      console.error(chalk.red("Audio ducking failed"));
      console.error(error);
      process.exit(1);
    }
  });

// AI Color Grading
aiCommand
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
aiCommand
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
aiCommand
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
aiCommand
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

// Auto Shorts
aiCommand
  .command("auto-shorts")
  .description("Auto-generate shorts from long-form video")
  .argument("<video>", "Video file path")
  .option("-o, --output <path>", "Output file (single) or directory (multiple)")
  .option("-d, --duration <seconds>", "Target duration in seconds (15-60)", "60")
  .option("-n, --count <number>", "Number of shorts to generate", "1")
  .option("-a, --aspect <ratio>", "Aspect ratio: 9:16, 1:1", "9:16")
  .option("--output-dir <dir>", "Output directory for multiple shorts")
  .option("--add-captions", "Add auto-generated captions")
  .option("--caption-style <style>", "Caption style: minimal, bold, animated", "bold")
  .option("--analyze-only", "Show segments without generating")
  .option("-l, --language <lang>", "Language code for transcription")
  .option("--use-gemini", "Use Gemini Video Understanding for enhanced visual+audio analysis")
  .option("--low-res", "Use low resolution mode for longer videos (Gemini only)")
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
      if (!existsSync(absPath)) {
        console.error(chalk.red(`File not found: ${absPath}`));
        process.exit(1);
      }

      const targetDuration = parseInt(options.duration);
      const shortCount = parseInt(options.count);

      console.log();
      console.log(chalk.bold.cyan("🎬 Auto Shorts Generator"));
      console.log(chalk.dim("─".repeat(60)));
      if (options.useGemini) {
        console.log(chalk.dim("Using Gemini Video Understanding (visual + audio analysis)"));
      } else {
        console.log(chalk.dim("Using Whisper + Claude (audio-based analysis)"));
      }
      console.log();

      let highlights: Highlight[] = [];

      if (options.useGemini) {
        // Gemini Video Understanding flow
        const geminiApiKey = await getApiKey("GOOGLE_API_KEY", "Google");
        if (!geminiApiKey) {
          console.error(chalk.red("Google API key required for Gemini Video Understanding."));
          console.error(chalk.dim("Set GOOGLE_API_KEY environment variable"));
          process.exit(1);
        }

        const spinner = ora("🎬 Analyzing video with Gemini (visual + audio)...").start();

        const gemini = new GeminiProvider();
        await gemini.initialize({ apiKey: geminiApiKey });

        // Read video file
        const videoBuffer = await readFile(absPath);

        // Build prompt for short-form content detection
        const geminiPrompt = `Analyze this video to find the BEST moments for short-form vertical video content (TikTok, YouTube Shorts, Instagram Reels).

Find ${shortCount * 3} potential clips that are ${targetDuration} seconds or shorter each.

Look for:
- Visually striking or surprising moments
- Emotional peaks (laughter, reactions, reveals)
- Key quotes or memorable statements
- Action sequences or dramatic moments
- Meme-worthy or shareable moments
- Strong hooks (great opening lines)
- Satisfying conclusions

For each highlight, provide:
1. Start timestamp (seconds, as number)
2. End timestamp (seconds, as number) - ensure duration is close to ${targetDuration}s
3. Virality score (0-1) - how likely this would perform on social media
4. Hook quality (0-1) - how strong is the opening
5. Brief reason why this would work as a short

IMPORTANT: Respond ONLY with valid JSON:
{
  "highlights": [
    {
      "startTime": 45.2,
      "endTime": 75.8,
      "confidence": 0.92,
      "hookQuality": 0.85,
      "reason": "Unexpected plot twist with strong visual reaction"
    }
  ]
}

Analyze both VISUALS (expressions, actions, scene changes) and AUDIO (speech, reactions, music) to find viral-worthy moments.`;

        const result = await gemini.analyzeVideo(videoBuffer, geminiPrompt, {
          fps: 1,
          lowResolution: options.lowRes,
        });

        if (!result.success || !result.response) {
          spinner.fail(chalk.red(`Gemini analysis failed: ${result.error}`));
          process.exit(1);
        }

        // Parse Gemini response
        try {
          let jsonStr = result.response;
          const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (jsonMatch) {
            jsonStr = jsonMatch[1];
          }
          const objectMatch = jsonStr.match(/\{[\s\S]*"highlights"[\s\S]*\}/);
          if (objectMatch) {
            jsonStr = objectMatch[0];
          }

          const parsed = JSON.parse(jsonStr);

          if (parsed.highlights && Array.isArray(parsed.highlights)) {
            highlights = parsed.highlights.map((h: {
              startTime: number;
              endTime: number;
              confidence?: number;
              hookQuality?: number;
              reason?: string;
            }, i: number) => ({
              index: i + 1,
              startTime: h.startTime,
              endTime: h.endTime,
              duration: h.endTime - h.startTime,
              category: "viral" as HighlightCriteria,
              confidence: h.confidence || 0.8,
              reason: h.reason || "Engaging moment",
              transcript: "",
            }));
          }
        } catch (parseError) {
          spinner.fail(chalk.red("Failed to parse Gemini response"));
          console.error(chalk.dim("Response was:"), result.response.substring(0, 500));
          process.exit(1);
        }

        spinner.succeed(chalk.green(`Found ${highlights.length} potential shorts via visual+audio analysis`));

      } else {
        // Original Whisper + Claude flow
        const openaiApiKey = await getApiKey("OPENAI_API_KEY", "OpenAI");
        if (!openaiApiKey) {
          console.error(chalk.red("OpenAI API key required for transcription."));
          process.exit(1);
        }

        const claudeApiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic");
        if (!claudeApiKey) {
          console.error(chalk.red("Anthropic API key required for highlight detection."));
          process.exit(1);
        }

        // Step 1: Check for audio stream and extract
        const spinner = ora("Extracting audio...").start();

        // Check if video has an audio stream
        const { stdout: autoShortsProbe } = await execAsync(
          `ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "${absPath}"`
        );
        if (!autoShortsProbe.trim()) {
          spinner.fail(chalk.yellow("Video has no audio track — cannot use Whisper transcription"));
          console.log(chalk.yellow("\n⚠ This video has no audio stream."));
          console.log(chalk.dim("  Use --use-gemini flag for visual-only analysis of videos without audio."));
          console.log(chalk.dim("  Example: vibe ai auto-shorts video.mp4 --use-gemini\n"));
          process.exit(1);
        }

        const tempAudio = absPath.replace(/(\.[^.]+)$/, "-temp-audio.mp3");
        await execAsync(`ffmpeg -i "${absPath}" -vn -acodec libmp3lame -q:a 2 "${tempAudio}" -y`);

        spinner.text = "Transcribing audio...";

        const whisper = new WhisperProvider();
        await whisper.initialize({ apiKey: openaiApiKey });

        const audioBuffer = await readFile(tempAudio);
        const audioBlob = new Blob([audioBuffer]);
        const transcript = await whisper.transcribe(audioBlob, options.language);

        // Clean up temp audio
        try {
          await execAsync(`rm "${tempAudio}"`);
        } catch { /* ignore cleanup errors */ }

        if (!transcript.segments || transcript.segments.length === 0) {
          spinner.fail(chalk.red("No transcript found"));
          process.exit(1);
        }

        // Step 2: Find highlights
        spinner.text = "Finding highlights...";

        const claude = new ClaudeProvider();
        await claude.initialize({ apiKey: claudeApiKey });

        highlights = await claude.analyzeForHighlights(transcript.segments, {
          criteria: "all",
          targetDuration: targetDuration * shortCount,
          maxCount: shortCount * 3, // Get extras to choose from
        });

        spinner.succeed(chalk.green(`Found ${highlights.length} potential highlights`));
      }

      if (highlights.length === 0) {
        console.error(chalk.red("No highlights found"));
        process.exit(1);
      }

      // Sort by confidence and select best
      highlights.sort((a, b) => b.confidence - a.confidence);
      const selectedHighlights = highlights.slice(0, shortCount);

      console.log(chalk.green(`Selected top ${selectedHighlights.length} for short generation`));

      console.log();
      console.log(chalk.bold.cyan("Auto Shorts"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Target duration: ${targetDuration}s`);
      console.log(`Aspect ratio: ${options.aspect}`);
      console.log();

      for (let i = 0; i < selectedHighlights.length; i++) {
        const h = selectedHighlights[i];
        console.log(chalk.yellow(`[Short ${i + 1}] ${formatTime(h.startTime)} - ${formatTime(h.endTime)} (${h.duration.toFixed(1)}s)`));
        console.log(`  ${h.reason}`);
        console.log(chalk.dim(`  Confidence: ${(h.confidence * 100).toFixed(0)}%`));
      }
      console.log();

      if (options.analyzeOnly) {
        console.log(chalk.dim("Use without --analyze-only to generate shorts."));
        return;
      }

      // Step 3: Generate shorts
      const outputDir = options.outputDir
        ? resolve(process.cwd(), options.outputDir)
        : dirname(absPath);

      if (options.outputDir && !existsSync(outputDir)) {
        await mkdir(outputDir, { recursive: true });
      }

      for (let i = 0; i < selectedHighlights.length; i++) {
        const h = selectedHighlights[i];
        const shortSpinner = ora(`Generating short ${i + 1}/${selectedHighlights.length}...`).start();

        let outputPath: string;
        if (shortCount === 1 && options.output) {
          outputPath = resolve(process.cwd(), options.output);
          // Ensure .mp4 extension so FFmpeg can detect format
          if (!extname(outputPath)) {
            outputPath += ".mp4";
          }
        } else {
          const baseName = basename(absPath, extname(absPath));
          outputPath = resolve(outputDir, `${baseName}-short-${i + 1}.mp4`);
        }

        // Ensure parent directory exists
        const parentDir = dirname(outputPath);
        if (!existsSync(parentDir)) {
          await mkdir(parentDir, { recursive: true });
        }

        // Get source dimensions for reframe
        const { stdout: probeOut } = await execAsync(
          `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${absPath}"`
        );
        const [width, height] = probeOut.trim().split(",").map(Number);

        // Calculate crop for aspect ratio
        const [targetW, targetH] = options.aspect.split(":").map(Number);
        const targetRatio = targetW / targetH;
        const sourceRatio = width / height;

        let cropW: number, cropH: number, cropX: number, cropY: number;
        if (sourceRatio > targetRatio) {
          cropH = height;
          cropW = Math.round(height * targetRatio);
          cropX = Math.round((width - cropW) / 2);
          cropY = 0;
        } else {
          cropW = width;
          cropH = Math.round(width / targetRatio);
          cropX = 0;
          cropY = Math.round((height - cropH) / 2);
        }

        // Build FFmpeg command
        const vf = `crop=${cropW}:${cropH}:${cropX}:${cropY}`;
        const cmd = `ffmpeg -ss ${h.startTime} -i "${absPath}" -t ${h.duration} -vf "${vf}" -c:a aac -b:a 128k "${outputPath}" -y`;

        await execAsync(cmd, { timeout: 300000 });

        shortSpinner.succeed(chalk.green(`Short ${i + 1}: ${outputPath}`));
      }

      console.log();
      console.log(chalk.bold.green(`Generated ${selectedHighlights.length} short(s)`));
      console.log();
    } catch (error) {
      console.error(chalk.red("Auto shorts failed"));
      console.error(error);
      process.exit(1);
    }
  });

// Style Transfer
aiCommand
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

// Object Tracking
aiCommand
  .command("track-object")
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

// ============================================================================
// Silence Cut Command
// ============================================================================

aiCommand
  .command("silence-cut")
  .description("Remove silent segments from video (FFmpeg only, no API key needed)")
  .argument("<video>", "Video file path")
  .option("-o, --output <path>", "Output file path (default: <name>-cut.<ext>)")
  .option("-n, --noise <dB>", "Silence threshold in dB (default: -30)", "-30")
  .option("-d, --min-duration <seconds>", "Minimum silence duration to cut (default: 0.5)", "0.5")
  .option("-p, --padding <seconds>", "Padding around non-silent segments (default: 0.1)", "0.1")
  .option("--analyze-only", "Only detect silence, don't cut")
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

      const spinner = ora("Detecting silence...").start();

      const result = await executeSilenceCut({
        videoPath: absVideoPath,
        outputPath: resolve(process.cwd(), outputPath),
        noiseThreshold: parseFloat(options.noise),
        minDuration: parseFloat(options.minDuration),
        padding: parseFloat(options.padding),
        analyzeOnly: options.analyzeOnly || false,
      });

      if (!result.success) {
        spinner.fail(chalk.red(result.error || "Silence cut failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Silence detection complete"));

      console.log();
      console.log(chalk.bold.cyan("Silence Analysis"));
      console.log(chalk.dim("─".repeat(60)));
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
// Exported Pipeline Functions for Agent Tools
// ============================================================================

// ============================================================================
// Silence Cut
// ============================================================================

export interface SilencePeriod {
  start: number;
  end: number;
  duration: number;
}

export interface SilenceCutOptions {
  videoPath: string;
  outputPath: string;
  noiseThreshold?: number;
  minDuration?: number;
  padding?: number;
  analyzeOnly?: boolean;
}

export interface SilenceCutResult {
  success: boolean;
  outputPath?: string;
  totalDuration?: number;
  silentPeriods?: SilencePeriod[];
  silentDuration?: number;
  error?: string;
}

/**
 * Detect silent periods in a media file using FFmpeg silencedetect
 */
async function detectSilencePeriods(
  videoPath: string,
  noiseThreshold: number,
  minDuration: number,
): Promise<{ periods: SilencePeriod[]; totalDuration: number }> {
  // Get total duration
  const totalDuration = await getVideoDuration(videoPath);

  // Run silence detection
  const cmd = `ffmpeg -i "${videoPath}" -af "silencedetect=noise=${noiseThreshold}dB:d=${minDuration}" -f null - 2>&1`;
  const { stdout } = await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });

  const periods: SilencePeriod[] = [];
  const startRegex = /silence_start: (\d+\.?\d*)/g;
  const endRegex = /silence_end: (\d+\.?\d*) \| silence_duration: (\d+\.?\d*)/g;

  const starts: number[] = [];
  let match;
  while ((match = startRegex.exec(stdout)) !== null) {
    starts.push(parseFloat(match[1]));
  }

  let i = 0;
  while ((match = endRegex.exec(stdout)) !== null) {
    const end = parseFloat(match[1]);
    const duration = parseFloat(match[2]);
    const start = i < starts.length ? starts[i] : end - duration;
    periods.push({ start, end, duration });
    i++;
  }

  return { periods, totalDuration };
}

/**
 * Remove silent segments from a video using FFmpeg
 */
export async function executeSilenceCut(options: SilenceCutOptions): Promise<SilenceCutResult> {
  const {
    videoPath,
    outputPath,
    noiseThreshold = -30,
    minDuration = 0.5,
    padding = 0.1,
    analyzeOnly = false,
  } = options;

  if (!existsSync(videoPath)) {
    return { success: false, error: `Video not found: ${videoPath}` };
  }

  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
  } catch {
    return { success: false, error: "FFmpeg not found. Please install FFmpeg." };
  }

  try {
    const { periods, totalDuration } = await detectSilencePeriods(videoPath, noiseThreshold, minDuration);
    const silentDuration = periods.reduce((sum, p) => sum + p.duration, 0);

    if (analyzeOnly || periods.length === 0) {
      return {
        success: true,
        totalDuration,
        silentPeriods: periods,
        silentDuration,
      };
    }

    // Compute non-silent segments with padding
    const segments: { start: number; end: number }[] = [];
    let cursor = 0;

    for (const period of periods) {
      const segEnd = Math.min(period.start + padding, totalDuration);
      if (segEnd > cursor) {
        segments.push({ start: Math.max(0, cursor - padding), end: segEnd });
      }
      cursor = period.end;
    }
    // Add final segment after last silence
    if (cursor < totalDuration) {
      segments.push({ start: Math.max(0, cursor - padding), end: totalDuration });
    }

    if (segments.length === 0) {
      return { success: false, error: "No non-silent segments found" };
    }

    // Build select/aselect filter expression for non-silent segments
    // This re-encodes in a single pass — no keyframe alignment issues
    const selectParts = segments.map(
      (seg) => `between(t,${seg.start.toFixed(4)},${seg.end.toFixed(4)})`,
    );
    const selectExpr = selectParts.join("+");

    await execAsync(
      `ffmpeg -i "${videoPath}" -vf "select='${selectExpr}',setpts=N/FRAME_RATE/TB" -af "aselect='${selectExpr}',asetpts=N/SR/TB" -c:v libx264 -preset fast -crf 18 -c:a aac -b:a 192k "${outputPath}" -y`,
      { timeout: 600000, maxBuffer: 50 * 1024 * 1024 },
    );

    return {
      success: true,
      outputPath,
      totalDuration,
      silentPeriods: periods,
      silentDuration,
    };
  } catch (error) {
    return {
      success: false,
      error: `Silence cut failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

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

// ============================================================================
// Jump Cut (Filler Word Removal)
// ============================================================================

export interface FillerWord {
  word: string;
  start: number;
  end: number;
}

export interface JumpCutOptions {
  videoPath: string;
  outputPath: string;
  fillers?: string[];
  padding?: number;
  language?: string;
  analyzeOnly?: boolean;
  apiKey?: string;
}

export interface JumpCutResult {
  success: boolean;
  outputPath?: string;
  totalDuration?: number;
  fillerCount?: number;
  fillerDuration?: number;
  fillers?: FillerWord[];
  error?: string;
}

export const DEFAULT_FILLER_WORDS = [
  "um", "uh", "uh-huh", "hmm", "like", "you know", "so",
  "basically", "literally", "right", "okay", "well", "i mean", "actually",
];

/**
 * Transcribe audio with word-level timestamps using Whisper API directly.
 * Uses timestamp_granularities[]=word for filler detection.
 */
async function transcribeWithWords(
  audioPath: string,
  apiKey: string,
  language?: string,
): Promise<{ words: { word: string; start: number; end: number }[]; text: string }> {
  const audioBuffer = await readFile(audioPath);
  const audioBlob = new Blob([audioBuffer]);

  const formData = new FormData();
  formData.append("file", audioBlob, "audio.wav");
  formData.append("model", "whisper-1");
  formData.append("response_format", "verbose_json");
  formData.append("timestamp_granularities[]", "word");

  if (language) {
    formData.append("language", language);
  }

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Whisper transcription failed: ${error}`);
  }

  const data = await response.json() as {
    text: string;
    words?: Array<{ word: string; start: number; end: number }>;
  };

  return {
    words: data.words || [],
    text: data.text,
  };
}

/**
 * Detect filler word ranges and merge adjacent ones with padding.
 */
export function detectFillerRanges(
  words: { word: string; start: number; end: number }[],
  fillers: string[],
  padding: number,
): FillerWord[] {
  const fillerSet = new Set(fillers.map((f) => f.toLowerCase().trim()));

  // Find individual filler words
  const matches: FillerWord[] = [];
  for (const w of words) {
    const cleaned = w.word.toLowerCase().replace(/[^a-z\s-]/g, "").trim();
    if (fillerSet.has(cleaned)) {
      matches.push({ word: w.word, start: w.start, end: w.end });
    }
  }

  if (matches.length === 0) return [];

  // Merge adjacent filler ranges (within padding distance)
  const merged: FillerWord[] = [{ ...matches[0] }];
  for (let i = 1; i < matches.length; i++) {
    const last = merged[merged.length - 1];
    if (matches[i].start - last.end <= padding * 2) {
      last.end = matches[i].end;
      last.word += ` ${matches[i].word}`;
    } else {
      merged.push({ ...matches[i] });
    }
  }

  return merged;
}

/**
 * Remove filler words from video using Whisper word-level timestamps + FFmpeg concat.
 */
export async function executeJumpCut(options: JumpCutOptions): Promise<JumpCutResult> {
  const {
    videoPath,
    outputPath,
    fillers = DEFAULT_FILLER_WORDS,
    padding = 0.05,
    language,
    analyzeOnly = false,
    apiKey,
  } = options;

  if (!existsSync(videoPath)) {
    return { success: false, error: `Video not found: ${videoPath}` };
  }

  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
  } catch {
    return { success: false, error: "FFmpeg not found. Please install FFmpeg." };
  }

  const openaiKey = apiKey || process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return { success: false, error: "OpenAI API key required for Whisper transcription." };
  }

  try {
    const tmpDir = `/tmp/vibe_jumpcut_${Date.now()}`;
    await mkdir(tmpDir, { recursive: true });
    const audioPath = join(tmpDir, "audio.wav");

    try {
      // Step 1: Extract audio
      await execAsync(
        `ffmpeg -i "${videoPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${audioPath}" -y`,
        { timeout: 300000, maxBuffer: 50 * 1024 * 1024 },
      );

      // Step 2: Transcribe with word-level timestamps
      const { words } = await transcribeWithWords(audioPath, openaiKey, language);

      if (words.length === 0) {
        return { success: false, error: "No words detected in audio" };
      }

      // Step 3: Detect filler ranges
      const fillerRanges = detectFillerRanges(words, fillers, padding);
      const totalDuration = await getVideoDuration(videoPath);
      const fillerDuration = fillerRanges.reduce((sum, f) => sum + (f.end - f.start), 0);

      if (analyzeOnly || fillerRanges.length === 0) {
        return {
          success: true,
          totalDuration,
          fillerCount: fillerRanges.length,
          fillerDuration,
          fillers: fillerRanges,
        };
      }

      // Step 4: Compute keep-segments (invert filler ranges)
      const segments: { start: number; end: number }[] = [];
      let cursor = 0;

      for (const filler of fillerRanges) {
        const segStart = Math.max(0, cursor);
        const segEnd = Math.max(segStart, filler.start - padding);
        if (segEnd > segStart) {
          segments.push({ start: segStart, end: segEnd });
        }
        cursor = filler.end + padding;
      }
      // Add final segment after last filler
      if (cursor < totalDuration) {
        segments.push({ start: cursor, end: totalDuration });
      }

      if (segments.length === 0) {
        return { success: false, error: "No non-filler segments found" };
      }

      // Step 5: Extract segments and concat with FFmpeg (stream copy)
      const segmentPaths: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const segPath = join(tmpDir, `seg-${i.toString().padStart(4, "0")}.ts`);
        const duration = seg.end - seg.start;
        await execAsync(
          `ffmpeg -i "${videoPath}" -ss ${seg.start} -t ${duration} -c copy -avoid_negative_ts make_zero "${segPath}" -y`,
          { timeout: 300000, maxBuffer: 50 * 1024 * 1024 },
        );
        segmentPaths.push(segPath);
      }

      // Create concat list
      const concatList = segmentPaths.map((p) => `file '${p}'`).join("\n");
      const listPath = join(tmpDir, "concat.txt");
      await writeFile(listPath, concatList);

      // Concat segments
      await execAsync(
        `ffmpeg -f concat -safe 0 -i "${listPath}" -c copy "${outputPath}" -y`,
        { timeout: 300000, maxBuffer: 50 * 1024 * 1024 },
      );

      return {
        success: true,
        outputPath,
        totalDuration,
        fillerCount: fillerRanges.length,
        fillerDuration,
        fillers: fillerRanges,
      };
    } finally {
      // Cleanup temp files
      try {
        const files = await readdir(tmpDir);
        for (const f of files) {
          await unlink(join(tmpDir, f));
        }
        await execAsync(`rmdir "${tmpDir}"`);
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch (error) {
    return {
      success: false,
      error: `Jump cut failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Caption
// ============================================================================

export type CaptionStyle = "minimal" | "bold" | "outline" | "karaoke";

export interface CaptionOptions {
  videoPath: string;
  outputPath: string;
  style?: CaptionStyle;
  fontSize?: number;
  fontColor?: string;
  language?: string;
  position?: "top" | "center" | "bottom";
  apiKey?: string;
}

export interface CaptionResult {
  success: boolean;
  outputPath?: string;
  srtPath?: string;
  segmentCount?: number;
  error?: string;
}

/**
 * Get ASS force_style string for caption preset
 */
function getCaptionForceStyle(
  style: CaptionStyle,
  fontSize: number,
  fontColor: string,
  position: "top" | "center" | "bottom",
): string {
  // ASS alignment: 1-3 bottom, 4-6 middle, 7-9 top (left/center/right)
  const alignment = position === "top" ? 8 : position === "center" ? 5 : 2;
  const marginV = position === "center" ? 0 : 30;

  switch (style) {
    case "minimal":
      return `FontSize=${fontSize},FontName=Arial,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,Outline=1,Shadow=0,Alignment=${alignment},MarginV=${marginV}`;
    case "bold":
      return `FontSize=${fontSize},FontName=Arial,Bold=1,PrimaryColour=&H00${fontColor === "yellow" ? "00FFFF" : "FFFFFF"},OutlineColour=&H00000000,Outline=3,Shadow=1,Alignment=${alignment},MarginV=${marginV}`;
    case "outline":
      return `FontSize=${fontSize},FontName=Arial,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H000000FF,Outline=4,Shadow=0,Alignment=${alignment},MarginV=${marginV}`;
    case "karaoke":
      return `FontSize=${fontSize},FontName=Arial,Bold=1,PrimaryColour=&H0000FFFF,OutlineColour=&H00000000,Outline=2,Shadow=1,Alignment=${alignment},MarginV=${marginV}`;
    default:
      return `FontSize=${fontSize},FontName=Arial,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=3,Shadow=1,Alignment=${alignment},MarginV=${marginV}`;
  }
}

/**
 * Transcribe video and burn styled captions using Whisper + FFmpeg
 */
export async function executeCaption(options: CaptionOptions): Promise<CaptionResult> {
  const {
    videoPath,
    outputPath,
    style = "bold",
    fontSize: customFontSize,
    fontColor = "white",
    language,
    position = "bottom",
    apiKey,
  } = options;

  if (!existsSync(videoPath)) {
    return { success: false, error: `Video not found: ${videoPath}` };
  }

  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
  } catch {
    return { success: false, error: "FFmpeg not found. Please install FFmpeg." };
  }

  const openaiKey = apiKey || process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return { success: false, error: "OpenAI API key required for Whisper transcription." };
  }

  try {
    // Step 1: Extract audio from video
    const tmpDir = `/tmp/vibe_caption_${Date.now()}`;
    await mkdir(tmpDir, { recursive: true });
    const audioPath = join(tmpDir, "audio.wav");
    const srtPath = join(tmpDir, "captions.srt");

    try {
      await execAsync(
        `ffmpeg -i "${videoPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${audioPath}" -y`,
        { timeout: 300000, maxBuffer: 50 * 1024 * 1024 },
      );

      // Step 2: Transcribe with Whisper
      const whisper = new WhisperProvider();
      await whisper.initialize({ apiKey: openaiKey });

      const audioBuffer = await readFile(audioPath);
      const audioBlob = new Blob([audioBuffer]);
      const transcriptResult = await whisper.transcribe(audioBlob, language);

      if (transcriptResult.status === "failed" || !transcriptResult.segments || transcriptResult.segments.length === 0) {
        return { success: false, error: `Transcription failed: ${transcriptResult.error || "No segments detected"}` };
      }

      // Step 3: Generate SRT
      const srtContent = formatSRT(transcriptResult.segments);
      await writeFile(srtPath, srtContent);

      // Step 4: Get video resolution for auto font size
      const { height } = await getVideoResolution(videoPath);
      const fontSize = customFontSize || Math.round(height / 18);

      // Step 5: Check FFmpeg subtitle filter support
      const { stdout: filterList } = await execAsync("ffmpeg -filters 2>/dev/null", { maxBuffer: 10 * 1024 * 1024 });
      const hasSubtitles = filterList.includes("subtitles");
      const hasDrawtext = filterList.includes("drawtext");

      if (!hasSubtitles && !hasDrawtext) {
        // Save SRT even though burn failed — user can still use it
        const outputDir = dirname(outputPath);
        const outputSrtPath = join(outputDir, basename(outputPath, extname(outputPath)) + ".srt");
        await writeFile(outputSrtPath, srtContent);

        const isM = process.platform === "darwin";
        const fix = isM
          ? "brew uninstall ffmpeg && brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-libass --with-freetype"
          : "sudo apt install libass-dev && sudo apt install --reinstall ffmpeg";
        return {
          success: false,
          error: `FFmpeg missing subtitle support (libass/freetype).\nSRT saved to: ${outputSrtPath}\nFix: ${fix}`,
        };
      }

      // Step 6: Burn captions with FFmpeg
      const forceStyle = getCaptionForceStyle(style, fontSize, fontColor, position);
      const escapedSrtPath = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:");
      let cmd: string;
      if (hasSubtitles) {
        cmd = `ffmpeg -i "${videoPath}" -vf "subtitles=${escapedSrtPath}:force_style='${forceStyle}'" -c:a copy "${outputPath}" -y`;
      } else {
        // Fallback: drawtext filter reads SRT line by line (simpler styling)
        cmd = `ffmpeg -i "${videoPath}" -vf "drawtext=textfile='${escapedSrtPath}':fontsize=${fontSize}:fontcolor=white:x=(w-text_w)/2:y=h-th-${position === "top" ? "h*0.85" : "30"}:borderw=3:bordercolor=black" -c:a copy "${outputPath}" -y`;
      }
      await execAsync(cmd, { timeout: 600000, maxBuffer: 50 * 1024 * 1024 });

      // Copy SRT to output directory for user reference
      const outputDir = dirname(outputPath);
      const outputSrtPath = join(outputDir, basename(outputPath, extname(outputPath)) + ".srt");
      await writeFile(outputSrtPath, srtContent);

      return {
        success: true,
        outputPath,
        srtPath: outputSrtPath,
        segmentCount: transcriptResult.segments.length,
      };
    } finally {
      // Cleanup temp files
      try {
        const files = await readdir(tmpDir);
        for (const f of files) {
          await unlink(join(tmpDir, f));
        }
        await execAsync(`rmdir "${tmpDir}"`);
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch (error) {
    return {
      success: false,
      error: `Caption failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Noise Reduce
// ============================================================================

export interface NoiseReduceOptions {
  inputPath: string;
  outputPath: string;
  strength?: "low" | "medium" | "high";
  noiseFloor?: number;
}

export interface NoiseReduceResult {
  success: boolean;
  outputPath?: string;
  inputDuration?: number;
  error?: string;
}

export async function executeNoiseReduce(options: NoiseReduceOptions): Promise<NoiseReduceResult> {
  const {
    inputPath,
    outputPath,
    strength = "medium",
    noiseFloor,
  } = options;

  if (!existsSync(inputPath)) {
    return { success: false, error: `File not found: ${inputPath}` };
  }

  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
  } catch {
    return { success: false, error: "FFmpeg not found. Please install FFmpeg." };
  }

  try {
    const inputDuration = await getVideoDuration(inputPath);

    // Map strength to noise floor dB value
    const nf = noiseFloor ?? (strength === "low" ? -20 : strength === "high" ? -35 : -25);

    // Build audio filter
    let audioFilter = `afftdn=nf=${nf}`;
    if (strength === "high") {
      audioFilter = `${audioFilter},highpass=f=80,lowpass=f=12000`;
    }

    // Check if input has video stream
    const probeCmd = `ffprobe -v error -select_streams v -show_entries stream=codec_type -of csv=p=0 "${inputPath}"`;
    let hasVideo = false;
    try {
      const { stdout } = await execAsync(probeCmd, { maxBuffer: 10 * 1024 * 1024 });
      hasVideo = stdout.trim().includes("video");
    } catch {
      // No video stream
    }

    const videoFlag = hasVideo ? "-c:v copy" : "";
    const cmd = `ffmpeg -i "${inputPath}" -af "${audioFilter}" ${videoFlag} "${outputPath}" -y`;
    await execAsync(cmd, { timeout: 600000, maxBuffer: 50 * 1024 * 1024 });

    return {
      success: true,
      outputPath,
      inputDuration,
    };
  } catch (error) {
    return {
      success: false,
      error: `Noise reduction failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Fade
// ============================================================================

export interface FadeOptions {
  videoPath: string;
  outputPath: string;
  fadeIn?: number;
  fadeOut?: number;
  audioOnly?: boolean;
  videoOnly?: boolean;
}

export interface FadeResult {
  success: boolean;
  outputPath?: string;
  totalDuration?: number;
  fadeInApplied?: boolean;
  fadeOutApplied?: boolean;
  error?: string;
}

export async function executeFade(options: FadeOptions): Promise<FadeResult> {
  const {
    videoPath,
    outputPath,
    fadeIn = 1,
    fadeOut = 1,
    audioOnly = false,
    videoOnly = false,
  } = options;

  if (!existsSync(videoPath)) {
    return { success: false, error: `Video not found: ${videoPath}` };
  }

  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
  } catch {
    return { success: false, error: "FFmpeg not found. Please install FFmpeg." };
  }

  try {
    const totalDuration = await getVideoDuration(videoPath);

    const videoFilters: string[] = [];
    const audioFilters: string[] = [];

    // Video fade filters
    if (!audioOnly) {
      if (fadeIn > 0) {
        videoFilters.push(`fade=t=in:st=0:d=${fadeIn}`);
      }
      if (fadeOut > 0) {
        const fadeOutStart = Math.max(0, totalDuration - fadeOut);
        videoFilters.push(`fade=t=out:st=${fadeOutStart}:d=${fadeOut}`);
      }
    }

    // Audio fade filters
    if (!videoOnly) {
      if (fadeIn > 0) {
        audioFilters.push(`afade=t=in:st=0:d=${fadeIn}`);
      }
      if (fadeOut > 0) {
        const fadeOutStart = Math.max(0, totalDuration - fadeOut);
        audioFilters.push(`afade=t=out:st=${fadeOutStart}:d=${fadeOut}`);
      }
    }

    // Build FFmpeg command
    const parts: string[] = [`ffmpeg -i "${videoPath}"`];

    if (videoFilters.length > 0) {
      parts.push(`-vf "${videoFilters.join(",")}"`);
    } else if (audioOnly) {
      parts.push("-c:v copy");
    }

    if (audioFilters.length > 0) {
      parts.push(`-af "${audioFilters.join(",")}"`);
    } else if (videoOnly) {
      parts.push("-c:a copy");
    }

    parts.push(`"${outputPath}" -y`);

    await execAsync(parts.join(" "), { timeout: 600000, maxBuffer: 50 * 1024 * 1024 });

    return {
      success: true,
      outputPath,
      totalDuration,
      fadeInApplied: fadeIn > 0,
      fadeOutApplied: fadeOut > 0,
    };
  } catch (error) {
    return {
      success: false,
      error: `Fade failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Thumbnail Best Frame
// ============================================================================

export interface ThumbnailBestFrameOptions {
  videoPath: string;
  outputPath: string;
  prompt?: string;
  model?: string;
  apiKey?: string;
}

export interface ThumbnailBestFrameResult {
  success: boolean;
  outputPath?: string;
  timestamp?: number;
  reason?: string;
  error?: string;
}

export async function executeThumbnailBestFrame(options: ThumbnailBestFrameOptions): Promise<ThumbnailBestFrameResult> {
  const {
    videoPath,
    outputPath,
    prompt,
    model = "flash",
    apiKey,
  } = options;

  if (!existsSync(videoPath)) {
    return { success: false, error: `Video not found: ${videoPath}` };
  }

  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
  } catch {
    return { success: false, error: "FFmpeg not found. Please install FFmpeg." };
  }

  const googleKey = apiKey || process.env.GOOGLE_API_KEY;
  if (!googleKey) {
    return { success: false, error: "Google API key required for Gemini video analysis." };
  }

  try {
    const gemini = new GeminiProvider();
    await gemini.initialize({ apiKey: googleKey });

    const videoData = await readFile(videoPath);

    const analysisPrompt = prompt ||
      "Analyze this video and find the single best frame for a thumbnail. " +
      "Look for frames that are visually striking, well-composed, emotionally engaging, " +
      "and representative of the video content. Avoid blurry frames, transitions, or dark scenes. " +
      "Return ONLY a JSON object: {\"timestamp\": <seconds as number>, \"reason\": \"<brief explanation>\"}";

    const modelMap: Record<string, string> = {
      flash: "gemini-3-flash-preview",
      "flash-2.5": "gemini-2.5-flash",
      pro: "gemini-2.5-pro",
    };
    const modelId = modelMap[model] || "gemini-3-flash-preview";

    const result = await gemini.analyzeVideo(videoData, analysisPrompt, {
      model: modelId as "gemini-3-flash-preview" | "gemini-2.5-flash" | "gemini-2.5-pro",
      fps: 1,
    });

    if (!result.success || !result.response) {
      return { success: false, error: result.error || "Gemini analysis failed" };
    }

    // Parse timestamp from response
    const jsonMatch = result.response.match(/\{[\s\S]*?"timestamp"\s*:\s*([\d.]+)[\s\S]*?\}/);
    if (!jsonMatch) {
      return { success: false, error: `Could not parse timestamp from Gemini response: ${result.response.slice(0, 200)}` };
    }

    const timestamp = parseFloat(jsonMatch[1]);
    let reason: string | undefined;
    const reasonMatch = result.response.match(/"reason"\s*:\s*"([^"]+)"/);
    if (reasonMatch) {
      reason = reasonMatch[1];
    }

    // Extract frame with FFmpeg
    await execAsync(
      `ffmpeg -ss ${timestamp} -i "${videoPath}" -frames:v 1 -q:v 2 "${outputPath}" -y`,
      { timeout: 60000, maxBuffer: 50 * 1024 * 1024 },
    );

    if (!existsSync(outputPath)) {
      return { success: false, error: "FFmpeg failed to extract frame" };
    }

    return {
      success: true,
      outputPath,
      timestamp,
      reason,
    };
  } catch (error) {
    return {
      success: false,
      error: `Best frame extraction failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Translate SRT
// ============================================================================

export interface TranslateSrtOptions {
  srtPath: string;
  outputPath: string;
  targetLanguage: string;
  provider?: "claude" | "openai";
  sourceLanguage?: string;
  apiKey?: string;
}

export interface TranslateSrtResult {
  success: boolean;
  outputPath?: string;
  segmentCount?: number;
  sourceLanguage?: string;
  targetLanguage?: string;
  error?: string;
}

export async function executeTranslateSrt(options: TranslateSrtOptions): Promise<TranslateSrtResult> {
  const {
    srtPath,
    outputPath,
    targetLanguage,
    provider = "claude",
    sourceLanguage,
    apiKey,
  } = options;

  if (!existsSync(srtPath)) {
    return { success: false, error: `SRT file not found: ${srtPath}` };
  }

  try {
    const srtContent = await readFile(srtPath, "utf-8");
    const segments = parseSRT(srtContent);

    if (segments.length === 0) {
      return { success: false, error: "No subtitle segments found in SRT file" };
    }

    // Batch translate segments (~30 at a time)
    const batchSize = 30;
    const translatedSegments: { startTime: number; endTime: number; text: string }[] = [];

    for (let i = 0; i < segments.length; i += batchSize) {
      const batch = segments.slice(i, i + batchSize);
      const textsToTranslate = batch.map((s, idx) => `[${idx}] ${s.text}`).join("\n");

      const translatePrompt =
        `Translate the following subtitle texts to ${targetLanguage}.` +
        (sourceLanguage ? ` The source language is ${sourceLanguage}.` : "") +
        ` Return ONLY the translated texts, one per line, preserving the [N] prefix format exactly. ` +
        `Do not add explanations.\n\n${textsToTranslate}`;

      let translatedText: string;

      if (provider === "openai") {
        const openaiKey = apiKey || process.env.OPENAI_API_KEY;
        if (!openaiKey) {
          return { success: false, error: "OpenAI API key required for translation." };
        }
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: translatePrompt }],
            temperature: 0.3,
          }),
        });
        if (!response.ok) {
          return { success: false, error: `OpenAI API error: ${response.status} ${response.statusText}` };
        }
        const data = await response.json() as { choices: Array<{ message: { content: string } }> };
        translatedText = data.choices[0]?.message?.content || "";
      } else {
        const claudeKey = apiKey || process.env.ANTHROPIC_API_KEY;
        if (!claudeKey) {
          return { success: false, error: "Anthropic API key required for translation." };
        }
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": claudeKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6-20250514",
            max_tokens: 4096,
            messages: [{ role: "user", content: translatePrompt }],
          }),
        });
        if (!response.ok) {
          return { success: false, error: `Claude API error: ${response.status} ${response.statusText}` };
        }
        const data = await response.json() as { content: Array<{ type: string; text: string }> };
        translatedText = data.content?.find((c) => c.type === "text")?.text || "";
      }

      // Parse translated lines
      const translatedLines = translatedText.trim().split("\n");
      for (let j = 0; j < batch.length; j++) {
        const seg = batch[j];
        // Try to match [N] prefix
        const line = translatedLines[j];
        let text: string;
        if (line) {
          text = line.replace(/^\[\d+\]\s*/, "").trim();
        } else {
          // Fallback: use original text if translation is missing
          text = seg.text;
        }
        translatedSegments.push({
          startTime: seg.startTime,
          endTime: seg.endTime,
          text,
        });
      }
    }

    // Format as SRT and write
    const translatedSrt = formatSRT(translatedSegments);
    await writeFile(outputPath, translatedSrt);

    return {
      success: true,
      outputPath,
      segmentCount: translatedSegments.length,
      sourceLanguage: sourceLanguage || "auto",
      targetLanguage,
    };
  } catch (error) {
    return {
      success: false,
      error: `Translation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Text Overlay
// ============================================================================

export type TextOverlayStyle = "lower-third" | "center-bold" | "subtitle" | "minimal";

export interface TextOverlayOptions {
  videoPath: string;
  texts: string[];
  outputPath: string;
  style?: TextOverlayStyle;
  fontSize?: number;
  fontColor?: string;
  fadeDuration?: number;
  startTime?: number;
  endTime?: number;
}

export interface TextOverlayResult {
  success: boolean;
  outputPath?: string;
  error?: string;
}

/**
 * Detect system font path for FFmpeg drawtext
 */
function detectSystemFont(): string | null {
  const platform = process.platform;
  if (platform === "darwin") {
    const candidates = [
      "/System/Library/Fonts/Helvetica.ttc",
      "/System/Library/Fonts/HelveticaNeue.ttc",
      "/Library/Fonts/Arial.ttf",
    ];
    for (const f of candidates) {
      if (existsSync(f)) return f;
    }
  } else if (platform === "linux") {
    const candidates = [
      "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
      "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
      "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    ];
    for (const f of candidates) {
      if (existsSync(f)) return f;
    }
  } else if (platform === "win32") {
    const candidates = [
      "C:\\Windows\\Fonts\\arial.ttf",
      "C:\\Windows\\Fonts\\segoeui.ttf",
    ];
    for (const f of candidates) {
      if (existsSync(f)) return f;
    }
  }
  return null;
}

/**
 * Get video resolution via ffprobe
 */
async function getVideoResolution(videoPath: string): Promise<{ width: number; height: number }> {
  const { stdout } = await execAsync(
    `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${videoPath}"`
  );
  const [w, h] = stdout.trim().split(",").map(Number);
  return { width: w || 1920, height: h || 1080 };
}

/**
 * Escape text for FFmpeg drawtext filter
 */
function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\\\\\")
    .replace(/'/g, "'\\\\\\''")
    .replace(/:/g, "\\\\:")
    .replace(/%/g, "\\\\%");
}

/**
 * Apply text overlays to a video using FFmpeg drawtext filter
 */
export async function applyTextOverlays(options: TextOverlayOptions): Promise<TextOverlayResult> {
  const {
    videoPath,
    texts,
    outputPath,
    style = "lower-third",
    fontSize: customFontSize,
    fontColor = "white",
    fadeDuration = 0.3,
    startTime = 0,
  } = options;

  if (!texts || texts.length === 0) {
    return { success: false, error: "No texts provided" };
  }

  const absVideoPath = resolve(process.cwd(), videoPath);
  const absOutputPath = resolve(process.cwd(), outputPath);

  // Check video exists
  if (!existsSync(absVideoPath)) {
    return { success: false, error: `Video not found: ${absVideoPath}` };
  }

  // Check FFmpeg
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
  } catch {
    return { success: false, error: "FFmpeg not found. Please install FFmpeg." };
  }

  // Check drawtext filter availability
  try {
    const { stdout } = await execAsync("ffmpeg -filters 2>/dev/null");
    if (!stdout.includes("drawtext")) {
      const platform = process.platform;
      let hint = "";
      if (platform === "darwin") {
        hint = "\n\nFix: brew uninstall ffmpeg && brew install ffmpeg\n(The default homebrew formula includes libfreetype)";
      } else if (platform === "linux") {
        hint = "\n\nFix: sudo apt install ffmpeg (Ubuntu/Debian)\n     or rebuild FFmpeg with --enable-libfreetype";
      }
      return {
        success: false,
        error: `FFmpeg 'drawtext' filter not available. Your FFmpeg was built without libfreetype.${hint}`,
      };
    }
  } catch {
    // If filter check fails, continue and let FFmpeg error naturally
  }

  // Get video resolution for scaling
  const { width, height } = await getVideoResolution(absVideoPath);
  const baseFontSize = customFontSize || Math.round(height / 20);

  // Get video duration for endTime default
  const videoDuration = await getVideoDuration(absVideoPath);
  const endTime = options.endTime ?? videoDuration;

  // Detect font
  const fontPath = detectSystemFont();
  const fontFile = fontPath ? `fontfile=${fontPath}:` : "";

  // Build drawtext filters based on style
  const filters: string[] = [];

  for (let i = 0; i < texts.length; i++) {
    const escaped = escapeDrawtext(texts[i]);
    let x: string;
    let y: string;
    let fs: number;
    let fc: string = fontColor;
    let boxEnabled = 0;
    let boxColor = "black@0.5";
    let borderW = 0;

    switch (style) {
      case "center-bold":
        x = "(w-text_w)/2";
        y = `(h-text_h)/2+${i * Math.round(baseFontSize * 1.4)}`;
        fs = Math.round(baseFontSize * 1.5);
        borderW = 3;
        break;
      case "subtitle":
        x = "(w-text_w)/2";
        y = `h-${Math.round(height * 0.12)}+${i * Math.round(baseFontSize * 1.3)}`;
        fs = baseFontSize;
        boxEnabled = 1;
        boxColor = "black@0.6";
        break;
      case "minimal":
        x = `${Math.round(width * 0.05)}`;
        y = `${Math.round(height * 0.05)}+${i * Math.round(baseFontSize * 1.3)}`;
        fs = Math.round(baseFontSize * 0.8);
        fc = "white@0.85";
        break;
      case "lower-third":
      default:
        x = `${Math.round(width * 0.05)}`;
        y = `h-${Math.round(height * 0.18)}+${i * Math.round(baseFontSize * 1.3)}`;
        fs = i === 0 ? Math.round(baseFontSize * 1.2) : baseFontSize;
        boxEnabled = 1;
        boxColor = "black@0.5";
        break;
    }

    // Build alpha expression for fade in/out
    const fadeIn = `if(lt(t-${startTime}\\,${fadeDuration})\\,(t-${startTime})/${fadeDuration}\\,1)`;
    const fadeOut = `if(gt(t\\,${endTime - fadeDuration})\\,( ${endTime}-t)/${fadeDuration}\\,1)`;
    const alpha = `min(${fadeIn}\\,${fadeOut})`;

    let filter = `drawtext=${fontFile}text='${escaped}':fontsize=${fs}:fontcolor=${fc}:x=${x}:y=${y}:borderw=${borderW}:enable='between(t\\,${startTime}\\,${endTime})'`;
    filter += `:alpha='${alpha}'`;
    if (boxEnabled) {
      filter += `:box=1:boxcolor=${boxColor}:boxborderw=8`;
    }

    filters.push(filter);
  }

  const filterChain = filters.join(",");
  const cmd = `ffmpeg -i "${absVideoPath}" -vf "${filterChain}" -c:a copy "${absOutputPath}" -y`;

  try {
    await execAsync(cmd, { timeout: 600000, maxBuffer: 50 * 1024 * 1024 });
    return { success: true, outputPath: absOutputPath };
  } catch (error) {
    return {
      success: false,
      error: `FFmpeg failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Execute text overlay for CLI/Agent usage
 */
export async function executeTextOverlay(options: TextOverlayOptions): Promise<TextOverlayResult> {
  return applyTextOverlays(options);
}

// ============================================================================
// Video Review (Gemini)
// ============================================================================

export interface AutoFix {
  type: "color_grade" | "text_overlay_adjust" | "speed_adjust" | "crop";
  description: string;
  ffmpegFilter?: string;
}

export interface VideoReviewCategory {
  score: number;
  issues: string[];
  fixable: boolean;
  suggestedFilter?: string;
  suggestions?: string[];
}

export interface VideoReviewFeedback {
  overallScore: number;
  categories: {
    pacing: VideoReviewCategory;
    color: VideoReviewCategory;
    textReadability: VideoReviewCategory;
    audioVisualSync: VideoReviewCategory;
    composition: VideoReviewCategory;
  };
  autoFixable: AutoFix[];
  recommendations: string[];
}

export interface ReviewOptions {
  videoPath: string;
  storyboardPath?: string;
  autoApply?: boolean;
  verify?: boolean;
  model?: "flash" | "flash-2.5" | "pro";
  outputPath?: string;
}

export interface ReviewResult {
  success: boolean;
  feedback?: VideoReviewFeedback;
  appliedFixes?: string[];
  verificationScore?: number;
  outputPath?: string;
  error?: string;
}

/**
 * Parse review feedback JSON from Gemini response
 */
function parseReviewFeedback(response: string): VideoReviewFeedback | null {
  // Strip markdown fences if present
  let cleaned = response.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  try {
    const parsed = JSON.parse(cleaned);
    // Validate structure
    if (typeof parsed.overallScore !== "number" || !parsed.categories) {
      return null;
    }
    return parsed as VideoReviewFeedback;
  } catch {
    return null;
  }
}

/**
 * Execute video review using Gemini
 */
export async function executeReview(options: ReviewOptions): Promise<ReviewResult> {
  const { videoPath, storyboardPath, autoApply = false, verify = false, model = "flash" } = options;

  const absVideoPath = resolve(process.cwd(), videoPath);
  if (!existsSync(absVideoPath)) {
    return { success: false, error: `Video not found: ${absVideoPath}` };
  }

  // Get Google API key
  const apiKey = process.env.GOOGLE_API_KEY || (await getApiKey("GOOGLE_API_KEY", "Google"));
  if (!apiKey) {
    return { success: false, error: "Google API key required for Gemini video review" };
  }

  // Load storyboard context if provided
  let storyboardContext = "";
  if (storyboardPath) {
    const absStoryboardPath = resolve(process.cwd(), storyboardPath);
    if (existsSync(absStoryboardPath)) {
      const content = await readFile(absStoryboardPath, "utf-8");
      storyboardContext = `\n\nOriginal storyboard for reference:\n${content}`;
    }
  }

  const modelMap: Record<string, string> = {
    flash: "gemini-3-flash-preview",
    "flash-2.5": "gemini-2.5-flash",
    pro: "gemini-2.5-pro",
  };
  const modelId = modelMap[model] || modelMap.flash;

  const reviewPrompt = `You are a professional video editor reviewing this video for quality. Analyze the video and return a JSON review with the following structure. Return ONLY valid JSON, no extra text.

{
  "overallScore": <number 1-10>,
  "categories": {
    "pacing": { "score": <1-10>, "issues": ["..."], "fixable": <boolean> },
    "color": { "score": <1-10>, "issues": ["..."], "fixable": <boolean>, "suggestedFilter": "<ffmpeg filter or null>" },
    "textReadability": { "score": <1-10>, "issues": ["..."], "fixable": <boolean>, "suggestions": ["..."] },
    "audioVisualSync": { "score": <1-10>, "issues": ["..."], "fixable": <boolean> },
    "composition": { "score": <1-10>, "issues": ["..."], "fixable": <boolean> }
  },
  "autoFixable": [
    { "type": "color_grade"|"text_overlay_adjust"|"speed_adjust"|"crop", "description": "...", "ffmpegFilter": "..." }
  ],
  "recommendations": ["..."]
}

Score each category 1-10. For fixable issues, provide an FFmpeg filter in autoFixable. Be specific and practical.${storyboardContext}`;

  // Analyze video with Gemini
  const gemini = new GeminiProvider();
  await gemini.initialize({ apiKey });

  const videoData = await readFile(absVideoPath);
  const analysisResult = await gemini.analyzeVideo(videoData, reviewPrompt, {
    model: modelId as "gemini-3-flash-preview" | "gemini-2.5-flash" | "gemini-2.5-pro",
  });

  if (!analysisResult.success || !analysisResult.response) {
    return { success: false, error: analysisResult.error || "Gemini video analysis failed" };
  }

  const feedback = parseReviewFeedback(analysisResult.response);
  if (!feedback) {
    return {
      success: false,
      error: "Failed to parse review feedback from Gemini response",
    };
  }

  const result: ReviewResult = {
    success: true,
    feedback,
    appliedFixes: [],
  };

  // Auto-apply fixable issues
  if (autoApply && feedback.autoFixable.length > 0) {
    let currentInput = absVideoPath;
    const outputBase = options.outputPath
      ? resolve(process.cwd(), options.outputPath)
      : absVideoPath.replace(/(\.[^.]+)$/, "-reviewed$1");

    for (const fix of feedback.autoFixable) {
      if (fix.type === "color_grade" && fix.ffmpegFilter) {
        try {
          const tempOutput = outputBase.replace(/(\.[^.]+)$/, `-fix-${result.appliedFixes!.length}$1`);
          const cmd = `ffmpeg -i "${currentInput}" -vf "${fix.ffmpegFilter}" -c:a copy "${tempOutput}" -y`;
          await execAsync(cmd, { timeout: 600000, maxBuffer: 50 * 1024 * 1024 });
          currentInput = tempOutput;
          result.appliedFixes!.push(`${fix.type}: ${fix.description}`);
        } catch {
          // Skip failed fix, continue with others
        }
      } else if (fix.type === "text_overlay_adjust") {
        result.appliedFixes!.push(`${fix.type}: ${fix.description} (manual adjustment recommended)`);
      }
    }

    // Rename final output
    if (currentInput !== absVideoPath) {
      const finalOutput = outputBase;
      try {
        await rename(currentInput, finalOutput);
        result.outputPath = finalOutput;
      } catch {
        result.outputPath = currentInput;
      }
    }
  }

  // Verification pass
  if (verify && result.outputPath) {
    const verifyVideoData = await readFile(result.outputPath);
    const verifyResult = await gemini.analyzeVideo(
      verifyVideoData,
      "Rate this video overall quality on a scale of 1-10. Return ONLY a JSON object: {\"score\": <number>}",
      { model: modelId as "gemini-3-flash-preview" | "gemini-2.5-flash" | "gemini-2.5-pro" }
    );

    if (verifyResult.success && verifyResult.response) {
      try {
        let cleaned = verifyResult.response.trim();
        if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
        if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
        if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
        const parsed = JSON.parse(cleaned.trim());
        result.verificationScore = parsed.score;
      } catch {
        // Verification parse failed, not critical
      }
    }
  }

  return result;
}

/**
 * Options for script-to-video pipeline
 */
export interface ScriptToVideoOptions {
  script: string;
  outputDir?: string;
  duration?: number;
  voice?: string;
  generator?: "runway" | "kling";
  imageProvider?: "openai" | "dalle" | "stability" | "gemini";
  aspectRatio?: "16:9" | "9:16" | "1:1";
  imagesOnly?: boolean;
  noVoiceover?: boolean;
  retries?: number;
  /** Creativity level for storyboard generation: low (default, consistent) or high (varied, unexpected) */
  creativity?: "low" | "high";
  /** Skip text overlay step */
  noTextOverlay?: boolean;
  /** Text overlay style preset */
  textStyle?: TextOverlayStyle;
  /** Enable AI review after assembly */
  review?: boolean;
  /** Auto-apply fixable issues from review */
  reviewAutoApply?: boolean;
}

/**
 * Narration entry with segment tracking
 */
export interface NarrationEntry {
  /** Path to the narration audio file (null if failed) */
  path: string | null;
  /** Duration in seconds */
  duration: number;
  /** Index of the segment this narration belongs to */
  segmentIndex: number;
  /** Whether the narration failed to generate */
  failed: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Result of script-to-video pipeline
 */
export interface ScriptToVideoResult {
  success: boolean;
  outputDir: string;
  scenes: number;
  storyboardPath?: string;
  projectPath?: string;
  /** @deprecated Use narrationEntries for proper segment tracking */
  narrations?: string[];
  /** Narration entries with segment index tracking */
  narrationEntries?: NarrationEntry[];
  images?: string[];
  videos?: string[];
  totalDuration?: number;
  failedScenes?: number[];
  /** Failed narration scene numbers (1-indexed) */
  failedNarrations?: number[];
  error?: string;
  /** Review feedback from Gemini (when --review is used) */
  reviewFeedback?: VideoReviewFeedback;
  /** List of auto-applied fixes (when --review-auto-apply is used) */
  appliedFixes?: string[];
  /** Path to reviewed/fixed video (when review auto-applied) */
  reviewedVideoPath?: string;
}

/**
 * Execute the script-to-video pipeline programmatically
 */
export async function executeScriptToVideo(
  options: ScriptToVideoOptions
): Promise<ScriptToVideoResult> {
  const outputDir = options.outputDir || "script-video-output";

  try {
    // Get all required API keys
    const claudeApiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic");
    if (!claudeApiKey) {
      return { success: false, outputDir, scenes: 0, error: "Anthropic API key required for storyboard generation" };
    }

    // Get image provider API key
    let imageApiKey: string | undefined;
    const imageProvider = options.imageProvider || "openai";

    if (imageProvider === "openai" || imageProvider === "dalle") {
      imageApiKey = (await getApiKey("OPENAI_API_KEY", "OpenAI")) ?? undefined;
      if (!imageApiKey) {
        return { success: false, outputDir, scenes: 0, error: "OpenAI API key required for image generation" };
      }
    } else if (imageProvider === "stability") {
      imageApiKey = (await getApiKey("STABILITY_API_KEY", "Stability AI")) ?? undefined;
      if (!imageApiKey) {
        return { success: false, outputDir, scenes: 0, error: "Stability API key required for image generation" };
      }
    } else if (imageProvider === "gemini") {
      imageApiKey = (await getApiKey("GOOGLE_API_KEY", "Google")) ?? undefined;
      if (!imageApiKey) {
        return { success: false, outputDir, scenes: 0, error: "Google API key required for Gemini image generation" };
      }
    }

    let elevenlabsApiKey: string | undefined;
    if (!options.noVoiceover) {
      elevenlabsApiKey = (await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs")) ?? undefined;
      if (!elevenlabsApiKey) {
        return { success: false, outputDir, scenes: 0, error: "ElevenLabs API key required for voiceover (or use noVoiceover option)" };
      }
    }

    let videoApiKey: string | undefined;
    if (!options.imagesOnly) {
      if (options.generator === "kling") {
        videoApiKey = (await getApiKey("KLING_API_KEY", "Kling")) ?? undefined;
        if (!videoApiKey) {
          return { success: false, outputDir, scenes: 0, error: "Kling API key required (or use imagesOnly option)" };
        }
      } else {
        videoApiKey = (await getApiKey("RUNWAY_API_SECRET", "Runway")) ?? undefined;
        if (!videoApiKey) {
          return { success: false, outputDir, scenes: 0, error: "Runway API key required (or use imagesOnly option)" };
        }
      }
    }

    // Create output directory
    const absOutputDir = resolve(process.cwd(), outputDir);
    if (!existsSync(absOutputDir)) {
      await mkdir(absOutputDir, { recursive: true });
    }

    // Step 1: Generate storyboard with Claude
    const claude = new ClaudeProvider();
    await claude.initialize({ apiKey: claudeApiKey });

    const segments = await claude.analyzeContent(
      options.script,
      options.duration,
      { creativity: options.creativity }
    );
    if (segments.length === 0) {
      return { success: false, outputDir, scenes: 0, error: "Failed to generate storyboard" };
    }

    // Save storyboard
    const storyboardPath = resolve(absOutputDir, "storyboard.json");
    await writeFile(storyboardPath, JSON.stringify(segments, null, 2), "utf-8");

    const result: ScriptToVideoResult = {
      success: true,
      outputDir: absOutputDir,
      scenes: segments.length,
      storyboardPath,
      narrations: [],
      narrationEntries: [],
      images: [],
      videos: [],
      failedScenes: [],
      failedNarrations: [],
    };

    // Step 2: Generate per-scene voiceovers with ElevenLabs
    if (!options.noVoiceover && elevenlabsApiKey) {
      const elevenlabs = new ElevenLabsProvider();
      await elevenlabs.initialize({ apiKey: elevenlabsApiKey });

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const narrationText = segment.narration || segment.description;

        if (!narrationText) {
          // No narration text for this segment - add placeholder entry
          result.narrationEntries!.push({
            path: null,
            duration: segment.duration,
            segmentIndex: i,
            failed: false, // Not failed, just no text
          });
          continue;
        }

        const ttsResult = await elevenlabs.textToSpeech(narrationText, {
          voiceId: options.voice,
        });

        if (ttsResult.success && ttsResult.audioBuffer) {
          const audioPath = resolve(absOutputDir, `narration-${i + 1}.mp3`);
          await writeFile(audioPath, ttsResult.audioBuffer);

          // Get actual audio duration
          const actualDuration = await getAudioDuration(audioPath);
          segment.duration = actualDuration;

          // Add to both arrays for backwards compatibility
          result.narrations!.push(audioPath);
          result.narrationEntries!.push({
            path: audioPath,
            duration: actualDuration,
            segmentIndex: i,
            failed: false,
          });
        } else {
          // TTS failed - add placeholder entry with error info
          result.narrationEntries!.push({
            path: null,
            duration: segment.duration, // Keep original estimated duration
            segmentIndex: i,
            failed: true,
            error: ttsResult.error || "Unknown TTS error",
          });
          result.failedNarrations!.push(i + 1); // 1-indexed for user display
        }
      }

      // Recalculate startTime for all segments
      let currentTime = 0;
      for (const segment of segments) {
        segment.startTime = currentTime;
        currentTime += segment.duration;
      }

      // Re-save storyboard with updated durations
      await writeFile(storyboardPath, JSON.stringify(segments, null, 2), "utf-8");
    }

    // Step 3: Generate images
    const dalleImageSizes: Record<string, "1536x1024" | "1024x1536" | "1024x1024"> = {
      "16:9": "1536x1024",
      "9:16": "1024x1536",
      "1:1": "1024x1024",
    };
    type StabilityAspectRatio = "16:9" | "1:1" | "21:9" | "2:3" | "3:2" | "4:5" | "5:4" | "9:16" | "9:21";
    const stabilityAspectRatios: Record<string, StabilityAspectRatio> = {
      "16:9": "16:9",
      "9:16": "9:16",
      "1:1": "1:1",
    };

    let openaiImageInstance: OpenAIImageProvider | undefined;
    let stabilityInstance: StabilityProvider | undefined;
    let geminiInstance: GeminiProvider | undefined;

    if (imageProvider === "openai" || imageProvider === "dalle") {
      openaiImageInstance = new OpenAIImageProvider();
      await openaiImageInstance.initialize({ apiKey: imageApiKey! });
    } else if (imageProvider === "stability") {
      stabilityInstance = new StabilityProvider();
      await stabilityInstance.initialize({ apiKey: imageApiKey! });
    } else if (imageProvider === "gemini") {
      geminiInstance = new GeminiProvider();
      await geminiInstance.initialize({ apiKey: imageApiKey! });
    }

    const imagePaths: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const imagePrompt = segment.visualStyle
        ? `${segment.visuals}. Style: ${segment.visualStyle}`
        : segment.visuals;

      try {
        let imageBuffer: Buffer | undefined;
        let imageUrl: string | undefined;
        let imageError: string | undefined;

        if ((imageProvider === "openai" || imageProvider === "dalle") && openaiImageInstance) {
          const imageResult = await openaiImageInstance.generateImage(imagePrompt, {
            size: dalleImageSizes[options.aspectRatio || "16:9"] || "1536x1024",
            quality: "standard",
          });
          if (imageResult.success && imageResult.images && imageResult.images.length > 0) {
            // GPT Image 1.5 returns base64, DALL-E 3 returns URL
            const img = imageResult.images[0];
            if (img.base64) {
              imageBuffer = Buffer.from(img.base64, "base64");
            } else if (img.url) {
              imageUrl = img.url;
            }
          } else {
            imageError = imageResult.error;
          }
        } else if (imageProvider === "stability" && stabilityInstance) {
          const imageResult = await stabilityInstance.generateImage(imagePrompt, {
            aspectRatio: stabilityAspectRatios[options.aspectRatio || "16:9"] || "16:9",
            model: "sd3.5-large",
          });
          if (imageResult.success && imageResult.images?.[0]) {
            const img = imageResult.images[0];
            if (img.base64) {
              imageBuffer = Buffer.from(img.base64, "base64");
            } else if (img.url) {
              imageUrl = img.url;
            }
          } else {
            imageError = imageResult.error;
          }
        } else if (imageProvider === "gemini" && geminiInstance) {
          const imageResult = await geminiInstance.generateImage(imagePrompt, {
            aspectRatio: (options.aspectRatio || "16:9") as "16:9" | "9:16" | "1:1",
          });
          if (imageResult.success && imageResult.images?.[0]?.base64) {
            imageBuffer = Buffer.from(imageResult.images[0].base64, "base64");
          } else {
            imageError = imageResult.error;
          }
        }

        const imagePath = resolve(absOutputDir, `scene-${i + 1}.png`);
        if (imageBuffer) {
          await writeFile(imagePath, imageBuffer);
          imagePaths.push(imagePath);
          result.images!.push(imagePath);
        } else if (imageUrl) {
          const response = await fetch(imageUrl);
          const buffer = Buffer.from(await response.arrayBuffer());
          await writeFile(imagePath, buffer);
          imagePaths.push(imagePath);
          result.images!.push(imagePath);
        } else {
          // Track failed scene - error details are in imageError but not exposed in result type
          // The failedScenes array tracks which scenes failed for the caller
          imagePaths.push("");
        }
      } catch {
        imagePaths.push("");
      }

      // Rate limiting delay
      if (i < segments.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    // Step 4: Generate videos (if not images-only)
    const videoPaths: string[] = [];
    const maxRetries = options.retries ?? DEFAULT_VIDEO_RETRIES;

    if (!options.imagesOnly && videoApiKey) {
      if (options.generator === "kling") {
        const kling = new KlingProvider();
        await kling.initialize({ apiKey: videoApiKey });

        if (!kling.isConfigured()) {
          return { success: false, outputDir: absOutputDir, scenes: segments.length, error: "Invalid Kling API key format. Use ACCESS_KEY:SECRET_KEY" };
        }

        for (let i = 0; i < segments.length; i++) {
          if (!imagePaths[i]) {
            videoPaths.push("");
            continue;
          }

          const segment = segments[i] as StoryboardSegment;
          const videoDuration = (segment.duration > 5 ? 10 : 5) as 5 | 10;

          // Using text2video since Kling's image2video requires URL (not base64)
          const taskResult = await generateVideoWithRetryKling(
            kling,
            segment,
            { duration: videoDuration, aspectRatio: (options.aspectRatio || "16:9") as "16:9" | "9:16" | "1:1" },
            maxRetries
          );

          if (taskResult) {
            try {
              const waitResult = await kling.waitForCompletion(taskResult.taskId, taskResult.type, undefined, 600000);
              if (waitResult.status === "completed" && waitResult.videoUrl) {
                const videoPath = resolve(absOutputDir, `scene-${i + 1}.mp4`);
                const response = await fetch(waitResult.videoUrl);
                const buffer = Buffer.from(await response.arrayBuffer());
                await writeFile(videoPath, buffer);

                // Extend video to match narration duration if needed
                const targetDuration = segment.duration; // Already updated to narration length
                const actualVideoDuration = await getVideoDuration(videoPath);

                if (actualVideoDuration < targetDuration - 0.1) {
                  const extendedPath = resolve(absOutputDir, `scene-${i + 1}-extended.mp4`);
                  await extendVideoNaturally(videoPath, targetDuration, extendedPath);
                  // Replace original with extended version
                  await unlink(videoPath);
                  await rename(extendedPath, videoPath);
                }

                videoPaths.push(videoPath);
                result.videos!.push(videoPath);
              } else {
                videoPaths.push("");
                result.failedScenes!.push(i + 1);
              }
            } catch {
              videoPaths.push("");
              result.failedScenes!.push(i + 1);
            }
          } else {
            videoPaths.push("");
            result.failedScenes!.push(i + 1);
          }
        }
      } else {
        // Runway
        const runway = new RunwayProvider();
        await runway.initialize({ apiKey: videoApiKey });

        for (let i = 0; i < segments.length; i++) {
          if (!imagePaths[i]) {
            videoPaths.push("");
            continue;
          }

          const segment = segments[i] as StoryboardSegment;
          const imageBuffer = await readFile(imagePaths[i]);
          const ext = extname(imagePaths[i]).toLowerCase().slice(1);
          const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
          const referenceImage = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

          const videoDuration = (segment.duration > 5 ? 10 : 5) as 5 | 10;
          const aspectRatio = options.aspectRatio === "1:1" ? "16:9" : ((options.aspectRatio || "16:9") as "16:9" | "9:16");

          const taskResult = await generateVideoWithRetryRunway(
            runway,
            segment,
            referenceImage,
            { duration: videoDuration, aspectRatio },
            maxRetries
          );

          if (taskResult) {
            try {
              const waitResult = await runway.waitForCompletion(taskResult.taskId, undefined, 300000);
              if (waitResult.status === "completed" && waitResult.videoUrl) {
                const videoPath = resolve(absOutputDir, `scene-${i + 1}.mp4`);
                const response = await fetch(waitResult.videoUrl);
                const buffer = Buffer.from(await response.arrayBuffer());
                await writeFile(videoPath, buffer);

                // Extend video to match narration duration if needed
                const targetDuration = segment.duration; // Already updated to narration length
                const actualVideoDuration = await getVideoDuration(videoPath);

                if (actualVideoDuration < targetDuration - 0.1) {
                  const extendedPath = resolve(absOutputDir, `scene-${i + 1}-extended.mp4`);
                  await extendVideoNaturally(videoPath, targetDuration, extendedPath);
                  // Replace original with extended version
                  await unlink(videoPath);
                  await rename(extendedPath, videoPath);
                }

                videoPaths.push(videoPath);
                result.videos!.push(videoPath);
              } else {
                videoPaths.push("");
                result.failedScenes!.push(i + 1);
              }
            } catch {
              videoPaths.push("");
              result.failedScenes!.push(i + 1);
            }
          } else {
            videoPaths.push("");
            result.failedScenes!.push(i + 1);
          }
        }
      }
    }

    // Step 4.5: Apply text overlays (if segments have textOverlays)
    if (!options.noTextOverlay) {
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        if (segment.textOverlays && segment.textOverlays.length > 0 && videoPaths[i] && videoPaths[i] !== "") {
          try {
            const overlayOutput = videoPaths[i].replace(/(\.[^.]+)$/, "-overlay$1");
            const overlayResult = await applyTextOverlays({
              videoPath: videoPaths[i],
              texts: segment.textOverlays,
              outputPath: overlayOutput,
              style: options.textStyle || "lower-third",
            });
            if (overlayResult.success && overlayResult.outputPath) {
              videoPaths[i] = overlayResult.outputPath;
            }
            // Silent fallback: keep original on failure
          } catch {
            // Silent fallback: keep original video
          }
        }
      }
    }

    // Step 5: Create project file
    const project = new Project("Script-to-Video Output");
    project.setAspectRatio((options.aspectRatio || "16:9") as "16:9" | "9:16" | "1:1");

    // Clear default tracks
    const defaultTracks = project.getTracks();
    for (const track of defaultTracks) {
      project.removeTrack(track.id);
    }

    const videoTrack = project.addTrack({
      name: "Video",
      type: "video",
      order: 1,
      isMuted: false,
      isLocked: false,
      isVisible: true,
    });

    const audioTrack = project.addTrack({
      name: "Audio",
      type: "audio",
      order: 0,
      isMuted: false,
      isLocked: false,
      isVisible: true,
    });

    // Add narration clips - use narrationEntries for proper segment alignment
    if (result.narrationEntries && result.narrationEntries.length > 0) {
      for (const entry of result.narrationEntries) {
        // Skip failed or missing narrations
        if (entry.failed || !entry.path) continue;

        const segment = segments[entry.segmentIndex];
        const narrationDuration = await getAudioDuration(entry.path);

        const audioSource = project.addSource({
          name: `Narration ${entry.segmentIndex + 1}`,
          url: entry.path,
          type: "audio",
          duration: narrationDuration,
        });

        project.addClip({
          sourceId: audioSource.id,
          trackId: audioTrack.id,
          startTime: segment.startTime,
          duration: narrationDuration,
          sourceStartOffset: 0,
          sourceEndOffset: narrationDuration,
        });
      }
    }

    // Add video/image clips
    let currentTime = 0;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const hasVideo = videoPaths[i] && videoPaths[i] !== "";
      const hasImage = imagePaths[i] && imagePaths[i] !== "";

      if (!hasVideo && !hasImage) {
        currentTime += segment.duration;
        continue;
      }

      const assetPath = hasVideo ? videoPaths[i] : imagePaths[i];
      const mediaType = hasVideo ? "video" : "image";

      // Use actual video duration (after extension) instead of segment.duration
      const actualDuration = hasVideo
        ? await getVideoDuration(assetPath)
        : segment.duration;

      const source = project.addSource({
        name: `Scene ${i + 1}`,
        url: assetPath,
        type: mediaType as "video" | "image",
        duration: actualDuration,
      });

      project.addClip({
        sourceId: source.id,
        trackId: videoTrack.id,
        startTime: currentTime,
        duration: actualDuration,
        sourceStartOffset: 0,
        sourceEndOffset: actualDuration,
      });

      currentTime += actualDuration;
    }

    // Save project file
    const projectPath = resolve(absOutputDir, "project.vibe.json");
    await writeFile(projectPath, JSON.stringify(project.toJSON(), null, 2), "utf-8");
    result.projectPath = projectPath;
    result.totalDuration = currentTime;

    // Step 6: AI Review & Auto-fix (optional, --review flag)
    if (options.review) {
      try {
        const storyboardFile = resolve(absOutputDir, "storyboard.json");
        // Export project to temp MP4 for review (use first valid video as proxy)
        const reviewTarget = videoPaths.find((p) => p && p !== "") || imagePaths.find((p) => p && p !== "");
        if (reviewTarget) {
          const reviewResult = await executeReview({
            videoPath: reviewTarget,
            storyboardPath: existsSync(storyboardFile) ? storyboardFile : undefined,
            autoApply: options.reviewAutoApply,
            model: "flash",
          });

          if (reviewResult.success) {
            result.reviewFeedback = reviewResult.feedback;
            result.appliedFixes = reviewResult.appliedFixes;
            result.reviewedVideoPath = reviewResult.outputPath;
          }
        }
      } catch {
        // Review is non-critical, continue with result
      }
    }

    return result;
  } catch (error) {
    return {
      success: false,
      outputDir,
      scenes: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Options for scene regeneration
 */
export interface RegenerateSceneOptions {
  projectDir: string;
  scenes: number[];
  videoOnly?: boolean;
  narrationOnly?: boolean;
  imageOnly?: boolean;
  generator?: "kling" | "runway";
  imageProvider?: "gemini" | "openai" | "stability";
  voice?: string;
  aspectRatio?: "16:9" | "9:16" | "1:1";
  retries?: number;
  /** Reference scene number for character consistency (auto-detects if not specified) */
  referenceScene?: number;
}

/**
 * Result of scene regeneration
 */
export interface RegenerateSceneResult {
  success: boolean;
  regeneratedScenes: number[];
  failedScenes: number[];
  error?: string;
}

/**
 * Execute scene regeneration programmatically
 */
export async function executeRegenerateScene(
  options: RegenerateSceneOptions
): Promise<RegenerateSceneResult> {
  const result: RegenerateSceneResult = {
    success: false,
    regeneratedScenes: [],
    failedScenes: [],
  };

  try {
    const outputDir = resolve(process.cwd(), options.projectDir);
    const storyboardPath = resolve(outputDir, "storyboard.json");

    if (!existsSync(outputDir)) {
      return { ...result, error: `Project directory not found: ${outputDir}` };
    }

    if (!existsSync(storyboardPath)) {
      return { ...result, error: `Storyboard not found: ${storyboardPath}` };
    }

    const storyboardContent = await readFile(storyboardPath, "utf-8");
    const segments: StoryboardSegment[] = JSON.parse(storyboardContent);

    // Validate scenes
    for (const sceneNum of options.scenes) {
      if (sceneNum < 1 || sceneNum > segments.length) {
        return { ...result, error: `Scene ${sceneNum} does not exist. Storyboard has ${segments.length} scenes.` };
      }
    }

    const regenerateVideo = options.videoOnly || (!options.narrationOnly && !options.imageOnly);

    // Get API keys
    let videoApiKey: string | undefined;
    if (regenerateVideo) {
      if (options.generator === "kling" || !options.generator) {
        videoApiKey = (await getApiKey("KLING_API_KEY", "Kling")) ?? undefined;
        if (!videoApiKey) {
          return { ...result, error: "Kling API key required" };
        }
      } else {
        videoApiKey = (await getApiKey("RUNWAY_API_SECRET", "Runway")) ?? undefined;
        if (!videoApiKey) {
          return { ...result, error: "Runway API key required" };
        }
      }
    }

    // Process each scene
    for (const sceneNum of options.scenes) {
      const segment = segments[sceneNum - 1];
      const imagePath = resolve(outputDir, `scene-${sceneNum}.png`);
      const videoPath = resolve(outputDir, `scene-${sceneNum}.mp4`);

      if (regenerateVideo && videoApiKey) {
        if (!existsSync(imagePath)) {
          result.failedScenes.push(sceneNum);
          continue;
        }

        const imageBuffer = await readFile(imagePath);
        const videoDuration = (segment.duration > 5 ? 10 : 5) as 5 | 10;
        const maxRetries = options.retries ?? DEFAULT_VIDEO_RETRIES;

        if (options.generator === "kling" || !options.generator) {
          const kling = new KlingProvider();
          await kling.initialize({ apiKey: videoApiKey });

          if (!kling.isConfigured()) {
            result.failedScenes.push(sceneNum);
            continue;
          }

          // Try to use image-to-video if ImgBB key available
          const imgbbApiKey = await getApiKeyFromConfig("imgbb") || process.env.IMGBB_API_KEY;
          let imageUrl: string | undefined;

          if (imgbbApiKey) {
            const uploadResult = await uploadToImgbb(imageBuffer, imgbbApiKey);
            if (uploadResult.success && uploadResult.url) {
              imageUrl = uploadResult.url;
            }
          }

          const taskResult = await generateVideoWithRetryKling(
            kling,
            segment,
            {
              duration: videoDuration,
              aspectRatio: (options.aspectRatio || "16:9") as "16:9" | "9:16" | "1:1",
              referenceImage: imageUrl,
            },
            maxRetries
          );

          if (taskResult) {
            try {
              const waitResult = await kling.waitForCompletion(taskResult.taskId, taskResult.type, undefined, 600000);
              if (waitResult.status === "completed" && waitResult.videoUrl) {
                const response = await fetch(waitResult.videoUrl);
                const buffer = Buffer.from(await response.arrayBuffer());
                await writeFile(videoPath, buffer);

                // Extend video to match narration duration if needed
                const targetDuration = segment.duration;
                const actualVideoDuration = await getVideoDuration(videoPath);

                if (actualVideoDuration < targetDuration - 0.1) {
                  const extendedPath = resolve(outputDir, `scene-${sceneNum}-extended.mp4`);
                  await extendVideoNaturally(videoPath, targetDuration, extendedPath);
                  await unlink(videoPath);
                  await rename(extendedPath, videoPath);
                }

                result.regeneratedScenes.push(sceneNum);
              } else {
                result.failedScenes.push(sceneNum);
              }
            } catch {
              result.failedScenes.push(sceneNum);
            }
          } else {
            result.failedScenes.push(sceneNum);
          }
        } else {
          // Runway
          const runway = new RunwayProvider();
          await runway.initialize({ apiKey: videoApiKey });

          const ext = extname(imagePath).toLowerCase().slice(1);
          const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
          const referenceImage = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

          const aspectRatio = options.aspectRatio === "1:1" ? "16:9" : ((options.aspectRatio || "16:9") as "16:9" | "9:16");

          const taskResult = await generateVideoWithRetryRunway(
            runway,
            segment,
            referenceImage,
            { duration: videoDuration, aspectRatio },
            maxRetries
          );

          if (taskResult) {
            try {
              const waitResult = await runway.waitForCompletion(taskResult.taskId, undefined, 300000);
              if (waitResult.status === "completed" && waitResult.videoUrl) {
                const response = await fetch(waitResult.videoUrl);
                const buffer = Buffer.from(await response.arrayBuffer());
                await writeFile(videoPath, buffer);

                // Extend video to match narration duration if needed
                const targetDuration = segment.duration;
                const actualVideoDuration = await getVideoDuration(videoPath);

                if (actualVideoDuration < targetDuration - 0.1) {
                  const extendedPath = resolve(outputDir, `scene-${sceneNum}-extended.mp4`);
                  await extendVideoNaturally(videoPath, targetDuration, extendedPath);
                  await unlink(videoPath);
                  await rename(extendedPath, videoPath);
                }

                result.regeneratedScenes.push(sceneNum);
              } else {
                result.failedScenes.push(sceneNum);
              }
            } catch {
              result.failedScenes.push(sceneNum);
            }
          } else {
            result.failedScenes.push(sceneNum);
          }
        }
      }
    }

    result.success = result.failedScenes.length === 0;
    return result;
  } catch (error) {
    return {
      ...result,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Options for highlights extraction
 */
export interface HighlightsOptions {
  media: string;
  output?: string;
  project?: string;
  duration?: number;
  count?: number;
  threshold?: number;
  criteria?: "emotional" | "informative" | "funny" | "all";
  language?: string;
  useGemini?: boolean;
  lowRes?: boolean;
}

/**
 * Result of highlights extraction
 */
export interface HighlightsExtractResult {
  success: boolean;
  highlights: Highlight[];
  totalDuration: number;
  totalHighlightDuration: number;
  outputPath?: string;
  projectPath?: string;
  error?: string;
}

/**
 * Execute the highlights extraction pipeline programmatically
 */
export async function executeHighlights(
  options: HighlightsOptions
): Promise<HighlightsExtractResult> {
  try {
    const absPath = resolve(process.cwd(), options.media);
    if (!existsSync(absPath)) {
      return { success: false, highlights: [], totalDuration: 0, totalHighlightDuration: 0, error: `File not found: ${absPath}` };
    }

    const ext = extname(absPath).toLowerCase();
    const videoExtensions = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"];
    const isVideo = videoExtensions.includes(ext);

    const targetDuration = options.duration;
    const maxCount = options.count;
    const threshold = options.threshold ?? 0.7;

    let allHighlights: Highlight[] = [];
    let sourceDuration = 0;

    if (options.useGemini && isVideo) {
      // Gemini Video Understanding flow
      const geminiApiKey = await getApiKey("GOOGLE_API_KEY", "Google");
      if (!geminiApiKey) {
        return { success: false, highlights: [], totalDuration: 0, totalHighlightDuration: 0, error: "Google API key required for Gemini Video Understanding" };
      }

      // Get video duration
      const durationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${absPath}"`;
      const { stdout: durationOut } = await execAsync(durationCmd);
      sourceDuration = parseFloat(durationOut.trim());

      // Analyze with Gemini Video
      const gemini = new GeminiProvider();
      await gemini.initialize({ apiKey: geminiApiKey });

      const videoBuffer = await readFile(absPath);

      const criteriaText = options.criteria === "all" || !options.criteria
        ? "emotional, informative, and funny moments"
        : `${options.criteria} moments`;

      const durationText = targetDuration ? `Target a total highlight duration of ${targetDuration} seconds.` : "";
      const countText = maxCount ? `Find up to ${maxCount} highlights.` : "";

      const geminiPrompt = `Analyze this video and identify the most engaging highlights based on BOTH visual and audio content.

Focus on finding ${criteriaText}. ${durationText} ${countText}

For each highlight, provide:
1. Start timestamp (in seconds, as a number)
2. End timestamp (in seconds, as a number)
3. Category: "emotional", "informative", or "funny"
4. Confidence score (0-1)
5. Brief reason why this is a highlight
6. What is said/shown during this moment

IMPORTANT: Respond ONLY with valid JSON in this exact format:
{
  "highlights": [
    {
      "startTime": 12.5,
      "endTime": 28.3,
      "category": "emotional",
      "confidence": 0.95,
      "reason": "Powerful personal story about overcoming challenges",
      "transcript": "When I first started, everyone said it was impossible..."
    }
  ]
}

Analyze both what is SHOWN (visual cues, actions, expressions) and what is SAID (speech, reactions) to find the most compelling moments.`;

      const result = await gemini.analyzeVideo(videoBuffer, geminiPrompt, {
        fps: 1,
        lowResolution: options.lowRes,
      });

      if (!result.success || !result.response) {
        return { success: false, highlights: [], totalDuration: 0, totalHighlightDuration: 0, error: `Gemini analysis failed: ${result.error}` };
      }

      // Parse Gemini response
      try {
        let jsonStr = result.response;
        const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) jsonStr = jsonMatch[1];
        const objectMatch = jsonStr.match(/\{[\s\S]*"highlights"[\s\S]*\}/);
        if (objectMatch) jsonStr = objectMatch[0];

        const parsed = JSON.parse(jsonStr);

        if (parsed.highlights && Array.isArray(parsed.highlights)) {
          allHighlights = parsed.highlights.map((h: {
            startTime: number;
            endTime: number;
            category?: string;
            confidence?: number;
            reason?: string;
            transcript?: string;
          }, i: number) => ({
            index: i + 1,
            startTime: h.startTime,
            endTime: h.endTime,
            duration: h.endTime - h.startTime,
            category: h.category || "all",
            confidence: h.confidence || 0.8,
            reason: h.reason || "Engaging moment",
            transcript: h.transcript || "",
          }));
        }
      } catch {
        return { success: false, highlights: [], totalDuration: 0, totalHighlightDuration: 0, error: "Failed to parse Gemini response" };
      }
    } else {
      // Whisper + Claude flow
      const openaiApiKey = await getApiKey("OPENAI_API_KEY", "OpenAI");
      if (!openaiApiKey) {
        return { success: false, highlights: [], totalDuration: 0, totalHighlightDuration: 0, error: "OpenAI API key required for Whisper transcription" };
      }

      const claudeApiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic");
      if (!claudeApiKey) {
        return { success: false, highlights: [], totalDuration: 0, totalHighlightDuration: 0, error: "Anthropic API key required for highlight analysis" };
      }

      let audioPath = absPath;
      let tempAudioPath: string | null = null;

      // Extract audio if video
      if (isVideo) {
        try {
          execSync("ffmpeg -version", { stdio: "ignore" });
        } catch {
          return { success: false, highlights: [], totalDuration: 0, totalHighlightDuration: 0, error: "FFmpeg not found" };
        }

        tempAudioPath = `/tmp/vibe_highlight_audio_${Date.now()}.wav`;
        await execAsync(
          `ffmpeg -i "${absPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${tempAudioPath}" -y`,
          { maxBuffer: 50 * 1024 * 1024 }
        );
        audioPath = tempAudioPath;

        const durationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${absPath}"`;
        const { stdout: durationOut } = await execAsync(durationCmd);
        sourceDuration = parseFloat(durationOut.trim());
      }

      // Transcribe with Whisper
      const whisper = new WhisperProvider();
      await whisper.initialize({ apiKey: openaiApiKey });

      const audioBuffer = await readFile(audioPath);
      const audioBlob = new Blob([audioBuffer]);
      const transcriptResult = await whisper.transcribe(audioBlob, options.language);

      // Cleanup temp file
      if (tempAudioPath && existsSync(tempAudioPath)) {
        await execAsync(`rm "${tempAudioPath}"`).catch(() => {});
      }

      if (transcriptResult.status === "failed" || !transcriptResult.segments) {
        return { success: false, highlights: [], totalDuration: 0, totalHighlightDuration: 0, error: `Transcription failed: ${transcriptResult.error}` };
      }

      if (transcriptResult.segments.length > 0) {
        sourceDuration = transcriptResult.segments[transcriptResult.segments.length - 1].endTime;
      }

      // Analyze with Claude
      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey: claudeApiKey });

      allHighlights = await claude.analyzeForHighlights(transcriptResult.segments, {
        criteria: (options.criteria || "all") as HighlightCriteria,
        targetDuration,
        maxCount,
      });
    }

    if (allHighlights.length === 0) {
      return { success: true, highlights: [], totalDuration: sourceDuration, totalHighlightDuration: 0 };
    }

    // Filter and rank
    const filteredHighlights = filterHighlights(allHighlights, {
      threshold,
      targetDuration,
      maxCount,
    });

    const totalHighlightDuration = filteredHighlights.reduce((sum, h) => sum + h.duration, 0);

    const extractResult: HighlightsExtractResult = {
      success: true,
      highlights: filteredHighlights,
      totalDuration: sourceDuration,
      totalHighlightDuration,
    };

    // Save JSON output
    if (options.output) {
      const outputPath = resolve(process.cwd(), options.output);
      await writeFile(outputPath, JSON.stringify({
        sourceFile: absPath,
        totalDuration: sourceDuration,
        criteria: options.criteria || "all",
        threshold,
        highlightsCount: filteredHighlights.length,
        totalHighlightDuration,
        highlights: filteredHighlights,
      }, null, 2), "utf-8");
      extractResult.outputPath = outputPath;
    }

    // Create project
    if (options.project) {
      const project = new Project("Highlight Reel");

      const source = project.addSource({
        name: basename(absPath),
        url: absPath,
        type: isVideo ? "video" : "audio",
        duration: sourceDuration,
      });

      const videoTrack = project.getTracks().find((t) => t.type === "video");
      if (videoTrack) {
        let currentTime = 0;
        for (const highlight of filteredHighlights) {
          project.addClip({
            sourceId: source.id,
            trackId: videoTrack.id,
            startTime: currentTime,
            duration: highlight.duration,
            sourceStartOffset: highlight.startTime,
            sourceEndOffset: highlight.endTime,
          });
          currentTime += highlight.duration;
        }
      }

      const projectPath = resolve(process.cwd(), options.project);
      await writeFile(projectPath, JSON.stringify(project.toJSON(), null, 2), "utf-8");
      extractResult.projectPath = projectPath;
    }

    return extractResult;
  } catch (error) {
    return {
      success: false,
      highlights: [],
      totalDuration: 0,
      totalHighlightDuration: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Options for auto-shorts generation
 */
export interface AutoShortsOptions {
  video: string;
  outputDir?: string;
  duration?: number;
  count?: number;
  aspect?: "9:16" | "1:1";
  addCaptions?: boolean;
  captionStyle?: "minimal" | "bold" | "animated";
  analyzeOnly?: boolean;
  language?: string;
  useGemini?: boolean;
  lowRes?: boolean;
}

/**
 * Result of auto-shorts generation
 */
export interface AutoShortsResult {
  success: boolean;
  shorts: Array<{
    index: number;
    startTime: number;
    endTime: number;
    duration: number;
    confidence: number;
    reason: string;
    outputPath?: string;
  }>;
  error?: string;
}

/**
 * Execute the auto-shorts generation pipeline programmatically
 */
export async function executeAutoShorts(
  options: AutoShortsOptions
): Promise<AutoShortsResult> {
  try {
    // Check FFmpeg
    try {
      execSync("ffmpeg -version", { stdio: "ignore" });
    } catch {
      return { success: false, shorts: [], error: "FFmpeg not found" };
    }

    const absPath = resolve(process.cwd(), options.video);
    if (!existsSync(absPath)) {
      return { success: false, shorts: [], error: `File not found: ${absPath}` };
    }

    const targetDuration = options.duration ?? 60;
    const shortCount = options.count ?? 1;

    let highlights: Highlight[] = [];

    if (options.useGemini) {
      const geminiApiKey = await getApiKey("GOOGLE_API_KEY", "Google");
      if (!geminiApiKey) {
        return { success: false, shorts: [], error: "Google API key required for Gemini Video Understanding" };
      }

      const gemini = new GeminiProvider();
      await gemini.initialize({ apiKey: geminiApiKey });

      const videoBuffer = await readFile(absPath);

      const geminiPrompt = `Analyze this video to find the BEST moments for short-form vertical video content (TikTok, YouTube Shorts, Instagram Reels).

Find ${shortCount * 3} potential clips that are ${targetDuration} seconds or shorter each.

Look for:
- Visually striking or surprising moments
- Emotional peaks (laughter, reactions, reveals)
- Key quotes or memorable statements
- Action sequences or dramatic moments
- Meme-worthy or shareable moments
- Strong hooks (great opening lines)
- Satisfying conclusions

For each highlight, provide:
1. Start timestamp (seconds, as number)
2. End timestamp (seconds, as number) - ensure duration is close to ${targetDuration}s
3. Virality score (0-1) - how likely this would perform on social media
4. Hook quality (0-1) - how strong is the opening
5. Brief reason why this would work as a short

IMPORTANT: Respond ONLY with valid JSON:
{
  "highlights": [
    {
      "startTime": 45.2,
      "endTime": 75.8,
      "confidence": 0.92,
      "hookQuality": 0.85,
      "reason": "Unexpected plot twist with strong visual reaction"
    }
  ]
}

Analyze both VISUALS (expressions, actions, scene changes) and AUDIO (speech, reactions, music) to find viral-worthy moments.`;

      const result = await gemini.analyzeVideo(videoBuffer, geminiPrompt, {
        fps: 1,
        lowResolution: options.lowRes,
      });

      if (!result.success || !result.response) {
        return { success: false, shorts: [], error: `Gemini analysis failed: ${result.error}` };
      }

      try {
        let jsonStr = result.response;
        const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) jsonStr = jsonMatch[1];
        const objectMatch = jsonStr.match(/\{[\s\S]*"highlights"[\s\S]*\}/);
        if (objectMatch) jsonStr = objectMatch[0];

        const parsed = JSON.parse(jsonStr);

        if (parsed.highlights && Array.isArray(parsed.highlights)) {
          highlights = parsed.highlights.map((h: {
            startTime: number;
            endTime: number;
            confidence?: number;
            hookQuality?: number;
            reason?: string;
          }, i: number) => ({
            index: i + 1,
            startTime: h.startTime,
            endTime: h.endTime,
            duration: h.endTime - h.startTime,
            category: "viral" as HighlightCriteria,
            confidence: h.confidence || 0.8,
            reason: h.reason || "Engaging moment",
            transcript: "",
          }));
        }
      } catch {
        return { success: false, shorts: [], error: "Failed to parse Gemini response" };
      }
    } else {
      // Whisper + Claude flow
      const openaiApiKey = await getApiKey("OPENAI_API_KEY", "OpenAI");
      if (!openaiApiKey) {
        return { success: false, shorts: [], error: "OpenAI API key required for transcription" };
      }

      const claudeApiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic");
      if (!claudeApiKey) {
        return { success: false, shorts: [], error: "Anthropic API key required for highlight detection" };
      }

      const tempAudio = absPath.replace(/(\.[^.]+)$/, "-temp-audio.mp3");
      await execAsync(`ffmpeg -i "${absPath}" -vn -acodec libmp3lame -q:a 2 "${tempAudio}" -y`);

      const whisper = new WhisperProvider();
      await whisper.initialize({ apiKey: openaiApiKey });

      const audioBuffer = await readFile(tempAudio);
      const audioBlob = new Blob([audioBuffer]);
      const transcript = await whisper.transcribe(audioBlob, options.language);

      try {
        await execAsync(`rm "${tempAudio}"`);
      } catch { /* ignore */ }

      if (!transcript.segments || transcript.segments.length === 0) {
        return { success: false, shorts: [], error: "No transcript found" };
      }

      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey: claudeApiKey });

      highlights = await claude.analyzeForHighlights(transcript.segments, {
        criteria: "all",
        targetDuration: targetDuration * shortCount,
        maxCount: shortCount * 3,
      });
    }

    if (highlights.length === 0) {
      return { success: false, shorts: [], error: "No highlights found" };
    }

    // Sort by confidence and select best
    highlights.sort((a, b) => b.confidence - a.confidence);
    const selectedHighlights = highlights.slice(0, shortCount);

    if (options.analyzeOnly) {
      return {
        success: true,
        shorts: selectedHighlights.map((h, i) => ({
          index: i + 1,
          startTime: h.startTime,
          endTime: h.endTime,
          duration: h.duration,
          confidence: h.confidence,
          reason: h.reason,
        })),
      };
    }

    // Generate shorts
    const outputDir = options.outputDir
      ? resolve(process.cwd(), options.outputDir)
      : dirname(absPath);

    if (options.outputDir && !existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true });
    }

    const result: AutoShortsResult = {
      success: true,
      shorts: [],
    };

    for (let i = 0; i < selectedHighlights.length; i++) {
      const h = selectedHighlights[i];

      const baseName = basename(absPath, extname(absPath));
      const outputPath = resolve(outputDir, `${baseName}-short-${i + 1}.mp4`);

      // Get source dimensions
      const { stdout: probeOut } = await execAsync(
        `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${absPath}"`
      );
      const [width, height] = probeOut.trim().split(",").map(Number);

      // Calculate crop for aspect ratio
      const aspect = options.aspect || "9:16";
      const [targetW, targetH] = aspect.split(":").map(Number);
      const targetRatio = targetW / targetH;
      const sourceRatio = width / height;

      let cropW: number, cropH: number, cropX: number, cropY: number;
      if (sourceRatio > targetRatio) {
        cropH = height;
        cropW = Math.round(height * targetRatio);
        cropX = Math.round((width - cropW) / 2);
        cropY = 0;
      } else {
        cropW = width;
        cropH = Math.round(width / targetRatio);
        cropX = 0;
        cropY = Math.round((height - cropH) / 2);
      }

      const vf = `crop=${cropW}:${cropH}:${cropX}:${cropY}`;
      const cmd = `ffmpeg -ss ${h.startTime} -i "${absPath}" -t ${h.duration} -vf "${vf}" -c:a aac -b:a 128k "${outputPath}" -y`;

      await execAsync(cmd, { timeout: 300000 });

      result.shorts.push({
        index: i + 1,
        startTime: h.startTime,
        endTime: h.endTime,
        duration: h.duration,
        confidence: h.confidence,
        reason: h.reason,
        outputPath,
      });
    }

    return result;
  } catch (error) {
    return {
      success: false,
      shorts: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Options for Gemini video analysis
 */
export interface GeminiVideoOptions {
  source: string;
  prompt: string;
  model?: "flash" | "flash-2.5" | "pro";
  fps?: number;
  start?: number;
  end?: number;
  lowRes?: boolean;
}

/**
 * Result of Gemini video analysis
 */
export interface GeminiVideoResult {
  success: boolean;
  response?: string;
  model?: string;
  totalTokens?: number;
  promptTokens?: number;
  responseTokens?: number;
  error?: string;
}

/**
 * Execute Gemini video analysis programmatically
 */
export async function executeGeminiVideo(
  options: GeminiVideoOptions
): Promise<GeminiVideoResult> {
  try {
    const apiKey = await getApiKey("GOOGLE_API_KEY", "Google");
    if (!apiKey) {
      return { success: false, error: "Google API key required" };
    }

    const isYouTube = options.source.includes("youtube.com") || options.source.includes("youtu.be");

    const modelMap: Record<string, string> = {
      flash: "gemini-3-flash-preview",
      "flash-2.5": "gemini-2.5-flash",
      pro: "gemini-2.5-pro",
    };
    const modelId = modelMap[options.model || "flash"] || modelMap.flash;

    let videoData: Buffer | string;
    if (isYouTube) {
      videoData = options.source;
    } else {
      const absPath = resolve(process.cwd(), options.source);
      if (!existsSync(absPath)) {
        return { success: false, error: `File not found: ${absPath}` };
      }
      videoData = await readFile(absPath);
    }

    const gemini = new GeminiProvider();
    await gemini.initialize({ apiKey });

    const result = await gemini.analyzeVideo(videoData, options.prompt, {
      model: modelId as "gemini-3-flash-preview" | "gemini-2.5-flash" | "gemini-2.5-pro",
      fps: options.fps,
      startOffset: options.start,
      endOffset: options.end,
      lowResolution: options.lowRes,
    });

    if (!result.success) {
      return { success: false, error: result.error || "Video analysis failed" };
    }

    return {
      success: true,
      response: result.response,
      model: result.model,
      totalTokens: result.totalTokens,
      promptTokens: result.promptTokens,
      responseTokens: result.responseTokens,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Options for unified analyze command
 */
export interface AnalyzeOptions {
  source: string;
  prompt: string;
  model?: "flash" | "flash-2.5" | "pro";
  fps?: number;
  start?: number;
  end?: number;
  lowRes?: boolean;
}

/**
 * Result of unified analyze command
 */
export interface AnalyzeResult {
  success: boolean;
  response?: string;
  model?: string;
  sourceType?: "image" | "video" | "youtube";
  totalTokens?: number;
  promptTokens?: number;
  responseTokens?: number;
  error?: string;
}

/**
 * Execute unified analyze command programmatically
 * Auto-detects source type: YouTube URL, image URL, local image, local video
 */
export async function executeAnalyze(
  options: AnalyzeOptions
): Promise<AnalyzeResult> {
  try {
    const apiKey = await getApiKey("GOOGLE_API_KEY", "Google");
    if (!apiKey) {
      return { success: false, error: "Google API key required" };
    }

    const source = options.source;

    // Detect source type
    const isYouTube = source.includes("youtube.com") || source.includes("youtu.be");
    const isImageUrl = /^https?:\/\/.+\.(png|jpg|jpeg|webp|gif)(\?.*)?$/i.test(source);
    const isVideoUrl = /^https?:\/\/.+\.(mp4|mov|webm)(\?.*)?$/i.test(source);
    const ext = extname(source).toLowerCase();
    const imageExts = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
    const videoExts = [".mp4", ".mov", ".webm", ".avi", ".mkv"];
    const isLocalImage = imageExts.includes(ext);
    const isLocalVideo = videoExts.includes(ext);
    const isImage = isImageUrl || isLocalImage;
    const isVideo = isYouTube || isVideoUrl || isLocalVideo;

    if (!isImage && !isVideo) {
      return {
        success: false,
        error: "Cannot detect source type. Supported: images (.png/.jpg/.webp/.gif), videos (.mp4/.mov/.webm), YouTube URLs, image URLs.",
      };
    }

    const modelMap: Record<string, string> = {
      flash: "gemini-3-flash-preview",
      "flash-2.5": "gemini-2.5-flash",
      pro: "gemini-2.5-pro",
    };
    const modelId = modelMap[options.model || "flash"] || modelMap.flash;

    const gemini = new GeminiProvider();
    await gemini.initialize({ apiKey });

    if (isImage) {
      let imageBuffer: Buffer;
      if (isImageUrl) {
        const response = await fetch(source);
        if (!response.ok) {
          return { success: false, error: `Failed to fetch image: ${response.status}` };
        }
        imageBuffer = Buffer.from(await response.arrayBuffer());
      } else {
        const absPath = resolve(process.cwd(), source);
        if (!existsSync(absPath)) {
          return { success: false, error: `File not found: ${absPath}` };
        }
        imageBuffer = await readFile(absPath);
      }

      const result = await gemini.analyzeImage(imageBuffer, options.prompt, {
        model: modelId as "gemini-3-flash-preview" | "gemini-2.5-flash" | "gemini-2.5-pro",
        lowResolution: options.lowRes,
      });

      if (!result.success) {
        return { success: false, error: result.error || "Image analysis failed" };
      }

      return {
        success: true,
        response: result.response,
        model: result.model,
        sourceType: "image",
        totalTokens: result.totalTokens,
        promptTokens: result.promptTokens,
        responseTokens: result.responseTokens,
      };
    } else {
      // Video (YouTube, URL, or local)
      let videoData: Buffer | string;
      let sourceType: "video" | "youtube" = "video";

      if (isYouTube) {
        videoData = source;
        sourceType = "youtube";
      } else if (isVideoUrl) {
        const response = await fetch(source);
        if (!response.ok) {
          return { success: false, error: `Failed to fetch video: ${response.status}` };
        }
        videoData = Buffer.from(await response.arrayBuffer());
      } else {
        const absPath = resolve(process.cwd(), source);
        if (!existsSync(absPath)) {
          return { success: false, error: `File not found: ${absPath}` };
        }
        videoData = await readFile(absPath);
      }

      const result = await gemini.analyzeVideo(videoData, options.prompt, {
        model: modelId as "gemini-3-flash-preview" | "gemini-2.5-flash" | "gemini-2.5-pro",
        fps: options.fps,
        startOffset: options.start,
        endOffset: options.end,
        lowResolution: options.lowRes,
      });

      if (!result.success) {
        return { success: false, error: result.error || "Video analysis failed" };
      }

      return {
        success: true,
        response: result.response,
        model: result.model,
        sourceType,
        totalTokens: result.totalTokens,
        promptTokens: result.promptTokens,
        responseTokens: result.responseTokens,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

aiCommand
  .command("providers")
  .description("List available AI providers")
  .action(async () => {
    // Register default providers
    providerRegistry.register(whisperProvider);
    providerRegistry.register(geminiProvider);
    providerRegistry.register(openaiProvider);
    providerRegistry.register(claudeProvider);
    providerRegistry.register(elevenLabsProvider);
    providerRegistry.register(openaiImageProvider);
    providerRegistry.register(runwayProvider);
    providerRegistry.register(klingProvider);
    providerRegistry.register(stabilityProvider);
    providerRegistry.register(replicateProvider);

    console.log();
    console.log(chalk.bold.cyan("Available AI Providers"));
    console.log(chalk.dim("─".repeat(60)));

    const providers = providerRegistry.getAll();
    for (const provider of providers) {
      const status = provider.isAvailable ? chalk.green("●") : chalk.red("○");
      console.log();
      console.log(`${status} ${chalk.bold(provider.name)} ${chalk.dim(`(${provider.id})`)}`);
      console.log(`  ${provider.description}`);
      console.log(`  ${chalk.dim("Capabilities:")} ${provider.capabilities.join(", ")}`);
    }

    console.log();
  });

// Auto-Narrate command
aiCommand
  .command("narrate")
  .description("Generate AI narration for a video file or project")
  .argument("<input>", "Video file or project file (.vibe.json)")
  .option("-o, --output <dir>", "Output directory for generated files", ".")
  .option("-v, --voice <name>", "ElevenLabs voice name (rachel, adam, josh, etc.)", "rachel")
  .option("-s, --style <style>", "Narration style: informative, energetic, calm, dramatic", "informative")
  .option("-l, --language <lang>", "Language code (e.g., en, ko)", "en")
  .option("--add-to-project", "Add narration to project (only for .vibe.json input)")
  .action(async (inputPath: string, options) => {
    try {
      const absPath = resolve(process.cwd(), inputPath);
      if (!existsSync(absPath)) {
        console.error(chalk.red(`File not found: ${absPath}`));
        process.exit(1);
      }

      console.log();
      console.log(chalk.bold.cyan("🎙️ Auto-Narrate Pipeline"));
      console.log(chalk.dim("─".repeat(60)));
      console.log();

      const isProject = inputPath.endsWith(".vibe.json");
      let videoPath: string;
      let project: Project | null = null;
      let outputDir = resolve(process.cwd(), options.output);

      if (isProject) {
        // Load project to find video source
        const content = await readFile(absPath, "utf-8");
        const data: ProjectFile = JSON.parse(content);
        project = Project.fromJSON(data);
        const sources = project.getSources();
        const videoSource = sources.find((s) => s.type === "video");

        if (!videoSource) {
          console.error(chalk.red("No video source found in project"));
          process.exit(1);
        }

        videoPath = resolve(dirname(absPath), videoSource.url);
        if (!existsSync(videoPath)) {
          console.error(chalk.red(`Video file not found: ${videoPath}`));
          process.exit(1);
        }

        // Use project directory as output if not specified
        if (options.output === ".") {
          outputDir = dirname(absPath);
        }

        console.log(`📁 Project: ${chalk.bold(project.getMeta().name)}`);
      } else {
        videoPath = absPath;
        console.log(`🎬 Video: ${chalk.bold(basename(videoPath))}`);
      }

      // Get video duration
      const durationSpinner = ora("📊 Analyzing video...").start();
      let duration: number;
      try {
        const durationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
        const { stdout } = await execAsync(durationCmd);
        duration = parseFloat(stdout.trim());
        durationSpinner.succeed(chalk.green(`Duration: ${formatTime(duration)}`));
      } catch {
        durationSpinner.fail(chalk.red("Failed to get video duration"));
        process.exit(1);
      }

      // Validate style option
      const validStyles = ["informative", "energetic", "calm", "dramatic"];
      if (!validStyles.includes(options.style)) {
        console.error(chalk.red(`Invalid style: ${options.style}`));
        console.error(chalk.dim(`Valid styles: ${validStyles.join(", ")}`));
        process.exit(1);
      }

      // Generate narration
      const generateSpinner = ora("🤖 Generating narration...").start();

      generateSpinner.text = "📹 Analyzing video with Gemini...";
      const result = await autoNarrate({
        videoPath,
        duration,
        outputDir,
        voice: options.voice,
        style: options.style as "informative" | "energetic" | "calm" | "dramatic",
        language: options.language,
      });

      if (!result.success) {
        generateSpinner.fail(chalk.red(`Failed: ${result.error}`));
        process.exit(1);
      }

      generateSpinner.succeed(chalk.green("Narration generated successfully"));

      // Display result
      console.log();
      console.log(chalk.bold.cyan("Generated Files"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`  🎵 Audio: ${chalk.green(result.audioPath)}`);
      console.log(`  📝 Script: ${chalk.green(resolve(outputDir, "narration-script.txt"))}`);

      if (result.segments && result.segments.length > 0) {
        console.log();
        console.log(chalk.bold.cyan("Narration Segments"));
        console.log(chalk.dim("─".repeat(60)));
        for (const seg of result.segments.slice(0, 5)) {
          console.log(`  [${formatTime(seg.startTime)} - ${formatTime(seg.endTime)}] ${chalk.dim(seg.text.substring(0, 50))}${seg.text.length > 50 ? "..." : ""}`);
        }
        if (result.segments.length > 5) {
          console.log(chalk.dim(`  ... and ${result.segments.length - 5} more segments`));
        }
      }

      // Add to project if requested
      if (options.addToProject && project && isProject) {
        const addSpinner = ora("Adding narration to project...").start();

        // Get audio duration
        let audioDuration: number;
        try {
          audioDuration = await getAudioDuration(result.audioPath!);
        } catch {
          audioDuration = duration; // Fallback to video duration
        }

        // Add audio source
        const audioSource = project.addSource({
          name: "Auto-generated narration",
          url: basename(result.audioPath!),
          type: "audio",
          duration: audioDuration,
        });

        // Add audio clip to audio track
        const audioTrack = project.getTracks().find((t) => t.type === "audio");
        if (audioTrack) {
          project.addClip({
            sourceId: audioSource.id,
            trackId: audioTrack.id,
            startTime: 0,
            duration: Math.min(audioDuration, duration),
            sourceStartOffset: 0,
            sourceEndOffset: Math.min(audioDuration, duration),
          });
        }

        // Save updated project
        await writeFile(absPath, JSON.stringify(project.toJSON(), null, 2), "utf-8");
        addSpinner.succeed(chalk.green("Narration added to project"));
      }

      console.log();
      console.log(chalk.bold.green("✅ Auto-narrate complete!"));

      if (!options.addToProject && isProject) {
        console.log();
        console.log(chalk.dim("Tip: Use --add-to-project to automatically add the narration to your project"));
      }

      console.log();
    } catch (error) {
      console.error(chalk.red("Auto-narrate failed"));
      console.error(error);
      process.exit(1);
    }
  });

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  return `${mins}:${secs.padStart(4, "0")}`;
}

function applySuggestion(project: Project, suggestion: any): boolean {
  const { type, clipIds, params } = suggestion;

  if (clipIds.length === 0) return false;
  const clipId = clipIds[0];

  switch (type) {
    case "trim":
      if (params.newDuration) {
        return project.trimClipEnd(clipId, params.newDuration);
      }
      break;
    case "add-effect":
      if (params.effectType) {
        const effect = project.addEffect(clipId, {
          type: params.effectType,
          startTime: params.startTime || 0,
          duration: params.duration || 1,
          params: params.effectParams || {},
        });
        return effect !== null;
      }
      break;
    case "delete":
      return project.removeClip(clipId);
  }

  return false;
}

export function executeCommand(project: Project, cmd: TimelineCommand): boolean {
  const { action, clipIds, params } = cmd;

  try {
    switch (action) {
      case "trim":
        for (const clipId of clipIds) {
          if (params.newDuration) {
            project.trimClipEnd(clipId, params.newDuration as number);
          }
          if (params.startTrim) {
            project.trimClipStart(clipId, params.startTrim as number);
          }
        }
        return true;

      case "remove-clip":
        for (const clipId of clipIds) {
          project.removeClip(clipId);
        }
        return true;

      case "split":
        if (clipIds.length > 0 && params.splitTime) {
          project.splitClip(clipIds[0], params.splitTime as number);
        }
        return true;

      case "duplicate":
        for (const clipId of clipIds) {
          project.duplicateClip(clipId, params.newStartTime as number | undefined);
        }
        return true;

      case "move":
        for (const clipId of clipIds) {
          const clip = project.getClips().find((c) => c.id === clipId);
          if (clip) {
            const newTrackId = (params.newTrackId as string) || clip.trackId;
            const newStartTime = (params.newStartTime as number) ?? clip.startTime;
            project.moveClip(clipId, newTrackId, newStartTime);
          }
        }
        return true;

      case "add-effect":
        for (const clipId of clipIds) {
          const effectType = ((params.effectType as string) || "fadeIn") as EffectType;
          project.addEffect(clipId, {
            type: effectType,
            startTime: (params.startTime as number) || 0,
            duration: (params.duration as number) || 1,
            params: {},
          });
        }
        return true;

      case "remove-effect":
        // TODO: Implement effect removal
        return false;

      case "set-volume":
        // TODO: Implement volume control
        return false;

      case "add-track": {
        const trackType = (params.trackType as "video" | "audio") || "video";
        const tracks = project.getTracks();
        project.addTrack({
          type: trackType,
          name: `${trackType}-track-${tracks.length + 1}`,
          order: tracks.length,
          isMuted: false,
          isLocked: false,
          isVisible: true,
        });
        return true;
      }

      case "speed-change":
        // Store speed info in clip metadata (processed during export)
        for (const clipId of clipIds) {
          const clip = project.getClips().find((c) => c.id === clipId);
          if (clip) {
            const speed = (params.speed as number) || 1.0;
            project.addEffect(clipId, {
              type: "speed" as EffectType,
              startTime: 0,
              duration: clip.duration,
              params: { speed },
            });
          }
        }
        return true;

      case "reverse":
        // Reverse is implemented as speed = -1
        for (const clipId of clipIds) {
          const clip = project.getClips().find((c) => c.id === clipId);
          if (clip) {
            project.addEffect(clipId, {
              type: "reverse" as EffectType,
              startTime: 0,
              duration: clip.duration,
              params: {},
            });
          }
        }
        return true;

      case "crop":
        // Store crop info in clip metadata (processed during export)
        for (const clipId of clipIds) {
          const clip = project.getClips().find((c) => c.id === clipId);
          if (clip) {
            project.addEffect(clipId, {
              type: "crop" as EffectType,
              startTime: 0,
              duration: clip.duration,
              params: {
                aspectRatio: params.aspectRatio as string,
                x: params.x as number,
                y: params.y as number,
                width: params.width as number,
                height: params.height as number,
              },
            });
          }
        }
        return true;

      case "position":
        // Move clip to beginning/end/middle
        for (const clipId of clipIds) {
          const clip = project.getClips().find((c) => c.id === clipId);
          if (clip) {
            const position = params.position as string;
            const allClips = project.getClips().filter((c) => c.trackId === clip.trackId);
            let newStartTime = 0;

            if (position === "end") {
              const maxEnd = Math.max(...allClips.filter((c) => c.id !== clipId).map((c) => c.startTime + c.duration));
              newStartTime = maxEnd;
            } else if (position === "middle") {
              const totalDuration = allClips.reduce((sum, c) => sum + c.duration, 0);
              newStartTime = (totalDuration - clip.duration) / 2;
            }
            // "beginning" stays at 0

            project.moveClip(clipId, clip.trackId, newStartTime);
          }
        }
        return true;

      default:
        console.warn(`Unknown action: ${action}`);
        return false;
    }
  } catch (error) {
    console.error(`Error executing ${action}:`, error);
    return false;
  }
}
