/**
 * @module ai-image
 * @description Library functions for image generation, image editing, and
 * thumbnail best-frame selection. Powers the manifest tools
 * `generate_image`, `edit_image`, and `generate_thumbnail` (which the user
 * actually reaches via `vibe generate image / edit image / generate thumbnail`).
 *
 * The legacy `vibe ai image / thumbnail / background / gemini / gemini-edit`
 * Commander registrations were removed alongside the dead `commands/ai.ts`
 * orchestrator (the `vibe ai *` namespace was never `addCommand`'d to
 * `program`).
 *
 * @see MODELS.md for AI model configuration
 */

import { resolve, dirname } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { GeminiProvider, OpenAIImageProvider } from "@vibeframe/ai-providers";
import { execSafe, commandExists } from "../utils/exec-safe.js";

// ============================================================================
// Image Generate
// ============================================================================

export interface ImageGenerateOptions {
  prompt: string;
  provider?: string;
  output?: string;
  size?: string;
  ratio?: string;
  quality?: string;
  style?: string;
  count?: number;
  model?: string;
  apiKey?: string;
}

export interface ImageGenerateResult {
  success: boolean;
  outputPath?: string;
  images?: Array<{ url?: string; base64?: string; mimeType?: string; revisedPrompt?: string }>;
  provider?: string;
  model?: string;
  error?: string;
}

