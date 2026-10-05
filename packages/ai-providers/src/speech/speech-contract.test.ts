/** The speech contract over the fake provider network (Kokoro runs locally and is checked without a model). */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FAKE_MP3, FakeProviderNetwork, bytesResponse, jsonResponse } from "../testing/fake-provider-network.js";
import { ProviderError } from "../shared/errors.js";
import { createSpeechGenerator } from "./registry.js";

let net: FakeProviderNetwork;
beforeEach(() => {
  net = new FakeProviderNetwork();
  net.install();
});
afterEach(() => net.uninstall());

async function rejection(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError);
    return error as ProviderError;
  }
  throw new Error("expected a ProviderError");
}

const CLOUD = {
  elevenlabs: { host: "api.elevenlabs.io", path: /^\/v1\/text-to-speech\//, model: "eleven_v3" },
  openai: { host: "api.openai.com", path: /^\/v1\/audio\/speech$/, model: "gpt-4o-mini-tts" },
} as const;

describe.each(Object.entries(CLOUD))("%s meets the speech contract", (provider, route) => {
  it("returns MP3 bytes on its default model", async () => {
    net.on("POST", route.host, route.path, () => bytesResponse(FAKE_MP3, "audio/mpeg"));
    const tts = await createSpeechGenerator(provider, "test-key");
    const result = await tts.synthesize({ text: "A paper boat drifts." });

    expect(result).toMatchObject({ mimeType: "audio/mpeg", extension: "mp3", model: route.model, characters: 20 });
    expect(Buffer.from(result.bytes)).toEqual(FAKE_MP3);
  });

  it("refuses an unknown model and an unknown voice before sending", async () => {
    const tts = await createSpeechGenerator(provider, "test-key");
    expect((await rejection(tts.synthesize({ text: "x", model: "no-such-model" }))).kind).toBe("invalid-request");
    expect((await rejection(tts.synthesize({ text: "x", voice: "no-such-voice-xyz" }))).kind).toBe("invalid-request");
    expect(net.requests).toHaveLength(0);
  });

  it("classifies a bad key", async () => {
    net.on("POST", route.host, route.path, () => jsonResponse({ detail: { message: "Invalid API key" } }, 401));
    const tts = await createSpeechGenerator(provider, "test-key");
    expect(await rejection(tts.synthesize({ text: "x" }))).toMatchObject({ kind: "auth", status: 401 });
  });
});

describe("speech provider specifics", () => {
  it("ElevenLabs refuses text over the model's character limit before sending", async () => {
    const tts = await createSpeechGenerator("elevenlabs", "k");
    const error = await rejection(tts.synthesize({ text: "a".repeat(5_001) }));
    expect(error.message).toMatch(/eleven_v3 takes up to 5000 characters/);
    expect(net.requests).toHaveLength(0);

    net.on("POST", CLOUD.elevenlabs.host, CLOUD.elevenlabs.path, () => bytesResponse(FAKE_MP3, "audio/mpeg"));
    await expect(tts.synthesize({ text: "a".repeat(5_001), model: "flash" })).resolves.toMatchObject({ model: "eleven_flash_v2_5" });
  });

  it("ElevenLabs reads exhausted credits as quota", async () => {
    net.on("POST", CLOUD.elevenlabs.host, CLOUD.elevenlabs.path, () =>
      jsonResponse({ detail: { status: "quota_exceeded", message: "You have 0 credits remaining" } }, 401)
    );
    const tts = await createSpeechGenerator("elevenlabs", "k");
    expect(await rejection(tts.synthesize({ text: "x" }))).toMatchObject({ kind: "quota" });
  });

  it("OpenAI tts-1 accepts only its nine original voices", async () => {
    const tts = await createSpeechGenerator("openai", "k");
    const error = await rejection(tts.synthesize({ text: "x", model: "tts-1", voice: "marin" }));
    expect(error.message).toMatch(/Unknown OpenAI voice "marin" for tts-1/);
  });

  it("Kokoro needs no key and refuses empty text", async () => {
    const tts = await createSpeechGenerator("kokoro");
    expect((await rejection(tts.synthesize({ text: "  " }))).kind).toBe("invalid-request");
  });

  it("refuses an unknown provider", async () => {
    await expect(createSpeechGenerator("polly", "k")).rejects.toMatchObject({ kind: "invalid-request" });
  });
});
