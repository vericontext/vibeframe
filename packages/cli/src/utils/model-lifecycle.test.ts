import type { ModelSpec } from "@vibeframe/ai-providers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { checkModelLifecycle, videoModelSpec } from "./model-lifecycle.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("videoModelSpec", () => {
  it("reads each provider's model flag, and the default without one", () => {
    expect(videoModelSpec("grok", { grokModel: "lite" })?.id).toBe("grok-imagine-video-1.5-lite");
    expect(videoModelSpec("kling", { klingModel: "v2.6" })?.id).toBe("kling-v2-6");
    expect(videoModelSpec("omni", {})?.id).toBe("gemini-omni-1.1-flash");
    expect(videoModelSpec("seedance", {})?.provider).toBe("seedance");
  });
});

describe("checkModelLifecycle", () => {
  const retiring: ModelSpec = {
    id: "video-preview",
    provider: "omni",
    kind: "video",
    label: "Video Preview",
    status: "deprecated",
    shutdown: "2026-10-22",
    replacement: "`-p omni`",
  };

  it("returns nothing for a model without a shutdown date", () => {
    expect(checkModelLifecycle(videoModelSpec("omni", {}))).toEqual([]);
  });

  it("returns the warning before the shutdown date", () => {
    const warnings = checkModelLifecycle(retiring, new Date("2026-10-04T00:00:00Z"));
    expect(warnings).toEqual([expect.stringMatching(/shuts down on 2026-10-22 \(18 days left\)\. Use `-p omni`/)]);
  });

  it("exits with a usage error after the shutdown date", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => checkModelLifecycle(retiring, new Date("2026-10-22T00:00:00Z"))).toThrow("exit");
    expect(exit).toHaveBeenCalled();
  });
});
