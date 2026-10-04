/**
 * Veo 3.1 on the video job contract, as a thin wrapper over
 * `GeminiProvider`'s Veo methods. Every Veo 3.1 model shuts down on
 * 2026-10-22, so this exists only so callers have no Veo-specific branch
 * until then; it is deleted together with Veo.
 */

import type { VideoGenerator, VideoJob, VideoJobState, VideoRequest } from "../video/contract.js";
import { ProviderError, classifyProviderError } from "../shared/errors.js";
import { providerRequest } from "../shared/http.js";
import { resolveVideoModel } from "../video/models.js";
import { GeminiProvider, type VeoModel } from "./GeminiProvider.js";

function veoReferenceImages(request: VideoRequest): Array<{ base64: string; mimeType: string }> | undefined {
  const images = (request.references ?? [])
    .filter((r) => r.kind === "image" && r.url.startsWith("data:"))
    .slice(0, 3)
    .map((r) => {
      const m = r.url.match(/^data:(.+?);base64,(.*)$/s);
      return m ? { mimeType: m[1], base64: m[2] } : undefined;
    })
    .filter((r): r is { base64: string; mimeType: string } => !!r);
  return images.length > 0 ? images : undefined;
}

export class VeoGenerator implements VideoGenerator {
  readonly id = "veo";
  readonly imageInput = "data-uri" as const;
  private gemini = new GeminiProvider();
  private apiKey?: string;

  async initialize(config: { apiKey?: string }): Promise<void> {
    this.apiKey = config.apiKey;
    await this.gemini.initialize({ apiKey: config.apiKey });
  }

  async submitVideo(request: VideoRequest): Promise<VideoJob> {
    if (request.from?.kind === "edit") {
      throw new ProviderError({ kind: "unsupported", provider: this.id, message: "Veo cannot edit an earlier video; it can extend one." });
    }
    // Extension defaults to Veo 3.1 (not Fast), as the extend command always has.
    const model = resolveVideoModel(this.id, request.model ?? (request.from ? "3.1" : undefined)).id as VeoModel;
    const result = request.from
      ? await this.gemini.extendVideo(request.from.job.id, request.prompt, {
          duration: (request.durationSec ?? 8) as 4 | 6 | 8,
          model,
        })
      : await this.gemini.generateVideo(request.prompt, {
          prompt: request.prompt,
          model,
          duration: request.durationSec,
          aspectRatio: request.aspectRatio,
          referenceImage: request.image,
          lastFrame: request.lastFrame,
          negativePrompt: request.negativePrompt,
          resolution: request.resolution,
          // Veo keeps up to 3 inline reference images for character consistency.
          referenceImages: veoReferenceImages(request),
          personGeneration: request.providerOptions?.personGeneration as string | undefined,
        });
    if (result.status === "failed" || !result.id) {
      throw classifyProviderError({ provider: this.id, message: result.error ?? "Veo generation failed" });
    }
    return { provider: this.id, id: result.id, model, submittedAt: new Date().toISOString() };
  }

  async getVideoJob(job: VideoJob): Promise<VideoJobState> {
    const result = await this.gemini.getGenerationStatus(job.id);
    return {
      status: result.status,
      progress: result.progress,
      videoUrl: result.videoUrl,
      ...(result.status === "failed"
        ? { error: classifyProviderError({ provider: this.id, message: result.error ?? "Veo generation failed" }).toJSON() }
        : {}),
    };
  }

  async downloadVideo(_job: VideoJob, state: VideoJobState): Promise<Uint8Array> {
    if (!state.videoUrl || !this.apiKey) {
      throw new ProviderError({ kind: "not-found", provider: this.id, message: "Veo job has no video to download." });
    }
    const response = await providerRequest(this.id, state.videoUrl, { headers: { "x-goog-api-key": this.apiKey } });
    return new Uint8Array(await response.arrayBuffer());
  }
}
