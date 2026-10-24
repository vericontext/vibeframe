import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeProviderNetwork, jsonResponse } from "../testing/fake-provider-network.js";
import { GrokProvider, resolveGrokVideoModel } from "./GrokProvider.js";

const HOST = "api.x.ai";

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
  let net: FakeProviderNetwork;

  beforeEach(() => {
    net = new FakeProviderNetwork();
    net.install();
  });

  afterEach(() => net.uninstall());

  async function create() {
    const grok = new GrokProvider();
    await grok.initialize({ apiKey: "key" });
    return grok;
  }

  it("asks for 720p by default since xAI otherwise renders 480p", async () => {
    net.on("POST", HOST, /^\/v1\/videos\/generations$/, () => jsonResponse({ request_id: "r1" }));
    await (await create()).submitVideo({ prompt: "p", resolution: "4k" });
    expect(net.requests[0].body).toMatchObject({ model: "grok-imagine-video-1.5", resolution: "720p" });
  });

  it("treats a failed job as terminal with the provider's message", async () => {
    net.on("GET", HOST, /^\/v1\/videos\/r1$/, () =>
      jsonResponse({ status: "failed", error: { code: "moderation", message: "blocked" } })
    );
    const state = await (await create()).getVideoJob({ provider: "grok", id: "r1", model: "m", submittedAt: "" });
    expect(state.status).toBe("failed");
    expect(state.error?.message).toContain("blocked");
  });
});
