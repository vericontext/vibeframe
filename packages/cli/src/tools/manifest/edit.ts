/**
 * @module manifest/edit
 * @description Manifest entries for `vibe edit *` subcommands. The
 * underlying executes live in:
 *   - `commands/_shared/edit/*.ts` (silence-cut, caption, fade, noise-reduce,
 *     jump-cut, text-overlay, translate-srt — Plan G Phase 3 split)
 *   - `commands/edit-cmd.ts` (grade, speed-ramp, reframe, interpolate, upscale)
 *   - `commands/ai-animated-caption.ts` + `commands/ai-image.ts`
 *   - `commands/_shared/execute-fill-gaps.ts` (Plan G Phase 4 finishing piece)
 */

import { z } from "zod";
import { defineTool, type AnyTool } from "../define-tool.js";
import {
  executeSilenceCut,
  executeCaption,
  executeFade,
  executeNoiseReduce,
  executeJumpCut,
  executeTextOverlay,
  executeTranslateSrt,
} from "../../commands/ai-edit.js";
import {
  executeGrade,
  executeSpeedRamp,
  executeReframe,
  executeInterpolate,
  executeUpscale,
} from "../../commands/edit-cmd.js";
import { executeAnimatedCaption } from "../../commands/ai-animated-caption.js";
import { executeGeminiEdit } from "../../commands/ai-image.js";
import { executeFillGaps } from "../../commands/_shared/execute-fill-gaps.js";

// ── edit_silence_cut ────────────────────────────────────────────────────────

export const editSilenceCutTool = defineTool({
  name: "edit_silence_cut",
  category: "edit",
  cost: "free",
  description:
    "Remove silent segments from a video using FFmpeg or Gemini AI detection. No API key needed for FFmpeg mode.",
  schema: z.object({
    videoPath: z.string().describe("Path to the input video file"),
    outputPath: z.string().describe("Path for the output video"),
    noiseThreshold: z.number().optional().describe("Silence detection threshold in dB (default: -30)"),
    minDuration: z.number().optional().describe("Minimum silence duration in seconds to cut (default: 0.5)"),
    padding: z.number().optional().describe("Padding around cuts in seconds (default: 0.1)"),
    analyzeOnly: z.boolean().optional().describe("Only analyze without cutting (default: false)"),
    useGemini: z.boolean().optional().describe("Use Gemini AI for smart silence detection (requires GOOGLE_API_KEY)"),
  }),
  async execute(args) {
    const result = await executeSilenceCut(args);
    if (!result.success) return { success: false, error: result.error ?? "Silence cut failed" };
    return {
      success: true,
      data: {
        outputPath: result.outputPath,
        method: result.method,
        totalDuration: result.totalDuration,
        silentDuration: result.silentDuration,
        silentPeriods: result.silentPeriods?.length,
      },
      humanLines: [`✅ Silence cut → ${result.outputPath}`],
    };
  },
});

// ── edit_caption ────────────────────────────────────────────────────────────

export const editCaptionTool = defineTool({
  name: "edit_caption",
  category: "edit",
  cost: "low",
  description:
    "Transcribe audio and burn styled captions into video. Requires OPENAI_API_KEY for Whisper transcription.",
  schema: z.object({
    videoPath: z.string().describe("Path to the input video file"),
    outputPath: z.string().describe("Path for the output video"),
    style: z.enum(["minimal", "bold", "outline", "karaoke"]).optional().describe("Caption style (default: minimal)"),
    fontSize: z.number().optional().describe("Font size (default: 24)"),
    fontColor: z.string().optional().describe("Font color (default: white)"),
    language: z.string().optional().describe("Language code for transcription (default: en)"),
    position: z.enum(["top", "center", "bottom"]).optional().describe("Caption position (default: bottom)"),
  }),
  async execute(args) {
    const result = await executeCaption(args);
    if (!result.success) return { success: false, error: result.error ?? "Caption failed" };
    return {
      success: true,
      data: { outputPath: result.outputPath, srtPath: result.srtPath, segmentCount: result.segmentCount },
      humanLines: [`✅ Captioned → ${result.outputPath}`],
    };
  },
});

// ── edit_fade ───────────────────────────────────────────────────────────────

