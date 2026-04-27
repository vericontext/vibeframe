/**
 * @module ai-pipeline
 * @description Agent tools for advanced multi-step AI pipelines (script-to-video,
 * highlights, auto-shorts, analysis, editing, regeneration). Orchestrates
 * multiple AI providers via execute functions from CLI commands.
 *
 * ## Tools: pipeline_script_to_video, pipeline_highlights, pipeline_auto_shorts, analyze_video,
 *          analyze_media, edit_image, pipeline_regenerate_scene
 * ## Dependencies: Claude, Gemini, OpenAI, Whisper, ElevenLabs, Kling
 * @see MODELS.md for the Single Source of Truth (SSOT) on supported providers/models
 */

import { writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ToolRegistry, ToolHandler } from "./index.js";
import type { ToolDefinition, ToolResult } from "../types.js";
import { MIGRATED } from "../../tools/define-tool.js";
import { getApiKeyFromConfig } from "../../config/index.js";
import {
  executeScriptToVideo,
  executeRegenerateScene,
} from "../../commands/ai-script-pipeline.js";
import {
  executeAnimatedCaption,
  type AnimatedCaptionStyle,
} from "../../commands/ai-animated-caption.js";
import {
  executeHighlights,
  executeAutoShorts,
} from "../../commands/ai-highlights.js";
import {
  executeGeminiVideo,
  executeAnalyze,
} from "../../commands/ai-analyze.js";
import { sanitizeAIResult } from "../../commands/sanitize.js";

// Helper to get timestamp for filenames
function getTimestamp(): string {
  return Date.now().toString();
}

// ============================================================================
// Tool Definitions
// ============================================================================

const scriptToVideoDef: ToolDefinition = {
  name: "pipeline_script_to_video",
  description:
    "Generate complete video from text script. Full pipeline: storyboard (Claude/OpenAI/Gemini) → ElevenLabs TTS → Image gen (DALL-E/Gemini) → Video gen (Runway/Kling). Creates project file with all assets.",
  parameters: {
    type: "object",
    properties: {
      script: {
        type: "string",
        description: "Script text for video (e.g., 'Product introduction. Feature showcase. Call to action.')",
      },
      outputDir: {
        type: "string",
        description: "Output directory for assets (default: script-video-output)",
      },
      duration: {
        type: "number",
        description: "Target total duration in seconds",
      },
      voice: {
        type: "string",
        description: "ElevenLabs voice ID for narration",
      },
      generator: {
        type: "string",
        description: "Video generator to use",
        enum: ["runway", "kling"],
      },
      imageProvider: {
        type: "string",
        description: "Image provider to use",
        enum: ["openai", "gemini", "grok"],
      },
      aspectRatio: {
        type: "string",
        description: "Aspect ratio for output",
        enum: ["16:9", "9:16", "1:1"],
      },
      imagesOnly: {
        type: "boolean",
        description: "Generate images only, skip video generation",
      },
      noVoiceover: {
        type: "boolean",
        description: "Skip voiceover generation",
      },
      retries: {
        type: "number",
        description: "Number of retries for video generation failures (default: 2)",
      },
      creativity: {
        type: "string",
        description: "Creativity level for storyboard: 'low' (default, consistent scenes) or 'high' (varied, unexpected scenes)",
        enum: ["low", "high"],
      },
      storyboardProvider: {
        type: "string",
        description: "Provider for storyboard generation: 'claude' (default), 'openai', or 'gemini'",
        enum: ["claude", "openai", "gemini"],
      },
    },
    required: ["script"],
  },
};

const highlightsDef: ToolDefinition = {
  name: "pipeline_highlights",
  description:
    "Extract highlights from long-form video/audio content. Uses Whisper+Claude or Gemini Video Understanding to find engaging moments. Returns timestamps and can create highlight reel project.",
  parameters: {
    type: "object",
    properties: {
      media: {
        type: "string",
        description: "Video or audio file path",
      },
      output: {
        type: "string",
        description: "Output JSON file path for highlights data",
      },
      project: {
        type: "string",
        description: "Create a VibeFrame project file with highlight clips",
      },
      duration: {
        type: "number",
        description: "Target highlight reel duration in seconds",
      },
      count: {
        type: "number",
        description: "Maximum number of highlights to extract",
      },
      threshold: {
        type: "number",
        description: "Confidence threshold (0-1, default: 0.7)",
      },
      criteria: {
        type: "string",
        description: "Selection criteria for highlights",
        enum: ["emotional", "informative", "funny", "all"],
      },
      language: {
        type: "string",
        description: "Language code for transcription (e.g., en, ko)",
      },
      useGemini: {
        type: "boolean",
        description: "Use Gemini Video Understanding for visual+audio analysis (recommended for video)",
      },
      lowRes: {
        type: "boolean",
        description: "Use low resolution mode for longer videos (Gemini only)",
      },
    },
    required: ["media"],
  },
};

