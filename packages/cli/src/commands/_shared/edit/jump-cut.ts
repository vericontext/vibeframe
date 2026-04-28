/**
 * @module _shared/edit/jump-cut
 * @description `executeJumpCut` — remove filler words from video using
 * Whisper word-level timestamps + FFmpeg stream-copy concat. Also exports
 * `transcribeWithWords` and `detectFillerRanges` (used by other modules
 * via `ai-edit.ts` re-export). Split out of `ai-edit.ts` in v0.69 (Plan G
 * Phase 3).
 */

import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getVideoDuration } from "../../../utils/audio.js";
import { execSafe, commandExists } from "../../../utils/exec-safe.js";

/** A detected filler word with its time range. */
export interface FillerWord {
  /** The filler word or merged phrase */
  word: string;
  /** Start time in seconds */
  start: number;
  /** End time in seconds */
  end: number;
}

/** Options for {@link executeJumpCut}. */
export interface JumpCutOptions {
  /** Path to the input video file */
  videoPath: string;
  /** Path for the output video (filler words removed) */
  outputPath: string;
  /** Custom filler words to detect (default: {@link DEFAULT_FILLER_WORDS}) */
  fillers?: string[];
  /** Padding in seconds around filler cuts (default: 0.05) */
  padding?: number;
  /** Language code for Whisper transcription */
  language?: string;
  /** If true, only analyze without producing output video */
  analyzeOnly?: boolean;
  /** Override OpenAI API key */
  apiKey?: string;
}

/** Result from {@link executeJumpCut}. */
export interface JumpCutResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Path to the output video (undefined in analyze-only mode) */
  outputPath?: string;
  /** Total duration of the source video in seconds */
  totalDuration?: number;
  /** Number of filler word occurrences detected */
  fillerCount?: number;
  /** Total duration of filler words in seconds */
  fillerDuration?: number;
  /** Detected filler word ranges */
  fillers?: FillerWord[];
  /** Error message on failure */
  error?: string;
}

/** Default set of filler words detected by jump-cut. */
export const DEFAULT_FILLER_WORDS = [
  "um", "uh", "uh-huh", "hmm", "like", "you know", "so",
  "basically", "literally", "right", "okay", "well", "i mean", "actually",
];

/**
 * Transcribe audio with word-level timestamps using Whisper API directly.
 * Uses timestamp_granularities[]=word for filler detection.
 */
export async function transcribeWithWords(
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

  const data = (await response.json()) as {
    text: string;
    words?: Array<{ word: string; start: number; end: number }>;
  };

  return {
    words: data.words || [],
    text: data.text,
  };
}

/**
 * Detect filler word ranges and merge adjacent ones within padding distance.
 */
export function detectFillerRanges(
  words: { word: string; start: number; end: number }[],
  fillers: string[],
  padding: number,
): FillerWord[] {
  const fillerSet = new Set(fillers.map((f) => f.toLowerCase().trim()));

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
 * Remove filler words from a video using Whisper word-level timestamps + FFmpeg concat.
 *
 * Pipeline: extract audio -> Whisper transcription (word-level) -> detect fillers ->
 * invert to keep-segments -> FFmpeg stream-copy concat.
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

  if (!commandExists("ffmpeg")) {
    return {
      success: false,
      error:
        "FFmpeg not found. Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux). Run `vibe doctor` for details.",
    };
  }

  const openaiKey = apiKey || process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return {
      success: false,
      error:
        "OpenAI API key required for Whisper transcription. Run 'vibe setup' or set OPENAI_API_KEY in .env",
    };
  }

  try {
    const tmpDir = `/tmp/vibe_jumpcut_${Date.now()}`;
    await mkdir(tmpDir, { recursive: true });
    const audioPath = join(tmpDir, "audio.wav");

    try {
      // Step 1: Extract audio
      await execSafe(
        "ffmpeg",
        [
          "-i", videoPath, "-vn", "-acodec", "pcm_s16le",
          "-ar", "16000", "-ac", "1", audioPath, "-y",
        ],
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
        await execSafe(
          "ffmpeg",
          [
            "-i", videoPath, "-ss", String(seg.start), "-t", String(duration),
            "-c", "copy", "-avoid_negative_ts", "make_zero", segPath, "-y",
          ],
          { timeout: 300000, maxBuffer: 50 * 1024 * 1024 },
        );
        segmentPaths.push(segPath);
      }

      const concatList = segmentPaths.map((p) => `file '${p}'`).join("\n");
      const listPath = join(tmpDir, "concat.txt");
      await writeFile(listPath, concatList);

      await execSafe(
        "ffmpeg",
        [
          "-f", "concat", "-safe", "0", "-i", listPath,
          "-c", "copy", outputPath, "-y",
        ],
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
      try {
        const { rm } = await import("node:fs/promises");
        await rm(tmpDir, { recursive: true, force: true });
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
