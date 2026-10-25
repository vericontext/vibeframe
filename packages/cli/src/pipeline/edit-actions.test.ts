/**
 * Pipeline edit steps call the same executors as `vibe edit` and the MCP
 * tools, and their cost estimate follows the step's parameters.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  executeReframe: vi.fn(),
  executeUpscale: vi.fn(),
  executeSpeedRamp: vi.fn(),
}));

vi.mock("../commands/edit-cmd.js", () => mocks);

import { executePipeline } from "./executor.js";
import type { PipelineManifest } from "./types.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "edit-actions-test-"));
  vi.clearAllMocks();
  mocks.executeReframe.mockImplementation(async (options) => ({
    success: true,
    outputPath: options.output,
    focus: options.focus ?? "center",
    crop: { x: 0, y: 0, width: 2, height: 2 },
  }));
  mocks.executeUpscale.mockImplementation(async (options) => ({
    success: true,
    outputPath: options.output,
    originalRes: "320x240",
    targetRes: "640x480",
  }));
});

const manifest = (steps: PipelineManifest["steps"]): PipelineManifest => ({ name: "edit-test", steps });

describe("pipeline edit steps", () => {
  it("estimates a center reframe as free and a vision reframe at the Claude upper bound", async () => {
    const center = await executePipeline(
      manifest([{ id: "r", action: "edit-reframe", input: "in.mp4" }]),
      { outputDir: workDir, dryRun: true, budget: { costUsd: 100 } },
    );
    const vision = await executePipeline(
      manifest([{ id: "r", action: "edit-reframe", input: "in.mp4", focus: "face" }]),
      { outputDir: workDir, dryRun: true, budget: { costUsd: 100 } },
    );
    expect(center.budget?.estimatedCostUsd).toBe(0);
    expect(vision.budget?.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("passes the reframe focus through, and leaves it unset so the executor's free default applies", async () => {
    await executePipeline(
      manifest([
        { id: "plain", action: "edit-reframe", input: "in.mp4" },
        { id: "face", action: "edit-reframe", input: "in.mp4", focus: "face", output: "face.mp4" },
      ]),
      { outputDir: workDir },
    );
    expect(mocks.executeReframe).toHaveBeenNthCalledWith(1, expect.objectContaining({ videoPath: "in.mp4", focus: undefined }));
    expect(mocks.executeReframe).toHaveBeenNthCalledWith(2, expect.objectContaining({ focus: "face", output: join(workDir, "face.mp4") }));
  });

  it("runs edit-upscale and edit-speed-ramp instead of reporting them as unknown actions", async () => {
    const plan = await executePipeline(
      manifest([
        { id: "u", action: "edit-upscale", input: "in.mp4" },
        { id: "s", action: "edit-speed-ramp", input: "in.mp4" },
      ]),
      { outputDir: workDir, dryRun: true },
    );
    expect(plan.steps.map((s) => (s.data as { estimatedCost?: string }).estimatedCost)).not.toContain("UNKNOWN ACTION");

    const run = await executePipeline(manifest([{ id: "u", action: "edit-upscale", input: "in.mp4", scale: 2 }]), { outputDir: workDir });
    expect(run.success).toBe(true);
    expect(mocks.executeUpscale).toHaveBeenCalledWith(expect.objectContaining({ videoPath: "in.mp4", scale: 2 }));
  });
});
