/**
 * `vibe generate narration -p gemini` end to end over the fake provider
 * network: the real GeminiTtsProvider, `providerRequest`, and the file write
 * run; only `fetch` is replaced. The same path backs the MCP tool.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeProviderNetwork, jsonResponse, type FakeProviderNetwork } from "../../testing/fake-provider-network.js";
import { manifest } from "../../tools/manifest/index.js";
import { ApiKeyError } from "../../utils/api-key.js";
import { registerNarrationCommand } from "./speech.js";

const GEMINI = "generativelanguage.googleapis.com";

let dir: string;
let net: FakeProviderNetwork;
const savedEnv = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vibe-narration-gemini-"));
  for (const key of ["ELEVENLABS_API_KEY", "OPENAI_API_KEY"]) delete process.env[key];
  process.env.GOOGLE_API_KEY = "AIza-fake";
  net = createFakeProviderNetwork();
  net.install();
});

afterEach(() => {
  net.uninstall();
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Run `vibe generate narration <args> --json` in process and read back the
 * exit code and JSON envelopes. A fresh command each time: commander keeps
 * option values between parses.
 */
async function narrate(args: string[]) {
  const command = new Command("generate");
  registerNarrationCommand(command);
  args = ["narration", ...args];
  process.env.VIBE_JSON_OUTPUT = "1";
  let exitCode: number | undefined;
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exitCode ??= code;
    throw new Error("process.exit");
  }) as never);
  const stdout: string[] = [];
  const stderr: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    stdout.push(parts.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    stderr.push(parts.map(String).join(" "));
  });
  await command.parseAsync(args, { from: "user" }).catch((error: unknown) => {
    if (!(error instanceof Error && error.message === "process.exit")) throw error;
  });
  const json = (lines: string[]) => {
    const line = lines.find((l) => l.trimStart().startsWith("{"));
    return line ? (JSON.parse(line) as Record<string, unknown>) : {};
  };
  return { exitCode, result: json(stdout), error: json(stderr) };
}

function readWav(path: string) {
  const wav = readFileSync(path);
  return {
    riff: wav.toString("ascii", 0, 4),
    wave: wav.toString("ascii", 8, 12),
    format: wav.readUInt16LE(20),
    channels: wav.readUInt16LE(22),
    sampleRate: wav.readUInt32LE(24),
    bitsPerSample: wav.readUInt16LE(34),
    dataBytes: wav.readUInt32LE(40),
    size: wav.length,
  };
}

describe("vibe generate narration -p gemini", () => {
  it("writes a 24 kHz mono 16-bit WAV through the real request path", async () => {
    const { exitCode, result } = await narrate(["A paper boat drifts.", "-p", "gemini", "--voice", "charon", "-o", join(dir, "narration.wav")]);

    expect(exitCode).toBeUndefined();
    expect(result).toMatchObject({
      command: "generate narration",
      data: { provider: "gemini", model: "gemini-3.8-flash-tts", outputPath: join(dir, "narration.wav") },
    });
    expect(readWav(join(dir, "narration.wav"))).toEqual({
      riff: "RIFF",
      wave: "WAVE",
      format: 1,
      channels: 1,
      sampleRate: 24000,
      bitsPerSample: 16,
      dataBytes: 4800,
      size: 44 + 4800,
    });

    const [request] = net.to(GEMINI);
    expect(request.path).toBe("/v1beta/interactions");
    expect(request.url).not.toContain("AIza-fake");
    expect(request.headers["x-goog-api-key"]).toBe("AIza-fake");
    expect(request.body).toMatchObject({
      model: "gemini-3.8-flash-tts",
      generation_config: { speech_config: [{ voice: "Charon" }] },
    });
  });

  it("is what --tts auto picks when the Google key is the only one", async () => {
    const { result } = await narrate(["Hello.", "-p", "auto", "-o", join(dir, "auto.wav")]);
    expect(result).toMatchObject({ data: { provider: "gemini" } });
  });

  it("refuses an unknown voice as a usage error listing the valid ones, before any request", async () => {
    const { exitCode, error } = await narrate(["Hello.", "-p", "gemini", "--voice", "rachel", "-o", join(dir, "narration.wav")]);

    expect(exitCode).toBe(2);
    expect(error).toMatchObject({ success: false, code: "USAGE_ERROR", errorKind: "invalid-request" });
    expect(String(error.error)).toMatch(/Unknown Gemini voice "rachel"\. Available voices: Zephyr, Puck/);
    expect(net.to(GEMINI)).toHaveLength(0);
  });

  it("refuses an unknown provider naming the --provider flag", async () => {
    const { exitCode, error } = await narrate(["Hello.", "-p", "azure"]);

    expect(exitCode).toBe(2);
    expect(error).toMatchObject({ code: "USAGE_ERROR", error: "Invalid --provider: azure. Valid: auto, elevenlabs, gemini, openai, kokoro." });
  });

  it("reports a rejected key as AUTH_ERROR (exit 4) with Google's message, and writes nothing", async () => {
    // Interactions wraps its error in an array (probe 2026-10-28).
    net.on("POST", GEMINI, /^\/v1beta\/interactions$/, () =>
      jsonResponse(
        [{ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }],
        400
      )
    );
    const { exitCode, error } = await narrate(["Hello.", "-p", "gemini", "-o", join(dir, "narration.wav")]);

    expect(exitCode).toBe(4);
    expect(error).toMatchObject({
      success: false,
      code: "AUTH_ERROR",
      errorKind: "auth",
      error: "POST /v1beta/interactions -> 400: API key not valid. Please pass a valid API key.",
    });
    expect(() => readFileSync(join(dir, "narration.wav"))).toThrow();
  });

  it("names GOOGLE_API_KEY when the key is missing", async () => {
    delete process.env.GOOGLE_API_KEY;
    // The CLI entry point turns an ApiKeyError into API_KEY_MISSING (exit 4).
    const error = await narrate(["Hello.", "-p", "gemini", "-o", join(dir, "narration.wav")]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiKeyError);
    expect(error).toMatchObject({ envVar: "GOOGLE_API_KEY" });
    expect((error as ApiKeyError).toStructured()).toMatchObject({ code: "API_KEY_MISSING", exitCode: 4 });
    expect(net.to(GEMINI)).toHaveLength(0);
  });

  it("the MCP generate_narration tool takes provider gemini and saves in the workspace without overwriting", async () => {
    const tool = manifest.find((entry) => entry.name === "generate_narration")!;
    const speak = () =>
      tool.execute(tool.schema.parse({ text: "Hello.", provider: "gemini" }), { workingDirectory: dir, surface: "mcp" });

    expect(await speak()).toMatchObject({ success: true, data: { outputPath: join(dir, "narration.wav"), provider: "gemini" } });
    expect(await speak()).toMatchObject({ success: true, data: { outputPath: join(dir, "narration-2.wav") } });
    expect(readWav(join(dir, "narration-2.wav")).riff).toBe("RIFF");
  });
});
