/**
 * GrokProvider unit tests (mock-based, no API calls)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GrokProvider } from "./GrokProvider.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("GrokProvider", () => {
  let provider: GrokProvider;

  beforeEach(() => {
    provider = new GrokProvider();
    mockFetch.mockReset();
  });

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

  describe("generateImage", () => {
    beforeEach(async () => {
      await provider.initialize({ apiKey: "test-key" });
    });

    it("should call xAI API with correct parameters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ b64_json: "aW1n" }],
        }),
      });

      const result = await provider.generateImage("a blue cat", {
        n: 1,
        aspectRatio: "16:9",
      });

      expect(result.success).toBe(true);
      expect(result.images).toBeDefined();
      expect(result.images!.length).toBeGreaterThan(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.x.ai/v1/images/generations");
      const body = JSON.parse(options.body);
      expect(body.prompt).toBe("a blue cat");
      expect(body.model).toBe("grok-imagine-image");
      // Base64 back, so callers never download an expiring URL.
      expect(body.response_format).toBe("b64_json");
    });

    it("should handle API error gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      const result = await provider.generateImage("test");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("generateVideo", () => {
    beforeEach(async () => {
      await provider.initialize({ apiKey: "test-key" });
    });

    it("should start video generation and return task ID", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request_id: "task-123",
          status: "pending",
        }),
      });

      const result = await provider.generateVideo("dancing robot", {
        prompt: "dancing robot",
        duration: 5,
        aspectRatio: "16:9",
      });

      expect(result.id).toBe("task-123");
      expect(result.status).toBe("pending");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("rounds float duration to integer (xAI rejects floats with 422)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ request_id: "task-float", status: "pending" }),
      });

      await provider.generateVideo("test", {
        prompt: "test",
        duration: 3.44,
        aspectRatio: "16:9",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.duration).toBe(3);
      expect(Number.isInteger(body.duration)).toBe(true);
    });

    it("clamps duration above 15 to 15 (with integer cast)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ request_id: "task-clamp", status: "pending" }),
      });

      await provider.generateVideo("test", {
        prompt: "test",
        duration: 100.7,
        aspectRatio: "16:9",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.duration).toBe(15);
    });

    it("should handle image-to-video with data URI", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request_id: "task-456",
          status: "pending",
        }),
      });

      const result = await provider.generateVideo("animate this", {
        prompt: "animate this",
        referenceImage: "data:image/png;base64,iVBOR...",
        duration: 5,
        aspectRatio: "16:9",
      });

      expect(result.id).toBe("task-456");
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.image).toBeDefined();
    });
  });

  describe("getGenerationStatus", () => {
    beforeEach(async () => {
      await provider.initialize({ apiKey: "test-key" });
    });

    it("should return completed status with video URL", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request_id: "task-123",
          status: "done",
          video: { url: "https://cdn.x.ai/video.mp4" },
        }),
      });

      const result = await provider.getGenerationStatus("task-123");

      expect(result.status).toBe("completed");
      expect(result.videoUrl).toBe("https://cdn.x.ai/video.mp4");
    });

    it("should handle expired status as failed", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request_id: "task-123",
          status: "expired",
        }),
      });

      const result = await provider.getGenerationStatus("task-123");

      expect(result.status).toBe("failed");
      expect(result.error).toContain("expired");
    });
  });
});
