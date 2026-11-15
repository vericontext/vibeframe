/**
 * `vibe take prune` over real takes, their preserved media copies, and a
 * promoted beat slot (only `fetch` is faked).
 *
 * The contract: by default only copies no take refers to and stale temp
 * files go, so every take stays promotable; `slotsOnly` also drops the
 * copies of takes not in a slot, naming them, while a copy shared with a
 * slot's take stays; a dry run removes nothing; take records and slot files
 * are never touched.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FAKE_MP4, FAKE_GROK_TICKS, createFakeProviderNetwork, jsonResponse, type FakeProviderNetwork } from "../testing/fake-provider-network.js";
import { executeVideoGenerate } from "../commands/ai-video.js";
import { takeCommand } from "../commands/take.js";
import { buildMcpDispatcher } from "../tools/adapters/mcp.js";
import { manifest } from "../tools/manifest/index.js";
import { executeTakePromote } from "./promote.js";
import { executeTakePrune, type TakePruneResult } from "./prune.js";
import type { Take } from "./take.js";

let project: string;
let net: FakeProviderNetwork;
const savedEnv = { ...process.env };
const videoBytes = (id: string) => Buffer.concat([FAKE_MP4, Buffer.from(id)]);

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "vibe-prune-"));
  writeFileSync(
    join(project, "STORYBOARD.md"),
    "---\nproject: t\n---\n\n## Beat pond - Pond\n\n```yaml\nduration: 4\nvideo: A paper boat drifts\n```\n",
  );
  Object.assign(process.env, { XAI_API_KEY: "test-xai" });
  delete process.env.VIBE_TAKES;
  net = createFakeProviderNetwork();
  net.on("GET", "api.x.ai", /^\/v1\/videos\/[^/]+$/, (req) => {
    const id = req.path.split("/").at(-1)!;
    return jsonResponse({ status: "done", model: "grok-imagine-video", video: { url: `https://fake.media/${id}.mp4`, duration: 5 }, usage: { cost_in_usd_ticks: FAKE_GROK_TICKS } });
  });
  net.on("GET", "fake.media", /^\/[^/]+\.mp4$/, (req) => new Response(new Uint8Array(videoBytes(req.path.slice(1, -4)))));
  net.install();
});

afterEach(() => {
  net.uninstall();
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
  rmSync(project, { recursive: true, force: true });
});

const mediaDir = () => join(project, ".vibeframe", "media");
const media = () => readdirSync(mediaDir()).sort();
const takeFiles = () => readdirSync(join(project, ".vibeframe", "takes")).sort();
const readTake = (id: string): Take => JSON.parse(readFileSync(join(project, ".vibeframe", "takes", `${id}.json`), "utf-8")) as Take;
const copyOf = (id: string) => {
  const output = readTake(id).outputs[0];
  return `${output.sha256}.mp4`;
};

async function pondTake(name: string): Promise<string> {
  const result = await executeVideoGenerate({
    prompt: "A paper boat drifts",
    provider: "grok",
    duration: 5,
    output: join(project, "renders", `${name}.mp4`),
    take: { via: "cli", command: "generate video", cwd: project, beatId: "pond", asset: "video" },
  });
  return result.takeId!;
}

/** Two takes for the pond slot, the newer promoted into it; plus an orphan copy and two temp files. */
async function scene(): Promise<{ older: string; newer: string }> {
  const older = await pondTake("first");
  const newer = await pondTake("second");
  const promoted = await executeTakePromote({ takeId: newer, cwd: project });
  if (!promoted.success) throw new Error(promoted.error);
  writeFileSync(join(mediaDir(), `${"f".repeat(64)}.mp4`), "orphan bytes");
  writeFileSync(join(mediaDir(), "stale.mp4.123.abcd.tmp"), "crashed copy");
  const hourAgo = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
  utimesSync(join(mediaDir(), "stale.mp4.123.abcd.tmp"), hourAgo, hourAgo);
  writeFileSync(join(mediaDir(), "fresh.mp4.456.ef01.tmp"), "copy in progress");
  return { older, newer };
}

