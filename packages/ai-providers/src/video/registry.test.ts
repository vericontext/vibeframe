import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeProviderNetwork, jsonResponse } from "../testing/fake-provider-network.js";
import { VIDEO_GENERATOR_PROVIDERS, createVideoGenerator } from "./registry.js";

describe("createVideoGenerator", () => {
  it("returns an initialized generator for every video provider", async () => {
    for (const provider of VIDEO_GENERATOR_PROVIDERS) {
      const generator = await createVideoGenerator(provider, "test-key");
      expect(generator.id).toBe(provider);
      expect(["url", "data-uri", "either"]).toContain(generator.imageInput);
    }
  });

  it("accepts fal as the old name for seedance and rejects unknown providers", async () => {
    expect((await createVideoGenerator("fal", "k")).id).toBe("seedance");
    await expect(createVideoGenerator("sora", "k")).rejects.toMatchObject({ kind: "invalid-request" });
  });
});

describe("job lookups from a bare task ID", () => {
  let net: FakeProviderNetwork;

  beforeEach(() => {
    net = new FakeProviderNetwork();
    net.install();
  });

  afterEach(() => net.uninstall());

  it("Kling tries image-to-video when text-to-video does not know the task", async () => {
    net
      .on("GET", "api.klingai.com", /\/text2video\/t-9$/, () => jsonResponse({ code: 1203, message: "task not found" }, 404))
      .on("GET", "api.klingai.com", /\/image2video\/t-9$/, () =>
        jsonResponse({ code: 0, message: "ok", request_id: "r", data: { task_id: "t-9", task_status: "processing" } })
      );
    const kling = await createVideoGenerator("kling", "k");

    const state = await kling.getVideoJob({ provider: "kling", id: "t-9", model: "kling-v3", submittedAt: "" });

    expect(state.status).toBe("processing");
    expect(net.requests.map((r) => r.path)).toEqual(["/v1/videos/text2video/t-9", "/v1/videos/image2video/t-9"]);
  });

  it("Seedance polls a bare request ID on its model's app", async () => {
    net.on("GET", "queue.fal.run", /\/bytedance\/seedance-2.0\/requests\/r-9\/status$/, () =>
      jsonResponse({ status: "IN_PROGRESS", request_id: "r-9" })
    );
    const seedance = await createVideoGenerator("seedance", "k");

    const state = await seedance.getVideoJob({ provider: "seedance", id: "r-9", model: "seedance-2.0", submittedAt: "" });

    expect(state.status).toBe("processing");
  });
});
