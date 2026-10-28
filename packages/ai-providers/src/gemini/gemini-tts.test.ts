/** Gemini TTS over the fake provider network: request shape, audio decoding, chunking, and error kinds. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FAKE_PCM,
  FAKE_WAV,
  FakeProviderNetwork,
  geminiAudioResponse,
  jsonResponse,
} from "../testing/fake-provider-network.js";
import { ProviderError } from "../shared/errors.js";
import { parseWav } from "../speech/wav.js";
import {
  GEMINI_TTS_MAX_CHUNK_CHARS,
  GEMINI_TTS_VOICES,
  GeminiTtsProvider,
  geminiSpeechStyle,
  resolveGeminiVoice,
} from "./gemini-tts.js";

const HOST = "generativelanguage.googleapis.com";
const PATH = /^\/v1beta\/interactions$/;

/** The parts of a recorded request body the tests read. */
interface SentBody {
  model: string;
  input: Array<{ content: Array<{ text: string; annotations?: unknown }> }>;
  generation_config: { speech_config: unknown };
}

let net: FakeProviderNetwork;
beforeEach(() => {
  net = new FakeProviderNetwork();
  net.install();
});
afterEach(() => {
  net.uninstall();
  vi.useRealTimers();
});

async function provider(key: string | null = "AIza-test"): Promise<GeminiTtsProvider> {
  const tts = new GeminiTtsProvider();
  await tts.initialize({ apiKey: key ?? undefined });
  return tts;
}

async function rejection(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError);
    return error as ProviderError;
  }
  throw new Error("expected a ProviderError");
}

describe("GeminiTtsProvider request", () => {
  it("posts the documented Interactions shape with the key in a header", async () => {
    net.on("POST", HOST, PATH, () => geminiAudioResponse());
    await (await provider()).synthesize({ text: "Hello there." });

    const [request] = net.requests;
    expect(request.url).toBe(`https://${HOST}/v1beta/interactions`);
    expect(request.url).not.toContain("AIza-test");
    expect(request.headers["x-goog-api-key"]).toBe("AIza-test");
    expect(request.body).toEqual({
      model: "gemini-3.8-flash-tts",
      input: [{ type: "user_input", content: [{ type: "text", text: "Hello there." }] }],
      response_format: { type: "audio", mime_type: "audio/wav", sample_rate: 24000 },
      generation_config: { speech_config: [{ voice: "Kore" }] },
      store: false,
    });
  });

  it("sends the chosen model, the canonical voice name, and delivery directions", async () => {
    net.on("POST", HOST, PATH, () => geminiAudioResponse());
    const result = await (await provider()).synthesize({
      text: "Hi.",
      model: "lite",
      voice: "puck",
      instructions: "warm documentary narrator",
      speed: 0.7,
    });

    expect(result.model).toBe("gemini-3.8-flash-lite-tts");
    const body = net.requests[0].body as SentBody;
    expect(body.model).toBe("gemini-3.8-flash-lite-tts");
    expect(body.generation_config.speech_config).toEqual([{ voice: "Puck" }]);
    expect(body.input[0].content[0].annotations).toEqual([
      { type: "speech_metadata", style: "warm documentary narrator; speaking slowly" },
    ]);
  });

  it("passes custom voice IDs through", async () => {
    net.on("POST", HOST, PATH, () => geminiAudioResponse());
    await (await provider()).synthesize({ text: "Hi.", voice: "voicekey_abc-123" });
    expect((net.requests[0].body as SentBody).generation_config.speech_config).toEqual([{ voice: "voicekey_abc-123" }]);
  });

  it("splits long text into sentence chunks and joins the audio into one WAV", async () => {
    net.on("POST", HOST, PATH, () => geminiAudioResponse());
    const sentence = "A paper boat drifts down the river past the old mill. ";
    const text = sentence.repeat(Math.ceil((GEMINI_TTS_MAX_CHUNK_CHARS * 2.5) / sentence.length)).trim();

    const result = await (await provider()).synthesize({ text });

    expect(net.requests).toHaveLength(3);
    for (const request of net.requests) {
      const chunk = (request.body as SentBody).input[0].content[0].text as string;
      expect(chunk.length).toBeLessThanOrEqual(GEMINI_TTS_MAX_CHUNK_CHARS);
      expect(chunk.endsWith(".")).toBe(true);
    }
    const wav = parseWav(result.bytes)!;
    expect(wav).toMatchObject({ sampleRate: 24000, channels: 1, bitsPerSample: 16 });
    expect(Buffer.from(wav.data)).toEqual(Buffer.concat([FAKE_PCM, FAKE_PCM, FAKE_PCM]));
    expect(result.characters).toBe(text.length);
  });

  it("wraps headerless L16 audio using the rate in its MIME type", async () => {
    net.on("POST", HOST, PATH, () => geminiAudioResponse(FAKE_PCM, "audio/L16;codec=pcm;rate=16000"));
    const result = await (await provider()).synthesize({ text: "Hi." });

    expect(result).toMatchObject({ mimeType: "audio/wav", extension: "wav" });
    const wav = parseWav(result.bytes)!;
    expect(wav).toMatchObject({ sampleRate: 16000, channels: 1, bitsPerSample: 16 });
    expect(Buffer.from(wav.data)).toEqual(FAKE_PCM);
  });

  it("returns the WAV it was given byte for byte", async () => {
    net.on("POST", HOST, PATH, () => geminiAudioResponse());
    const result = await (await provider()).synthesize({ text: "Hi." });
    expect(Buffer.from(result.bytes)).toEqual(FAKE_WAV);
  });
});

