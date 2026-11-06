/**
 * A project build records every beat asset as a take, and `take promote`
 * puts an earlier take back into its slot, over the real provider, build,
 * and file-write path (only `fetch` and ffprobe are faked).
 *
 * The contract: each slot's take names its beat and slot and keeps its own
 * copy of the bytes, so regenerating a slot never loses an earlier take; a
 * promoted take survives later builds until its cue is edited or `--force`;
 * and the dry-run plan agrees with the build about it.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/audio.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/audio.js")>()),
  getAudioDuration: vi.fn(async () => 2.5),
}));

import { FAKE_PNG, createFakeProviderNetwork, jsonResponse, type FakeProviderNetwork } from "../testing/fake-provider-network.js";
import { __setFfmpegToolsForTests } from "../commands/_shared/ffmpeg-gate.js";
import { executeSceneBuild } from "../commands/_shared/scene-build.js";
import { createBuildPlan } from "../commands/_shared/build-plan.js";
import { readAssetMetadata } from "../commands/_shared/build-asset-metadata.js";
import { executeSpeech } from "../commands/generate/speech.js";
import { takeCommand } from "../commands/take.js";
import { buildMcpDispatcher } from "../tools/adapters/mcp.js";
import { manifest } from "../tools/manifest/index.js";
import { executeTakePromote } from "./promote.js";
import { executeTakeList } from "./query.js";
import { globalTakeStore, listTakes, projectTakeStore, takeMediaPath, type Take } from "./take.js";

const KEYS = {
  ELEVENLABS_API_KEY: "test-elevenlabs",
  OPENAI_API_KEY: "test-openai",
  FAL_API_KEY: "test-fal",
  IMGBB_API_KEY: "test-imgbb",
  VIBE_UPLOAD_PROVIDER: "imgbb",
};

function storyboard(cues: string): string {
  return `---
project: takes-test
providers:
  tts: elevenlabs
  image: openai
  video: seedance
  music: elevenlabs
---

## Beat pond — Pond

\`\`\`yaml
duration: 4
${cues}
\`\`\`
`;
}

let projectDir: string;
let net: FakeProviderNetwork;
let images = 0;
const savedEnv = { ...process.env };
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

beforeEach(() => {
  __setFfmpegToolsForTests(true);
  Object.assign(process.env, KEYS);
  delete process.env.VIBE_TAKES;
  projectDir = mkdtempSync(join(tmpdir(), "build-takes-"));
  mkdirSync(join(projectDir, "compositions"), { recursive: true });
  writeFileSync(join(projectDir, "DESIGN.md"), "# Design\n");
  net = createFakeProviderNetwork();
  // Each image differs (a counter after IEND), so takes of one slot are told apart by hash.
  images = 0;
  net.on("POST", "api.openai.com", /^\/v1\/images\/(generations|edits)$/, () => {
    images += 1;
    return jsonResponse({ data: [{ b64_json: Buffer.concat([FAKE_PNG, Buffer.from([images])]).toString("base64") }] });
  });
  net.install();
});

afterEach(() => {
  net.uninstall();
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
  rmSync(projectDir, { recursive: true, force: true });
});

const takes = () => listTakes(projectTakeStore(projectDir));
const slotBytes = (rel: string) => readFileSync(join(projectDir, rel));
const backdropRequests = () => net.to("api.openai.com").filter((r) => r.path.startsWith("/v1/images")).length;

describe("vibe build records every beat asset as a take", () => {
  it("leaves one take per slot, with its beat and slot, a preserved copy, and the slot pointing at it", async () => {
    writeFileSync(
      join(projectDir, "STORYBOARD.md"),
      storyboard(`narration: "A paper boat drifts."
backdrop: "Calm pond at dusk"
video: "Slow push-in on the boat"
music: "Soft piano"`),
    );
    const report = await executeSceneBuild({ projectDir, stage: "assets" });
    expect(report.success).toBe(true);

    const all = await takes();
    const bySlot = new Map(all.map((take) => [take.origin.asset, take]));
    expect([...bySlot.keys()].sort()).toEqual(["backdrop", "music", "narration", "video"]);
    expect(bySlot.get("narration")).toMatchObject({ kind: "audio", provider: "elevenlabs", prompt: "A paper boat drifts.", cost: { basis: "metered" } });
    expect(bySlot.get("backdrop")).toMatchObject({ kind: "image", provider: "openai", cost: { basis: "estimate" } });
    expect(bySlot.get("video")).toMatchObject({ kind: "video", provider: "seedance" });
    expect(bySlot.get("music")).toMatchObject({ kind: "audio", provider: "elevenlabs", cost: { basis: "metered" } });

    for (const take of all) {
      expect(take.origin).toMatchObject({ via: "build", command: "build", cwd: ".", beatId: "pond" });
      const output = take.outputs[0];
      expect(output.path).toMatch(/^assets\//);
      // The take keeps its own copy of the bytes, by hash, outside the slot file.
      expect(sha256(readFileSync(takeMediaPath(projectDir, output)))).toBe(output.sha256);
      expect(readAssetMetadata(projectDir, take.origin.asset!, "pond")?.takeId).toBe(take.id);
    }

    const list = await executeTakeList({ cwd: projectDir });
    for (const row of list.takes) expect(row.inSlot).toEqual({ beatId: "pond", asset: row.asset, promoted: false });
  });

  it("two takes with the same bytes at once both record, sharing one preserved copy", async () => {
    const out = (name: string) => join(projectDir, "takes", name);
    writeFileSync(join(projectDir, "STORYBOARD.md"), storyboard(`narration: "x"`));
    const results = await Promise.all(
      ["a.mp3", "b.mp3", "c.mp3", "d.mp3"].map((name) =>
        executeSpeech({ text: "Same words.", provider: "elevenlabs", output: out(name), cwd: projectDir }),
      ),
    );
    for (const result of results) {
      expect(result.takeError).toBeUndefined();
      expect(result.takeId).toBeDefined();
    }
    const all = await takes();
    expect(all).toHaveLength(4);
    expect(new Set(all.map((t) => t.outputs[0].sha256)).size).toBe(1);
    expect(existsSync(takeMediaPath(projectDir, all[0].outputs[0]))).toBe(true);
  });

  it("a cached slot makes no new take", async () => {
    writeFileSync(join(projectDir, "STORYBOARD.md"), storyboard(`backdrop: "Calm pond at dusk"`));
    await executeSceneBuild({ projectDir, stage: "assets" });
    await executeSceneBuild({ projectDir, stage: "assets" });
    expect(await takes()).toHaveLength(1);
    expect(backdropRequests()).toBe(1);
  });

  it("records a character sheet and a keyframe edited from it", async () => {
    writeFileSync(
      join(projectDir, "STORYBOARD.md"),
      `---
project: takes-test
providers:
  image: openai
characters:
  mira: "A young sailor in a yellow raincoat"
---

## Beat pond — Pond

\`\`\`yaml
duration: 4
keyframe: "Mira kneels by the pond"
characters: [mira]
\`\`\`
`,
    );
    await executeSceneBuild({ projectDir, stage: "assets", skipVideo: true });
    const all = await takes();
    const sheet = all.find((t) => !t.origin.asset);
    const keyframe = all.find((t) => t.origin.asset === "keyframe");
    expect(sheet).toMatchObject({ kind: "image", operation: "generate", origin: { via: "build" } });
    expect(sheet?.origin.beatId).toBeUndefined();
    expect(keyframe).toMatchObject({ kind: "image", operation: "edit", origin: { beatId: "pond", asset: "keyframe" } });
    expect(keyframe?.inputs).toEqual([expect.objectContaining({ role: "reference-image", path: "assets/character-mira.png", sha256: sheet!.outputs[0].sha256 })]);
  });
});

describe("vibe take promote", () => {
  async function twoBackdropTakes(): Promise<[Take, Take]> {
    writeFileSync(join(projectDir, "STORYBOARD.md"), storyboard(`backdrop: "Calm pond at dusk"`));
    await executeSceneBuild({ projectDir, stage: "assets" });
    await executeSceneBuild({ projectDir, stage: "assets", force: true });
    const [second, first] = await takes();
    expect(first.outputs[0].sha256).not.toBe(second.outputs[0].sha256);
    return [first, second];
  }

  it("puts an earlier take back into its slot, and later builds keep it", async () => {
    const [first, second] = await twoBackdropTakes();
    expect(sha256(slotBytes("assets/backdrop-pond.png"))).toBe(second.outputs[0].sha256);

    const dry = await executeTakePromote({ takeId: first.id, cwd: projectDir, dryRun: true });
    expect(dry).toMatchObject({ success: true, dryRun: true, beatId: "pond", asset: "backdrop", path: "assets/backdrop-pond.png", previousTakeId: second.id });
    expect(sha256(slotBytes("assets/backdrop-pond.png"))).toBe(second.outputs[0].sha256);

    const promoted = await executeTakePromote({ takeId: first.id, cwd: projectDir });
    expect(promoted).toMatchObject({ success: true, dryRun: false });
    expect(sha256(slotBytes("assets/backdrop-pond.png"))).toBe(first.outputs[0].sha256);
    expect(readAssetMetadata(projectDir, "backdrop", "pond")).toMatchObject({ takeId: first.id, promotedCue: "Calm pond at dusk" });

    const rows = (await executeTakeList({ cwd: projectDir })).takes;
    expect(rows.find((r) => r.id === first.id)?.inSlot).toEqual({ beatId: "pond", asset: "backdrop", promoted: true });
    expect(rows.find((r) => r.id === second.id)?.inSlot).toBeUndefined();

    // The plan and the build agree: the promoted slot costs nothing and is not regenerated.
    const plan = await createBuildPlan({ projectDir, stage: "assets" });
    expect(plan.beats[0].assets.backdrop).toMatchObject({ reason: "promoted-take", willGenerate: false, estimatedCostUsd: 0 });
    const before = backdropRequests();
    await executeSceneBuild({ projectDir, stage: "assets" });
    expect(backdropRequests()).toBe(before);
    expect(sha256(slotBytes("assets/backdrop-pond.png"))).toBe(first.outputs[0].sha256);
  });

  it("an edited cue regenerates a promoted slot", async () => {
    const [first] = await twoBackdropTakes();
    await executeTakePromote({ takeId: first.id, cwd: projectDir });
    writeFileSync(join(projectDir, "STORYBOARD.md"), storyboard(`backdrop: "Stormy pond at night"`));

    const plan = await createBuildPlan({ projectDir, stage: "assets" });
    expect(plan.beats[0].assets.backdrop).toMatchObject({ willGenerate: true });
    const before = backdropRequests();
    await executeSceneBuild({ projectDir, stage: "assets" });
    expect(backdropRequests()).toBe(before + 1);
    const metadata = readAssetMetadata(projectDir, "backdrop", "pond");
    expect(metadata?.promotedCue).toBeUndefined();
    expect(metadata?.takeId).not.toBe(first.id);
  });

  it("--force regenerates a promoted slot", async () => {
    const [first] = await twoBackdropTakes();
    await executeTakePromote({ takeId: first.id, cwd: projectDir });
    const before = backdropRequests();
    await executeSceneBuild({ projectDir, stage: "assets", force: true });
    expect(backdropRequests()).toBe(before + 1);
    expect(readAssetMetadata(projectDir, "backdrop", "pond")?.promotedCue).toBeUndefined();
  });

  it("refuses a take that cannot fill the slot, an unknown take, and a take whose bytes are gone", async () => {
    const [first] = await twoBackdropTakes();
    const wrongKind = await executeTakePromote({ takeId: first.id, cwd: projectDir, asset: "narration" });
    expect(wrongKind).toMatchObject({ success: false, failure: { code: "USAGE_ERROR" } });
    expect(wrongKind.success === false && wrongKind.error).toMatch(/image take cannot fill a narration slot/);

    const missing = await executeTakePromote({ takeId: "take_zzzzzzzz_00000000", cwd: projectDir });
    expect(missing).toMatchObject({ success: false, failure: { code: "NOT_FOUND" } });

    const noBeat = await executeTakePromote({ takeId: first.id, cwd: projectDir, beatId: "harbor" });
    expect(noBeat).toMatchObject({ success: false, failure: { code: "NOT_FOUND" } });

    rmSync(takeMediaPath(projectDir, first.outputs[0]));
    const gone = await executeTakePromote({ takeId: first.id, cwd: projectDir });
    expect(gone.success === false && gone.error).toMatch(/is gone/);
  });

  it("fills a slot from a take made outside the build, given the slot, and drops the old word timings", async () => {
    writeFileSync(join(projectDir, "STORYBOARD.md"), storyboard(`narration: "A paper boat drifts."`));
    await executeSceneBuild({ projectDir, stage: "assets" });
    await executeSceneBuild({ projectDir, stage: "transcript" });
    const transcript = join(projectDir, "assets", "transcript-pond.json");
    expect(existsSync(transcript)).toBe(true);
    const spoken = await executeSpeech({ text: "A paper boat drifts, slowly.", provider: "elevenlabs", output: join(projectDir, "takes", "line.mp3"), cwd: projectDir });
    expect(spoken.takeId).toBeDefined();

    const refused = await executeTakePromote({ takeId: spoken.takeId!, cwd: projectDir });
    expect(refused.success === false && refused.error).toMatch(/not made for a beat slot/);

    const promoted = await executeTakePromote({ takeId: spoken.takeId!, cwd: projectDir, beatId: "pond", asset: "narration" });
    expect(promoted).toMatchObject({ success: true, path: "assets/narration-pond.mp3" });
    expect(existsSync(transcript)).toBe(false);
    const transcriptions = () => net.to("api.elevenlabs.io").filter((r) => r.path.startsWith("/v1/speech-to-text")).length;
    const before = transcriptions();
    await executeSceneBuild({ projectDir, stage: "assets" });
    await executeSceneBuild({ projectDir, stage: "transcript" });
    // The promoted narration is kept (one build TTS call, one generate narration call) and transcribed again.
    expect(net.to("api.elevenlabs.io").filter((r) => r.path.startsWith("/v1/text-to-speech"))).toHaveLength(2);
    expect(transcriptions()).toBe(before + 1);
    expect(existsSync(transcript)).toBe(true);
  });
});

describe("audio generations outside a project", () => {
  it("generate narration leaves a global audio take with a metered cost", async () => {
    const loose = mkdtempSync(join(tmpdir(), "loose-"));
    try {
      const spoken = await executeSpeech({ text: "Hello there.", provider: "elevenlabs", output: join(loose, "hello.mp3"), cwd: loose });
      const take = (await listTakes(globalTakeStore())).find((t) => t.id === spoken.takeId);
      expect(take).toMatchObject({ kind: "audio", operation: "generate", provider: "elevenlabs", cost: { basis: "metered" }, origin: { via: "cli", command: "generate narration" } });
      expect(take?.outputs[0].path).toBe(join(loose, "hello.mp3"));
      // A global take keeps no copy: its output is the file the user asked for.
      expect(existsSync(join(loose, ".vibeframe"))).toBe(false);
    } finally {
      rmSync(loose, { recursive: true, force: true });
    }
  });
});

describe("surfaces", () => {
  it("vibe take promote --json and MCP take_promote", async () => {
    writeFileSync(join(projectDir, "STORYBOARD.md"), storyboard(`backdrop: "Calm pond at dusk"`));
    await executeSceneBuild({ projectDir, stage: "assets" });
    await executeSceneBuild({ projectDir, stage: "assets", force: true });
    const [second, first] = await takes();

    process.env.VIBE_JSON_OUTPUT = "1";
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as never);
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => void stdout.push(parts.map(String).join(" ")));
    vi.spyOn(process, "cwd").mockReturnValue(projectDir);
    await (takeCommand as Command).parseAsync(["promote", first.id, "--dry-run"], { from: "user" });
    const envelope = JSON.parse(stdout.find((l) => l.trimStart().startsWith("{"))!) as Record<string, unknown>;
    expect(envelope).toMatchObject({ command: "take promote", dryRun: true, data: { takeId: first.id, previousTakeId: second.id } });

    const dispatch = buildMcpDispatcher(manifest);
    const result = await dispatch("take_promote", { takeId: first.id });
    expect(JSON.parse(result.content[0].text)).toMatchObject({ takeId: first.id, asset: "backdrop", dryRun: false });
    expect(sha256(slotBytes("assets/backdrop-pond.png"))).toBe(first.outputs[0].sha256);
  });
});
