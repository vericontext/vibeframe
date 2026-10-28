/**
 * @module ai-highlights
 *
 * Highlight extraction and auto-shorts generation for long-form content.
 *
 * CLI commands: highlights, auto-shorts
 *
 * Execute functions:
 *   executeHighlights  - Extract best moments from video/audio (transcription + Claude, or Gemini)
 *   executeAutoShorts   - Generate short-form vertical clips from long-form video
 *
 * @dependencies ElevenLabs Scribe or OpenAI Whisper, Claude (Anthropic), Gemini (Google), FFmpeg
 */

import { Command } from "commander";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, basename, extname } from "node:path";
import { existsSync } from "node:fs";
import chalk from "chalk";
import {
  GeminiProvider,
  ClaudeProvider,
  type Highlight,
  type HighlightCriteria,
  type HighlightsResult,
} from "@vibeframe/ai-providers";
import { Project } from "../engine/index.js";
import { ApiKeyError, requireApiKey } from "../utils/api-key.js";
import { formatTime } from "./ai-helpers.js";
import { execSafe, commandExists, ffprobeDuration } from "../utils/exec-safe.js";
import { executorFailure, failureFromError, providerFailure, spinner as createSpinner, exitWithError, log, outputSuccess, notFoundError, generalError, type StructuredError } from "./output.js";
import { validateOutputPath } from "./validate.js";
import {
  STT_OPTION_HELP,
  requireSttProvider,
  resolveSttProvider,
  sttLabel,
  sttOptionOrExit,
  transcribeAudioFile,
} from "./_shared/transcription.js";

// ============================================================================
// Shared helpers
// ============================================================================

function filterHighlights(
  highlights: Highlight[],
  options: { threshold: number; targetDuration?: number; maxCount?: number }
): Highlight[] {
  let filtered = highlights.filter((h) => h.confidence >= options.threshold);
  filtered.sort((a, b) => b.confidence - a.confidence);

  if (options.maxCount && filtered.length > options.maxCount) {
    filtered = filtered.slice(0, options.maxCount);
  }

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

  filtered.sort((a, b) => a.startTime - b.startTime);
  return filtered.map((h, i) => ({ ...h, index: i + 1 }));
}

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

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

// ============================================================================
// Exported execute functions (used by agent tools)
// ============================================================================

/** Options for {@link executeHighlights}. */
export interface HighlightsOptions {
  /** Path to the video or audio file */
  media: string;
  /** Path for the output JSON with highlight data */
  output?: string;
  /** Path for a timeline JSON file with highlight clips */
  project?: string;
  /** Target highlight reel duration in seconds */
  duration?: number;
  /** Maximum number of highlights to return */
  count?: number;
  /** Minimum confidence threshold 0-1 (default: 0.7) */
  threshold?: number;
  /** Selection criteria filter */
  criteria?: "emotional" | "informative" | "funny" | "all";
  /** Language code for transcription */
  language?: string;
  /** Transcription provider: auto (default), elevenlabs, openai */
  stt?: string;
  /** Use Gemini multimodal analysis instead of transcription + Claude */
  useGemini?: boolean;
  /** Use low-resolution mode for Gemini (longer videos) */
  lowRes?: boolean;
}

/** Result from {@link executeHighlights}. */
export interface HighlightsExtractResult {
  /** Whether the extraction succeeded */
  success: boolean;
  /** Detected and filtered highlights */
  highlights: Highlight[];
  /** Total source media duration in seconds */
  totalDuration: number;
  /** Combined duration of all returned highlights in seconds */
  totalHighlightDuration: number;
  /** Path to the output JSON (if --output specified) */
  outputPath?: string;
  /** Path to the generated timeline file (if --project specified) */
  projectPath?: string;
  /** Error message on failure */
  error?: string;
  /** The structured error on failure; see {@link ExecutorFailure}. */
  failure?: StructuredError;
}

function highlightsFailure(failure: StructuredError): HighlightsExtractResult {
  return { ...executorFailure(failure), highlights: [], totalDuration: 0, totalHighlightDuration: 0 };
}

