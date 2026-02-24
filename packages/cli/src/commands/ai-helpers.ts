/**
 * ai-helpers.ts — Shared utility functions used across AI commands.
 *
 * These were extracted from ai.ts to improve maintainability.
 * ai.ts imports and re-uses these internally.
 */

import { writeFile } from "node:fs/promises";
import { Project } from "../engine/index.js";

/**
 * Download a video from URL, handling Veo/Google API authentication.
 */
export async function downloadVideoFile(
  videoUrl: string,
  outputPath: string,
  apiKey?: string,
): Promise<void> {
  let downloadUrl = videoUrl;
  // Veo/Google API URLs require API key authentication
  if (downloadUrl.includes("generativelanguage.googleapis.com") && apiKey) {
    const separator = downloadUrl.includes("?") ? "&" : "?";
    downloadUrl = `${downloadUrl}${separator}key=${apiKey}`;
  }
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, buffer);
}

/** Format a duration in seconds to m:ss.s display format */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  return `${mins}:${secs.padStart(4, "0")}`;
}

/** Apply a single AI edit suggestion to a project */
export function applySuggestion(project: Project, suggestion: any): boolean {
  const { type, clipIds, params } = suggestion;

  if (clipIds.length === 0) return false;
  const clipId = clipIds[0];

  switch (type) {
    case "trim":
      if (params.newDuration) {
        return project.trimClipEnd(clipId, params.newDuration);
      }
      break;
    case "add-effect":
      if (params.effectType) {
        const effect = project.addEffect(clipId, {
          type: params.effectType,
          startTime: params.startTime || 0,
          duration: params.duration || 1,
          params: params.effectParams || {},
        });
        return effect !== null;
      }
      break;
    case "delete":
      return project.removeClip(clipId);
  }

  return false;
}
