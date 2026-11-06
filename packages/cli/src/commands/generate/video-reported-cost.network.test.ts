/**
 * xAI and Runway say what a finished video job charged (`cost_in_usd_ticks`,
 * `cost.credits`). That charge is the job's cost: `generate video` reports
 * it instead of a list-price estimate, and a job polled later through its
 * job record is metered once, the first time a refresh sees it finish.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { meterUsage, priceUsage } from "@vibeframe/ai-providers";

import {
  FAKE_GROK_TICKS,
  FAKE_RUNWAY_CREDITS,
  createFakeProviderNetwork,
  type FakeProviderNetwork,
} from "../../testing/fake-provider-network.js";
import { createJobRecord, refreshJobRecord, writeJobRecord } from "../_shared/status-jobs.js";
import { registerVideoCommand } from "./video.js";
import { registerVideoExtendCommand } from "./video-extend.js";

const GROK_USD = FAKE_GROK_TICKS * 1e-10;
const RUNWAY_USD = FAKE_RUNWAY_CREDITS * 0.01;

let dir: string;
let net: FakeProviderNetwork;
const savedEnv = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vibe-reported-cost-"));
  for (const key of ["FAL_API_KEY", "KLING_API_KEY", "GOOGLE_API_KEY"]) delete process.env[key];
  Object.assign(process.env, { XAI_API_KEY: "test-xai", RUNWAY_API_SECRET: "test-runway" });
  net = createFakeProviderNetwork();
  net.install();
});

afterEach(() => {
  net.uninstall();
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

async function runVideo(args: string[], register = registerVideoCommand, name = "video"): Promise<Record<string, unknown>> {
  process.env.VIBE_JSON_OUTPUT = "1";
  vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("process.exit");
  }) as never);
  const stdout: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => void stdout.push(parts.map(String).join(" ")));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const command = new Command("generate");
  register(command);
  await command.parseAsync([name, ...args], { from: "user" }).catch((error: unknown) => {
    if (!(error instanceof Error && error.message === "process.exit")) throw error;
  });
  const line = stdout.find((l) => l.trimStart().startsWith("{"));
  return line ? (JSON.parse(line) as Record<string, unknown>) : {};
}

describe("generate video reports the charge the provider reported", () => {
  it("Grok: cost_in_usd_ticks", async () => {
    const result = await runVideo(["A paper boat drifts", "-p", "grok", "-d", "5", "-o", join(dir, "grok.mp4")]);
    expect(result).toMatchObject({ command: "generate video", data: { provider: "grok" } });
    expect(result.costUsd).toBeCloseTo(GROK_USD, 6);
    expect(result).not.toHaveProperty("costEstimated");
  });

  it("Runway: cost.credits", async () => {
    const result = await runVideo(["A paper boat drifts", "-p", "runway", "-d", "5", "-o", join(dir, "runway.mp4")]);
    expect(result).toMatchObject({ command: "generate video", data: { provider: "runway" } });
    expect(result.costUsd).toBeCloseTo(RUNWAY_USD, 6);
    expect(result).not.toHaveProperty("costEstimated");
  });
});

describe("generate video-extend reports the charge the provider reported", () => {
  it("Grok: cost_in_usd_ticks, not the extension estimate", async () => {
    const result = await runVideo(
      ["grok-source", "-p", "grok", "-d", "4", "-o", join(dir, "extended.mp4")],
      registerVideoExtendCommand,
      "video-extend",
    );
    expect(result).toMatchObject({ command: "generate video-extend" });
    expect(result.costUsd).toBeCloseTo(GROK_USD, 6);
    expect(result).not.toHaveProperty("costEstimated");
  });
});

describe("a job refreshed through its record", () => {
  it("is metered once, on the refresh that first sees it finish", async () => {
    const record = createJobRecord({
      jobType: "generate-video",
      provider: "grok",
      providerTaskId: "grok-job-1",
      providerJob: { provider: "grok", id: "grok-job-1", model: "grok-imagine-video-1.5", submittedAt: new Date().toISOString() },
      projectDir: dir,
      workingDirectory: dir,
      command: "generate video",
    });
    await writeJobRecord(record);

    const first = await meterUsage(() => refreshJobRecord(record, { workingDirectory: dir }));
    expect(priceUsage(first.usage).costUsd).toBeCloseTo(GROK_USD, 6);
    expect(first.result.job.usage?.amount.unit).toBe("usd");

    const second = await meterUsage(() => refreshJobRecord(first.result.job, { workingDirectory: dir }));
    expect(second.usage).toEqual([]);
  });

  it("is not metered by a refresh that does not write the record", async () => {
    const record = createJobRecord({
      jobType: "generate-video",
      provider: "grok",
      providerTaskId: "grok-job-2",
      providerJob: { provider: "grok", id: "grok-job-2", model: "grok-imagine-video-1.5", submittedAt: new Date().toISOString() },
      projectDir: dir,
      workingDirectory: dir,
      command: "generate video",
    });

    const peek = await meterUsage(() => refreshJobRecord(record, { workingDirectory: dir, write: false }));
    expect(peek.usage).toEqual([]);
  });
});
