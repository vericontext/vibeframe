import { describe, expect, it } from "vitest";

import {
  BUILD_VIDEO_PROVIDERS,
  parseBuildVideoProvider,
  resolveBuildVideoProvider,
  videoProviderConfigKey,
} from "./build-video-providers.js";

describe("build video providers", () => {
  it("accepts every listed provider, and seedance when none is given", () => {
    for (const provider of BUILD_VIDEO_PROVIDERS) {
      expect(resolveBuildVideoProvider(provider.toUpperCase())).toBe(provider);
    }
    expect(resolveBuildVideoProvider(undefined)).toBe("seedance");
  });

  it("refuses an unknown provider instead of switching to seedance", () => {
    expect(parseBuildVideoProvider("veo")).toBeNull();
    expect(() => resolveBuildVideoProvider("fal")).toThrow("`fal` was renamed to `seedance` (same FAL_API_KEY).");
    expect(() => resolveBuildVideoProvider("veo")).toThrow(/Veo 3\.1 shut down on 2026-10-22; Gemini Omni \(omni\)/);
    expect(() => resolveBuildVideoProvider("bogus")).toThrow('Unknown video provider "bogus". Available: seedance, grok, kling, runway, omni.');
  });

  it("maps providers to the config key that unlocks them", () => {
    expect(videoProviderConfigKey("omni")).toBe("google");
    expect(videoProviderConfigKey("seedance")).toBe("fal");
    expect(videoProviderConfigKey("grok")).toBe("xai");
    expect(videoProviderConfigKey("kling")).toBe("kling");
  });
});