const autoShortsDef: ToolDefinition = {
  name: "pipeline_auto_shorts",
  description:
    "Auto-generate vertical shorts from long-form video. Finds viral-worthy moments, crops to vertical format, and exports as separate short videos. Perfect for TikTok, YouTube Shorts, Instagram Reels.",
  parameters: {
    type: "object",
    properties: {
      video: {
        type: "string",
        description: "Input video file path",
      },
      outputDir: {
        type: "string",
        description: "Output directory for generated shorts",
      },
      duration: {
        type: "number",
        description: "Target duration for each short (15-60 seconds, default: 60)",
      },
      count: {
        type: "number",
        description: "Number of shorts to generate (default: 1)",
      },
      aspect: {
        type: "string",
        description: "Aspect ratio for shorts",
        enum: ["9:16", "1:1"],
      },
      addCaptions: {
        type: "boolean",
        description: "Add auto-generated captions",
      },
      captionStyle: {
        type: "string",
        description: "Caption style",
        enum: ["minimal", "bold", "animated"],
      },
      analyzeOnly: {
        type: "boolean",
        description: "Show detected segments without generating videos",
      },
      language: {
        type: "string",
        description: "Language code for transcription",
      },
      useGemini: {
        type: "boolean",
        description: "Use Gemini Video Understanding for enhanced visual+audio analysis",
      },
      lowRes: {
        type: "boolean",
        description: "Use low resolution mode for longer videos (Gemini only)",
      },
    },
    required: ["video"],
  },
};

const geminiVideoDef: ToolDefinition = {
  name: "analyze_video",
  description:
    "Analyze video using Gemini Video Understanding. Supports video summarization, Q&A, content extraction, and timestamp analysis. Works with local files and YouTube URLs.",
  parameters: {
    type: "object",
    properties: {
      source: {
        type: "string",
        description: "Video file path or YouTube URL",
      },
      prompt: {
        type: "string",
        description: "Analysis prompt (e.g., 'Summarize this video', 'What happens at 2:30?')",
      },
      model: {
        type: "string",
        description: "Gemini model to use",
        enum: ["flash", "flash-2.5", "pro"],
      },
      fps: {
        type: "number",
        description: "Frames per second for sampling (default: 1, higher for action)",
      },
      start: {
        type: "number",
        description: "Start offset in seconds",
      },
      end: {
        type: "number",
        description: "End offset in seconds",
      },
      lowRes: {
        type: "boolean",
        description: "Use low resolution mode (fewer tokens, longer videos)",
      },
    },
    required: ["source", "prompt"],
  },
};

const analyzeDef: ToolDefinition = {
  name: "analyze_media",
  description:
    "Analyze any media using Gemini: images, videos, or YouTube URLs. Auto-detects source type. Use for image description, video summarization, Q&A, content extraction, and comparison analysis.",
  parameters: {
    type: "object",
    properties: {
      source: {
        type: "string",
        description: "Image/video file path, image URL (http...*.png/jpg/webp), or YouTube URL",
      },
      prompt: {
        type: "string",
        description: "Analysis prompt (e.g., 'Describe this image', 'Summarize this video', 'What happens at 2:30?')",
      },
      model: {
        type: "string",
        description: "Gemini model to use",
        enum: ["flash", "flash-2.5", "pro"],
      },
      fps: {
        type: "number",
        description: "Frames per second for video sampling (default: 1)",
      },
      start: {
        type: "number",
        description: "Start offset in seconds (video only)",
      },
      end: {
        type: "number",
        description: "End offset in seconds (video only)",
      },
      lowRes: {
        type: "boolean",
        description: "Use low resolution mode (fewer tokens, longer videos/larger images)",
      },
    },
    required: ["source", "prompt"],
  },
};

