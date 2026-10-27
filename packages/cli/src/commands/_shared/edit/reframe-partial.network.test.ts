/**
 * `edit reframe --focus auto` against a fake Anthropic endpoint that answers
 * the first frame and returns a 500 for the second. Before, the failed frame
 * was skipped and the crop averaged over the frames that happened to
 * succeed, so every surface reported success on a crop Claude never fully
 * produced. Now the real ClaudeProvider and `providerRequest` run end to
 * end, and the CLI command, the executor, the MCP tool, and the pipeline
 * step all fail with the provider's structured error, stop calling Claude,
 * and write nothing.
 */

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeProviderNetwork, jsonResponse, type FakeProviderNetwork } from "../../../testing/fake-provider-network.js";
import { editCommand } from "../../edit-cmd.js";
import { manifest } from "../../../tools/manifest/index.js";
import { executePipeline } from "../../../pipeline/executor.js";
import { executeReframe } from "./reframe.js";

const ANTHROPIC = "api.anthropic.com";
const CROP_REPLY = {
  type: "message",
  role: "assistant",
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify({ cropX: 40, cropY: 0, confidence: 0.9, subjectDescription: "test pattern" }) }],
};
const SERVER_500 = { type: "error", error: { type: "api_error", message: "Internal server error" } };

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

let dir: string;
/** 320x240, 6 s: three sampled frames at the 2 s minimum interval. */
let video: string;
let net: FakeProviderNetwork;
const savedEnv = { ...process.env };

/** Files in the clip's directory other than the clip itself. */
const written = () => readdirSync(dir).filter((name) => name !== "clip.mp4");

beforeAll(() => {
  if (!hasFfmpeg) return;
  dir = mkdtempSync(join(tmpdir(), "vibe-reframe-partial-"));
  video = join(dir, "clip.mp4");
  const run = spawnSync("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=6",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", video,
  ]);
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr}`);
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-fake";
  let calls = 0;
  net = createFakeProviderNetwork().on("POST", ANTHROPIC, /^\/v1\/messages$/, () => {
    calls += 1;
    return calls === 2 ? jsonResponse(SERVER_500, 500) : jsonResponse(CROP_REPLY);
  });
  net.install();
});

afterEach(() => {
  net.uninstall();
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

/**
 * Run `vibe edit <args> --json` in process. `process.exit` is stubbed to
 * throw, so the exit code and the JSON error envelope on stderr are read
 * back instead of ending the worker.
 */
async function runEdit(args: string[]): Promise<{ exitCode: number | undefined; error: Record<string, unknown>; stdout: string[] }> {
  process.env.VIBE_JSON_OUTPUT = "1";
  let exitCode: number | undefined;
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exitCode ??= code;
    throw new Error("process.exit");
  }) as never);
  const stderr: string[] = [];
  const stdout: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    stderr.push(parts.map(String).join(" "));
  });
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    stdout.push(parts.map(String).join(" "));
  });
  await editCommand.parseAsync(args, { from: "user" }).catch((error: unknown) => {
    if (!(error instanceof Error && error.message === "process.exit")) throw error;
  });
  const envelope = stderr.find((line) => line.trimStart().startsWith("{"));
  return { exitCode, error: envelope ? JSON.parse(envelope) : {}, stdout };
}

const PROVIDER_FAILURE = { success: false, code: "API_ERROR", exitCode: 5, errorKind: "provider", retryable: true };

describe.skipIf(!hasFfmpeg)("edit reframe when one of three frame analyses fails", () => {
  it("vibe edit reframe --focus auto exits 5 with the provider error, stops at that frame, and writes no file", async () => {
    const { exitCode, error, stdout } = await runEdit(["reframe", video, "--focus", "auto"]);

    expect(exitCode).toBe(5);
    expect(error).toMatchObject(PROVIDER_FAILURE);
    expect(String(error.error)).toContain("frame 2/3");
    expect(String(error.error)).toContain("Internal server error");
    expect(stdout.join("\n")).not.toContain('"success": true');
    expect(written()).toEqual([]);
    // No paid call is spent on a run that is already failing.
    expect(net.to(ANTHROPIC)).toHaveLength(2);
  });

  it("the executor returns the structured failure", async () => {
    const result = await executeReframe({ videoPath: video, focus: "auto", apiKey: "sk-ant-fake", frameDelayMs: 0 });
    expect(result).toMatchObject({ success: false, failure: PROVIDER_FAILURE });
    expect(written()).toEqual([]);
  });

  it("the MCP tool reports failure, not success", async () => {
    const tool = manifest.find((entry) => entry.name === "edit_reframe")!;
    const result = await tool.execute(tool.schema.parse({ videoPath: video, focus: "auto" }), { workingDirectory: dir, surface: "mcp" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("frame 2/3");
    expect(written()).toEqual([]);
  });

  it("the pipeline step fails", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "vibe-reframe-partial-run-"));
    try {
      const run = await executePipeline(
        { name: "reframe", steps: [{ id: "r", action: "edit-reframe", input: video, focus: "auto" }] },
        { outputDir },
      );
      expect(run.success).toBe(false);
      expect(run.steps[0]).toMatchObject({ success: false });
      expect(run.steps[0].error).toContain("frame 2/3");
      expect(readdirSync(outputDir).filter((name) => name.endsWith(".mp4"))).toEqual([]);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