/**
 * Extract the best highlights from a video or audio file.
 *
 * Supports two analysis backends:
 * - Transcription + Claude (default): transcribe audio (Scribe or Whisper), then analyze text for highlights
 * - Gemini (--useGemini): multimodal visual+audio analysis for richer detection
 *
 * @param options - Highlight extraction configuration
 * @returns Result with filtered highlights sorted by time
 */
export async function executeHighlights(
  options: HighlightsOptions
): Promise<HighlightsExtractResult> {
  try {
    const absPath = resolve(process.cwd(), options.media);
    if (!existsSync(absPath)) {
      return highlightsFailure(notFoundError(absPath));
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
      const geminiApiKey = await requireApiKey("GOOGLE_API_KEY", "Google");

      sourceDuration = await ffprobeDuration(absPath);

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
        return highlightsFailure(providerFailure("Gemini returned a highlights reply that could not be parsed", "provider"));
      }
    } else {
      const stt = await resolveSttProvider(options.stt);
      const claudeApiKey = await requireApiKey("ANTHROPIC_API_KEY", "Anthropic");

      let audioPath = absPath;
      let tempAudioPath: string | null = null;

      if (isVideo) {
        if (!commandExists("ffmpeg")) {
          return highlightsFailure(generalError("FFmpeg not found", "Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux). Run `vibe doctor` for details."));
        }

        tempAudioPath = `/tmp/vibe_highlight_audio_${Date.now()}.wav`;
        await execSafe("ffmpeg", [
          "-i", absPath, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", tempAudioPath, "-y",
        ], { maxBuffer: 50 * 1024 * 1024 });
        audioPath = tempAudioPath;

        sourceDuration = await ffprobeDuration(absPath);
      }

      const transcriptResult = await transcribeAudioFile(audioPath, { ...stt, language: options.language });

      if (tempAudioPath && existsSync(tempAudioPath)) {
        const { unlink: unlinkFile } = await import("node:fs/promises");
        await unlinkFile(tempAudioPath).catch(() => {});
      }

      if (transcriptResult.status === "failed" || !transcriptResult.segments) {
        return highlightsFailure(providerFailure(`Transcription failed: ${transcriptResult.error}`, transcriptResult.errorKind));
      }

      if (transcriptResult.segments.length > 0) {
        sourceDuration = transcriptResult.segments[transcriptResult.segments.length - 1].endTime;
      }

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

    const filteredHighlights = filterHighlights(allHighlights, { threshold, targetDuration, maxCount });
    const totalHighlightDuration = filteredHighlights.reduce((sum, h) => sum + h.duration, 0);

    const extractResult: HighlightsExtractResult = {
      success: true,
      highlights: filteredHighlights,
      totalDuration: sourceDuration,
      totalHighlightDuration,
    };

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
    // A missing key is not a highlight failure; let the caller report it.
    if (error instanceof ApiKeyError) throw error;
    return highlightsFailure(failureFromError(error, "Highlight extraction failed"));
  }
}

/** Options for {@link executeAutoShorts}. */
export interface AutoShortsOptions {
  /** Path to the source video file */
  video: string;
  /** Output directory for generated short clips */
  outputDir?: string;
  /** Target duration per short in seconds (default: 60) */
  duration?: number;
  /** Number of shorts to generate (default: 1) */
  count?: number;
  /** Output aspect ratio (default: "9:16") */
  aspect?: "9:16" | "1:1";
  /** Add auto-generated captions to shorts */
  addCaptions?: boolean;
  /** Caption visual style preset */
  captionStyle?: "minimal" | "bold" | "animated";
  /** If true, only analyze without extracting clips */
  analyzeOnly?: boolean;
  /** Language code for transcription */
  language?: string;
  /** Transcription provider: auto (default), elevenlabs, openai */
  stt?: string;
  /** Use Gemini multimodal analysis instead of transcription + Claude */
  useGemini?: boolean;
  /** Use low-resolution mode for Gemini (longer videos) */
  lowRes?: boolean;
}

