/**
 * @module _shared/edit/silence-cut
 * @description `executeSilenceCut` — detect silent segments via FFmpeg
 * `silencedetect` (default) or Gemini multimodal analysis, then trim and
 * concatenate the non-silent segments. Split out of `ai-edit.ts` in v0.69
 * (Plan G Phase 3).
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { GeminiProvider } from "@vibeframe/ai-providers";
import { getApiKey } from "../../../utils/api-key.js";
import { getVideoDuration } from "../../../utils/audio.js";
import { execSafe, commandExists } from "../../../utils/exec-safe.js";

/** A detected silent segment within a media file. */
export interface SilencePeriod {
  /** Start time in seconds */
  start: number;
  /** End time in seconds */
  end: number;
  /** Duration of the silent period in seconds */
  duration: number;
}

/** Options for {@link executeSilenceCut}. */
export interface SilenceCutOptions {
  /** Path to the input video file */
  videoPath: string;
  /** Path for the output video (silent segments removed) */
  outputPath: string;
  /** FFmpeg noise threshold in dB (default: -30) */
  noiseThreshold?: number;
  /** Minimum silence duration in seconds to detect (default: 0.5) */
  minDuration?: number;
  /** Padding in seconds kept around cuts (default: 0.1) */
  padding?: number;
  /** If true, only analyze without producing output video */
  analyzeOnly?: boolean;
  /** Use Gemini multimodal analysis instead of FFmpeg silencedetect */
  useGemini?: boolean;
  /** Gemini model shorthand: "flash", "flash-2.5", "pro" */
  model?: string;
  /** Use low-resolution mode for Gemini (longer videos) */
  lowRes?: boolean;
  /** Override API key (Google for Gemini mode) */
  apiKey?: string;
}

/** Result from {@link executeSilenceCut}. */
export interface SilenceCutResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Path to the output video (undefined in analyze-only mode) */
  outputPath?: string;
  /** Total duration of the source video in seconds */
  totalDuration?: number;
  /** Detected silent periods */
  silentPeriods?: SilencePeriod[];
  /** Total silent duration removed in seconds */
  silentDuration?: number;
  /** Detection method used */
  method?: "ffmpeg" | "gemini";
  /** Error message on failure */
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
  const totalDuration = await getVideoDuration(videoPath);

  const { stdout, stderr } = await execSafe(
    "ffmpeg",
    [
      "-i", videoPath,
      "-af", `silencedetect=noise=${noiseThreshold}dB:d=${minDuration}`,
      "-f", "null", "-",
    ],
    { maxBuffer: 50 * 1024 * 1024 },
  ).catch((err) => {
    // ffmpeg writes filter output to stderr and exits non-zero with -f null
    if (err.stdout !== undefined || err.stderr !== undefined) {
      return { stdout: err.stdout || "", stderr: err.stderr || "" };
    }
    throw err;
  });
  const silenceOutput = stdout + stderr;

  const periods: SilencePeriod[] = [];
  const startRegex = /silence_start: (\d+\.?\d*)/g;
  const endRegex = /silence_end: (\d+\.?\d*) \| silence_duration: (\d+\.?\d*)/g;

  const starts: number[] = [];
  let match;
  while ((match = startRegex.exec(silenceOutput)) !== null) {
    starts.push(parseFloat(match[1]));
  }

  let i = 0;
  while ((match = endRegex.exec(silenceOutput)) !== null) {
    const end = parseFloat(match[1]);
    const duration = parseFloat(match[2]);
    const start = i < starts.length ? starts[i] : end - duration;
    periods.push({ start, end, duration });
    i++;
  }

  return { periods, totalDuration };
}

/**
 * Detect silent/dead segments using Gemini Video Understanding (multimodal analysis)
 */
