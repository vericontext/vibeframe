/**
 * AI Generation Tools - Image, video, TTS, SFX, music, storyboard, motion
 *
 * Basic AI asset generation tools that wrap providers for agent use.
 * Some features require async polling - tool returns immediately with task status.
 *
 * See MODELS.md for the Single Source of Truth (SSOT) on supported providers/models.
 */

import { writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ToolRegistry, ToolHandler } from "./index.js";
import type { ToolDefinition, ToolResult } from "../types.js";
import { getApiKeyFromConfig } from "../../config/index.js";

// Helper to get timestamp for filenames
function getTimestamp(): string {
  return Date.now().toString();
}

// ============================================================================
// Tool Definitions
// ============================================================================

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

const generateMotion: ToolHandler = async (args, context): Promise<ToolResult> => {
  try {
    const { executeMotion } = await import("../../commands/ai.js");

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
// Registration
// ============================================================================

export function registerGenerationTools(registry: ToolRegistry): void {
  registry.register(imageDef, generateImage);
  registry.register(videoDef, generateVideo);
  registry.register(klingDef, generateKling);
  registry.register(ttsDef, generateTTS);
  registry.register(sfxDef, generateSFX);
  registry.register(musicDef, generateMusic);
  registry.register(storyboardDef, generateStoryboard);
  registry.register(motionDef, generateMotion);
}
