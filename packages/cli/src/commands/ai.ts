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
import { formatTime, applySuggestion } from "./ai-helpers.js";
import { registerAudioCommands } from './ai-audio.js';
import { registerImageCommands } from './ai-image.js';
import {
  registerEditCommands,
  applyTextOverlays,
  type TextOverlayStyle,
  type TextOverlayOptions,
  type TextOverlayResult,
  type VideoReviewFeedback,
} from './ai-edit.js';
import {
  registerMotionCommand,
  executeMotion,
  type MotionCommandOptions,
  type MotionCommandResult,
} from "./ai-motion.js";
import { registerVideoCommands } from "./ai-video.js";
import { registerAnalyzeCommands } from "./ai-analyze.js";
import {
  registerReviewCommand,
  executeReview,
  type ReviewOptions,
  type ReviewResult,
} from "./ai-review.js";
import {
  registerHighlightsCommands,
  executeHighlights,
  executeAutoShorts,
  type HighlightsOptions,
  type HighlightsExtractResult,
  type AutoShortsOptions,
  type AutoShortsResult,
} from "./ai-highlights.js";
import {
  registerScriptPipelineCommands,
  executeScriptToVideo,
  executeRegenerateScene,
  type ScriptToVideoOptions,
  type ScriptToVideoResult,
  type NarrationEntry,
  type RegenerateSceneOptions,
  type RegenerateSceneResult,
} from "./ai-script-pipeline.js";

// Re-export for backward compatibility (agent tools import from this file)
export { executeMotion, type MotionCommandOptions, type MotionCommandResult };
export {
  executeSilenceCut, executeJumpCut, executeCaption, executeNoiseReduce,
  executeFade, executeTranslateSrt, applyTextOverlays, executeTextOverlay,
  type TextOverlayStyle, type TextOverlayOptions, type TextOverlayResult,
  type CaptionStyle, type CaptionOptions, type CaptionResult,
  type SilencePeriod, type SilenceCutOptions, type SilenceCutResult,
  type FillerWord, type JumpCutOptions, type JumpCutResult,
  type NoiseReduceOptions, type NoiseReduceResult,
  type FadeOptions, type FadeResult,
  type TranslateSrtOptions, type TranslateSrtResult,
  DEFAULT_FILLER_WORDS, detectFillerRanges,
} from "./ai-edit.js";
export {
  executeThumbnailBestFrame,
  type ThumbnailBestFrameOptions,
  type ThumbnailBestFrameResult,
} from "./ai-image.js";
export { executeReview, type ReviewOptions, type ReviewResult } from "./ai-review.js";
export {
  executeHighlights,
  executeAutoShorts,
  type HighlightsOptions,
  type HighlightsExtractResult,
  type AutoShortsOptions,
  type AutoShortsResult,
} from "./ai-highlights.js";
export {
  executeGeminiVideo,
  executeAnalyze,
  type GeminiVideoOptions,
  type GeminiVideoResult,
  type AnalyzeOptions,
  type AnalyzeResult,
} from "./ai-analyze.js";
export {
  executeScriptToVideo,
  executeRegenerateScene,
  type ScriptToVideoOptions,
  type ScriptToVideoResult,
  type NarrationEntry,
  type RegenerateSceneOptions,
  type RegenerateSceneResult,
} from "./ai-script-pipeline.js";

const execAsync = promisify(exec);

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

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

export const aiCommand = new Command("ai")
  .description("AI provider commands");

registerAudioCommands(aiCommand);
registerImageCommands(aiCommand);
registerEditCommands(aiCommand);
registerVideoCommands(aiCommand);
registerAnalyzeCommands(aiCommand);
registerReviewCommand(aiCommand);
registerHighlightsCommands(aiCommand);
registerScriptPipelineCommands(aiCommand);
registerMotionCommand(aiCommand);

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

// ============================================================================
// Voice & Audio Features
// ============================================================================
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
        console.warn("remove-effect is not yet supported. Use the timeline UI to remove effects.");
        return false;

      case "set-volume":
        console.warn("set-volume is not yet supported. Audio ducking via 'vibe ai duck' can adjust levels.");
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
