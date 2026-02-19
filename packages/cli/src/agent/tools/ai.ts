/**
 * AI Generation Tools - Image, video, TTS, SFX, music generation
 *
 * IMPORTANT: See MODELS.md for the Single Source of Truth (SSOT) on:
 * - Supported AI providers and models
 * - Environment variables and API keys
 * - Model capabilities and limitations
 *
 * Note: These tools wrap the AI providers for agent use.
 * Some features require async polling - tool returns immediately with task status.
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
  executeTextOverlay,
  executeReview,
  executeSilenceCut,
  executeJumpCut,
  executeCaption,
  executeNoiseReduce,
  executeFade,
  executeThumbnailBestFrame,
  executeTranslateSrt,
  type TextOverlayStyle,
  type CaptionStyle,
} from "../../commands/ai.js";

// Tool Definitions
const imageDef: ToolDefinition = {
  name: "ai_image",
  description: "Generate an image using AI (OpenAI GPT Image 1.5, Gemini, or Stability)",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Image generation prompt",
      },
      output: {
        type: "string",
        description: "Output file path (default: generated-{timestamp}.png)",
      },
      provider: {
        type: "string",
        description: "Provider to use: openai (GPT Image 1.5), gemini (Nano Banana), stability (SDXL). 'dalle' is deprecated, use 'openai' instead.",
        enum: ["openai", "dalle", "gemini", "stability"],
      },
      size: {
        type: "string",
        description: "Image size (1024x1024, 1536x1024, 1024x1536)",
        enum: ["1024x1024", "1536x1024", "1024x1536"],
      },
    },
    required: ["prompt"],
  },
};

const videoDef: ToolDefinition = {
  name: "ai_video",
  description: "Generate video from an image using Runway Gen-4 (image-to-video). REQUIRES an input image. For text-to-video without an image, use ai_kling instead.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Video generation prompt describing the motion/animation",
      },
      image: {
        type: "string",
        description: "Input image path (REQUIRED - Runway only supports image-to-video)",
      },
      output: {
        type: "string",
        description: "Output file path",
      },
      duration: {
        type: "number",
        description: "Video duration in seconds (5 or 10)",
      },
    },
    required: ["prompt", "image"],
  },
};

const klingDef: ToolDefinition = {
  name: "ai_kling",
  description: "Generate video using Kling AI. Supports both text-to-video (no image required) and image-to-video. Recommended for text-only video generation when you don't have an input image.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Video generation prompt",
      },
      image: {
        type: "string",
        description: "Optional input image path for image-to-video (not required for text-to-video)",
      },
      output: {
        type: "string",
        description: "Output file path",
      },
      duration: {
        type: "number",
        description: "Video duration (5 or 10 seconds)",
      },
      mode: {
        type: "string",
        description: "Quality mode (std or pro)",
        enum: ["std", "pro"],
      },
    },
    required: ["prompt"],
  },
};

const ttsDef: ToolDefinition = {
  name: "ai_tts",
  description: "Generate speech from text using ElevenLabs",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "Text to convert to speech",
      },
      output: {
        type: "string",
        description: "Output audio file path",
      },
      voice: {
        type: "string",
        description: "Voice ID or name",
      },
    },
    required: ["text"],
  },
};

const sfxDef: ToolDefinition = {
  name: "ai_sfx",
  description: "Generate sound effects using ElevenLabs",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Sound effect description",
      },
      output: {
        type: "string",
        description: "Output audio file path",
      },
      duration: {
        type: "number",
        description: "Duration in seconds",
      },
    },
    required: ["prompt"],
  },
};

const musicDef: ToolDefinition = {
  name: "ai_music",
  description: "Generate music using AI (Replicate/MusicGen). Note: Music generation is async.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Music description/prompt",
      },
      output: {
        type: "string",
        description: "Output audio file path",
      },
      duration: {
        type: "number",
        description: "Duration in seconds (1-30)",
      },
    },
    required: ["prompt"],
  },
};

const storyboardDef: ToolDefinition = {
  name: "ai_storyboard",
  description: "Generate a storyboard from a script using Claude",
  parameters: {
    type: "object",
    properties: {
      script: {
        type: "string",
        description: "Video script or concept",
      },
      targetDuration: {
        type: "number",
        description: "Target video duration in seconds",
      },
      output: {
        type: "string",
        description: "Output JSON file path",
      },
      creativity: {
        type: "string",
        description: "Creativity level: 'low' (default, consistent scenes) or 'high' (varied, unexpected scenes)",
        enum: ["low", "high"],
      },
    },
    required: ["script"],
  },
};

const motionDef: ToolDefinition = {
  name: "ai_motion",
  description: "Generate motion graphics using Remotion",
  parameters: {
    type: "object",
    properties: {
      type: {
        type: "string",
        description: "Motion type (intro, outro, title, lower-third)",
        enum: ["intro", "outro", "title", "lower-third"],
      },
      text: {
        type: "string",
        description: "Text content",
      },
      output: {
        type: "string",
        description: "Output video file path",
      },
      duration: {
        type: "number",
        description: "Duration in seconds",
      },
    },
    required: ["type", "text"],
  },
};

// Pipeline Tool Definitions

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

// Helper to get timestamp for filenames
function getTimestamp(): string {
  return Date.now().toString();
}

// Tool Handlers
const generateImage: ToolHandler = async (args, context): Promise<ToolResult> => {
  const prompt = args.prompt as string;
  let provider = (args.provider as string) || "gemini";
  const output = (args.output as string) || `generated-${getTimestamp()}.png`;
  const size = (args.size as string) || "1024x1024";

  try {
    let apiKey: string | undefined;
    let providerKey: string;

    switch (provider) {
      case "gemini":
        providerKey = "google";
        break;
      case "stability":
        providerKey = "stability";
        break;
      case "openai":
      case "dalle": // backward compatibility
        providerKey = "openai";
        break;
      default:
        providerKey = "openai";
    }

    apiKey = await getApiKeyFromConfig(providerKey);
    if (!apiKey) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: `API key required for ${provider}. Configure via 'vibe setup'.`,
      };
    }

    const outputPath = resolve(context.workingDirectory, output);

    if (provider === "dalle" || provider === "openai") {
      const { OpenAIImageProvider } = await import("@vibeframe/ai-providers");
      const openaiImage = new OpenAIImageProvider();
      await openaiImage.initialize({ apiKey });

      const result = await openaiImage.generateImage(prompt, {
        size: size as "1024x1024" | "1536x1024" | "1024x1536",
      });

      if (!result.success || !result.images || result.images.length === 0) {
        return {
          toolCallId: "",
          success: false,
          output: "",
          error: `Image generation failed: ${result.error || "No image generated"}`,
        };
      }

      // Save image (handle both URL and base64)
      const image = result.images[0];
      let buffer: Buffer;
      if (image.url) {
        const response = await fetch(image.url);
        buffer = Buffer.from(await response.arrayBuffer());
      } else if (image.base64) {
        buffer = Buffer.from(image.base64, "base64");
      } else {
        return {
          toolCallId: "",
          success: false,
          output: "",
          error: "Image generated but no URL or base64 data returned",
        };
      }
      await writeFile(outputPath, buffer);
    } else if (provider === "gemini") {
      const { GeminiProvider } = await import("@vibeframe/ai-providers");
      const gemini = new GeminiProvider();
      await gemini.initialize({ apiKey });

      const result = await gemini.generateImage(prompt);

      if (!result.success || !result.images || result.images.length === 0) {
        return {
          toolCallId: "",
          success: false,
          output: "",
          error: `Image generation failed: ${result.error || "No image generated"}`,
        };
      }

      // Gemini returns base64
      const image = result.images[0];
      if (image.base64) {
        const buffer = Buffer.from(image.base64, "base64");
        await writeFile(outputPath, buffer);
      }
    } else if (provider === "stability") {
      const { StabilityProvider } = await import("@vibeframe/ai-providers");
      const stability = new StabilityProvider();
      await stability.initialize({ apiKey });

      const result = await stability.generateImage(prompt);

      if (!result.success || !result.images || result.images.length === 0) {
        return {
          toolCallId: "",
          success: false,
          output: "",
          error: `Image generation failed: ${result.error || "No image generated"}`,
        };
      }

      const image = result.images[0];
      if (image.base64) {
        const buffer = Buffer.from(image.base64, "base64");
        await writeFile(outputPath, buffer);
      }
    }

    return {
      toolCallId: "",
      success: true,
      output: `Image generated: ${output}\nPrompt: ${prompt}\nProvider: ${provider}\nSize: ${size}`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to generate image: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const generateVideo: ToolHandler = async (args, context): Promise<ToolResult> => {
  const prompt = args.prompt as string;
  const imagePath = args.image as string | undefined;
  const output = (args.output as string) || `generated-${getTimestamp()}.mp4`;
  const duration = (args.duration as number) || 5;

  try {
    const apiKey = await getApiKeyFromConfig("runway");
    if (!apiKey) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: "Runway API key required. Configure via 'vibe setup'.",
      };
    }

    const { RunwayProvider } = await import("@vibeframe/ai-providers");
    const runway = new RunwayProvider();
    await runway.initialize({ apiKey });

    // Prepare reference image if provided
    let referenceImage: string | undefined;
    if (imagePath) {
      const absImagePath = resolve(context.workingDirectory, imagePath);
      const imageBuffer = await readFile(absImagePath);
      const base64 = imageBuffer.toString("base64");
      const ext = imagePath.split(".").pop()?.toLowerCase() || "png";
      const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
      referenceImage = `data:${mimeType};base64,${base64}`;
    }

    const result = await runway.generateVideo(prompt, {
      prompt,
      duration: duration as 5 | 10,
      referenceImage,
    });

    if (result.status === "failed") {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: `Video generation failed: ${result.error}`,
      };
    }

    // Video generation is async - need to poll
    if (result.status === "pending" || result.status === "processing") {
      // Poll for completion
      let finalResult = result;
      const maxAttempts = 60; // 5 minutes max
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        finalResult = await runway.getGenerationStatus(result.id);
        if (finalResult.status === "completed" || finalResult.status === "failed") {
          break;
        }
      }

      if (finalResult.status !== "completed") {
        return {
          toolCallId: "",
          success: false,
          output: "",
          error: `Video generation timed out or failed: ${finalResult.error || finalResult.status}`,
        };
      }

      // Download and save video
      if (finalResult.videoUrl) {
        const outputPath = resolve(context.workingDirectory, output);
        const response = await fetch(finalResult.videoUrl);
        const buffer = Buffer.from(await response.arrayBuffer());
        await writeFile(outputPath, buffer);
      }
    }

    return {
      toolCallId: "",
      success: true,
      output: `Video generated: ${output}\nPrompt: ${prompt}\nDuration: ${duration}s`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to generate video: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const generateKling: ToolHandler = async (args, context): Promise<ToolResult> => {
  const prompt = args.prompt as string;
  const imagePath = args.image as string | undefined;
  const output = (args.output as string) || `kling-${getTimestamp()}.mp4`;
  const duration = (args.duration as number) || 5;
  const mode = (args.mode as "std" | "pro") || "std";

  try {
    const apiKey = await getApiKeyFromConfig("kling");
    if (!apiKey) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: "Kling API key required. Configure via 'vibe setup'.",
      };
    }

    const { KlingProvider } = await import("@vibeframe/ai-providers");
    const kling = new KlingProvider();
    await kling.initialize({ apiKey });

    // Prepare reference image if provided
    let referenceImage: string | undefined;
    if (imagePath) {
      const absImagePath = resolve(context.workingDirectory, imagePath);
      const imageBuffer = await readFile(absImagePath);
      const base64 = imageBuffer.toString("base64");
      const ext = imagePath.split(".").pop()?.toLowerCase() || "png";
      const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
      referenceImage = `data:${mimeType};base64,${base64}`;
    }

    const result = await kling.generateVideo(prompt, {
      prompt,
      duration: duration as 5 | 10,
      mode,
      referenceImage,
    });

    if (result.status === "failed") {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: `Kling video generation failed: ${result.error}`,
      };
    }

    // Video generation is async - need to poll
    if (result.status === "pending" || result.status === "processing") {
      let finalResult = result;
      const maxAttempts = 60;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        finalResult = await kling.getGenerationStatus(result.id);
        if (finalResult.status === "completed" || finalResult.status === "failed") {
          break;
        }
      }

      if (finalResult.status !== "completed") {
        return {
          toolCallId: "",
          success: false,
          output: "",
          error: `Kling video generation timed out or failed: ${finalResult.error || finalResult.status}`,
        };
      }

      if (finalResult.videoUrl) {
        const outputPath = resolve(context.workingDirectory, output);
        const response = await fetch(finalResult.videoUrl);
        const buffer = Buffer.from(await response.arrayBuffer());
        await writeFile(outputPath, buffer);
      }
    }

    return {
      toolCallId: "",
      success: true,
      output: `Kling video generated: ${output}\nPrompt: ${prompt}\nDuration: ${duration}s\nMode: ${mode}`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to generate Kling video: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const generateTTS: ToolHandler = async (args, context): Promise<ToolResult> => {
  const text = args.text as string;
  const output = (args.output as string) || `tts-${getTimestamp()}.mp3`;
  const voice = args.voice as string | undefined;

  try {
    const apiKey = await getApiKeyFromConfig("elevenlabs");
    if (!apiKey) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: "ElevenLabs API key required. Configure via 'vibe setup'.",
      };
    }

    const { ElevenLabsProvider } = await import("@vibeframe/ai-providers");
    const elevenlabs = new ElevenLabsProvider();
    await elevenlabs.initialize({ apiKey });

    const result = await elevenlabs.textToSpeech(text, {
      voiceId: voice,
    });

    if (!result.success || !result.audioBuffer) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: `TTS generation failed: ${result.error || "No audio generated"}`,
      };
    }

    // Save audio
    const outputPath = resolve(context.workingDirectory, output);
    await writeFile(outputPath, result.audioBuffer);

    return {
      toolCallId: "",
      success: true,
      output: `Speech generated: ${output}\nText: ${text.substring(0, 100)}${text.length > 100 ? "..." : ""}`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to generate speech: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const generateSFX: ToolHandler = async (args, context): Promise<ToolResult> => {
  const prompt = args.prompt as string;
  const output = (args.output as string) || `sfx-${getTimestamp()}.mp3`;
  const duration = args.duration as number | undefined;

  try {
    const apiKey = await getApiKeyFromConfig("elevenlabs");
    if (!apiKey) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: "ElevenLabs API key required. Configure via 'vibe setup'.",
      };
    }

    const { ElevenLabsProvider } = await import("@vibeframe/ai-providers");
    const elevenlabs = new ElevenLabsProvider();
    await elevenlabs.initialize({ apiKey });

    const result = await elevenlabs.generateSoundEffect(prompt, {
      duration,
    });

    if (!result.success || !result.audioBuffer) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: `SFX generation failed: ${result.error || "No audio generated"}`,
      };
    }

    // Save audio
    const outputPath = resolve(context.workingDirectory, output);
    await writeFile(outputPath, result.audioBuffer);

    return {
      toolCallId: "",
      success: true,
      output: `Sound effect generated: ${output}\nPrompt: ${prompt}`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to generate sound effect: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const generateMusic: ToolHandler = async (args, context): Promise<ToolResult> => {
  const prompt = args.prompt as string;
  const output = (args.output as string) || `music-${getTimestamp()}.mp3`;
  const duration = (args.duration as number) || 8;

  try {
    const apiKey = await getApiKeyFromConfig("replicate");
    if (!apiKey) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: "Replicate API key required. Configure via 'vibe setup'.",
      };
    }

    const { ReplicateProvider } = await import("@vibeframe/ai-providers");
    const replicate = new ReplicateProvider();
    await replicate.initialize({ apiKey });

    const result = await replicate.generateMusic(prompt, {
      duration,
    });

    if (!result.success) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: `Music generation failed: ${result.error || "Unknown error"}`,
      };
    }

    // Music generation is async - need to poll
    if (result.taskId) {
      let finalResult = result;
      const maxAttempts = 60;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        finalResult = await replicate.getMusicStatus(result.taskId);
        if (finalResult.success && finalResult.audioUrl) {
          break;
        }
        if (finalResult.error) {
          return {
            toolCallId: "",
            success: false,
            output: "",
            error: `Music generation failed: ${finalResult.error}`,
          };
        }
      }

      if (finalResult.audioUrl) {
        const outputPath = resolve(context.workingDirectory, output);
        const response = await fetch(finalResult.audioUrl);
        const buffer = Buffer.from(await response.arrayBuffer());
        await writeFile(outputPath, buffer);
      } else {
        return {
          toolCallId: "",
          success: false,
          output: "",
          error: "Music generation timed out",
        };
      }
    }

    return {
      toolCallId: "",
      success: true,
      output: `Music generated: ${output}\nPrompt: ${prompt}\nDuration: ${duration}s`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to generate music: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const generateStoryboard: ToolHandler = async (args, context): Promise<ToolResult> => {
  const script = args.script as string;
  const targetDuration = args.targetDuration as number | undefined;
  const output = (args.output as string) || `storyboard-${getTimestamp()}.json`;
  const creativity = args.creativity as "low" | "high" | undefined;

  try {
    const apiKey = await getApiKeyFromConfig("anthropic");
    if (!apiKey) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: "Anthropic API key required. Configure via 'vibe setup'.",
      };
    }

    const { ClaudeProvider } = await import("@vibeframe/ai-providers");
    const claude = new ClaudeProvider();
    await claude.initialize({ apiKey });

    const result = await claude.analyzeContent(script, targetDuration, { creativity });

    if (!result || result.length === 0) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: "Failed to generate storyboard",
      };
    }

    // Save storyboard
    const outputPath = resolve(context.workingDirectory, output);
    await writeFile(outputPath, JSON.stringify(result, null, 2), "utf-8");

    // Format summary
    const summary = result.map((scene, i) =>
      `Scene ${i + 1}: ${scene.description.substring(0, 60)}...`
    ).join("\n");

    return {
      toolCallId: "",
      success: true,
      output: `Storyboard generated: ${output}\n\n${summary}`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to generate storyboard: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const generateMotion: ToolHandler = async (_args, _context): Promise<ToolResult> => {
  // Motion graphics generation would typically use Remotion
  return {
    toolCallId: "",
    success: false,
    output: "",
    error: "Motion graphics generation requires Remotion setup. Use 'vibe ai motion' CLI command directly.",
  };
};

// Pipeline Tool Handlers

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

// Regenerate Scene Tool
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

// Text Overlay Tool
const textOverlayDef: ToolDefinition = {
  name: "ai_text_overlay",
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

// Video Review Tool
const reviewDef: ToolDefinition = {
  name: "ai_review",
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

  const fb = result.feedback!;
  let output = `Video Review: ${fb.overallScore}/10\n`;
  output += `Pacing: ${fb.categories.pacing.score}/10, Color: ${fb.categories.color.score}/10, `;
  output += `Text: ${fb.categories.textReadability.score}/10, AV Sync: ${fb.categories.audioVisualSync.score}/10, `;
  output += `Composition: ${fb.categories.composition.score}/10\n`;

  if (result.appliedFixes && result.appliedFixes.length > 0) {
    output += `Applied fixes: ${result.appliedFixes.join("; ")}\n`;
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

// Silence Cut Tool
const silenceCutDef: ToolDefinition = {
  name: "ai_silence_cut",
  description: "Remove silent segments from a video using FFmpeg. No API key needed. Detects silence and concatenates non-silent parts with stream copy (fast, no re-encode). Use --analyze-only to just detect silence without cutting.",
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
        description: "Silence threshold in dB (default: -30). Lower = more sensitive",
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
    },
    required: ["videoPath"],
  },
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

// Jump Cut Tool
const jumpCutDef: ToolDefinition = {
  name: "ai_jump_cut",
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

// Caption Tool
const captionDef: ToolDefinition = {
  name: "ai_caption",
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

// Noise Reduce Tool
const noiseReduceDef: ToolDefinition = {
  name: "ai_noise_reduce",
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

// Fade Tool
const fadeDef: ToolDefinition = {
  name: "ai_fade",
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

// Thumbnail Best Frame Tool
const thumbnailBestFrameDef: ToolDefinition = {
  name: "ai_thumbnail",
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
    if (result.reason) lines.push(`Reason: ${result.reason}`);

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

// Translate SRT Tool
const translateSrtDef: ToolDefinition = {
  name: "ai_translate_srt",
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

// Registration function
export function registerAITools(registry: ToolRegistry): void {
  // Basic AI generation tools
  registry.register(imageDef, generateImage);
  registry.register(videoDef, generateVideo);
  registry.register(klingDef, generateKling);
  registry.register(ttsDef, generateTTS);
  registry.register(sfxDef, generateSFX);
  registry.register(musicDef, generateMusic);
  registry.register(storyboardDef, generateStoryboard);
  registry.register(motionDef, generateMotion);

  // Advanced pipeline tools
  registry.register(scriptToVideoDef, scriptToVideoHandler);
  registry.register(highlightsDef, highlightsHandler);
  registry.register(autoShortsDef, autoShortsHandler);
  registry.register(geminiVideoDef, geminiVideoHandler);
  registry.register(analyzeDef, analyzeHandler);
  registry.register(geminiEditDef, geminiEditHandler);
  registry.register(regenerateSceneDef, regenerateSceneHandler);
  registry.register(textOverlayDef, textOverlayHandler);
  registry.register(reviewDef, reviewHandler);
  registry.register(silenceCutDef, silenceCutHandler);
  registry.register(jumpCutDef, jumpCutHandler);
  registry.register(captionDef, captionHandler);
  registry.register(noiseReduceDef, noiseReduceHandler);
  registry.register(fadeDef, fadeHandler);
  registry.register(thumbnailBestFrameDef, thumbnailBestFrameHandler);
  registry.register(translateSrtDef, translateSrtHandler);
}