export const editFadeTool = defineTool({
  name: "edit_fade",
  category: "edit",
  cost: "free",
  description: "Apply fade in/out effects to video and/or audio. No API key needed.",
  schema: z.object({
    videoPath: z.string().describe("Path to the input video file"),
    outputPath: z.string().describe("Path for the output video"),
    fadeIn: z.number().optional().describe("Fade-in duration in seconds (default: 1)"),
    fadeOut: z.number().optional().describe("Fade-out duration in seconds (default: 1)"),
    audioOnly: z.boolean().optional().describe("Apply fade to audio only"),
    videoOnly: z.boolean().optional().describe("Apply fade to video only"),
  }),
  async execute(args) {
    const result = await executeFade(args);
    if (!result.success) return { success: false, error: result.error ?? "Fade failed" };
    return {
      success: true,
      data: { outputPath: result.outputPath },
      humanLines: [`✅ Fade applied → ${result.outputPath}`],
    };
  },
});

// ── edit_noise_reduce ───────────────────────────────────────────────────────

export const editNoiseReduceTool = defineTool({
  name: "edit_noise_reduce",
  category: "edit",
  cost: "free",
  description: "Reduce audio/video noise using FFmpeg filters. No API key needed.",
  schema: z.object({
    inputPath: z.string().describe("Path to the input media file"),
    outputPath: z.string().describe("Path for the output file"),
    strength: z.enum(["low", "medium", "high"]).optional().describe("Noise reduction strength (default: medium)"),
    noiseFloor: z.number().optional().describe("Noise floor in dB"),
  }),
  async execute(args) {
    const result = await executeNoiseReduce(args);
    if (!result.success) return { success: false, error: result.error ?? "Noise reduce failed" };
    return {
      success: true,
      data: { outputPath: result.outputPath },
      humanLines: [`✅ Noise reduced → ${result.outputPath}`],
    };
  },
});

// ── edit_jump_cut ───────────────────────────────────────────────────────────

export const editJumpCutTool = defineTool({
  name: "edit_jump_cut",
  category: "edit",
  cost: "low",
  description:
    "Remove filler words (um, uh, like, etc.) from video using Whisper transcription. Requires OPENAI_API_KEY.",
  schema: z.object({
    videoPath: z.string().describe("Path to the input video file"),
    outputPath: z.string().describe("Path for the output video"),
    fillers: z.array(z.string()).optional().describe("Custom filler words to detect (default: um, uh, like, you know, etc.)"),
    padding: z.number().optional().describe("Padding around cuts in seconds (default: 0.05)"),
    language: z.string().optional().describe("Language code (default: en)"),
    analyzeOnly: z.boolean().optional().describe("Only analyze without cutting"),
  }),
  async execute(args) {
    const result = await executeJumpCut(args);
    if (!result.success) return { success: false, error: result.error ?? "Jump cut failed" };
    return {
      success: true,
      data: { outputPath: result.outputPath, fillerCount: result.fillerCount },
      humanLines: [`✅ Jump cut → ${result.outputPath}`],
    };
  },
});

// ── edit_text_overlay ───────────────────────────────────────────────────────

export const editTextOverlayTool = defineTool({
  name: "edit_text_overlay",
  category: "edit",
  cost: "free",
  description: "Apply text overlays on video using FFmpeg drawtext. No API key needed.",
  schema: z.object({
    videoPath: z.string().describe("Path to the input video file"),
    outputPath: z.string().describe("Path for the output video"),
    texts: z.array(z.string()).describe("Text strings to overlay"),
    style: z.enum(["lower-third", "center-bold", "subtitle", "minimal"]).optional().describe("Text overlay style (default: lower-third)"),
    fontSize: z.number().optional().describe("Font size"),
    fontColor: z.string().optional().describe("Font color (default: white)"),
    fadeDuration: z.number().optional().describe("Fade duration for text appearance in seconds"),
    startTime: z.number().optional().describe("Start time for overlay in seconds"),
    endTime: z.number().optional().describe("End time for overlay in seconds"),
  }),
  async execute(args) {
    const result = await executeTextOverlay(args);
    if (!result.success) return { success: false, error: result.error ?? "Text overlay failed" };
    return {
      success: true,
      data: { outputPath: result.outputPath },
      humanLines: [`✅ Text overlaid → ${result.outputPath}`],
    };
  },
});

// ── edit_translate_srt ──────────────────────────────────────────────────────

