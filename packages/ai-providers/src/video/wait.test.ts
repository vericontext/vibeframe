import { describe, expect, it, vi } from "vitest";

import type { VideoGenerator, VideoJob, VideoJobState } from "./contract.js";
import { ProviderError } from "../shared/errors.js";
import { waitForVideoJob } from "./wait.js";

const job: VideoJob = { provider: "test", id: "j1", model: "m", submittedAt: "2026-10-04T00:00:00Z" };

function generator(states: Array<VideoJobState | Error>): VideoGenerator {
  return {
    id: "test",
    submitVideo: vi.fn(),
    downloadVideo: vi.fn(),
    getVideoJob: vi.fn(async () => {
      const next = states.shift() ?? { status: "processing" };
      if (next instanceof Error) throw next;
      return next;
    }),
  };
}

describe("waitForVideoJob", () => {
  it("polls until a terminal state, riding out retryable read errors", async () => {
    const gen = generator([
      { status: "queued" },
      new ProviderError({ kind: "rate-limit", provider: "test", message: "slow down" }),
      { status: "completed", videoUrl: "https://fake.media/out.mp4" },
    ]);

    await expect(waitForVideoJob(gen, job, { intervalMs: 1 })).resolves.toMatchObject({ status: "completed" });
    expect(gen.getVideoJob).toHaveBeenCalledTimes(3);
  });

  it("throws a read error that retrying cannot fix", async () => {
    const gen = generator([new ProviderError({ kind: "auth", provider: "test", message: "bad key" })]);
    await expect(waitForVideoJob(gen, job, { intervalMs: 1 })).rejects.toMatchObject({ kind: "auth" });
  });

  it("times out with the job ID so the caller can check it later", async () => {
    const gen = generator([]);
    await expect(waitForVideoJob(gen, job, { intervalMs: 5, timeoutMs: 12 })).rejects.toMatchObject({
      kind: "timeout",
      message: expect.stringContaining("job j1"),
    });
  });

  it("stops when the signal aborts", async () => {
    const controller = new AbortController();
    const waiting = waitForVideoJob(generator([]), job, { intervalMs: 50, signal: controller.signal });
    controller.abort(new Error("stopped"));
    await expect(waiting).rejects.toThrow("stopped");
  });
});