/** Result from {@link executeAutoShorts}. */
export interface AutoShortsResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Generated short clips with metadata */
  shorts: Array<{
    /** 1-based index */
    index: number;
    /** Start time in the source video (seconds) */
    startTime: number;
    /** End time in the source video (seconds) */
    endTime: number;
    /** Duration of the short (seconds) */
    duration: number;
    /** Confidence/virality score 0-1 */
    confidence: number;
    /** Why this moment was selected */
    reason: string;
    /** Path to the extracted clip (undefined in analyze-only mode) */
    outputPath?: string;
  }>;
  /** Error message on failure */
  error?: string;
  /** The structured error on failure; see {@link ExecutorFailure}. */
  failure?: StructuredError;
}

function autoShortsFailure(failure: StructuredError): AutoShortsResult {
  return { ...executorFailure(failure), shorts: [] };
}

/**
 * Auto-generate short-form vertical clips from a long-form video.
 *
 * Finds the best viral-worthy moments using transcription + Claude or Gemini analysis,
 * then extracts and crops them to the target aspect ratio using FFmpeg.
 *
 * @param options - Auto-shorts generation configuration
 * @returns Result with extracted short clips and metadata
 */
export async function executeAutoShorts(
  options: AutoShortsOptions
): Promise<AutoShortsResult> {
  try {
    if (!commandExists("ffmpeg")) {
      return autoShortsFailure(generalError("FFmpeg not found", "Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux). Run `vibe doctor` for details."));
    }

    const absPath = resolve(process.cwd(), options.video);
    if (!existsSync(absPath)) {
      return autoShortsFailure(notFoundError(absPath));
    }

    const targetDuration = options.duration ?? 60;
    const shortCount = options.count ?? 1;

    let highlights: Highlight[] = [];

    if (options.useGemini) {
      const geminiApiKey = await requireApiKey("GOOGLE_API_KEY", "Google");

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
        return autoShortsFailure(providerFailure("Gemini returned a highlights reply that could not be parsed", "provider"));
      }
    } else {
      const stt = await resolveSttProvider(options.stt);
      const claudeApiKey = await requireApiKey("ANTHROPIC_API_KEY", "Anthropic");

      const tempAudio = absPath.replace(/(\.[^.]+)$/, "-temp-audio.mp3");
      await execSafe("ffmpeg", ["-i", absPath, "-vn", "-acodec", "libmp3lame", "-q:a", "2", tempAudio, "-y"]);

      const transcript = await transcribeAudioFile(tempAudio, { ...stt, language: options.language });

      try {
        const { unlink: unlinkFile } = await import("node:fs/promises");
        await unlinkFile(tempAudio);
      } catch { /* ignore */ }

      if (transcript.status === "failed") {
        return autoShortsFailure(providerFailure(`Transcription failed: ${transcript.error}`, transcript.errorKind));
      }
      if (!transcript.segments || transcript.segments.length === 0) {
        return autoShortsFailure(generalError("No speech found to pick shorts from", "Try --use-gemini for visual analysis."));
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
      return autoShortsFailure(generalError("No highlights found"));
    }

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

      const { stdout: probeOut } = await execSafe("ffprobe", [
        "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", absPath,
      ]);
      const [width, height] = probeOut.trim().split(",").map(Number);

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
      await execSafe("ffmpeg", [
        "-ss", String(h.startTime), "-i", absPath, "-t", String(h.duration),
        "-vf", vf, "-c:a", "aac", "-b:a", "128k", outputPath, "-y",
      ], { timeout: 300000 });

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
    // A missing key is not an auto-shorts failure; let the caller report it.
    if (error instanceof ApiKeyError) throw error;
    return autoShortsFailure(failureFromError(error, "Auto shorts failed"));
  }
}

// ============================================================================
// CLI command registration
// ============================================================================

