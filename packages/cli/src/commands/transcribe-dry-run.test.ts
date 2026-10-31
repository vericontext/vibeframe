/**
 * `vibe audio transcribe --dry-run` was the only paid command without a dry
 * run. It now shows the provider `auto` resolves to, its model, and the
 * file's length priced from the catalog, without any request.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { findModel } from "@vibeframe/ai-providers";
import { createFakeProviderNetwork, type FakeProviderNetwork } from "../testing/fake-provider-network.js";
import { audioCommand } from "./audio.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

let dir: string;
let audio: string;
let net: FakeProviderNetwork;
const savedEnv = { ...process.env };

beforeAll(() => {
  if (!hasFfmpeg) return;
  dir = mkdtempSync(join(tmpdir(), "vibe-transcribe-dry-run-"));
  audio = join(dir, "speech.wav");
  const run = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=duration=6", audio]);
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr}`);
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  net = createFakeProviderNetwork();
  net.install();
});

afterEach(() => {
  net.uninstall();
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

async function dryRun(args: string[]): Promise<Record<string, unknown>> {
  process.env.VIBE_JSON_OUTPUT = "1";
  const stdout: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    stdout.push(parts.map(String).join(" "));
  });
  // Commander keeps option values on the command between parses, so every call names its provider.
  await audioCommand.parseAsync(["transcribe", audio, "--dry-run", ...args], { from: "user" });
  return JSON.parse(stdout.join("")) as Record<string, unknown>;
}

describe.skipIf(!hasFfmpeg)("vibe audio transcribe --dry-run", () => {
  it("names the provider auto picks and prices the file's length, with no request", async () => {
    process.env.ELEVENLABS_API_KEY = "test-elevenlabs";
    process.env.OPENAI_API_KEY = "test-openai";

    const envelope = await dryRun(["-p", "auto"]);

    const pricePerHour = findModel("elevenlabs", "transcription")!.price!.usd;
    expect(envelope).toMatchObject({ command: "audio transcribe", dryRun: true });
    expect(envelope.data).toMatchObject({ params: { provider: "elevenlabs", model: "scribe_v2" } });
    expect((envelope.data as { params: { durationSec: number } }).params.durationSec).toBeCloseTo(6, 0);
    expect(envelope.costUsd).toBeCloseTo((6 / 3600) * pricePerHour, 6);
    expect(net.requests).toHaveLength(0);
  });

  it("warns about Whisper's shutdown when it is chosen", async () => {
    process.env.OPENAI_API_KEY = "test-openai";

    const envelope = await dryRun(["-p", "openai"]);

    expect(envelope.data).toMatchObject({ params: { provider: "openai", model: "whisper-1" } });
    expect((envelope.warnings as string[]).join(" ")).toContain("2027-02-26");
  });

  it("still shows the plan when no key is set", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const envelope = await dryRun(["-p", "auto"]);

    expect(envelope).toMatchObject({ dryRun: true });
    expect((envelope.warnings as string[]).join(" ")).toContain("No transcription key is set");
    expect(net.requests).toHaveLength(0);
  });
});
