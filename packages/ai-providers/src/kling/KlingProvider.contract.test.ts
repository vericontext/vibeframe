import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { describeVideoContract } from "../video/contract.testkit.js";
import { FakeProviderNetwork, jsonResponse } from "../testing/fake-provider-network.js";
import { meterUsage } from "../usage/meter.js";
import { KlingProvider, klingErrorKind } from "./KlingProvider.js";

const HOST = "api-singapore.klingai.com";

const ok = (data: unknown) => jsonResponse({ code: 0, message: "SUCCEED", request_id: "r", data });

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

/** The new API: create on `/{task}/{model}`, poll `GET /tasks?task_ids=`. */
function scriptTask(net: FakeProviderNetwork, final: Record<string, unknown>): void {
  let polls = 0;
  net
    .on("POST", HOST, /^\/(text|image)-to-video\/kling-[\w.-]+$/, () =>
      ok({ id: "task-4", status: "submitted", create_time: 1, update_time: 1 })
    )
    .on("GET", HOST, /^\/tasks$/, (req) => {
      expect(new URL(req.url).searchParams.get("task_ids")).toBe("task-4");
      return ok([++polls < 2 ? { id: "task-4", status: "processing" } : { id: "task-4", ...final }]);
    });
}

const SUCCEEDED = {
  task_status: "succeed",
  task_result: { videos: [{ id: "video-9", url: "https://fake.media/out.mp4", duration: "5.0" }] },
};

const TASK_SUCCEEDED = {
  status: "succeeded",
  message: "",
  outputs: [{ type: "video", id: "video-4", url: "https://fake.media/out.mp4", watermark_url: "", duration: "5" }],
  billing: [{ charge_type: "cash", amount: "0.785", currency: "USD" }],
};

async function create(apiKey = "test-kling") {
  const provider = new KlingProvider();
  await provider.initialize({ apiKey });
  return provider;
}

