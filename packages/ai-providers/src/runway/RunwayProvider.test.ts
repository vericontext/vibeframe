import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeProviderNetwork, jsonResponse } from "../testing/fake-provider-network.js";
import type { VideoJob } from "../video/contract.js";
import { RunwayProvider } from "./RunwayProvider.js";

const HOST = "api.dev.runwayml.com";
const JOB: VideoJob = { provider: "runway", id: "t1", model: "gen4.5", submittedAt: "" };

async function provider() {
  const runway = new RunwayProvider();
  await runway.initialize({ apiKey: "key" });
  return runway;
}

describe("RunwayProvider", () => {
  let net: FakeProviderNetwork;

  beforeEach(() => {
    net = new FakeProviderNetwork();
    net.install();
  });

  afterEach(() => net.uninstall());

  it("keeps polling a THROTTLED task, which is queued rather than failed", async () => {
    net.on("GET", HOST, /^\/v1\/tasks\/t1$/, () => jsonResponse({ id: "t1", status: "THROTTLED" }));
    const state = await (await provider()).getVideoJob(JOB);
    expect(state.status).toBe("pending");
    expect(state.error).toBeUndefined();
  });

  it("reports the failure code so callers can tell retryable failures apart", async () => {
    net.on("GET", HOST, /^\/v1\/tasks\/t1$/, () =>
      jsonResponse({ id: "t1", status: "FAILED", failure: "Input rejected", failureCode: "SAFETY.INPUT.TEXT" })
    );
    const state = await (await provider()).getVideoJob(JOB);
    expect(state.status).toBe("failed");
    expect(state.error?.message).toBe("Input rejected (SAFETY.INPUT.TEXT)");
  });

  it("cancels with the documented DELETE /v1/tasks/{id}", async () => {
    net.on("DELETE", HOST, /^\/v1\/tasks\/t1$/, () => new Response(null, { status: 204 }));
    await expect((await provider()).cancelVideoJob(JOB)).resolves.toBeUndefined();
    expect(net.requests).toHaveLength(1);
    expect(net.requests[0]).toMatchObject({ method: "DELETE", path: "/v1/tasks/t1" });
  });

  it("rejects square text-to-video before calling the API", async () => {
    await expect((await provider()).submitVideo({ prompt: "p", aspectRatio: "1:1" })).rejects.toMatchObject({
      kind: "invalid-request",
      message: expect.stringMatching(/16:9 and 9:16 only/),
    });
    expect(net.requests).toHaveLength(0);
  });
});
