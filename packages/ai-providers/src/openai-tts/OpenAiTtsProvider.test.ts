import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiTtsProvider } from "./OpenAiTtsProvider.js";

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

describe("OpenAiTtsProvider.textToSpeech", () => {
  it("posts to /audio/speech with gpt-4o-mini-tts and the default voice", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ttsResponse(200, AUDIO));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiTtsProvider();
    await provider.initialize({ apiKey: "sk-test" });

    const result = await provider.textToSpeech("Hello.");

    expect(result.success).toBe(true);
    expect(result.audioBuffer).toBeInstanceOf(Buffer);
    expect(result.characterCount).toBe(6);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      model: "gpt-4o-mini-tts",
      input: "Hello.",
      voice: "marin",
      response_format: "mp3",
    });
  });

  it("forwards voice (case-insensitive), speed, and instructions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ttsResponse(200, AUDIO));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiTtsProvider();
    await provider.initialize({ apiKey: "sk-test" });

    await provider.textToSpeech("Hi.", {
      voice: "Nova",
      speed: 1.2,
      instructions: "calm documentary narrator",
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.voice).toBe("nova");
    expect(body.speed).toBe(1.2);
    expect(body.instructions).toBe("calm documentary narrator");
  });

  it("rejects unknown voices without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiTtsProvider();
    await provider.initialize({ apiKey: "sk-test" });

    const result = await provider.textToSpeech("Hi.", { voice: "rachel" });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unknown OpenAI voice "rachel"/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails cleanly without an API key", async () => {
    const provider = new OpenAiTtsProvider();
    const result = await provider.textToSpeech("Hi.");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not configured/);
    expect(provider.isConfigured()).toBe(false);
  });

  it("retries once after a 429 and succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ttsResponse(429, "rate limited"))
      .mockResolvedValueOnce(ttsResponse(200, AUDIO));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiTtsProvider();
    await provider.initialize({ apiKey: "sk-test" });

    const pending = provider.textToSpeech("Hello again.");
    await vi.advanceTimersByTimeAsync(2100);
    const result = await pending;

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces non-429 API errors without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ttsResponse(401, "invalid key"));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiTtsProvider();
    await provider.initialize({ apiKey: "sk-bad" });

    const result = await provider.textToSpeech("Hello.");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/OpenAI TTS failed: invalid key/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
