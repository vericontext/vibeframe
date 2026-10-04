/**
 * FalProvider tests against the fake provider network: the real
 * `@fal-ai/client` SDK runs, and only `fetch` is scripted, so endpoint
 * choice, payloads, the queue protocol, and storage uploads are all real.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { describeVideoContract } from "../video/contract.testkit.js";
import { FakeProviderNetwork, jsonResponse, type RecordedRequest } from "../testing/fake-provider-network.js";
import { FalProvider, estimateSeedanceVideoCostUsd, resolveSeedanceVariant } from "./FalProvider.js";

const QUEUE = "queue.fal.run";

/** Script fal's queue: accepted, one IN_PROGRESS poll, then COMPLETED with `result` (or a failing result read). */
function scriptQueue(
  net: FakeProviderNetwork,
  result: { body: unknown; status?: number } = { body: { video: { url: "https://fake.media/out.mp4" } } },
  completed: Record<string, unknown> = {}
): void {
  let polls = 0;
  net
    .on("POST", QUEUE, /^\/bytedance\//, () =>
      jsonResponse({ request_id: "req-1", status: "IN_QUEUE", queue_position: 0, response_url: "", status_url: "", cancel_url: "" })
    )
    .on("GET", QUEUE, /\/requests\/req-1\/status$/, () =>
      jsonResponse(++polls < 2 ? { status: "IN_PROGRESS", request_id: "req-1" } : { status: "COMPLETED", request_id: "req-1", ...completed })
    )
    .on("GET", QUEUE, /\/requests\/req-1$/, () =>
      jsonResponse(result.body, result.status ?? 200, { "x-fal-request-id": "req-1" })
    )
    .on("PUT", QUEUE, /\/requests\/req-1\/cancel$/, () => jsonResponse({ status: "CANCELLATION_REQUESTED" }, 202))
    // fal storage: initiate returns an upload URL and the file's public URL.
    .on("POST", "rest.fal.ai", /\/storage\/upload\/initiate$/, () =>
      jsonResponse({ upload_url: "https://fake.media/upload-target", file_url: "https://fal.storage/uploaded.png" })
    )
    .on("PUT", "fake.media", /\/upload-target$/, () => new Response(null, { status: 200 }));
}

async function create() {
  const provider = new FalProvider();
  await provider.initialize({ apiKey: "fal_pst_test" });
  return provider;
}

describeVideoContract("FalProvider (Seedance)", {
  create,
  request: { prompt: "A paper boat drifts", aspectRatio: "16:9", durationSec: 5 },
  defaultModel: "seedance-2.0",
  scriptSuccess: (net) => scriptQueue(net),
  scriptJobFailure: (net, reason) =>
    reason === "moderation"
      ? scriptQueue(net, {
          status: 422,
          body: { detail: [{ loc: ["body", "prompt"], msg: "Output flagged by the content checker", type: "content_policy_violation" }] },
        })
      : scriptQueue(net, undefined, { error: "Internal server error", error_type: "internal_server_error" }),
  scriptSubmitError: (net, status, body) => net.on("POST", QUEUE, /^\/bytedance\//, () => jsonResponse(body, status)),
  cancel: true,
  continuations: [],
});

describe("FalProvider (Seedance) requests", () => {
  let net: FakeProviderNetwork;
  const submitted = (): RecordedRequest => net.requests.find((r) => r.method === "POST" && r.host === QUEUE)!;
  const input = () => submitted().body as Record<string, unknown>;

  beforeEach(() => {
    net = new FakeProviderNetwork();
    net.install();
    scriptQueue(net);
  });

  afterEach(() => net.uninstall());

  it("submits text-to-video to the standard endpoint with string-enum duration", async () => {
    const fal = await create();
    const job = await fal.submitVideo({ prompt: "a cat surfing", aspectRatio: "16:9", durationSec: 6 });

    expect(submitted().path).toBe("/bytedance/seedance-2.0/text-to-video");
    expect(input()).toMatchObject({ prompt: "a cat surfing", aspect_ratio: "16:9", resolution: "720p", duration: "6" });
    expect(job.meta).toEqual({ endpoint: "bytedance/seedance-2.0/text-to-video" });
  });

  it("routes the fast variant and Seedance 2.5, clamping duration to each one's range", async () => {
    const fal = await create();
    await fal.submitVideo({ prompt: "p", model: "fast", durationSec: 99 });
    expect(submitted().path).toBe("/bytedance/seedance-2.0/fast/text-to-video");
    expect(input().duration).toBe("15");

    net.requests.length = 0;
    await fal.submitVideo({ prompt: "p", model: "2.5", durationSec: 99, negativePrompt: "blur", seed: 7 });
    expect(submitted().path).toBe("/bytedance/seedance-2.5/text-to-video");
    expect(input().duration).toBe("30");
    // Seedance 2.5's schema has no negative_prompt or seed.
    expect(input()).not.toHaveProperty("negative_prompt");
    expect(input()).not.toHaveProperty("seed");

    net.requests.length = 0;
    await fal.submitVideo({ prompt: "p", durationSec: 1, aspectRatio: "5:3" as "16:9" });
    expect(input()).toMatchObject({ duration: "4", aspect_ratio: "auto" });
  });

  it("routes an HTTPS first frame to image-to-video", async () => {
    const fal = await create();
    await fal.submitVideo({ prompt: "zoom in", image: "https://example.com/seed.png" });

    expect(submitted().path).toBe("/bytedance/seedance-2.0/image-to-video");
    expect(input().image_url).toBe("https://example.com/seed.png");
  });

  it("uploads a data-URI first frame instead of silently dropping it", async () => {
    const fal = await create();
    await fal.submitVideo({ prompt: "zoom in", image: "data:image/png;base64,iVBORw0KGgo=" });

    expect(submitted().path).toBe("/bytedance/seedance-2.0/image-to-video");
    expect(input().image_url).toBe("https://fal.storage/uploaded.png");
  });

  it("routes references to reference-to-video, grouped by kind, uploading data URIs", async () => {
    const fal = await create();
    await fal.submitVideo({
      prompt: "animate @Image1 with the timing of @Video1",
      references: [
        { kind: "image", url: "data:image/png;base64,iVBORw0KGgo=" },
        { kind: "image", url: "https://example.com/face.png" },
        { kind: "video", url: "https://example.com/move.mp4" },
        { kind: "audio", url: "https://example.com/voice.mp3" },
        { kind: "image", url: "/tmp/local.png" },
      ],
      generateAudio: false,
      resolution: "1080p",
    });

    expect(submitted().path).toBe("/bytedance/seedance-2.0/reference-to-video");
    expect(input()).toMatchObject({
      image_urls: ["https://fal.storage/uploaded.png", "https://example.com/face.png"],
      video_urls: ["https://example.com/move.mp4"],
      audio_urls: ["https://example.com/voice.mp3"],
      generate_audio: false,
      resolution: "1080p",
    });
  });

  it("reports the likeness filter, which fal raises when the result is read, as a failed job", async () => {
    net.on("GET", QUEUE, /\/requests\/req-1$/, () =>
      jsonResponse(
        { detail: [{ msg: "The images or videos provided may contain likenesses of real people", type: "content_policy_violation" }] },
        422
      )
    );
    const fal = await create();
    const job = await fal.submitVideo({ prompt: "p", image: "https://example.com/face.png" });
    let state = await fal.getVideoJob(job);
    while (state.status !== "failed" && state.status !== "completed") state = await fal.getVideoJob(job);

    expect(state).toMatchObject({ status: "failed", error: { kind: "likeness", status: 422, code: "content_policy_violation" } });
  });

  it("keeps the older blocking generateVideo working on top of the queue", async () => {
    const fal = await create();
    (fal as unknown as { pollingInterval: number }).pollingInterval = 1;
    const result = await fal.generateVideo("p", { prompt: "p" });

    expect(result).toMatchObject({ id: "req-1", status: "completed", videoUrl: "https://fake.media/out.mp4" });
  });

  it("fails cleanly before initialize", async () => {
    const result = await new FalProvider().generateVideo("p", { prompt: "p" });
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/FAL_API_KEY/);
  });
});

