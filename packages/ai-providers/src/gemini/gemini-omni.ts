/**
 * @module gemini/gemini-omni
 *
 * EXPERIMENTAL — Google Gemini Omni (`gemini-omni-flash-preview`) image-to-video.
 *
 * Omni is a preview video model on the Generative Language API. Unlike Veo
 * (`:predictLongRunning` on `/models`), Omni uses the new stateful
 * `POST /v1beta/interactions` endpoint with a `generation_config.video_config`
 * block (`task: text_to_video | image_to_video | reference_to_video | edit`).
 * It reuses the SAME `GOOGLE_API_KEY` as Gemini/Veo — no new credential.
 *
 * The interactions request/response schema is preview and may shift; this client
 * follows https://ai.google.dev/gemini-api/docs/omni and parses the video URL
 * defensively. Marked experimental and opt-in (`-p omni`); it is NOT wired into
 * the default video-provider resolution.
 *
 * Known preview limits: audio-reference upload unsupported, video refs ≤3s,
 * EEA/CH/UK restrictions on editing uploaded video, English-tested only.
 */

import type { GenerateOptions, VideoResult } from "../interface/types.js";
import type { ProviderConfig } from "../interface/index.js";

const OMNI_MODEL = "gemini-omni-flash-preview";
const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

type OmniTask = "text_to_video" | "image_to_video" | "reference_to_video";

/** Pull an inline base64 image + mime out of `referenceImage` / `referenceImages`. */
function firstReferenceImage(
  options: GenerateOptions
): { base64: string; mimeType: string } | undefined {
  const refs = options.referenceImages;
  if (refs && refs.length > 0 && refs[0].base64) return refs[0];
  const ref = options.referenceImage;
  if (typeof ref === "string" && ref) {
    // data URI or raw base64
    const m = ref.match(/^data:(.+?);base64,(.*)$/);
    if (m) return { mimeType: m[1], base64: m[2] };
    return { mimeType: "image/png", base64: ref };
  }
  return undefined;
}

/** Best-effort walk of an unknown response object for a video URL/uri. */
function findVideoUrl(obj: unknown): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === "string" && /^https?:\/\//.test(v) && /(uri|url|video)/i.test(k)) return v;
    if (typeof v === "object") {
      const nested = findVideoUrl(v);
      if (nested) return nested;
    }
  }
  return undefined;
}

/**
 * Minimal Gemini Omni video client. Mirrors the shape the CLI expects from
 * other video providers (`initialize` + `generateVideo` → {@link VideoResult}).
 */
export class OmniProvider {
  id = "omni";
  label = "Gemini Omni (experimental)";
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
    const image = firstReferenceImage(opts);
    const task: OmniTask = image ? "image_to_video" : "text_to_video";
    const aspectRatio = opts.aspectRatio === "9:16" ? "9:16" : "16:9";

    // Preview interactions request. `inputs` carries the text prompt and, for
    // image_to_video, the anchor frame inline.
    const inputs: Array<Record<string, unknown>> = [{ text: prompt }];
    if (image) {
      inputs.push({ inline_data: { mime_type: image.mimeType, data: image.base64 } });
    }
    const body = {
      model: OMNI_MODEL,
      inputs,
      generation_config: {
        video_config: { task, aspect_ratio: aspectRatio },
      },
    };

    try {
      const res = await fetch(INTERACTIONS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        return {
          id: "",
          status: "failed",
          error: `Gemini Omni (experimental) request failed: HTTP ${res.status} — ${text.slice(0, 300)}`,
        };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { id: "", status: "failed", error: "Gemini Omni returned a non-JSON response" };
      }
      const videoUrl = findVideoUrl(parsed);
      const id =
        (parsed as { interaction_id?: string; name?: string })?.interaction_id ??
        (parsed as { name?: string })?.name ??
        "";
      if (!videoUrl) {
        return {
          id,
          status: "failed",
          error:
            "Gemini Omni response contained no video URL (the preview interactions schema may have changed).",
        };
      }
      return { id, status: "completed", videoUrl };
    } catch (err) {
      return {
        id: "",
        status: "failed",
        error: `Gemini Omni (experimental) error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}

export const omniProvider = new OmniProvider();
