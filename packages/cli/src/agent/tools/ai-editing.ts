/**
 * @module ai-editing
 * @description Agent tools for post-production editing (text overlay, review,
 * silence cut, jump cut, captions, noise reduction, fade, thumbnail,
 * SRT translation). FFmpeg-based and AI-assisted editing tools for agent use.
 * Most tools work without API keys (FFmpeg-only), some use Gemini or OpenAI.
 *
 * ## Tools: edit_text_overlay, analyze_review, edit_silence_cut, edit_jump_cut, edit_caption,
 *          edit_noise_reduce, edit_fade, generate_thumbnail, edit_translate_srt
 * ## Dependencies: FFmpeg, Gemini (optional), OpenAI/Whisper (optional)
 * @see MODELS.md for the Single Source of Truth (SSOT) on supported providers/models
 */

import { resolve } from "node:path";
import type { ToolRegistry, ToolHandler } from "./index.js";
import type { ToolDefinition, ToolResult } from "../types.js";
import { MIGRATED } from "../../tools/define-tool.js";
import {
  executeTextOverlay,
  executeSilenceCut,
  executeJumpCut,
  executeCaption,
  executeNoiseReduce,
  executeFade,
  executeTranslateSrt,
  type TextOverlayStyle,
  type CaptionStyle,
} from "../../commands/ai-edit.js";
import {
  executeGrade,
  executeSpeedRamp,
  executeReframe,
  executeInterpolate,
  executeUpscale,
} from "../../commands/edit-cmd.js";
import { executeReview } from "../../commands/ai-review.js";
import { executeSuggestEdit } from "../../commands/ai-suggest-edit.js";
import { executeThumbnailBestFrame } from "../../commands/ai-image.js";
import { sanitizeAIResult } from "../../commands/sanitize.js";

// ============================================================================
// Tool Definitions
// ============================================================================

const textOverlayDef: ToolDefinition = {
  name: "edit_text_overlay",
  description: "Apply text overlays to a video using FFmpeg drawtext. Supports 4 style presets: lower-third, center-bold, subtitle, minimal. Auto-detects font and scales based on video resolution.",
  parameters: {
    type: "object",
    properties: {
      videoPath: {
        type: "string",
        description: "Path to input video file",
      },
      texts: {
        type: "array",
        items: { type: "string", description: "Text line to overlay" },
        description: "Text lines to overlay (multiple lines stack vertically)",
      },
      outputPath: {
        type: "string",
        description: "Output video file path",
      },
      style: {
        type: "string",
        description: "Overlay style preset",
        enum: ["lower-third", "center-bold", "subtitle", "minimal"],
      },
      fontSize: {
        type: "number",
        description: "Font size in pixels (auto-calculated if omitted)",
      },
      fontColor: {
        type: "string",
        description: "Font color (default: white)",
      },
      fadeDuration: {
        type: "number",
        description: "Fade in/out duration in seconds (default: 0.3)",
      },
      startTime: {
        type: "number",
        description: "Start time for overlay in seconds (default: 0)",
      },
      endTime: {
        type: "number",
        description: "End time for overlay in seconds (default: video duration)",
      },
    },
    required: ["videoPath", "texts", "outputPath"],
  },
};

const reviewDef: ToolDefinition = {
  name: "analyze_review",
  description: "Review video quality using Gemini AI. Analyzes pacing, color, text readability, audio-visual sync, and composition. Can auto-apply fixable corrections (color grading). Returns structured feedback with scores and recommendations.",
  parameters: {
    type: "object",
    properties: {
      videoPath: {
        type: "string",
        description: "Path to video file to review",
      },
      storyboardPath: {
        type: "string",
        description: "Optional path to storyboard JSON for context",
      },
      autoApply: {
        type: "boolean",
        description: "Automatically apply fixable corrections (default: false)",
      },
      verify: {
        type: "boolean",
        description: "Run verification pass after applying fixes (default: false)",
      },
      model: {
        type: "string",
        description: "Gemini model: flash (default), flash-2.5, pro",
        enum: ["flash", "flash-2.5", "pro"],
      },
      outputPath: {
        type: "string",
        description: "Output path for corrected video (when autoApply is true)",
      },
    },
    required: ["videoPath"],
  },
};

