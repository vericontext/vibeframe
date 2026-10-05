/**
 * Unit tests for the TTS router. The actual provider classes are mocked at
 * the module level so we can drive resolution outcomes deterministically.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above imports — so any references must come
// from vi.hoisted (which is also hoisted) rather than module-scope variables.
const mocks = vi.hoisted(() => {
  return {
    createSpeechGenerator: vi.fn(),
    synthesize: vi.fn(),
    getConfiguredApiKey: vi.fn(),
    getApiKey: vi.fn(),
  };
});

vi.mock("@vibeframe/ai-providers", () => ({
  createSpeechGenerator: (...args: unknown[]) => mocks.createSpeechGenerator(...args),
  isProviderError: () => false,
}));

vi.mock("../../utils/api-key.js", () => ({
  getConfiguredApiKey: (...args: unknown[]) => mocks.getConfiguredApiKey(...args),
  getApiKey: (...args: unknown[]) => mocks.getApiKey(...args),
}));

const { createSpeechGenerator, synthesize, getConfiguredApiKey, getApiKey } = mocks;

import {
  parseTtsProviderName,
  resolveTtsProvider,
  TtsKeyMissingError,
} from "./tts-resolve.js";

describe("parseTtsProviderName", () => {
  it("defaults to auto when undefined or empty", () => {
    expect(parseTtsProviderName(undefined)).toBe("auto");
    expect(parseTtsProviderName("")).toBe("auto");
  });

  it("accepts the four valid values", () => {
    expect(parseTtsProviderName("auto")).toBe("auto");
    expect(parseTtsProviderName("elevenlabs")).toBe("elevenlabs");
    expect(parseTtsProviderName("openai")).toBe("openai");
    expect(parseTtsProviderName("kokoro")).toBe("kokoro");
  });

  it("throws for unknown providers", () => {
    expect(() => parseTtsProviderName("azure")).toThrow(/Invalid --tts/);
    expect(() => parseTtsProviderName("KOKORO")).toThrow(/Invalid --tts/);
  });
});

describe("resolveTtsProvider", () => {
  beforeEach(() => {
    createSpeechGenerator.mockReset();
    synthesize.mockReset();
    getConfiguredApiKey.mockReset();
    getApiKey.mockReset();
    createSpeechGenerator.mockImplementation(async (provider: string) => ({ speechProvider: provider, synthesize }));
    synthesize.mockResolvedValue({ bytes: new Uint8Array([1]), mimeType: "audio/mpeg", extension: "mp3", model: "m", characters: 6 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("auto", () => {
    it("picks ElevenLabs when ELEVENLABS_API_KEY is set", async () => {
      getConfiguredApiKey.mockResolvedValue("sk-test");
      getApiKey.mockResolvedValue("sk-test");

      const r = await resolveTtsProvider("auto");

      expect(r.provider).toBe("elevenlabs");
      expect(r.audioExtension).toBe("mp3");
      expect(getConfiguredApiKey).toHaveBeenCalledWith("ELEVENLABS_API_KEY");
      expect(createSpeechGenerator).toHaveBeenCalledWith("elevenlabs", "sk-test");
    });

    it("picks OpenAI when only OPENAI_API_KEY is set", async () => {
      getConfiguredApiKey.mockImplementation(async (envVar: unknown) =>
        envVar === "OPENAI_API_KEY" ? "sk-openai" : undefined,
      );
      getApiKey.mockResolvedValue("sk-openai");

      const r = await resolveTtsProvider("auto");

      expect(r.provider).toBe("openai");
      expect(r.audioExtension).toBe("mp3");
      expect(getConfiguredApiKey).toHaveBeenCalledWith("ELEVENLABS_API_KEY");
      expect(getConfiguredApiKey).toHaveBeenCalledWith("OPENAI_API_KEY");
      expect(createSpeechGenerator).toHaveBeenCalledWith("openai", "sk-openai");
    });

    it("prefers ElevenLabs over OpenAI when both keys are set", async () => {
      getConfiguredApiKey.mockResolvedValue("sk-both");
      getApiKey.mockResolvedValue("sk-both");

      const r = await resolveTtsProvider("auto");

      expect(r.provider).toBe("elevenlabs");
      expect(createSpeechGenerator).not.toHaveBeenCalledWith("openai", expect.anything());
    });

    it("falls back to Kokoro when no key is set", async () => {
      getConfiguredApiKey.mockResolvedValue(undefined);

      const r = await resolveTtsProvider("auto");

      expect(r.provider).toBe("kokoro");
      expect(r.audioExtension).toBe("wav");
      expect(createSpeechGenerator).toHaveBeenCalledWith("kokoro", undefined);
      expect(getApiKey).not.toHaveBeenCalled();
    });

    it("treats undefined preferred the same as auto", async () => {
      getConfiguredApiKey.mockResolvedValue(undefined);

      const r = await resolveTtsProvider();

      expect(r.provider).toBe("kokoro");
    });
  });

  describe("explicit openai", () => {
    it("uses OpenAI when key is present", async () => {
      getApiKey.mockResolvedValue("sk-real");

      const r = await resolveTtsProvider("openai");

      expect(r.provider).toBe("openai");
      expect(r.audioExtension).toBe("mp3");
      expect(createSpeechGenerator).toHaveBeenCalledWith("openai", "sk-real");
      expect(getConfiguredApiKey).not.toHaveBeenCalled();
    });

    it("throws TtsKeyMissingError when key is absent", async () => {
      getApiKey.mockResolvedValue(undefined);

      await expect(resolveTtsProvider("openai")).rejects.toBeInstanceOf(
        TtsKeyMissingError,
      );
      expect(createSpeechGenerator).not.toHaveBeenCalled();
    });
  });

  describe("explicit elevenlabs", () => {
    it("uses ElevenLabs when key is present", async () => {
      getApiKey.mockResolvedValue("sk-real");

      const r = await resolveTtsProvider("elevenlabs");

      expect(r.provider).toBe("elevenlabs");
      expect(createSpeechGenerator).toHaveBeenCalledWith("elevenlabs", "sk-real");
    });

    it("throws TtsKeyMissingError when key is absent", async () => {
      getApiKey.mockResolvedValue(undefined);

      await expect(resolveTtsProvider("elevenlabs")).rejects.toBeInstanceOf(
        TtsKeyMissingError,
      );
      expect(createSpeechGenerator).not.toHaveBeenCalled();
    });
  });

  describe("explicit kokoro", () => {
    it("uses Kokoro without checking any key", async () => {
      const r = await resolveTtsProvider("kokoro");

      expect(r.provider).toBe("kokoro");
      expect(r.audioExtension).toBe("wav");
      expect(createSpeechGenerator).toHaveBeenCalledWith("kokoro", undefined);
      expect(getApiKey).not.toHaveBeenCalled();
      expect(getConfiguredApiKey).not.toHaveBeenCalled();
    });
  });

  describe("call dispatch", () => {
    it.each([
      ["elevenlabs", "rachel", 1.1],
      ["openai", "marin", 1.05],
    ] as const)("forwards voice + speed to %s through the speech contract", async (provider, voice, speed) => {
      getApiKey.mockResolvedValue("sk-test");

      const r = await resolveTtsProvider(provider);
      const result = await r.call("Hello.", { voice, speed });

      expect(synthesize).toHaveBeenCalledWith({ text: "Hello.", voice, speed, model: undefined }, { onProgress: undefined });
      expect(result).toMatchObject({ success: true, characterCount: 6, model: "m" });
      expect(Buffer.isBuffer(result.audioBuffer)).toBe(true);
    });

    it("forwards voice + speed + onProgress to Kokoro", async () => {
      const r = await resolveTtsProvider("kokoro");
      const onProgress = vi.fn();
      await r.call("Hello.", { voice: "af_heart", speed: 1.0, onProgress });

      expect(synthesize).toHaveBeenCalledWith({ text: "Hello.", voice: "af_heart", speed: 1.0, model: undefined }, { onProgress });
    });

    it("returns a provider failure as data instead of throwing", async () => {
      synthesize.mockRejectedValue(new Error("quota exceeded"));
      const r = await resolveTtsProvider("kokoro");

      await expect(r.call("Hello.")).resolves.toMatchObject({ success: false, error: "quota exceeded" });
    });
  });
});

describe("TtsKeyMissingError", () => {
  it("provides actionable elevenlabs message", () => {
    const err = new TtsKeyMissingError("elevenlabs");
    expect(err.message).toMatch(/ELEVENLABS_API_KEY/);
    expect(err.message).toMatch(/--tts kokoro/);
    expect(err.provider).toBe("elevenlabs");
  });

  it("provides actionable openai message", () => {
    const err = new TtsKeyMissingError("openai");
    expect(err.message).toMatch(/OPENAI_API_KEY/);
    expect(err.message).toMatch(/--tts kokoro/);
    expect(err.provider).toBe("openai");
  });

  it("is identifiable via instanceof", () => {
    const err = new TtsKeyMissingError("elevenlabs");
    expect(err).toBeInstanceOf(TtsKeyMissingError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("TtsKeyMissingError");
  });
});