const editImageDef: ToolDefinition = {
  name: "edit_image",
  description:
    "Edit images using AI. Supports Gemini (up to 14 images, default), OpenAI GPT Image 1.5 (up to 16 images), or Grok Imagine (1 image). Use for image editing, style transfer, or multi-image composition.",
  parameters: {
    type: "object",
    properties: {
      images: {
        type: "array",
        items: { type: "string", description: "Image file path" },
        description: "Input image file paths",
      },
      prompt: {
        type: "string",
        description: "Edit instruction (e.g., 'change background to sunset', 'combine these images into a collage')",
      },
      output: {
        type: "string",
        description: "Output file path (default: edited-{timestamp}.png)",
      },
      provider: {
        type: "string",
        description: "Provider: gemini (default, up to 14 images), openai (up to 16 images), grok (1 image)",
        enum: ["gemini", "openai", "grok"],
      },
      model: {
        type: "string",
        description: "Model to use (Gemini only): flash (max 3 images, fast) or pro (max 14 images, higher quality)",
        enum: ["flash", "pro"],
      },
      aspectRatio: {
        type: "string",
        description: "Output aspect ratio",
        enum: ["1:1", "16:9", "9:16", "3:4", "4:3", "3:2", "2:3", "21:9"],
      },
      resolution: {
        type: "string",
        description: "Output resolution (Gemini Pro model only): 1K, 2K, 4K",
        enum: ["1K", "2K", "4K"],
      },
    },
    required: ["images", "prompt"],
  },
};

const regenerateSceneDef: ToolDefinition = {
  name: "pipeline_regenerate_scene",
  description: `Regenerate specific scene(s) in a script-to-video project.

RECOMMENDED WORKFLOW:
1. FIRST use fs_read to read storyboard.json in the project directory
2. Tell the user what scene(s) they're about to regenerate (show visuals, narration, duration)
3. THEN use this tool to regenerate

This tool re-creates videos for failed scenes using image-to-video (if ImgBB key available) or text-to-video. When regenerating images, uses reference-based generation for character consistency.`,
  parameters: {
    type: "object",
    properties: {
      projectDir: {
        type: "string",
        description: "Path to the script-to-video output directory (e.g., ./tiktok/)",
      },
      scenes: {
        type: "array",
        items: { type: "number", description: "Scene number (1-based)" },
        description: "Scene numbers to regenerate (1-based), e.g., [3, 4, 5]",
      },
      videoOnly: {
        type: "boolean",
        description: "Only regenerate videos, not images or narration (default: true)",
      },
      imageOnly: {
        type: "boolean",
        description: "Only regenerate images, not videos or narration",
      },
      generator: {
        type: "string",
        description: "Video generator: kling or runway",
        enum: ["kling", "runway"],
      },
      aspectRatio: {
        type: "string",
        description: "Aspect ratio for videos",
        enum: ["16:9", "9:16", "1:1"],
      },
      referenceScene: {
        type: "number",
        description: "Scene number to use as reference for character consistency when regenerating images (auto-detects if not specified)",
      },
    },
    required: ["projectDir", "scenes"],
  },
};

const animatedCaptionDef: ToolDefinition = {
  name: "edit_animated_caption",
  description:
    "Add animated word-by-word captions to video. Styles: highlight (TikTok-style), bounce, pop-in, neon (Remotion), karaoke-sweep, typewriter (ASS/fast). Requires OPENAI_API_KEY for Whisper.",
  parameters: {
    type: "object",
    properties: {
      videoPath: {
        type: "string",
        description: "Input video file path",
      },
      outputPath: {
        type: "string",
        description: "Output video file path",
      },
      style: {
        type: "string",
        description: "Caption animation style",
        enum: ["highlight", "bounce", "pop-in", "neon", "karaoke-sweep", "typewriter"],
      },
      highlightColor: {
        type: "string",
        description: "Active word highlight color (default: #FFFF00)",
      },
      fontSize: {
        type: "number",
        description: "Font size in pixels (default: auto based on resolution)",
      },
      position: {
        type: "string",
        description: "Caption position",
        enum: ["top", "center", "bottom"],
      },
      wordsPerGroup: {
        type: "number",
        description: "Words shown at once (default: auto 3-5)",
      },
      language: {
        type: "string",
        description: "Whisper language hint (e.g., en, ko)",
      },
      fast: {
        type: "boolean",
        description: "Use ASS/FFmpeg only (no Remotion, forces ASS tier styles)",
      },
    },
    required: ["videoPath", "outputPath"],
  },
};