export const editTranslateSrtTool = defineTool({
  name: "edit_translate_srt",
  category: "edit",
  cost: "low",
  description:
    "Translate SRT subtitle files using Claude or OpenAI. Requires ANTHROPIC_API_KEY or OPENAI_API_KEY.",
  schema: z.object({
    srtPath: z.string().describe("Path to the input SRT file"),
    outputPath: z.string().describe("Path for the translated SRT file"),
    targetLanguage: z.string().describe("Target language (e.g., ko, ja, es, fr)"),
    provider: z.enum(["claude", "openai"]).optional().describe("Translation provider (default: claude)"),
    sourceLanguage: z.string().optional().describe("Source language (auto-detected if omitted)"),
  }),
  async execute(args) {
    const result = await executeTranslateSrt(args);
    if (!result.success) return { success: false, error: result.error ?? "Translation failed" };
    return {
      success: true,
      data: { outputPath: result.outputPath, segmentCount: result.segmentCount, sourceLanguage: result.sourceLanguage, targetLanguage: result.targetLanguage },
      humanLines: [`✅ Translated → ${result.outputPath}`],
    };
  },
});

// ── edit_grade ──────────────────────────────────────────────────────────────

export const editGradeTool = defineTool({
  name: "edit_grade",
  category: "edit",
  cost: "low",
  description:
    "Apply AI-generated color grading using Claude + FFmpeg. Use preset for free built-in grades, or style for custom AI-generated grades (needs ANTHROPIC_API_KEY).",
  schema: z.object({
    videoPath: z.string().describe("Input video file path"),
    style: z.string().optional().describe("Custom style description (e.g., 'cinematic warm sunset')"),
    preset: z.enum(["film-noir", "vintage", "cinematic-warm", "cool-tones", "high-contrast", "pastel", "cyberpunk", "horror"]).optional().describe("Built-in preset (no API key needed)"),
    output: z.string().optional().describe("Output video file path"),
    analyzeOnly: z.boolean().optional().describe("Show FFmpeg filter without applying"),
  }),
  async execute(args) {
    const result = await executeGrade(args);
    if (!result.success) return { success: false, error: result.error ?? "Color grading failed" };
    return {
      success: true,
      data: { outputPath: result.outputPath, style: result.style, description: result.description, ffmpegFilter: result.ffmpegFilter },
      humanLines: [`✅ Graded${result.style ? ` (${result.style})` : ""} → ${result.outputPath ?? "(analyze-only)"}`],
    };
  },
});

// ── edit_speed_ramp ─────────────────────────────────────────────────────────

export const editSpeedRampTool = defineTool({
  name: "edit_speed_ramp",
  category: "edit",
  cost: "low",
  description:
    "Apply content-aware speed ramping. Analyzes speech with Whisper, plans speed changes with Claude, applies with FFmpeg. Requires OPENAI_API_KEY + ANTHROPIC_API_KEY.",
  schema: z.object({
    videoPath: z.string().describe("Input video file path (must have audio)"),
    output: z.string().optional().describe("Output video file path"),
    style: z.enum(["dramatic", "smooth", "action"]).optional().describe("Speed ramp style (default: dramatic)"),
    minSpeed: z.number().optional().describe("Minimum speed factor (default: 0.25)"),
    maxSpeed: z.number().optional().describe("Maximum speed factor (default: 4.0)"),
    analyzeOnly: z.boolean().optional().describe("Show keyframes without applying"),
    language: z.string().optional().describe("Language code for transcription"),
  }),
  async execute(args) {
    const result = await executeSpeedRamp(args);
    if (!result.success) return { success: false, error: result.error ?? "Speed ramping failed" };
    return {
      success: true,
      data: { outputPath: result.outputPath, keyframeCount: result.keyframes?.length, avgSpeed: result.avgSpeed },
      humanLines: [`✅ Speed ramp${result.avgSpeed ? ` (avg ${result.avgSpeed.toFixed(2)}×)` : ""} → ${result.outputPath ?? "(analyze-only)"}`],
    };
  },
});

// ── edit_reframe ────────────────────────────────────────────────────────────

