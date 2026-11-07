/**
 * `vibe take extend` and `vibe take edit` continue a video take through its
 * provider session, over the real provider and file-write path (only
 * `fetch` is faked).
 *
 * The contract: the continuation starts from the take's own provider job;
 * the result is a new take whose parent is the one continued, made for the
 * same beat slot, stored beside its parent; and every refusal (a provider
 * that cannot continue the job, an edit with no prompt, an estimate over
 * --max-cost) happens before any provider request.
 */

import { readFileSync, rmSync, mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FAKE_MP4, FAKE_GROK_TICKS, createFakeProviderNetwork, jsonResponse, type FakeProviderNetwork } from "../testing/fake-provider-network.js";
import { executeImageGenerate } from "../commands/ai-image.js";
import { executeVideoGenerate } from "../commands/ai-video.js";
import { takeCommand } from "../commands/take.js";
import { buildMcpDispatcher } from "../tools/adapters/mcp.js";
import { manifest } from "../tools/manifest/index.js";
import { executeTakeContinue, type TakeContinueOptions } from "./continue.js";
import { executeTakePromote } from "./promote.js";
import { readAssetMetadata } from "../commands/_shared/build-asset-metadata.js";
import type { Take } from "./take.js";

const OMNI = "generativelanguage.googleapis.com";

let root: string;
let project: string;
let net: FakeProviderNetwork;
const savedEnv = { ...process.env };

/** Each provider job's video is FAKE_MP4 followed by its id, so outputs are told apart. */
const videoBytes = (id: string) => Buffer.concat([FAKE_MP4, Buffer.from(id)]);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vibe-take-continue-"));
  project = join(root, "film");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "STORYBOARD.md"), "# Film\n");
  for (const key of ["FAL_API_KEY", "KLING_API_KEY", "RUNWAY_API_SECRET"]) delete process.env[key];
  Object.assign(process.env, { XAI_API_KEY: "test-xai", GOOGLE_API_KEY: "test-google", OPENAI_API_KEY: "test-openai" });
  delete process.env.VIBE_TAKES;
  net = createFakeProviderNetwork();
  net.on("GET", "api.x.ai", /^\/v1\/videos\/[^/]+$/, (req) => {
    const id = req.path.split("/").at(-1)!;
    return jsonResponse({
      status: "done",
      model: "grok-imagine-video",
      video: { url: `https://fake.media/${id}.mp4`, duration: 5 },
      usage: { cost_in_usd_ticks: FAKE_GROK_TICKS },
    });
  });
  net.on("GET", "fake.media", /^\/[^/]+\.mp4$/, (req) => new Response(new Uint8Array(videoBytes(req.path.slice(1, -4)))));
  net.install();
});

