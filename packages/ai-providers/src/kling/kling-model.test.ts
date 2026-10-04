import { describe, expect, it } from "vitest";

import { klingDuration, resolveKlingModel } from "./KlingProvider.js";

describe("resolveKlingModel", () => {
  it("defaults to kling-v3 and maps aliases", () => {
    expect(resolveKlingModel(undefined)).toBe("kling-v3");
    expect(resolveKlingModel("v2.6")).toBe("kling-v2-6");
    expect(resolveKlingModel("v2.5-turbo")).toBe("kling-v2-5-turbo");
    expect(resolveKlingModel("kling-v3")).toBe("kling-v3");
  });

  it("rejects models the text2video/image2video endpoints do not accept", () => {
    expect(() => resolveKlingModel("v3-omni")).toThrow(/Unknown Kling model/);
  });
});

describe("klingDuration", () => {
  it("lets kling-v3 use 3-15 seconds", () => {
    expect(klingDuration("kling-v3", 8)).toBe("8");
    expect(klingDuration("kling-v3", 1)).toBe("3");
    expect(klingDuration("kling-v3", 40)).toBe("15");
    expect(klingDuration("kling-v3")).toBe("5");
  });

  it("keeps the v2.x models on 5 or 10 seconds", () => {
    expect(klingDuration("kling-v2-6", 8)).toBe("5");
    expect(klingDuration("kling-v2-5-turbo", 12)).toBe("10");
  });
});
