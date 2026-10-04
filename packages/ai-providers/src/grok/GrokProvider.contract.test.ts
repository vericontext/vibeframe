import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { describeVideoContract } from "../video/contract.testkit.js";
import { FakeProviderNetwork, jsonResponse } from "../testing/fake-provider-network.js";
import { GrokProvider } from "./GrokProvider.js";

const HOST = "api.x.ai";
const DONE = { status: "done", video: { url: "https://fake.media/out.mp4", duration: 5 } };

function scriptJob(net: FakeProviderNetwork, final: Record<string, unknown>): void {
  let polls = 0;
  net
    .on("POST", HOST, /^\/v1\/videos\/(generations|edits|extensions)$/, () => jsonResponse({ request_id: "req-1" }))
    .on("GET", HOST, /^\/v1\/videos\/req-1$/, () =>
      jsonResponse(++polls < 2 ? { status: "pending", progress: 40 } : final)
    );
}

async function create() {
  const provider = new GrokProvider();
  await provider.initialize({ apiKey: "test-xai" });
  return provider;
}

describeVideoContract("GrokProvider", {
  create,
  request: { prompt: "A paper boat drifts", aspectRatio: "16:9", durationSec: 5 },
  defaultModel: "grok-imagine-video-1.5",
  scriptSuccess: (net) => scriptJob(net, DONE),
  scriptJobFailure: (net, reason) =>
    scriptJob(net, {
      status: "failed",
      error:
        reason === "moderation"
          ? { code: "content_moderated", message: "Video was blocked by content moderation" }
          : { code: "internal_error", message: "Internal error" },
    }),
  scriptSubmitError: (net, status, body) =>
    net.on("POST", HOST, /^\/v1\/videos\/generations$/, () => jsonResponse(body, status)),
  cancel: false,
  continuations: ["extend", "edit"],
});

describe("GrokProvider continuations", () => {
  let net: FakeProviderNetwork;

  beforeEach(() => {
    net = new FakeProviderNetwork();
    net.install();
    scriptJob(net, DONE);
  });

  afterEach(() => net.uninstall());

  it.each([
    ["extend", "/v1/videos/extensions", { duration: 6 }],
    ["edit", "/v1/videos/edits", {}],
  ] as const)("%ss the earlier clip by its video URL", async (kind, path, extra) => {
    const grok = await create();
    const first = await grok.submitVideo({ prompt: "x" });
    net.on("GET", HOST, /^\/v1\/videos\/req-1$/, () => jsonResponse(DONE));

    await grok.submitVideo({ prompt: "make it night", from: { job: first, kind } });

    const post = net.requests.filter((r) => r.method === "POST").at(-1);
    expect(post?.path).toBe(path);
    expect(post?.body).toMatchObject({
      model: "grok-imagine-video",
      prompt: "make it night",
      video: { url: "https://fake.media/out.mp4" },
      ...extra,
    });
  });

  it("refuses a continuation on a model that cannot do it, before sending it", async () => {
    const grok = await create();
    const first = await grok.submitVideo({ prompt: "x" });
    const before = net.requests.length;

    await expect(
      grok.submitVideo({ prompt: "y", model: "1.5", from: { job: first, kind: "extend" } })
    ).rejects.toMatchObject({ kind: "unsupported" });
    expect(net.requests).toHaveLength(before);
  });

  it("reports an expired job as a timeout", async () => {
    net.on("GET", HOST, /^\/v1\/videos\/req-1$/, () => jsonResponse({ status: "expired" }));
    const grok = await create();
    const state = await grok.getVideoJob({ provider: "grok", id: "req-1", model: "m", submittedAt: "" });
    expect(state).toMatchObject({ status: "failed", error: { kind: "timeout" } });
  });
});
