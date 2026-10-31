/**
 * @module ai-highlights
 *
 * Highlight extraction and auto-shorts generation for long-form content.
 *
 * CLI commands: highlights, auto-shorts
 *
 * Execute functions (the CLI commands, the MCP tools, and any other caller
 * all run these):
 *   executeHighlights  - Extract best moments from video/audio (transcription + Claude, or Gemini)
 *   executeAutoShorts   - Generate short-form vertical clips from long-form video
 *
 * @dependencies ElevenLabs Scribe or OpenAI Whisper, Claude (Anthropic), Gemini (Google), FFmpeg
 */

import { Command } from "commander";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { resolve, dirname, basename, extname, join } from "node:path";
import { tmpdir } from "node:os";
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
import { execSafe, commandExists, ffprobeDuration, ffprobeHasAudio, ffprobeVideoSize } from "../utils/exec-safe.js";
import { executorFailure, failureFromError, providerFailure, spinner as createSpinner, exitWithError, log, outputSuccess, printWarnings, notFoundError, generalError, usageError, type StructuredError } from "./output.js";
import { validateOutputPath } from "./validate.js";
import {
  STT_OPTION_HELP,
  requireSttProvider,
  resolveSttProvider,
  sttLabel,
  sttOptionError,
  sttOptionOrExit,
  transcribeAudioFile,
} from "./_shared/transcription.js";

// ============================================================================
// Shared helpers
// ============================================================================

const VIDEO_EXTENSIONS = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"];
const DEFAULT_THRESHOLD = 0.7;

/** Whether `path` is a video by its extension. Gemini looks at videos; everything else is transcribed. */
export function isVideoPath(path: string): boolean {
  return VIDEO_EXTENSIONS.includes(extname(path).toLowerCase());
}

/**
 * Progress for a multi-step executor run. The CLI shows it as a spinner;
 * the MCP tools and other callers leave it out.
 */
export interface StepProgress {
  /** A step began. */
  start(text: string): void;
  /** The running step's text changed. */
  update(text: string): void;
  /** The running step finished. */
  succeed(text: string): void;
  /** The running step finished with nothing to show for it. */
  warn(text: string): void;
  /** The running step failed; the executor returns a failure next. */
  fail(text: string): void;
}

const NO_PROGRESS: StepProgress = {
  start: () => undefined,
  update: () => undefined,
  succeed: () => undefined,
  warn: () => undefined,
  fail: () => undefined,
};

function ffmpegMissingError(): StructuredError {
  return generalError("FFmpeg not found", "Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux). Run `vibe doctor` for details.");
}

/** A video without an audio stream cannot be transcribed; Gemini can still look at it. */
function noAudioTrackError(): StructuredError {
  return generalError("Video has no audio track - cannot transcribe it.", "Use --use-gemini flag for visual-only analysis of videos without audio.");
}

function audioExtractionError(error: unknown): StructuredError {
  return generalError(`Failed to extract audio: ${error instanceof Error ? error.message : String(error)}`);
}

/** The `highlights` array of a Gemini reply, bare or in a code fence. Throws when the reply is not JSON. */
function parseGeminiHighlights<T>(response: string): T[] {
  let jsonStr = response;
  const fenced = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) jsonStr = fenced[1];
  const object = jsonStr.match(/\{[\s\S]*"highlights"[\s\S]*\}/);
  if (object) jsonStr = object[0];
  const parsed = JSON.parse(jsonStr);
  return parsed.highlights && Array.isArray(parsed.highlights) ? parsed.highlights : [];
}

const HIGHLIGHT_CRITERIA = ["emotional", "informative", "funny", "all"] as const;

/** The usage error for an aspect ratio that is not `W:H` with positive whole numbers, or `undefined`. */
export function aspectRatioError(aspect: string): StructuredError | undefined {
  const match = /^(\d+):(\d+)$/.exec(aspect);
  if (match && Number(match[1]) > 0 && Number(match[2]) > 0) return undefined;
  return usageError(`Invalid aspect ratio: ${aspect}`, "Use W:H, for example 9:16 or 1:1.");
}

/** Captions are accepted for compatibility but not drawn yet; say so instead of dropping them silently. */
const CAPTIONS_NOT_ADDED = "Captions are not added yet: --add-captions and --caption-style are ignored.";