describeVideoContract("KlingProvider (legacy API)", {
  create: () => create(),
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

describeVideoContract("KlingProvider (Kling 4.0, new API)", {
  create: () => create(),
  request: { prompt: "A paper boat drifts", model: "4.0", aspectRatio: "16:9", durationSec: 5 },
  defaultModel: "kling-4.0",
  scriptSuccess: (net) => scriptTask(net, TASK_SUCCEEDED),
  scriptJobFailure: (net, reason) =>
    scriptTask(net, {
      status: "failed",
      message: reason === "moderation" ? "Failure to pass the risk control system" : "Internal error",
    }),
  scriptSubmitError: (net, status, body) =>
    net.on("POST", HOST, /^\/text-to-video\/kling-4\.0$/, () => jsonResponse(body, status)),
  cancel: false,
  // Kling's video-extend is a legacy endpoint for legacy models.
  continuations: [],
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
    expect(klingErrorKind(1101)).toBe("quota");
    expect(klingErrorKind("1301")).toBe("moderation");
    expect(klingErrorKind(1300)).toBe("moderation");
    expect(klingErrorKind(1302)).toBe("rate-limit");
    expect(klingErrorKind(1002)).toBe("auth");
    expect(klingErrorKind(1103)).toBe("auth");
    expect(klingErrorKind(1201)).toBe("invalid-request");
    expect(klingErrorKind(1203)).toBe("not-found");
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

describe("KlingProvider legacy models", () => {
  let net: FakeProviderNetwork;

  beforeEach(() => {
    net = new FakeProviderNetwork();
    net.install();
  });

  afterEach(() => net.uninstall());

  it.each([
    ["v3", "kling-v3", "5"],
    ["v2.6", "kling-v2-6", "10"],
    ["v2.5-turbo", "kling-v2-5-turbo", "10"],
  ])("sends --kling-model %s to the legacy endpoint as model_name %s", async (alias, modelName, duration) => {
    scriptJob(net, SUCCEEDED);
    const kling = await create();
    await kling.submitVideo({ prompt: "x", model: alias, durationSec: Number(duration) });

    const post = net.requests[0];
    expect(post.host).toBe(HOST);
    expect(post.path).toBe("/v1/videos/text2video");
    expect(post.body).toMatchObject({ model_name: modelName, mode: "std", duration });
  });

  it("maps 1080p to pro mode and meters the length at that resolution", async () => {
    scriptJob(net, SUCCEEDED);
    const kling = await create();
    const { usage } = await meterUsage(() => kling.submitVideo({ prompt: "x", resolution: "1080p", durationSec: 8 }));

    expect(net.requests[0].body).toMatchObject({ mode: "pro", duration: "8" });
    expect(usage).toEqual([
      expect.objectContaining({ provider: "kling", kind: "video", model: "kling-v3", amount: { unit: "seconds", count: 8 }, size: "1080p" }),
    ]);
  });

  it("refuses a resolution the model does not render, before any request", async () => {
    const kling = await create();
    await expect(kling.submitVideo({ prompt: "x", resolution: "4k" })).rejects.toMatchObject({ kind: "invalid-request" });
    expect(net.requests).toHaveLength(0);
  });
});

describe("KlingProvider new API (Kling 4.0, 3.0 Turbo)", () => {
  let net: FakeProviderNetwork;

  beforeEach(() => {
    net = new FakeProviderNetwork();
    net.install();
  });

  afterEach(() => net.uninstall());

  it("posts text-to-video to the model's path with a Bearer API key and no model_name", async () => {
    scriptTask(net, TASK_SUCCEEDED);
    const kling = await create("single-api-key");
    const job = await kling.submitVideo({ prompt: "A paper boat drifts", model: "4.0", aspectRatio: "9:16", durationSec: 12 });

    const post = net.requests[0];
    expect(post).toMatchObject({ method: "POST", host: HOST, path: "/text-to-video/kling-4.0" });
    expect(post.headers.authorization).toBe("Bearer single-api-key");
    expect(post.body).toEqual({
      prompt: "A paper boat drifts",
      settings: { resolution: "720p", aspect_ratio: "9:16", duration: 12 },
    });
    expect(job).toMatchObject({ id: "task-4", model: "kling-4.0", meta: { type: "text-to-video", api: "model-path" } });
  });

  it("posts image-to-video as typed contents with first and last frames, following the image's aspect ratio", async () => {
    scriptTask(net, TASK_SUCCEEDED);
    const kling = await create();
    await kling.submitVideo({
      prompt: "she turns",
      model: "kling-4.0",
      image: "https://fake.media/first.png",
      lastFrame: "https://fake.media/last.png",
      aspectRatio: "16:9",
      resolution: "1080p",
      durationSec: 30,
    });

    const post = net.requests[0];
    expect(post.path).toBe("/image-to-video/kling-4.0");
    expect(post.body).toEqual({
      contents: [
        { type: "prompt", text: "she turns" },
        { type: "first_frame", url: "https://fake.media/first.png" },
        { type: "last_frame", url: "https://fake.media/last.png" },
      ],
      settings: { resolution: "1080p", duration: 30 },
    });
  });

  it("runs Kling 3.0 Turbo on its own path and refuses a last frame it cannot take", async () => {
    scriptTask(net, TASK_SUCCEEDED);
    const kling = await create();
    await kling.submitVideo({ prompt: "x", model: "3.0-turbo", image: "https://fake.media/first.png", durationSec: 3 });
    expect(net.requests[0].path).toBe("/image-to-video/kling-3.0-turbo");

    await expect(
      kling.submitVideo({ prompt: "x", model: "3.0-turbo", image: "https://fake.media/a.png", lastFrame: "https://fake.media/b.png" })
    ).rejects.toMatchObject({ kind: "invalid-request" });
    expect(net.requests).toHaveLength(1);
  });

  it("polls /tasks, maps statuses, and reads the video output", async () => {
    scriptTask(net, TASK_SUCCEEDED);
    const kling = await create();
    const job = await kling.submitVideo({ prompt: "x", model: "4.0" });

    expect(await kling.getVideoJob(job)).toEqual({ status: "processing" });
    expect(await kling.getVideoJob(job)).toEqual({
      status: "completed",
      videoUrl: "https://fake.media/out.mp4",
      outputId: "video-4",
      durationSec: 5,
    });
    const poll = net.requests.at(-1)!;
    expect(poll).toMatchObject({ method: "GET", path: "/tasks" });
    expect(poll.headers.authorization).toBe("Bearer test-kling");
  });

  it("reports a submitted task as pending and a success without a video as a provider failure", async () => {
    net.on("GET", HOST, /^\/tasks$/, () => ok([{ id: "t", status: "submitted" }]));
    const kling = await create();
    const job = { provider: "kling", id: "t", model: "kling-4.0", submittedAt: "", meta: { type: "text-to-video", api: "model-path" } };
    expect(await kling.getVideoJob(job)).toEqual({ status: "pending" });

    net.on("GET", HOST, /^\/tasks$/, () => ok([{ id: "t", status: "succeeded", outputs: [] }]));
    expect(await kling.getVideoJob(job)).toMatchObject({ status: "failed", error: { kind: "provider" } });
  });

  it("reads a bare new-API task ID through /tasks once the legacy endpoints say not found", async () => {
    net
      .on("GET", HOST, /^\/v1\/videos\/(text2video|image2video)\/t-4$/, () => jsonResponse({ code: 1203, message: "task not found" }, 404))
      .on("GET", HOST, /^\/tasks$/, () => ok([{ id: "t-4", ...TASK_SUCCEEDED }]));
    const kling = await create();
    const state = await kling.getVideoJob({ provider: "kling", id: "t-4", model: "kling-v3", submittedAt: "" });
    expect(state).toMatchObject({ status: "completed", videoUrl: "https://fake.media/out.mp4" });
  });

  it("meters the requested seconds at the requested resolution when the job is accepted", async () => {
    scriptTask(net, TASK_SUCCEEDED);
    const kling = await create();
    const request = { prompt: "x", model: "4.0", durationSec: 3, providerOptions: { mode: "pro" } };
    const { usage } = await meterUsage(() => kling.submitVideo(request));

    const expected = { provider: "kling", kind: "video", model: "kling-4.0", amount: { unit: "seconds", count: 3 }, size: "1080p" };
    expect(usage).toEqual([expect.objectContaining(expected)]);
    expect(kling.usageFor(request)).toEqual(expected);
  });

  it("meters nothing when Kling refuses the job", async () => {
    net.on("POST", HOST, /^\/text-to-video\/kling-4\.0$/, () => jsonResponse({ code: 1102, message: "Resource pack exhausted" }, 429));
    const kling = await create();
    let usageCount = -1;
    await meterUsage(async () => {
      await kling.submitVideo({ prompt: "x", model: "4.0" }).catch(() => undefined);
    }).then(({ usage }) => (usageCount = usage.length));
    expect(usageCount).toBe(0);
  });

  it.each([
    [{ durationSec: 31 }, /3-30 s/],
    [{ durationSec: 2 }, /3-30 s/],
    [{ resolution: "4k" }, /720p or 1080p/],
    [{ aspectRatio: "4:5" as const }, /16:9, 9:16, or 1:1/],
    [{ negativePrompt: "blur" }, /negative prompt/],
    [{ seed: 7 }, /seed/],
    [{ generateAudio: false }, /native audio/],
    [{ lastFrame: "https://fake.media/b.png" }, /first frame/],
  ])("refuses %o before any request", async (overrides, message) => {
    const kling = await create();
    const error = await kling.submitVideo({ prompt: "x", model: "4.0", ...overrides }).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "invalid-request", message: expect.stringMatching(message) });
    expect(net.requests).toHaveLength(0);
  });

  it("caps Kling 3.0 Turbo at 15 seconds", async () => {
    const kling = await create();
    await expect(kling.submitVideo({ prompt: "x", model: "3.0-turbo", durationSec: 20 })).rejects.toMatchObject({
      kind: "invalid-request",
      message: expect.stringContaining("3-15 s"),
    });
  });

  it("rejects an access/secret pair with a clear auth error before any request", async () => {
    const kling = await create("access:secret");
    const error = await kling.submitVideo({ prompt: "x", model: "4.0" }).catch((e: unknown) => e);

    expect(error).toMatchObject({ kind: "auth", retryable: false });
    expect((error as Error).message).toMatch(/accepts only an API key.*ACCESS_KEY:SECRET_KEY/);
    expect(net.requests).toHaveLength(0);
  });

  it("still signs a JWT from the access/secret pair for legacy models", async () => {
    scriptJob(net, SUCCEEDED);
    const kling = await create("access:secret");
    await kling.submitVideo({ prompt: "x", model: "v3" });
    expect(net.requests[0].path).toBe("/v1/videos/text2video");
    expect(net.requests[0].headers.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it.each([
    [401, { code: 1002, message: "Authorization is invalid" }, "auth"],
    [429, { code: 1101, message: "Account in arrears" }, "quota"],
    [400, { code: 1301, message: "Trigger the platform's content security policy" }, "moderation"],
    [400, { code: 1201, message: "Invalid parameters" }, "invalid-request"],
    [403, { code: 1103, message: "Unauthorized access to requested model" }, "auth"],
  ])("classifies a %i with Kling code %o as %s", async (status, body, kind) => {
    net.on("POST", HOST, /^\/text-to-video\/kling-4\.0$/, () => jsonResponse(body, status));
    const kling = await create();
    await expect(kling.submitVideo({ prompt: "x", model: "4.0" })).rejects.toMatchObject({ kind, code: String(body.code) });
  });

  it("refuses to extend a Kling 4.0 video before any request", async () => {
    const kling = await create();
    const job = { provider: "kling", id: "t", model: "kling-4.0", submittedAt: "", meta: { type: "text-to-video", api: "model-path" } };
    await expect(kling.submitVideo({ prompt: "more", from: { job, kind: "extend" } })).rejects.toMatchObject({ kind: "unsupported" });
    expect(net.requests).toHaveLength(0);
  });
});
