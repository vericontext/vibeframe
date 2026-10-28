/**
 * The Gemini-backed commands against a fake Gemini endpoint that rejects the
 * key the way Google does: HTTP 400 INVALID_ARGUMENT with reason
 * API_KEY_INVALID. Before, Gemini analysis returned the HTTP error as a
 * string, so `remix highlights --use-gemini` exited 5 API_ERROR with "Retry
 * the command.", the MCP tools returned plain text, and pipeline steps had no
 * error kind. Now the real GeminiProvider and `providerRequest` run end to
 * end, and every surface reports the same structured auth failure.
 */

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeProviderNetwork, jsonResponse, type FakeProviderNetwork } from "../testing/fake-provider-network.js";
import { manifest } from "../tools/manifest/index.js";
import { buildMcpDispatcher } from "../tools/adapters/mcp.js";
import { executePipeline } from "../pipeline/executor.js";
import { inspectCommand } from "./inspect.js";
import { remixCommand } from "./remix.js";

const GEMINI = "generativelanguage.googleapis.com";
const BAD_KEY = {
  error: {
    code: 400,
    message: "API key not valid. Please pass a valid API key.",
    status: "INVALID_ARGUMENT",
    details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID" }],
  },
};
const AUTH_FAILURE = { success: false, code: "AUTH_ERROR", exitCode: 4, errorKind: "auth", retryable: false };

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

let dir: string;
let video: string;
let net: FakeProviderNetwork;
const savedEnv = { ...process.env };

const written = () => readdirSync(dir).filter((name) => name !== "clip.mp4");

beforeAll(() => {
  if (!hasFfmpeg) return;
  dir = mkdtempSync(join(tmpdir(), "vibe-gemini-auth-"));
  video = join(dir, "clip.mp4");
  const run = spawnSync("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=2",
    "-f", "lavfi", "-i", "sine=duration=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-shortest", video,
  ]);
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr}`);
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  process.env.GOOGLE_API_KEY = "AIza-fake";
  net = createFakeProviderNetwork().on("POST", GEMINI, /:generateContent$/, () => jsonResponse(BAD_KEY, 400));
  net.install();
});

afterEach(() => {
  net.uninstall();
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

/**
 * Run `vibe <group> <args> --json` in process. `process.exit` is stubbed to
 * throw, so the exit code, stdout, and the JSON error envelope on stderr are
 * read back instead of ending the worker.
 */
async function run(command: Command, args: string[]) {
  process.env.VIBE_JSON_OUTPUT = "1";
  let exitCode: number | undefined;
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exitCode ??= code;
    throw new Error("process.exit");
  }) as never);
  const stderr: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    stderr.push(parts.map(String).join(" "));
  });
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  await command.parseAsync(args, { from: "user" }).catch((error: unknown) => {
    if (!(error instanceof Error && error.message === "process.exit")) throw error;
  });
  const envelope = stderr.find((line) => line.trimStart().startsWith("{"));
  return { exitCode, error: envelope ? (JSON.parse(envelope) as Record<string, unknown>) : {} };
}

describe.skipIf(!hasFfmpeg)("Gemini commands with a rejected Google key", () => {
  it("the request carries the key in a header, never the URL", async () => {
    await run(inspectCommand, ["media", video, "describe"]);

    const [request] = net.to(GEMINI);
    expect(request.url).not.toContain("AIza-fake");
    expect(request.headers["x-goog-api-key"]).toBe("AIza-fake");
  });

  for (const [label, command, args] of [
    ["remix highlights --use-gemini", remixCommand, ["highlights", "VIDEO", "--use-gemini"]],
    ["remix auto-shorts --use-gemini", remixCommand, ["auto-shorts", "VIDEO", "--use-gemini"]],
    ["inspect media", inspectCommand, ["media", "VIDEO", "describe"]],
  ] as const) {
    it(`vibe ${label} exits 4 with AUTH_ERROR and a setup hint`, async () => {
      const { exitCode, error } = await run(command, args.map((arg) => (arg === "VIDEO" ? video : arg)));

      expect(exitCode).toBe(4);
      expect(error).toMatchObject(AUTH_FAILURE);
      expect(String(error.error)).toContain("API key not valid");
      expect(String(error.suggestion)).toContain("vibe setup");
      expect(written()).toEqual([]);
    });
  }

  it("the MCP tools return the structured auth envelope", async () => {
    const dispatch = buildMcpDispatcher(manifest);
    for (const [name, args] of [
      ["remix_highlights", { media: video, useGemini: true }],
      ["remix_auto_shorts", { video, useGemini: true }],
      ["inspect_media", { source: video, prompt: "describe" }],
    ] as const) {
      const reply = await dispatch(name, args);
      const envelope = JSON.parse(reply.content[0].text) as Record<string, unknown>;
      expect(envelope, name).toMatchObject(AUTH_FAILURE);
    }
    expect(written()).toEqual([]);
  });

  it("a pipeline step reports the error code and kind", async () => {
    const result = await executePipeline(
      { name: "gemini-auth", steps: [{ id: "look", action: "analyze-media", input: video, prompt: "describe" }] },
      { outputDir: join(dir, "out") },
    );

    expect(result.success).toBe(false);
    expect(result.steps[0]).toMatchObject({ success: false, errorCode: "AUTH_ERROR", errorKind: "auth" });
  });
});