// ============================================================================
// Tool Handlers
// ============================================================================

const scriptToVideoHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const script = args.script as string;
  const outputDir = args.outputDir
    ? resolve(context.workingDirectory, args.outputDir as string)
    : resolve(context.workingDirectory, "script-video-output");

  try {
    const result = await executeScriptToVideo({
      script,
      outputDir,
      duration: args.duration as number | undefined,
      voice: args.voice as string | undefined,
      generator: args.generator as "runway" | "kling" | undefined,
      imageProvider: args.imageProvider as "openai" | "gemini" | undefined,
      aspectRatio: args.aspectRatio as "16:9" | "9:16" | "1:1" | undefined,
      imagesOnly: args.imagesOnly as boolean | undefined,
      noVoiceover: args.noVoiceover as boolean | undefined,
      retries: args.retries as number | undefined,
      creativity: args.creativity as "low" | "high" | undefined,
      storyboardProvider: args.storyboardProvider as "claude" | "openai" | "gemini" | undefined,
    });

    if (!result.success) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: result.error || "Script-to-video pipeline failed",
      };
    }

    // Build summary
    const lines: string[] = [
      `✅ Script-to-Video complete!`,
      ``,
      `📁 Output: ${result.outputDir}`,
      `🎬 Scenes: ${result.scenes}`,
    ];

    if (result.totalDuration) {
      lines.push(`⏱️  Duration: ${result.totalDuration.toFixed(1)}s`);
    }

    if (result.storyboardPath) {
      lines.push(`📝 Storyboard: storyboard.json`);
    }

    // Show narrations with failed count
    const successfulNarrations = result.narrationEntries?.filter((e) => !e.failed && e.path) || [];
    const failedNarrationCount = result.failedNarrations?.length || 0;
    if (successfulNarrations.length > 0 || failedNarrationCount > 0) {
      if (failedNarrationCount > 0) {
        lines.push(`🎙️  Narrations: ${successfulNarrations.length}/${result.scenes} (${failedNarrationCount} failed: scene ${result.failedNarrations!.join(", ")})`);
      } else {
        lines.push(`🎙️  Narrations: ${successfulNarrations.length} narration-*.mp3`);
      }
    }

    if (result.images && result.images.length > 0) {
      lines.push(`🖼️  Images: ${result.images.length} scene-*.png`);
    }

    if (result.videos && result.videos.length > 0) {
      lines.push(`🎥 Videos: ${result.videos.length} scene-*.mp4`);
    }

    if (result.failedScenes && result.failedScenes.length > 0) {
      lines.push(`⚠️  Failed video scenes: ${result.failedScenes.join(", ")}`);
    }

    if (result.projectPath) {
      lines.push(`📄 Project: project.vibe.json`);
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
      error: `Script-to-video failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const highlightsHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const media = resolve(context.workingDirectory, args.media as string);
  const output = args.output
    ? resolve(context.workingDirectory, args.output as string)
    : undefined;
  const project = args.project
    ? resolve(context.workingDirectory, args.project as string)
    : undefined;

  try {
    const result = await executeHighlights({
      media,
      output,
      project,
      duration: args.duration as number | undefined,
      count: args.count as number | undefined,
      threshold: args.threshold as number | undefined,
      criteria: args.criteria as "emotional" | "informative" | "funny" | "all" | undefined,
      language: args.language as string | undefined,
      useGemini: args.useGemini as boolean | undefined,
      lowRes: args.lowRes as boolean | undefined,
    });

    if (!result.success) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: result.error || "Highlight extraction failed",
      };
    }

    if (result.highlights.length === 0) {
      return {
        toolCallId: "",
        success: true,
        output: "No highlights detected in the content.",
      };
    }

    // Build summary
    const lines: string[] = [
      `✅ Found ${result.highlights.length} highlights (${result.totalHighlightDuration.toFixed(1)}s total)`,
      ``,
    ];

    for (const h of result.highlights) {
      const startMin = Math.floor(h.startTime / 60);
      const startSec = (h.startTime % 60).toFixed(1);
      const endMin = Math.floor(h.endTime / 60);
      const endSec = (h.endTime % 60).toFixed(1);
      lines.push(`${h.index}. [${startMin}:${startSec.padStart(4, "0")} - ${endMin}:${endSec.padStart(4, "0")}] ${h.category} (${(h.confidence * 100).toFixed(0)}%)`);
      lines.push(`   ${sanitizeAIResult(h.reason)}`);
    }

    if (result.outputPath) {
      lines.push(``, `💾 Saved to: ${result.outputPath}`);
    }

    if (result.projectPath) {
      lines.push(`📄 Project: ${result.projectPath}`);
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
      error: `Highlight extraction failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const autoShortsHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const video = resolve(context.workingDirectory, args.video as string);
  const outputDir = args.outputDir
    ? resolve(context.workingDirectory, args.outputDir as string)
    : undefined;

  try {
    const result = await executeAutoShorts({
      video,
      outputDir,
      duration: args.duration as number | undefined,
      count: args.count as number | undefined,
      aspect: args.aspect as "9:16" | "1:1" | undefined,
      addCaptions: args.addCaptions as boolean | undefined,
      captionStyle: args.captionStyle as "minimal" | "bold" | "animated" | undefined,
      analyzeOnly: args.analyzeOnly as boolean | undefined,
      language: args.language as string | undefined,
      useGemini: args.useGemini as boolean | undefined,
      lowRes: args.lowRes as boolean | undefined,
    });

    if (!result.success) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: result.error || "Auto shorts generation failed",
      };
    }

    if (result.shorts.length === 0) {
      return {
        toolCallId: "",
        success: true,
        output: "No suitable shorts found in the video.",
      };
    }

    // Build summary
    const isAnalyzeOnly = args.analyzeOnly as boolean;
    const lines: string[] = [
      isAnalyzeOnly
        ? `📊 Found ${result.shorts.length} potential shorts:`
        : `✅ Generated ${result.shorts.length} short(s):`,
      ``,
    ];

    for (const s of result.shorts) {
      const startMin = Math.floor(s.startTime / 60);
      const startSec = (s.startTime % 60).toFixed(1);
      const endMin = Math.floor(s.endTime / 60);
      const endSec = (s.endTime % 60).toFixed(1);
      lines.push(`[Short ${s.index}] ${startMin}:${startSec.padStart(4, "0")} - ${endMin}:${endSec.padStart(4, "0")} (${s.duration.toFixed(1)}s)`);
      lines.push(`  ${sanitizeAIResult(s.reason)}`);
      lines.push(`  Confidence: ${(s.confidence * 100).toFixed(0)}%`);
      if (s.outputPath) {
        lines.push(`  📁 ${s.outputPath}`);
      }
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
      error: `Auto shorts failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const geminiVideoHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  let source = args.source as string;

  // Resolve local paths
  if (!source.includes("youtube.com") && !source.includes("youtu.be")) {
    source = resolve(context.workingDirectory, source);
  }

  try {
    const result = await executeGeminiVideo({
      source,
      prompt: args.prompt as string,
      model: args.model as "flash" | "flash-2.5" | "pro" | undefined,
      fps: args.fps as number | undefined,
      start: args.start as number | undefined,
      end: args.end as number | undefined,
      lowRes: args.lowRes as boolean | undefined,
    });

    if (!result.success) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: result.error || "Video analysis failed",
      };
    }

    // Build output
    const lines: string[] = [sanitizeAIResult(result.response || "")];

    if (result.model || result.totalTokens) {
      lines.push(``);
      lines.push(`---`);
      if (result.model) {
        lines.push(`Model: ${result.model}`);
      }
      if (result.totalTokens) {
        lines.push(`Tokens: ${result.totalTokens.toLocaleString()}`);
      }
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
      error: `Gemini video analysis failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const analyzeHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  let source = args.source as string;

  // Resolve local paths (not URLs)
  if (!source.startsWith("http://") && !source.startsWith("https://")) {
    source = resolve(context.workingDirectory, source);
  }

  try {
    const result = await executeAnalyze({
      source,
      prompt: args.prompt as string,
      model: args.model as "flash" | "flash-2.5" | "pro" | undefined,
      fps: args.fps as number | undefined,
      start: args.start as number | undefined,
      end: args.end as number | undefined,
      lowRes: args.lowRes as boolean | undefined,
    });

    if (!result.success) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: result.error || "Analysis failed",
      };
    }

    // Build output
    const lines: string[] = [`[${result.sourceType}] ${sanitizeAIResult(result.response || "")}`];

    if (result.model || result.totalTokens) {
      lines.push(``);
      lines.push(`---`);
      if (result.model) {
        lines.push(`Model: ${result.model}`);
      }
      if (result.totalTokens) {
        lines.push(`Tokens: ${result.totalTokens.toLocaleString()}`);
      }
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
      error: `Analysis failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const editImageHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const images = args.images as string[];
  const prompt = args.prompt as string;
  const output = (args.output as string) || `edited-${getTimestamp()}.png`;
  const provider = (args.provider as "gemini" | "openai" | "grok") || "gemini";
  const model = (args.model as "flash" | "pro") || "flash";
  const aspectRatio = args.aspectRatio as string | undefined;
  const resolution = args.resolution as string | undefined;

  try {
    // Provider-specific API key
    const apiKeyMap: Record<string, string> = {
      gemini: "google",
      openai: "openai",
      grok: "xai",
    };
    const apiKey = await getApiKeyFromConfig(apiKeyMap[provider] || "google");
    if (!apiKey) {
      const keyNames: Record<string, string> = {
        gemini: "Google (GOOGLE_API_KEY)",
        openai: "OpenAI (OPENAI_API_KEY)",
        grok: "xAI (XAI_API_KEY)",
      };
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: `${keyNames[provider]} API key required. Configure via 'vibe setup'.`,
      };
    }

    // Validate image count per provider
    if (provider === "grok" && images.length > 1) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: "Grok supports only 1 input image for editing. Use gemini (up to 14) or openai (up to 16) for multi-image editing.",
      };
    }
    if (provider === "gemini") {
      const maxImages = model === "pro" ? 14 : 3;
      if (images.length > maxImages) {
        return {
          toolCallId: "",
          success: false,
          output: "",
          error: `Too many images. Gemini ${model} model supports up to ${maxImages} images.`,
        };
      }
    }
    if (provider === "openai" && images.length > 16) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: "OpenAI supports up to 16 input images for editing.",
      };
    }

    // Load all images
    const imageBuffers: Buffer[] = [];
    for (const imagePath of images) {
      const absPath = resolve(context.workingDirectory, imagePath);
      const buffer = await readFile(absPath);
      imageBuffers.push(buffer);
    }

    let result: import("@vibeframe/ai-providers").ImageResult;
    let usedProvider = provider;

    if (provider === "openai") {
      const { OpenAIImageProvider } = await import("@vibeframe/ai-providers");
      const openai = new OpenAIImageProvider();
      await openai.initialize({ apiKey });
      result = await openai.editImage(imageBuffers, prompt);
    } else if (provider === "grok") {
      const { GrokProvider } = await import("@vibeframe/ai-providers");
      const grok = new GrokProvider();
      await grok.initialize({ apiKey });
      result = await grok.editImage(imageBuffers[0], prompt, {
        aspectRatio: aspectRatio,
      });
    } else {
      const { GeminiProvider } = await import("@vibeframe/ai-providers");
      const gemini = new GeminiProvider();
      await gemini.initialize({ apiKey });
      result = await gemini.editImage(imageBuffers, prompt, {
        model,
        aspectRatio: aspectRatio as "1:1" | "16:9" | "9:16" | "3:4" | "4:3" | "3:2" | "2:3" | "21:9" | undefined,
        resolution: resolution as "1K" | "2K" | "4K" | undefined,
      });
      usedProvider = "gemini";
    }

    if (!result.success || !result.images || result.images.length === 0) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: `Image editing failed: ${result.error || "No image generated"}`,
      };
    }

    // Save the edited image (handle both base64 and URL)
    const img = result.images[0];
    const outputPath = resolve(context.workingDirectory, output);
    if (img.base64) {
      const buffer = Buffer.from(img.base64, "base64");
      await writeFile(outputPath, buffer);
    } else if (img.url) {
      const resp = await fetch(img.url);
      const arrayBuf = await resp.arrayBuffer();
      await writeFile(outputPath, Buffer.from(arrayBuf));
    }

    return {
      toolCallId: "",
      success: true,
      output: `Image edited: ${output}\nProvider: ${usedProvider}\nInput images: ${images.length}\nPrompt: ${prompt}`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to edit image: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const regenerateSceneHandler: ToolHandler = async (args) => {
  const { projectDir, scenes, videoOnly, imageOnly, generator = "kling", aspectRatio = "16:9", referenceScene } = args as {
    projectDir: string;
    scenes: number[];
    videoOnly?: boolean;
    imageOnly?: boolean;
    generator?: "kling" | "runway";
    aspectRatio?: "16:9" | "9:16" | "1:1";
    referenceScene?: number;
  };

  if (!projectDir) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: "projectDir is required",
    };
  }

  if (!scenes || !Array.isArray(scenes) || scenes.length === 0) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: "scenes array is required (e.g., [3, 4, 5])",
    };
  }

  // Default to videoOnly unless imageOnly is explicitly set
  const effectiveVideoOnly = imageOnly ? false : (videoOnly ?? true);

  const result = await executeRegenerateScene({
    projectDir,
    scenes,
    videoOnly: effectiveVideoOnly,
    imageOnly,
    generator,
    aspectRatio,
    referenceScene,
  });

  if (!result.success) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: result.error || "Scene regeneration failed",
    };
  }

  let output = `Regenerated ${result.regeneratedScenes.length} scene(s): ${result.regeneratedScenes.join(", ")}`;
  if (result.failedScenes.length > 0) {
    output += `\nFailed scenes: ${result.failedScenes.join(", ")}`;
  }

  return {
    toolCallId: "",
    success: true,
    output,
  };
};

const animatedCaptionHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const videoPath = resolve(context.workingDirectory, args.videoPath as string);
  const outputPath = resolve(context.workingDirectory, args.outputPath as string);

  try {
    const result = await executeAnimatedCaption({
      videoPath,
      outputPath,
      style: (args.style as AnimatedCaptionStyle) || "highlight",
      highlightColor: (args.highlightColor as string) || "#FFFF00",
      fontSize: args.fontSize as number | undefined,
      position: (args.position as "top" | "center" | "bottom") || "bottom",
      wordsPerGroup: args.wordsPerGroup as number | undefined,
      language: args.language as string | undefined,
      fast: args.fast as boolean | undefined,
    });

    if (!result.success) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: result.error || "Animated caption failed",
      };
    }

    return {
      toolCallId: "",
      success: true,
      output: `✅ Animated captions applied!\n\nOutput: ${result.outputPath}\nWords: ${result.wordCount}\nGroups: ${result.groupCount}\nStyle: ${result.style}\nTier: ${result.tier}`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Animated caption failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

// ============================================================================
// Registration
// ============================================================================

export function registerPipelineTools(registry: ToolRegistry): void {
  // Manifest takes precedence — skip names already sourced from
  // packages/cli/src/tools/manifest. Same pattern as scene.ts/timeline.ts.
  if (!MIGRATED.has(scriptToVideoDef.name))    registry.register(scriptToVideoDef, scriptToVideoHandler);
  if (!MIGRATED.has(highlightsDef.name))       registry.register(highlightsDef, highlightsHandler);
  if (!MIGRATED.has(autoShortsDef.name))       registry.register(autoShortsDef, autoShortsHandler);
  if (!MIGRATED.has(geminiVideoDef.name))      registry.register(geminiVideoDef, geminiVideoHandler);
  if (!MIGRATED.has(analyzeDef.name))          registry.register(analyzeDef, analyzeHandler);
  if (!MIGRATED.has(editImageDef.name))        registry.register(editImageDef, editImageHandler);
  if (!MIGRATED.has(regenerateSceneDef.name))  registry.register(regenerateSceneDef, regenerateSceneHandler);
  if (!MIGRATED.has(animatedCaptionDef.name))  registry.register(animatedCaptionDef, animatedCaptionHandler);
}
