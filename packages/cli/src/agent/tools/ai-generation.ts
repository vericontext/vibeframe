/**
 * @module ai-generation
 * @description Agent tools for AI asset generation (image, video, TTS, SFX, music,
 * storyboard, motion). Wraps providers for agent use. Some features require
 * async polling -- tool returns immediately with task status.
 *
 * ## Tools: generate_image, generate_video, generate_speech, generate_sound_effect, generate_music, generate_storyboard, generate_motion
 * ## Dependencies: OpenAI, Gemini, Runway, Kling, ElevenLabs (TTS/SFX/Music), Replicate, Claude, Remotion
 * @see MODELS.md for the Single Source of Truth (SSOT) on supported providers/models
 */

import { writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ToolRegistry, ToolHandler } from "./index.js";
import type { ToolDefinition, ToolResult } from "../types.js";
import { MIGRATED } from "../../tools/define-tool.js";
import { getApiKeyFromConfig } from "../../config/index.js";
import { downloadVideo } from "../../commands/ai-helpers.js";
import { sanitizeAIResult } from "../../commands/sanitize.js";
import { executeBackground, executeMusicStatus } from "../../commands/generate.js";
import {
  executeVideoStatus,
  executeVideoCancel,
  executeVideoExtend,
} from "../../commands/ai-video.js";

// Helper to get timestamp for filenames
function getTimestamp(): string {
  return Date.now().toString();
}

// ============================================================================
// Tool Definitions
// ============================================================================

const imageDef: ToolDefinition = {
  name: "generate_image",
  description: "Generate an image using AI (OpenAI GPT Image 1.5, Gemini, or xAI Grok)",
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
        description: "Provider to use: openai (GPT Image 1.5), gemini (Nano Banana), grok (Grok Imagine). 'dalle' is deprecated, use 'openai' instead.",
        enum: ["openai", "dalle", "gemini", "grok"],
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
  name: "generate_video",
  description: "Generate video using AI. Supports Grok Imagine (default, native audio), Runway Gen-4.5 (text/image-to-video) and gen4_turbo (image-to-video), Kling (text/image-to-video), and Veo (text/image-to-video) via provider selection.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Video generation prompt describing the motion/animation",
      },
      provider: {
        type: "string",
        description: "Video provider to use (default: grok)",
        enum: ["grok", "runway", "kling", "veo"],
      },
      image: {
        type: "string",
        description: "Input image path. Required for runway gen4_turbo, optional for runway gen4.5/kling/veo.",
      },
      runwayModel: {
        type: "string",
        description: "Runway model: gen4.5 (default, text+image-to-video) or gen4_turbo (image-to-video only)",
        enum: ["gen4.5", "gen4_turbo"],
      },
      output: {
        type: "string",
        description: "Output file path",
      },
      duration: {
        type: "number",
        description: "Video duration in seconds",
      },
      mode: {
        type: "string",
        description: "Quality mode for Kling (std or pro)",
        enum: ["std", "pro"],
      },
      negativePrompt: {
        type: "string",
        description: "What to avoid in the generated video (Veo only)",
      },
      resolution: {
        type: "string",
        description: "Video resolution (Veo only)",
        enum: ["720p", "1080p", "4k"],
      },
    },
    required: ["prompt"],
  },
};

const ttsDef: ToolDefinition = {
  name: "generate_speech",
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
  name: "generate_sound_effect",
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
  name: "generate_music",
  description: "Generate music using AI. Default: ElevenLabs (synchronous, up to 10min). Alternative: Replicate/MusicGen (async, max 30s).",
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
        description: "Duration in seconds (elevenlabs: 3-600, replicate: 1-30)",
      },
      provider: {
        type: "string",
        description: "Provider: elevenlabs (default, synchronous, up to 10min) or replicate (async, max 30s)",
        enum: ["elevenlabs", "replicate"],
      },
      instrumental: {
        type: "boolean",
        description: "Force instrumental music with no vocals (ElevenLabs only)",
      },
    },
    required: ["prompt"],
  },
};