export function registerHighlightsCommands(aiCommand: Command): void {
  aiCommand
    .command("highlights")
    .description("Extract highlights from long-form video/audio content")
    .argument("<media>", "Video or audio file path")
    .option("-o, --output <path>", "Output JSON file with highlights")
    .option("--project <path>", "Create project with highlight clips")
    .option("-d, --duration <seconds>", "Target highlight reel duration", "60")
    .option("--count <number>", "Maximum number of highlights")
    .option("--threshold <value>", "Confidence threshold (0-1)", "0.7")
    .option("--criteria <type>", "Selection criteria: emotional | informative | funny | all", "all")
    .option("-l, --language <lang>", "Language code for transcription (e.g., en, ko)")
    .option("--stt <provider>", STT_OPTION_HELP, "auto")
    .option("--use-gemini", "Use Gemini Video Understanding for enhanced visual+audio analysis")
    .option("--low-res", "Use low resolution mode for longer videos (Gemini only)")
    .option("--dry-run", "Preview parameters without executing")
    .action(async (mediaPath: string, options) => {
      const startedAt = Date.now();
      try {
        if (options.output) {
          validateOutputPath(options.output);
        }

        const absPath = resolve(process.cwd(), mediaPath);
        if (!existsSync(absPath)) {
          exitWithError(notFoundError(absPath));
        }

        if (options.dryRun) {
          outputSuccess({
            command: "remix highlights",
            startedAt,
            dryRun: true,
            data: {
              params: {
                mediaPath,
                output: options.output,
                project: options.project,
                duration: options.duration,
                count: options.count,
                threshold: options.threshold,
                criteria: options.criteria,
                language: options.language,
                stt: sttOptionOrExit(options.stt),
                useGemini: options.useGemini ?? false,
                lowRes: options.lowRes ?? false,
              },
            },
          });
          return;
        }

        const ext = extname(absPath).toLowerCase();
        const videoExtensions = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"];
        const isVideo = videoExtensions.includes(ext);

        log();
        log(chalk.bold.cyan("🎬 Highlight Extraction Pipeline"));
        log(chalk.dim("─".repeat(60)));
        if (options.useGemini) {
          log(chalk.dim("Using Gemini Video Understanding (visual + audio analysis)"));
        } else {
          log(chalk.dim("Using transcription + Claude (audio-based analysis)"));
        }
        log();

        const targetDuration = options.duration ? parseFloat(options.duration) : undefined;
        const maxCount = options.count ? parseInt(options.count) : undefined;

        let allHighlights: Highlight[] = [];
        let sourceDuration = 0;

        if (options.useGemini && isVideo) {
          const geminiApiKey = await requireApiKey("GOOGLE_API_KEY", "Google");

          const durationSpinner = createSpinner("📊 Analyzing video metadata...").start();
          try {
            sourceDuration = await ffprobeDuration(absPath);
            durationSpinner.succeed(chalk.green(`Video duration: ${formatTime(sourceDuration)}`));
          } catch {
            durationSpinner.fail("Failed to get video duration");
            exitWithError(generalError("Failed to get video duration"));
          }

          const geminiSpinner = createSpinner("🎬 Analyzing video with Gemini (visual + audio)...").start();

          const gemini = new GeminiProvider();
          await gemini.initialize({ apiKey: geminiApiKey });
          const videoBuffer = await readFile(absPath);

          const criteriaText = options.criteria === "all"
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
            geminiSpinner.fail("Failed to parse Gemini response");
            exitWithError(providerFailure("Gemini returned a highlights reply that could not be parsed", "provider"));
          }

          geminiSpinner.succeed(chalk.green(`Found ${allHighlights.length} highlights via visual+audio analysis`));
        } else {
          const stt = await requireSttProvider(sttOptionOrExit(options.stt));

          const claudeApiKey = await requireApiKey("ANTHROPIC_API_KEY", "Anthropic");

          let audioPath = absPath;
          let tempAudioPath: string | null = null;

          if (isVideo) {
            const audioSpinner = createSpinner("🎵 Extracting audio from video...").start();
            try {
              if (!commandExists("ffmpeg")) {
                audioSpinner.fail("FFmpeg not found");
                exitWithError(generalError("FFmpeg not found. Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux). Run `vibe doctor` for details."));
              }

              const { stdout: probeOut } = await execSafe("ffprobe", [
                "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", absPath,
              ]);
              const hasAudio = probeOut.trim().length > 0;

              if (!hasAudio) {
                audioSpinner.fail("Video has no audio track");
                exitWithError(generalError("Video has no audio track - cannot transcribe it.", "Use --use-gemini flag for visual-only analysis of videos without audio."));
              } else {
                tempAudioPath = `/tmp/vibe_highlight_audio_${Date.now()}.wav`;
                await execSafe("ffmpeg", [
                  "-i", absPath, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", tempAudioPath, "-y",
                ], { maxBuffer: 50 * 1024 * 1024 });
                audioPath = tempAudioPath;
              }

              sourceDuration = await ffprobeDuration(absPath);

              if (hasAudio) {
                audioSpinner.succeed(chalk.green(`Extracted audio (${formatTime(sourceDuration)} total duration)`));
              }
            } catch (error) {
              audioSpinner.fail("Failed to extract audio");
              exitWithError(generalError(`Failed to extract audio: ${error instanceof Error ? error.message : String(error)}`));
            }
          }

          const transcribeSpinner = createSpinner(`📝 Transcribing with ${sttLabel(stt.provider)}...`).start();

          const transcriptResult = await transcribeAudioFile(audioPath, { ...stt, language: options.language });

          if (transcriptResult.status === "failed" || !transcriptResult.segments) {
            transcribeSpinner.fail("Transcription failed");
            if (tempAudioPath && existsSync(tempAudioPath)) {
              const { unlink: unlinkFile } = await import("node:fs/promises");
              await unlinkFile(tempAudioPath).catch(() => {});
            }
            exitWithError(providerFailure(`Transcription failed: ${transcriptResult.error}`, transcriptResult.errorKind));
          }

          transcribeSpinner.succeed(chalk.green(`Transcribed ${transcriptResult.segments.length} segments`));

          if (tempAudioPath && existsSync(tempAudioPath)) {
            const { unlink: unlinkFile } = await import("node:fs/promises");
            await unlinkFile(tempAudioPath).catch(() => {});
          }

          if (transcriptResult.segments.length > 0) {
            sourceDuration = transcriptResult.segments[transcriptResult.segments.length - 1].endTime;
          }

          const analyzeSpinner = createSpinner("🔍 Analyzing highlights with Claude...").start();

          const claude = new ClaudeProvider();
          await claude.initialize({ apiKey: claudeApiKey });

          allHighlights = await claude.analyzeForHighlights(transcriptResult.segments, {
            criteria: options.criteria as HighlightCriteria,
            targetDuration,
            maxCount,
          });

          if (allHighlights.length === 0) {
            analyzeSpinner.warn(chalk.yellow("No highlights detected in the content"));
          } else {
            analyzeSpinner.succeed(chalk.green(`Found ${allHighlights.length} potential highlights`));
          }
        }

        const threshold = parseFloat(options.threshold);

        if (allHighlights.length === 0) {
          log(chalk.yellow("No highlights detected in the content"));
          outputSuccess({
            command: "remix highlights",
            startedAt,
            warnings: ["No highlights detected in the content"],
            data: {
              sourceFile: absPath,
              totalDuration: sourceDuration,
              criteria: options.criteria,
              threshold,
              highlightsCount: 0,
              totalHighlightDuration: 0,
              highlights: [],
            },
          });
          return;
        }

        const filterSpinner = createSpinner("📊 Filtering and ranking...").start();
        const filteredHighlights = filterHighlights(allHighlights, { threshold, targetDuration, maxCount });
        const totalHighlightDuration = filteredHighlights.reduce((sum, h) => sum + h.duration, 0);

        filterSpinner.succeed(chalk.green(`Selected ${filteredHighlights.length} highlights (${totalHighlightDuration.toFixed(1)}s total)`));

        const result: HighlightsResult = {
          sourceFile: absPath,
          totalDuration: sourceDuration,
          criteria: options.criteria as HighlightCriteria,
          threshold,
          highlightsCount: filteredHighlights.length,
          totalHighlightDuration,
          highlights: filteredHighlights,
        };

        log();
        log(chalk.bold.cyan("Highlights Summary"));
        log(chalk.dim("─".repeat(60)));

        for (const highlight of filteredHighlights) {
          const startFormatted = formatTime(highlight.startTime);
          const endFormatted = formatTime(highlight.endTime);
          const confidencePercent = (highlight.confidence * 100).toFixed(0);
          const categoryColor = getCategoryColor(highlight.category);

          log();
          log(`  ${chalk.yellow(`${highlight.index}.`)} [${startFormatted} - ${endFormatted}] ${categoryColor(highlight.category)}, ${chalk.dim(`${confidencePercent}%`)}`);
          log(`     ${chalk.white(highlight.reason)}`);
          log(`     ${chalk.dim(truncate(highlight.transcript, 80))}`);
        }

        log();
        log(chalk.dim("─".repeat(60)));
        log(`Total: ${chalk.bold(filteredHighlights.length)} highlights, ${chalk.bold(totalHighlightDuration.toFixed(1))} seconds`);
        log();

        let outputPath: string | undefined;
        if (options.output) {
          outputPath = resolve(process.cwd(), options.output);
          await writeFile(outputPath, JSON.stringify(result, null, 2), "utf-8");
          log(chalk.green(`💾 Saved highlights to: ${outputPath}`));
        }

        let projectPath: string | undefined;
        if (options.project) {
          const projectSpinner = createSpinner("📦 Creating project...").start();
          const project = new Project("Highlight Reel");

          const source = project.addSource({
            name: basename(absPath),
            url: absPath,
            type: isVideo ? "video" : "audio",
            duration: sourceDuration,
          });

          const videoTrack = project.getTracks().find((t) => t.type === "video");
          if (!videoTrack) {
            projectSpinner.fail("Failed to create project");
            exitWithError(generalError("Failed to create project: no video track"));
          }

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

          projectPath = resolve(process.cwd(), options.project);
          await writeFile(projectPath, JSON.stringify(project.toJSON(), null, 2), "utf-8");
          projectSpinner.succeed(chalk.green(`Created project: ${projectPath}`));
        }

        log();
        log(chalk.bold.green("✅ Highlight extraction complete!"));
        log();

        outputSuccess({
          command: "remix highlights",
          startedAt,
          data: {
            ...result,
            ...(outputPath ? { outputPath } : {}),
            ...(projectPath ? { projectPath } : {}),
          },
        });
      } catch (error) {
        exitWithError(failureFromError(error, "Highlight extraction failed", { retryable: true }));
      }
    });

  aiCommand
    .command("auto-shorts")
    .alias("shorts")
    .description("Auto-generate shorts from long-form video")
    .argument("<video>", "Video file path")
    .option("-o, --output <path>", "Output file (single) or directory (multiple)")
    .option("-d, --duration <seconds>", "Target duration in seconds (15-60)", "60")
    .option("--count <number>", "Number of shorts to generate", "1")
    .option("-a, --aspect <ratio>", "Aspect ratio: 9:16, 1:1", "9:16")
    .option("--output-dir <dir>", "Output directory for multiple shorts")
    .option("--add-captions", "Add auto-generated captions")
    .option("--caption-style <style>", "Caption style: minimal, bold, animated", "bold")
    .option("--analyze-only", "Show segments without generating")
    .option("-l, --language <lang>", "Language code for transcription")
    .option("--stt <provider>", STT_OPTION_HELP, "auto")
    .option("--use-gemini", "Use Gemini Video Understanding for enhanced visual+audio analysis")
    .option("--low-res", "Use low resolution mode for longer videos (Gemini only)")
    .option("--dry-run", "Preview parameters without executing")
    .action(async (videoPath: string, options) => {
      const startedAt = Date.now();
      try {
        if (options.output) {
          validateOutputPath(options.output);
        }

        const absPath = resolve(process.cwd(), videoPath);
        if (!existsSync(absPath)) {
          exitWithError(notFoundError(absPath));
        }

        if (options.dryRun) {
          outputSuccess({
            command: "remix auto-shorts",
            startedAt,
            dryRun: true,
            data: {
              params: {
                videoPath,
                output: options.output,
                duration: options.duration,
                count: options.count,
                aspect: options.aspect,
                outputDir: options.outputDir,
                addCaptions: options.addCaptions ?? false,
                captionStyle: options.captionStyle,
                analyzeOnly: options.analyzeOnly ?? false,
                language: options.language,
                stt: sttOptionOrExit(options.stt),
                useGemini: options.useGemini ?? false,
                lowRes: options.lowRes ?? false,
              },
            },
          });
          return;
        }

        if (!commandExists("ffmpeg")) {
          exitWithError(generalError("FFmpeg not found. Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux). Run `vibe doctor` for details."));
        }

        const targetDuration = parseInt(options.duration);
        const shortCount = parseInt(options.count);

        log();
        log(chalk.bold.cyan("🎬 Auto Shorts Generator"));
        log(chalk.dim("─".repeat(60)));
        if (options.useGemini) {
          log(chalk.dim("Using Gemini Video Understanding (visual + audio analysis)"));
        } else {
          log(chalk.dim("Using transcription + Claude (audio-based analysis)"));
        }
        log();

        let highlights: Highlight[] = [];

        if (options.useGemini) {
          const geminiApiKey = await requireApiKey("GOOGLE_API_KEY", "Google");

          const spinner = createSpinner("🎬 Analyzing video with Gemini (visual + audio)...").start();
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
            spinner.fail("Failed to parse Gemini response");
            exitWithError(providerFailure("Gemini returned a highlights reply that could not be parsed", "provider"));
          }

          spinner.succeed(chalk.green(`Found ${highlights.length} potential shorts via visual+audio analysis`));
        } else {
          const stt = await requireSttProvider(sttOptionOrExit(options.stt));

          const claudeApiKey = await requireApiKey("ANTHROPIC_API_KEY", "Anthropic");

          const spinner = createSpinner("Extracting audio...").start();

          const { stdout: autoShortsProbe } = await execSafe("ffprobe", [
            "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", absPath,
          ]);
          if (!autoShortsProbe.trim()) {
            spinner.fail("Video has no audio track");
            exitWithError(generalError("Video has no audio track - cannot transcribe it.", "Use --use-gemini flag for visual-only analysis of videos without audio."));
          }

          const tempAudio = absPath.replace(/(\.[^.]+)$/, "-temp-audio.mp3");
          await execSafe("ffmpeg", ["-i", absPath, "-vn", "-acodec", "libmp3lame", "-q:a", "2", tempAudio, "-y"]);

          spinner.text = "Transcribing audio...";

          const transcript = await transcribeAudioFile(tempAudio, { ...stt, language: options.language });

          try {
            const { unlink: unlinkFile } = await import("node:fs/promises");
            await unlinkFile(tempAudio);
          } catch { /* ignore cleanup errors */ }

          if (transcript.status === "failed") {
            spinner.fail("Transcription failed");
            exitWithError(providerFailure(`Transcription failed: ${transcript.error}`, transcript.errorKind));
          }
          if (!transcript.segments || transcript.segments.length === 0) {
            spinner.fail("No speech found");
            exitWithError(generalError("No speech found to pick shorts from", "Try --use-gemini for visual analysis."));
          }

          spinner.text = "Finding highlights...";

          const claude = new ClaudeProvider();
          await claude.initialize({ apiKey: claudeApiKey });

          highlights = await claude.analyzeForHighlights(transcript.segments, {
            criteria: "all",
            targetDuration: targetDuration * shortCount,
            maxCount: shortCount * 3,
          });

          spinner.succeed(chalk.green(`Found ${highlights.length} potential highlights`));
        }

        if (highlights.length === 0) {
          exitWithError(generalError("No highlights found"));
        }

        highlights.sort((a, b) => b.confidence - a.confidence);
        const selectedHighlights = highlights.slice(0, shortCount);

        log(chalk.green(`Selected top ${selectedHighlights.length} for short generation`));
        log();
        log(chalk.bold.cyan("Auto Shorts"));
        log(chalk.dim("─".repeat(60)));
        log(`Target duration: ${targetDuration}s`);
        log(`Aspect ratio: ${options.aspect}`);
        log();

        for (let i = 0; i < selectedHighlights.length; i++) {
          const h = selectedHighlights[i];
          log(chalk.yellow(`[Short ${i + 1}] ${formatTime(h.startTime)} - ${formatTime(h.endTime)} (${h.duration.toFixed(1)}s)`));
          log(`  ${h.reason}`);
          log(chalk.dim(`  Confidence: ${(h.confidence * 100).toFixed(0)}%`));
        }
        log();

        const shortSegments = selectedHighlights.map((h) => ({
          startTime: h.startTime,
          endTime: h.endTime,
          duration: h.duration,
          confidence: h.confidence,
          reason: h.reason,
        }));

        if (options.analyzeOnly) {
          log(chalk.dim("Use without --analyze-only to generate shorts."));
          outputSuccess({
            command: "remix auto-shorts",
            startedAt,
            data: { analyzeOnly: true, targetDuration, aspect: options.aspect, shorts: shortSegments },
          });
          return;
        }

        const generated: Array<(typeof shortSegments)[number] & { outputPath: string }> = [];

        const outputDir = options.outputDir
          ? resolve(process.cwd(), options.outputDir)
          : dirname(absPath);

        if (options.outputDir && !existsSync(outputDir)) {
          await mkdir(outputDir, { recursive: true });
        }

        for (let i = 0; i < selectedHighlights.length; i++) {
          const h = selectedHighlights[i];
          const shortSpinner = createSpinner(`Generating short ${i + 1}/${selectedHighlights.length}...`).start();

          let outputPath: string;
          if (shortCount === 1 && options.output) {
            outputPath = resolve(process.cwd(), options.output);
            if (!extname(outputPath)) {
              outputPath += ".mp4";
            }
          } else {
            const baseName = basename(absPath, extname(absPath));
            outputPath = resolve(outputDir, `${baseName}-short-${i + 1}.mp4`);
          }

          const parentDir = dirname(outputPath);
          if (!existsSync(parentDir)) {
            await mkdir(parentDir, { recursive: true });
          }

          const { stdout: probeOut } = await execSafe("ffprobe", [
            "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", absPath,
          ]);
          const [width, height] = probeOut.trim().split(",").map(Number);

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

          const vf = `crop=${cropW}:${cropH}:${cropX}:${cropY}`;
          await execSafe("ffmpeg", [
            "-ss", String(h.startTime), "-i", absPath, "-t", String(h.duration),
            "-vf", vf, "-c:a", "aac", "-b:a", "128k", outputPath, "-y",
          ], { timeout: 300000 });
          shortSpinner.succeed(chalk.green(`Short ${i + 1}: ${outputPath}`));
          generated.push({ ...shortSegments[i], outputPath });
        }

        log();
        log(chalk.bold.green(`Generated ${selectedHighlights.length} short(s)`));
        log();

        outputSuccess({
          command: "remix auto-shorts",
          startedAt,
          data: {
            targetDuration,
            aspect: options.aspect,
            shorts: generated,
            ...(generated.length === 1 ? { outputPath: generated[0].outputPath } : {}),
          },
        });
      } catch (error) {
        exitWithError(failureFromError(error, "Auto shorts failed", { retryable: true }));
      }
    });
}