const silenceCutDef: ToolDefinition = {
  name: "edit_silence_cut",
  description: "Remove silent segments from a video. Default uses FFmpeg silencedetect (free, no API key). Use useGemini=true for smart context-aware detection via Gemini Video Understanding — distinguishes dead air from intentional pauses using visual+audio analysis.",
  parameters: {
    type: "object",
    properties: {
      videoPath: {
        type: "string",
        description: "Path to input video file",
      },
      outputPath: {
        type: "string",
        description: "Output file path (default: <name>-cut.<ext>)",
      },
      noiseThreshold: {
        type: "number",
        description: "Silence threshold in dB (default: -30). Lower = more sensitive. FFmpeg mode only.",
      },
      minDuration: {
        type: "number",
        description: "Minimum silence duration in seconds to cut (default: 0.5)",
      },
      padding: {
        type: "number",
        description: "Padding around non-silent segments in seconds (default: 0.1)",
      },
      analyzeOnly: {
        type: "boolean",
        description: "Only detect silence without cutting (default: false)",
      },
      useGemini: {
        type: "boolean",
        description: "Use Gemini Video Understanding for context-aware silence detection (default: false). Requires GOOGLE_API_KEY.",
      },
      model: {
        type: "string",
        description: "Gemini model to use (default: flash). Options: flash, flash-2.5, pro",
      },
      lowRes: {
        type: "boolean",
        description: "Low resolution mode for longer videos (Gemini only)",
      },
    },
    required: ["videoPath"],
  },
};

const jumpCutDef: ToolDefinition = {
  name: "edit_jump_cut",
  description: "Remove filler words (um, uh, like, etc.) from video using Whisper word-level timestamps + FFmpeg concat. Requires OpenAI API key. Detects filler words, cuts them out, and stitches remaining segments with stream copy (fast, no re-encode).",
  parameters: {
    type: "object",
    properties: {
      videoPath: {
        type: "string",
        description: "Path to input video file",
      },
      outputPath: {
        type: "string",
        description: "Output file path (default: <name>-jumpcut.<ext>)",
      },
      fillers: {
        type: "array",
        items: { type: "string", description: "A filler word to detect" },
        description: "Custom filler words to detect (default: um, uh, like, you know, etc.)",
      },
      padding: {
        type: "number",
        description: "Padding around cuts in seconds (default: 0.05)",
      },
      language: {
        type: "string",
        description: "Language code for transcription (e.g., en, ko)",
      },
      analyzeOnly: {
        type: "boolean",
        description: "Only detect fillers without cutting (default: false)",
      },
    },
    required: ["videoPath"],
  },
};

const captionDef: ToolDefinition = {
  name: "edit_caption",
  description: "Transcribe video with Whisper and burn styled captions using FFmpeg. Requires OpenAI API key. 4 style presets: minimal, bold (default), outline, karaoke. Auto-sizes font based on video resolution.",
  parameters: {
    type: "object",
    properties: {
      videoPath: {
        type: "string",
        description: "Path to input video file",
      },
      outputPath: {
        type: "string",
        description: "Output file path (default: <name>-captioned.<ext>)",
      },
      style: {
        type: "string",
        description: "Caption style preset",
        enum: ["minimal", "bold", "outline", "karaoke"],
      },
      fontSize: {
        type: "number",
        description: "Font size in pixels (auto-calculated based on resolution if omitted)",
      },
      fontColor: {
        type: "string",
        description: "Font color (default: white)",
      },
      language: {
        type: "string",
        description: "Language code for transcription (e.g., en, ko)",
      },
      position: {
        type: "string",
        description: "Caption position",
        enum: ["top", "center", "bottom"],
      },
    },
    required: ["videoPath"],
  },
};