describe("take prune", () => {
  it("removes only what no take can use: orphan copies and stale temp files", async () => {
    const { older, newer } = await scene();
    const takesBefore = takeFiles();
    const slotBefore = readFileSync(join(project, "assets", "video-pond.mp4"));

    const plan = (await executeTakePrune({ cwd: project, dryRun: true })) as TakePruneResult;
    expect(plan.removed.map((f) => [f.reason, f.file])).toEqual([
      ["unreferenced", `${"f".repeat(64)}.mp4`],
      ["temp", "stale.mp4.123.abcd.tmp"],
    ]);
    expect(plan.freedBytes).toBe("crashed copy".length + "orphan bytes".length);
    expect(media()).toHaveLength(5);

    const done = (await executeTakePrune({ cwd: project })) as TakePruneResult;
    expect(done).toMatchObject({ dryRun: false, kept: 3, unpromotable: [] });
    expect(media()).toEqual([copyOf(older), copyOf(newer), "fresh.mp4.456.ef01.tmp"].sort());
    expect(takeFiles()).toEqual(takesBefore);
    expect(readFileSync(join(project, "assets", "video-pond.mp4"))).toEqual(slotBefore);
    expect(net.requests.filter((r) => r.method === "POST")).toHaveLength(2);
  });

  it("with slotsOnly, drops the copies of takes not in a slot and names them", async () => {
    const { older, newer } = await scene();

    const done = (await executeTakePrune({ cwd: project, slotsOnly: true })) as TakePruneResult;

    expect(done.removed.find((f) => f.reason === "not-in-slot")).toMatchObject({ file: copyOf(older), takeIds: [older] });
    expect(done.unpromotable).toEqual([older]);
    expect(media()).toContain(copyOf(newer));
    expect(media()).not.toContain(copyOf(older));
    // The take is still recorded, and promotable while its output file is unchanged.
    expect(readTake(older).status).toBe("completed");
    expect((await executeTakePromote({ takeId: older, cwd: project, dryRun: true })).success).toBe(true);
    writeFileSync(join(project, "renders", "first.mp4"), "edited since");
    expect((await executeTakePromote({ takeId: older, cwd: project, dryRun: true })).success).toBe(false);
  });

  it("keeps a copy a slot's take shares with a take outside the slot", async () => {
    const { newer } = await scene();
    // A second take with the same bytes as the one in the slot.
    const twin = { ...readTake(newer), id: "take_mwtwin00_00000000", origin: { ...readTake(newer).origin, beatId: "other" } };
    writeFileSync(join(project, ".vibeframe", "takes", `${twin.id}.json`), JSON.stringify(twin));

    const done = (await executeTakePrune({ cwd: project, slotsOnly: true })) as TakePruneResult;

    expect(media()).toContain(copyOf(newer));
    expect(done.unpromotable).not.toContain(twin.id);
  });

  it("refuses outside a project, and reports an empty media folder as nothing to do", async () => {
    const outside = mkdtempSync(join(tmpdir(), "vibe-prune-outside-"));
    try {
      const refused = await executeTakePrune({ cwd: outside });
      expect(refused.success).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
    mkdirSync(join(project, ".vibeframe"), { recursive: true });
    expect(await executeTakePrune({ cwd: project })).toMatchObject({ success: true, removed: [], kept: 0 });
  });
});

describe("surfaces", () => {
  it("CLI --json and MCP take_prune agree, and a dry run removes nothing", async () => {
    await scene();
    process.env.VIBE_JSON_OUTPUT = "1";
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => void stdout.push(parts.map(String).join(" ")));
    await takeCommand.parseAsync(["prune", "--project", project, "--slots-only", "--dry-run"], { from: "user" });
    const cli = JSON.parse(stdout.find((l) => l.trimStart().startsWith("{"))!) as { command: string; dryRun: boolean; data: TakePruneResult };
    expect(cli).toMatchObject({ command: "take prune", dryRun: true });
    expect(media()).toHaveLength(5);

    vi.spyOn(process, "cwd").mockReturnValue(project);
    const dispatch = buildMcpDispatcher(manifest);
    const mcp = JSON.parse((await dispatch("take_prune", { slotsOnly: true, dryRun: true })).content[0].text) as TakePruneResult;
    expect(mcp.removed).toEqual(cli.data.removed);
    expect(mcp.unpromotable).toEqual(cli.data.unpromotable);
    expect(existsSync(mediaDir())).toBe(true);
    expect(media()).toHaveLength(5);
  });
});
