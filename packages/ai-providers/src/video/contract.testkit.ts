/**
 * The contract every `VideoGenerator` must meet, as a reusable test suite.
 *
 * A provider test supplies a fixture that scripts its API on the fake
 * provider network; the suite then checks the behaviour callers rely on:
 * job handles, polling to a downloadable result, classified failures, model
 * validation before any request, and continuation/cancel support as
 * declared. Moving a provider onto the contract means passing this suite.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FAKE_MP4, FakeProviderNetwork } from "../testing/fake-provider-network.js";
import type { VideoGenerator, VideoRequest } from "./contract.js";
import { ProviderError, type ProviderErrorKind } from "../shared/errors.js";
import { waitForVideoJob } from "./wait.js";

export interface VideoContractFixture {
  /** A generator initialized with a test key. */
  create(): Promise<VideoGenerator>;
  /** A request the provider accepts. */
  request: VideoRequest;
  /** The catalog model ID a request without `model` runs on. */
  defaultModel: string;
  /** Script a job that is accepted, runs, and completes with `https://fake.media/out.mp4`. */
  scriptSuccess(net: FakeProviderNetwork): void;
  /** Script a job that is accepted and then fails for this reason. */
  scriptJobFailure(net: FakeProviderNetwork, reason: "moderation" | "provider"): void;
  /** Script submission answering with this HTTP status and body. */
  scriptSubmitError(net: FakeProviderNetwork, status: number, body: unknown): void;
  /** Whether `cancelVideoJob` exists; when true, `scriptSuccess` must also accept the cancel call. */
  cancel: boolean;
  /** Continuations the provider supports. */
  continuations: ReadonlyArray<"extend" | "edit">;
}

async function rejection(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError);
    return error as ProviderError;
  }
  throw new Error("expected a ProviderError");
}

export function describeVideoContract(name: string, fixture: VideoContractFixture): void {
  describe(`${name} meets the video job contract`, () => {
    let net: FakeProviderNetwork;

    beforeEach(() => {
      net = new FakeProviderNetwork();
      net.on("GET", "fake.media", /\/out\.mp4$/, () => new Response(new Uint8Array(FAKE_MP4)));
      net.install();
    });

    afterEach(() => net.uninstall());

    it("submits a job whose handle names the provider, ID, and default model", async () => {
      fixture.scriptSuccess(net);
      const generator = await fixture.create();
      const job = await generator.submitVideo(fixture.request);

      expect(job.provider).toBe(generator.id);
      expect(job.id).toEqual(expect.any(String));
      expect(job.id).not.toBe("");
      expect(job.model).toBe(fixture.defaultModel);
      expect(Number.isNaN(Date.parse(job.submittedAt))).toBe(false);
      // The handle is plain data: it survives a trip through JSON.
      expect(JSON.parse(JSON.stringify(job))).toEqual(job);
    });

    it("polls to a completed state and downloads the video", async () => {
      fixture.scriptSuccess(net);
      const generator = await fixture.create();
      const job = await generator.submitVideo(fixture.request);
      const seen: string[] = [];
      const state = await waitForVideoJob(generator, job, { intervalMs: 1, onProgress: (s) => seen.push(s.status) });

      expect(state.status).toBe("completed");
      expect(state.videoUrl).toBe("https://fake.media/out.mp4");
      expect(state.error).toBeUndefined();
      expect(seen.at(-1)).toBe("completed");
      expect(Buffer.from(await generator.downloadVideo(job, state))).toEqual(FAKE_MP4);
    });

    it.each(["moderation", "provider"] as const)("reports a job that fails for %s with that error kind", async (reason) => {
      fixture.scriptJobFailure(net, reason);
      const generator = await fixture.create();
      const job = await generator.submitVideo(fixture.request);
      const state = await waitForVideoJob(generator, job, { intervalMs: 1 });

      expect(state.status).toBe("failed");
      expect(state.error).toMatchObject({ kind: reason, provider: generator.id });
      expect(state.error?.message).not.toBe("");
    });

    it.each([
      [401, { error: "Invalid API key" }, "auth"],
      [422, { error: "duration must be at most 10" }, "invalid-request"],
    ] as Array<[number, unknown, ProviderErrorKind]>)(
      "throws a classified error when submission returns %i",
      async (status, body, kind) => {
        fixture.scriptSubmitError(net, status, body);
        const generator = await fixture.create();
        const error = await rejection(generator.submitVideo(fixture.request));

        expect(error.kind).toBe(kind);
        expect(error.provider).toBe(generator.id);
        expect(error.status).toBe(status);
      }
    );

    it("rejects an unknown model before sending anything", async () => {
      const generator = await fixture.create();
      const error = await rejection(generator.submitVideo({ ...fixture.request, model: "no-such-model" }));

      expect(error.kind).toBe("invalid-request");
      expect(net.requests).toHaveLength(0);
    });

    it("declares its continuations: unsupported ones throw before sending anything", async () => {
      fixture.scriptSuccess(net);
      const generator = await fixture.create();
      const job = await generator.submitVideo(fixture.request);
      const before = net.requests.length;
      for (const kind of (["extend", "edit"] as const).filter((k) => !fixture.continuations.includes(k))) {
        const error = await rejection(generator.submitVideo({ ...fixture.request, from: { job, kind } }));
        expect(error.kind).toBe("unsupported");
      }
      expect(net.requests).toHaveLength(before);
    });

    it(fixture.cancel ? "cancels a running job" : "has no cancel method", async () => {
      fixture.scriptSuccess(net);
      const generator = await fixture.create();
      if (!fixture.cancel) {
        expect(generator.cancelVideoJob).toBeUndefined();
        return;
      }
      const job = await generator.submitVideo(fixture.request);
      await expect(generator.cancelVideoJob?.(job)).resolves.toBeUndefined();
      expect(net.requests.at(-1)?.method).toMatch(/DELETE|POST|PUT/);
    });
  });
}
