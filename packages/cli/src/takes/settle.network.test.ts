/**
 * `vibe status job` settles the take a job was submitted under, over the
 * real MCP tool, job record, provider poll, download, and take store (only
 * `fetch` is faked).
 *
 * The contract: a job handed back unfinished leaves a `submitted` take and a
 * job record naming it; the refresh that sees the job finish fills the take
 * in once (status, hashed output, the provider's charge, settledAt), the
 * ledger counts it once, and a build slot it fills points at it.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FAKE_GROK_TICKS, createFakeProviderNetwork, jsonResponse, type FakeProviderNetwork } from "../testing/fake-provider-network.js";
import { executeVideoGenerate } from "../commands/ai-video.js";
import { readAssetMetadata } from "../commands/_shared/build-asset-metadata.js";
import { createAndWriteJobRecord, readJobRecord, refreshJobRecord } from "../commands/_shared/status-jobs.js";
import { buildMcpDispatcher } from "../tools/adapters/mcp.js";
import { manifest } from "../tools/manifest/index.js";
import { executeTakeLog } from "./query.js";
import { ledgerPath, readLedger, takeMediaPath, type Take } from "./take.js";

let project: string;
let net: FakeProviderNetwork;
const savedEnv = { ...process.env };

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "vibe-settle-"));
  writeFileSync(join(project, "STORYBOARD.md"), "# Film\n");
  for (const key of ["FAL_API_KEY", "KLING_API_KEY", "GOOGLE_API_KEY"]) delete process.env[key];
  Object.assign(process.env, { XAI_API_KEY: "test-xai" });
  delete process.env.VIBE_TAKES;
  net = createFakeProviderNetwork();
  net.install();
});

afterEach(() => {
  net.uninstall();
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
  rmSync(project, { recursive: true, force: true });
});

const readTake = (id: string): Take => JSON.parse(readFileSync(join(project, ".vibeframe", "takes", `${id}.json`), "utf-8")) as Take;
const ledgerLines = (id: string) => readFileSync(ledgerPath(), "utf-8").split("\n").filter((line) => line.includes(id));

async function submitThroughMcp(): Promise<{ takeId: string; jobId: string }> {
  // The MCP server runs in the host's workspace: here, the project.
  vi.spyOn(process, "cwd").mockReturnValue(project);
  const dispatch = buildMcpDispatcher(manifest);
  const reply = await dispatch("generate_video", { prompt: "A paper boat drifts", provider: "grok", duration: 5, wait: false });
  const data = JSON.parse(reply.content[0].text) as { takeId?: string; jobId?: string };
  expect(data.takeId).toBeDefined();
  expect(data.jobId).toBeDefined();
  return { takeId: data.takeId!, jobId: data.jobId! };
}

describe("status job settles the submitted take", () => {
  it("fills in the take once: status, output, the reported charge, settledAt", async () => {
    const { takeId, jobId } = await submitThroughMcp();
    const submitted = readTake(takeId);
    expect(submitted).toMatchObject({ status: "submitted", outputs: [] });
    expect(submitted.session).toBeDefined();
    const record = await readJobRecord(jobId, project);
    expect(record?.takeId).toBe(takeId);

    const status = await refreshJobRecord(record!);
    expect(status).toMatchObject({ status: "completed", takeId });

    const settled = readTake(takeId);
    expect(settled.status).toBe("completed");
    expect(settled.outputs).toHaveLength(1);
    expect(settled.outputs[0].path).toBe("video.mp4");
    expect(existsSync(takeMediaPath(project, settled.outputs[0]))).toBe(true);
    expect(settled.cost.basis).toBe("reported");
    expect(settled.cost.usd).toBeCloseTo(FAKE_GROK_TICKS * 1e-10, 6);
    expect(settled.settledAt).toBeDefined();
    expect(settled.createdAt).toBe(submitted.createdAt);

    // The ledger holds the submission and the settlement; only the settlement counts.
    expect(ledgerLines(takeId)).toHaveLength(2);
    expect((await readLedger()).filter((e) => e.takeId === takeId)).toMatchObject([{ status: "completed", basis: "reported" }]);
    const log = await executeTakeLog({ cwd: project, global: true });
    expect(log.takes).toBe((await readLedger()).length);

    // Refreshing again changes nothing.
    await refreshJobRecord((await readJobRecord(jobId, project))!);
    expect(readTake(takeId)).toEqual(settled);
    expect(ledgerLines(takeId)).toHaveLength(2);
  });

  it("settles a job the provider failed as a failed take", async () => {
    const { takeId, jobId } = await submitThroughMcp();
    net.on("GET", "api.x.ai", /^\/v1\/videos\/[^/]+$/, () =>
      jsonResponse({ status: "failed", error: { code: "content_policy", message: "Rejected by moderation" } }),
    );

    await refreshJobRecord((await readJobRecord(jobId, project))!);

    const failed = readTake(takeId);
    expect(failed).toMatchObject({ status: "failed", outputs: [] });
    expect(failed.error?.message).toMatch(/moderation/i);
    expect(failed.settledAt).toBeDefined();
  });

  it("leaves the take submitted while the job is still running", async () => {
    const { takeId, jobId } = await submitThroughMcp();
    net.on("GET", "api.x.ai", /^\/v1\/videos\/[^/]+$/, () => jsonResponse({ status: "pending" }));

    await refreshJobRecord((await readJobRecord(jobId, project))!);

    expect(readTake(takeId)).toMatchObject({ status: "submitted" });
    expect(readTake(takeId).settledAt).toBeUndefined();
  });

  it("a build slot a settled job fills points at its take", async () => {
    // What a build leaves when its video wait runs out: a submitted take for the slot and a job record naming it.
    const output = join(project, "assets", "video-pond.mp4");
    mkdirSync(join(project, "assets"), { recursive: true });
    const result = await executeVideoGenerate({
      prompt: "A paper boat drifts",
      provider: "grok",
      duration: 5,
      output,
      wait: false,
      take: { via: "build", command: "build", cwd: project, beatId: "pond", asset: "video" },
    });
    const job = await createAndWriteJobRecord({
      jobType: "generate-video",
      provider: "grok",
      providerTaskId: result.taskId!,
      providerJob: result.job,
      takeId: result.takeId,
      projectDir: project,
      workingDirectory: project,
      command: "build --stage assets",
      beatId: "pond",
      outputPath: output,
      assetKind: "video",
      assetCue: "A paper boat drifts",
      cacheKey: "k",
      canonicalPath: "assets/video-pond.mp4",
    });

    await refreshJobRecord(job);

    expect(readTake(result.takeId!)).toMatchObject({ status: "completed", origin: { beatId: "pond", asset: "video" } });
    expect(readAssetMetadata(project, "video", "pond")?.takeId).toBe(result.takeId);
  });
});
