/**
 * Request/response contracts for the image providers: the fields each API
 * documents, so a model or parameter change shows up here before it reaches
 * a paid call. (Live behaviour was checked on 2026-10-04.)
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { GeminiProvider } from "./gemini/GeminiProvider.js";
import { OpenAIImageProvider } from "./openai-image/OpenAIImageProvider.js";

function stubFetch(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Gemini image contract", () => {
  const reply = {
    candidates: [
      {
        content: {
          parts: [
            { thought: true, inlineData: { mimeType: "image/png", data: "THOUGHT" } },
            { inlineData: { mimeType: "image/jpeg", data: "aW1hZ2U=" } },
          ],
        },
      },
    ],
  };

  it.each([
    [undefined, "gemini-3.1-flash-image"],
    ["flash", "gemini-3.1-flash-image"],
    ["lite", "gemini-3.1-flash-lite-image"],
    ["pro", "gemini-3-pro-image"],
  ] as const)("model %s calls %s:generateContent", async (alias, modelId) => {
    const fetchMock = stubFetch(reply);
    const gemini = new GeminiProvider();
    await gemini.initialize({ apiKey: "key" });

    const result = await gemini.generateImage("apple", { model: alias, aspectRatio: "16:9" });

    expect(fetchMock.mock.calls[0][0]).toContain(`/models/${modelId}:generateContent`);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.generationConfig.responseModalities).toEqual(["TEXT", "IMAGE"]);
    expect(body.generationConfig.imageConfig.aspectRatio).toBe("16:9");
    expect(body.generationConfig).not.toHaveProperty("temperature");
    // Thought images are skipped; the real image keeps its JPEG mime type.
    expect(result.images).toEqual([{ base64: "aW1hZ2U=", mimeType: "image/jpeg" }]);
  });
});

describe("OpenAI image contract", () => {
  it("defaults to gpt-image-2.5-sunburst with medium quality and no response_format", async () => {
    const fetchMock = stubFetch({ data: [{ b64_json: "aW1n", revised_prompt: "an apple" }] });
    const openai = new OpenAIImageProvider();
    await openai.initialize({ apiKey: "key" });

    const result = await openai.generateImage("apple", { size: "1024x1024" });

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/images\/generations$/);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ model: "gpt-image-2.5-sunburst", quality: "medium", size: "1024x1024" });
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("style");
    expect(result.images?.[0].base64).toBe("aW1n");
  });

  it("maps the legacy hd quality name to high", async () => {
    const fetchMock = stubFetch({ data: [{ b64_json: "aW1n" }] });
    const openai = new OpenAIImageProvider();
    await openai.initialize({ apiKey: "key" });

    await openai.generateImage("apple", { quality: "hd" });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).quality).toBe("high");
  });
});
