/**
 * OpenAI TTS shuts down 2027-01-06 and whisper-1 on 2027-02-26. Until then
 * they still work, and every result made with them says so: the warning
 * names the shutdown date and the replacement, on narration and on
 * transcription. Results from the replacements carry no warning.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bytesResponse, createFakeProviderNetwork, type FakeProviderNetwork } from "../testing/fake-provider-network.js";
import { executeTranscribe } from "./ai-audio.js";
import { executeSpeech } from "./generate/speech.js";

let dir: string;
let net: FakeProviderNetwork;
const savedEnv = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vibe-retiring-audio-"));
  writeFileSync(join(dir, "speech.wav"), Buffer.from("RIFF0000WAVEfmt "));
  net = createFakeProviderNetwork().on("POST", "api.openai.com", /^\/v1\/audio\/speech$/, () =>
    bytesResponse(Buffer.from([0xff, 0xfb, 0x90, 0x00]), "audio/mpeg")
  );
  net.install();
  Object.assign(process.env, { OPENAI_API_KEY: "test-openai", ELEVENLABS_API_KEY: "test-elevenlabs", GOOGLE_API_KEY: "test-google" });
});

afterEach(() => {
  net.uninstall();
  process.env = { ...savedEnv };
  rmSync(dir, { recursive: true, force: true });
});

describe("results made with retiring OpenAI audio models carry a shutdown warning", () => {
  it("narration with OpenAI TTS names the shutdown date and the replacements", async () => {
    const result = await executeSpeech({ text: "Hello there.", provider: "openai", cwd: dir });

    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0]).toContain("shuts down on 2027-01-06");
    expect(result.warnings![0]).toContain("--tts gemini");
  });

  it("narration with Gemini TTS carries no warning", async () => {
    const result = await executeSpeech({ text: "Hello there.", provider: "gemini", cwd: dir });

    expect(result.success).toBe(true);
    expect(result.warnings).toBeUndefined();
  });

  it("transcription with Whisper names the shutdown date and Scribe", async () => {
    const result = await executeTranscribe({ audioPath: join(dir, "speech.wav"), provider: "openai" });

    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0]).toContain("shuts down on 2027-02-26");
    expect(result.warnings![0]).toContain("--stt elevenlabs");
  });

  it("transcription with Scribe carries no warning", async () => {
    const result = await executeTranscribe({ audioPath: join(dir, "speech.wav"), provider: "elevenlabs" });

    expect(result.success).toBe(true);
    expect(result.warnings).toBeUndefined();
  });
});