const noiseReduceDef: ToolDefinition = {
  name: "edit_noise_reduce",
  description: "Remove background noise from audio/video using FFmpeg afftdn filter. No API key needed. Three strength presets: low, medium (default), high. High adds bandpass filtering.",
  parameters: {
    type: "object",
    properties: {
      inputPath: {
        type: "string",
        description: "Path to input audio or video file",
      },
      outputPath: {
        type: "string",
        description: "Output file path (default: <name>-denoised.<ext>)",
      },
      strength: {
        type: "string",
        description: "Noise reduction strength",
        enum: ["low", "medium", "high"],
      },
      noiseFloor: {
        type: "number",
        description: "Custom noise floor in dB (overrides strength preset)",
      },
    },
    required: ["inputPath"],
  },
};

const fadeDef: ToolDefinition = {
  name: "edit_fade",
  description: "Apply fade in/out effects to video using FFmpeg. No API key needed. Supports video-only, audio-only, or both. Configurable fade durations.",
  parameters: {
    type: "object",
    properties: {
      videoPath: {
        type: "string",
        description: "Path to input video file",
      },
      outputPath: {
        type: "string",
        description: "Output file path (default: <name>-faded.<ext>)",
      },
      fadeIn: {
        type: "number",
        description: "Fade-in duration in seconds (default: 1)",
      },
      fadeOut: {
        type: "number",
        description: "Fade-out duration in seconds (default: 1)",
      },
      audioOnly: {
        type: "boolean",
        description: "Apply fade to audio only (default: false)",
      },
      videoOnly: {
        type: "boolean",
        description: "Apply fade to video only (default: false)",
      },
    },
    required: ["videoPath"],
  },
};

const thumbnailBestFrameDef: ToolDefinition = {
  name: "generate_thumbnail",
  description: "Extract the best thumbnail frame from a video using Gemini AI analysis + FFmpeg frame extraction. Requires GOOGLE_API_KEY. Finds visually striking, well-composed frames.",
  parameters: {
    type: "object",
    properties: {
      videoPath: {
        type: "string",
        description: "Path to input video file",
      },
      outputPath: {
        type: "string",
        description: "Output image path (default: <name>-thumbnail.png)",
      },
      prompt: {
        type: "string",
        description: "Custom prompt for frame selection analysis",
      },
      model: {
        type: "string",
        description: "Gemini model to use",
        enum: ["flash", "flash-2.5", "pro"],
      },
    },
    required: ["videoPath"],
  },
};

const translateSrtDef: ToolDefinition = {
  name: "edit_translate_srt",
  description: "Translate SRT subtitle file to another language using Claude or OpenAI. Preserves timestamps. Batches segments for efficiency.",
  parameters: {
    type: "object",
    properties: {
      srtPath: {
        type: "string",
        description: "Path to input SRT file",
      },
      outputPath: {
        type: "string",
        description: "Output file path (default: <name>-<target>.srt)",
      },
      targetLanguage: {
        type: "string",
        description: "Target language (e.g., ko, es, fr, ja, zh)",
      },
      provider: {
        type: "string",
        description: "Translation provider",
        enum: ["claude", "openai"],
      },
      sourceLanguage: {
        type: "string",
        description: "Source language (auto-detected if omitted)",
      },
    },
    required: ["srtPath", "targetLanguage"],
  },
};

// ============================================================================
// Tool Handlers
// ============================================================================

const textOverlayHandler: ToolHandler = async (args) => {
  const { videoPath, texts, outputPath, style, fontSize, fontColor, fadeDuration, startTime, endTime } = args as {
    videoPath: string;
    texts: string[];
    outputPath: string;
    style?: TextOverlayStyle;
    fontSize?: number;
    fontColor?: string;
    fadeDuration?: number;
    startTime?: number;
    endTime?: number;
  };

  if (!videoPath || !texts || texts.length === 0 || !outputPath) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: "videoPath, texts (non-empty array), and outputPath are required",
    };
  }

  const result = await executeTextOverlay({
    videoPath,
    texts,
    outputPath,
    style,
    fontSize,
    fontColor,
    fadeDuration,
    startTime,
    endTime,
  });

  if (!result.success) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: result.error || "Text overlay failed",
    };
  }

  return {
    toolCallId: "",
    success: true,
    output: `Text overlay applied: ${result.outputPath}`,
  };
};

