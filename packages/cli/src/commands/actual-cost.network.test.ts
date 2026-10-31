/**
 * Actual cost over the fake provider network: real provider classes,
 * `providerRequest`, and file writes run; only `fetch` is replaced. Paid
 * commands must report `costUsd` = catalog list price x what the provider
 * call consumed, on the CLI envelope, the MCP tool result, and the YAML
 * pipeline budget.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findModel, type ModelPrice } from "@vibeframe/ai-providers";

import { createFakeProviderNetwork, type FakeProviderNetwork } from "../testing/fake-provider-network.js";
import { manifest } from "../tools/manifest/index.js";
import { buildMcpDispatcher } from "../tools/adapters/mcp.js";
import { executePipeline } from "../pipeline/executor.js";
import { roundUsd } from "./_shared/actual-cost.js";
import { audioCommand } from "./audio.js";
import { registerMusicCommand } from "./generate/music.js";
import { registerSoundEffectCommand } from "./generate/sound-effect.js";
import { registerNarrationCommand } from "./generate/speech.js";
import { lookupCostEstimateUpperBound } from "./output.js";

let dir: string;
let net: FakeProviderNetwork;
const savedEnv = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vibe-actual-cost-"));
  for (const key of ["ELEVENLABS_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "ANTHROPIC_API_KEY"]) delete process.env[key];
  net = createFakeProviderNetwork();
  net.install();
});

afterEach(() => {
  net.uninstall();
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

/** The catalog price in effect today, honouring a dated price change. */
function listPrice(provider: string, kind: Parameters<typeof findModel>[1], model: string): ModelPrice & { usd: number } {
  const price = findModel(provider, kind, model)?.price;
  if (!price) throw new Error(`no catalog price for ${provider} ${model}`);
  const today = new Date().toISOString().slice(0, 10);
  return price.until && price.then && today > price.until ? { ...price, ...price.then } : price;
}

/** Run `<group> <args> --json` in process and return the exit code and JSON envelope. */
async function runCli(command: Command, args: string[]) {
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
  await command.parseAsync(args, { from: "user" }).catch((error: unknown) => {
    if (!(error instanceof Error && error.message === "process.exit")) throw error;
  });
  const json = (lines: string[]) => {
    const line = lines.find((l) => l.trimStart().startsWith("{"));
    return line ? (JSON.parse(line) as Record<string, unknown>) : {};
  };
  return { exitCode, result: json(stdout), error: json(stderr) };
}

function generate(register: (parent: Command) => void): Command {
  const command = new Command("generate");
  register(command);
  return command;
}

const TEXT = "A paper boat drifts.";

describe("vibe generate narration reports what the call consumed", () => {
  it("-p gemini: seconds of audio out x the per-minute price", async () => {
    process.env.GOOGLE_API_KEY = "AIza-fake";
    const { exitCode, result } = await runCli(generate(registerNarrationCommand), ["narration", TEXT, "-p", "gemini", "-o", join(dir, "n.wav")]);

    expect(exitCode).toBeUndefined();
    // The fake Gemini reply is 0.1 s of 24 kHz mono PCM.
    const price = listPrice("gemini", "speech", "gemini-3.8-flash-tts");
    expect(price.per).toBe("minute");
    expect(result.costUsd).toBe(roundUsd((0.1 / 60) * price.usd));
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result).not.toHaveProperty("costEstimated");
  });

  it("-p elevenlabs: characters x the per-1K-character price", async () => {
    process.env.ELEVENLABS_API_KEY = "test-elevenlabs";
    const { result } = await runCli(generate(registerNarrationCommand), ["narration", TEXT, "-p", "elevenlabs", "-o", join(dir, "n.mp3")]);

    const price = listPrice("elevenlabs", "speech", "eleven_v3");
    expect(price.per).toBe("1K characters");
    expect(result.costUsd).toBe(roundUsd((TEXT.length / 1000) * price.usd));
    expect(result).not.toHaveProperty("costEstimated");
  });

  it("-p openai (gpt-4o-mini-tts, unpriced): the tier upper bound, flagged as an estimate", async () => {
    process.env.OPENAI_API_KEY = "test-openai";
    net.on("POST", "api.openai.com", /^\/v1\/audio\/speech$/, () => new Response(Buffer.from("ID3fake"), { headers: { "content-type": "audio/mpeg" } }));
    const { result } = await runCli(generate(registerNarrationCommand), ["narration", TEXT, "-p", "openai", "-o", join(dir, "n.mp3")]);

    expect(result.costUsd).toBe(lookupCostEstimateUpperBound("generate narration"));
    expect(result.costEstimated).toBe(true);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining("no list price for openai gpt-4o-mini-tts")]));
  });

  it("a dry run still reports the tier upper bound, not metered usage", async () => {
    process.env.ELEVENLABS_API_KEY = "test-elevenlabs";
    const { result } = await runCli(generate(registerNarrationCommand), ["narration", TEXT, "-p", "elevenlabs", "--dry-run"]);
    expect(result).toMatchObject({ dryRun: true, costUsd: lookupCostEstimateUpperBound("generate narration") });
    expect(net.requests).toHaveLength(0);
  });
});

