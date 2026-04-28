/**
 * @module _shared/edit/caption
 * @description `executeCaption` — Whisper transcribe + ASS subtitles
 * burn-in (or Remotion fallback if libass missing). Split out of
 * `ai-edit.ts` in v0.69 (Plan G Phase 3).
 */

import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, basename, extname, join } from "node:path";
import { WhisperProvider } from "@vibeframe/ai-providers";
import { getVideoDuration } from "../../../utils/audio.js";
import { formatSRT } from "../../../utils/subtitle.js";
import { execSafe, commandExists } from "../../../utils/exec-safe.js";
import { getVideoResolution } from "./_helpers.js";

/** Visual style preset for burned-in captions. */
export type CaptionStyle = "minimal" | "bold" | "outline" | "karaoke";

/** Options for {@link executeCaption}. */
export interface CaptionOptions {
  /** Path to the input video file */
  videoPath: string;
  /** Path for the output video with burned-in captions */
  outputPath: string;
  /** Caption visual style preset (default: "bold") */
  style?: CaptionStyle;
  /** Font size override (auto-calculated from video height if omitted) */
  fontSize?: number;
  /** Font color name (default: "white") */
  fontColor?: string;
  /** Language code for Whisper transcription */
  language?: string;
  /** Vertical position of captions (default: "bottom") */
  position?: "top" | "center" | "bottom";
  /** Override OpenAI API key */
  apiKey?: string;
}

/** Result from {@link executeCaption}. */
export interface CaptionResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Path to the output video with captions */
  outputPath?: string;
  /** Path to the generated SRT file */
  srtPath?: string;
  /** Number of transcript segments */
  segmentCount?: number;
  /** Error message on failure */
  error?: string;
}

/** Get ASS force_style string for caption preset. */
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
 * Transcribe video audio and burn styled captions using Whisper + FFmpeg.
 *
 * Pipeline: extract audio -> Whisper transcription -> generate SRT ->
 * burn captions via FFmpeg subtitles filter (or Remotion fallback).
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
    const tmpDir = `/tmp/vibe_caption_${Date.now()}`;
    await mkdir(tmpDir, { recursive: true });
    const audioPath = join(tmpDir, "audio.wav");
    const srtPath = join(tmpDir, "captions.srt");

    try {
      // Step 1: Extract audio from video
      await execSafe(
        "ffmpeg",
        [
          "-i", videoPath, "-vn", "-acodec", "pcm_s16le",
          "-ar", "16000", "-ac", "1", audioPath, "-y",
        ],
        { timeout: 300000, maxBuffer: 50 * 1024 * 1024 },
      );

      // Step 2: Transcribe with Whisper
      const whisper = new WhisperProvider();
      await whisper.initialize({ apiKey: openaiKey });

      const audioBuffer = await readFile(audioPath);
      const audioBlob = new Blob([audioBuffer]);
      const transcriptResult = await whisper.transcribe(audioBlob, language);

      if (
        transcriptResult.status === "failed" ||
        !transcriptResult.segments ||
        transcriptResult.segments.length === 0
      ) {
        return {
          success: false,
          error: `Transcription failed: ${transcriptResult.error || "No segments detected"}`,
        };
      }

      // Step 3: Generate SRT
      const srtContent = formatSRT(transcriptResult.segments);
      await writeFile(srtPath, srtContent);

      // Step 4: Get video resolution for auto font size
      const { width, height } = await getVideoResolution(videoPath);
      const fontSize = customFontSize || Math.round(height / 18);

      // Step 5: Check FFmpeg subtitle filter support
      let hasSubtitles = false;
      try {
        const { stdout: filterList } = await execSafe("ffmpeg", ["-filters"], {
          maxBuffer: 10 * 1024 * 1024,
        });
        hasSubtitles = filterList.includes("subtitles");
      } catch {
        // If filter check fails, continue and let FFmpeg error naturally
      }

      // Step 6: Burn captions
      if (hasSubtitles) {
        // Fast path: FFmpeg subtitles filter (requires libass)
        const forceStyle = getCaptionForceStyle(style, fontSize, fontColor, position);
        const escapedSrtPath = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:");
        await execSafe(
          "ffmpeg",
          [
            "-i", videoPath,
            "-vf", `subtitles=${escapedSrtPath}:force_style='${forceStyle}'`,
            "-c:a", "copy",
            outputPath, "-y",
          ],
          { timeout: 600000, maxBuffer: 50 * 1024 * 1024 },
        );
      } else {
        // Remotion fallback: embed video + captions in a single Remotion composition
        console.log("FFmpeg missing subtitles filter (libass) — using Remotion fallback...");
        const {
          generateCaptionComponent,
          renderWithEmbeddedVideo,
          ensureRemotionInstalled,
        } = await import("../../../utils/remotion.js");

        const remotionErr = await ensureRemotionInstalled();
        if (remotionErr) {
          // Save SRT so the user still gets something
          const outputDir = dirname(outputPath);
          const outputSrtPath = join(
            outputDir,
            basename(outputPath, extname(outputPath)) + ".srt",
          );
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
          const outputSrtPath = join(
            outputDir,
            basename(outputPath, extname(outputPath)) + ".srt",
          );
          await writeFile(outputSrtPath, srtContent);
          return {
            success: false,
            error: `${renderResult.error}\nSRT saved to: ${outputSrtPath}`,
          };
        }
      }

      // Copy SRT to output directory for user reference
      const outputDir = dirname(outputPath);
      const outputSrtPath = join(
        outputDir,
        basename(outputPath, extname(outputPath)) + ".srt",
      );
      await writeFile(outputSrtPath, srtContent);

      return {
        success: true,
        outputPath,
        srtPath: outputSrtPath,
        segmentCount: transcriptResult.segments.length,
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
      error: `Caption failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
