import { afterEach, describe, expect, it, vi } from "vitest";

import { checkModelLifecycle, videoModelSpec } from "./model-lifecycle.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("videoModelSpec", () => {
  it("reads each provider's model flag, and the default without one", () => {
    expect(videoModelSpec("veo", { veoModel: "3.1" })?.id).toBe("veo-3.1-generate-preview");
    expect(videoModelSpec("kling", { klingModel: "v2.6" })?.id).toBe("kling-v2-6");
    expect(videoModelSpec("omni", {})?.id).toBe("gemini-omni-1.1-flash");
    expect(videoModelSpec("fal", {})?.provider).toBe("seedance");
  });
});

describe("checkModelLifecycle", () => {
  const veo = () => videoModelSpec("veo", { veoModel: "3.1-fast" });

  it("returns nothing for a model without a shutdown date", () => {
    expect(checkModelLifecycle(videoModelSpec("omni", {}))).toEqual([]);
  });

  it("warns on stderr and returns the warning before the shutdown date", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const warnings = checkModelLifecycle(veo(), new Date("2026-10-04T00:00:00Z"));
    expect(warnings).toEqual([expect.stringMatching(/shuts down on 2026-10-22 \(18 days left\)\. Use `-p omni`/)]);
    expect(String(stderr.mock.calls[0]?.[0])).toMatch(/Warning: Veo 3\.1 Fast/);
  });

  it("exits with a usage error after the shutdown date", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => checkModelLifecycle(veo(), new Date("2026-10-22T00:00:00Z"))).toThrow("exit");
    expect(exit).toHaveBeenCalled();
  });
});
