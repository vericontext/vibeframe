/**
 * ai-narrate.ts — Auto-narrate types/function + providers & narrate commands.
 *
 * Commands: providers, narrate
 *
 * Extracted from ai.ts as part of modularisation.
 * ai.ts calls registerNarrateCommands(aiCommand).
 */

import { type Command } from "commander";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { existsSync } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import chalk from "chalk";
import ora from "ora";
import {
  providerRegistry,
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
  GeminiProvider,
  OpenAIProvider,
  ClaudeProvider,
  ElevenLabsProvider,
} from "@vibeframe/ai-providers";
import { Project, type ProjectFile } from "../engine/index.js";
import { getApiKey } from "../utils/api-key.js";
import { getAudioDuration } from "../utils/audio.js";
import { formatTime } from "./ai-helpers.js";

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
  /** LLM provider for script generation: "claude" (default) or "openai" */
  scriptProvider?: "claude" | "openai";
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
    scriptProvider = "claude",
  } = options;

  // Validate API keys
  const geminiApiKey = await getApiKey("GOOGLE_API_KEY", "Google");
  if (!geminiApiKey) {
    return { success: false, error: "GOOGLE_API_KEY required for video analysis" };
  }

  let claudeApiKey: string | null = null;
  let openaiScriptApiKey: string | null = null;
  if (scriptProvider === "openai") {
    openaiScriptApiKey = await getApiKey("OPENAI_API_KEY", "OpenAI");
    if (!openaiScriptApiKey) {
      return { success: false, error: "OPENAI_API_KEY required for script generation" };
    }
  } else {
    claudeApiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic");
    if (!claudeApiKey) {
      return { success: false, error: "ANTHROPIC_API_KEY required for script generation" };
    }
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

    // Step 2: Generate narration script with Claude or OpenAI
    let scriptResult: { success: boolean; script?: string; segments?: Array<{ startTime: number; endTime: number; text: string }>; error?: string };

    if (scriptProvider === "openai") {
      const gpt = new OpenAIProvider();
      await gpt.initialize({ apiKey: openaiScriptApiKey! });
      scriptResult = await gpt.generateNarrationScript(
        analysisResult.response,
        duration,
        style,
        language
      );
    } else {
      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey: claudeApiKey! });
      scriptResult = await claude.generateNarrationScript(
        analysisResult.response,
        duration,
        style,
        language
      );

      // Auto-fallback to OpenAI on Claude overload (529)
      if (!scriptResult.success && scriptResult.error?.includes("529")) {
        const fallbackKey = await getApiKey("OPENAI_API_KEY", "OpenAI");
        if (fallbackKey) {
          console.error("⚠️  Claude overloaded, falling back to OpenAI...");
          const gpt = new OpenAIProvider();
          await gpt.initialize({ apiKey: fallbackKey });
          scriptResult = await gpt.generateNarrationScript(
            analysisResult.response,
            duration,
            style,
            language
          );
        }
      }
    }

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

// ==========================================
// CLI Command Registration
// ==========================================

export function registerNarrateCommands(ai: Command): void {

ai
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
ai
  .command("narrate")
  .description("Generate AI narration for a video file or project")
  .argument("<input>", "Video file or project file (.vibe.json)")
  .option("-o, --output <dir>", "Output directory for generated files", ".")
  .option("-v, --voice <name>", "ElevenLabs voice name (rachel, adam, josh, etc.)", "rachel")
  .option("-s, --style <style>", "Narration style: informative, energetic, calm, dramatic", "informative")
  .option("-l, --language <lang>", "Language code (e.g., en, ko)", "en")
  .option("-p, --provider <name>", "LLM for script generation: claude (default), openai", "claude")
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
        scriptProvider: options.provider as "claude" | "openai",
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

} // end registerNarrateCommands
