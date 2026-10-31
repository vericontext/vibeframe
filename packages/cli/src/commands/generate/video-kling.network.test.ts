/**
 * `vibe generate video -p kling` over the fake provider network: the real
 * KlingProvider, `providerRequest`, upload, polling, download, and file
 * write run; only `fetch` is replaced. Kling 4.0 and 3.0 Turbo go to the
 * new model-in-the-path API, the legacy models to `/v1/videos/*`, and every
 * real run reports the metered cost (billed seconds x the catalog price at
 * the billed resolution).
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findModel } from "@vibeframe/ai-providers";

import { FAKE_MP4, FAKE_PNG, KLING_HOST, createFakeProviderNetwork, type FakeProviderNetwork } from "../../testing/fake-provider-network.js";
import { buildMcpDispatcher } from "../../tools/adapters/mcp.js";
import { manifest } from "../../tools/manifest/index.js";
import { roundUsd } from "../_shared/actual-cost.js";
import { registerVideoCommand } from "./video.js";

let dir: string;
let net: FakeProviderNetwork;
const savedEnv = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vibe-kling-"));
  for (const key of ["FAL_API_KEY", "XAI_API_KEY", "RUNWAY_API_SECRET", "GOOGLE_API_KEY"]) delete process.env[key];
  Object.assign(process.env, { KLING_API_KEY: "test-kling", IMGBB_API_KEY: "test-imgbb", VIBE_UPLOAD_PROVIDER: "imgbb" });
  net = createFakeProviderNetwork();
  net.install();
});

afterEach(() => {
  net.uninstall();
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

/** The per-second list price of a Kling model at a resolution. */
function perSecond(model: string, resolution: string): number {
  const usd = findModel("kling", "video", model)?.price?.bySize?.[resolution];
  if (usd === undefined) throw new Error(`no catalog price for ${model} at ${resolution}`);
  return usd;
}

/** Run `generate video <args> --json` in process and return the exit code and JSON envelopes. */
async function runVideo(args: string[]) {
  process.env.VIBE_JSON_OUTPUT = "1";
  let exitCode: number | undefined;
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exitCode ??= code;
    throw new Error("process.exit");
  }) as never);
  const stdout: string[] = [];
  const stderr: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => void stdout.push(parts.map(String).join(" ")));
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => void stderr.push(parts.map(String).join(" ")));
  const command = new Command("generate");
  registerVideoCommand(command);
  await command.parseAsync(["video", ...args], { from: "user" }).catch((error: unknown) => {
    if (!(error instanceof Error && error.message === "process.exit")) throw error;
  });
  const json = (lines: string[]) => {
    const line = lines.find((l) => l.trimStart().startsWith("{"));
    return line ? (JSON.parse(line) as Record<string, unknown>) : {};
  };
  return { exitCode, result: json(stdout), error: json(stderr) };
}

const posts = () => net.to(KLING_HOST).filter((r) => r.method === "POST");