const reviewHandler: ToolHandler = async (args) => {
  const { videoPath, storyboardPath, autoApply, verify, model, outputPath } = args as {
    videoPath: string;
    storyboardPath?: string;
    autoApply?: boolean;
    verify?: boolean;
    model?: "flash" | "flash-2.5" | "pro";
    outputPath?: string;
  };

  if (!videoPath) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: "videoPath is required",
    };
  }

  const result = await executeReview({
    videoPath,
    storyboardPath,
    autoApply,
    verify,
    model,
    outputPath,
  });

  if (!result.success) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: result.error || "Video review failed",
    };
  }

  const fb = sanitizeAIResult(result.feedback!);
  let output = `Video Review: ${fb.overallScore}/10\n`;
  output += `Pacing: ${fb.categories.pacing.score}/10, Color: ${fb.categories.color.score}/10, `;
  output += `Text: ${fb.categories.textReadability.score}/10, AV Sync: ${fb.categories.audioVisualSync.score}/10, `;
  output += `Composition: ${fb.categories.composition.score}/10\n`;

  if (result.appliedFixes && result.appliedFixes.length > 0) {
    output += `Applied fixes: ${sanitizeAIResult(result.appliedFixes).join("; ")}\n`;
  }
  if (result.verificationScore !== undefined) {
    output += `Verification score: ${result.verificationScore}/10\n`;
  }
  if (fb.recommendations.length > 0) {
    output += `Recommendations: ${fb.recommendations.join("; ")}`;
  }

  return {
    toolCallId: "",
    success: true,
    output,
  };
};

const silenceCutHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const videoPath = resolve(context.workingDirectory, args.videoPath as string);
  const ext = videoPath.split(".").pop() || "mp4";
  const name = videoPath.replace(/\.[^.]+$/, "");
  const outputPath = args.outputPath
    ? resolve(context.workingDirectory, args.outputPath as string)
    : `${name}-cut.${ext}`;

  try {
    const result = await executeSilenceCut({
      videoPath,
      outputPath,
      noiseThreshold: args.noiseThreshold as number | undefined,
      minDuration: args.minDuration as number | undefined,
      padding: args.padding as number | undefined,
      analyzeOnly: args.analyzeOnly as boolean | undefined,
      useGemini: args.useGemini as boolean | undefined,
      model: args.model as string | undefined,
      lowRes: args.lowRes as boolean | undefined,
    });

    if (!result.success) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: result.error || "Silence cut failed",
      };
    }

    const lines: string[] = [];
    lines.push(`Detection method: ${result.method === "gemini" ? "Gemini Video Understanding" : "FFmpeg silencedetect"}`);
    lines.push(`Total duration: ${result.totalDuration!.toFixed(1)}s`);
    lines.push(`Silent periods: ${result.silentPeriods!.length}`);
    lines.push(`Silent duration: ${result.silentDuration!.toFixed(1)}s`);
    lines.push(`Non-silent duration: ${(result.totalDuration! - result.silentDuration!).toFixed(1)}s`);

    if (result.outputPath) {
      lines.push(`Output: ${result.outputPath}`);
    }

    return {
      toolCallId: "",
      success: true,
      output: lines.join("\n"),
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Silence cut failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const jumpCutHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const videoPath = resolve(context.workingDirectory, args.videoPath as string);
  const ext = videoPath.split(".").pop() || "mp4";
  const name = videoPath.replace(/\.[^.]+$/, "");
  const outputPath = args.outputPath
    ? resolve(context.workingDirectory, args.outputPath as string)
    : `${name}-jumpcut.${ext}`;

  try {
    const result = await executeJumpCut({
      videoPath,
      outputPath,
      fillers: args.fillers as string[] | undefined,
      padding: args.padding as number | undefined,
      language: args.language as string | undefined,
      analyzeOnly: args.analyzeOnly as boolean | undefined,
    });

    if (!result.success) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: result.error || "Jump cut failed",
      };
    }

    const lines: string[] = [];
    lines.push(`Total duration: ${result.totalDuration!.toFixed(1)}s`);
    lines.push(`Filler words found: ${result.fillerCount}`);
    lines.push(`Filler duration: ${result.fillerDuration!.toFixed(1)}s`);
    lines.push(`Clean duration: ${(result.totalDuration! - result.fillerDuration!).toFixed(1)}s`);

    if (result.fillers && result.fillers.length > 0) {
      lines.push("");
      lines.push("Detected fillers:");
      for (const filler of result.fillers) {
        lines.push(`  "${filler.word}" at ${filler.start.toFixed(2)}s - ${filler.end.toFixed(2)}s`);
      }
    }

    if (result.outputPath) {
      lines.push(`Output: ${result.outputPath}`);
    }

    return {
      toolCallId: "",
      success: true,
      output: lines.join("\n"),
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Jump cut failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const captionHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const videoPath = resolve(context.workingDirectory, args.videoPath as string);
  const ext = videoPath.split(".").pop() || "mp4";
  const name = videoPath.replace(/\.[^.]+$/, "");
  const outputPath = args.outputPath
    ? resolve(context.workingDirectory, args.outputPath as string)
    : `${name}-captioned.${ext}`;

  try {
    const result = await executeCaption({
      videoPath,
      outputPath,
      style: args.style as CaptionStyle | undefined,
      fontSize: args.fontSize as number | undefined,
      fontColor: args.fontColor as string | undefined,
      language: args.language as string | undefined,
      position: args.position as "top" | "center" | "bottom" | undefined,
    });

    if (!result.success) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: result.error || "Caption failed",
      };
    }

    const lines: string[] = [];
    lines.push(`Captions applied: ${result.outputPath}`);
    lines.push(`Segments transcribed: ${result.segmentCount}`);
    if (result.srtPath) {
      lines.push(`SRT file: ${result.srtPath}`);
    }

    return {
      toolCallId: "",
      success: true,
      output: lines.join("\n"),
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Caption failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const noiseReduceHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const inputPath = resolve(context.workingDirectory, args.inputPath as string);
  const ext = inputPath.split(".").pop() || "mp4";
  const name = inputPath.replace(/\.[^.]+$/, "");
  const outputPath = args.outputPath
    ? resolve(context.workingDirectory, args.outputPath as string)
    : `${name}-denoised.${ext}`;

  try {
    const result = await executeNoiseReduce({
      inputPath,
      outputPath,
      strength: args.strength as "low" | "medium" | "high" | undefined,
      noiseFloor: args.noiseFloor as number | undefined,
    });

    if (!result.success) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: result.error || "Noise reduction failed",
      };
    }

    const lines: string[] = [];
    lines.push(`Noise reduction applied: ${result.outputPath}`);
    lines.push(`Input duration: ${result.inputDuration!.toFixed(1)}s`);

    return {
      toolCallId: "",
      success: true,
      output: lines.join("\n"),
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Noise reduction failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const fadeHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const videoPath = resolve(context.workingDirectory, args.videoPath as string);
  const ext = videoPath.split(".").pop() || "mp4";
  const name = videoPath.replace(/\.[^.]+$/, "");
  const outputPath = args.outputPath
    ? resolve(context.workingDirectory, args.outputPath as string)
    : `${name}-faded.${ext}`;

  try {
    const result = await executeFade({
      videoPath,
      outputPath,
      fadeIn: args.fadeIn as number | undefined,
      fadeOut: args.fadeOut as number | undefined,
      audioOnly: args.audioOnly as boolean | undefined,
      videoOnly: args.videoOnly as boolean | undefined,
    });

    if (!result.success) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: result.error || "Fade failed",
      };
    }

    const lines: string[] = [];
    lines.push(`Fade effects applied: ${result.outputPath}`);
    lines.push(`Total duration: ${result.totalDuration!.toFixed(1)}s`);
    if (result.fadeInApplied) lines.push(`Fade-in applied`);
    if (result.fadeOutApplied) lines.push(`Fade-out applied`);

    return {
      toolCallId: "",
      success: true,
      output: lines.join("\n"),
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Fade failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const thumbnailBestFrameHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const videoPath = resolve(context.workingDirectory, args.videoPath as string);
  const name = videoPath.replace(/\.[^.]+$/, "");
  const outputPath = args.outputPath
    ? resolve(context.workingDirectory, args.outputPath as string)
    : `${name}-thumbnail.png`;

  try {
    const result = await executeThumbnailBestFrame({
      videoPath,
      outputPath,
      prompt: args.prompt as string | undefined,
      model: args.model as string | undefined,
    });

    if (!result.success) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: result.error || "Best frame extraction failed",
      };
    }

    const lines: string[] = [];
    lines.push(`Best frame extracted: ${result.outputPath}`);
    lines.push(`Timestamp: ${result.timestamp!.toFixed(2)}s`);
    if (result.reason) lines.push(`Reason: ${sanitizeAIResult(result.reason)}`);

    return {
      toolCallId: "",
      success: true,
      output: lines.join("\n"),
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Best frame extraction failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const translateSrtHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const srtPath = resolve(context.workingDirectory, args.srtPath as string);
  const target = args.targetLanguage as string;
  const ext = srtPath.split(".").pop() || "srt";
  const name = srtPath.replace(/\.[^.]+$/, "");
  const outputPath = args.outputPath
    ? resolve(context.workingDirectory, args.outputPath as string)
    : `${name}-${target}.${ext}`;

  try {
    const result = await executeTranslateSrt({
      srtPath,
      outputPath,
      targetLanguage: target,
      provider: args.provider as "claude" | "openai" | undefined,
      sourceLanguage: args.sourceLanguage as string | undefined,
    });

    if (!result.success) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: result.error || "Translation failed",
      };
    }

    const lines: string[] = [];
    lines.push(`Translation complete: ${result.outputPath}`);
    lines.push(`Segments translated: ${result.segmentCount}`);
    lines.push(`Target language: ${result.targetLanguage}`);

    return {
      toolCallId: "",
      success: true,
      output: lines.join("\n"),
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Translation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

// ============================================================================
// analyze_suggest — Gemini-driven edit suggestions for a project
// ============================================================================

const analyzeSuggestDef: ToolDefinition = {
  name: "analyze_suggest",
  description: "Get natural-language edit suggestions for a project from Gemini. With `apply: true`, applies the first suggestion in place. Requires GOOGLE_API_KEY.",
  parameters: {
    type: "object",
    properties: {
      projectPath: { type: "string",  description: "Project file path (.vibe.json)" },
      instruction: { type: "string",  description: "Natural-language instruction (e.g. 'trim all clips to 5 seconds')" },
      apply:       { type: "boolean", description: "Apply the first suggestion in place" },
    },
    required: ["projectPath", "instruction"],
  },
};

const analyzeSuggestHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const result = await executeSuggestEdit({
    projectPath: resolve(context.workingDirectory, args.projectPath as string),
    instruction: args.instruction as string,
    apply: args.apply as boolean | undefined,
  });
  if (!result.success) {
    return { toolCallId: "", success: false, output: "", error: result.error ?? "analyze_suggest failed" };
  }
  const lines: string[] = [`Found ${result.suggestions?.length ?? 0} suggestion(s)`];
  result.suggestions?.forEach((s, i) => {
    lines.push(`  [${i + 1}] ${s.type.toUpperCase()} (conf ${(s.confidence * 100).toFixed(0)}%) — ${s.description}`);
  });
  if (result.applied) lines.push(`Applied first suggestion → ${result.outputPath}`);
  return { toolCallId: "", success: true, output: lines.join("\n") };
};

