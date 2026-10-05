/**
 * The image contract for every image provider, over the fake provider
 * network: bytes back, model validation and edit limits before any request,
 * classified errors, and keys kept out of URLs.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FAKE_PNG, FakeProviderNetwork, jsonResponse } from "../testing/fake-provider-network.js";
import { ProviderError } from "../shared/errors.js";
import { IMAGE_GENERATOR_PROVIDERS, createImageGenerator } from "./registry.js";

const B64 = FAKE_PNG.toString("base64");
const ROUTES: Record<string, { host: string; path: RegExp; ok: () => Response; defaultModel: string; maxEdit: number }> = {
  openai: {
    host: "api.openai.com",
    path: /^\/v1\/images\/(generations|edits)$/,
    ok: () => jsonResponse({ data: [{ b64_json: B64 }] }),
    defaultModel: "gpt-image-2.5-sunburst",
    maxEdit: 16,
  },
  gemini: {
    host: "generativelanguage.googleapis.com",
    path: /:generateContent$/,
    ok: () => jsonResponse({ candidates: [{ content: { parts: [{ text: "here" }, { inlineData: { mimeType: "image/png", data: B64 } }] } }] }),
    defaultModel: "gemini-3.1-flash-image",
    maxEdit: 3,
  },
  grok: {
    host: "api.x.ai",
    path: /^\/v1\/images\/(generations|edits)$/,
    ok: () => jsonResponse({ data: [{ b64_json: B64 }] }),
    defaultModel: "grok-imagine-image",
    maxEdit: 1,
  },
};

let net: FakeProviderNetwork;
beforeEach(() => {
  net = new FakeProviderNetwork();
  net.install();
});
afterEach(() => net.uninstall());

async function rejection(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError);
    return error as ProviderError;
  }
  throw new Error("expected a ProviderError");
}

describe.each(IMAGE_GENERATOR_PROVIDERS)("%s meets the image contract", (provider) => {
  const route = ROUTES[provider];

  it("generates image bytes on its default model", async () => {
    net.on("POST", route.host, route.path, route.ok);
    const generator = await createImageGenerator(provider, "test-key");
    const result = await generator.createImage({ prompt: "a paper boat", aspectRatio: "16:9" });

    expect(result.model).toBe(route.defaultModel);
    expect(Buffer.from(result.images[0].bytes)).toEqual(FAKE_PNG);
    expect(net.requests[0].url).not.toContain("key=");
  });

  it("edits with input images, up to its limit, refusing more before sending", async () => {
    net.on("POST", route.host, route.path, route.ok);
    const generator = await createImageGenerator(provider, "test-key");
    const image = { bytes: new Uint8Array(FAKE_PNG), mimeType: "image/png" };

    await generator.createImage({ prompt: "make it night", images: [image] });
    expect(net.requests).toHaveLength(1);
    expect(generator.maxEditImages()).toBe(route.maxEdit);

    const error = await rejection(
      generator.createImage({ prompt: "x", images: Array(route.maxEdit + 1).fill(image) })
    );
    expect(error.kind).toBe("invalid-request");
    expect(net.requests).toHaveLength(1);
  });

  it("rejects an unknown model before sending", async () => {
    const generator = await createImageGenerator(provider, "test-key");
    const error = await rejection(generator.createImage({ prompt: "x", model: "no-such-model" }));
    expect(error.kind).toBe("invalid-request");
    expect(net.requests).toHaveLength(0);
  });

  it("classifies a bad key", async () => {
    net.on("POST", route.host, route.path, () => jsonResponse({ error: { message: "Incorrect API key provided" } }, 401));
    const generator = await createImageGenerator(provider, "test-key");
    const error = await rejection(generator.createImage({ prompt: "x" }));
    expect(error).toMatchObject({ kind: "auth", status: 401 });
  });
});

describe("image provider specifics", () => {
  it("OpenAI maps the aspect ratio to a GPT Image size", async () => {
    net.on("POST", ROUTES.openai.host, ROUTES.openai.path, ROUTES.openai.ok);
    const openai = await createImageGenerator("openai", "k");
    await openai.createImage({ prompt: "x", aspectRatio: "9:16", quality: "high" });
    expect(net.requests[0].body).toMatchObject({ size: "1024x1536", quality: "high", model: "gpt-image-2.5-sunburst" });
  });

  it("Gemini sends the key as a header and reports a safety block as moderation", async () => {
    net.on("POST", ROUTES.gemini.host, ROUTES.gemini.path, () => jsonResponse({ promptFeedback: { blockReason: "SAFETY" } }));
    const gemini = await createImageGenerator("gemini", "k");
    const error = await rejection(gemini.createImage({ prompt: "x" }));

    expect(error.kind).toBe("moderation");
    expect(net.requests[0].headers["x-goog-api-key"]).toBe("k");
  });

  it("Gemini Pro edits up to 14 images", async () => {
    const gemini = await createImageGenerator("gemini", "k");
    expect(gemini.maxEditImages("pro")).toBe(14);
  });

  it("Grok asks for base64 and sends quality medium for the 2.0 model", async () => {
    net.on("POST", ROUTES.grok.host, ROUTES.grok.path, ROUTES.grok.ok);
    const grok = await createImageGenerator("grok", "k");
    await grok.createImage({ prompt: "x", model: "2.0", resolution: "2K" });
    expect(net.requests[0].body).toMatchObject({ model: "grok-imagine-image-2.0", quality: "medium", response_format: "b64_json", resolution: "2k" });
  });

  it("refuses an unknown provider", async () => {
    await expect(createImageGenerator("midjourney", "k")).rejects.toMatchObject({ kind: "invalid-request" });
  });
});