describe("vibe generate video -p kling --kling-model 4.0", () => {
  it("writes the video through the new API and reports the metered cost", async () => {
    const output = join(dir, "boat.mp4");
    const { exitCode, result } = await runVideo([
      "A paper boat drifts", "-p", "kling", "--kling-model", "4.0", "-d", "12", "-r", "9:16", "-o", output,
    ]);

    expect(exitCode).toBeUndefined();
    expect(readFileSync(output)).toEqual(FAKE_MP4);
    const [submit] = posts();
    expect(submit.path).toBe("/text-to-video/kling-4.0");
    expect(submit.headers.authorization).toBe("Bearer test-kling");
    expect(submit.body).toEqual({ prompt: "A paper boat drifts", settings: { resolution: "720p", aspect_ratio: "9:16", duration: 12 } });
    expect(submit.body).not.toHaveProperty("model_name");
    expect(net.to(KLING_HOST).some((r) => r.method === "GET" && r.path === "/tasks")).toBe(true);
    expect(result).toMatchObject({ data: { provider: "kling", outputPath: output } });
    expect(result.costUsd).toBe(roundUsd(12 * perSecond("kling-4.0", "720p")));
    expect(result).not.toHaveProperty("costEstimated");
  });

  it("uploads a local first frame and sends it as typed contents at the requested resolution", async () => {
    const frame = join(dir, "frame.png");
    writeFileSync(frame, FAKE_PNG);
    const output = join(dir, "i2v.mp4");
    const { exitCode, result } = await runVideo([
      "she turns", "-p", "kling", "--kling-model", "4.0", "-i", frame, "--resolution", "1080p", "-d", "3", "-o", output,
    ]);

    expect(exitCode).toBeUndefined();
    expect(existsSync(output)).toBe(true);
    expect(net.to("api.imgbb.com")).toHaveLength(1);
    const [submit] = posts();
    expect(submit.path).toBe("/image-to-video/kling-4.0");
    expect(submit.body).toEqual({
      contents: [
        { type: "prompt", text: "she turns" },
        { type: "first_frame", url: "https://fake.media/upload.png" },
      ],
      settings: { resolution: "1080p", duration: 3 },
    });
    expect(result.costUsd).toBe(roundUsd(3 * perSecond("kling-4.0", "1080p")));
  });

  it("prices the dry run from the catalog without a request", async () => {
    const { exitCode, result } = await runVideo(["x", "-p", "kling", "--kling-model", "4.0", "-d", "3", "--dry-run"]);

    expect(exitCode).toBeUndefined();
    expect(result).toMatchObject({ dryRun: true, data: { params: { model: "kling-4.0" } } });
    expect(result.costUsd).toBe(roundUsd(3 * perSecond("kling-4.0", "720p")));
    expect(net.requests).toHaveLength(0);
  });

  it.each([
    [["-d", "31"], /3-30 s/],
    [["--resolution", "4k"], /720p or 1080p/],
  ])("refuses %j as a usage error before any request, dry run included", async (flags, message) => {
    const { exitCode, error } = await runVideo(["x", "-p", "kling", "--kling-model", "4.0", ...flags, "--dry-run"]);

    expect(exitCode).toBe(2);
    expect(error).toMatchObject({ code: "USAGE_ERROR", error: expect.stringMatching(message) });
    expect(net.requests).toHaveLength(0);
  });

  it("refuses a negative prompt in the dry run, since the new API has none", async () => {
    const { exitCode, error } = await runVideo(["x", "-p", "kling", "--kling-model", "4.0", "--negative", "blur", "--dry-run"]);

    expect(exitCode).toBe(2);
    expect(error.error).toMatch(/negative prompt/);
  });

  it("fails with an auth error, before any request, when KLING_API_KEY is an access/secret pair", async () => {
    process.env.KLING_API_KEY = "access:secret";
    const { exitCode, error } = await runVideo(["x", "-p", "kling", "--kling-model", "4.0", "-o", join(dir, "o.mp4")]);

    expect(exitCode).toBe(4);
    expect(error).toMatchObject({ errorKind: "auth" });
    expect(String(error.error)).toMatch(/accepts only an API key/);
    expect(net.requests).toHaveLength(0);
  });

  it("runs Kling 3.0 Turbo on its own path", async () => {
    const { exitCode, result } = await runVideo(["x", "-p", "kling", "--kling-model", "3.0-turbo", "-d", "4", "-o", join(dir, "t.mp4")]);

    expect(exitCode).toBeUndefined();
    expect(posts()[0].path).toBe("/text-to-video/kling-3.0-turbo");
    expect(result.costUsd).toBe(roundUsd(4 * perSecond("kling-3.0-turbo", "720p")));
  });
});

describe("vibe generate video -p kling with legacy models", () => {
  it.each([
    [[], "kling-v3", "5"],
    [["--kling-model", "v2.6", "-d", "10"], "kling-v2-6", "10"],
  ])("%j still goes to /v1/videos/text2video as model_name %s", async (flags, modelName, duration) => {
    const { exitCode, result } = await runVideo(["x", "-p", "kling", ...flags, "-o", join(dir, `${modelName}.mp4`)]);

    expect(exitCode).toBeUndefined();
    const [submit] = posts();
    expect(submit.path).toBe("/v1/videos/text2video");
    expect(submit.body).toMatchObject({ model_name: modelName, mode: "std", duration });
    expect(result.costUsd).toBe(roundUsd(Number(duration) * perSecond(modelName, "720p")));
    expect(result).not.toHaveProperty("costEstimated");
  });

  it("refuses a length v2.6 cannot render instead of silently rounding it", async () => {
    const { exitCode, error } = await runVideo(["x", "-p", "kling", "--kling-model", "v2.6", "-d", "8", "--dry-run"]);
    expect(exitCode).toBe(2);
    expect(error.error).toMatch(/5 or 10 s/);
  });
});

describe("MCP generate_video", () => {
  it("runs Kling 4.0 and carries the metered data.costUsd", async () => {
    const dispatch = buildMcpDispatcher(manifest);
    const reply = await dispatch("generate_video", {
      prompt: "x",
      provider: "kling",
      klingModel: "4.0",
      duration: 6,
      mode: "pro",
      output: join(dir, "mcp.mp4"),
    });
    const data = JSON.parse(reply.content[0].text) as Record<string, unknown>;

    expect(data).toMatchObject({ success: true, provider: "kling" });
    expect(posts()[0].path).toBe("/text-to-video/kling-4.0");
    expect(data.costUsd).toBe(roundUsd(6 * perSecond("kling-4.0", "1080p")));
    expect(data).not.toHaveProperty("costEstimated");
  });
});