describe("vibe generate music and sound-effect", () => {
  it("music: requested seconds x the per-minute price", async () => {
    process.env.ELEVENLABS_API_KEY = "test-elevenlabs";
    const { result } = await runCli(generate(registerMusicCommand), ["music", "calm piano", "-d", "12", "-o", join(dir, "m.mp3")]);

    const price = listPrice("elevenlabs", "music", "music_v2_5");
    expect(result.costUsd).toBe(roundUsd((12 / 60) * price.usd));
  });

  it("sound-effect with an explicit duration: that many seconds x the per-minute price", async () => {
    process.env.ELEVENLABS_API_KEY = "test-elevenlabs";
    const { result } = await runCli(generate(registerSoundEffectCommand), ["sound-effect", "door slam", "-d", "3", "-o", join(dir, "s.mp3")]);

    const price = listPrice("elevenlabs", "sound-effect", "eleven_text_to_sound_v2");
    expect(result.costUsd).toBe(roundUsd((3 / 60) * price.usd));
  });
});

describe("vibe audio transcribe", () => {
  let audio: string;
  beforeEach(() => {
    audio = join(dir, "talk.wav");
    writeFileSync(audio, Buffer.from("RIFF\0\0\0\0WAVEfmt fake-pcm", "latin1"));
  });

  it("-p elevenlabs: the billed audio_duration_secs x the per-hour price", async () => {
    process.env.ELEVENLABS_API_KEY = "test-elevenlabs";
    const { exitCode, result } = await runCli(audioCommand, ["transcribe", audio, "-p", "elevenlabs", "-o", join(dir, "a.srt")]);

    expect(exitCode).toBeUndefined();
    const price = listPrice("elevenlabs", "transcription", "scribe_v2");
    expect(price.per).toBe("hour");
    expect(result.costUsd).toBe(roundUsd((4.2 / 3600) * price.usd));
    expect(result).not.toHaveProperty("costEstimated");
  });

  it("-p openai: Whisper's reported duration x the per-minute price", async () => {
    process.env.OPENAI_API_KEY = "test-openai";
    const { result } = await runCli(audioCommand, ["transcribe", audio, "-p", "openai", "-o", join(dir, "b.srt")]);

    const price = listPrice("openai", "transcription", "whisper-1");
    expect(result.costUsd).toBe(roundUsd((4.2 / 60) * price.usd));
  });

  it("falls back to the last word, flagged as an estimate, when the provider sends no duration", async () => {
    process.env.ELEVENLABS_API_KEY = "test-elevenlabs";
    const { FAKE_SCRIBE_TRANSCRIPT, jsonResponse } = await import("../testing/fake-provider-network.js");
    const withoutDuration: Partial<typeof FAKE_SCRIBE_TRANSCRIPT> = { ...FAKE_SCRIBE_TRANSCRIPT };
    delete withoutDuration.audio_duration_secs;
    net.on("POST", "api.elevenlabs.io", /^\/v1\/speech-to-text$/, () => jsonResponse(withoutDuration));
    const { result } = await runCli(audioCommand, ["transcribe", audio, "-p", "elevenlabs", "-o", join(dir, "c.srt")]);

    const price = listPrice("elevenlabs", "transcription", "scribe_v2");
    expect(result.costUsd).toBe(roundUsd((3.7 / 3600) * price.usd));
    expect(result.costEstimated).toBe(true);
  });
});

