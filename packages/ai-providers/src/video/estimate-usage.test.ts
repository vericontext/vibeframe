/**
 * `estimateUsage`: what a Grok or Omni request can bill, before the
 * provider meters the finished job. Pure: no request, no key.
 */

import { describe, expect, it } from "vitest";

import { OmniProvider } from "../gemini/gemini-omni.js";
import { GrokProvider } from "../grok/GrokProvider.js";
import { priceRecord } from "../usage/price.js";
import type { VideoJob, VideoRequest } from "./contract.js";

const price = (usage: ReturnType<NonNullable<GrokProvider["estimateUsage"]>>) => priceRecord({ ...usage, at: 0 });
const grokJob: VideoJob = { provider: "grok", id: "job-1", model: "grok-imagine-video-1.5-lite", submittedAt: "" };
const omniJob: VideoJob = { provider: "omni", id: "int-1", model: "gemini-omni-1.1-flash", submittedAt: "" };
const ask = (rest: Partial<VideoRequest> = {}): VideoRequest => ({ prompt: "a paper boat", ...rest });

describe("Grok estimateUsage", () => {
  const grok = new GrokProvider();

  it("prices a generation at its model and resolution", () => {
    expect(price(grok.estimateUsage(ask({ model: "grok-imagine-video-1.5-lite", durationSec: 3 })))).toBeCloseTo(0.09, 6);
    expect(price(grok.estimateUsage(ask({ model: "grok-imagine-video-1.5-lite", durationSec: 3, resolution: "480p" })))).toBeCloseTo(0.06, 6);
  });

  it("leaves a resolution the catalog does not price unpriced", () => {
    expect(price(grok.estimateUsage(ask({ durationSec: 5, resolution: "1080p" })))).toBeUndefined();
  });

  it("prices an extension by the seconds added and an edit by the longest output, on the continuation model", () => {
    const extend = grok.estimateUsage(ask({ durationSec: 2, from: { job: grokJob, kind: "extend" } }));
    expect(extend).toMatchObject({ model: "grok-imagine-video", size: "720p", amount: { unit: "seconds", count: 2 } });
    // xAI billed $0.17 for a 2 s extension and $0.40 for a 5 s edit (probe, 2026-11-16).
    expect(price(extend)).toBeGreaterThanOrEqual(0.17);
    const edit = grok.estimateUsage(ask({ from: { job: grokJob, kind: "edit" } }));
    expect(edit.amount).toEqual({ unit: "seconds", count: 8.7 });
    expect(price(edit)).toBeGreaterThanOrEqual(0.4);
  });
});

describe("Omni estimateUsage", () => {
  const omni = new OmniProvider();

  it("takes the 10 s clip ceiling, at about $0.10 a second", () => {
    const usd = price(omni.estimateUsage(ask()))!;
    // A real 10 s clip billed 57,920 video and 432 thought tokens: about $1.02.
    expect(usd).toBeGreaterThanOrEqual(1.02);
    expect(usd).toBeLessThan(1.1);
  });

  it("counts the earlier clip as input for a continuation", () => {
    const fresh = price(omni.estimateUsage(ask()))!;
    const edit = price(omni.estimateUsage(ask({ from: { job: omniJob, kind: "edit" } })))!;
    expect(edit - fresh).toBeCloseTo(58_000 * 1.5e-6, 6);
  });

  it("refuses to guess at upscaled resolutions", () => {
    expect(() => omni.estimateUsage(ask({ resolution: "4k" }))).toThrow(/not documented/);
  });
});
