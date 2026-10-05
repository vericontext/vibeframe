import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeProviderNetwork, jsonResponse } from "../testing/fake-provider-network.js";
import { audioFilename } from "./contract.js";
import { createTranscriber } from "./registry.js";

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (s: string) => new Uint8Array(Buffer.from(s, "latin1"));

describe("audioFilename", () => {
  it("names the upload by the container in the bytes", () => {
    expect(audioFilename(text("RIFF\0\0\0\0WAVEfmt "))).toBe("audio.wav");
    expect(audioFilename(text("ID3\x04\0\0"))).toBe("audio.mp3");
    expect(audioFilename(bytes(0xff, 0xfb, 0x90, 0x00))).toBe("audio.mp3");
    expect(audioFilename(text("\0\0\0\x20ftypM4A "))).toBe("audio.m4a");
    expect(audioFilename(text("OggS\0\x02"))).toBe("audio.ogg");
    expect(audioFilename(text("fLaC\0\0"))).toBe("audio.flac");
    expect(audioFilename(bytes(0x1a, 0x45, 0xdf, 0xa3))).toBe("audio.webm");
  });
});

describe("Whisper transcription contract", () => {
  let net: FakeProviderNetwork;
  beforeEach(() => {
    net = new FakeProviderNetwork();
    net.install();
  });
  afterEach(() => net.uninstall());

  const reply = {
    text: "A paper boat drifts.",
    language: "english",
    segments: [{ id: 0, start: 0, end: 1.8, text: " A paper boat drifts." }],
    words: [{ word: "A", start: 0, end: 0.2 }, { word: "paper", start: 0.2, end: 0.6 }],
  };

  it("transcribes with word timings on the catalog's default model", async () => {
    net.on("POST", "api.openai.com", /^\/v1\/audio\/transcriptions$/, () => jsonResponse(reply));
    const whisper = await createTranscriber("openai", "k");

    const result = await whisper.transcribeAudio({ audio: text("RIFF\0\0\0\0WAVE"), granularity: "both", language: "en" });

    expect(result).toMatchObject({ text: "A paper boat drifts.", language: "english", model: "whisper-1" });
    expect(result.segments?.[0]).toMatchObject({ startTime: 0, endTime: 1.8, text: "A paper boat drifts." });
    expect(result.words).toEqual([{ text: "A", start: 0, end: 0.2 }, { text: "paper", start: 0.2, end: 0.6 }]);
  });

  it("refuses audio over 25 MB before sending", async () => {
    const whisper = await createTranscriber("openai", "k");
    await expect(whisper.transcribeAudio({ audio: new Uint8Array(26 * 1024 * 1024) })).rejects.toMatchObject({
      kind: "invalid-request",
    });
    expect(net.requests).toHaveLength(0);
  });

  it("classifies a bad key", async () => {
    net.on("POST", "api.openai.com", /transcriptions$/, () => jsonResponse({ error: { message: "Incorrect API key provided" } }, 401));
    const whisper = await createTranscriber("openai", "k");
    await expect(whisper.transcribeAudio({ audio: text("ID3") })).rejects.toMatchObject({ kind: "auth" });
  });

  it("refuses an unknown provider", async () => {
    await expect(createTranscriber("deepgram", "k")).rejects.toMatchObject({ kind: "invalid-request" });
  });
});
