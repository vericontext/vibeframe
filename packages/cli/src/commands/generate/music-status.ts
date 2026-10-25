/**
 * @module generate/music-status
 * @description `vibe generate music-status` (hidden) — Replicate music
 * generation status check. Split out of `generate.ts` in v0.69 (Plan G
 * Phase 2).
 */

import { ReplicateProvider } from "@vibeframe/ai-providers";
import { requireConfiguredApiKey } from "../../utils/api-key.js";

// ── Library: executeMusicStatus ─────────────────────────────────────────

export interface ExecuteMusicStatusOptions {
  taskId: string;
  apiKey?: string;
}
export interface ExecuteMusicStatusResult {
  success: boolean;
  taskId?: string;
  status?: "completed" | "failed" | "processing";
  audioUrl?: string;
  error?: string;
}

export async function executeMusicStatus(
  options: ExecuteMusicStatusOptions,
): Promise<ExecuteMusicStatusResult> {
  // A missing key throws ApiKeyError (API_KEY_MISSING), outside the catch below.
  const apiKey = await requireConfiguredApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);
  try {

    const replicate = new ReplicateProvider();
    await replicate.initialize({ apiKey });
    const result = await replicate.getMusicStatus(options.taskId);

    const status: "completed" | "failed" | "processing" = result.audioUrl
      ? "completed"
      : result.error
        ? "failed"
        : "processing";

    return {
      success: true,
      taskId: options.taskId,
      status,
      audioUrl: result.audioUrl,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      error: `Music status check failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ── CLI: vibe generate music-status (hidden) ────────────────────────────
