/**
 * Transcription provider selection: `auto` follows the registry's
 * transcription priority (ElevenLabs Scribe, then OpenAI Whisper) over the
 * keys that are configured, a named provider needs its own key, and a
 * missing key is an `ApiKeyError` before any request.
 */

import { afterEach, describe, expect, it } from "vitest";

import { ApiKeyError } from "../../utils/api-key-error.js";
import { findSttProvider, parseSttProviderName, resolveSttProvider } from "./transcription.js";

const savedEnv = { ...process.env };

function keys(env: { ELEVENLABS_API_KEY?: string; OPENAI_API_KEY?: string }): void {
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.OPENAI_API_KEY;
  Object.assign(process.env, env);
}

afterEach(() => {
  process.env = { ...savedEnv };
});

describe("parseSttProviderName", () => {
  it("defaults to auto and accepts the provider ids", () => {
    expect(parseSttProviderName(undefined)).toBe("auto");
    expect(parseSttProviderName("")).toBe("auto");
    expect(parseSttProviderName("elevenlabs")).toBe("elevenlabs");
    expect(parseSttProviderName("openai")).toBe("openai");
  });

  it("rejects anything else", () => {
    expect(() => parseSttProviderName("whisper")).toThrow(/Valid: auto, elevenlabs, openai/);
  });
});

describe("auto selection", () => {
  it("prefers ElevenLabs Scribe when both keys are set", async () => {
    keys({ ELEVENLABS_API_KEY: "xi", OPENAI_API_KEY: "sk" });
    expect(await resolveSttProvider("auto")).toEqual({ provider: "elevenlabs", apiKey: "xi" });
    expect(await resolveSttProvider(undefined)).toEqual({ provider: "elevenlabs", apiKey: "xi" });
  });

  it("falls back to OpenAI Whisper with only an OpenAI key", async () => {
    keys({ OPENAI_API_KEY: "sk" });
    expect(await resolveSttProvider("auto")).toEqual({ provider: "openai", apiKey: "sk" });
  });

  it("takes an explicit key under auto as an OpenAI key, as --api-key always meant", async () => {
    keys({ ELEVENLABS_API_KEY: "xi" });
    expect(await resolveSttProvider("auto", { apiKey: "sk-flag" })).toEqual({ provider: "openai", apiKey: "sk-flag" });
  });

  it("with no key is undefined from find and an ApiKeyError naming both keys from resolve", async () => {
    keys({});
    expect(await findSttProvider("auto")).toBeUndefined();
    const error = await resolveSttProvider("auto").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiKeyError);
    expect((error as ApiKeyError).toStructured()).toMatchObject({
      code: "API_KEY_MISSING",
      suggestion: expect.stringContaining("Set ELEVENLABS_API_KEY or OPENAI_API_KEY in .env"),
    });
  });
});

describe("a named provider", () => {
  it("uses its own key even when auto would pick the other", async () => {
    keys({ ELEVENLABS_API_KEY: "xi", OPENAI_API_KEY: "sk" });
    expect(await resolveSttProvider("openai")).toEqual({ provider: "openai", apiKey: "sk" });
  });

  it("without its key throws for that key, not a fallback", async () => {
    keys({ OPENAI_API_KEY: "sk" });
    const error = await resolveSttProvider("elevenlabs").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiKeyError);
    expect((error as ApiKeyError).envVar).toBe("ELEVENLABS_API_KEY");
  });

  it("takes an explicit key for itself", async () => {
    keys({});
    expect(await resolveSttProvider("elevenlabs", { apiKey: "xi-flag" })).toEqual({ provider: "elevenlabs", apiKey: "xi-flag" });
  });
});
