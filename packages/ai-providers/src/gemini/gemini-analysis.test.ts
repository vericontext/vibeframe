/**
 * Gemini analysis, edit suggestion, motion, and storyboard calls report every
 * failure as a `ProviderError` with a kind, never as a default result.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "../shared/errors.js";
import { GeminiProvider } from "./GeminiProvider.js";

const BAD_KEY_BODY = {
  error: {
    code: 400,
    message: "API key not valid. Please pass a valid API key.",
    status: "INVALID_ARGUMENT",
    details: [{ reason: "API_KEY_INVALID" }],
  },
};

function reply(text: string) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
}

describe("GeminiProvider analysis calls", () => {
  let gemini: GeminiProvider;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    gemini = new GeminiProvider();
    await gemini.initialize({ apiKey: "AIza-test" });
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a rejected key is an auth error on every call, with the key kept out of the URL", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(BAD_KEY_BODY), { status: 400 }));
    const calls = [
      () => gemini.analyzeVideo(Buffer.from("v"), "describe"),
      () => gemini.analyzeImage(Buffer.from("i"), "describe"),
      () => gemini.autoEdit([], "trim to 3s"),
      () => gemini.generateMotion("title card"),
      () => gemini.refineMotion("code", "make it blue"),
      () => gemini.analyzeContent("a script", 10),
    ];
    for (const call of calls) {
      const error = await call().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ kind: "auth", provider: "gemini" });
    }
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).not.toContain("AIza-test");
      expect((init as RequestInit).headers).toMatchObject({ "x-goog-api-key": "AIza-test" });
    }
  });

  it("a missing key is an auth error, not an empty result", async () => {
    const unset = new GeminiProvider();
    await expect(unset.analyzeVideo(Buffer.from("v"), "describe")).rejects.toMatchObject({ kind: "auth" });
    await expect(unset.analyzeContent("a script")).rejects.toMatchObject({ kind: "auth" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the reply text and token usage", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "thinking", thought: true }, { text: "A cat on a sofa." }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    }), { status: 200 }));

    const result = await gemini.analyzeVideo(Buffer.from("v"), "describe", { fps: 2, lowResolution: true });

    expect(result).toMatchObject({ response: "A cat on a sofa.", promptTokens: 10, responseTokens: 5, totalTokens: 15 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.contents[0].parts[0].video_metadata).toEqual({ fps: 2 });
    expect(body.generationConfig.mediaResolution).toBe("MEDIA_RESOLUTION_LOW");
  });

  it("an unparseable reply is a provider error, not pattern-matched edits or an empty storyboard", async () => {
    fetchMock.mockImplementation(async () => reply("I am not sure what you mean."));

    await expect(gemini.autoEdit([], "trim to 3s")).rejects.toMatchObject({ kind: "provider" });
    await expect(gemini.analyzeContent("a script")).rejects.toMatchObject({ kind: "provider" });
    await expect(gemini.generateMotion("title card")).rejects.toMatchObject({ kind: "provider" });
  });

  it("generateMotion returns the component", async () => {
    fetchMock.mockResolvedValue(reply(JSON.stringify({ name: "Title", code: "export const Title = () => null;", description: "A title" })));

    const component = await gemini.generateMotion("title card", { duration: 2, fps: 30 });

    expect(component).toMatchObject({ name: "Title", durationInFrames: 60, fps: 30, width: 1920, height: 1080 });
  });
});
