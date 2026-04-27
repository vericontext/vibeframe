/**
 * @module manifest/detect
 * @description FFmpeg-based detection (scenes, silence, beats). Free, no
 * API keys.
 */

import { z } from "zod";
import { defineTool, type AnyTool } from "../define-tool.js";
import {
  executeDetectScenes,
  executeDetectSilence,
  executeDetectBeats,
} from "../../commands/detect.js";

export const detectScenesTool = defineTool({
  name: "detect_scenes",
  category: "detect",
  cost: "free",
  description: "Detect scene changes in video using FFmpeg. No API key needed.",
  schema: z.object({
    videoPath: z.string().describe("Path to the input video file"),
    threshold: z.number().optional().describe("Scene change threshold 0-1 (default: 0.3)"),
    outputPath: z.string().optional().describe("Optional: save results as JSON file"),
  }),
  async execute(args) {
    const result = await executeDetectScenes(args);
    if (!result.success) return { success: false, error: result.error ?? "Scene detection failed" };
    return {
      success: true,
      data: {
        sceneCount: result.scenes?.length,
        totalDuration: result.totalDuration,
        scenes: result.scenes,
      },
      humanLines: [`✅ ${result.scenes?.length ?? 0} scene(s) detected`],
    };
  },
});

export const detectSilenceTool = defineTool({
  name: "detect_silence",
  category: "detect",
  cost: "free",
  description: "Detect silence periods in audio/video using FFmpeg. No API key needed.",
  schema: z.object({
    mediaPath: z.string().describe("Path to the audio/video file"),
    noise: z.string().optional().describe("Noise threshold in dB (default: -30)"),
    duration: z.string().optional().describe("Minimum silence duration in seconds (default: 0.5)"),
    outputPath: z.string().optional().describe("Optional: save results as JSON file"),
  }),
  async execute(args) {
    const result = await executeDetectSilence(args);
    if (!result.success) return { success: false, error: result.error ?? "Silence detection failed" };
    return {
      success: true,
      data: { silenceCount: result.silences?.length, silences: result.silences },
      humanLines: [`✅ ${result.silences?.length ?? 0} silence period(s) detected`],
    };
  },
});

export const detectBeatsTool = defineTool({
  name: "detect_beats",
  category: "detect",
  cost: "free",
  description:
    "Detect beats in audio for music sync using FFmpeg loudness analysis. No API key needed.",
  schema: z.object({
    audioPath: z.string().describe("Path to the audio file"),
    outputPath: z.string().optional().describe("Optional: save results as JSON file"),
  }),
  async execute(args) {
    const result = await executeDetectBeats(args);
    if (!result.success) return { success: false, error: result.error ?? "Beat detection failed" };
    return {
      success: true,
      data: { beatCount: result.beatCount, beats: result.beats },
      humanLines: [`✅ ${result.beatCount} beat(s) detected`],
    };
  },
});

export const detectTools: readonly AnyTool[] = [
  detectScenesTool as unknown as AnyTool,
  detectSilenceTool as unknown as AnyTool,
  detectBeatsTool as unknown as AnyTool,
];
