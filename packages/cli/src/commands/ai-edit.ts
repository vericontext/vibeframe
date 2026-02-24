/**
 * ai-edit.ts — Video/audio editing types, helpers, and execute functions.
 *
 * Execute functions (also used by agent tools via ai.ts re-exports):
 *   executeSilenceCut, executeJumpCut, executeCaption, executeNoiseReduce,
 *   executeFade, executeTranslateSrt, applyTextOverlays, executeTextOverlay
 *
 * CLI command registrations live in ai-edit-cli.ts (registerEditCommands).
 * Extracted from ai.ts as part of modularisation.
 */

import { resolve, dirname, basename, extname, join } from 'node:path';
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { exec, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import {
  GeminiProvider,
  WhisperProvider,
} from '@vibeframe/ai-providers';
import { getApiKey } from '../utils/api-key.js';
import { getVideoDuration } from '../utils/audio.js';
import { formatSRT, parseSRT } from '../utils/subtitle.js';

const execAsync = promisify(exec);


// ── Exported types and execute functions ────────────────────────────────────

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
  useGemini?: boolean;
  model?: string;
  lowRes?: boolean;
  apiKey?: string;
}

export interface SilenceCutResult {
  success: boolean;
  outputPath?: string;
  totalDuration?: number;
  silentPeriods?: SilencePeriod[];
  silentDuration?: number;
  method?: "ffmpeg" | "gemini";
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
 * Detect silent/dead segments using Gemini Video Understanding (multimodal analysis)
 */
async function detectSilencePeriodsWithGemini(
  videoPath: string,
  minDuration: number,
  options: { model?: string; lowRes?: boolean; apiKey?: string },
): Promise<{ periods: SilencePeriod[]; totalDuration: number }> {
  const totalDuration = await getVideoDuration(videoPath);

  const geminiApiKey = options.apiKey || await getApiKey("GOOGLE_API_KEY", "Google");
  if (!geminiApiKey) {
    throw new Error("Google API key required for Gemini Video Understanding. Set GOOGLE_API_KEY or use --api-key");
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
  const modelId = options.model ? (modelMap[options.model] || modelMap.flash) : undefined;

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
    ...(modelId ? { model: modelId as "gemini-3-flash-preview" | "gemini-2.5-flash" | "gemini-2.5-pro" } : {}),
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
      // Clamp to video duration, then validate
      const start = Math.max(0, rawStart);
      const end = Math.min(rawEnd, totalDuration);
      const duration = end - start;
      if (duration >= minDuration) {
        periods.push({ start, end, duration });
      }
    }
  }

  // Sort by start time
  periods.sort((a, b) => a.start - b.start);

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
    useGemini = false,
  } = options;

  if (!existsSync(videoPath)) {
    return { success: false, error: `Video not found: ${videoPath}` };
  }

  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
  } catch {
    return { success: false, error: "FFmpeg not found. Please install FFmpeg." };
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
    // Add final segment after last silence
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

    await execAsync(
      `ffmpeg -i "${videoPath}" -filter_complex "${filterComplex}" -map "[outv]" -map "[outa]" -c:v libx264 -preset fast -crf 18 -c:a aac -b:a 192k "${outputPath}" -y`,
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
      const { width, height } = await getVideoResolution(videoPath);
      const fontSize = customFontSize || Math.round(height / 18);

      // Step 5: Check FFmpeg subtitle filter support
      const { stdout: filterList } = await execAsync("ffmpeg -filters 2>/dev/null", { maxBuffer: 10 * 1024 * 1024 });
      const hasSubtitles = filterList.includes("subtitles");

      // Step 6: Burn captions
      if (hasSubtitles) {
        // Fast path: FFmpeg subtitles filter (requires libass)
        const forceStyle = getCaptionForceStyle(style, fontSize, fontColor, position);
        const escapedSrtPath = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:");
        const cmd = `ffmpeg -i "${videoPath}" -vf "subtitles=${escapedSrtPath}:force_style='${forceStyle}'" -c:a copy "${outputPath}" -y`;
        await execAsync(cmd, { timeout: 600000, maxBuffer: 50 * 1024 * 1024 });
      } else {
        // Remotion fallback: embed video + captions in a single Remotion composition
        console.log("FFmpeg missing subtitles filter (libass) — using Remotion fallback...");
        const { generateCaptionComponent, renderWithEmbeddedVideo, ensureRemotionInstalled } = await import("../utils/remotion.js");

        const remotionErr = await ensureRemotionInstalled();
        if (remotionErr) {
          // Save SRT so the user still gets something
          const outputDir = dirname(outputPath);
          const outputSrtPath = join(outputDir, basename(outputPath, extname(outputPath)) + ".srt");
          await writeFile(outputSrtPath, srtContent);
          return { success: false, error: `${remotionErr}\nSRT saved to: ${outputSrtPath}` };
        }

        const videoDuration = await getVideoDuration(videoPath);
        const fps = 30;
        const durationInFrames = Math.ceil(videoDuration * fps);
        const videoFileName = "source_video.mp4";

        const { code, name } = generateCaptionComponent({
          segments: transcriptResult.segments.map((s) => ({
            start: s.startTime,
            end: s.endTime,
            text: s.text,
          })),
          style,
          fontSize,
          fontColor,
          position,
          width,
          height,
          videoFileName,
        });

        const renderResult = await renderWithEmbeddedVideo({
          componentCode: code,
          componentName: name,
          width,
          height,
          fps,
          durationInFrames,
          videoPath,
          videoFileName,
          outputPath,
        });

        if (!renderResult.success) {
          const outputDir = dirname(outputPath);
          const outputSrtPath = join(outputDir, basename(outputPath, extname(outputPath)) + ".srt");
          await writeFile(outputSrtPath, srtContent);
          return { success: false, error: `${renderResult.error}\nSRT saved to: ${outputSrtPath}` };
        }
      }

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
