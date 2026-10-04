/**
 * Video executors against the fake provider network: real providers, real
 * job handles, no provider-name branches in between.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FAKE_PNG, createFakeProviderNetwork, jsonResponse, type FakeProviderNetwork } from "../testing/fake-provider-network.js";
import { executeVideoCancel, executeVideoExtend, executeVideoGenerate, executeVideoStatus } from "./ai-video.js";

const KLING = "api.klingai.com";
const kling = (data: Record<string, unknown>) => jsonResponse({ code: 0, message: "ok", request_id: "r", data });

let net: FakeProviderNetwork;
let dir: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  Object.assign(process.env, {
    FAL_API_KEY: "test-fal",
    KLING_API_KEY: "test-kling",
    RUNWAY_API_SECRET: "test-runway",
    IMGBB_API_KEY: "test-imgbb",
    VIBE_UPLOAD_PROVIDER: "imgbb",
  });
  dir = mkdtempSync(join(tmpdir(), "ai-video-network-"));
  net = createFakeProviderNetwork();
  net.install();
});

afterEach(() => {
  net.uninstall();
  process.env = { ...savedEnv };
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("video executors over the provider network", () => {
  it("defaults to the configured video provider, not Kling", async () => {
    const result = await executeVideoGenerate({ prompt: "a paper boat", wait: false });

    expect(result).toMatchObject({ success: true, provider: "seedance", status: "processing" });
    expect(result.job).toMatchObject({ provider: "seedance", model: "seedance-2.0" });
  });

  it("uploads a local first frame for Kling, which only takes URLs, and keeps the task type in the handle", async () => {
    const frame = join(dir, "frame.png");
    writeFileSync(frame, FAKE_PNG);
    net.on("POST", KLING, /\/image2video$/, () => kling({ task_id: "k-1", task_status: "submitted" }));

    const result = await executeVideoGenerate({ prompt: "p", provider: "kling", image: frame, wait: false });

    expect(result.job).toMatchObject({ provider: "kling", id: "k-1", meta: { type: "image2video" } });
    const submit = net.to(KLING).find((r) => r.method === "POST");
    expect(submit?.body).toMatchObject({ image: "https://fake.media/upload.png" });
    expect(net.to("api.imgbb.com")).toHaveLength(1);
  });

  it("never fetches an image URL for an inline-only provider", async () => {
    process.env.GOOGLE_API_KEY = "test-google";

    const result = await executeVideoGenerate({
      prompt: "p",
      provider: "omni",
      image: "http://169.254.169.254/latest/meta-data/",
      wait: false,
    });

    expect(result).toMatchObject({ success: false, errorKind: "invalid-request" });
    expect(net.requests).toHaveLength(0);
  });

  it("polls a stored handle on the endpoint it was submitted to", async () => {
    net.on("GET", KLING, /\/image2video\/k-1$/, () =>
      kling({ task_id: "k-1", task_status: "succeed", task_result: { videos: [{ id: "v-1", url: "https://fake.media/k.mp4", duration: "5" }] } })
    );
    const out = join(dir, "out.mp4");

    const result = await executeVideoStatus({
      taskId: "k-1",
      job: { provider: "kling", id: "k-1", model: "kling-v3", submittedAt: "", meta: { type: "image2video" } },
      output: out,
    });

    expect(result).toMatchObject({ success: true, status: "completed", videoUrl: "https://fake.media/k.mp4" });
    expect(readFileSync(out).length).toBeGreaterThan(0);
  });

  it("refuses to cancel on a provider with no cancel API, and cancels Runway", async () => {
    await expect(executeVideoCancel({ taskId: "k-1", provider: "kling" })).resolves.toMatchObject({
      success: false,
      errorKind: "unsupported",
    });
    net.on("DELETE", "api.dev.runwayml.com", /\/v1\/tasks\/rw-1$/, () => new Response(null, { status: 204 }));
    await expect(executeVideoCancel({ taskId: "rw-1", provider: "runway" })).resolves.toEqual({ success: true });
  });

  it("extends a Kling video by the task ID the generation returned", async () => {
    net
      .on("GET", KLING, /\/text2video\/k-2$/, () =>
        kling({ task_id: "k-2", task_status: "succeed", task_result: { videos: [{ id: "v-2", url: "https://fake.media/k.mp4", duration: "5" }] } })
      )
      .on("POST", KLING, /\/video-extend$/, () => kling({ task_id: "k-3", task_status: "submitted" }));

    const result = await executeVideoExtend({ videoId: "k-2", provider: "kling", prompt: "keep drifting", wait: false });

    expect(result).toMatchObject({ success: true, taskId: "k-3", status: "processing", job: { meta: { type: "video-extend" } } });
    expect(net.to(KLING).find((r) => r.method === "POST")?.body).toMatchObject({ video_id: "v-2" });
  });

  it("hands back a still-running job, not a failure, when the wait runs out", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const started = Date.now();
    let polls = 0;
    net.on("GET", "queue.fal.run", /\/requests\/[^/]+\/status$/, () => {
      // Jump the clock past the 15-minute wait on the second poll.
      if (++polls === 2) vi.setSystemTime(started + 16 * 60_000);
      return jsonResponse({ status: "IN_PROGRESS" });
    });

    const result = await executeVideoGenerate({ prompt: "p", provider: "seedance" });

    expect(result).toMatchObject({ success: true, status: "processing", provider: "seedance" });
    expect(result.job?.id).toBeTruthy();
  }, 20_000);

  it("reports a classified failure with the task ID kept", async () => {
    net.on("GET", "queue.fal.run", /\/requests\/[^/]+$/, () =>
      jsonResponse({ detail: [{ msg: "likenesses of real people", type: "content_policy_violation" }] }, 422)
    );

    const result = await executeVideoGenerate({ prompt: "p", provider: "seedance" });

    expect(result).toMatchObject({ success: false, errorKind: "likeness", taskId: "fal-1" });
  });
});
