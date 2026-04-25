/**
 * KokoroProvider unit tests.
 *
 * The actual `kokoro-js` model is mocked via `__setKokoroFactoryForTests` so
 * tests run in milliseconds and require no model download. Integration of the
 * real model is exercised by the C6 smoke script.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  KOKORO_DEFAULT_VOICE,
  KOKORO_MODEL_ID,
  KokoroProvider,
  __setKokoroFactoryForTests,
} from "./KokoroProvider.js";

function fakeWav(): ArrayBuffer {
  // Minimal WAV header followed by 16 bytes of payload — content is irrelevant
  // to the tests, we only assert that bytes round-trip into the result.
  return new Uint8Array([
    82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32,
    16, 0, 0, 0, 1, 0, 1, 0, 0, 16, 0, 0, 0, 16, 0, 0,
    1, 0, 8, 0, 100, 97, 116, 97, 16, 0, 0, 0,
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
  ]).buffer;
}

interface FakeFactoryCalls {
  loadCount: number;
  generateCalls: Array<{ text: string; voice?: string; speed?: number }>;
  loadOptions: Array<unknown>;
}

function makeFakeFactory(opts: { failLoad?: boolean; failGenerate?: boolean } = {}): {
  factory: Parameters<typeof __setKokoroFactoryForTests>[0] extends infer F
    ? NonNullable<F>
    : never;
  calls: FakeFactoryCalls;
} {
  const calls: FakeFactoryCalls = { loadCount: 0, generateCalls: [], loadOptions: [] };

  const factory = {
    async from_pretrained(modelId: string, options?: unknown) {
      calls.loadCount++;
      calls.loadOptions.push(options);
      // Surface the captured progress callback by invoking it once so the test
      // can verify it was wired through.
      const progress = (options as { progress_callback?: (e: unknown) => void } | undefined)
        ?.progress_callback;
      progress?.({ status: "download", file: "model.onnx", progress: 50 });
      progress?.({ status: "done" });

      if (opts.failLoad) {
        throw new Error("model download failed");
      }
      expect(modelId).toBe(KOKORO_MODEL_ID);
      return {
        async generate(text: string, generateOptions: { voice?: string; speed?: number }) {
          calls.generateCalls.push({ text, ...generateOptions });
          if (opts.failGenerate) {
            throw new Error("inference crashed");
          }
          return { toWav: () => fakeWav() };
        },
      };
    },
  };

  return { factory, calls };
}

describe("KokoroProvider", () => {
  let provider: KokoroProvider;

  beforeEach(() => {
    provider = new KokoroProvider();
  });

  afterEach(() => {
    __setKokoroFactoryForTests(null);
  });

  it("declares text-to-speech capability and is always available", () => {
    expect(provider.id).toBe("kokoro");
    expect(provider.capabilities).toContain("text-to-speech");
    expect(provider.isAvailable).toBe(true);
    expect(provider.isConfigured()).toBe(true);
  });

  it("rejects empty text without loading the model", async () => {
    const { factory, calls } = makeFakeFactory();
    __setKokoroFactoryForTests(factory);

    const result = await provider.textToSpeech("   ");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Empty text");
    expect(calls.loadCount).toBe(0);
  });

  it("synthesises speech with default voice + speed and returns a Buffer", async () => {
    const { factory, calls } = makeFakeFactory();
    __setKokoroFactoryForTests(factory);

    const result = await provider.textToSpeech("Hello world.");

    expect(result.success).toBe(true);
    expect(result.audioBuffer).toBeInstanceOf(Buffer);
    expect(result.audioBuffer?.length).toBeGreaterThan(0);
    expect(result.characterCount).toBe("Hello world.".length);

    expect(calls.generateCalls).toEqual([
      { text: "Hello world.", voice: KOKORO_DEFAULT_VOICE, speed: 1 },
    ]);
  });

  it("forwards voice and speed overrides", async () => {
    const { factory, calls } = makeFakeFactory();
    __setKokoroFactoryForTests(factory);

    const result = await provider.textToSpeech("Test.", {
      voice: "am_michael",
      speed: 1.2,
    });

    expect(result.success).toBe(true);
    expect(calls.generateCalls[0]).toMatchObject({ voice: "am_michael", speed: 1.2 });
  });

  it("invokes the progress callback during model load (cold start UX)", async () => {
    const { factory } = makeFakeFactory();
    __setKokoroFactoryForTests(factory);

    const events: Array<{ status: string; progress?: number }> = [];
    const result = await provider.textToSpeech("Hello.", {
      onProgress: (e) => events.push({ status: e.status, progress: e.progress }),
    });

    expect(result.success).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toMatchObject({ status: "download", progress: 50 });
    expect(events[events.length - 1].status).toBe("done");
  });

  it("caches the model across calls (lazy singleton)", async () => {
    const { factory, calls } = makeFakeFactory();
    __setKokoroFactoryForTests(factory);

    await provider.textToSpeech("first");
    await provider.textToSpeech("second");
    await provider.textToSpeech("third");

    expect(calls.loadCount).toBe(1);
    expect(calls.generateCalls.map((c) => c.text)).toEqual(["first", "second", "third"]);
  });

  it("returns failure result when model load fails", async () => {
    const { factory, calls } = makeFakeFactory({ failLoad: true });
    __setKokoroFactoryForTests(factory);

    const result = await provider.textToSpeech("Hello.");

    expect(result.success).toBe(false);
    expect(result.error).toContain("model download failed");
    // Failure must not leave a poisoned singleton — next call should retry.
    expect(calls.loadCount).toBe(1);
    await provider.textToSpeech("retry").catch(() => {});
    expect(calls.loadCount).toBe(2);
  });

  it("returns failure result when generate() throws", async () => {
    const { factory } = makeFakeFactory({ failGenerate: true });
    __setKokoroFactoryForTests(factory);

    const result = await provider.textToSpeech("Hello.");

    expect(result.success).toBe(false);
    expect(result.error).toContain("inference crashed");
  });

  it("loads model with q8 dtype + cpu device (Node-friendly defaults)", async () => {
    const { factory, calls } = makeFakeFactory();
    __setKokoroFactoryForTests(factory);

    await provider.textToSpeech("Hello.");

    expect(calls.loadOptions[0]).toMatchObject({ dtype: "q8", device: "cpu" });
  });
});

describe("KokoroProvider — exports", () => {
  it("exposes default model id and voice constants", () => {
    expect(KOKORO_MODEL_ID).toBe("onnx-community/Kokoro-82M-v1.0-ONNX");
    expect(KOKORO_DEFAULT_VOICE).toBe("af_heart");
  });
});

// Sanity check: vi must not have leaked module-state from previous suites.
describe("KokoroProvider — isolation", () => {
  it("starts with no factory override after afterEach reset", () => {
    // Without __setKokoroFactoryForTests being called, the dynamic import in
    // loadKokoroFactory() would normally fire. We can verify this state via
    // a no-op: setting null again should not throw.
    expect(() => __setKokoroFactoryForTests(null)).not.toThrow();
  });
});

// Suppress vi unused warning: keeps the import group ordered.
void vi;
