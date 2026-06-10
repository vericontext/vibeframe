import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runWithMcpPromotion, resolveWindowMs } from "./long-poll.js";
import type { ToolExecuteResult } from "../define-tool.js";

const OK: ToolExecuteResult = { success: true, data: { outputPath: "out.mp4" } };

let projectDir: string;
const envBackup = process.env.VIBE_MCP_PROMOTE_AFTER_MS;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "vibe-longpoll-"));
  delete process.env.VIBE_MCP_PROMOTE_AFTER_MS;
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
  if (envBackup === undefined) delete process.env.VIBE_MCP_PROMOTE_AFTER_MS;
  else process.env.VIBE_MCP_PROMOTE_AFTER_MS = envBackup;
});

async function listJobs(): Promise<string[]> {
  try {
    return (await readdir(join(projectDir, ".vibeframe", "jobs"))).filter((f) =>
      f.endsWith(".json")
    );
  } catch {
    return [];
  }
}

async function readSingleJob(): Promise<Record<string, unknown>> {
  const files = await listJobs();
  expect(files).toHaveLength(1);
  return JSON.parse(
    await readFile(join(projectDir, ".vibeframe", "jobs", files[0]), "utf-8")
  ) as Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("resolveWindowMs", () => {
  it("defaults to 45s", () => {
    expect(resolveWindowMs()).toBe(45_000);
  });

  it("honours an explicit option", () => {
    expect(resolveWindowMs(10_000)).toBe(10_000);
  });

  it("env var overrides the option", () => {
    process.env.VIBE_MCP_PROMOTE_AFTER_MS = "1234";
    expect(resolveWindowMs(10_000)).toBe(1234);
  });

  it("'off' and '0' disable promotion", () => {
    process.env.VIBE_MCP_PROMOTE_AFTER_MS = "off";
    expect(resolveWindowMs()).toBeNull();
    process.env.VIBE_MCP_PROMOTE_AFTER_MS = "0";
    expect(resolveWindowMs()).toBeNull();
  });
});

describe("runWithMcpPromotion", () => {
  it("fast path returns the result verbatim and writes no job record", async () => {
    const result = await runWithMcpPromotion(async () => OK, {
      jobType: "render",
      projectDir,
      command: "vibe render x",
      windowMs: 5_000,
    });
    expect(result).toBe(OK);
    expect(await listJobs()).toHaveLength(0);
  });

  it("fast-path failures propagate as rejections", async () => {
    await expect(
      runWithMcpPromotion(
        async () => {
          throw new Error("boom");
        },
        { jobType: "render", projectDir, command: "vibe render x", windowMs: 5_000 }
      )
    ).rejects.toThrow("boom");
    expect(await listJobs()).toHaveLength(0);
  });

  it("promotes slow work and completes the record when it settles", async () => {
    let release: (r: ToolExecuteResult) => void = () => undefined;
    const work = new Promise<ToolExecuteResult>((r) => {
      release = r;
    });
    const promoted = await runWithMcpPromotion(
      (report) => {
        report({ progress: 10, stage: "render", message: "warming up" });
        return work;
      },
      { jobType: "render", projectDir, command: "vibe render x", windowMs: 50, heartbeatMs: 25 }
    );
    expect(promoted.success).toBe(true);
    expect(promoted.data?.promoted).toBe(true);
    expect(promoted.data?.status).toBe("running");
    const jobId = promoted.data?.jobId as string;
    expect(jobId).toMatch(/^job_/);
    expect(promoted.data?.poll).toMatchObject({
      tool: "status_job",
      args: { jobId, projectDir },
    });

    let record = await readSingleJob();
    expect(record.status).toBe("running");
    expect(record.jobType).toBe("render");
    expect(record.pid).toBe(process.pid);
    expect(record.heartbeatAt).toBeTruthy();

    release(OK);
    await sleep(30);
    record = await readSingleJob();
    expect(record.status).toBe("completed");
    expect(record.progress).toBe(100);
    expect(record.resultPayload).toMatchObject({ outputPath: "out.mp4" });
    expect(record.outputPath).toBe("out.mp4");
  });

  it("records failed results and thrown errors after promotion", async () => {
    let reject: (e: Error) => void = () => undefined;
    const work = new Promise<ToolExecuteResult>((_, rej) => {
      reject = rej;
    });
    await runWithMcpPromotion(() => work, {
      jobType: "build",
      projectDir,
      command: "vibe build x",
      windowMs: 30,
    });
    reject(new Error("compose exploded"));
    await sleep(30);
    const record = await readSingleJob();
    expect(record.status).toBe("failed");
    expect(record.error).toBe("compose exploded");
  });

  it("records success:false results as failed with the tool error", async () => {
    let release: (r: ToolExecuteResult) => void = () => undefined;
    const work = new Promise<ToolExecuteResult>((r) => {
      release = r;
    });
    await runWithMcpPromotion(() => work, {
      jobType: "build",
      projectDir,
      command: "vibe build x",
      windowMs: 30,
    });
    release({ success: false, error: "lint failed", data: { phase: "failed" } });
    await sleep(30);
    const record = await readSingleJob();
    expect(record.status).toBe("failed");
    expect(record.error).toBe("lint failed");
    expect(record.resultPayload).toMatchObject({ phase: "failed" });
  });

  it("VIBE_MCP_PROMOTE_AFTER_MS=off never promotes", async () => {
    process.env.VIBE_MCP_PROMOTE_AFTER_MS = "off";
    const slow = sleep(80).then(() => OK);
    const result = await runWithMcpPromotion(() => slow, {
      jobType: "render",
      projectDir,
      command: "vibe render x",
      windowMs: 10,
    });
    expect(result).toBe(OK);
    expect(await listJobs()).toHaveLength(0);
  });
});
