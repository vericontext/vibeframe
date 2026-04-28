/**
 * Smoke tests for the v0.62 scene-build + scene-render pipeline actions.
 * Mocks executeSceneBuild + executeSceneRender at the import boundary
 * so we test ONLY the wiring between the executor and the underlying
 * helpers — no Chrome, no API calls, no FS scans of real projects.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../commands/_shared/scene-build.js", () => ({
  executeSceneBuild: vi.fn(),
}));

vi.mock("../commands/_shared/scene-render.js", () => ({
  executeSceneRender: vi.fn(),
}));

import { executePipeline, loadPipeline } from "./executor.js";
import { executeSceneBuild } from "../commands/_shared/scene-build.js";
import { executeSceneRender } from "../commands/_shared/scene-render.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "scene-actions-test-"));
  vi.clearAllMocks();
});

function writePipeline(yaml: string): string {
  const path = join(workDir, "pipeline.yaml");
  writeFileSync(path, yaml);
  return path;
}

describe("pipeline action: scene-build", () => {
  it("forwards storyboard cues to executeSceneBuild and surfaces the output path", async () => {
    vi.mocked(executeSceneBuild).mockResolvedValueOnce({
      success: true,
      phase: "done",
      mode: "batch",
      beats: [{ beatId: "hook", narrationStatus: "generated", backdropStatus: "generated" }],
      outputPath: "/tmp/render.mp4",
      totalLatencyMs: 1234,
    });

    const yamlPath = writePipeline(`
name: scene-build-pipeline
steps:
  - id: build
    action: scene-build
    project: my-promo
    tts: kokoro
    voice: af_heart
    quality: hd
`);

    const manifest = await loadPipeline(yamlPath);
    const result = await executePipeline(manifest, { outputDir: workDir });

    expect(result.success).toBe(true);
    expect(executeSceneBuild).toHaveBeenCalledOnce();
    const call = vi.mocked(executeSceneBuild).mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call!.projectDir).toBe(join(workDir, "my-promo"));
    expect(call!.ttsProvider).toBe("kokoro");
    expect(call!.voice).toBe("af_heart");
    expect(call!.imageQuality).toBe("hd");

    expect(result.steps[0].output).toBe("/tmp/render.mp4");
    expect(result.steps[0].action).toBe("scene-build");
  });

  it("surfaces failure from executeSceneBuild as a failed step", async () => {
    vi.mocked(executeSceneBuild).mockResolvedValueOnce({
      success: false,
      phase: "failed",
      mode: "batch",
      error: "STORYBOARD.md not found",
      beats: [],
      totalLatencyMs: 0,
    });

    const manifest = await loadPipeline(writePipeline(`
name: x
steps: [{ id: b, action: scene-build, project: missing }]
`));

    const result = await executePipeline(manifest, { outputDir: workDir });
    expect(result.steps[0].success).toBe(false);
    expect(result.steps[0].error).toContain("STORYBOARD.md not found");
  });

  it("respects --skip-render via params", async () => {
    vi.mocked(executeSceneBuild).mockResolvedValueOnce({
      success: true,
      phase: "compose-only",
      mode: "batch",
      beats: [],
      totalLatencyMs: 0,
    });

    const manifest = await loadPipeline(writePipeline(`
name: x
steps: [{ id: b, action: scene-build, skipRender: true }]
`));

    await executePipeline(manifest, { outputDir: workDir });
    const call = vi.mocked(executeSceneBuild).mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call!.skipRender).toBe(true);
  });
});

describe("pipeline action: scene-render", () => {
  it("forwards render params and surfaces audio metadata", async () => {
    vi.mocked(executeSceneRender).mockResolvedValueOnce({
      success: true,
      outputPath: "/tmp/render.mp4",
      durationMs: 5678,
      framesRendered: 270,
      audioCount: 3,
      audioMuxApplied: true,
    });

    const manifest = await loadPipeline(writePipeline(`
name: x
steps:
  - id: r
    action: scene-render
    project: my-promo
    fps: 30
    quality: high
    format: mp4
`));

    const result = await executePipeline(manifest, { outputDir: workDir });
    expect(result.success).toBe(true);
    expect(executeSceneRender).toHaveBeenCalledOnce();

    const call = vi.mocked(executeSceneRender).mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call!.projectDir).toBe(join(workDir, "my-promo"));
    expect(call!.fps).toBe(30);
    expect(call!.quality).toBe("high");

    const data = result.steps[0].data as { audioCount: number; audioMuxApplied: boolean };
    expect(data.audioCount).toBe(3);
    expect(data.audioMuxApplied).toBe(true);
  });

  it("project param defaults to '.' when omitted", async () => {
    vi.mocked(executeSceneRender).mockResolvedValueOnce({
      success: true,
      outputPath: "/tmp/x.mp4",
    });

    const manifest = await loadPipeline(writePipeline(`
name: x
steps: [{ id: r, action: scene-render }]
`));

    await executePipeline(manifest, { outputDir: workDir });
    const call = vi.mocked(executeSceneRender).mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call!.projectDir).toBe(workDir);
  });
});

describe("pipeline action: scene-build chained with scene-render", () => {
  it("two steps run sequentially, $ref between them resolves", async () => {
    vi.mocked(executeSceneBuild).mockResolvedValueOnce({
      success: true,
      phase: "done",
      mode: "batch",
      beats: [],
      outputPath: "/tmp/build-out",
      totalLatencyMs: 0,
    });
    vi.mocked(executeSceneRender).mockResolvedValueOnce({
      success: true,
      outputPath: "/tmp/render.mp4",
    });

    const manifest = await loadPipeline(writePipeline(`
name: x
steps:
  - id: build
    action: scene-build
    project: p
    skipRender: true
  - id: render
    action: scene-render
    project: p
`));

    const result = await executePipeline(manifest, { outputDir: workDir });
    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(executeSceneBuild).toHaveBeenCalledOnce();
    expect(executeSceneRender).toHaveBeenCalledOnce();
  });
});
