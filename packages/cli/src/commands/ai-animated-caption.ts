/**
 * @module ai-animated-caption
 * @description Animated caption pipeline — word-by-word TikTok/Reels-style captions.
 *
 * Pipeline: Video → FFmpeg audio extract → Whisper word-level transcribe
 *   → Word grouping → Style routing (ASS fast tier / Remotion tier) → Output MP4
 *
 * ## Commands: vibe pipeline animated-caption
 * ## Dependencies: Whisper (OpenAI), FFmpeg, Remotion (optional)
 * @see MODELS.md for AI model configuration
 */

import { resolve, dirname, basename } from "node:path";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { transcribeWithWords } from "./ai-edit.js";
import { requireApiKey } from "../utils/api-key.js";
import { execSafe, ffprobeVideoSize, ffprobeDuration } from "../utils/exec-safe.js";
import {
  generateAnimatedCaptionComponent,
  renderWithEmbeddedVideo,
} from "../utils/remotion.js";

// ── Types ─────────────────────────────────────────────────────────────────

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface WordGroup {
  words: WordTiming[];
  startTime: number;
  endTime: number;
  text: string;
}

export type AnimatedCaptionStyle =
  | "highlight"
  | "bounce"
  | "pop-in"
  | "neon"
  | "karaoke-sweep"
  | "typewriter";

const ASS_STYLES: AnimatedCaptionStyle[] = ["karaoke-sweep", "typewriter"];

export interface AnimatedCaptionOptions {
  videoPath: string;
  outputPath: string;
  style: AnimatedCaptionStyle;
  highlightColor: string;
  fontSize?: number;
  position: "top" | "center" | "bottom";
  wordsPerGroup?: number;
  maxChars?: number;
  language?: string;
  fast?: boolean;
}

export interface AnimatedCaptionResult {
  success: boolean;
  outputPath?: string;
  wordCount?: number;
  groupCount?: number;
  style?: string;
  tier?: "ass" | "remotion";
  error?: string;
}

// ── Word Grouping ─────────────────────────────────────────────────────────

const SENTENCE_BREAKS = /[.!?]/;
const CLAUSE_BREAKS = /[,;:]/;
const LONG_PAUSE_THRESHOLD = 0.5; // seconds

/**
 * Group words into display groups for animated captions.
 * Groups by natural sentence boundaries, pauses, and word/char limits.
 */
export function groupWords(
  words: WordTiming[],
  options: { wordsPerGroup?: number; maxChars?: number } = {},
): WordGroup[] {
  if (words.length === 0) return [];

  const targetWords = options.wordsPerGroup ?? 4;
  const maxChars = options.maxChars ?? 40;
  const groups: WordGroup[] = [];
  let current: WordTiming[] = [];

  function flush() {
    if (current.length === 0) return;
    groups.push({
      words: [...current],
      startTime: current[0].start,
      endTime: current[current.length - 1].end,
      text: current.map((w) => w.word).join(" "),
    });
    current = [];
  }

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    current.push(word);

    const currentText = current.map((w) => w.word).join(" ");
    const nextWord = words[i + 1];

    // Force split: max chars exceeded
    if (currentText.length >= maxChars) {
      flush();
      continue;
    }

    // Sentence-ending punctuation
    if (SENTENCE_BREAKS.test(word.word)) {
      flush();
      continue;
    }

    // Long pause before next word
    if (nextWord && nextWord.start - word.end > LONG_PAUSE_THRESHOLD) {
      flush();
      continue;
    }

    // Clause break at target word count
    if (current.length >= targetWords && CLAUSE_BREAKS.test(word.word)) {
      flush();
      continue;
    }

    // Reached target + 1 words without a break — flush at target
    if (current.length >= targetWords + 1) {
      flush();
      continue;
    }
  }

  flush();
  return groups;
}

// ── ASS Subtitle Generator ───────────────────────────────────────────────

function colorToASS(hex: string): string {
  // Convert #RRGGBB to &HBBGGRR& (ASS format)
  const r = hex.slice(1, 3);
  const g = hex.slice(3, 5);
  const b = hex.slice(5, 7);
  return `&H00${b}${g}${r}&`;
}

function secondsToCentiseconds(s: number): number {
  return Math.round(s * 100);
}

function formatASSTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

/**
 * Generate ASS subtitle content for fast-tier animated captions.
 */
export function generateASS(
  groups: WordGroup[],
  style: "karaoke-sweep" | "typewriter",
  options: {
    highlightColor: string;
    fontSize: number;
    position: string;
    width: number;
    height: number;
  },
): string {
  const assColor = colorToASS(options.highlightColor);
  // ASS alignment: 8 = top-center, 5 = center, 2 = bottom-center
  const alignment = options.position === "top" ? 8 : options.position === "center" ? 5 : 2;
  const marginV = options.position === "center" ? 0 : 40;

  const header = `[Script Info]
Title: Animated Captions
ScriptType: v4.00+
PlayResX: ${options.width}
PlayResY: ${options.height}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${options.fontSize},&H00FFFFFF,${assColor},&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,${alignment},20,20,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events: string[] = [];

  for (const group of groups) {
    const start = formatASSTime(group.startTime);
    const end = formatASSTime(group.endTime);

    if (style === "karaoke-sweep") {
      // Build karaoke tags: \kf<duration_cs> for each word
      let text = "";
      for (const word of group.words) {
        const durationCs = secondsToCentiseconds(word.end - word.start);
        text += `{\\kf${durationCs}}${word.word} `;
      }
      events.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text.trim()}`);
    } else {
      // typewriter: each word fades in sequentially
      for (let i = 0; i < group.words.length; i++) {
        const word = group.words[i];
        const wordStart = formatASSTime(word.start);
        // Show all accumulated words up to this point
        const accumulatedText = group.words
          .slice(0, i + 1)
          .map((w) => w.word)
          .join(" ");
        const fadeMs = 100;
        events.push(
          `Dialogue: 0,${wordStart},${end},Default,,0,0,0,,{\\fad(${fadeMs},0)}${accumulatedText}`,
        );
      }
    }
  }

  return header + events.join("\n") + "\n";
}

