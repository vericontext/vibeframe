/**
 * Every pipeline action in the catalog has a handler, and the handlers that
 * wrap shared executors pass the step's parameters through.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => {
  const ok = (extra: Record<string, unknown> = {}) =>
    vi.fn(async (options: Record<string, unknown>) => ({
      success: true,
      outputPath: options.outputPath ?? options.output,
      ...extra,
    }));
  return {
    edit: { executeInterpolate: ok({ originalFps: 10, targetFps: 20, factor: 2 }) },
    aiEdit: { executeJumpCut: ok({ fillerCount: 3 }), executeTextOverlay: ok(), executeTranslateSrt: ok({ segmentCount: 2 }) },
    image: { executeImageEdit: ok({ provider: "openai" }) },
    audio: { executeIsolate: ok(), executeDub: ok({ segmentCount: 4 }) },
    analyze: { executeAnalyze: ok({ response: "a cat", model: "flash" }) },
  };
});

vi.mock("../commands/edit-cmd.js", () => mocks.edit);
vi.mock("../commands/ai-edit.js", () => mocks.aiEdit);
vi.mock("../commands/ai-image.js", () => mocks.image);
vi.mock("../commands/ai-audio.js", () => mocks.audio);
vi.mock("../commands/ai-analyze.js", () => mocks.analyze);

import { executePipeline, loadPipeline, PIPELINE_ACTIONS, registeredPipelineActions } from "./executor.js";
import type { PipelineManifest } from "./types.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "action-handlers-test-"));
  vi.clearAllMocks();
});

const manifest = (steps: PipelineManifest["steps"]): PipelineManifest => ({ name: "handlers", steps });

describe("pipeline action handlers", () => {
  it("every catalog action has a handler", async () => {
    expect((await registeredPipelineActions()).sort()).toEqual([...PIPELINE_ACTIONS].sort());
  });

  it("loadPipeline rejects an unknown action and names the known ones", async () => {
    const file = join(workDir, "p.yaml");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(file, "name: x\nsteps:\n  - id: a\n    action: compose-scenes-with-skills\n");
    await expect(loadPipeline(file)).rejects.toThrow(/Step 'a' has unknown action 'compose-scenes-with-skills'. Known actions: generate-image/);
  });

  it("executePipeline refuses a code-built manifest with an unknown action before running anything", async () => {
    const result = await executePipeline(
      manifest([
        { id: "a", action: "edit-interpolate", input: "in.mp4" },
        { id: "b", action: "nope" as never },
      ]),
      { outputDir: join(workDir, "out") },
    );
    expect(result).toMatchObject({ success: false, steps: [], error: "Step 'b' has unknown action 'nope'" });
    expect(mocks.edit.executeInterpolate).not.toHaveBeenCalled();
  });

  it("passes step parameters through to the shared executors", async () => {
    const result = await executePipeline(
      manifest([
        { id: "slow", action: "edit-interpolate", input: "in.mp4", factor: 4, fps: 60, mode: "fast" },
        { id: "jump", action: "edit-jump-cut", input: "in.mp4", fillers: ["um"], padding: 0.1, analyzeOnly: true },
        { id: "text", action: "edit-text-overlay", input: "in.mp4", texts: ["Hi"], style: "minimal", startTime: 1 },
        { id: "srt", action: "edit-translate-srt", input: "in.srt", target: "ko", provider: "openai" },
        { id: "img", action: "edit-image", input: ["a.png", "b.png"], prompt: "merge", provider: "openai" },
        { id: "vox", action: "audio-isolate", input: "in.mp3" },
        { id: "dub", action: "audio-dub", input: "in.mp4", language: "es", analyzeOnly: true },
        { id: "look", action: "analyze-media", input: "in.png", prompt: "what is it", model: "pro" },
      ]),
      { outputDir: workDir },
    );

    expect(result.success).toBe(true);
    expect(mocks.edit.executeInterpolate).toHaveBeenCalledWith(
      expect.objectContaining({ videoPath: "in.mp4", factor: 4, fps: 60, quality: "fast", output: join(workDir, "slow-motion.mp4") }),
    );
    expect(mocks.aiEdit.executeJumpCut).toHaveBeenCalledWith(
      expect.objectContaining({ videoPath: "in.mp4", fillers: ["um"], padding: 0.1, analyzeOnly: true, outputPath: join(workDir, "jump-cut.mp4") }),
    );
    expect(mocks.aiEdit.executeTextOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ videoPath: "in.mp4", texts: ["Hi"], style: "minimal", startTime: 1 }),
    );
    expect(mocks.aiEdit.executeTranslateSrt).toHaveBeenCalledWith(
      expect.objectContaining({ srtPath: "in.srt", targetLanguage: "ko", provider: "openai", outputPath: join(workDir, "translated.srt") }),
    );
    expect(mocks.image.executeImageEdit).toHaveBeenCalledWith(
      expect.objectContaining({ imagePaths: ["a.png", "b.png"], prompt: "merge", provider: "openai", output: join(workDir, "edited.png") }),
    );
    expect(mocks.audio.executeIsolate).toHaveBeenCalledWith({ audioPath: "in.mp3", output: join(workDir, "vocals.mp3") });
    expect(mocks.audio.executeDub).toHaveBeenCalledWith(
      expect.objectContaining({ mediaPath: "in.mp4", language: "es", analyzeOnly: true, output: join(workDir, "dub-timing.json") }),
    );
    expect(mocks.analyze.executeAnalyze).toHaveBeenCalledWith(
      expect.objectContaining({ source: "in.png", prompt: "what is it", model: "pro" }),
    );
    expect(result.steps.find((s) => s.id === "look")?.data).toMatchObject({ response: "a cat" });
  });

  it("prices audio-dub and audio-isolate instead of counting them as free", async () => {
    const plan = await executePipeline(
      manifest([
        { id: "vox", action: "audio-isolate", input: "in.mp3" },
        { id: "dub", action: "audio-dub", input: "in.mp4", language: "es" },
      ]),
      { outputDir: workDir, dryRun: true, budget: { costUsd: 100 } },
    );
    expect(plan.budget?.estimatedCostUsd).toBeCloseTo(1.2);
  });
});
