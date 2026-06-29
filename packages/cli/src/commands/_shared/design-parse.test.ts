import { describe, expect, it } from "vitest";
import { parseDesign, validateDesignMarkdown } from "./design-parse.js";

describe("parseDesign", () => {
  it("reads google-labs-style YAML token front-matter + prose sections", () => {
    const md = [
      "---",
      "name: Alpine",
      "colors:",
      '  primary: "#EAF2F7"',
      '  ground: "#0E1A24"',
      '  accent: "#E2683C"',
      "typography:",
      "  headline:",
      '    fontFamily: "Archivo"',
      "---",
      "",
      "## Overview",
      "Cold and steadfast.",
      "",
      "## Motion",
      "Slow, precise.",
    ].join("\n");
    const d = parseDesign(md);
    expect(d.name).toBe("Alpine");
    expect(d.colors).toEqual({ primary: "#EAF2F7", ground: "#0E1A24", accent: "#E2683C" });
    expect((d.typography.headline as Record<string, unknown>).fontFamily).toBe("Archivo");
    expect(d.sections.Overview).toBe("Cold and steadfast.");
    expect(d.sections.Motion).toBe("Slow, precise.");
  });

  it("recovers a palette from prose hexes when there is no front-matter", () => {
    const md = "## Palette\n- `#0E1A24` ground\n- `#EAF2F7` text\n";
    const d = parseDesign(md);
    expect(d.frontmatter).toEqual({});
    expect(Object.values(d.colors).sort()).toEqual(["#0E1A24", "#EAF2F7"]);
  });

  it("degrades gracefully on invalid front-matter YAML", () => {
    const md = "---\ncolors: [unclosed\n---\n## Style\nx\n";
    const d = parseDesign(md);
    expect(d.frontmatter).toEqual({});
    // body (with the broken front-matter still in raw) parses sections best-effort
    expect(d.raw).toContain("unclosed");
  });
});

describe("validateDesignMarkdown", () => {
  it("passes a well-formed token DESIGN.md", () => {
    const md = '---\nname: X\ncolors:\n  primary: "#fff"\n  ground: "#000"\n---\n## Overview\nMood.\n';
    expect(validateDesignMarkdown(md).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("flags an empty palette and missing mood", () => {
    const codes = validateDesignMarkdown("# Design\nnothing here\n").map((i) => i.code);
    expect(codes).toContain("DESIGN_NO_PALETTE");
    expect(codes).toContain("DESIGN_NO_MOOD");
  });

  it("errors on invalid front-matter YAML", () => {
    const issues = validateDesignMarkdown("---\ncolors: [bad\n---\nbody\n");
    expect(issues.some((i) => i.code === "DESIGN_FRONTMATTER_INVALID" && i.severity === "error")).toBe(true);
  });
});
