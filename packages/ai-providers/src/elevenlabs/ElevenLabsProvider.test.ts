import { afterEach, describe, expect, it, vi } from "vitest";
import { ElevenLabsProvider } from "./ElevenLabsProvider.js";

function ttsResponse(status: number, body: ArrayBuffer | string): Response {
  if (status === 200) {
    return {
      ok: true,
      status,
      arrayBuffer: async () => body as ArrayBuffer,
    } as unknown as Response;
  }
  return {
    ok: false,
    status,
    text: async () => String(body),
  } as unknown as Response;
}

const AUDIO = new Uint8Array([1, 2, 3]).buffer;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("ElevenLabsProvider.textToSpeech 429 retry", () => {
  it("succeeds first try with a single fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ttsResponse(200, AUDIO));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ElevenLabsProvider();
    await provider.initialize({ apiKey: "test-key" });

    const result = await provider.textToSpeech("Hello.");
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once after a 429 and succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        ttsResponse(429, JSON.stringify({ detail: { code: "concurrent_limit_exceeded" } }))
      )
      .mockResolvedValueOnce(ttsResponse(200, AUDIO));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ElevenLabsProvider();
    await provider.initialize({ apiKey: "test-key" });

    const pending = provider.textToSpeech("Hello again.");
    await vi.advanceTimersByTimeAsync(2100);
    const result = await pending;

    expect(result.success).toBe(true);
    expect(result.audioBuffer).toBeInstanceOf(Buffer);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails with the API error after exhausting the retry", async () => {
    vi.useFakeTimers();
    const errorBody = JSON.stringify({ detail: { code: "concurrent_limit_exceeded" } });
    const fetchMock = vi.fn().mockResolvedValue(ttsResponse(429, errorBody));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ElevenLabsProvider();
    await provider.initialize({ apiKey: "test-key" });

    const pending = provider.textToSpeech("Still busy.");
    await vi.advanceTimersByTimeAsync(2100);
    const result = await pending;

    expect(result.success).toBe(false);
    expect(result.error).toContain("concurrent_limit_exceeded");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-429 failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ttsResponse(401, "unauthorized"));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ElevenLabsProvider();
    await provider.initialize({ apiKey: "test-key" });

    const result = await provider.textToSpeech("Nope.");
    expect(result.success).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("ElevenLabsProvider request bodies", () => {
  async function bodyOf(call: (p: ElevenLabsProvider) => Promise<unknown>) {
    const fetchMock = vi.fn().mockResolvedValue(ttsResponse(200, AUDIO));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ElevenLabsProvider();
    await provider.initialize({ apiKey: "key" });
    await call(provider);
    return JSON.parse(fetchMock.mock.calls[0][1].body as string);
  }

  it("sends speed inside voice_settings, where the API reads it", async () => {
    const body = await bodyOf((p) => p.textToSpeech("hi", { speed: 1.2 }));
    expect(body.voice_settings.speed).toBe(1.2);
    expect(body).not.toHaveProperty("speed");
  });

  it("uses music_v2_5 for music", async () => {
    const body = await bodyOf((p) => p.generateMusic("lo-fi piano", { duration: 10 }));
    expect(body.model_id).toBe("music_v2_5");
    expect(body.music_length_ms).toBe(10000);
  });

  it("allows sound effects up to 30 seconds", async () => {
    const body = await bodyOf((p) => p.generateSoundEffect("door creak", { duration: 45 }));
    expect(body.duration_seconds).toBe(30);
  });
});
