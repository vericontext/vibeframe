/**
 * @module _shared/edit/text-overlay
 * @description `applyTextOverlays` + `executeTextOverlay` — burn text onto
 * video using FFmpeg drawtext filter. Falls back to Remotion when libfreetype
 * is missing. Auto-detects system fonts (macOS/Linux/Windows). Split out of
 * `ai-edit.ts` in v0.69 (Plan G Phase 3).
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getVideoDuration } from "../../../utils/audio.js";
import { execSafe, commandExists } from "../../../utils/exec-safe.js";
import { getVideoResolution, escapeDrawtext } from "./_helpers.js";

/** Visual style preset for text overlays. */
export type TextOverlayStyle = "lower-third" | "center-bold" | "subtitle" | "minimal";

/** Options for {@link applyTextOverlays} and {@link executeTextOverlay}. */
export interface TextOverlayOptions {
  /** Path to the input video file */
  videoPath: string;
  /** Array of text lines to overlay */
  texts: string[];
  /** Path for the output video */
  outputPath: string;
  /** Text overlay style preset (default: "lower-third") */
  style?: TextOverlayStyle;
  /** Font size override (auto-calculated from video height if omitted) */
  fontSize?: number;
  /** Font color name (default: "white") */
  fontColor?: string;
  /** Fade in/out duration for text in seconds (default: 0.3) */
  fadeDuration?: number;
  /** Start time for text display in seconds (default: 0) */
  startTime?: number;
  /** End time for text display in seconds (default: video duration) */
  endTime?: number;
}

/** Result from {@link applyTextOverlays} and {@link executeTextOverlay}. */
export interface TextOverlayResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Absolute path to the output video */
  outputPath?: string;
  /** Error message on failure */
  error?: string;
}

/** Detect system font path for FFmpeg drawtext. */
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
 * Apply text overlays to a video using FFmpeg drawtext filter.
 *
 * Supports multiple text lines with configurable style, position, font,
 * and fade-in/out. Auto-detects system fonts across macOS, Linux, and Windows.
 */
export async function applyTextOverlays(
  options: TextOverlayOptions,
): Promise<TextOverlayResult> {
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

  if (!existsSync(absVideoPath)) {
    return { success: false, error: `Video not found: ${absVideoPath}` };
  }

  if (!commandExists("ffmpeg")) {
    return {
      success: false,
      error:
        "FFmpeg not found. Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux). Run `vibe doctor` for details.",
    };
  }

  // Check drawtext filter availability
  let hasDrawtext = true;
  try {
    const { stdout } = await execSafe("ffmpeg", ["-filters"]);
    hasDrawtext = stdout.includes("drawtext");
  } catch {
    // If filter check fails, assume available and let FFmpeg error naturally
  }

  if (!hasDrawtext) {
    // Remotion fallback: render text overlay without libfreetype
    console.log("FFmpeg missing drawtext filter (libfreetype) — using Remotion fallback...");
    const {
      generateTextOverlayComponent,
      renderWithEmbeddedVideo,
      ensureRemotionInstalled,
    } = await import("../../../utils/remotion.js");

    const remotionErr = await ensureRemotionInstalled();
    if (remotionErr) {
      const platform = process.platform;
      let hint = "";
      if (platform === "darwin") {
        hint =
          "\n\nFix: brew uninstall ffmpeg && brew install ffmpeg\n(The default homebrew formula includes libfreetype)";
      } else if (platform === "linux") {
        hint =
          "\n\nFix: sudo apt install ffmpeg (Ubuntu/Debian)\n     or rebuild FFmpeg with --enable-libfreetype";
      }
      return {
        success: false,
        error: `FFmpeg 'drawtext' filter not available and Remotion fallback unavailable.\n${remotionErr}${hint}`,
      };
    }

    const { width, height } = await getVideoResolution(absVideoPath);
    const videoDuration = await getVideoDuration(absVideoPath);
    const baseFontSize = customFontSize || Math.round(height / 20);
    const endTime = options.endTime ?? videoDuration;
    const fps = 30;
    const durationInFrames = Math.ceil(videoDuration * fps);
    const videoFileName = "source_video.mp4";

    const { code, name } = generateTextOverlayComponent({
      texts,
      style,
      fontSize: baseFontSize,
      fontColor,
      startTime,
      endTime,
      fadeDuration,
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
      videoPath: absVideoPath,
      videoFileName,
      outputPath: absOutputPath,
    });

    return renderResult.success
      ? { success: true, outputPath: renderResult.outputPath || absOutputPath }
      : { success: false, error: renderResult.error || "Remotion render failed" };
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
  try {
    await execSafe(
      "ffmpeg",
      ["-i", absVideoPath, "-vf", filterChain, "-c:a", "copy", absOutputPath, "-y"],
      { timeout: 600000, maxBuffer: 50 * 1024 * 1024 },
    );
    return { success: true, outputPath: absOutputPath };
  } catch (error) {
    return {
      success: false,
      error: `FFmpeg failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Execute text overlay for CLI/Agent usage. Delegates to {@link applyTextOverlays}.
 */
export async function executeTextOverlay(
  options: TextOverlayOptions,
): Promise<TextOverlayResult> {
  return applyTextOverlays(options);
}
