/**
 * The CLI side of the video job contract: open a provider by name with the
 * user's key, and turn local files into the image form it takes. Video
 * executors, job records, and builds go through here instead of branching
 * on provider names.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ProviderError,
  createVideoGenerator,
  defaultModel,
  priceRecord,
  type VideoGenerator,
  type VideoJob,
  type VideoRequest,
} from "@vibeframe/ai-providers";
import { requireConfiguredApiKey } from "../../utils/api-key.js";
import { unknownVideoProviderMessage } from "./build-video-providers.js";
import { resolveUploadHost } from "../../utils/upload-host.js";

/** Env var holding each video provider's key. */
export const VIDEO_PROVIDER_ENV: Readonly<Record<string, string>> = {
  seedance: "FAL_API_KEY",
  grok: "XAI_API_KEY",
  kling: "KLING_API_KEY",
  runway: "RUNWAY_API_SECRET",
  omni: "GOOGLE_API_KEY",
};

/** Display names for spinners and missing-key messages ("Kling API key required."). */
export const VIDEO_PROVIDER_LABELS: Readonly<Record<string, string>> = {
  seedance: "Seedance via fal.ai",
  grok: "Grok Imagine",
  kling: "Kling",
  runway: "Runway",
  omni: "Gemini Omni 1.1 Flash",
};

/** A video generator for `provider`, with the given key or the configured one. */
export async function openVideoGenerator(provider: string, apiKey?: string): Promise<VideoGenerator> {
  const id = provider.toLowerCase();
  const envVar = VIDEO_PROVIDER_ENV[id];
  if (!envVar) {
    throw new ProviderError({ kind: "invalid-request", provider: id, message: unknownVideoProviderMessage(provider) });
  }
  // No key is a setup problem, not a provider rejection: ApiKeyError
  // (API_KEY_MISSING), never ProviderError "auth".
  const key = await requireConfiguredApiKey(envVar, VIDEO_PROVIDER_LABELS[id] ?? id, apiKey);
  return createVideoGenerator(id, key);
}

/**
 * What a video request would cost, priced from the model catalog with the
 * usage its provider would meter (`VideoGenerator.usageFor`): for dry runs,
 * so the estimate matches what the real run reports. Undefined when the
 * provider does not meter its submissions or the catalog cannot price it.
 * Opens no connection and needs no key; throws the `ProviderError` the
 * provider would refuse the request with.
 */
export async function meteredVideoCostUsd(provider: string, request: VideoRequest): Promise<number | undefined> {
  const generator = await createVideoGenerator(provider.toLowerCase(), "");
  if (!generator.usageFor) return undefined;
  const usd = priceRecord({ ...generator.usageFor(request), at: Date.now() });
  return usd === undefined ? undefined : Number(usd.toFixed(6));
}

/**
 * A job handle for a bare task ID (a user typed it, or an old job record
 * predates stored handles). Providers that need more than the ID recover
 * it themselves: Kling tries both task types, Seedance uses its model's app.
 */
export function jobFromTaskId(provider: string, taskId: string, opts: { model?: string; taskType?: string } = {}): VideoJob {
  const id = provider.toLowerCase();
  return {
    provider: id,
    id: taskId,
    model: opts.model ?? defaultModel(id, "video").id,
    submittedAt: "",
    ...(opts.taskType ? { meta: { type: opts.taskType } } : {}),
  };
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

export function mimeTypeForPath(path: string, fallback: string): string {
  return MIME_TYPES[path.toLowerCase().split(".").pop() ?? ""] ?? fallback;
}

/** A local path, URL, or data URI as a URL or data URI (local files are inlined). */
export async function fileToUrlOrDataUri(input: string, fallbackMimeType: string): Promise<string> {
  if (/^(https?:|data:)/.test(input)) return input;
  const buffer = await readFile(resolve(process.cwd(), input));
  return `data:${mimeTypeForPath(input, fallbackMimeType)};base64,${buffer.toString("base64")}`;
}

/**
 * An input image in the form `generator` takes: uploaded to the configured
 * upload host for URL-only providers, inlined as a data URI otherwise.
 *
 * Remote URLs are never fetched here: an inline-only provider gets a usage
 * error instead, so a tool call cannot make the CLI read an internal URL
 * and forward its contents to a provider.
 */
export async function videoImageInput(generator: VideoGenerator, input: string): Promise<string> {
  const isUrl = /^https?:/i.test(input);
  if (generator.imageInput === "data-uri" && isUrl) {
    throw new ProviderError({
      kind: "invalid-request",
      provider: generator.id,
      message: `${generator.id} takes images inline; pass a local file path or a data URI, not a URL.`,
    });
  }
  if (generator.imageInput !== "url" || isUrl) {
    return fileToUrlOrDataUri(input, "image/png");
  }
  const buffer = input.startsWith("data:")
    ? Buffer.from(input.slice(input.indexOf(",") + 1), "base64")
    : await readFile(resolve(process.cwd(), input));
  const host = await resolveUploadHost();
  const upload = await host.uploadImage(buffer, {
    filename: input.startsWith("data:") ? "frame.png" : input,
    mimeType: input.startsWith("data:") ? input.slice(5, input.indexOf(";")) : mimeTypeForPath(input, "image/png"),
  });
  return upload.url;
}
