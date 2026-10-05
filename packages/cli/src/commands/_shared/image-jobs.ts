/**
 * The CLI side of the image contract: open an image provider by name with
 * the user's key, read input images, and save results. Image commands,
 * tools, scenes, and builds go through here instead of branching on
 * provider names.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ProviderError, createImageGenerator, findModel, type ImageGenerator, type ImageInput } from "@vibeframe/ai-providers";
import { getConfiguredApiKey } from "../../utils/api-key.js";
import { writeImageFile } from "../../utils/image-file.js";
import { mimeTypeForPath } from "./video-jobs.js";

/** Env var holding each image provider's key. */
export const IMAGE_PROVIDER_ENV: Readonly<Record<string, string>> = {
  openai: "OPENAI_API_KEY",
  gemini: "GOOGLE_API_KEY",
  grok: "XAI_API_KEY",
};

/** Display names for spinners and messages. */
export const IMAGE_PROVIDER_LABELS: Readonly<Record<string, string>> = {
  openai: "OpenAI",
  gemini: "Google Gemini",
  grok: "xAI Grok",
};

/** An image generator for `provider`, with the given key or the configured one. */
export async function openImageGenerator(provider: string, apiKey?: string): Promise<ImageGenerator> {
  const envVar = IMAGE_PROVIDER_ENV[provider];
  if (!envVar) {
    throw new ProviderError({
      kind: "invalid-request",
      provider,
      message: `Unknown image provider "${provider}". Available: ${Object.keys(IMAGE_PROVIDER_ENV).join(", ")}.`,
    });
  }
  const key = await getConfiguredApiKey(envVar, apiKey);
  if (!key) throw new ProviderError({ kind: "auth", provider, message: `${envVar} required for ${provider}.` });
  return createImageGenerator(provider, key);
}

/** A local image file as contract input. */
export async function readImageInput(path: string): Promise<ImageInput> {
  const absPath = resolve(process.cwd(), path);
  if (!existsSync(absPath)) {
    throw new ProviderError({ kind: "invalid-request", provider: "local", message: `Image not found: ${absPath}` });
  }
  return { bytes: new Uint8Array(await readFile(absPath)), mimeType: mimeTypeForPath(path, "image/png") };
}

/** Save image bytes to `output` (relative to cwd), converting to the extension's format. */
export async function saveImage(output: string, bytes: Uint8Array): Promise<string> {
  const outputPath = resolve(process.cwd(), output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeImageFile(outputPath, Buffer.from(bytes));
  return outputPath;
}

/** The catalog label for a model ID, for human output. */
export function imageModelLabel(provider: string, modelId: string): string {
  return findModel(provider, "image", modelId)?.label ?? modelId;
}

/** CLI quality words to the contract's: `standard`/`hd` are the old OpenAI names. */
export function contractQuality(quality?: string): "low" | "medium" | "high" | undefined {
  if (quality === "standard") return "medium";
  if (quality === "hd") return "high";
  return quality === "low" || quality === "medium" || quality === "high" ? quality : undefined;
}