export const editReframeTool = defineTool({
  name: "edit_reframe",
  category: "edit",
  cost: "free",
  description: "Auto-reframe video to a different aspect ratio using smart cropping. Free (FFmpeg only).",
  schema: z.object({
    videoPath: z.string().describe("Input video file path"),
    aspect: z.string().optional().describe("Target aspect ratio: 9:16, 1:1, 4:5 (default: 9:16)"),
    focus: z.enum(["auto", "face", "center", "action"]).optional().describe("Focus mode (default: auto)"),
    output: z.string().optional().describe("Output video file path"),
    analyzeOnly: z.boolean().optional().describe("Show crop region without applying"),
  }),
  async execute(args) {
    const result = await executeReframe(args);
    if (!result.success) return { success: false, error: result.error ?? "Reframe failed" };
    return {
      success: true,
      data: { outputPath: result.outputPath, sourceAspect: result.sourceAspect, targetAspect: result.targetAspect },
      humanLines: [`✅ Reframed ${result.sourceAspect}→${result.targetAspect} → ${result.outputPath ?? "(analyze-only)"}`],
    };
  },
});

// ── edit_interpolate ────────────────────────────────────────────────────────

export const editInterpolateTool = defineTool({
  name: "edit_interpolate",
  category: "edit",
  cost: "free",
  description:
    "Create slow motion with AI frame interpolation using FFmpeg minterpolate. Free, no API key needed.",
  schema: z.object({
    videoPath: z.string().describe("Input video file path"),
    output: z.string().optional().describe("Output video file path"),
    factor: z.number().optional().describe("Slow motion factor: 2, 4, or 8 (default: 2)"),
    fps: z.number().optional().describe("Target output FPS (default: auto)"),
    quality: z.enum(["fast", "quality"]).optional().describe("Interpolation quality (default: quality)"),
  }),
  async execute(args) {
    const result = await executeInterpolate(args);
    if (!result.success) return { success: false, error: result.error ?? "Interpolation failed" };
    return {
      success: true,
      data: { outputPath: result.outputPath, originalFps: result.originalFps, targetFps: result.targetFps, factor: result.factor },
      humanLines: [`✅ Interpolated ${result.originalFps}fps→${result.targetFps}fps (×${result.factor}) → ${result.outputPath}`],
    };
  },
});

// ── edit_upscale ────────────────────────────────────────────────────────────

export const editUpscaleTool = defineTool({
  name: "edit_upscale",
  category: "edit",
  cost: "free",
  description: "Upscale video resolution using FFmpeg (Lanczos scaling). Free, no API key needed.",
  schema: z.object({
    videoPath: z.string().describe("Input video file path"),
    output: z.string().optional().describe("Output video file path"),
    scale: z.number().optional().describe("Scale factor: 2 or 4 (default: 2)"),
    quality: z.enum(["fast", "quality"]).optional().describe("Scaling quality (default: quality, uses Lanczos)"),
  }),
  async execute(args) {
    const result = await executeUpscale(args);
    if (!result.success) return { success: false, error: result.error ?? "Upscale failed" };
    return {
      success: true,
      data: { outputPath: result.outputPath, originalRes: result.originalRes, targetRes: result.targetRes },
      humanLines: [`✅ Upscaled${result.targetRes ? ` → ${result.targetRes}` : ""} → ${result.outputPath}`],
    };
  },
});

// ── edit_animated_caption ───────────────────────────────────────────────────

export const editAnimatedCaptionTool = defineTool({
  name: "edit_animated_caption",
  category: "edit",
  cost: "low",
  description:
    "Add animated word-by-word captions (TikTok/Reels style). Supports highlight, bounce, pop-in, neon, karaoke-sweep, typewriter styles. Requires OPENAI_API_KEY for Whisper.",
  schema: z.object({
    videoPath: z.string().describe("Path to the input video file"),
    outputPath: z.string().describe("Path for the output video"),
    style: z.enum(["highlight", "bounce", "pop-in", "neon", "karaoke-sweep", "typewriter"]).optional().describe("Animation style (default: highlight)"),
    highlightColor: z.string().optional().describe("Highlight/accent color (default: #FFD700)"),
    fontSize: z.number().optional().describe("Font size in pixels"),
    position: z.enum(["top", "center", "bottom"]).optional().describe("Caption position (default: bottom)"),
    wordsPerGroup: z.number().optional().describe("Words per caption group (default: 4)"),
    maxChars: z.number().optional().describe("Max characters per group (default: 30)"),
    language: z.string().optional().describe("Language code for transcription (default: en)"),
    fast: z.boolean().optional().describe("Use ASS rendering instead of Remotion (faster but fewer styles)"),
  }),
  async execute(args) {
    const result = await executeAnimatedCaption({
      ...args,
      style: args.style ?? "highlight",
      highlightColor: args.highlightColor ?? "#FFD700",
      position: args.position ?? "bottom",
    });
    if (!result.success) return { success: false, error: result.error ?? "Animated caption failed" };
    return {
      success: true,
      data: { outputPath: result.outputPath, wordCount: result.wordCount, groupCount: result.groupCount },
      humanLines: [`✅ Animated captions (${result.wordCount} words, ${result.groupCount} groups) → ${result.outputPath}`],
    };
  },
});

