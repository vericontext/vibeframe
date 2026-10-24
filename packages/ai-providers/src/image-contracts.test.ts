/**
 * Request/response contracts for the image providers: the fields each API
 * documents, so a model or parameter change shows up here before it reaches
 * a paid call. (Live behaviour was checked on 2026-10-04.)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GeminiProvider } from "./gemini/GeminiProvider.js";
import { OpenAIImageProvider } from "./openai-image/OpenAIImageProvider.js";
import { FakeProviderNetwork, jsonResponse } from "./testing/fake-provider-network.js";

let net: FakeProviderNetwork;

beforeEach(() => {
  net = new FakeProviderNetwork();
  net.install();
});

afterEach(() => net.uninstall());

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
    [undefined, "gemini-nano-banana-2.1"],
    ["flash", "gemini-nano-banana-2.1"],
    ["3.1-flash", "gemini-3.1-flash-image"],
    ["lite", "gemini-3.1-flash-lite-image"],
    ["pro", "gemini-3-pro-image"],
  ] as const)("model %s calls %s:generateContent", async (alias, modelId) => {
    net.on("POST", "generativelanguage.googleapis.com", /:generateContent$/, () => jsonResponse(reply));
    const gemini = new GeminiProvider();
    await gemini.initialize({ apiKey: "key" });

    const result = await gemini.createImage({ prompt: "apple", model: alias, aspectRatio: "16:9" });

    expect(net.requests[0].path).toContain(`/models/${modelId}:generateContent`);
    const body = net.requests[0].body as { generationConfig: Record<string, unknown> & { imageConfig: { aspectRatio: string } } };
    expect(body.generationConfig.responseModalities).toEqual(["TEXT", "IMAGE"]);
    expect(body.generationConfig.imageConfig.aspectRatio).toBe("16:9");
    expect(body.generationConfig).not.toHaveProperty("temperature");
    // Thought images are skipped; the real image keeps its JPEG mime type.
    expect(result.images).toHaveLength(1);
    expect(result.images[0].mimeType).toBe("image/jpeg");
    expect(Buffer.from(result.images[0].bytes).toString()).toBe("image");
  });
});

describe("OpenAI image contract", () => {
  it("defaults to gpt-image-2.5-sunburst with medium quality and no response_format", async () => {
    net.on("POST", "api.openai.com", /\/images\/generations$/, () =>
      jsonResponse({ data: [{ b64_json: "aW1n", revised_prompt: "an apple" }] })
    );
    const openai = new OpenAIImageProvider();
    await openai.initialize({ apiKey: "key" });

    const result = await openai.createImage({ prompt: "apple", providerOptions: { size: "1024x1024" } });

    expect(net.requests[0].path).toMatch(/\/images\/generations$/);
    const body = net.requests[0].body;
    expect(body).toMatchObject({ model: "gpt-image-2.5-sunburst", quality: "medium", size: "1024x1024" });
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("style");
    expect(Buffer.from(result.images[0].bytes).toString()).toBe("img");
  });
});