describe("MCP tool results", () => {
  const dispatch = buildMcpDispatcher(manifest);
  async function call(name: string, args: Record<string, unknown>) {
    const reply = await dispatch(name, args);
    return JSON.parse(reply.content[0].text) as Record<string, unknown>;
  }

  it("generate_narration carries data.costUsd from the metered call", async () => {
    process.env.ELEVENLABS_API_KEY = "test-elevenlabs";
    const data = await call("generate_narration", { text: TEXT, provider: "elevenlabs", output: join(dir, "n.mp3") });
    expect(data.success).toBe(true);
    expect(data.costUsd).toBe(roundUsd((TEXT.length / 1000) * listPrice("elevenlabs", "speech", "eleven_v3").usd));
  });

  it("audio_transcribe carries data.costUsd, and concurrent calls never mix costs", async () => {
    process.env.ELEVENLABS_API_KEY = "test-elevenlabs";
    process.env.OPENAI_API_KEY = "test-openai";
    const audio = join(dir, "talk.wav");
    writeFileSync(audio, Buffer.from("RIFF\0\0\0\0WAVEfmt fake-pcm", "latin1"));
    const [scribe, narration] = await Promise.all([
      call("audio_transcribe", { audioPath: audio, provider: "elevenlabs", output: join(dir, "a.srt") }),
      call("generate_narration", { text: TEXT, provider: "elevenlabs", output: join(dir, "n2.mp3") }),
    ]);
    expect(scribe.costUsd).toBe(roundUsd((4.2 / 3600) * listPrice("elevenlabs", "transcription", "scribe_v2").usd));
    expect(narration.costUsd).toBe(roundUsd((TEXT.length / 1000) * listPrice("elevenlabs", "speech", "eleven_v3").usd));
  });

  it("free tools gain no cost field", async () => {
    const data = await call("scene_list_styles", {});
    expect(data).not.toHaveProperty("costUsd");
  });
});

describe("YAML pipeline budget", () => {
  it("counts a metered step at its actual cost instead of the tier upper bound", async () => {
    process.env.ELEVENLABS_API_KEY = "test-elevenlabs";
    const result = await executePipeline(
      {
        name: "cost",
        budget: { costUsd: 1 },
        steps: [{ id: "voice", action: "generate-tts", text: TEXT, provider: "elevenlabs" }],
      },
      { outputDir: join(dir, "out") },
    );

    const actual = roundUsd((TEXT.length / 1000) * listPrice("elevenlabs", "speech", "eleven_v3").usd);
    expect(result.success).toBe(true);
    expect(result.steps[0]).toMatchObject({ id: "voice", success: true, costUsd: actual });
    expect(result.steps[0]).not.toHaveProperty("costEstimated");
    expect(result.budget?.estimatedCostUsd).toBe(actual);
    expect(actual).toBeLessThan(lookupCostEstimateUpperBound("generate narration"));
  });

  it("counts what a failed step was billed", async () => {
    process.env.ELEVENLABS_API_KEY = "test-elevenlabs";
    const result = await executePipeline(
      {
        name: "cost-fail",
        budget: { costUsd: 1 },
        // The speech is billed, then the write fails: /dev/null is not a directory.
        steps: [{ id: "voice", action: "generate-tts", text: TEXT, provider: "elevenlabs", output: "/dev/null/voice.mp3" }],
      },
      { outputDir: join(dir, "out") },
    );

    const billed = roundUsd((TEXT.length / 1000) * listPrice("elevenlabs", "speech", "eleven_v3").usd);
    expect(result.steps[0]).toMatchObject({ success: false, costUsd: billed });
    expect(result.budget?.estimatedCostUsd).toBe(billed);
  });

  it("a dry run prices each step at its upper bound", async () => {
    const result = await executePipeline(
      { name: "cost-dry", steps: [{ id: "voice", action: "generate-tts", text: TEXT }] },
      { outputDir: join(dir, "out"), dryRun: true },
    );
    expect(result.steps[0]).toMatchObject({ costUsd: lookupCostEstimateUpperBound("generate narration"), costEstimated: true });
    expect(net.requests).toHaveLength(0);
  });
});