describe("GeminiTtsProvider refusals before sending", () => {
  it("needs a key", async () => {
    expect(await rejection((await provider(null)).synthesize({ text: "Hi." }))).toMatchObject({ kind: "auth" });
  });

  it("refuses empty text", async () => {
    expect((await rejection((await provider()).synthesize({ text: "   " }))).kind).toBe("invalid-request");
  });

  it("lists the valid voices for an unknown one", async () => {
    const error = await rejection((await provider()).synthesize({ text: "Hi.", voice: "rachel" }));
    expect(error.kind).toBe("invalid-request");
    expect(error.message).toMatch(/Unknown Gemini voice "rachel"\. Available voices: Zephyr, Puck, Charon, Kore/);
    expect(net.requests).toHaveLength(0);
  });
});

describe("GeminiTtsProvider errors", () => {
  it("reads 400 API_KEY_INVALID, wrapped in an array as Interactions sends it, as auth", async () => {
    // The body shape a fake key got from the live endpoint (probe 2026-10-28).
    net.on("POST", HOST, PATH, () =>
      jsonResponse(
        [
          {
            error: {
              code: 400,
              message: "API key not valid. Please pass a valid API key.",
              status: "INVALID_ARGUMENT",
              details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID" }],
            },
          },
        ],
        400
      )
    );
    expect(await rejection((await provider()).synthesize({ text: "Hi." }))).toMatchObject({
      kind: "auth",
      status: 400,
      message: "POST /v1beta/interactions -> 400: API key not valid. Please pass a valid API key.",
    });
  });

  it("retries a 429 and reports rate-limit once retries are spent", async () => {
    vi.useFakeTimers();
    net.on("POST", HOST, PATH, () =>
      jsonResponse({ error: { code: 429, message: "Too many requests, slow down.", status: "UNAVAILABLE" } }, 429)
    );
    const pending = rejection((await provider()).synthesize({ text: "Hi." }));
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ kind: "rate-limit", status: 429 });
    expect(net.requests).toHaveLength(3);
  });

  it("reads RESOURCE_EXHAUSTED quota as quota without retrying", async () => {
    net.on("POST", HOST, PATH, () =>
      jsonResponse({ error: { code: 429, message: "You exceeded your current quota.", status: "RESOURCE_EXHAUSTED" } }, 429)
    );
    expect(await rejection((await provider()).synthesize({ text: "Hi." }))).toMatchObject({ kind: "quota" });
    expect(net.requests).toHaveLength(1);
  });

  it("reads an incomplete interaction without audio as a safety block", async () => {
    net.on("POST", HOST, PATH, () => jsonResponse({ id: "i", status: "incomplete", finish_reason: "SAFETY", steps: [] }));
    const error = await rejection((await provider()).synthesize({ text: "Hi." }));
    expect(error.kind).toBe("moderation");
    expect(error.message).toMatch(/incomplete, SAFETY/);
  });

  it("reads a failed interaction by its error", async () => {
    net.on("POST", HOST, PATH, () =>
      jsonResponse({ id: "i", status: "failed", error: { code: "invalid_argument", message: "Voice not found" } })
    );
    expect((await rejection((await provider()).synthesize({ text: "Hi." }))).message).toBe("Voice not found");
  });

  it("reads a completed interaction without audio as a provider failure", async () => {
    net.on("POST", HOST, PATH, () => jsonResponse({ id: "i", status: "completed", steps: [{ type: "model_output", content: [] }] }));
    expect(await rejection((await provider()).synthesize({ text: "Hi." }))).toMatchObject({ kind: "provider" });
  });

  it("refuses audio it cannot decode", async () => {
    net.on("POST", HOST, PATH, () => geminiAudioResponse(Buffer.from("ID3 mp3"), "audio/mpeg"));
    const error = await rejection((await provider()).synthesize({ text: "Hi." }));
    expect(error).toMatchObject({ kind: "provider" });
    expect(error.message).toMatch(/audio\/mpeg/);
  });
});

describe("resolveGeminiVoice", () => {
  it("defaults to Kore and matches prebuilt names in any case", () => {
    expect(resolveGeminiVoice(undefined)).toBe("Kore");
    expect(resolveGeminiVoice("ZUBENELGENUBI")).toBe("Zubenelgenubi");
    expect(GEMINI_TTS_VOICES).toHaveLength(30);
  });
});

describe("geminiSpeechStyle", () => {
  it("turns speed into a pace direction and leaves 1x alone", () => {
    expect(geminiSpeechStyle({})).toBeUndefined();
    expect(geminiSpeechStyle({ speed: 1 })).toBeUndefined();
    expect(geminiSpeechStyle({ speed: 1.5 })).toBe("speaking rapidly");
    expect(geminiSpeechStyle({ speed: 1.15 })).toBe("speaking a little faster than usual");
    expect(geminiSpeechStyle({ speed: 0.85 })).toBe("speaking a little slower than usual");
    expect(geminiSpeechStyle({ instructions: "  calm  " })).toBe("calm");
  });
});