// ============================================================================
// v0.55+ edit primitives — colour grade / speed ramp / reframe / interpolate / upscale
// ============================================================================

const editGradeDef: ToolDefinition = {
  name: "edit_grade",
  description: "Apply AI-generated colour grading. Claude inspects the video and emits an FFmpeg grading filter chain. Requires ANTHROPIC_API_KEY.",
  parameters: {
    type: "object",
    properties: {
      videoPath:   { type: "string",  description: "Input video file" },
      style:       { type: "string",  description: "Free-form grade style (e.g. 'cinematic teal-orange')" },
      preset:      { type: "string",  description: "Named preset (cinematic, vintage, cool, warm, b&w)" },
      output:      { type: "string",  description: "Output file path" },
      analyzeOnly: { type: "boolean", description: "Return proposed FFmpeg filter without rendering" },
    },
    required: ["videoPath"],
  },
};

const editGradeHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const result = await executeGrade({
    videoPath: resolve(context.workingDirectory, args.videoPath as string),
    style: args.style as string | undefined,
    preset: args.preset as string | undefined,
    output: args.output ? resolve(context.workingDirectory, args.output as string) : undefined,
    analyzeOnly: args.analyzeOnly as boolean | undefined,
  });
  if (!result.success) return { toolCallId: "", success: false, output: "", error: result.error ?? "edit_grade failed" };
  return { toolCallId: "", success: true, output: `Graded (${result.style ?? "preset"}) → ${result.outputPath ?? "(analyze-only)"}` };
};