export async function executeImageGenerate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
  const {
    prompt,
    provider = "gemini",
    output,
    size = "1024x1024",
    ratio = "1:1",
    quality = "standard",
    style = "vivid",
    count = 1,
    model,
    apiKey,
  } = options;

  try {
    if (provider === "openai") {
      const key = apiKey || process.env.OPENAI_API_KEY;
      if (!key) return { success: false, error: "OPENAI_API_KEY required" };

      const openaiImage = new OpenAIImageProvider();
      await openaiImage.initialize({ apiKey: key });

      const result = await openaiImage.generateImage(prompt, {
        size: size as "1024x1024" | "1536x1024" | "1024x1536" | "auto" | undefined,
        quality: quality as "standard" | "hd" | undefined,
        style: style as "vivid" | "natural" | undefined,
        n: count,
      });

      if (!result.success || !result.images) {
        return { success: false, error: result.error || "Image generation failed" };
      }

      let outputPath: string | undefined;
      if (output && result.images.length > 0) {
        const img = result.images[0];
        let buffer: Buffer;
        if (img.url) {
          const response = await fetch(img.url);
          buffer = Buffer.from(await response.arrayBuffer());
        } else if (img.base64) {
          buffer = Buffer.from(img.base64, "base64");
        } else {
          return { success: false, error: "No image data available" };
        }
        outputPath = resolve(process.cwd(), output);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, buffer);
      }

      return {
        success: true,
        outputPath,
        images: result.images.map(img => ({ url: img.url, base64: img.base64, revisedPrompt: img.revisedPrompt })),
        provider: "openai",
      };
    } else if (provider === "gemini") {
      const key = apiKey || process.env.GOOGLE_API_KEY;
      if (!key) return { success: false, error: "GOOGLE_API_KEY required" };

      const gemini = new GeminiProvider();
      await gemini.initialize({ apiKey: key });

      const modelMap: Record<string, string> = { latest: "3.1-flash" };
      const mappedModel = model ? (modelMap[model] || model) : undefined;

      let result = await gemini.generateImage(prompt, {
        model: mappedModel as "flash" | "3.1-flash" | "pro" | undefined,
        aspectRatio: ratio as "1:1" | "16:9" | "9:16" | "4:3" | "3:4",
      });

      const fallbackModels = ["3.1-flash"];
      if (!result.success && mappedModel && fallbackModels.includes(mappedModel)) {
        result = await gemini.generateImage(prompt, {
          model: "flash",
          aspectRatio: ratio as "1:1" | "16:9" | "9:16" | "4:3" | "3:4",
        });
      }

      if (!result.success || !result.images) {
        return { success: false, error: result.error || "Image generation failed" };
      }

      let outputPath: string | undefined;
      if (output && result.images.length > 0) {
        const img = result.images[0];
        if (img.base64) {
          outputPath = resolve(process.cwd(), output);
          await mkdir(dirname(outputPath), { recursive: true });
          await writeFile(outputPath, Buffer.from(img.base64, "base64"));
        }
      }

      return {
        success: true,
        outputPath,
        images: result.images.map(img => ({ base64: img.base64, mimeType: img.mimeType })),
        provider: "gemini",
        model: result.model,
      };
    } else if (provider === "grok") {
      const key = apiKey || process.env.XAI_API_KEY;
      if (!key) return { success: false, error: "XAI_API_KEY required" };

      const openaiImage = new OpenAIImageProvider();
      await openaiImage.initialize({ apiKey: key, baseUrl: "https://api.x.ai/v1" });

      const result = await openaiImage.generateImage(prompt, {
        size: size as "1024x1024" | "1536x1024" | "1024x1536" | "auto" | undefined,
        n: count,
      });

      if (!result.success || !result.images) {
        return { success: false, error: result.error || "Image generation failed" };
      }

      let outputPath: string | undefined;
      if (output && result.images.length > 0) {
        const img = result.images[0];
        let buffer: Buffer;
        if (img.url) {
          const response = await fetch(img.url);
          buffer = Buffer.from(await response.arrayBuffer());
        } else if (img.base64) {
          buffer = Buffer.from(img.base64, "base64");
        } else {
          return { success: false, error: "No image data available" };
        }
        outputPath = resolve(process.cwd(), output);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, buffer);
      }

      return {
        success: true,
        outputPath,
        images: result.images.map(img => ({ url: img.url, base64: img.base64, revisedPrompt: img.revisedPrompt })),
        provider: "grok",
      };
    }

    return { success: false, error: `Unsupported provider: ${provider}` };
  } catch (error) {
    return { success: false, error: `Image generation failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// ============================================================================
// Gemini Image Edit
// ============================================================================

export interface GeminiEditOptions {
  imagePaths: string[];
  prompt: string;
  output?: string;
  model?: string;
  ratio?: string;
  resolution?: string;
  apiKey?: string;
}

export interface GeminiEditResult {
  success: boolean;
  outputPath?: string;
  model?: string;
  error?: string;
}

export async function executeGeminiEdit(options: GeminiEditOptions): Promise<GeminiEditResult> {
  const {
    imagePaths,
    prompt,
    output = "edited.png",
    model = "flash",
    ratio,
    resolution,
    apiKey,
  } = options;

  try {
    const key = apiKey || process.env.GOOGLE_API_KEY;
    if (!key) return { success: false, error: "GOOGLE_API_KEY required" };

    const imageBuffers: Buffer[] = [];
    for (const imagePath of imagePaths) {
      const absPath = resolve(process.cwd(), imagePath);
      if (!existsSync(absPath)) {
        return { success: false, error: `Image not found: ${absPath}` };
      }
      const buffer = await readFile(absPath);
      imageBuffers.push(buffer);
    }

    const gemini = new GeminiProvider();
    await gemini.initialize({ apiKey: key });

    type GeminiAspectRatio = "1:1" | "1:4" | "1:8" | "2:3" | "3:2" | "3:4" | "4:1" | "4:3" | "4:5" | "5:4" | "8:1" | "9:16" | "16:9" | "21:9";
    type GeminiRes = "512px" | "1K" | "2K" | "4K";

    let result = await gemini.editImage(imageBuffers, prompt, {
      model: model as "flash" | "3.1-flash" | "pro" | undefined,
      aspectRatio: ratio as GeminiAspectRatio | undefined,
      resolution: resolution as GeminiRes | undefined,
    });

    const fallbackModels = ["latest", "3.1-flash"];
    if (!result.success && fallbackModels.includes(model)) {
      result = await gemini.editImage(imageBuffers, prompt, {
        model: "flash",
        aspectRatio: ratio as GeminiAspectRatio | undefined,
        resolution: resolution as GeminiRes | undefined,
      });
    }

    if (!result.success || !result.images || result.images.length === 0) {
      return { success: false, error: result.error || "Image editing failed" };
    }

    const img = result.images[0];
    let outputPath: string | undefined;
    if (img.base64) {
      outputPath = resolve(process.cwd(), output);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, Buffer.from(img.base64, "base64"));
    }

    return {
      success: true,
      outputPath,
      model: result.model,
    };
  } catch (error) {
    return { success: false, error: `Image editing failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// ============================================================================
// Thumbnail Best Frame
// ============================================================================

export interface ThumbnailBestFrameOptions {
  videoPath: string;
  outputPath: string;
  prompt?: string;
  model?: string;
  apiKey?: string;
}

export interface ThumbnailBestFrameResult {
  success: boolean;
  outputPath?: string;
  timestamp?: number;
  reason?: string;
  error?: string;
}

export async function executeThumbnailBestFrame(options: ThumbnailBestFrameOptions): Promise<ThumbnailBestFrameResult> {
  const {
    videoPath,
    outputPath,
    prompt,
    model = "flash",
    apiKey,
  } = options;

  if (!existsSync(videoPath)) {
    return { success: false, error: `Video not found: ${videoPath}` };
  }

  if (!commandExists("ffmpeg")) {
    return { success: false, error: "FFmpeg not found. Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux). Run `vibe doctor` for details." };
  }

  const googleKey = apiKey || process.env.GOOGLE_API_KEY;
  if (!googleKey) {
    return { success: false, error: "Google API key required for Gemini video analysis. Run 'vibe setup' or set GOOGLE_API_KEY in .env" };
  }

  try {
    const gemini = new GeminiProvider();
    await gemini.initialize({ apiKey: googleKey });

    const videoData = await readFile(videoPath);

    const analysisPrompt = prompt ||
      "Analyze this video and find the single best frame for a thumbnail. " +
      "Look for frames that are visually striking, well-composed, emotionally engaging, " +
      "and representative of the video content. Avoid blurry frames, transitions, or dark scenes. " +
      "Return ONLY a JSON object: {\"timestamp\": <seconds as number>, \"reason\": \"<brief explanation>\"}";

    const modelMap: Record<string, string> = {
      flash: "gemini-3-flash-preview",
      latest: "gemini-2.5-flash",
      "flash-2.5": "gemini-2.5-flash",
      pro: "gemini-2.5-pro",
    };
    const modelId = modelMap[model] || "gemini-3-flash-preview";

    const result = await gemini.analyzeVideo(videoData, analysisPrompt, {
      model: modelId as "gemini-3-flash-preview" | "gemini-2.5-flash" | "gemini-2.5-pro",
      fps: 1,
    });

    if (!result.success || !result.response) {
      return { success: false, error: result.error || "Gemini analysis failed" };
    }

    const jsonMatch = result.response.match(/\{[\s\S]*?"timestamp"\s*:\s*([\d.]+)[\s\S]*?\}/);
    if (!jsonMatch) {
      return { success: false, error: `Could not parse timestamp from Gemini response: ${result.response.slice(0, 200)}` };
    }

    const timestamp = parseFloat(jsonMatch[1]);
    let reason: string | undefined;
    const reasonMatch = result.response.match(/"reason"\s*:\s*"([^"]+)"/);
    if (reasonMatch) {
      reason = reasonMatch[1];
    }

    await execSafe("ffmpeg", ["-ss", String(timestamp), "-i", videoPath, "-frames:v", "1", "-q:v", "2", outputPath, "-y"], { timeout: 60000, maxBuffer: 50 * 1024 * 1024 });

    if (!existsSync(outputPath)) {
      return { success: false, error: "FFmpeg failed to extract frame" };
    }

    return {
      success: true,
      outputPath,
      timestamp,
      reason,
    };
  } catch (error) {
    return {
      success: false,
      error: `Best frame extraction failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