describe("estimateSeedanceVideoCostUsd", () => {
  it("matches fal's published per-second rates for 16:9", () => {
    // 720p 16:9 standard = $0.3024/s; 1080p 16:9 = $0.682/s.
    expect(estimateSeedanceVideoCostUsd({ durationSec: 5, resolution: "720p", aspectRatio: "16:9" })).toBe(1.51);
    expect(estimateSeedanceVideoCostUsd({ durationSec: 10, resolution: "1080p", aspectRatio: "16:9" })).toBe(6.8);
  });

  it("applies the fast-tier 0.8x factor (and only up to 720p)", () => {
    expect(
      estimateSeedanceVideoCostUsd({ durationSec: 5, resolution: "720p", aspectRatio: "16:9", fast: true })
    ).toBe(1.21);
    // 1080p has no fast tier — the factor must not apply.
    expect(
      estimateSeedanceVideoCostUsd({ durationSec: 10, resolution: "1080p", aspectRatio: "16:9", fast: true })
    ).toBe(6.8);
  });

  it("costs less for square/portrait ratios (fewer pixels)", () => {
    expect(estimateSeedanceVideoCostUsd({ durationSec: 5, resolution: "720p", aspectRatio: "1:1" })).toBe(0.85);
  });

  it("applies the 0.6x reference-video discount", () => {
    const base = estimateSeedanceVideoCostUsd({ durationSec: 5, resolution: "720p", aspectRatio: "16:9" });
    const withVideo = estimateSeedanceVideoCostUsd({
      durationSec: 5,
      resolution: "720p",
      aspectRatio: "16:9",
      hasVideoReference: true,
    });
    expect(withVideo).toBeCloseTo(base * 0.6, 2);
  });

  it("prices Seedance 2.5 at its own per-token rates", () => {
    expect(estimateSeedanceVideoCostUsd({ durationSec: 5, resolution: "720p", aspectRatio: "16:9", v25: true })).toBe(2.31);
    expect(estimateSeedanceVideoCostUsd({ durationSec: 4, resolution: "1080p", aspectRatio: "16:9", v25: true })).toBe(4.55);
  });

  it("defaults to 720p 16:9 when resolution/ratio are omitted", () => {
    expect(estimateSeedanceVideoCostUsd({ durationSec: 5 })).toBe(1.51);
  });
});

describe("resolveSeedanceVariant", () => {
  it("maps CLI aliases to variants", () => {
    expect(resolveSeedanceVariant(undefined)).toBe("seedance-2.0");
    expect(resolveSeedanceVariant("quality")).toBe("seedance-2.0");
    expect(resolveSeedanceVariant("FAST")).toBe("seedance-2.0-fast");
    expect(resolveSeedanceVariant("2.5")).toBe("seedance-2.5");
  });

  it("rejects unknown variants instead of substituting one", () => {
    expect(() => resolveSeedanceVariant("3.0")).toThrow(/Unknown Seedance model "3.0"/);
  });
});
