/**
 * GrokProvider unit tests over the fake provider network (no API calls)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FAKE_PNG, FakeProviderNetwork, jsonResponse } from "../testing/fake-provider-network.js";
import { GrokProvider } from "./GrokProvider.js";

const HOST = "api.x.ai";

describe("GrokProvider", () => {
  let provider: GrokProvider;
  let net: FakeProviderNetwork;

  beforeEach(() => {
    provider = new GrokProvider();
    net = new FakeProviderNetwork();
    net.install();
  });

  afterEach(() => net.uninstall());

  describe("initialization", () => {
    it("should have correct id and capabilities", () => {
      expect(provider.id).toBe("grok");
      expect(provider.capabilities).toContain("text-to-video");
      expect(provider.capabilities).toContain("image-to-video");
      expect(provider.capabilities).toContain("text-to-image");
      expect(provider.isAvailable).toBe(true);
    });

    it("should not be configured before initialize", () => {
      expect(provider.isConfigured()).toBe(false);
    });

    it("should be configured after initialize", async () => {
      await provider.initialize({ apiKey: "test-key" });
      expect(provider.isConfigured()).toBe(true);
    });

    it("should accept custom baseUrl", async () => {
      await provider.initialize({ apiKey: "test-key", baseUrl: "https://custom.api/v1" });
      expect(provider.isConfigured()).toBe(true);
    });
  });

  describe("createImage", () => {
    beforeEach(async () => {
      await provider.initialize({ apiKey: "test-key" });
    });

    it("should call xAI API with correct parameters", async () => {
      net.on("POST", HOST, /^\/v1\/images\/generations$/, () =>
        jsonResponse({ data: [{ b64_json: FAKE_PNG.toString("base64") }] })
      );

      const result = await provider.createImage({ prompt: "a blue cat", count: 1, aspectRatio: "16:9" });

      expect(result.images).toHaveLength(1);
      expect(net.requests).toHaveLength(1);
      expect(net.requests[0].url).toBe("https://api.x.ai/v1/images/generations");
      expect(net.requests[0].body).toMatchObject({
        prompt: "a blue cat",
        model: "grok-imagine-image",
        aspect_ratio: "16:9",
        // Base64 back, so callers never download an expiring URL.
        response_format: "b64_json",
      });
    });
  });

  describe("submitVideo", () => {
    beforeEach(async () => {
      await provider.initialize({ apiKey: "test-key" });
      net.on("POST", HOST, /^\/v1\/videos\/generations$/, () => jsonResponse({ request_id: "task-1" }));
    });

    it("rounds float duration to integer (xAI rejects floats with 422)", async () => {
      await provider.submitVideo({ prompt: "test", durationSec: 3.44, aspectRatio: "16:9" });

      const body = net.requests[0].body as { duration: number };
      expect(body.duration).toBe(3);
      expect(Number.isInteger(body.duration)).toBe(true);
    });

    it("clamps duration above 15 to 15 (with integer cast)", async () => {
      await provider.submitVideo({ prompt: "test", durationSec: 100.7, aspectRatio: "16:9" });

      expect(net.requests[0].body).toMatchObject({ duration: 15 });
    });

    it("sends a data URI image as xAI's image object", async () => {
      const image = "data:image/png;base64,iVBOR...";
      const job = await provider.submitVideo({ prompt: "animate this", image, durationSec: 5, aspectRatio: "16:9" });

      expect(job.id).toBe("task-1");
      expect(net.requests[0].body).toMatchObject({ image: { url: image } });
    });
  });
});
