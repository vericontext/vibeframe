import type { AspectRatio, TimeSeconds } from "../timeline/types.js";

/** Video codec options */
export type VideoCodec = "h264" | "h265" | "vp9" | "av1";

/** Audio codec options */
export type AudioCodec = "aac" | "mp3" | "opus";

/** Export quality presets */
export type QualityPreset = "draft" | "standard" | "high" | "ultra";

/** Export format options */
export interface ExportFormat {
  container: "mp4" | "webm" | "mov";
  videoCodec: VideoCodec;
  audioCodec: AudioCodec;
  width: number;
  height: number;
  frameRate: number;
  videoBitrate: number; // kbps
  audioBitrate: number; // kbps
  audioSampleRate: number;
}

/** Export options */
export interface ExportOptions {
  format: ExportFormat;
  aspectRatio: AspectRatio;
  /** Start time for range export */
  startTime?: TimeSeconds;
  /** End time for range export */
  endTime?: TimeSeconds;
  /** Whether to include audio */
  includeAudio: boolean;
}

/** Export progress callback */
export interface ExportProgress {
  /** Progress percentage 0-100 */
  percent: number;
  /** Current frame being processed */
  currentFrame: number;
  /** Total frames to process */
  totalFrames: number;
  /** Estimated time remaining in seconds */
  estimatedTimeRemaining: TimeSeconds;
  /** Current stage of export */
  stage: "preparing" | "encoding" | "muxing" | "finalizing";
}

/** Export result */
export interface ExportResult {
  success: boolean;
  /** URL to the exported file (blob URL) */
  url?: string;
  /** File size in bytes */
  size?: number;
  /** Duration of export in seconds */
  duration?: TimeSeconds;
  /** Error message if failed */
  error?: string;
}

/** Quality preset configurations */
export const QUALITY_PRESETS: Record<QualityPreset, Partial<ExportFormat>> = {
  draft: {
    width: 640,
    height: 360,
    frameRate: 24,
    videoBitrate: 1000,
    audioBitrate: 96,
  },
  standard: {
    width: 1280,
    height: 720,
    frameRate: 30,
    videoBitrate: 5000,
    audioBitrate: 128,
  },
  high: {
    width: 1920,
    height: 1080,
    frameRate: 30,
    videoBitrate: 10000,
    audioBitrate: 192,
  },
  ultra: {
    width: 3840,
    height: 2160,
    frameRate: 60,
    videoBitrate: 35000,
    audioBitrate: 320,
  },
};

/** Get dimensions for aspect ratio */
export function getDimensionsForAspectRatio(
  aspectRatio: AspectRatio,
  baseHeight: number
): { width: number; height: number } {
  const ratios: Record<AspectRatio, number> = {
    "16:9": 16 / 9,
    "9:16": 9 / 16,
    "1:1": 1,
    "4:5": 4 / 5,
  };
  const ratio = ratios[aspectRatio];
  return {
    width: Math.round(baseHeight * ratio),
    height: baseHeight,
  };
}
