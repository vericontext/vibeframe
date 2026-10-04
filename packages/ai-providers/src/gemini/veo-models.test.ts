import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GeminiProvider, resolveVeoModel, VEO_MODEL_ALIASES } from "./GeminiProvider.js";

// Veo 3.1 shuts down on 2026-10-22; pin the clock on each side of it.
const BEFORE_SHUTDOWN = new Date("2026-10-21T12:00:00Z");
const AFTER_SHUTDOWN = new Date("2026-10-22T00:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BEFORE_SHUTDOWN);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Veo model aliases", () => {
  it("maps --veo-model aliases to Veo 3.1 model IDs", () => {
    expect(resolveVeoModel("3.1")).toBe("veo-3.1-generate-preview");
    expect(resolveVeoModel("3.1-fast")).toBe("veo-3.1-fast-generate-preview");
    expect(Object.keys(VEO_MODEL_ALIASES)).toEqual(["3.1", "3.1-fast"]);
  });

  it("rejects the shut-down Veo 3.0 alias with a hint", () => {
    expect(() => resolveVeoModel("3.0")).toThrow(/shut down by Google on 2025-11-12/);
  });

  it("rejects unknown aliases instead of silently substituting a model", () => {
    expect(() => resolveVeoModel("4")).toThrow('Unknown Veo model "4". Valid: 3.1, 3.1-fast.');
    expect(() => resolveVeoModel("toString")).toThrow(/Unknown Veo model/);
  });
});

describe("Veo after its shutdown date", () => {
  it("refuses the aliases and names the replacement", () => {
    vi.setSystemTime(AFTER_SHUTDOWN);
    expect(() => resolveVeoModel("3.1-fast")).toThrow(/shut down by the provider on 2026-10-22\. Use `-p omni`/);
  });

  it("fails generation and extension without calling Google", async () => {
    vi.setSystemTime(AFTER_SHUTDOWN);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const gemini = new GeminiProvider();
    await gemini.initialize({ apiKey: "test-google" });

    const generated = await gemini.generateVideo("a paper boat");
    const extended = await gemini.extendVideo("operations/123", "keep drifting");

    expect(generated).toMatchObject({ status: "failed", error: expect.stringMatching(/Use `-p omni`/) });
    expect(extended).toMatchObject({ status: "failed", error: expect.stringMatching(/Veo 3\.1 \(veo-3\.1-generate-preview\)/) });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
