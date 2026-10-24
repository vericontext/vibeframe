import { describe, expect, it } from "vitest";

import { contractQuality } from "./image-jobs.js";

describe("contractQuality", () => {
  it("maps the old OpenAI quality names onto the image contract's tiers", () => {
    expect(contractQuality("standard")).toBe("medium");
    expect(contractQuality("hd")).toBe("high");
  });

  it("passes contract tiers through and drops anything else", () => {
    expect(contractQuality("low")).toBe("low");
    expect(contractQuality("medium")).toBe("medium");
    expect(contractQuality("high")).toBe("high");
    expect(contractQuality("ultra")).toBeUndefined();
    expect(contractQuality(undefined)).toBeUndefined();
  });
});
