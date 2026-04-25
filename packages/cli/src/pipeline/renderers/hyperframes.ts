import type { RenderConfig } from "@hyperframes/producer";
import type { RenderBackend, RenderOptions, RenderResult } from "./types.js";
import { preflightChrome } from "./chrome.js";

export function createHyperframesBackend(): RenderBackend {
  return {
    name: "hyperframes",

    async preflight() {
      return preflightChrome();
    },

    async render(options: RenderOptions): Promise<RenderResult> {
      const pre = await this.preflight!();
      if (!pre.ok) return { success: false, error: (pre as { ok: false; reason: string }).reason };

      const { buildTempProject } = await import("./project-builder.js");
      const { createRenderJob, executeRenderJob } = await import("@hyperframes/producer");

      let project: Awaited<ReturnType<typeof buildTempProject>> | undefined;
      const start = Date.now();

      try {
        project = await buildTempProject(options.projectState);
      } catch (err) {
        return {
          success: false,
          error: `Failed to build temp project: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      const config: RenderConfig = {
        fps: options.fps ?? 30,
        quality: options.quality ?? "standard",
        format: options.format ?? "mp4",
        entryFile: "index.html",
        crf: qualityToCrf(options.quality),
        workers: options.workers ?? 1,
      };
      const job = createRenderJob(config);

      try {
        await executeRenderJob(
          job,
          project.dir,
          options.outputPath,
          (j, msg) => { options.onProgress?.(j.progress, j.currentStage ?? msg); },
          options.signal
        );
        await project.cleanup();
        return {
          success: true,
          outputPath: options.outputPath,
          durationMs: Date.now() - start,
          framesRendered: job.framesRendered,
        };
      } catch (err) {
        console.error(`[hyperframes] render failed. Temp dir preserved: ${project?.dir}`);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

export function aspectToResolution(ratio: string): { width: number; height: number } {
  switch (ratio) {
    case "16:9": return { width: 1920, height: 1080 };
    case "9:16": return { width: 1080, height: 1920 };
    case "1:1":  return { width: 1080, height: 1080 };
    case "4:5":  return { width: 1080, height: 1350 };
    default:     return { width: 1920, height: 1080 };
  }
}

export function qualityToCrf(quality: "draft" | "standard" | "high" = "standard"): number {
  return quality === "draft" ? 28 : quality === "high" ? 18 : 23;
}