function geminiParseFailure(): StructuredError {
  return providerFailure("Gemini returned a highlights reply that could not be parsed", "provider");
}

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

/** The highlight report: what `--output` saves, and the `--json` data without the written paths. */
function highlightsReport(report: Omit<HighlightsResult, "highlightsCount">): HighlightsResult {
  return {
    sourceFile: report.sourceFile,
    totalDuration: report.totalDuration,
    criteria: report.criteria,
    threshold: report.threshold,
    highlightsCount: report.highlights.length,
    totalHighlightDuration: report.totalHighlightDuration,
    highlights: report.highlights,
  };
}

/** The crop that fills `aspect` (e.g. "9:16") from the centre of a `width`x`height` frame. */
function centerCrop(width: number, height: number, aspect: string): string {
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
  return `crop=${cropW}:${cropH}:${cropX}:${cropY}`;
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
// Exported execute functions
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
  /** Key for the transcription provider `stt` names (default: the configured key) */
  sttApiKey?: string;
  /** Anthropic key for the Claude analysis (default: the configured key) */
  anthropicApiKey?: string;
  /** Google key for Gemini analysis (default: the configured key) */
  googleApiKey?: string;
  /** Use Gemini multimodal analysis instead of transcription + Claude */
  useGemini?: boolean;
  /** Use low-resolution mode for Gemini (longer videos) */
  lowRes?: boolean;
  /** Step progress, for a spinner */
  progress?: StepProgress;
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

type Analysis = { highlights: Highlight[]; sourceDuration: number } | { failure: StructuredError };

/** Gemini looks at the whole video (picture and sound) and picks the highlights. */
async function geminiHighlights(absPath: string, options: HighlightsOptions, progress: StepProgress): Promise<Analysis> {
  const geminiApiKey = await requireApiKey("GOOGLE_API_KEY", "Google", options.googleApiKey);

  progress.start("📊 Analyzing video metadata...");
  let sourceDuration: number;
  try {
    sourceDuration = await ffprobeDuration(absPath);
  } catch {
    progress.fail("Failed to get video duration");
    return { failure: generalError("Failed to get video duration") };
  }
  progress.succeed(`Video duration: ${formatTime(sourceDuration)}`);

  progress.start("🎬 Analyzing video with Gemini (visual + audio)...");
  const gemini = new GeminiProvider();
  await gemini.initialize({ apiKey: geminiApiKey });
  const videoBuffer = await readFile(absPath);

  const criteriaText = options.criteria === "all" || !options.criteria
    ? "emotional, informative, and funny moments"
    : `${options.criteria} moments`;
  const durationText = options.duration ? `Target a total highlight duration of ${options.duration} seconds.` : "";
  const countText = options.count ? `Find up to ${options.count} highlights.` : "";

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

  let raw: Array<{ startTime: number; endTime: number; category?: string; confidence?: number; reason?: string; transcript?: string }>;
  try {
    raw = parseGeminiHighlights(result.response);
  } catch {
    progress.fail("Failed to parse Gemini response");
    return { failure: geminiParseFailure() };
  }
  const highlights = raw.map((h, i) => ({
    index: i + 1,
    startTime: h.startTime,
    endTime: h.endTime,
    duration: h.endTime - h.startTime,
    category: (h.category || "all") as Highlight["category"],
    confidence: h.confidence || 0.8,
    reason: h.reason || "Engaging moment",
    transcript: h.transcript || "",
  }));
  if (highlights.length === 0) {
    progress.warn("No highlights detected in the content");
  } else {
    progress.succeed(`Found ${highlights.length} highlights via visual+audio analysis`);
  }
  return { highlights, sourceDuration };
}

/** Transcribe the speech (Scribe or Whisper), then Claude picks the highlights from the transcript. */
async function transcriptHighlights(absPath: string, isVideo: boolean, options: HighlightsOptions, progress: StepProgress): Promise<Analysis> {
  const stt = await resolveSttProvider(options.stt, { apiKey: options.sttApiKey });
  const claudeApiKey = await requireApiKey("ANTHROPIC_API_KEY", "Anthropic", options.anthropicApiKey);

  let audioPath = absPath;
  let tempAudioPath: string | undefined;
  let sourceDuration = 0;
  try {
    if (isVideo) {
      progress.start("🎵 Extracting audio from video...");
      if (!commandExists("ffmpeg")) {
        progress.fail("FFmpeg not found");
        return { failure: ffmpegMissingError() };
      }
      try {
        if (!(await ffprobeHasAudio(absPath))) {
          progress.fail("Video has no audio track");
          return { failure: noAudioTrackError() };
        }
        tempAudioPath = join(tmpdir(), `vibe_highlight_audio_${Date.now()}.wav`);
        await execSafe("ffmpeg", [
          "-i", absPath, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", tempAudioPath, "-y",
        ], { maxBuffer: 50 * 1024 * 1024 });
        audioPath = tempAudioPath;
        sourceDuration = await ffprobeDuration(absPath);
      } catch (error) {
        progress.fail("Failed to extract audio");
        return { failure: audioExtractionError(error) };
      }
      progress.succeed(`Extracted audio (${formatTime(sourceDuration)} total duration)`);
    }

    progress.start(`📝 Transcribing with ${sttLabel(stt.provider)}...`);
    const transcript = await transcribeAudioFile(audioPath, { ...stt, language: options.language });
    if (transcript.status === "failed" || !transcript.segments) {
      progress.fail("Transcription failed");
      return { failure: providerFailure(`Transcription failed: ${transcript.error}`, transcript.errorKind) };
    }
    progress.succeed(`Transcribed ${transcript.segments.length} segments`);

    if (transcript.segments.length > 0) {
      sourceDuration = transcript.segments[transcript.segments.length - 1].endTime;
    }

    progress.start("🔍 Analyzing highlights with Claude...");
    const claude = new ClaudeProvider();
    await claude.initialize({ apiKey: claudeApiKey });
    const highlights = await claude.analyzeForHighlights(transcript.segments, {
      criteria: (options.criteria || "all") as HighlightCriteria,
      targetDuration: options.duration,
      maxCount: options.count,
    });
    if (highlights.length === 0) {
      progress.warn("No highlights detected in the content");
    } else {
      progress.succeed(`Found ${highlights.length} potential highlights`);
    }
    return { highlights, sourceDuration };
  } finally {
    if (tempAudioPath) await unlink(tempAudioPath).catch(() => undefined);
  }
}

/**
 * Extract the best highlights from a video or audio file.
 *
 * Supports two analysis backends:
 * - Transcription + Claude (default): transcribe audio (Scribe or Whisper), then analyze text for highlights
 * - Gemini (--useGemini): multimodal visual+audio analysis for richer detection
 *
 * A missing key throws {@link ApiKeyError}; every other failure comes back
 * as `success: false` with a structured `failure`.
 *
 * @param options - Highlight extraction configuration
 * @returns Result with filtered highlights sorted by time
 */
export async function executeHighlights(
  options: HighlightsOptions
): Promise<HighlightsExtractResult> {
  const progress = options.progress ?? NO_PROGRESS;
  try {
    const absPath = resolve(process.cwd(), options.media);
    if (!existsSync(absPath)) {
      return highlightsFailure(notFoundError(absPath));
    }
    const invalidStt = sttOptionError(options.stt);
    if (invalidStt) return highlightsFailure(invalidStt);

    const isVideo = isVideoPath(absPath);
    const threshold = options.threshold ?? DEFAULT_THRESHOLD;

    const analysis = options.useGemini && isVideo
      ? await geminiHighlights(absPath, options, progress)
      : await transcriptHighlights(absPath, isVideo, options, progress);
    if ("failure" in analysis) return highlightsFailure(analysis.failure);
    const { sourceDuration } = analysis;

    if (analysis.highlights.length === 0) {
      return { success: true, highlights: [], totalDuration: sourceDuration, totalHighlightDuration: 0 };
    }

    const filteredHighlights = filterHighlights(analysis.highlights, { threshold, targetDuration: options.duration, maxCount: options.count });
    const totalHighlightDuration = filteredHighlights.reduce((sum, h) => sum + h.duration, 0);

    const extractResult: HighlightsExtractResult = {
      success: true,
      highlights: filteredHighlights,
      totalDuration: sourceDuration,
      totalHighlightDuration,
    };

    if (options.output) {
      const outputPath = resolve(process.cwd(), options.output);
      const report = highlightsReport({
        sourceFile: absPath,
        totalDuration: sourceDuration,
        criteria: options.criteria || "all",
        threshold,
        totalHighlightDuration,
        highlights: filteredHighlights,
      });
      await writeFile(outputPath, JSON.stringify(report, null, 2), "utf-8");
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
      if (!videoTrack) {
        return highlightsFailure(generalError("Failed to create project: no video track"));
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

      const projectPath = resolve(process.cwd(), options.project);
      await writeFile(projectPath, JSON.stringify(project.toJSON(), null, 2), "utf-8");
      extractResult.projectPath = projectPath;
    }

    return extractResult;
  } catch (error) {
    // A missing key is not a highlight failure; let the caller report it.
    if (error instanceof ApiKeyError) throw error;
    // Provider failures carry an error kind; anything else is local (FFmpeg, files).
    return highlightsFailure(failureFromError(error, "Highlight extraction failed", { fallback: "general" }));
  }
}

/** One short picked by {@link executeAutoShorts}. */
export interface AutoShort {
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
}

/** Options for {@link executeAutoShorts}. */
export interface AutoShortsOptions {
  /** Path to the source video file */
  video: string;
  /**
   * Output file for a single short (".mp4" is added when it has no
   * extension), or the directory for several when `outputDir` is not set
   */
  output?: string;
  /** Output directory for generated short clips (default: the source video's folder) */
  outputDir?: string;
  /** Target duration per short in seconds (default: 60) */
  duration?: number;
  /** Number of shorts to generate (default: 1) */
  count?: number;
  /** Output aspect ratio as W:H (default: "9:16") */
  aspect?: string;
  /** Captions are not drawn yet; asking for them adds a warning */
  addCaptions?: boolean;
  /** Caption visual style preset (not used yet) */
  captionStyle?: "minimal" | "bold" | "animated";
  /** If true, only analyze without extracting clips */
  analyzeOnly?: boolean;
  /** Language code for transcription */
  language?: string;
  /** Transcription provider: auto (default), elevenlabs, openai */
  stt?: string;
  /** Key for the transcription provider `stt` names (default: the configured key) */
  sttApiKey?: string;
  /** Anthropic key for the Claude analysis (default: the configured key) */
  anthropicApiKey?: string;
  /** Google key for Gemini analysis (default: the configured key) */
  googleApiKey?: string;
  /** Use Gemini multimodal analysis instead of transcription + Claude */
  useGemini?: boolean;
  /** Use low-resolution mode for Gemini (longer videos) */
  lowRes?: boolean;
  /** Step progress, for a spinner */
  progress?: StepProgress;
  /** Called once the shorts are picked, before any clip is cut */
  onSelected?: (shorts: AutoShort[]) => void;
}

/** Result from {@link executeAutoShorts}. */
export interface AutoShortsResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Generated short clips with metadata */
  shorts: AutoShort[];
  /** Non-fatal notes for the caller, such as options that had no effect */
  warnings?: string[];
  /** Error message on failure */
  error?: string;
  /** The structured error on failure; see {@link ExecutorFailure}. */
  failure?: StructuredError;
}

function autoShortsFailure(failure: StructuredError): AutoShortsResult {
  return { ...executorFailure(failure), shorts: [] };
}

/** Gemini looks at the whole video (picture and sound) and picks candidate shorts. */
async function geminiShortCandidates(absPath: string, targetDuration: number, shortCount: number, options: AutoShortsOptions, progress: StepProgress): Promise<Highlight[] | StructuredError> {
  const geminiApiKey = await requireApiKey("GOOGLE_API_KEY", "Google", options.googleApiKey);

  progress.start("🎬 Analyzing video with Gemini (visual + audio)...");
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

  let raw: Array<{ startTime: number; endTime: number; confidence?: number; hookQuality?: number; reason?: string }>;
  try {
    raw = parseGeminiHighlights(result.response);
  } catch {
    progress.fail("Failed to parse Gemini response");
    return geminiParseFailure();
  }
  const highlights = raw.map((h, i) => ({
    index: i + 1,
    startTime: h.startTime,
    endTime: h.endTime,
    duration: h.endTime - h.startTime,
    category: "viral" as Highlight["category"],
    confidence: h.confidence || 0.8,
    reason: h.reason || "Engaging moment",
    transcript: "",
  }));
  progress.succeed(`Found ${highlights.length} potential shorts via visual+audio analysis`);
  return highlights;
}

/** Transcribe the speech (Scribe or Whisper), then Claude picks candidate shorts from the transcript. */
async function transcriptShortCandidates(absPath: string, targetDuration: number, shortCount: number, options: AutoShortsOptions, progress: StepProgress): Promise<Highlight[] | StructuredError> {
  const stt = await resolveSttProvider(options.stt, { apiKey: options.sttApiKey });
  const claudeApiKey = await requireApiKey("ANTHROPIC_API_KEY", "Anthropic", options.anthropicApiKey);

  progress.start("Extracting audio...");
  // In the temp dir, never next to the source: that folder may be read-only.
  const tempAudio = join(tmpdir(), `vibe_shorts_audio_${Date.now()}.mp3`);
  try {
    try {
      if (!(await ffprobeHasAudio(absPath))) {
        progress.fail("Video has no audio track");
        return noAudioTrackError();
      }
      await execSafe("ffmpeg", ["-i", absPath, "-vn", "-acodec", "libmp3lame", "-q:a", "2", tempAudio, "-y"]);
    } catch (error) {
      progress.fail("Failed to extract audio");
      return audioExtractionError(error);
    }

    progress.update("Transcribing audio...");
    const transcript = await transcribeAudioFile(tempAudio, { ...stt, language: options.language });
    if (transcript.status === "failed") {
      progress.fail("Transcription failed");
      return providerFailure(`Transcription failed: ${transcript.error}`, transcript.errorKind);
    }
    if (!transcript.segments || transcript.segments.length === 0) {
      progress.fail("No speech found");
      return generalError("No speech found to pick shorts from", "Try --use-gemini for visual analysis.");
    }

    progress.update("Finding highlights...");
    const claude = new ClaudeProvider();
    await claude.initialize({ apiKey: claudeApiKey });
    const highlights = await claude.analyzeForHighlights(transcript.segments, {
      criteria: "all",
      targetDuration: targetDuration * shortCount,
      maxCount: shortCount * 3,
    });
    progress.succeed(`Found ${highlights.length} potential highlights`);
    return highlights;
  } finally {
    await unlink(tempAudio).catch(() => undefined);
  }
}

/**
 * Auto-generate short-form vertical clips from a long-form video.
 *
 * Finds the best viral-worthy moments using transcription + Claude or Gemini analysis,
 * then extracts and crops them to the target aspect ratio using FFmpeg.
 *
 * A missing key throws {@link ApiKeyError}; every other failure comes back
 * as `success: false` with a structured `failure`.
 *
 * @param options - Auto-shorts generation configuration
 * @returns Result with extracted short clips and metadata
 */
export async function executeAutoShorts(
  options: AutoShortsOptions
): Promise<AutoShortsResult> {
  const progress = options.progress ?? NO_PROGRESS;
  try {
    if (!commandExists("ffmpeg")) {
      return autoShortsFailure(ffmpegMissingError());
    }

    const absPath = resolve(process.cwd(), options.video);
    if (!existsSync(absPath)) {
      return autoShortsFailure(notFoundError(absPath));
    }
    const invalidStt = sttOptionError(options.stt);
    if (invalidStt) return autoShortsFailure(invalidStt);

    const targetDuration = options.duration ?? 60;
    const shortCount = options.count ?? 1;
    const aspect = options.aspect || "9:16";
    const invalidAspect = aspectRatioError(aspect);
    if (invalidAspect) return autoShortsFailure(invalidAspect);
    const warnings = options.addCaptions ? [CAPTIONS_NOT_ADDED] : [];

    const candidates = options.useGemini
      ? await geminiShortCandidates(absPath, targetDuration, shortCount, options, progress)
      : await transcriptShortCandidates(absPath, targetDuration, shortCount, options, progress);
    if (!Array.isArray(candidates)) return autoShortsFailure(candidates);

    if (candidates.length === 0) {
      return autoShortsFailure(generalError("No highlights found"));
    }

    candidates.sort((a, b) => b.confidence - a.confidence);
    const shorts: AutoShort[] = candidates.slice(0, shortCount).map((h, i) => ({
      index: i + 1,
      startTime: h.startTime,
      endTime: h.endTime,
      duration: h.duration,
      confidence: h.confidence,
      reason: h.reason,
    }));
    options.onSelected?.(shorts);

    if (options.analyzeOnly) {
      return { success: true, shorts, ...(warnings.length ? { warnings } : {}) };
    }

    const dirOption = options.outputDir ?? (shortCount > 1 ? options.output : undefined);
    const outputDir = dirOption ? resolve(process.cwd(), dirOption) : dirname(absPath);

    const { width, height } = await ffprobeVideoSize(absPath);
    const vf = centerCrop(width, height, aspect);
    const generated: AutoShort[] = [];

    for (const short of shorts) {
      progress.start(`Generating short ${short.index}/${shorts.length}...`);

      let outputPath: string;
      if (shortCount === 1 && options.output) {
        outputPath = resolve(process.cwd(), options.output);
        if (!extname(outputPath)) {
          outputPath += ".mp4";
        }
      } else {
        outputPath = resolve(outputDir, `${basename(absPath, extname(absPath))}-short-${short.index}.mp4`);
      }
      await mkdir(dirname(outputPath), { recursive: true });

      await execSafe("ffmpeg", [
        "-ss", String(short.startTime), "-i", absPath, "-t", String(short.duration),
        "-vf", vf, "-c:a", "aac", "-b:a", "128k", outputPath, "-y",
      ], { timeout: 300000 });
      progress.succeed(`Short ${short.index}: ${outputPath}`);

      generated.push({ ...short, outputPath });
    }

    return { success: true, shorts: generated, ...(warnings.length ? { warnings } : {}) };
  } catch (error) {
    // A missing key is not an auto-shorts failure; let the caller report it.
    if (error instanceof ApiKeyError) throw error;
    // Provider failures carry an error kind; anything else is local (FFmpeg, files).
    return autoShortsFailure(failureFromError(error, "Auto shorts failed", { fallback: "general" }));
  }
}

// ============================================================================
// CLI command registration
// ============================================================================

/** Executor progress as a terminal spinner (silent in --json / --quiet). */
function spinnerProgress(): StepProgress {
  let current: ReturnType<typeof createSpinner> | undefined;
  const finish = (end: (spinner: ReturnType<typeof createSpinner>) => void) => {
    if (current) end(current);
    current = undefined;
  };
  return {
    start: (text) => {
      current = createSpinner(text).start();
    },
    update: (text) => {
      if (current) current.text = text;
    },
    succeed: (text) => finish((s) => s.succeed(chalk.green(text))),
    warn: (text) => finish((s) => s.warn(chalk.yellow(text))),
    fail: (text) => finish((s) => s.fail(text)),
  };
}

/** {@link validateOutputPath} for an option: a path that escapes the working directory is a usage error. */
function outputPathOrExit(path: string): void {
  try {
    validateOutputPath(path);
  } catch (error) {
    exitWithError(usageError(error instanceof Error ? error.message : String(error)));
  }
}

/** A numeric option value; anything else exits with a usage error before work starts. */
function numberOption(value: string, flag: string, rule: "positive" | "count" | "fraction"): number {
  const n = Number(value);
  const valid = Number.isFinite(n) && (rule === "fraction" ? n >= 0 && n <= 1 : n > 0 && (rule === "positive" || Number.isInteger(n)));
  if (!valid) {
    const expected = rule === "fraction" ? "a number from 0 to 1" : rule === "count" ? "a positive whole number" : "a positive number";
    exitWithError(usageError(`Invalid ${flag}: ${value}`, `${flag} must be ${expected}.`));
  }
  return n;
}

/**
 * Resolve the keys a transcription + Claude run needs, asking for them in a
 * terminal, so a missing one fails before any work starts.
 */
async function transcriptionKeys(sttOption: string | undefined): Promise<{ stt: string; sttApiKey: string; anthropicApiKey: string }> {
  const stt = await requireSttProvider(sttOptionOrExit(sttOption));
  const anthropicApiKey = await requireApiKey("ANTHROPIC_API_KEY", "Anthropic");
  return { stt: stt.provider, sttApiKey: stt.apiKey, anthropicApiKey };
}

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
        if (options.output) outputPathOrExit(options.output);

        const absPath = resolve(process.cwd(), mediaPath);
        if (!existsSync(absPath)) {
          exitWithError(notFoundError(absPath));
        }

        // Validate before the dry run, so a plan never echoes values a real run would reject.
        const sttName = sttOptionOrExit(options.stt);
        const targetDuration = options.duration ? numberOption(options.duration, "--duration", "positive") : undefined;
        const maxCount = options.count ? numberOption(options.count, "--count", "count") : undefined;
        const threshold = numberOption(options.threshold, "--threshold", "fraction");
        const criteria = HIGHLIGHT_CRITERIA.find((c) => c === options.criteria);
        if (!criteria) {
          exitWithError(usageError(`Invalid --criteria: ${options.criteria}`, `Valid: ${HIGHLIGHT_CRITERIA.join(", ")}`));
        }
        const useGemini = Boolean(options.useGemini) && isVideoPath(absPath);

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
                stt: sttName,
                useGemini: options.useGemini ?? false,
                lowRes: options.lowRes ?? false,
              },
            },
          });
          return;
        }

        log();
        log(chalk.bold.cyan("🎬 Highlight Extraction Pipeline"));
        log(chalk.dim("─".repeat(60)));
        if (useGemini) {
          log(chalk.dim("Using Gemini Video Understanding (visual + audio analysis)"));
        } else if (options.useGemini) {
          log(chalk.dim("Using transcription + Claude (audio-based analysis; --use-gemini needs a video)"));
        } else {
          log(chalk.dim("Using transcription + Claude (audio-based analysis)"));
        }
        log();

        const keys = useGemini
          ? { googleApiKey: await requireApiKey("GOOGLE_API_KEY", "Google") }
          : await transcriptionKeys(sttName);

        const result = await executeHighlights({
          media: mediaPath,
          output: options.output,
          project: options.project,
          duration: targetDuration,
          count: maxCount,
          threshold,
          criteria,
          language: options.language,
          useGemini: options.useGemini,
          lowRes: options.lowRes,
          ...keys,
          progress: spinnerProgress(),
        });
        if (!result.success) {
          exitWithError(result.failure ?? generalError(result.error ?? "Highlight extraction failed"));
        }

        const report = highlightsReport({
          sourceFile: absPath,
          totalDuration: result.totalDuration,
          criteria,
          threshold,
          totalHighlightDuration: result.totalHighlightDuration,
          highlights: result.highlights,
        });

        if (result.highlights.length === 0) {
          // The analysis step already said so on the spinner.
          outputSuccess({
            command: "remix highlights",
            startedAt,
            warnings: ["No highlights detected in the content"],
            data: { ...report },
          });
          return;
        }

        createSpinner("📊 Filtering and ranking...").start()
          .succeed(chalk.green(`Selected ${result.highlights.length} highlights (${result.totalHighlightDuration.toFixed(1)}s total)`));

        log();
        log(chalk.bold.cyan("Highlights Summary"));
        log(chalk.dim("─".repeat(60)));

        for (const highlight of result.highlights) {
          const startFormatted = formatTime(highlight.startTime);
          const endFormatted = formatTime(highlight.endTime);
          const confidencePercent = (highlight.confidence * 100).toFixed(0);
          const categoryColor = getCategoryColor(highlight.category);

          log();
          log(`  ${chalk.yellow(`${highlight.index}.`)} [${startFormatted} - ${endFormatted}] ${categoryColor(highlight.category)}, ${chalk.dim(`${confidencePercent}%`)}`);
          log(`     ${chalk.white(highlight.reason)}`);
          if (highlight.transcript) log(`     ${chalk.dim(truncate(highlight.transcript, 80))}`);
        }

        log();
        log(chalk.dim("─".repeat(60)));
        log(`Total: ${chalk.bold(result.highlights.length)} highlights, ${chalk.bold(result.totalHighlightDuration.toFixed(1))} seconds`);
        log();

        if (result.outputPath) {
          log(chalk.green(`💾 Saved highlights to: ${result.outputPath}`));
        }
        if (result.projectPath) {
          createSpinner("📦 Creating project...").start().succeed(chalk.green(`Created project: ${result.projectPath}`));
        }
        if (result.outputPath || result.projectPath) log();

        log(chalk.bold.green("✅ Highlight extraction complete!"));
        log();

        outputSuccess({
          command: "remix highlights",
          startedAt,
          data: {
            ...report,
            ...(result.outputPath ? { outputPath: result.outputPath } : {}),
            ...(result.projectPath ? { projectPath: result.projectPath } : {}),
          },
        });
      } catch (error) {
        exitWithError(failureFromError(error, "Highlight extraction failed"));
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
    .option("--add-captions", "Add auto-generated captions (not implemented yet: ignored with a warning)")
    .option("--caption-style <style>", "Caption style: minimal, bold, animated (not implemented yet)", "bold")
    .option("--analyze-only", "Show segments without generating")
    .option("-l, --language <lang>", "Language code for transcription")
    .option("--stt <provider>", STT_OPTION_HELP, "auto")
    .option("--use-gemini", "Use Gemini Video Understanding for enhanced visual+audio analysis")
    .option("--low-res", "Use low resolution mode for longer videos (Gemini only)")
    .option("--dry-run", "Preview parameters without executing")
    .action(async (videoPath: string, options) => {
      const startedAt = Date.now();
      try {
        if (options.output) outputPathOrExit(options.output);

        const absPath = resolve(process.cwd(), videoPath);
        if (!existsSync(absPath)) {
          exitWithError(notFoundError(absPath));
        }

        // Validate before the dry run, so a plan never echoes values a real run would reject.
        const sttName = sttOptionOrExit(options.stt);
        const targetDuration = numberOption(options.duration, "--duration", "positive");
        const shortCount = numberOption(options.count, "--count", "count");
        const invalidAspect = aspectRatioError(options.aspect);
        if (invalidAspect) exitWithError(invalidAspect);

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
                stt: sttName,
                useGemini: options.useGemini ?? false,
                lowRes: options.lowRes ?? false,
              },
            },
          });
          return;
        }

        log();
        log(chalk.bold.cyan("🎬 Auto Shorts Generator"));
        log(chalk.dim("─".repeat(60)));
        if (options.useGemini) {
          log(chalk.dim("Using Gemini Video Understanding (visual + audio analysis)"));
        } else {
          log(chalk.dim("Using transcription + Claude (audio-based analysis)"));
        }
        log();

        const keys = options.useGemini
          ? { googleApiKey: await requireApiKey("GOOGLE_API_KEY", "Google") }
          : await transcriptionKeys(sttName);

        const result = await executeAutoShorts({
          video: videoPath,
          output: options.output,
          outputDir: options.outputDir,
          duration: targetDuration,
          count: shortCount,
          aspect: options.aspect,
          addCaptions: options.addCaptions,
          captionStyle: options.captionStyle,
          analyzeOnly: options.analyzeOnly,
          language: options.language,
          useGemini: options.useGemini,
          lowRes: options.lowRes,
          ...keys,
          progress: spinnerProgress(),
          onSelected: (shorts) => {
            log(chalk.green(`Selected top ${shorts.length} for short generation`));
            log();
            log(chalk.bold.cyan("Auto Shorts"));
            log(chalk.dim("─".repeat(60)));
            log(`Target duration: ${targetDuration}s`);
            log(`Aspect ratio: ${options.aspect}`);
            log();
            for (const short of shorts) {
              log(chalk.yellow(`[Short ${short.index}] ${formatTime(short.startTime)} - ${formatTime(short.endTime)} (${short.duration.toFixed(1)}s)`));
              log(`  ${short.reason}`);
              log(chalk.dim(`  Confidence: ${(short.confidence * 100).toFixed(0)}%`));
            }
            log();
          },
        });
        if (!result.success) {
          exitWithError(result.failure ?? generalError(result.error ?? "Auto shorts failed"));
        }
        const warnings = result.warnings ?? [];

        const shorts = result.shorts.map((short) => ({
          startTime: short.startTime,
          endTime: short.endTime,
          duration: short.duration,
          confidence: short.confidence,
          reason: short.reason,
          ...(short.outputPath ? { outputPath: short.outputPath } : {}),
        }));

        if (options.analyzeOnly) {
          log(chalk.dim("Use without --analyze-only to generate shorts."));
          printWarnings(warnings);
          outputSuccess({
            command: "remix auto-shorts",
            startedAt,
            warnings,
            data: { analyzeOnly: true, targetDuration, aspect: options.aspect, shorts },
          });
          return;
        }

        log();
        log(chalk.bold.green(`Generated ${shorts.length} short(s)`));
        log();
        printWarnings(warnings);

        outputSuccess({
          command: "remix auto-shorts",
          startedAt,
          warnings,
          data: {
            targetDuration,
            aspect: options.aspect,
            shorts,
            ...(shorts.length === 1 ? { outputPath: shorts[0].outputPath } : {}),
          },
        });
      } catch (error) {
        exitWithError(failureFromError(error, "Auto shorts failed"));
      }
    });
}
