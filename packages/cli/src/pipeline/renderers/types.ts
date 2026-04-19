/**
 * Render backend abstraction for the VibeFrame export pipeline.
 *
 * Existing FFmpeg-filter-graph path lives in packages/cli/src/commands/export.ts.
 * New backends (hyperframes, future Remotion bridge) implement RenderBackend
 * to slot in via `vibe export --backend` or YAML `render.backend`.
 *
 * See docs/design/hyperframes-adapter.md for the Hyperframes wiring plan.
 */

import type { TimelineState } from "@vibeframe/core";

export type BackendName = "ffmpeg" | "hyperframes";

export interface RenderOptions {
  projectState: TimelineState;
  outputPath: string;
  fps?: 24 | 30 | 60;
  quality?: "draft" | "standard" | "high";
  format?: "mp4" | "webm" | "mov";
  /** Hyperframes capture worker count. Defaults to 1 (sequential) — auto-worker mode times out on small comps. */
  workers?: number;
  onProgress?: (pct: number, stage: string) => void;
  signal?: AbortSignal;
}

export interface RenderResult {
  success: boolean;
  outputPath?: string;
  durationMs?: number;
  framesRendered?: number;
  error?: string;
}

export interface RenderBackend {
  name: BackendName;
  /** Human-readable check before invocation (e.g. Chrome present, FFmpeg version). */
  preflight?(): Promise<{ ok: true } | { ok: false; reason: string }>;
  render(options: RenderOptions): Promise<RenderResult>;
}