const storyboardDef: ToolDefinition = {
  name: "generate_storyboard",
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
  name: "generate_motion",
  description:
    "Generate motion graphics using Claude + Remotion. Can render to video and composite onto existing footage. " +
    "Without --video: generates and renders a standalone motion graphic. With --video: renders and composites onto the base video.",
  parameters: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description: "Natural language description of the motion graphic (e.g., 'cinematic title card with fade-in')",
      },
      video: {
        type: "string",
        description: "Base video path to composite the motion graphic onto (triggers render + composite)",
      },
      output: {
        type: "string",
        description: "Output file path (.mp4 if compositing, .webm if render-only, .tsx if code-only)",
      },
      duration: {
        type: "number",
        description: "Duration in seconds (default: 5)",
      },
      width: {
        type: "number",
        description: "Width in pixels (default: 1920)",
      },
      height: {
        type: "number",
        description: "Height in pixels (default: 1080)",
      },
      style: {
        type: "string",
        description: "Style preset",
        enum: ["minimal", "corporate", "playful", "cinematic"],
      },
    },
    required: ["description"],
  },
};

// ============================================================================
// Tool Handlers
// ============================================================================

const generateImage: ToolHandler = async (args, context): Promise<ToolResult> => {
  const prompt = args.prompt as string;
  const provider = (args.provider as string) || "gemini";
  const output = (args.output as string) || `generated-${getTimestamp()}.png`;
  const size = (args.size as string) || "1024x1024";

  try {
    let providerKey: string;

    switch (provider) {
      case "gemini":
        providerKey = "google";
        break;
      case "openai":
      case "dalle": // backward compatibility
        providerKey = "openai";
        break;
      case "grok":
        providerKey = "xai";
        break;
      default:
        providerKey = "openai";
    }

    const apiKey = await getApiKeyFromConfig(providerKey);
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
    } else if (provider === "grok") {
      const { GrokProvider } = await import("@vibeframe/ai-providers");
      const grok = new GrokProvider();
      await grok.initialize({ apiKey });

      const result = await grok.generateImage(prompt);

      if (!result.success || !result.images || result.images.length === 0) {
        return {
          toolCallId: "",
          success: false,
          output: "",
          error: `Image generation failed: ${result.error || "No image generated"}`,
        };
      }

      // Grok returns URLs
      const image = result.images[0];
      if (image.url) {
        const response = await fetch(image.url);
        const buffer = Buffer.from(await response.arrayBuffer());
        await writeFile(outputPath, buffer);
      } else if (image.base64) {
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
  const provider = (args.provider as string) || "grok";
  const imagePath = args.image as string | undefined;
  const output = (args.output as string) || `${provider}-${getTimestamp()}.mp4`;
  const duration = (args.duration as number) || (provider === "veo" ? 6 : 5);

  const runwayModel = (args.runwayModel as string) || "gen4.5";

  // Validate: Runway gen4_turbo requires an image; gen4.5 supports text-to-video
  if (provider === "runway" && !imagePath && runwayModel !== "gen4.5") {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Runway ${runwayModel} requires an input image. Provide 'image' parameter, use 'gen4.5' model, or use provider 'kling'/'veo' for text-to-video.`,
    };
  }

  // Helper to prepare reference image
  async function prepareReferenceImage(imgPath: string): Promise<string> {
    const absImagePath = resolve(context.workingDirectory, imgPath);
    const imageBuffer = await readFile(absImagePath);
    const base64 = imageBuffer.toString("base64");
    const ext = imgPath.split(".").pop()?.toLowerCase() || "png";
    const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
    return `data:${mimeType};base64,${base64}`;
  }

  try {
    if (provider === "runway") {
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

      const referenceImage = imagePath ? await prepareReferenceImage(imagePath) : undefined;

      const result = await runway.generateVideo(prompt, {
        prompt,
        model: runwayModel,
        duration,
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

      if (result.status === "pending" || result.status === "processing") {
        let finalResult = result;
        const maxAttempts = 60;
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

        if (finalResult.videoUrl) {
          const outputPath = resolve(context.workingDirectory, output);
          const buffer = await downloadVideo(finalResult.videoUrl, apiKey);
          await writeFile(outputPath, buffer);
        }
      }

      return {
        toolCallId: "",
        success: true,
        output: `Video generated: ${output}\nProvider: runway\nPrompt: ${prompt}\nDuration: ${duration}s`,
      };
    } else if (provider === "veo") {
      const apiKey = await getApiKeyFromConfig("google");
      if (!apiKey) {
        return {
          toolCallId: "",
          success: false,
          output: "",
          error: "Google API key required. Configure via 'vibe setup'.",
        };
      }

      const { GeminiProvider } = await import("@vibeframe/ai-providers");
      const gemini = new GeminiProvider();
      await gemini.initialize({ apiKey });

      const referenceImage = imagePath ? await prepareReferenceImage(imagePath) : undefined;
      const negativePrompt = args.negativePrompt as string | undefined;
      const resolution = args.resolution as "720p" | "1080p" | "4k" | undefined;
      const veoDuration = duration <= 6 ? (duration <= 4 ? 4 : 6) : 8;

      const result = await gemini.generateVideo(prompt, {
        prompt,
        duration: veoDuration as 4 | 6 | 8,
        referenceImage,
        model: "veo-3.1-fast-generate-preview",
        negativePrompt,
        resolution,
      });

      if (result.status === "failed") {
        return {
          toolCallId: "",
          success: false,
          output: "",
          error: `Veo video generation failed: ${result.error}`,
        };
      }

      if (result.status === "pending" || result.status === "processing") {
        const finalResult = await gemini.waitForVideoCompletion(
          result.id,
          undefined,
          300000
        );

        if (finalResult.status !== "completed") {
          return {
            toolCallId: "",
            success: false,
            output: "",
            error: `Veo video generation timed out or failed: ${finalResult.error || finalResult.status}`,
          };
        }

        if (finalResult.videoUrl) {
          const outputPath = resolve(context.workingDirectory, output);
          const buffer = await downloadVideo(finalResult.videoUrl, apiKey);
          await writeFile(outputPath, buffer);
        }
      }

      return {
        toolCallId: "",
        success: true,
        output: `Video generated: ${output}\nProvider: veo\nPrompt: ${prompt}\nDuration: ${duration}s`,
      };
    } else if (provider === "grok") {
      const apiKey = await getApiKeyFromConfig("xai");
      if (!apiKey) {
        return {
          toolCallId: "",
          success: false,
          output: "",
          error: "xAI API key required. Configure via 'vibe setup'.",
        };
      }

      const { GrokProvider } = await import("@vibeframe/ai-providers");
      const grok = new GrokProvider();
      await grok.initialize({ apiKey });

      const referenceImage = imagePath ? await prepareReferenceImage(imagePath) : undefined;

      const result = await grok.generateVideo(prompt, {
        prompt,
        duration,
        referenceImage,
        aspectRatio: "16:9",
      });

      if (result.status === "failed") {
        return {
          toolCallId: "",
          success: false,
          output: "",
          error: `Grok video generation failed: ${result.error}`,
        };
      }

      if (result.status === "pending" || result.status === "processing") {
        const finalResult = await grok.waitForCompletion(
          result.id,
          undefined,
          300000
        );

        if (finalResult.status !== "completed") {
          return {
            toolCallId: "",
            success: false,
            output: "",
            error: `Grok video generation timed out or failed: ${finalResult.error || finalResult.status}`,
          };
        }

        if (finalResult.videoUrl) {
          const outputPath = resolve(context.workingDirectory, output);
          const buffer = await downloadVideo(finalResult.videoUrl, apiKey);
          await writeFile(outputPath, buffer);
        }
      }

      return {
        toolCallId: "",
        success: true,
        output: `Video generated: ${output}\nProvider: grok (native audio)\nPrompt: ${prompt}\nDuration: ${duration}s`,
      };
    } else {
      // kling
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

      let referenceImage = imagePath ? await prepareReferenceImage(imagePath) : undefined;
      const mode = (args.mode as "std" | "pro") || "std";

      // Kling v2.5+ requires image URL, not base64 — auto-upload to ImgBB
      if (referenceImage && referenceImage.startsWith("data:")) {
        const imgbbKey = await getApiKeyFromConfig("imgbb") || process.env.IMGBB_API_KEY;
        if (!imgbbKey) {
          return {
            toolCallId: "",
            success: false,
            output: "",
            error: "Kling requires image URL for image-to-video. Set IMGBB_API_KEY for auto-upload via 'vibe setup'.",
          };
        }
        const { uploadToImgbb } = await import("../../commands/ai-script-pipeline.js");
        const base64Data = referenceImage.split(",")[1];
        const imageBuffer = Buffer.from(base64Data, "base64");
        const uploadResult = await uploadToImgbb(imageBuffer, imgbbKey);
        if (!uploadResult.success || !uploadResult.url) {
          return {
            toolCallId: "",
            success: false,
            output: "",
            error: `ImgBB upload failed: ${uploadResult.error || "Unknown error"}`,
          };
        }
        referenceImage = uploadResult.url;
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
          const buffer = await downloadVideo(finalResult.videoUrl, apiKey);
          await writeFile(outputPath, buffer);
        }
      }

      return {
        toolCallId: "",
        success: true,
        output: `Video generated: ${output}\nProvider: kling\nPrompt: ${prompt}\nDuration: ${duration}s\nMode: ${mode}`,
      };
    }
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to generate video: ${error instanceof Error ? error.message : String(error)}`,
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
  const provider = (args.provider as string) || "elevenlabs";
  const instrumental = (args.instrumental as boolean) || false;

  try {
    if (provider === "elevenlabs") {
      // ElevenLabs Music API — synchronous, up to 10 minutes
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

      const result = await elevenlabs.generateMusic(prompt, {
        duration,
        forceInstrumental: instrumental,
      });

      if (!result.success || !result.audioBuffer) {
        return {
          toolCallId: "",
          success: false,
          output: "",
          error: `Music generation failed: ${result.error || "No audio generated"}`,
        };
      }

      const outputPath = resolve(context.workingDirectory, output);
      await writeFile(outputPath, result.audioBuffer);

      return {
        toolCallId: "",
        success: true,
        output: `Music generated: ${output}\nPrompt: ${prompt}\nDuration: ${duration}s\nProvider: ElevenLabs${instrumental ? "\nMode: Instrumental" : ""}`,
      };
    } else {
      // Replicate MusicGen — async polling
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
        output: `Music generated: ${output}\nPrompt: ${prompt}\nDuration: ${duration}s\nProvider: Replicate`,
      };
    }
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
    const sanitizedResult = sanitizeAIResult(result);
    const summary = sanitizedResult.map((scene, i) =>
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

const generateMotion: ToolHandler = async (args, context): Promise<ToolResult> => {
  try {
    const { executeMotion } = await import("../../commands/ai-motion.js");

    const video = args.video
      ? resolve(context.workingDirectory, args.video as string)
      : undefined;
    const output = args.output
      ? resolve(context.workingDirectory, args.output as string)
      : undefined;

    const result = await executeMotion({
      description: args.description as string,
      duration: args.duration as number | undefined,
      width: args.width as number | undefined,
      height: args.height as number | undefined,
      style: args.style as string | undefined,
      render: true, // Always render in agent mode
      video,
      output,
    });

    if (!result.success) {
      return {
        toolCallId: "",
        success: false,
        output: result.codePath ? `TSX code saved to: ${result.codePath}` : "",
        error: result.error || "Motion generation failed",
      };
    }

    const parts: string[] = [];
    if (result.codePath) parts.push(`Code: ${result.codePath}`);
    if (result.renderedPath) parts.push(`Rendered: ${result.renderedPath}`);
    if (result.compositedPath) parts.push(`Composited: ${result.compositedPath}`);

    return {
      toolCallId: "",
      success: true,
      output: parts.join("\n"),
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Motion generation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

// ============================================================================
// v0.6x additions — generate_background + video lifecycle helpers
// ============================================================================

const generateBackgroundDef: ToolDefinition = {
  name: "generate_background",
  description: "Generate a cinematic backdrop image (OpenAI gpt-image-2 / DALL·E variant tuned for video backgrounds). Returns the image URL and downloads to `output` when given. Requires OPENAI_API_KEY.",
  parameters: {
    type: "object",
    properties: {
      description: { type: "string", description: "Background description / image prompt." },
      aspect:      { type: "string", description: "Aspect ratio. Default '16:9'.", enum: ["16:9", "9:16", "1:1"] },
      output:      { type: "string", description: "Output PNG path (relative resolves against agent cwd)." },
    },
    required: ["description"],
  },
};

const generateBackgroundHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const result = await executeBackground({
    description: args.description as string,
    aspect: args.aspect as "16:9" | "9:16" | "1:1" | undefined,
    output: args.output ? resolve(context.workingDirectory, args.output as string) : undefined,
  });
  if (!result.success) {
    return { toolCallId: "", success: false, output: "", error: result.error ?? "generate_background failed" };
  }
  return { toolCallId: "", success: true, output: `Background generated → ${result.outputPath ?? result.imageUrl}` };
};

const generateVideoStatusDef: ToolDefinition = {
  name: "generate_video_status",
  description: "Check video generation status for Runway or Kling tasks. Optionally wait for completion and download the video.",
  parameters: {
    type: "object",
    properties: {
      taskId:   { type: "string", description: "Task ID returned from generate_video" },
      provider: { type: "string", description: "Provider (default: runway)", enum: ["runway", "kling"] },
      taskType: { type: "string", description: "Kling task type", enum: ["text2video", "image2video"] },
      wait:     { type: "boolean", description: "Block until completion (polls every ~10s)" },
      output:   { type: "string", description: "Download video to this path when complete" },
    },
    required: ["taskId"],
  },
};

const generateVideoStatusHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const result = await executeVideoStatus({
    taskId: args.taskId as string,
    provider: args.provider as "runway" | "kling" | undefined,
    taskType: args.taskType as "text2video" | "image2video" | undefined,
    wait: args.wait as boolean | undefined,
    output: args.output ? resolve(context.workingDirectory, args.output as string) : undefined,
  });
  if (!result.success) {
    return { toolCallId: "", success: false, output: "", error: result.error ?? "generate_video_status failed" };
  }
  const lines: string[] = [`Status: ${result.status}`];
  if (result.videoUrl) lines.push(`Video URL: ${result.videoUrl}`);
  if (result.outputPath) lines.push(`Saved → ${result.outputPath}`);
  return { toolCallId: "", success: true, output: lines.join("\n") };
};

const generateVideoCancelDef: ToolDefinition = {
  name: "generate_video_cancel",
  description: "Cancel an in-flight Runway video generation task. Charges still apply if the job was already mostly complete.",
  parameters: {
    type: "object",
    properties: {
      taskId: { type: "string", description: "Task ID to cancel" },
    },
    required: ["taskId"],
  },
};

const generateVideoCancelHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const result = await executeVideoCancel({ taskId: args.taskId as string });
  if (!result.success) {
    return { toolCallId: "", success: false, output: "", error: result.error ?? "generate_video_cancel failed" };
  }
  return { toolCallId: "", success: true, output: `Task ${args.taskId} cancelled.` };
};

const generateMusicStatusDef: ToolDefinition = {
  name: "generate_music_status",
  description: "Check Replicate music generation status. `generate_music` returns a task id; this tool polls it until the audio URL is ready. Requires REPLICATE_API_TOKEN.",
  parameters: {
    type: "object",
    properties: {
      taskId: { type: "string", description: "Task ID returned from generate_music" },
    },
    required: ["taskId"],
  },
};

const generateMusicStatusHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const result = await executeMusicStatus({ taskId: args.taskId as string });
  if (!result.success) {
    return { toolCallId: "", success: false, output: "", error: result.error ?? "generate_music_status failed" };
  }
  const lines: string[] = [`Music task ${result.taskId}: ${result.status}`];
  if (result.audioUrl) lines.push(`Audio URL: ${result.audioUrl}`);
  if (result.error) lines.push(`Error: ${result.error}`);
  return { toolCallId: "", success: true, output: lines.join("\n") };
};

const generateVideoExtendDef: ToolDefinition = {
  name: "generate_video_extend",
  description: "Extend a previously-generated video using Kling or Veo. Requires the video/operation ID from a prior generate_video call.",
  parameters: {
    type: "object",
    properties: {
      videoId:  { type: "string", description: "Video ID (Kling) or operation name (Veo)" },
      provider: { type: "string", description: "Provider (default: kling)", enum: ["kling", "veo"] },
      prompt:   { type: "string", description: "Optional continuation prompt" },
      duration: { type: "number", description: "Extension duration in seconds (5 or 10 for Kling)" },
      negative: { type: "string", description: "Negative prompt (Kling/Veo)" },
      veoModel: { type: "string", description: "Veo model name override" },
      output:   { type: "string", description: "Download to this path when complete" },
      wait:     { type: "boolean", description: "Block until completion" },
    },
    required: ["videoId"],
  },
};

const generateVideoExtendHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const result = await executeVideoExtend({
    videoId: args.videoId as string,
    provider: args.provider as "kling" | "veo" | undefined,
    prompt: args.prompt as string | undefined,
    duration: args.duration as number | undefined,
    negative: args.negative as string | undefined,
    veoModel: args.veoModel as string | undefined,
    output: args.output ? resolve(context.workingDirectory, args.output as string) : undefined,
    wait: args.wait as boolean | undefined,
  });
  if (!result.success) {
    return { toolCallId: "", success: false, output: "", error: result.error ?? "generate_video_extend failed" };
  }
  const lines: string[] = [`Extension status: ${result.status}`];
  if (result.videoUrl) lines.push(`Video URL: ${result.videoUrl}`);
  if (result.outputPath) lines.push(`Saved → ${result.outputPath}`);
  return { toolCallId: "", success: true, output: lines.join("\n") };
};

// ============================================================================
// Registration
// ============================================================================

export function registerGenerationTools(registry: ToolRegistry): void {
  // Manifest takes precedence — skip names already sourced from
  // packages/cli/src/tools/manifest. Same pattern as scene.ts/timeline.ts.
  if (!MIGRATED.has(imageDef.name))                  registry.register(imageDef, generateImage);
  if (!MIGRATED.has(videoDef.name))                  registry.register(videoDef, generateVideo);
  if (!MIGRATED.has(ttsDef.name))                    registry.register(ttsDef, generateTTS);
  if (!MIGRATED.has(sfxDef.name))                    registry.register(sfxDef, generateSFX);
  if (!MIGRATED.has(musicDef.name))                  registry.register(musicDef, generateMusic);
  if (!MIGRATED.has(storyboardDef.name))             registry.register(storyboardDef, generateStoryboard);
  if (!MIGRATED.has(motionDef.name))                 registry.register(motionDef, generateMotion);
  if (!MIGRATED.has(generateBackgroundDef.name))     registry.register(generateBackgroundDef, generateBackgroundHandler);
  if (!MIGRATED.has(generateMusicStatusDef.name))    registry.register(generateMusicStatusDef, generateMusicStatusHandler);
  if (!MIGRATED.has(generateVideoStatusDef.name))    registry.register(generateVideoStatusDef, generateVideoStatusHandler);
  if (!MIGRATED.has(generateVideoCancelDef.name))    registry.register(generateVideoCancelDef, generateVideoCancelHandler);
  if (!MIGRATED.has(generateVideoExtendDef.name))    registry.register(generateVideoExtendDef, generateVideoExtendHandler);
}
