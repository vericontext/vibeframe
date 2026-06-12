/**
 * Unit tests for the TTS router. The actual provider classes are mocked at
 * the module level so we can drive resolution outcomes deterministically.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above imports — so any references must come
// from vi.hoisted (which is also hoisted) rather than module-scope variables.
const mocks = vi.hoisted(() => {
  return {
    elevenLabsTextToSpeech: vi.fn(),
    elevenLabsInitialize: vi.fn(),
    openAiTextToSpeech: vi.fn(),
    openAiInitialize: vi.fn(),
    kokoroTextToSpeech: vi.fn(),
    kokoroInitialize: vi.fn(),
    getConfiguredApiKey: vi.fn(),
    getApiKey: vi.fn(),
  };
});

vi.mock("@vibeframe/ai-providers", () => ({
  ElevenLabsProvider: class {
    initialize = mocks.elevenLabsInitialize;
    textToSpeech = mocks.elevenLabsTextToSpeech;
  },
  OpenAiTtsProvider: class {
    initialize = mocks.openAiInitialize;
    textToSpeech = mocks.openAiTextToSpeech;
  },
  KokoroProvider: class {
    initialize = mocks.kokoroInitialize;
    textToSpeech = mocks.kokoroTextToSpeech;
  },
}));

vi.mock("../../utils/api-key.js", () => ({
  getConfiguredApiKey: (...args: unknown[]) => mocks.getConfiguredApiKey(...args),
  getApiKey: (...args: unknown[]) => mocks.getApiKey(...args),
}));

const {
  elevenLabsTextToSpeech,
  elevenLabsInitialize,
  openAiTextToSpeech,
  openAiInitialize,
  kokoroTextToSpeech,
  kokoroInitialize,
  getConfiguredApiKey,
  getApiKey,
} = mocks;

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
    elevenLabsTextToSpeech.mockReset();
    elevenLabsInitialize.mockReset();
    openAiTextToSpeech.mockReset();
    openAiInitialize.mockReset();
    kokoroTextToSpeech.mockReset();
    kokoroInitialize.mockReset();
    getConfiguredApiKey.mockReset();
    getApiKey.mockReset();
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
      expect(elevenLabsInitialize).toHaveBeenCalledWith({ apiKey: "sk-test" });
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
      expect(openAiInitialize).toHaveBeenCalledWith({ apiKey: "sk-openai" });
    });

    it("prefers ElevenLabs over OpenAI when both keys are set", async () => {
      getConfiguredApiKey.mockResolvedValue("sk-both");
      getApiKey.mockResolvedValue("sk-both");

      const r = await resolveTtsProvider("auto");

      expect(r.provider).toBe("elevenlabs");
      expect(openAiInitialize).not.toHaveBeenCalled();
    });

    it("falls back to Kokoro when no key is set", async () => {
      getConfiguredApiKey.mockResolvedValue(undefined);

      const r = await resolveTtsProvider("auto");

      expect(r.provider).toBe("kokoro");
      expect(r.audioExtension).toBe("wav");
      expect(kokoroInitialize).toHaveBeenCalled();
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
      expect(openAiInitialize).toHaveBeenCalledWith({ apiKey: "sk-real" });
      expect(getConfiguredApiKey).not.toHaveBeenCalled();
    });

    it("throws TtsKeyMissingError when key is absent", async () => {
      getApiKey.mockResolvedValue(undefined);

      await expect(resolveTtsProvider("openai")).rejects.toBeInstanceOf(
        TtsKeyMissingError,
      );
      expect(kokoroInitialize).not.toHaveBeenCalled();
    });
  });

  describe("explicit elevenlabs", () => {
    it("uses ElevenLabs when key is present", async () => {
      getApiKey.mockResolvedValue("sk-real");

      const r = await resolveTtsProvider("elevenlabs");

      expect(r.provider).toBe("elevenlabs");
      expect(elevenLabsInitialize).toHaveBeenCalledWith({ apiKey: "sk-real" });
    });

    it("throws TtsKeyMissingError when key is absent", async () => {
      getApiKey.mockResolvedValue(undefined);

      await expect(resolveTtsProvider("elevenlabs")).rejects.toBeInstanceOf(
        TtsKeyMissingError,
      );
      expect(kokoroInitialize).not.toHaveBeenCalled();
    });
  });

  describe("explicit kokoro", () => {
    it("uses Kokoro without checking any key", async () => {
      const r = await resolveTtsProvider("kokoro");

      expect(r.provider).toBe("kokoro");
      expect(r.audioExtension).toBe("wav");
      expect(kokoroInitialize).toHaveBeenCalled();
      expect(getApiKey).not.toHaveBeenCalled();
      expect(getConfiguredApiKey).not.toHaveBeenCalled();
    });
  });

  describe("call dispatch", () => {
    it("forwards voice + speed to ElevenLabs as voiceId/speed", async () => {
      getConfiguredApiKey.mockResolvedValue("sk-test");
      getApiKey.mockResolvedValue("sk-test");
      elevenLabsTextToSpeech.mockResolvedValue({ success: true, audioBuffer: Buffer.from("x") });

      const r = await resolveTtsProvider("elevenlabs");
      await r.call("Hello.", { voice: "rachel", speed: 1.1 });

      expect(elevenLabsTextToSpeech).toHaveBeenCalledWith("Hello.", {
        voiceId: "rachel",
        speed: 1.1,
      });
    });

    it("forwards voice + speed to OpenAI", async () => {
      getApiKey.mockResolvedValue("sk-test");
      openAiTextToSpeech.mockResolvedValue({ success: true, audioBuffer: Buffer.from("z") });

      const r = await resolveTtsProvider("openai");
      await r.call("Hello.", { voice: "marin", speed: 1.05 });

      expect(openAiTextToSpeech).toHaveBeenCalledWith("Hello.", {
        voice: "marin",
        speed: 1.05,
      });
    });

    it("forwards voice + speed + onProgress to Kokoro", async () => {
      kokoroTextToSpeech.mockResolvedValue({ success: true, audioBuffer: Buffer.from("y") });

      const r = await resolveTtsProvider("kokoro");
      const onProgress = vi.fn();
      await r.call("Hello.", { voice: "af_heart", speed: 1.0, onProgress });

      expect(kokoroTextToSpeech).toHaveBeenCalledWith("Hello.", {
        voice: "af_heart",
        speed: 1.0,
        onProgress,
      });
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