// ── Execute Function ──────────────────────────────────────────────────────

export async function executeAnimatedCaption(
  options: AnimatedCaptionOptions,
): Promise<AnimatedCaptionResult> {
  const {
    videoPath,
    outputPath,
    style,
    highlightColor,
    fontSize,
    position,
    wordsPerGroup,
    maxChars,
    language,
    fast,
  } = options;

  // Determine tier
  const isASSTier = fast || ASS_STYLES.includes(style);
  const effectiveStyle = isASSTier && !ASS_STYLES.includes(style) ? "karaoke-sweep" : style;
  const tier = isASSTier ? "ass" : "remotion";
  // A missing key throws ApiKeyError (API_KEY_MISSING), outside the catch below.
  const apiKey = await requireApiKey("OPENAI_API_KEY", "OpenAI");

  try {
    // 1. Get video info
    const [dims, duration] = await Promise.all([
      ffprobeVideoSize(videoPath),
      ffprobeDuration(videoPath),
    ]);
    const width = dims.width;
    const height = dims.height;

    // Get FPS via ffprobe
    let videoFps = 30;
    try {
      const { stdout: fpsOut } = await execSafe("ffprobe", [
        "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=r_frame_rate",
        "-of", "csv=p=0", videoPath,
      ]);
      const [num, den] = fpsOut.trim().split("/").map(Number);
      if (num && den) videoFps = Math.round(num / den);
    } catch {
      // fallback to 30 fps
    }

    // Auto font size: ~4% of height
    const effectiveFontSize = fontSize ?? Math.round(height * 0.04);

    // 2. Extract audio
    const tmpAudioDir = resolve(tmpdir(), `vf-ac-${Date.now()}`);
    await mkdir(tmpAudioDir, { recursive: true });
    const audioPath = resolve(tmpAudioDir, "audio.wav");

    await execSafe("ffmpeg", [
      "-y", "-i", videoPath,
      "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
      audioPath,
    ], { timeout: 120_000 });

    // 3. Transcribe with word-level timestamps
    const transcript = await transcribeWithWords(audioPath, apiKey, language);
    if (!transcript.words || transcript.words.length === 0) {
      await rm(tmpAudioDir, { recursive: true, force: true }).catch(() => {});
      return { success: false, error: "No words detected in transcription" };
    }

    // 4. Group words
    const groups = groupWords(transcript.words, { wordsPerGroup, maxChars });

    // 5. Route by tier
    const absOutputPath = resolve(process.cwd(), outputPath);
    const outDir = dirname(absOutputPath);
    if (!existsSync(outDir)) {
      await mkdir(outDir, { recursive: true });
    }

    if (tier === "ass") {
      // ASS tier: generate .ass file → FFmpeg subtitles filter
      const assContent = generateASS(
        groups,
        effectiveStyle as "karaoke-sweep" | "typewriter",
        { highlightColor, fontSize: effectiveFontSize, position, width, height },
      );
      const assPath = resolve(tmpAudioDir, "captions.ass");
      await writeFile(assPath, assContent, "utf-8");

      // Escape path for FFmpeg subtitles filter (colon and backslash)
      const escapedAssPath = assPath.replace(/\\/g, "\\\\").replace(/:/g, "\\:");

      await execSafe("ffmpeg", [
        "-y", "-i", videoPath,
        "-vf", `ass=${escapedAssPath}`,
        "-c:a", "copy",
        absOutputPath,
      ], { timeout: 300_000 });
    } else {
      // Remotion tier: generate component → render with embedded video
      const component = generateAnimatedCaptionComponent({
        groups,
        style: effectiveStyle as "highlight" | "bounce" | "pop-in" | "neon",
        highlightColor,
        fontSize: effectiveFontSize,
        position,
        width,
        height,
        fps: videoFps,
        videoFileName: basename(videoPath),
      });

      const durationInFrames = Math.ceil(duration * videoFps);

      const renderResult = await renderWithEmbeddedVideo({
        componentCode: component.code,
        componentName: component.name,
        width,
        height,
        fps: videoFps,
        durationInFrames,
        videoPath,
        videoFileName: basename(videoPath),
        outputPath: absOutputPath,
      });

      if (!renderResult.success) {
        await rm(tmpAudioDir, { recursive: true, force: true }).catch(() => {});
        return { success: false, error: renderResult.error };
      }
    }

    // Cleanup
    await rm(tmpAudioDir, { recursive: true, force: true }).catch(() => {});

    return {
      success: true,
      outputPath: absOutputPath,
      wordCount: transcript.words.length,
      groupCount: groups.length,
      style: effectiveStyle,
      tier,
    };
  } catch (error) {
    return {
      success: false,
      error: `Animated caption failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