const editSpeedRampDef: ToolDefinition = {
  name: "edit_speed_ramp",
  description: "Content-aware variable-speed ramping. Whisper transcribes; Claude picks keyframes. Requires OPENAI_API_KEY + ANTHROPIC_API_KEY.",
  parameters: {
    type: "object",
    properties: {
      videoPath:   { type: "string",  description: "Input video file" },
      output:      { type: "string",  description: "Output file path" },
      style:       { type: "string",  description: "Ramp style", enum: ["dramatic", "smooth", "action"] },
      minSpeed:    { type: "number",  description: "Min speed multiplier (default 0.5)" },
      maxSpeed:    { type: "number",  description: "Max speed multiplier (default 3.0)" },
      analyzeOnly: { type: "boolean", description: "Return proposed keyframes without rendering" },
      language:    { type: "string",  description: "Whisper language hint" },
    },
    required: ["videoPath"],
  },
};

const editSpeedRampHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const result = await executeSpeedRamp({
    videoPath: resolve(context.workingDirectory, args.videoPath as string),
    output: args.output ? resolve(context.workingDirectory, args.output as string) : undefined,
    style: args.style as "dramatic" | "smooth" | "action" | undefined,
    minSpeed: args.minSpeed as number | undefined,
    maxSpeed: args.maxSpeed as number | undefined,
    analyzeOnly: args.analyzeOnly as boolean | undefined,
    language: args.language as string | undefined,
  });
  if (!result.success) return { toolCallId: "", success: false, output: "", error: result.error ?? "edit_speed_ramp failed" };
  return { toolCallId: "", success: true, output: `Speed ramp (avg ${result.avgSpeed?.toFixed(2)}×, ${result.keyframes?.length ?? 0} keyframes) → ${result.outputPath ?? "(analyze-only)"}` };
};

const editReframeDef: ToolDefinition = {
  name: "edit_reframe",
  description: "Auto-reframe video to a different aspect ratio. Claude Vision inspects keyframes for subject tracking. Requires ANTHROPIC_API_KEY.",
  parameters: {
    type: "object",
    properties: {
      videoPath:   { type: "string",  description: "Input video file" },
      aspect:      { type: "string",  description: "Target aspect (e.g. '9:16', '1:1', '16:9')" },
      focus:       { type: "string",  description: "Subject focus mode", enum: ["auto", "face", "center", "action"] },
      output:      { type: "string",  description: "Output file path" },
      analyzeOnly: { type: "boolean", description: "Return proposed keyframes without rendering" },
    },
    required: ["videoPath"],
  },
};

const editReframeHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const result = await executeReframe({
    videoPath: resolve(context.workingDirectory, args.videoPath as string),
    aspect: args.aspect as string | undefined,
    focus: args.focus as "auto" | "face" | "center" | "action" | undefined,
    output: args.output ? resolve(context.workingDirectory, args.output as string) : undefined,
    analyzeOnly: args.analyzeOnly as boolean | undefined,
  });
  if (!result.success) return { toolCallId: "", success: false, output: "", error: result.error ?? "edit_reframe failed" };
  return { toolCallId: "", success: true, output: `Reframed ${result.sourceAspect}→${result.targetAspect} (${result.keyframeCount} keyframes) → ${result.outputPath ?? "(analyze-only)"}` };
};

