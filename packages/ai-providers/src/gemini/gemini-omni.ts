/**
 * @module gemini/gemini-omni
 *
 * Google Gemini Omni 1.1 Flash (`gemini-omni-1.1-flash`) text- and
 * image-to-video. GA since 2026-08-27 and Google's named replacement for the
 * Veo 3.1 previews that shut down on 2026-10-22.
 *
 * Omni uses the stateful `POST /v1beta/interactions` endpoint (not Veo's
 * `:predictLongRunning`) with the same `GOOGLE_API_KEY`. Request shape per
 * https://ai.google.dev/gemini-api/docs/omni:
 *
 * - `input`: a string, or typed items (`{type:"image", data, mime_type}` for
 *   frames, then `{type:"text", text}`).
 * - `response_format`: `{type:"video", aspect_ratio, resolution, delivery}`.
 *
 * The video comes back in `steps[].content[]` (`type:"video"`). We ask for
 * `delivery:"uri"` because inline base64 is only meant for clips under 4 MB,
 * then wait for the Files API entry to become ACTIVE and hand the CLI a
 * download URL that needs the key as a header, never in the URL.
 *
 * Omni picks the clip length itself (3-10 s); there is no duration field.
 */

import type { GenerateOptions, VideoResult } from "../interface/types.js";
import type { ProviderConfig } from "../interface/index.js";
import { sleep } from "../shared/http.js";
import { defaultModel } from "../catalog/catalog.js";

export const OMNI_MODEL = defaultModel("omni", "video").id;
const API_ROOT = "https://generativelanguage.googleapis.com";
const FILE_POLL_INTERVAL_MS = 3000;
const FILE_POLL_TIMEOUT_MS = 5 * 60 * 1000;

/** Output resolutions Omni accepts; 1080p and 4k are upscaled from 720p. */
export type OmniResolution = "360p" | "720p" | "1080p" | "4k";

interface InteractionContent {
  type?: string;
  mime_type?: string;
  data?: string;
  uri?: string;
}

interface InteractionResponse {
  id?: string;
  status?: string;
  steps?: Array<{ type?: string; content?: InteractionContent[] }>;
  output_video?: InteractionContent;
  error?: { message?: string };
}

/** Inline images for `input`: the first frame, then an optional last frame. */
function frameImages(options: GenerateOptions): Array<{ base64: string; mimeType: string }> {
  const frames: Array<{ base64: string; mimeType: string }> = [];
  const toInline = (ref: string): { base64: string; mimeType: string } => {
    const m = ref.match(/^data:(.+?);base64,(.*)$/);
    return m ? { mimeType: m[1], base64: m[2] } : { mimeType: "image/png", base64: ref };
  };
  if (options.referenceImages?.[0]?.base64) frames.push(options.referenceImages[0]);
  else if (typeof options.referenceImage === "string" && options.referenceImage) {
    frames.push(toInline(options.referenceImage));
  }
  if (frames.length > 0 && options.lastFrame) frames.push(toInline(options.lastFrame));
  return frames;
}

/** The generated video item from a REST interaction response. */
export function findOmniVideo(response: InteractionResponse): InteractionContent | undefined {
  for (const step of response.steps ?? []) {
    if (step.type !== "model_output") continue;
    const video = step.content?.find((c) => c.type === "video");
    if (video) return video;
  }
  return response.output_video;
}

/** `https://.../v1beta/files/abc` or `files/abc` → `abc`. */
function fileIdFromUri(uri: string): string | undefined {
  return uri.match(/files\/([^/?:]+)/)?.[1];
}

/**
 * Gemini Omni video client. Mirrors the shape the CLI expects from other
 * video providers (`initialize` + `generateVideo` → {@link VideoResult}).
 */
export class OmniProvider {
  id = "omni";
  label = "Gemini Omni 1.1 Flash";
  private apiKey?: string;

  async initialize(config: ProviderConfig): Promise<void> {
    this.apiKey = config.apiKey;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async generateVideo(prompt: string, options?: GenerateOptions): Promise<VideoResult> {
    if (!this.apiKey) {
      return { id: "", status: "failed", error: "GOOGLE_API_KEY not configured for Gemini Omni" };
    }
    const opts = options ?? ({ prompt } as GenerateOptions);
    const frames = frameImages(opts);
    const input =
      frames.length === 0
        ? prompt
        : [
            ...frames.map((f) => ({ type: "image", data: f.base64, mime_type: f.mimeType })),
            { type: "text", text: prompt },
          ];
    const body = {
      model: OMNI_MODEL,
      input,
      response_format: {
        type: "video",
        aspect_ratio: opts.aspectRatio === "9:16" ? "9:16" : "16:9",
        resolution: (opts.resolution as OmniResolution | undefined) ?? "720p",
        delivery: "uri",
      },
    };

    try {
      const res = await fetch(`${API_ROOT}/v1beta/interactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        return {
          id: "",
          status: "failed",
          error: `Gemini Omni request failed: HTTP ${res.status} - ${text.slice(0, 300)}`,
        };
      }
      const parsed = JSON.parse(text) as InteractionResponse;
      const id = parsed.id ?? "";
      const video = findOmniVideo(parsed);
      if (!video?.uri) {
        const reason = parsed.error?.message ?? `status ${parsed.status ?? "unknown"}`;
        return { id, status: "failed", error: `Gemini Omni returned no video (${reason})` };
      }
      const fileId = fileIdFromUri(video.uri);
      if (!fileId) {
        return { id, status: "failed", error: `Gemini Omni returned an unexpected video URI: ${video.uri}` };
      }
      const ready = await this.waitForFile(fileId);
      if (ready !== "ACTIVE") {
        return { id, status: "failed", error: `Gemini Omni video file ended in state ${ready}` };
      }
      return {
        id,
        status: "completed",
        videoUrl: `${API_ROOT}/download/v1beta/files/${fileId}:download?alt=media`,
      };
    } catch (err) {
      return {
        id: "",
        status: "failed",
        error: `Gemini Omni error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /** Poll the Files API until the generated video is downloadable. */
  private async waitForFile(fileId: string): Promise<string> {
    const deadline = Date.now() + FILE_POLL_TIMEOUT_MS;
    for (;;) {
      const res = await fetch(`${API_ROOT}/v1beta/files/${fileId}`, {
        headers: { "x-goog-api-key": this.apiKey! },
      });
      const state = res.ok ? ((await res.json()) as { state?: string }).state : `HTTP ${res.status}`;
      if (state !== "PROCESSING") return state ?? "UNKNOWN";
      if (Date.now() > deadline) return "TIMEOUT";
      await sleep(FILE_POLL_INTERVAL_MS);
    }
  }
}

export const omniProvider = new OmniProvider();
