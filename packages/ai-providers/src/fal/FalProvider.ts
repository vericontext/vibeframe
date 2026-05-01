import { createFalClient, type FalClient } from "@fal-ai/client";
import type {
  AIProvider,
  AICapability,
  ProviderConfig,
  GenerateOptions,
  VideoResult,
} from "../interface/types.js";

/**
 * fal.ai endpoints for ByteDance Seedance 2.0.
 *
 * "No API" on the Artificial Analysis leaderboard means there is no
 * direct ByteDance API — fal.ai is the gateway. Both quality and
 * `fast` variants are exposed; the fast tier trades fidelity for
 * latency and cost.
 *
 *   text-to-video         — Artificial Analysis ELO 1270 (#2)
 *   image-to-video        — Artificial Analysis ELO 1347 (#2)
 *
 * Reference: https://artificialanalysis.ai/video/leaderboard/text-to-video
 */
export type SeedanceVariant = "seedance-2.0" | "seedance-2.0-fast";

// Endpoint ids match fal.ai's documented JS-client form exactly. They
// don't carry a `fal-ai/` prefix despite the URL slug suggesting one —
// see https://fal.ai/models/bytedance/seedance-2.0/text-to-video.
const ENDPOINT_TEXT_TO_VIDEO: Record<SeedanceVariant, string> = {
  "seedance-2.0":      "bytedance/seedance-2.0/text-to-video",
  "seedance-2.0-fast": "bytedance/seedance-2.0/fast/text-to-video",
};

const ENDPOINT_IMAGE_TO_VIDEO: Record<SeedanceVariant, string> = {
  "seedance-2.0":      "bytedance/seedance-2.0/image-to-video",
  "seedance-2.0-fast": "bytedance/seedance-2.0/fast/image-to-video",
};

const DEFAULT_VARIANT: SeedanceVariant = "seedance-2.0";

/** Resolutions Seedance 2.0 accepts. The API rejects everything else. */
const VALID_RESOLUTIONS = ["480p", "720p", "1080p"] as const;
type SeedanceResolution = (typeof VALID_RESOLUTIONS)[number];

/** Aspect ratios Seedance 2.0 accepts. */
const VALID_ASPECTS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "auto"] as const;
type SeedanceAspect = (typeof VALID_ASPECTS)[number];

/** Shape of the video object Seedance returns. */
interface SeedanceOutput {
  video?: { url?: string; content_type?: string; file_size?: number };
  seed?: number;
}

/**
 * Provider hosting ByteDance Seedance 2.0 via fal.ai.
 *
 * Implements both `text-to-video` and `image-to-video` against the same
 * underlying client. Uses `client.subscribe()` so the call blocks until
 * the queue produces a final URL — avoids exposing the queue lifecycle
 * to the rest of the codebase, which expects synchronous-feeling
 * `generateVideo` semantics like the other providers.
 *
 * `generate_audio` defaults to `true` on the upstream API: Seedance
 * synthesises native sound effects + speech alongside the video, so a
 * narrated scene-render does NOT need our v0.55 ffmpeg audio mux to
 * carry an audio track. Useful when the caller is happy to let the
 * model compose the soundtrack.
 */
export class FalProvider implements AIProvider {
  id = "seedance";
  name = "fal.ai (Seedance 2.0)";
  description = "fal.ai hosting ByteDance Seedance 2.0 — Artificial Analysis #2 on both text-to-video and image-to-video leaderboards";
  capabilities: AICapability[] = ["text-to-video", "image-to-video"];
  iconUrl = "/icons/fal.svg";
  isAvailable = true;

  private client?: FalClient;
  private apiKey?: string;

  async initialize(config: ProviderConfig): Promise<void> {
    this.apiKey = config.apiKey;
    if (!this.apiKey) return;
    this.client = createFalClient({ credentials: this.apiKey });
  }

  isConfigured(): boolean {
    return !!this.apiKey && !!this.client;
  }

  /**
   * Generate a video from a text prompt — or from a reference image when
   * `options.referenceImage` is set (treated as an image-to-video
   * request, routed to a different endpoint).
   *
   * fal.subscribe blocks until the final result is available. It also
   * surfaces queue / log events through `onQueueUpdate`, which we drop
   * silently for now — the CLI's existing spinner is the user-facing
   * progress UI.
   */
  async generateVideo(
    prompt: string,
    options?: GenerateOptions,
  ): Promise<VideoResult> {
    if (!this.client) {
      return {
        id: "",
        status: "failed",
        error: "fal.ai API key not configured. Set FAL_API_KEY in .env.",
      };
    }

    const variant = (options?.model as SeedanceVariant | undefined) ?? DEFAULT_VARIANT;
    if (!Object.hasOwn(ENDPOINT_TEXT_TO_VIDEO, variant)) {
      return {
        id: "",
        status: "failed",
        error: `Unknown Seedance variant: ${variant}. Valid: ${Object.keys(ENDPOINT_TEXT_TO_VIDEO).join(", ")}.`,
      };
    }

    const referenceImage = pickReferenceImageUrl(options?.referenceImage);
    const isImageToVideo = !!referenceImage;
    const endpointId = isImageToVideo
      ? ENDPOINT_IMAGE_TO_VIDEO[variant]
      : ENDPOINT_TEXT_TO_VIDEO[variant];

    const aspect = normaliseAspect(options?.aspectRatio);
    const resolution = normaliseResolution(options?.resolution);
    const duration = normaliseDuration(options?.duration);

    const input: Record<string, unknown> = {
      prompt,
      aspect_ratio: aspect,
      resolution,
      duration,
    };
    if (referenceImage) input.image_url = referenceImage;
    if (options?.negativePrompt) input.negative_prompt = options.negativePrompt;
    if (typeof options?.seed === "number") input.seed = options.seed;
    if (options?.lastFrame) input.end_image_url = options.lastFrame;

    try {
      const out = await this.client.subscribe(endpointId, { input, logs: false });
      const data = (out?.data ?? {}) as SeedanceOutput;
      const url = data.video?.url;
      if (!url) {
        return {
          id: typeof out?.requestId === "string" ? out.requestId : "",
          status: "failed",
          error: "fal.subscribe returned without a video URL",
        };
      }
      return {
        id: typeof out?.requestId === "string" ? out.requestId : "",
        status: "completed",
        videoUrl: url,
        progress: 100,
      };
    } catch (err) {
      return {
        id: "",
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/**
 * Accept the same `referenceImage` shapes other providers do. fal.ai
 * needs an HTTPS URL — base64 / Blob isn't supported here yet (callers
 * that have only a local file should upload it via fal.storage first,
 * which we leave as a follow-up).
 */
function pickReferenceImageUrl(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  if (input.startsWith("http://") || input.startsWith("https://")) return input;
  return undefined;
}

function normaliseAspect(value?: string): SeedanceAspect {
  if (!value) return "auto";
  return (VALID_ASPECTS as readonly string[]).includes(value)
    ? (value as SeedanceAspect)
    : "auto";
}

function normaliseResolution(value?: string): SeedanceResolution {
  if (!value) return "720p";
  if ((VALID_RESOLUTIONS as readonly string[]).includes(value)) {
    return value as SeedanceResolution;
  }
  // Map common aliases the CLI surfaces elsewhere.
  if (value === "4k") return "1080p";
  return "720p";
}

function normaliseDuration(value?: number): number | "auto" {
  if (typeof value !== "number") return "auto";
  if (!Number.isFinite(value)) return "auto";
  // Seedance accepts 4–15s; clamp anything outside.
  return Math.max(4, Math.min(15, Math.round(value)));
}

export const falProvider = new FalProvider();
