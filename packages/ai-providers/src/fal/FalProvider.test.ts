/**
 * FalProvider unit tests.
 *
 * The real fal client is mocked via `vi.mock("@fal-ai/client")` so the
 * tests run instantly with no network. Each case asserts the endpoint
 * id we picked, the input payload we sent, or the failure path we
 * surface — the behaviour the rest of the codebase relies on.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
  createFalClient: vi.fn(),
}));

vi.mock("@fal-ai/client", () => ({
  createFalClient: (...args: unknown[]) => {
    mocks.createFalClient(...args);
    return { subscribe: mocks.subscribe };
  },
}));

import { FalProvider } from "./FalProvider.js";

describe("FalProvider", () => {
  let provider: FalProvider;

  beforeEach(() => {
    mocks.subscribe.mockReset();
    mocks.createFalClient.mockReset();
    provider = new FalProvider();
  });

  describe("initialization", () => {
    it("declares text-to-video and image-to-video capabilities", () => {
      expect(provider.id).toBe("fal");
      expect(provider.capabilities).toContain("text-to-video");
      expect(provider.capabilities).toContain("image-to-video");
    });

    it("is unconfigured before initialize", () => {
      expect(provider.isConfigured()).toBe(false);
    });

    it("creates the fal client when an API key is supplied", async () => {
      await provider.initialize({ apiKey: "fal_pst_test" });
      expect(mocks.createFalClient).toHaveBeenCalledWith({ credentials: "fal_pst_test" });
      expect(provider.isConfigured()).toBe(true);
    });

    it("stays unconfigured when no API key is provided", async () => {
      await provider.initialize({});
      expect(provider.isConfigured()).toBe(false);
    });
  });

  describe("generateVideo — text-to-video", () => {
    beforeEach(async () => {
      await provider.initialize({ apiKey: "fal_pst_test" });
    });

    it("hits the standard text-to-video endpoint by default", async () => {
      mocks.subscribe.mockResolvedValueOnce({
        requestId: "req-abc",
        data: { video: { url: "https://fal.media/output.mp4" } },
      });

      const result = await provider.generateVideo("a cat surfing", {
        prompt: "a cat surfing",
        aspectRatio: "16:9",
        duration: 6,
      });

      expect(mocks.subscribe).toHaveBeenCalledWith(
        "bytedance/seedance-2.0/text-to-video",
        expect.objectContaining({
          input: expect.objectContaining({
            prompt: "a cat surfing",
            aspect_ratio: "16:9",
            resolution: "720p",
            duration: 6,
          }),
        }),
      );
      expect(result).toMatchObject({
        id: "req-abc",
        status: "completed",
        videoUrl: "https://fal.media/output.mp4",
      });
    });

    it("routes to the fast variant when model = seedance-2.0-fast", async () => {
      mocks.subscribe.mockResolvedValueOnce({
        requestId: "req-fast",
        data: { video: { url: "https://fal.media/fast.mp4" } },
      });

      await provider.generateVideo("any prompt", {
        prompt: "any prompt",
        model: "seedance-2.0-fast",
      });

      expect(mocks.subscribe.mock.calls[0][0]).toBe(
        "bytedance/seedance-2.0/fast/text-to-video",
      );
    });

    it("clamps unreasonable durations into the 4–15 s API range", async () => {
      mocks.subscribe.mockResolvedValueOnce({
        requestId: "req-clamp",
        data: { video: { url: "https://x" } },
      });

      await provider.generateVideo("p", { prompt: "p", duration: 99 });
      expect(mocks.subscribe.mock.calls[0][1].input.duration).toBe(15);

      mocks.subscribe.mockResolvedValueOnce({
        requestId: "req-clamp2",
        data: { video: { url: "https://x" } },
      });
      await provider.generateVideo("p", { prompt: "p", duration: 1 });
      expect(mocks.subscribe.mock.calls[1][1].input.duration).toBe(4);
    });

    it("falls back to aspect=auto on unknown ratios", async () => {
      mocks.subscribe.mockResolvedValueOnce({
        requestId: "req-aspect",
        data: { video: { url: "https://x" } },
      });

      await provider.generateVideo("p", {
        prompt: "p",
        aspectRatio: "5:3" as unknown as "16:9",
      });

      expect(mocks.subscribe.mock.calls[0][1].input.aspect_ratio).toBe("auto");
    });

    it("returns a structured failure when subscribe rejects", async () => {
      mocks.subscribe.mockRejectedValueOnce(new Error("rate limited"));
      const result = await provider.generateVideo("p", { prompt: "p" });
      expect(result.status).toBe("failed");
      expect(result.error).toContain("rate limited");
    });

    it("returns a structured failure when no video URL is returned", async () => {
      mocks.subscribe.mockResolvedValueOnce({
        requestId: "req-empty",
        data: {},
      });
      const result = await provider.generateVideo("p", { prompt: "p" });
      expect(result.status).toBe("failed");
      expect(result.error).toMatch(/video URL/);
    });
  });

  describe("generateVideo — image-to-video", () => {
    beforeEach(async () => {
      await provider.initialize({ apiKey: "fal_pst_test" });
    });

    it("routes to image-to-video when an HTTPS reference image is supplied", async () => {
      mocks.subscribe.mockResolvedValueOnce({
        requestId: "req-i2v",
        data: { video: { url: "https://fal.media/i2v.mp4" } },
      });

      await provider.generateVideo("zoom in slowly", {
        prompt: "zoom in slowly",
        referenceImage: "https://example.com/seed.png",
      });

      expect(mocks.subscribe.mock.calls[0][0]).toBe(
        "bytedance/seedance-2.0/image-to-video",
      );
      expect(mocks.subscribe.mock.calls[0][1].input.image_url).toBe(
        "https://example.com/seed.png",
      );
    });

    it("ignores non-HTTPS reference images and falls back to text-to-video", async () => {
      mocks.subscribe.mockResolvedValueOnce({
        requestId: "req-fallback",
        data: { video: { url: "https://x" } },
      });

      await provider.generateVideo("p", {
        prompt: "p",
        referenceImage: "data:image/png;base64,iVBORw0...",
      });

      expect(mocks.subscribe.mock.calls[0][0]).toBe(
        "bytedance/seedance-2.0/text-to-video",
      );
      expect(mocks.subscribe.mock.calls[0][1].input.image_url).toBeUndefined();
    });
  });

  describe("error handling without init", () => {
    it("returns a clean error when generateVideo is called before initialize", async () => {
      const fresh = new FalProvider();
      const result = await fresh.generateVideo("p", { prompt: "p" });
      expect(result.status).toBe("failed");
      expect(result.error).toMatch(/FAL_KEY/);
    });
  });
});
