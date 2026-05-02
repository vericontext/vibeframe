/**
 * ai-helpers.ts — Shared utility functions used across AI commands.
 *
 * These were extracted from ai.ts to improve maintainability.
 * ai.ts imports and re-uses these internally.
 */

import type { EditSuggestion } from "@vibeframe/ai-providers";
import type { EffectType } from "@vibeframe/core/timeline";
import { Project } from "../engine/index.js";

/**
 * Minimal shape required by {@link applySuggestion}. Accepts the canonical
 * {@link EditSuggestion} from the AI provider as well as the CLI's local
 * `SuggestEditEntry`, which omits the optional `id`/`previewUrl`.
 */
export type ApplicableSuggestion = Pick<EditSuggestion, "type" | "clipIds" | "params">;

/**
 * Download a video from URL, handling Veo/Google API authentication.
 * Uses x-goog-api-key header (not query param) for Google API URLs.
 *
 * @param url - Video URL to download
 * @param apiKey - Google API key (caller should resolve from env/config)
 */
export async function downloadVideo(url: string, apiKey?: string): Promise<Buffer> {
  const headers: Record<string, string> = {};
  if (url.includes("generativelanguage.googleapis.com") && apiKey) {
    headers["x-goog-api-key"] = apiKey;
  }
  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** Format a duration in seconds to m:ss.s display format */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  return `${mins}:${secs.padStart(4, "0")}`;
}

/** Apply a single AI edit suggestion to a project */
export function applySuggestion(project: Project, suggestion: ApplicableSuggestion): boolean {
  const { type, clipIds, params } = suggestion;

  if (clipIds.length === 0) return false;
  const clipId = clipIds[0];

  switch (type) {
    case "trim": {
      const newDuration = params.newDuration;
      if (typeof newDuration === "number") {
        return project.trimClipEnd(clipId, newDuration);
      }
      break;
    }
    case "add-effect": {
      const effectType = params.effectType;
      if (typeof effectType === "string") {
        const startTime = typeof params.startTime === "number" ? params.startTime : 0;
        const duration = typeof params.duration === "number" ? params.duration : 1;
        const rawEffectParams =
          params.effectParams && typeof params.effectParams === "object"
            ? (params.effectParams as Record<string, unknown>)
            : {};
        const effectParams: Record<string, string | number | boolean> = {};
        for (const [k, v] of Object.entries(rawEffectParams)) {
          if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
            effectParams[k] = v;
          }
        }
        const effect = project.addEffect(clipId, {
          type: effectType as EffectType,
          startTime,
          duration,
          params: effectParams,
        });
        return effect !== null;
      }
      break;
    }
    case "delete":
      return project.removeClip(clipId);
  }

  return false;
}