afterEach(() => {
  net.uninstall();
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

function readTake(id: string): Take {
  return JSON.parse(readFileSync(join(project, ".vibeframe", "takes", `${id}.json`), "utf-8")) as Take;
}

async function grokTake(extra: { beatId?: string; asset?: "video" } = {}): Promise<string> {
  const result = await executeVideoGenerate({
    prompt: "A paper boat drifts",
    provider: "grok",
    duration: 5,
    output: join(project, "renders", "boat.mp4"),
    take: { via: "cli", command: "generate video", cwd: project, ...extra },
  });
  expect(result.takeId).toBeDefined();
  return result.takeId!;
}

function options(takeId: string, rest: Partial<TakeContinueOptions> = {}): TakeContinueOptions {
  return { takeId, continuation: "extend", cwd: project, via: "cli", command: "take extend", ...rest };
}

const posts = () => net.requests.filter((r) => r.method === "POST");

describe("take extend", () => {
  it("extends the take's own Grok job and records a child take beside it", async () => {
    const parentId = await grokTake();
    const parent = readTake(parentId);

    const result = await executeTakeContinue(options(parentId, { prompt: "it reaches the shore", duration: 6 }));
    if (!result.success) throw new Error(result.error);

    const extension = posts().at(-1)!;
    expect(extension.path).toBe("/v1/videos/extensions");
    expect(extension.body).toMatchObject({
      model: "grok-imagine-video",
      prompt: "it reaches the shore",
      duration: 6,
      video: { url: `https://fake.media/${parent.session!.id}.mp4` },
    });

    expect(result.outputPath).toBe(join(project, "renders", "boat-extended.mp4"));
    expect(readFileSync(result.outputPath!)).toEqual(videoBytes(result.taskId!));
    const child = readTake(result.takeId!);
    expect(child).toMatchObject({
      parent: parentId,
      kind: "video",
      operation: "extend",
      status: "completed",
      provider: "grok",
      prompt: "it reaches the shore",
      outputs: [{ path: "renders/boat-extended.mp4" }],
      session: { provider: "grok", id: result.taskId },
      cost: { basis: "reported" },
      origin: { via: "cli", command: "take extend" },
    });

    // A second extension of the same take does not overwrite the first.
    const again = await executeTakeContinue(options(parentId));
    if (!again.success) throw new Error(again.error);
    expect(again.outputPath).toBe(join(project, "renders", "boat-extended-2.mp4"));
    expect(readTake(again.takeId!).parent).toBe(parentId);
  });

  it("dry run reports provider, output, and the estimate without a request", async () => {
    const parentId = await grokTake();
    const before = net.requests.length;
    const plan = await executeTakeContinue(options(parentId, { dryRun: true }));
    expect(plan).toMatchObject({
      success: true,
      dryRun: true,
      continuation: "extend",
      parentTakeId: parentId,
      provider: "grok",
      output: join(project, "renders", "boat-extended.mp4"),
      estimate: { usd: 5, basis: "upper-bound" },
    });
    expect(net.requests).toHaveLength(before);
    expect(existsSync(join(project, "renders", "boat-extended.mp4"))).toBe(false);
  });

  it("a take a build made for a beat slot gives its child that slot, so promote takes it", async () => {
    writeFileSync(
      join(project, "STORYBOARD.md"),
      "---\nproject: t\n---\n\n## Beat pond - Pond\n\n```yaml\nduration: 4\nvideo: A paper boat drifts\n```\n",
    );
    const parentId = await grokTake({ beatId: "pond", asset: "video" });
    const result = await executeTakeContinue(options(parentId));
    if (!result.success) throw new Error(result.error);
    expect(readTake(result.takeId!).origin).toMatchObject({ beatId: "pond", asset: "video" });

    const promoted = await executeTakePromote({ takeId: result.takeId!, cwd: project });
    if (!promoted.success) throw new Error(promoted.error);
    expect(readFileSync(join(project, "assets", "video-pond.mp4"))).toEqual(videoBytes(result.taskId!));
    expect(readAssetMetadata(project, "video", "pond")?.takeId).toBe(result.takeId);
  });
});

describe("take edit", () => {
  it("revises an Omni take as a follow-up turn of its interaction", async () => {
    let interactions = 0;
    net
      .on("POST", OMNI, /^\/v1beta\/interactions$/, () => jsonResponse({ id: `int-${++interactions}`, status: "in_progress" }))
      .on("GET", OMNI, /^\/v1beta\/interactions\/[^/]+$/, (req) => {
        const id = req.path.split("/").at(-1)!;
        return jsonResponse({
          id,
          status: "completed",
          steps: [{ type: "model_output", content: [{ type: "video", mime_type: "video/mp4", uri: `https://${OMNI}/v1beta/files/${id}:download?alt=media` }] }],
        });
      })
      .on("GET", OMNI, /^\/v1beta\/files\/[^/]+$/, () => jsonResponse({ state: "ACTIVE" }))
      .on("GET", OMNI, /^\/download\/v1beta\/files\/[^/]+$/, (req) =>
        new Response(new Uint8Array(videoBytes(req.path.split("/").at(-1)!.replace(/:download$/, "")))),
      );
    const generated = await executeVideoGenerate({
      prompt: "A lantern on a pier",
      provider: "omni",
      output: join(project, "lantern.mp4"),
      take: { via: "cli", command: "generate video", cwd: project },
    });
    expect(generated.takeId).toBeDefined();

    const result = await executeTakeContinue(options(generated.takeId!, { continuation: "edit", prompt: "make it dusk", command: "take edit" }));
    if (!result.success) throw new Error(result.error);

    const turn = posts().filter((r) => r.host === OMNI).at(-1)!;
    expect(turn.body).toMatchObject({ previous_interaction_id: "int-1", input: "make it dusk" });
    expect(result.outputPath).toBe(join(project, "lantern-edited.mp4"));
    expect(readFileSync(result.outputPath!)).toEqual(videoBytes("int-2"));
    expect(readTake(result.takeId!)).toMatchObject({ parent: generated.takeId, operation: "edit", provider: "omni", status: "completed" });
  });
});

describe("refusals happen before any provider request", () => {
  it("for a provider that cannot continue the job, an image take, an edit without a prompt, and an unknown id", async () => {
    const grokId = await grokTake();
    const runwayLike = readTake(grokId);
    // A Runway job: Runway continues nothing.
    runwayLike.id = "take_runwayjob_00000000";
    runwayLike.provider = "runway";
    runwayLike.session = { ...runwayLike.session!, provider: "runway", model: "gen4.5" };
    writeFileSync(join(project, ".vibeframe", "takes", `${runwayLike.id}.json`), JSON.stringify(runwayLike));
    // A legacy Kling job: Kling extends it but cannot edit it.
    const klingLike = { ...runwayLike, id: "take_klingjob_00000000", provider: "kling", session: { ...runwayLike.session!, provider: "kling", model: "kling-v3" } };
    writeFileSync(join(project, ".vibeframe", "takes", `${klingLike.id}.json`), JSON.stringify(klingLike));
    const image = await executeImageGenerate({ prompt: "a pier", provider: "openai", output: join(project, "pier.png"), take: { via: "cli", command: "generate image", cwd: project } });
    expect(image.takeId).toBeDefined();
    const before = net.requests.length;

    const cases: Array<[TakeContinueOptions, string, string]> = [
      [options(runwayLike.id), "USAGE_ERROR", "runway cannot extend or edit this video (gen4.5)"],
      [options(klingLike.id, { continuation: "edit", prompt: "dusk" }), "USAGE_ERROR", "kling can extend this video (kling-v3), not edit it"],
      [options(image.takeId!), "USAGE_ERROR", "only a video take can be extended"],
      [options(grokId, { continuation: "edit" }), "USAGE_ERROR", "An edit needs a prompt"],
      [options("take_nope_00000000"), "NOT_FOUND", "Take not found"],
      [options(grokId, { duration: -1 }), "USAGE_ERROR", "Invalid duration"],
    ];
    for (const [opts, code, message] of cases) {
      const result = await executeTakeContinue(opts);
      expect(result.success).toBe(false);
      if (result.success) continue;
      expect(result.failure.code).toBe(code);
      expect(result.error).toContain(message);
    }
    expect(net.requests).toHaveLength(before);
  });

  it("for an estimate above --max-cost, naming the cap that would pass", async () => {
    const parentId = await grokTake();
    const before = net.requests.length;
    const result = await executeTakeContinue(options(parentId, { maxCostUsd: 1 }));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.failure).toMatchObject({ code: "COST_CAP_EXCEEDED", retryWith: [`vibe take extend ${parentId} --max-cost 5 --json`] });
    expect(net.requests).toHaveLength(before);
  });
});

describe("surfaces", () => {
  async function runCli(args: string[]): Promise<{ envelope: Record<string, unknown>; stderr: string[] }> {
    process.env.VIBE_JSON_OUTPUT = "1";
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as never);
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => void stdout.push(parts.map(String).join(" ")));
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => void stderr.push(parts.map(String).join(" ")));
    vi.spyOn(process, "cwd").mockReturnValue(project);
    await takeCommand.parseAsync(args, { from: "user" }).catch((error: unknown) => {
      if (!(error instanceof Error && error.message === "process.exit")) throw error;
    });
    const line = stdout.find((l) => l.trimStart().startsWith("{"));
    return { envelope: line ? (JSON.parse(line) as Record<string, unknown>) : {}, stderr };
  }

  it("vibe take extend --json returns the child take and its metered cost", async () => {
    const parentId = await grokTake();
    const { envelope } = await runCli(["extend", parentId, "--duration", "4"]);
    expect(envelope).toMatchObject({ command: "take extend", data: { parentTakeId: parentId, status: "completed" } });
    const takeId = (envelope.data as { takeId: string }).takeId;
    expect(readTake(takeId).parent).toBe(parentId);
    expect(envelope.costUsd).toBeCloseTo(FAKE_GROK_TICKS / 1e10, 6);
  });

  it("vibe take edit without --prompt exits with a usage error", async () => {
    const parentId = await grokTake();
    const { stderr } = await runCli(["edit", parentId]);
    // The first error printed; a mocked process.exit returns into the action's own catch.
    expect(JSON.parse(stderr[0])).toMatchObject({ success: false, code: "USAGE_ERROR" });
  });

  it("MCP take_edit records via mcp, and a dry run spends nothing", async () => {
    const parentId = await grokTake();
    vi.spyOn(process, "cwd").mockReturnValue(project);
    const dispatch = buildMcpDispatcher(manifest);
    const before = net.requests.length;
    const plan = JSON.parse((await dispatch("take_edit", { takeId: parentId, prompt: "make it dusk", dryRun: true })).content[0].text);
    expect(plan).toMatchObject({ dryRun: true, provider: "grok", costUsd: 5 });
    expect(net.requests).toHaveLength(before);

    const done = JSON.parse((await dispatch("take_edit", { takeId: parentId, prompt: "make it dusk" })).content[0].text) as { takeId: string };
    expect(posts().at(-1)!.path).toBe("/v1/videos/edits");
    expect(readTake(done.takeId)).toMatchObject({ parent: parentId, operation: "edit", origin: { via: "mcp", command: "take_edit" } });
  });
});
