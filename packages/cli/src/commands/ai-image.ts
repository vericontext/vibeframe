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

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  GeminiProvider,
  isProviderError,
  resolveGeminiTextModel,
  type ProviderErrorKind,
} from "@vibeframe/ai-providers";
import { resolveProvider } from "../utils/provider-resolver.js";
import { ApiKeyError, requireConfiguredApiKey } from "../utils/api-key.js";
import { contractQuality, openImageGenerator, readImageInput, saveImage } from "./_shared/image-jobs.js";
import { numberedPath } from "./_shared/default-output.js";
import { execSafe, commandExists } from "../utils/exec-safe.js";
import { executorFailure, failureFromError, generalError, notFoundError, providerFailure, type StructuredError } from "./output.js";

// ============================================================================
// Image Generate
// ============================================================================

export interface ImageGenerateOptions {
  prompt: string;
  /** Default: the configured or first available image provider. */
  provider?: string;
  output?: string;
  /** Explicit OpenAI size; otherwise the ratio picks one. */
  size?: string;
  ratio?: string;
  quality?: string;
  /** Gemini "1K"/"2K"/"4K", Grok "1k"/"2k". */
  resolution?: string;
  count?: number;
  model?: string;
  apiKey?: string;
}

export interface ImageGenerateResult {
  success: boolean;
  /** Where the first image was saved. */
  outputPath?: string;
  /** Every saved image: `out.png`, then `out-2.png`, `out-3.png`, ... */
  outputPaths?: string[];
  images?: Array<{ base64: string; mimeType: string; revisedPrompt?: string }>;
  provider?: string;
  model?: string;
  error?: string;
  errorKind?: ProviderErrorKind;
}

function imageFailure(error: unknown, prefix: string, provider?: string): ImageGenerateResult {
  // A missing key is not a provider failure; the caller reports it as API_KEY_MISSING.
  if (error instanceof ApiKeyError) throw error;
  if (isProviderError(error)) return { success: false, error: error.message, errorKind: error.kind, provider };
  return { success: false, error: `${prefix}: ${error instanceof Error ? error.message : String(error)}`, provider };
}

export async function executeImageGenerate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
  const provider = options.provider ?? resolveProvider("image")?.name ?? "gemini";
  try {
    const generator = await openImageGenerator(provider, options.apiKey);
    const result = await generator.createImage({
      prompt: options.prompt,
      model: options.model,
      aspectRatio: options.ratio,
      resolution: options.resolution,
      quality: contractQuality(options.quality),
      count: options.count,
      providerOptions: options.size ? { size: options.size } : undefined,
    });
    const outputPaths: string[] = [];
    if (options.output) {
      for (const [i, img] of result.images.entries()) {
        outputPaths.push(await saveImage(i === 0 ? options.output : numberedPath(options.output, i + 1), img.bytes));
      }
    }
    return {
      success: true,
      outputPath: outputPaths[0],
      outputPaths: outputPaths.length > 0 ? outputPaths : undefined,
      images: result.images.map((img) => ({
        base64: Buffer.from(img.bytes).toString("base64"),
        mimeType: img.mimeType,
        revisedPrompt: img.revisedPrompt,
      })),
      provider,
      model: result.model,
    };
  } catch (error) {
    return imageFailure(error, "Image generation failed", provider);
  }
}

// ============================================================================
// Image Edit
// ============================================================================

export interface ImageEditOptions {
  imagePaths: string[];
  prompt: string;
  /** Default: gemini. */
  provider?: string;
  output?: string;
  model?: string;
  ratio?: string;
  resolution?: string;
  quality?: string;
  apiKey?: string;
}

export interface ImageEditResult {
  success: boolean;
  outputPath?: string;
  provider?: string;
  model?: string;
  error?: string;
  errorKind?: ProviderErrorKind;
}

export async function executeImageEdit(options: ImageEditOptions): Promise<ImageEditResult> {
  const provider = options.provider ?? "gemini";
  try {
    const generator = await openImageGenerator(provider, options.apiKey);
    const images = await Promise.all(options.imagePaths.map((path) => readImageInput(path)));
    const result = await generator.createImage({
      prompt: options.prompt,
      model: options.model,
      aspectRatio: options.ratio,
      resolution: options.resolution,
      quality: contractQuality(options.quality),
      images,
    });
    const outputPath = await saveImage(options.output ?? "edited.png", result.images[0].bytes);
    return { success: true, outputPath, provider, model: result.model };
  } catch (error) {
    const failed = imageFailure(error, "Image editing failed", provider);
    return { success: false, error: failed.error, errorKind: failed.errorKind, provider };
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
  /** The structured error on failure; see {@link ExecutorFailure}. */
  failure?: StructuredError;
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
    return executorFailure(notFoundError(videoPath));
  }

  if (!commandExists("ffmpeg")) {
    return executorFailure(generalError("FFmpeg not found", "Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux). Run `vibe doctor` for details."));
  }

  const googleKey = await requireConfiguredApiKey("GOOGLE_API_KEY", "Google", apiKey);

  try {
    const gemini = new GeminiProvider();
    await gemini.initialize({ apiKey: googleKey });

    const videoData = await readFile(videoPath);

    const analysisPrompt = prompt ||
      "Analyze this video and find the single best frame for a thumbnail. " +
      "Look for frames that are visually striking, well-composed, emotionally engaging, " +
      "and representative of the video content. Avoid blurry frames, transitions, or dark scenes. " +
      "Return ONLY a JSON object: {\"timestamp\": <seconds as number>, \"reason\": \"<brief explanation>\"}";

    const modelId = resolveGeminiTextModel(model);

    const result = await gemini.analyzeVideo(videoData, analysisPrompt, {
      model: modelId,
      fps: 1,
    });

    const jsonMatch = result.response.match(/\{[\s\S]*?"timestamp"\s*:\s*([\d.]+)[\s\S]*?\}/);
    if (!jsonMatch) {
      return executorFailure(providerFailure(`Could not parse a timestamp from the Gemini reply: ${result.response.slice(0, 200)}`, "provider"));
    }

    const timestamp = parseFloat(jsonMatch[1]);
    let reason: string | undefined;
    const reasonMatch = result.response.match(/"reason"\s*:\s*"([^"]+)"/);
    if (reasonMatch) {
      reason = reasonMatch[1];
    }

    await execSafe("ffmpeg", ["-ss", String(timestamp), "-i", videoPath, "-frames:v", "1", "-q:v", "2", outputPath, "-y"], { timeout: 60000, maxBuffer: 50 * 1024 * 1024 });

    if (!existsSync(outputPath)) {
      return executorFailure(generalError("FFmpeg failed to extract frame"));
    }

    return {
      success: true,
      outputPath,
      timestamp,
      reason,
    };
  } catch (error) {
    return executorFailure(failureFromError(error, "Best frame extraction failed"));
  }
}