const editInterpolateDef: ToolDefinition = {
  name: "edit_interpolate",
  description: "Frame-interpolate video for smooth slow-motion or higher framerate. FFmpeg minterpolate (no API key needed).",
  parameters: {
    type: "object",
    properties: {
      videoPath: { type: "string", description: "Input video file" },
      output:    { type: "string", description: "Output file path" },
      factor:    { type: "number", description: "Interpolation factor (e.g. 2 doubles framerate)" },
      fps:       { type: "number", description: "Explicit target fps (overrides factor)" },
      quality:   { type: "string", description: "Speed/quality tradeoff", enum: ["fast", "quality"] },
    },
    required: ["videoPath"],
  },
};

const editInterpolateHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const result = await executeInterpolate({
    videoPath: resolve(context.workingDirectory, args.videoPath as string),
    output: args.output ? resolve(context.workingDirectory, args.output as string) : undefined,
    factor: args.factor as number | undefined,
    fps: args.fps as number | undefined,
    quality: args.quality as "fast" | "quality" | undefined,
  });
  if (!result.success) return { toolCallId: "", success: false, output: "", error: result.error ?? "edit_interpolate failed" };
  return { toolCallId: "", success: true, output: `Interpolated ${result.originalFps}fps→${result.targetFps}fps (×${result.factor}) → ${result.outputPath}` };
};

const editUpscaleDef: ToolDefinition = {
  name: "edit_upscale",
  description: "Upscale video resolution. Local ffmpeg lanczos by default; Topaz Video AI when available.",
  parameters: {
    type: "object",
    properties: {
      videoPath: { type: "string", description: "Input video file" },
      output:    { type: "string", description: "Output file path" },
      scale:     { type: "number", description: "Scale factor (e.g. 2 for 2× upscale)" },
    },
    required: ["videoPath"],
  },
};

const editUpscaleHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const result = await executeUpscale({
    videoPath: resolve(context.workingDirectory, args.videoPath as string),
    output: args.output ? resolve(context.workingDirectory, args.output as string) : undefined,
    scale: args.scale as number | undefined,
  });
  if (!result.success) return { toolCallId: "", success: false, output: "", error: result.error ?? "edit_upscale failed" };
  return { toolCallId: "", success: true, output: `Upscaled → ${result.outputPath}` };
};

// ============================================================================
// Registration
// ============================================================================

export function registerEditingTools(registry: ToolRegistry): void {
  // Manifest takes precedence — skip names already sourced from
  // packages/cli/src/tools/manifest. Same pattern as scene.ts/timeline.ts.
  if (!MIGRATED.has(textOverlayDef.name))        registry.register(textOverlayDef, textOverlayHandler);
  if (!MIGRATED.has(reviewDef.name))             registry.register(reviewDef, reviewHandler);
  if (!MIGRATED.has(silenceCutDef.name))         registry.register(silenceCutDef, silenceCutHandler);
  if (!MIGRATED.has(jumpCutDef.name))            registry.register(jumpCutDef, jumpCutHandler);
  if (!MIGRATED.has(captionDef.name))            registry.register(captionDef, captionHandler);
  if (!MIGRATED.has(noiseReduceDef.name))        registry.register(noiseReduceDef, noiseReduceHandler);
  if (!MIGRATED.has(fadeDef.name))               registry.register(fadeDef, fadeHandler);
  if (!MIGRATED.has(thumbnailBestFrameDef.name)) registry.register(thumbnailBestFrameDef, thumbnailBestFrameHandler);
  if (!MIGRATED.has(translateSrtDef.name))       registry.register(translateSrtDef, translateSrtHandler);
  if (!MIGRATED.has(editGradeDef.name))          registry.register(editGradeDef, editGradeHandler);
  if (!MIGRATED.has(editSpeedRampDef.name))      registry.register(editSpeedRampDef, editSpeedRampHandler);
  if (!MIGRATED.has(editReframeDef.name))        registry.register(editReframeDef, editReframeHandler);
  if (!MIGRATED.has(editInterpolateDef.name))    registry.register(editInterpolateDef, editInterpolateHandler);
  if (!MIGRATED.has(editUpscaleDef.name))        registry.register(editUpscaleDef, editUpscaleHandler);
  if (!MIGRATED.has(analyzeSuggestDef.name))     registry.register(analyzeSuggestDef, analyzeSuggestHandler);
}
