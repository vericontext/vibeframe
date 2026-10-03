import { describe, expect, it } from "vitest";

import {
  BUILD_VIDEO_PROVIDERS,
  resolveBuildVideoProvider,
  videoProviderConfigKey,
} from "./build-video-providers.js";

describe("build video providers", () => {
  it("accepts every listed provider and maps the fal alias", () => {
    for (const provider of BUILD_VIDEO_PROVIDERS) {
      expect(resolveBuildVideoProvider(provider.toUpperCase())).toBe(provider);
    }
    expect(resolveBuildVideoProvider("fal")).toBe("seedance");
    expect(resolveBuildVideoProvider(undefined)).toBe("seedance");
  });

  it("maps providers to the config key that unlocks them", () => {
    expect(videoProviderConfigKey("omni")).toBe("google");
    expect(videoProviderConfigKey("veo")).toBe("google");
    expect(videoProviderConfigKey("seedance")).toBe("fal");
    expect(videoProviderConfigKey("grok")).toBe("xai");
    expect(videoProviderConfigKey("kling")).toBe("kling");
  });
});
