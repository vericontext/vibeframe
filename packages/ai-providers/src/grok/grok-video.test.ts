import { afterEach, describe, expect, it, vi } from "vitest";

import { GrokProvider, resolveGrokVideoModel } from "./GrokProvider.js";

describe("resolveGrokVideoModel", () => {
  it("defaults to grok-imagine-video-1.5 and maps aliases", () => {
    expect(resolveGrokVideoModel(undefined)).toBe("grok-imagine-video-1.5");
    expect(resolveGrokVideoModel("lite")).toBe("grok-imagine-video-1.5-lite");
    expect(resolveGrokVideoModel("classic")).toBe("grok-imagine-video");
  });

  it("rejects unknown models", () => {
    expect(() => resolveGrokVideoModel("2.0")).toThrow(/Unknown Grok video model/);
  });
});

describe("GrokProvider video", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for 720p by default since xAI otherwise renders 480p", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ request_id: "r1" })));
    vi.stubGlobal("fetch", fetchMock);
    const grok = new GrokProvider();
    await grok.initialize({ apiKey: "key" });

    await grok.generateVideo("p", { prompt: "p", resolution: "4k" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe("grok-imagine-video-1.5");
    expect(body.resolution).toBe("720p");
  });

  it("treats a failed job as terminal with the provider's message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: "failed", error: { code: "moderation", message: "blocked" } }))
      )
    );
    const grok = new GrokProvider();
    await grok.initialize({ apiKey: "key" });

    const result = await grok.getGenerationStatus("r1");
    expect(result.status).toBe("failed");
    expect(result.error).toContain("blocked");
  });
});
