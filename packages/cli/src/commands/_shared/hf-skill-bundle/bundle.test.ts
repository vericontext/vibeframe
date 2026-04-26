import { describe, expect, it } from "vitest";

import {
  BUNDLE_VERSION,
  loadHyperframesSkillBundle,
} from "./bundle.js";

describe("loadHyperframesSkillBundle", () => {
  it("returns a non-empty bundle from one of the two sources", () => {
    const r = loadHyperframesSkillBundle();
    expect(["installed", "vendored"]).toContain(r.source);
    expect(r.content.length).toBeGreaterThan(10_000); // 5 markdown files concatenated
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it("bundle includes all 5 files in fixed order", () => {
    // Order is baked into bundle.ts so we just check the section markers
    // appear in the right sequence — applies to installed and vendored.
    const r = loadHyperframesSkillBundle();
    const indices = [
      "hyperframes/SKILL.md",
      "hyperframes/house-style.md",
      "hyperframes/motion-principles.md",
      "hyperframes/typography.md",
      "hyperframes/transitions.md",
    ].map((label) => r.content.indexOf(label));
    expect(indices.every((i) => i > 0)).toBe(true);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }
  });

  it("hash is stable within a session (cache-key contract)", () => {
    const a = loadHyperframesSkillBundle();
    const b = loadHyperframesSkillBundle();
    expect(a.hash).toBe(b.hash);
    expect(a.content).toBe(b.content);
  });

  it("BUNDLE_VERSION matches expected sha-date format", () => {
    expect(BUNDLE_VERSION).toMatch(/^[0-9a-f]{7,40}-\d{4}-\d{2}-\d{2}$/);
  });

  it("hint string surfaces source clearly", () => {
    const r = loadHyperframesSkillBundle();
    if (r.source === "vendored") {
      expect(r.hint).toContain("vendored");
      expect(r.hint).toContain(BUNDLE_VERSION);
      expect(r.hint).toContain("npx skills add heygen-com/hyperframes");
    } else {
      expect(r.hint).toContain("installed");
    }
  });
});
