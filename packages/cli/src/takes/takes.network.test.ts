/**
 * Every paid generation leaves a take, over the real provider and file-write
 * path (only `fetch` is faked). Inside a project the take lives in the
 * project with project-relative paths; elsewhere in the global store; both
 * append to the global ledger. The cost carries its basis: what the provider
 * reported, what we metered, or an estimate. A call that never reached the
 * provider leaves nothing.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FAKE_GROK_TICKS, FAKE_MP4, createFakeProviderNetwork, type FakeProviderNetwork } from "../testing/fake-provider-network.js";
import { executeImageGenerate } from "../commands/ai-image.js";
import { executeVideoGenerate } from "../commands/ai-video.js";
import { registerVideoCommand } from "../commands/generate/video.js";
import { takeCommand } from "../commands/take.js";
import { buildMcpDispatcher } from "../tools/adapters/mcp.js";
import { manifest } from "../tools/manifest/index.js";
import { executeTakeList, executeTakeLog, executeTakeShow } from "./query.js";
import { globalTakeStore, ledgerPath, readLedger, type Take } from "./take.js";

let root: string;
let project: string;
let loose: string;
let net: FakeProviderNetwork;
const savedEnv = { ...process.env };
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vibe-takes-"));
  project = join(root, "film");
  loose = join(root, "loose");
  mkdirSync(project, { recursive: true });
  mkdirSync(loose, { recursive: true });
  writeFileSync(join(project, "STORYBOARD.md"), "# Film\n");
  for (const key of ["FAL_API_KEY", "KLING_API_KEY", "GOOGLE_API_KEY", "RUNWAY_API_SECRET"]) delete process.env[key];
  Object.assign(process.env, { XAI_API_KEY: "test-xai", OPENAI_API_KEY: "test-openai" });
  delete process.env.VIBE_TAKES;
  net = createFakeProviderNetwork();
  net.install();
});

afterEach(() => {
  net.uninstall();
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

function readTakeFile(dir: string, id: string): Take {
  return JSON.parse(readFileSync(join(dir, ".vibeframe", "takes", `${id}.json`), "utf-8")) as Take;
}

describe("a generation inside a project", () => {
  it("records a take in the project with relative paths, hashes, session, and the reported cost", async () => {
    const result = await executeVideoGenerate({
      prompt: "A paper boat drifts",
      provider: "grok",
      duration: 5,
      output: join(project, "renders", "boat.mp4"),
      take: { via: "cli", command: "generate video", cwd: project },
    });
    expect(result.success).toBe(true);
    expect(result.takeId).toMatch(/^take_[0-9a-z]+_[0-9a-f]{8}$/);

    const take = readTakeFile(project, result.takeId!);
    expect(take).toMatchObject({
      kind: "video",
      operation: "generate",
      status: "completed",
      provider: "grok",
      prompt: "A paper boat drifts",
      params: { duration: 5 },
      origin: { via: "cli", command: "generate video", cwd: "." },
      session: { provider: "grok", id: result.taskId },
      cost: { basis: "reported" },
    });
    expect(take.cost.usd).toBeCloseTo(FAKE_GROK_TICKS * 1e-10, 6);
    expect(take.outputs).toEqual([{ path: join("renders", "boat.mp4"), sha256: sha256(FAKE_MP4), bytes: FAKE_MP4.length }]);

    const line = (await readLedger()).find((e) => e.takeId === take.id);
    expect(line).toMatchObject({ projectDir: project, provider: "grok", basis: "reported", status: "completed" });
  });

  it("hashes local inputs and keeps a URL input as given", async () => {
    const frame = join(project, "frame.png");
    writeFileSync(frame, Buffer.from("frame-bytes"));
    process.env.IMGBB_API_KEY = "test-imgbb";
    process.env.VIBE_UPLOAD_PROVIDER = "imgbb";
    const result = await executeVideoGenerate({
      prompt: "she turns",
      provider: "grok",
      image: frame,
      refImages: ["https://example.com/ref.png"],
      output: join(project, "i2v.mp4"),
      take: { via: "cli", command: "generate video", cwd: project },
    });
    const take = readTakeFile(project, result.takeId!);
    expect(take.inputs).toEqual([
      { role: "image", path: "frame.png", sha256: sha256(Buffer.from("frame-bytes")), bytes: 11 },
      { role: "reference-image", path: "https://example.com/ref.png" },
    ]);
  });
});

describe("a generation outside any project", () => {
  it("goes to the global store with absolute paths", async () => {
    const output = join(loose, "card.png");
    const result = await executeImageGenerate({
      prompt: "a title card",
      provider: "openai",
      output,
      take: { via: "mcp", command: "generate_image", cwd: loose },
    });
    expect(result.success).toBe(true);
    const path = join(globalTakeStore().dir, `${result.takeId}.json`);
    expect(existsSync(path)).toBe(true);
    const take = JSON.parse(readFileSync(path, "utf-8")) as Take;
    expect(take).toMatchObject({ kind: "image", provider: "openai", origin: { via: "mcp", cwd: loose }, cost: { basis: "estimate" } });
    expect(take.outputs[0].path).toBe(output);
    expect(take.cost.usd).toBeGreaterThan(0);
  });
});

describe("no take is recorded", () => {
  it("when the provider was never reached", async () => {
    delete process.env.XAI_API_KEY;
    await expect(
      executeVideoGenerate({ prompt: "x", provider: "grok", apiKey: undefined, output: join(project, "x.mp4"), take: { via: "cli", command: "generate video", cwd: project } }),
    ).rejects.toThrow();
    expect(existsSync(join(project, ".vibeframe", "takes"))).toBe(false);
  });

  it("when VIBE_TAKES=off", async () => {
    process.env.VIBE_TAKES = "off";
    const result = await executeVideoGenerate({ prompt: "x", provider: "grok", output: join(project, "x.mp4"), take: { via: "cli", command: "generate video", cwd: project } });
    expect(result.success).toBe(true);
    expect(result.takeId).toBeUndefined();
    expect(existsSync(join(project, ".vibeframe", "takes"))).toBe(false);
  });
});

describe("reading takes", () => {
  async function twoTakes() {
    const video = await executeVideoGenerate({ prompt: "boat", provider: "grok", duration: 5, output: join(project, "a.mp4"), take: { via: "cli", command: "generate video", cwd: project } });
    const image = await executeImageGenerate({ prompt: "card", provider: "openai", output: join(project, "b.png"), take: { via: "cli", command: "generate image", cwd: project } });
    return { video: video.takeId!, image: image.takeId! };
  }

  it("lists newest first, filters by kind, and totals spend by basis", async () => {
    const ids = await twoTakes();
    const list = await executeTakeList({ cwd: project });
    expect(list.mode).toBe("project");
    expect(list.takes.map((t) => t.id)).toEqual([ids.image, ids.video]);
    expect((await executeTakeList({ cwd: project }, { kind: "video" })).takes.map((t) => t.id)).toEqual([ids.video]);

    const log = await executeTakeLog({ cwd: project });
    const video = readTakeFile(project, ids.video).cost.usd;
    const image = readTakeFile(project, ids.image).cost.usd;
    expect(log.takes).toBe(2);
    expect(log.totalUsd).toBeCloseTo(video + image, 6);
    expect(log.byBasis.reported).toBeCloseTo(video, 6);
    expect(log.byBasis.estimate).toBeCloseTo(image, 6);
    expect(log.byKind.map((g) => g.key).sort()).toEqual(["image", "video"]);
  });

  it("finds a take from another directory through the ledger", async () => {
    const ids = await twoTakes();
    const found = await executeTakeShow(ids.video, { cwd: loose });
    expect(found?.take.id).toBe(ids.video);
    const global = await executeTakeList({ cwd: loose, global: true }, { limit: 1000 });
    expect(global.mode).toBe("ledger");
    expect(global.takes.map((t) => t.id)).toEqual(expect.arrayContaining([ids.video, ids.image]));
  });

  it("rejects a bad --since as a usage error", async () => {
    await expect(executeTakeLog({ cwd: project }, { since: "last tuesday" })).rejects.toThrow(/Invalid --since/);
  });
});

describe("surfaces", () => {
  async function runCli(command: Command, args: string[]) {
    process.env.VIBE_JSON_OUTPUT = "1";
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as never);
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => void stdout.push(parts.map(String).join(" ")));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process, "cwd").mockReturnValue(project);
    await command.parseAsync(args, { from: "user" }).catch((error: unknown) => {
      if (!(error instanceof Error && error.message === "process.exit")) throw error;
    });
    const line = stdout.find((l) => l.trimStart().startsWith("{"));
    return line ? (JSON.parse(line) as Record<string, unknown>) : {};
  }

  it("generate video --json returns the takeId, and take show reads it", async () => {
    const generate = new Command("generate");
    registerVideoCommand(generate);
    const envelope = await runCli(generate, ["video", "boat", "-p", "grok", "-o", join(project, "c.mp4")]);
    const takeId = (envelope.data as { takeId?: string }).takeId;
    expect(takeId).toBeDefined();
    expect(readTakeFile(project, takeId!).origin).toMatchObject({ via: "cli", command: "generate video" });

    vi.restoreAllMocks();
    const shown = await runCli(takeCommand, ["show", takeId!]);
    expect(shown).toMatchObject({ command: "take show", data: { take: { id: takeId } } });
  });

  it("MCP generate_video records via mcp and take_log totals it", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(project);
    const dispatch = buildMcpDispatcher(manifest);
    const generated = await dispatch("generate_video", { prompt: "boat", provider: "grok", output: "d.mp4" });
    const data = JSON.parse(generated.content[0].text) as { takeId?: string };
    expect(data.takeId).toBeDefined();
    expect(readTakeFile(project, data.takeId!).origin).toMatchObject({ via: "mcp", command: "generate_video" });

    const log = await dispatch("take_log", {});
    expect(JSON.parse(log.content[0].text)).toMatchObject({ mode: "project", takes: 1 });
  });

  it("the ledger file is one JSON object per line", async () => {
    await executeVideoGenerate({ prompt: "boat", provider: "grok", output: join(project, "e.mp4"), take: { via: "cli", command: "generate video", cwd: project } });
    const lines = readFileSync(ledgerPath(), "utf-8").trim().split("\n");
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });
});
