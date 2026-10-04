import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { describeVideoContract } from "../video/contract.testkit.js";
import { FakeProviderNetwork, jsonResponse } from "../testing/fake-provider-network.js";
import { KlingProvider, klingErrorKind } from "./KlingProvider.js";

const HOST = "api.klingai.com";

const ok = (data: Record<string, unknown>) => jsonResponse({ code: 0, message: "SUCCEED", request_id: "r", data });

function scriptJob(net: FakeProviderNetwork, final: Record<string, unknown>): void {
  let polls = 0;
  net
    .on("POST", HOST, /^\/v1\/videos\/(text2video|image2video|video-extend)$/, () =>
      ok({ task_id: "task-1", task_status: "submitted" })
    )
    .on("GET", HOST, /^\/v1\/videos\/(text2video|image2video|video-extend)\/task-1$/, () =>
      ok(++polls < 2 ? { task_id: "task-1", task_status: "processing" } : { task_id: "task-1", ...final })
    );
}

const SUCCEEDED = {
  task_status: "succeed",
  task_result: { videos: [{ id: "video-9", url: "https://fake.media/out.mp4", duration: "5.0" }] },
};

async function create() {
  const provider = new KlingProvider();
  await provider.initialize({ apiKey: "test-kling" });
  return provider;
}

describeVideoContract("KlingProvider", {
  create,
  request: { prompt: "A paper boat drifts", aspectRatio: "16:9", durationSec: 5 },
  defaultModel: "kling-v3",
  scriptSuccess: (net) => scriptJob(net, SUCCEEDED),
  scriptJobFailure: (net, reason) =>
    scriptJob(net, {
      task_status: "failed",
      task_status_msg: reason === "moderation" ? "Failure to pass the risk control system" : "Internal error",
    }),
  scriptSubmitError: (net, status, body) =>
    net.on("POST", HOST, /^\/v1\/videos\/text2video$/, () => jsonResponse(body, status)),
  cancel: false,
  continuations: ["extend"],
});

describe("KlingProvider specifics", () => {
  let net: FakeProviderNetwork;

  beforeEach(() => {
    net = new FakeProviderNetwork();
    net.install();
  });

  afterEach(() => net.uninstall());

  it("maps Kling service codes to error kinds", () => {
    expect(klingErrorKind(1102)).toBe("quota");
    expect(klingErrorKind("1301")).toBe("moderation");
    expect(klingErrorKind(1302)).toBe("rate-limit");
    expect(klingErrorKind(1002)).toBe("auth");
    expect(klingErrorKind(5001)).toBe("provider");
    expect(klingErrorKind(0)).toBeUndefined();
  });

  it("does not retry exhausted credits that Kling sends as 429", async () => {
    net.on("POST", HOST, /text2video$/, () => jsonResponse({ code: 1102, message: "Resource pack exhausted" }, 429));
    const kling = await create();

    await expect(kling.submitVideo({ prompt: "x" })).rejects.toMatchObject({ kind: "quota", retryable: false });
    expect(net.requests).toHaveLength(1);
  });

  it("treats a non-zero code in a 200 body as a failure", async () => {
    net.on("POST", HOST, /text2video$/, () => jsonResponse({ code: 1301, message: "content security" }));
    const kling = await create();

    await expect(kling.submitVideo({ prompt: "x" })).rejects.toMatchObject({ kind: "moderation", code: "1301" });
  });

  it("polls an image-to-video job on the endpoint it was submitted to", async () => {
    scriptJob(net, SUCCEEDED);
    const kling = await create();
    const job = await kling.submitVideo({ prompt: "x", image: "https://fake.media/frame.png" });
    await kling.getVideoJob(job);

    expect(job.meta).toEqual({ type: "image2video" });
    expect(net.requests.at(-1)?.path).toBe("/v1/videos/image2video/task-1");
  });

  it("refuses a data URI before calling Kling, which only takes image URLs", async () => {
    const kling = await create();
    await expect(kling.submitVideo({ prompt: "x", image: "data:image/png;base64,AAAA" })).rejects.toMatchObject({
      kind: "invalid-request",
    });
    expect(net.requests).toHaveLength(0);
  });

  it("extends a finished job by its video ID", async () => {
    scriptJob(net, SUCCEEDED);
    const kling = await create();
    const first = await kling.submitVideo({ prompt: "x" });
    net.on("GET", HOST, /\/text2video\/task-1$/, () => ok({ task_id: "task-1", ...SUCCEEDED }));

    const extended = await kling.submitVideo({ prompt: "keep drifting", from: { job: first, kind: "extend" } });

    const post = net.requests.filter((r) => r.method === "POST").at(-1);
    expect(post?.path).toBe("/v1/videos/video-extend");
    expect(post?.body).toMatchObject({ video_id: "video-9", prompt: "keep drifting" });
    expect(extended.meta).toEqual({ type: "video-extend" });
  });
});