async function detectSilencePeriodsWithGemini(
  videoPath: string,
  minDuration: number,
  options: { model?: string; lowRes?: boolean; apiKey?: string },
): Promise<{ periods: SilencePeriod[]; totalDuration: number }> {
  const totalDuration = await getVideoDuration(videoPath);

  const geminiApiKey = options.apiKey || (await getApiKey("GOOGLE_API_KEY", "Google"));
  if (!geminiApiKey) {
    throw new Error(
      "Google API key required for Gemini Video Understanding. Run 'vibe setup' or set GOOGLE_API_KEY in .env",
    );
  }

  const gemini = new GeminiProvider();
  await gemini.initialize({ apiKey: geminiApiKey });

  const videoBuffer = await readFile(videoPath);

  // Map model shorthand to full model ID
  const modelMap: Record<string, string> = {
    flash: "gemini-3-flash-preview",
    "flash-2.5": "gemini-2.5-flash",
    pro: "gemini-2.5-pro",
  };
  const modelId = options.model
    ? modelMap[options.model] || modelMap.flash
    : undefined;

  const prompt = `Analyze this video and identify all silent or dead segments where there is NO meaningful content.

Detect these as silent/dead segments:
- Complete silence (no audio at all)
- Dead air / ambient noise with no speech or meaningful sound
- Long pauses between speakers or topics (${minDuration}+ seconds)
- Technical silence (e.g., blank screen with no audio)
- Sections with only background noise and no intentional content

Do NOT mark these as silent (keep them):
- Intentional dramatic pauses (short, part of storytelling)
- Music-only sections (background music, intros, outros)
- Natural breathing pauses within sentences (under ${minDuration} seconds)
- Applause, laughter, or audience reactions
- Sound effects or ambient audio that is part of the content

Only include segments that are at least ${minDuration} seconds long.
The video total duration is ${totalDuration.toFixed(1)} seconds.

IMPORTANT: Respond ONLY with valid JSON in this exact format:
{
  "silentSegments": [
    {
      "start": 5.2,
      "end": 8.7,
      "reason": "Dead air between speakers"
    }
  ]
}

If there are no silent segments, return: { "silentSegments": [] }`;

  const result = await gemini.analyzeVideo(videoBuffer, prompt, {
    fps: 1,
    lowResolution: options.lowRes,
    ...(modelId
      ? {
          model: modelId as
            | "gemini-3-flash-preview"
            | "gemini-2.5-flash"
            | "gemini-2.5-pro",
        }
      : {}),
  });

  if (!result.success || !result.response) {
    throw new Error(`Gemini analysis failed: ${result.error || "No response"}`);
  }

  // Parse JSON from Gemini response
  let jsonStr = result.response;
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1];
  const objectMatch = jsonStr.match(/\{[\s\S]*"silentSegments"[\s\S]*\}/);
  if (objectMatch) jsonStr = objectMatch[0];

  const parsed = JSON.parse(jsonStr);

  const periods: SilencePeriod[] = [];
  if (parsed.silentSegments && Array.isArray(parsed.silentSegments)) {
    for (const seg of parsed.silentSegments) {
      const rawStart = Number(seg.start);
      const rawEnd = Number(seg.end);
      if (isNaN(rawStart) || isNaN(rawEnd)) continue;
      const start = Math.max(0, rawStart);
      const end = Math.min(rawEnd, totalDuration);
      const duration = end - start;
      if (duration >= minDuration) {
        periods.push({ start, end, duration });
      }
    }
  }

  periods.sort((a, b) => a.start - b.start);

  return { periods, totalDuration };
}

/**
 * Remove silent segments from a video using FFmpeg or Gemini detection.
 *
 * Detects silence via FFmpeg silencedetect (default) or Gemini multimodal
 * analysis, then trims and concatenates the non-silent segments.
 */
export async function executeSilenceCut(
  options: SilenceCutOptions,
): Promise<SilenceCutResult> {
  const {
    videoPath,
    outputPath,
    noiseThreshold = -30,
    minDuration = 0.5,
    padding = 0.1,
    analyzeOnly = false,
    useGemini = false,
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

  const method = useGemini ? "gemini" : "ffmpeg";

  try {
    const { periods, totalDuration } = useGemini
      ? await detectSilencePeriodsWithGemini(videoPath, minDuration, {
          model: options.model,
          lowRes: options.lowRes,
          apiKey: options.apiKey,
        })
      : await detectSilencePeriods(videoPath, noiseThreshold, minDuration);
    const silentDuration = periods.reduce((sum, p) => sum + p.duration, 0);

    if (analyzeOnly || periods.length === 0) {
      return {
        success: true,
        totalDuration,
        silentPeriods: periods,
        silentDuration,
        method,
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
    if (cursor < totalDuration) {
      segments.push({ start: Math.max(0, cursor - padding), end: totalDuration });
    }

    if (segments.length === 0) {
      return { success: false, error: "No non-silent segments found" };
    }

    // Build filter_complex with trim+concat per segment.
    // aselect is broken on FFmpeg 8.x (audio duration unchanged), so we use
    // atrim/trim per segment and concat them all.
    const vParts: string[] = [];
    const aParts: string[] = [];
    const concatInputs: string[] = [];

    for (let i = 0; i < segments.length; i++) {
      const s = segments[i].start.toFixed(4);
      const e = segments[i].end.toFixed(4);
      vParts.push(`[0:v]trim=${s}:${e},setpts=PTS-STARTPTS[v${i}]`);
      aParts.push(`[0:a]atrim=${s}:${e},asetpts=PTS-STARTPTS[a${i}]`);
      concatInputs.push(`[v${i}][a${i}]`);
    }

    const filterComplex = [
      ...vParts,
      ...aParts,
      `${concatInputs.join("")}concat=n=${segments.length}:v=1:a=1[outv][outa]`,
    ].join(";");

    await execSafe(
      "ffmpeg",
      [
        "-i", videoPath,
        "-filter_complex", filterComplex,
        "-map", "[outv]", "-map", "[outa]",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-c:a", "aac", "-b:a", "192k",
        outputPath, "-y",
      ],
      { timeout: 600000, maxBuffer: 50 * 1024 * 1024 },
    );

    return {
      success: true,
      outputPath,
      totalDuration,
      silentPeriods: periods,
      silentDuration,
      method,
    };
  } catch (error) {
    return {
      success: false,
      error: `Silence cut failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
