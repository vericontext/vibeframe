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
  type VideoGenerator,
  type VideoJob,
} from "@vibeframe/ai-providers";
import { getConfiguredApiKey } from "../../utils/api-key.js";
import { resolveUploadHost } from "../../utils/upload-host.js";

/** Env var holding each video provider's key. */
export const VIDEO_PROVIDER_ENV: Readonly<Record<string, string>> = {
  seedance: "FAL_API_KEY",
  fal: "FAL_API_KEY",
  grok: "XAI_API_KEY",
  kling: "KLING_API_KEY",
  runway: "RUNWAY_API_SECRET",
  omni: "GOOGLE_API_KEY",
  veo: "GOOGLE_API_KEY",
};

/** `fal` is the old name for `seedance`. */
export function canonicalVideoProvider(provider: string): string {
  const id = provider.toLowerCase();
  return id === "fal" ? "seedance" : id;
}

/** A video generator for `provider`, with the given key or the configured one. */
export async function openVideoGenerator(provider: string, apiKey?: string): Promise<VideoGenerator> {
  const id = canonicalVideoProvider(provider);
  const envVar = VIDEO_PROVIDER_ENV[id];
  if (!envVar) {
    throw new ProviderError({ kind: "invalid-request", provider: id, message: `Unknown video provider "${provider}".` });
  }
  const key = await getConfiguredApiKey(envVar, apiKey);
  if (!key) {
    throw new ProviderError({ kind: "auth", provider: id, message: `${envVar} required for ${id}.` });
  }
  return createVideoGenerator(id, key);
}

/**
 * A job handle for a bare task ID (a user typed it, or an old job record
 * predates stored handles). Providers that need more than the ID recover
 * it themselves: Kling tries both task types, Seedance uses its model's app.
 */
export function jobFromTaskId(provider: string, taskId: string, opts: { model?: string; taskType?: string } = {}): VideoJob {
  const id = canonicalVideoProvider(provider);
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
 */
export async function videoImageInput(generator: VideoGenerator, input: string): Promise<string> {
  if (generator.imageInput !== "url" || /^https?:/.test(input)) {
    if (generator.imageInput === "data-uri" && /^https?:/.test(input)) {
      const response = await fetch(input);
      if (!response.ok) throw new Error(`Could not fetch image ${input}: HTTP ${response.status}`);
      const type = response.headers.get("content-type") ?? mimeTypeForPath(input, "image/png");
      return `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
    }
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
