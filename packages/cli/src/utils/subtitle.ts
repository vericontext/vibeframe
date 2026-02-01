/**
 * Subtitle format utilities for SRT/VTT generation
 */

export type SubtitleFormat = "json" | "srt" | "vtt";

export interface SubtitleSegment {
  startTime: number;
  endTime: number;
  text: string;
}

export interface TranscriptResult {
  id: string;
  status: string;
  fullText?: string;
  segments?: SubtitleSegment[];
  detectedLanguage?: string;
  error?: string;
}

/**
 * Detect subtitle format from file extension or explicit format option
 */
export function detectFormat(outputPath: string, explicitFormat?: string): SubtitleFormat {
  if (explicitFormat) {
    const fmt = explicitFormat.toLowerCase();
    if (fmt === "srt" || fmt === "vtt" || fmt === "json") {
      return fmt;
    }
  }

  const ext = outputPath.toLowerCase().split(".").pop();
  if (ext === "srt") return "srt";
  if (ext === "vtt") return "vtt";
  return "json";
}

/**
 * Format transcript result to the specified format
 */
export function formatTranscript(result: TranscriptResult, format: SubtitleFormat): string {
  if (format === "json") {
    return JSON.stringify(result, null, 2);
  }

  const segments = result.segments || [];

  if (format === "srt") {
    return formatSRT(segments);
  }

  return formatVTT(segments);
}

/**
 * Format segments as SRT (SubRip Subtitle)
 *
 * SRT Format:
 * 1
 * 00:00:00,000 --> 00:00:02,500
 * Hello world
 */
export function formatSRT(segments: SubtitleSegment[]): string {
  return segments.map((seg, index) => {
    const start = formatSRTTime(seg.startTime);
    const end = formatSRTTime(seg.endTime);
    return `${index + 1}\n${start} --> ${end}\n${seg.text}\n`;
  }).join("\n");
}

/**
 * Format segments as WebVTT (Web Video Text Tracks)
 *
 * VTT Format:
 * WEBVTT
 *
 * 1
 * 00:00:00.000 --> 00:00:02.500
 * Hello world
 */
export function formatVTT(segments: SubtitleSegment[]): string {
  const header = "WEBVTT\n\n";
  const cues = segments.map((seg, index) => {
    const start = formatVTTTime(seg.startTime);
    const end = formatVTTTime(seg.endTime);
    return `${index + 1}\n${start} --> ${end}\n${seg.text}\n`;
  }).join("\n");
  return header + cues;
}

/**
 * Format time for SRT (uses comma for milliseconds)
 * Format: HH:MM:SS,mmm
 */
export function formatSRTTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);

  return `${pad(hours, 2)}:${pad(mins, 2)}:${pad(secs, 2)},${pad(ms, 3)}`;
}

/**
 * Format time for VTT (uses period for milliseconds)
 * Format: HH:MM:SS.mmm
 */
export function formatVTTTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);

  return `${pad(hours, 2)}:${pad(mins, 2)}:${pad(secs, 2)}.${pad(ms, 3)}`;
}

function pad(num: number, size: number): string {
  return num.toString().padStart(size, "0");
}
