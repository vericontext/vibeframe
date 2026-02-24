/**
 * AI Pipeline Tools - Script-to-video, highlights, auto-shorts, analysis, editing, regeneration
 *
 * Advanced multi-step pipeline tools that orchestrate multiple AI providers.
 * These tools wrap the execute functions from commands for agent use.
 *
 * See MODELS.md for the Single Source of Truth (SSOT) on supported providers/models.
 */

import { writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ToolRegistry, ToolHandler } from "./index.js";
import type { ToolDefinition, ToolResult } from "../types.js";
import { getApiKeyFromConfig } from "../../config/index.js";
import {
  executeScriptToVideo,
  executeHighlights,
  executeAutoShorts,
  executeGeminiVideo,
  executeAnalyze,
  executeRegenerateScene,
} from "../../commands/ai.js";

// Helper to get timestamp for filenames
function getTimestamp(): string {
  return Date.now().toString();
}

// ============================================================================
// Tool Definitions
// ============================================================================

const scriptToVideoDef: ToolDefinition = {
  name: "ai_script_to_video",
  description:
    "Generate complete video from text script. Full pipeline: Claude storyboard → ElevenLabs TTS → Image gen (DALL-E/Stability/Gemini) → Video gen (Runway/Kling). Creates project file with all assets.",
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
        enum: ["openai", "stability", "gemini"],
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
    },
    required: ["script"],
  },
};

const highlightsDef: ToolDefinition = {
  name: "ai_highlights",
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
  name: "ai_auto_shorts",
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
  name: "ai_gemini_video",
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
  name: "ai_analyze",
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

const geminiEditDef: ToolDefinition = {
  name: "ai_gemini_edit",
  description:
    "Edit or compose multiple images using Gemini. Flash model supports up to 3 images, Pro model supports up to 14 images. Use for image editing, style transfer, or multi-image composition.",
  parameters: {
    type: "object",
    properties: {
      images: {
        type: "array",
        items: { type: "string", description: "Image file path" },
        description: "Input image file paths (1-14 images depending on model)",
      },
      prompt: {
        type: "string",
        description: "Edit instruction (e.g., 'change background to sunset', 'combine these images into a collage')",
      },
      output: {
        type: "string",
        description: "Output file path (default: edited-{timestamp}.png)",
      },
      model: {
        type: "string",
        description: "Model to use: flash (max 3 images, fast) or pro (max 14 images, higher quality)",
        enum: ["flash", "pro"],
      },
      aspectRatio: {
        type: "string",
        description: "Output aspect ratio",
        enum: ["1:1", "16:9", "9:16", "3:4", "4:3", "3:2", "2:3", "21:9"],
      },
      resolution: {
        type: "string",
        description: "Output resolution (Pro model only): 1K, 2K, 4K",
        enum: ["1K", "2K", "4K"],
      },
    },
    required: ["images", "prompt"],
  },
};

const regenerateSceneDef: ToolDefinition = {
  name: "ai_regenerate_scene",
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
      imageProvider: args.imageProvider as "openai" | "stability" | "gemini" | undefined,
      aspectRatio: args.aspectRatio as "16:9" | "9:16" | "1:1" | undefined,
      imagesOnly: args.imagesOnly as boolean | undefined,
      noVoiceover: args.noVoiceover as boolean | undefined,
      retries: args.retries as number | undefined,
      creativity: args.creativity as "low" | "high" | undefined,
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
      lines.push(`   ${h.reason}`);
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
      lines.push(`  ${s.reason}`);
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
    const lines: string[] = [result.response || ""];

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
    const lines: string[] = [`[${result.sourceType}] ${result.response || ""}`];

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

const geminiEditHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const images = args.images as string[];
  const prompt = args.prompt as string;
  const output = (args.output as string) || `edited-${getTimestamp()}.png`;
  const model = (args.model as "flash" | "pro") || "flash";
  const aspectRatio = args.aspectRatio as string | undefined;
  const resolution = args.resolution as string | undefined;

  try {
    const apiKey = await getApiKeyFromConfig("google");
    if (!apiKey) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: "Google API key required. Configure via 'vibe setup'.",
      };
    }

    // Validate image count
    const maxImages = model === "pro" ? 14 : 3;
    if (images.length > maxImages) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: `Too many images. ${model} model supports up to ${maxImages} images.`,
      };
    }

    // Load all images
    const imageBuffers: Buffer[] = [];
    for (const imagePath of images) {
      const absPath = resolve(context.workingDirectory, imagePath);
      const buffer = await readFile(absPath);
      imageBuffers.push(buffer);
    }

    const { GeminiProvider } = await import("@vibeframe/ai-providers");
    const gemini = new GeminiProvider();
    await gemini.initialize({ apiKey });

    const result = await gemini.editImage(imageBuffers, prompt, {
      model,
      aspectRatio: aspectRatio as "1:1" | "16:9" | "9:16" | "3:4" | "4:3" | "3:2" | "2:3" | "21:9" | undefined,
      resolution: resolution as "1K" | "2K" | "4K" | undefined,
    });

    if (!result.success || !result.images || result.images.length === 0) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: `Image editing failed: ${result.error || "No image generated"}`,
      };
    }

    // Save the edited image
    const img = result.images[0];
    if (img.base64) {
      const outputPath = resolve(context.workingDirectory, output);
      const buffer = Buffer.from(img.base64, "base64");
      await writeFile(outputPath, buffer);
    }

    return {
      toolCallId: "",
      success: true,
      output: `Image edited: ${output}\nInput images: ${images.length}\nModel: ${model}\nPrompt: ${prompt}`,
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

// ============================================================================
// Registration
// ============================================================================

export function registerPipelineTools(registry: ToolRegistry): void {
  registry.register(scriptToVideoDef, scriptToVideoHandler);
  registry.register(highlightsDef, highlightsHandler);
  registry.register(autoShortsDef, autoShortsHandler);
  registry.register(geminiVideoDef, geminiVideoHandler);
  registry.register(analyzeDef, analyzeHandler);
  registry.register(geminiEditDef, geminiEditHandler);
  registry.register(regenerateSceneDef, regenerateSceneHandler);
}
