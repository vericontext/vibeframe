import { describe, expect, it } from "vitest";

import {
  getVisualStyle,
  listVisualStyles,
  visualStyleNames,
} from "./visual-styles.js";

describe("listVisualStyles", () => {
  it("ships the eight named styles in stable order", () => {
    const names = listVisualStyles().map((s) => s.name);
    expect(names).toEqual([
      "Swiss Pulse",
      "Velvet Standard",
      "Deconstructed",
      "Maximalist Type",
      "Data Drift",
      "Soft Signal",
      "Folk Frequency",
      "Shadow Cut",
    ]);
  });

  it("every style has a non-empty palette + typography + motion + transition + 3 anti-patterns", () => {
    for (const s of listVisualStyles()) {
      expect(s.palette.length).toBeGreaterThanOrEqual(2);
      expect(s.typography.length).toBeGreaterThan(0);
      expect(s.motion.length).toBeGreaterThan(0);
      expect(s.transition.length).toBeGreaterThan(0);
      expect(s.gsapSignature.length).toBeGreaterThan(0);
      expect(s.avoid.length).toBe(3);
      // Slugs are kebab-case lowercase, name-derived.
      expect(s.slug).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });
});

describe("getVisualStyle", () => {
  it("matches by exact display name", () => {
    expect(getVisualStyle("Swiss Pulse")?.slug).toBe("swiss-pulse");
  });

  it("is case-insensitive on display name", () => {
    expect(getVisualStyle("velvet standard")?.name).toBe("Velvet Standard");
    expect(getVisualStyle("MAXIMALIST TYPE")?.name).toBe("Maximalist Type");
  });

  it("matches by slug", () => {
    expect(getVisualStyle("data-drift")?.name).toBe("Data Drift");
    expect(getVisualStyle("shadow-cut")?.name).toBe("Shadow Cut");
  });

  it("returns undefined for unknown names", () => {
    expect(getVisualStyle("Nonexistent")).toBeUndefined();
    expect(getVisualStyle("")).toBeUndefined();
  });

  it("trims whitespace before matching", () => {
    expect(getVisualStyle("  Soft Signal  ")?.slug).toBe("soft-signal");
  });
});

describe("visualStyleNames", () => {
  it("renders comma-joined quoted display names suitable for help text", () => {
    const out = visualStyleNames();
    expect(out).toContain('"Swiss Pulse"');
    expect(out).toContain('"Shadow Cut"');
    expect(out.split(",").length).toBe(8);
  });
});
