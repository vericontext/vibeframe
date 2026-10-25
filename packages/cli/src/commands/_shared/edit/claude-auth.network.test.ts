/**
 * The Claude-backed edits against a fake Anthropic endpoint that rejects the
 * key. Before, every Claude helper swallowed the 401 into a default grade or
 * a center crop, so `edit grade --style` and `edit reframe --focus auto`
 * wrote a file and reported success. Now the real ClaudeProvider and
 * `providerRequest` run end to end, and every surface (the CLI command, the
 * executor, the MCP tool) reports a structured auth failure and writes
 * nothing.
 */

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeProviderNetwork, jsonResponse, type FakeProviderNetwork } from "../../../testing/fake-provider-network.js";
import { editCommand } from "../../edit-cmd.js";
import { manifest } from "../../../tools/manifest/index.js";
import { executeGrade } from "./grade.js";
import { executeReframe } from "./reframe.js";

const ANTHROPIC = "api.anthropic.com";
const AUTH_401 = { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } };

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

let dir: string;
let video: string;
let net: FakeProviderNetwork;
const savedEnv = { ...process.env };

/** Files in the clip's directory other than the clip itself. */
const written = () => readdirSync(dir).filter((name) => name !== "clip.mp4");

beforeAll(() => {
  if (!hasFfmpeg) return;
  dir = mkdtempSync(join(tmpdir(), "vibe-claude-auth-"));
  video = join(dir, "clip.mp4");
  const run = spawnSync("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", video,
  ]);
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr}`);
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-fake";
  net = createFakeProviderNetwork().on("POST", ANTHROPIC, /^\/v1\/messages$/, () => jsonResponse(AUTH_401, 401));
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
async function runEdit(args: string[]): Promise<{ exitCode: number | undefined; error: Record<string, unknown> }> {
  process.env.VIBE_JSON_OUTPUT = "1";
  let exitCode: number | undefined;
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    // The first exit is the real one; the action's catch-all sees the throw below.
    exitCode ??= code;
    throw new Error("process.exit");
  }) as never);
  const stderr: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    stderr.push(parts.map(String).join(" "));
  });
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  await editCommand.parseAsync(args, { from: "user" }).catch((error: unknown) => {
    if (!(error instanceof Error && error.message === "process.exit")) throw error;
  });
  const envelope = stderr.find((line) => line.trimStart().startsWith("{"));
  return { exitCode, error: envelope ? JSON.parse(envelope) : {} };
}

const AUTH_FAILURE = { success: false, code: "AUTH_ERROR", exitCode: 4, errorKind: "auth", retryable: false };

describe.skipIf(!hasFfmpeg)("Claude edits with a rejected Anthropic key", () => {
  it("vibe edit grade --style exits 4 with AUTH_ERROR and writes no file", async () => {
    const { exitCode, error } = await runEdit(["grade", video, "--style", "moody teal"]);

    expect(exitCode).toBe(4);
    expect(error).toMatchObject(AUTH_FAILURE);
    expect(String(error.error)).toContain("invalid x-api-key");
    expect(written()).toEqual([]);
    expect(net.to(ANTHROPIC)).toHaveLength(1);
  });

  it("vibe edit reframe --focus auto exits 4 with AUTH_ERROR after one call and writes no file", async () => {
    const { exitCode, error } = await runEdit(["reframe", video, "--focus", "auto"]);

    expect(exitCode).toBe(4);
    expect(error).toMatchObject(AUTH_FAILURE);
    expect(written()).toEqual([]);
    // A rejected key fails every frame the same way, so it stops at the first.
    expect(net.to(ANTHROPIC)).toHaveLength(1);
  });

  it("the executors carry the auth failure for the pipeline", async () => {
    const grade = await executeGrade({ videoPath: video, style: "moody teal", apiKey: "sk-ant-fake" });
    expect(grade).toMatchObject({ success: false, failure: AUTH_FAILURE });

    const reframe = await executeReframe({ videoPath: video, focus: "auto", apiKey: "sk-ant-fake", frameDelayMs: 0 });
    expect(reframe).toMatchObject({ success: false, failure: AUTH_FAILURE });
    expect(written()).toEqual([]);
  });

  it("the MCP tools report failure, not success", async () => {
    for (const [name, args] of [
      ["edit_grade", { videoPath: video, style: "moody teal" }],
      ["edit_reframe", { videoPath: video, focus: "auto" }],
    ] as const) {
      const tool = manifest.find((entry) => entry.name === name)!;
      const result = await tool.execute(tool.schema.parse(args), { workingDirectory: dir, surface: "mcp" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("invalid x-api-key");
    }
    expect(written()).toEqual([]);
  });

  it("free paths still work with no Claude call", async () => {
    const output = join(dir, "warm.mp4");
    await expect(executeGrade({ videoPath: video, preset: "cinematic-warm", output })).resolves.toMatchObject({ success: true });
    expect(existsSync(output)).toBe(true);
    rmSync(output);

    const centered = join(dir, "center.mp4");
    await expect(executeReframe({ videoPath: video, focus: "center", output: centered })).resolves.toMatchObject({ success: true });
    expect(existsSync(centered)).toBe(true);
    rmSync(centered);

    expect(net.to(ANTHROPIC)).toHaveLength(0);
  });
});