// ── edit_image ──────────────────────────────────────────────────────────────

export const editImageTool = defineTool({
  name: "edit_image",
  category: "edit",
  cost: "low",
  description:
    "Edit image(s) using Gemini (Nano Banana). Provide image paths and an edit prompt. Requires GOOGLE_API_KEY.",
  schema: z.object({
    imagePaths: z.array(z.string()).describe("Input image file path(s)"),
    prompt: z.string().describe("Edit instruction"),
    output: z.string().optional().describe("Output file path (default: edited.png)"),
    model: z.enum(["flash", "3.1-flash", "latest", "pro"]).optional().describe("Gemini model (default: flash)"),
    ratio: z.string().optional().describe("Output aspect ratio"),
    resolution: z.string().optional().describe("Resolution: 1K, 2K, 4K (Pro only)"),
  }),
  async execute(args) {
    const result = await executeGeminiEdit(args);
    if (!result.success) return { success: false, error: result.error ?? "Image edit failed" };
    return {
      success: true,
      data: { outputPath: result.outputPath, model: result.model },
      humanLines: [`✅ Image edited → ${result.outputPath}`],
    };
  },
});

// ── edit_fill_gaps ─────────────────────────────────────────────────────────

export const editFillGapsTool = defineTool({
  name: "edit_fill_gaps",
  category: "edit",
  cost: "high",
  description:
    "Fill timeline gaps with AI-generated video using Kling image-to-video. Detects empty regions in a project's timeline, extracts the last frame of the preceding clip, and generates a continuation video. Requires KLING_API_KEY and IMGBB_API_KEY (image hosting for Kling).",
  schema: z.object({
    projectPath: z.string().describe("Project file path (.vibe.json)"),
    output: z.string().optional().describe("Output project path (default: overwrite input)"),
    dir: z.string().optional().describe("Directory to save generated videos (default: <projectDir>/footage)"),
    prompt: z.string().optional().describe("Custom prompt for video generation (default: 'Continue the scene naturally with subtle motion')"),
    dryRun: z.boolean().optional().describe("Show gaps without generating videos"),
    mode: z.enum(["std", "pro"]).optional().describe("Kling generation mode (default: std)"),
    ratio: z.enum(["16:9", "9:16", "1:1"]).optional().describe("Aspect ratio (default: 16:9)"),
  }),
  async execute(args) {
    const result = await executeFillGaps({
      projectPath: args.projectPath,
      output: args.output,
      dir: args.dir,
      prompt: args.prompt,
      dryRun: args.dryRun,
      mode: args.mode,
      ratio: args.ratio,
    });
    if (!result.success) {
      return { success: false, error: result.error ?? "Fill gaps failed" };
    }
    return {
      success: true,
      data: {
        outputPath: result.outputPath,
        generatedCount: result.generatedCount ?? 0,
        gaps: result.gaps,
        gapsNeedingAI: result.gapsNeedingAI,
        noGaps: result.noGaps ?? false,
        allExtendable: result.allExtendable ?? false,
        dryRun: result.dryRun ?? false,
      },
      humanLines: result.humanLines,
    };
  },
});

export const editTools: readonly AnyTool[] = [
  editSilenceCutTool as unknown as AnyTool,
  editCaptionTool as unknown as AnyTool,
  editFadeTool as unknown as AnyTool,
  editNoiseReduceTool as unknown as AnyTool,
  editJumpCutTool as unknown as AnyTool,
  editTextOverlayTool as unknown as AnyTool,
  editTranslateSrtTool as unknown as AnyTool,
  editGradeTool as unknown as AnyTool,
  editSpeedRampTool as unknown as AnyTool,
  editReframeTool as unknown as AnyTool,
  editInterpolateTool as unknown as AnyTool,
  editUpscaleTool as unknown as AnyTool,
  editAnimatedCaptionTool as unknown as AnyTool,
  editImageTool as unknown as AnyTool,
  editFillGapsTool as unknown as AnyTool,
];
