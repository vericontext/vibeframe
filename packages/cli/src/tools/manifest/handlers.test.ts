/**
 * Manifest tool handlers, called the way the MCP adapter calls them: args
 * validated by the tool's own schema, then `execute` with a working
 * directory. Provider-backed handlers run against mocked executors; the
 * scene handlers run for real against a temp project.
 */

import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ToolExecuteResult } from "../define-tool.js";
import { manifest } from "./index.js";

vi.mock("../../commands/ai-highlights.js", () => ({
  executeHighlights: vi.fn().mockResolvedValue({
    success: true,
    highlights: [
      {
        index: 1,
        startTime: 10,
        endTime: 25,
        duration: 15,
        category: "emotional",
        confidence: 0.95,
        reason: "Test highlight",
        transcript: "Test transcript",
      },
    ],
    totalDuration: 120,
    totalHighlightDuration: 15,
  }),
  executeAutoShorts: vi.fn().mockResolvedValue({
    success: true,
    shorts: [
      {
        index: 1,
        startTime: 30,
        endTime: 60,
        duration: 30,
        confidence: 0.9,
        reason: "Viral moment",
        outputPath: "/test/short-1.mp4",
      },
    ],
  }),
}));

vi.mock("../../commands/ai-analyze.js", () => ({
  executeAnalyze: vi.fn().mockResolvedValue({
    success: true,
    response: "This is a test video summary.",
    model: "gemini-3.8-flash",
    totalTokens: 1000,
  }),
  executeGeminiVideo: vi.fn(),
}));

async function runTool(name: string, args: Record<string, unknown>, cwd = "/test/workdir"): Promise<ToolExecuteResult> {
  const tool = manifest.find((entry) => entry.name === name);
  if (!tool) throw new Error(`No manifest tool named ${name}`);
  return tool.execute(tool.schema.parse(args), { workingDirectory: cwd, surface: "mcp" });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const makeTmp = () => mkdtemp(join(tmpdir(), "vibe-manifest-handlers-"));

describe("provider-backed handlers pass their arguments through", () => {
  it("remix_highlights calls executeHighlights", async () => {
    const { executeHighlights } = await import("../../commands/ai-highlights.js");
    const result = await runTool("remix_highlights", {
      media: "video.mp4",
      duration: 60,
      criteria: "emotional",
      useGemini: true,
    });
    expect(executeHighlights).toHaveBeenCalledWith(
      expect.objectContaining({ media: "video.mp4", duration: 60, criteria: "emotional", useGemini: true })
    );
    expect(result.success).toBe(true);
  });

  it("remix_auto_shorts calls executeAutoShorts, including analyze-only runs", async () => {
    const { executeAutoShorts } = await import("../../commands/ai-highlights.js");
    const result = await runTool("remix_auto_shorts", { video: "long-video.mp4", count: 3, duration: 45, aspect: "9:16" });
    expect(executeAutoShorts).toHaveBeenCalledWith(
      expect.objectContaining({ video: "long-video.mp4", count: 3, duration: 45, aspect: "9:16" })
    );
    expect(result.success).toBe(true);
    expect((await runTool("remix_auto_shorts", { video: "video.mp4", analyzeOnly: true })).success).toBe(true);
  });

  it("inspect_media calls executeAnalyze and leaves URLs untouched", async () => {
    const { executeAnalyze } = await import("../../commands/ai-analyze.js");
    const result = await runTool("inspect_media", { source: "video.mp4", prompt: "Summarize this video", model: "flash" });
    expect(executeAnalyze).toHaveBeenCalledWith(
      expect.objectContaining({ source: "video.mp4", prompt: "Summarize this video", model: "flash" })
    );
    expect(result).toMatchObject({ success: true, data: expect.objectContaining({ response: "This is a test video summary." }) });

    await runTool("inspect_media", { source: "https://youtube.com/watch?v=test", prompt: "Summarize" });
    expect(executeAnalyze).toHaveBeenCalledWith(expect.objectContaining({ source: "https://youtube.com/watch?v=test" }));
  });
});

describe("project-flow and scene handlers (offline)", () => {
  it("init scaffolds a project relative to the working directory", async () => {
    const cwd = await makeTmp();
    const result = await runTool("init", { dir: "promo", aspect: "9:16", duration: 8 }, cwd);
    expect(result.success).toBe(true);
    for (const path of ["promo/index.html", "promo/vibe.config.json", "promo/compositions"]) {
      expect(await pathExists(resolve(cwd, path)), path).toBe(true);
    }
  });

  it("scene_add adds a scene and reports its start and duration", async () => {
    const cwd = await makeTmp();
    await runTool("init", { dir: ".", aspect: "16:9", duration: 6 }, cwd);
    const result = await runTool(
      "scene_add",
      { name: "Intro Scene", preset: "announcement", headline: "Hello", duration: 4, skipAudio: true, skipImage: true },
      cwd
    );
    expect(result).toMatchObject({ success: true, data: expect.objectContaining({ start: 0, duration: 4 }) });

    const sceneFile = await readFile(resolve(cwd, "compositions/scene-intro-scene.html"), "utf-8");
    expect(sceneFile).toContain("Hello");
    expect(sceneFile).not.toContain("<audio");
  });

  it("scene_add fails instead of overwriting an existing scene", async () => {
    const cwd = await makeTmp();
    await runTool("init", { dir: "." }, cwd);
    const scene = { name: "intro", duration: 3, skipAudio: true, skipImage: true };
    await runTool("scene_add", scene, cwd);
    const second = await runTool("scene_add", scene, cwd);
    expect(second.success).toBe(false);
    expect(second.error).toMatch(/already exists/);
  });

  it("scene_lint passes a freshly populated project", async () => {
    const cwd = await makeTmp();
    await runTool("init", { dir: "." }, cwd);
    await runTool("scene_add", { name: "hello", duration: 3, skipAudio: true, skipImage: true }, cwd);
    const result = await runTool("scene_lint", {}, cwd);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ errorCount: 0 });
  });

  it("render fails with a structured error for a missing project", async () => {
    const cwd = await makeTmp();
    const result = await runTool("render", { projectDir: "no-such-dir" }, cwd);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Project directory not found|Chrome not found|Root composition not found/);
  });
});
