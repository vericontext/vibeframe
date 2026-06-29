/**
 * @module _shared/design-parse
 *
 * Tolerant parser for DESIGN.md, aligned with the emerging google-labs
 * `design.md` convention: optional YAML front-matter carrying machine-readable
 * design tokens (`name`, `colors`, `typography`, …) plus `## ` prose sections.
 *
 * It degrades gracefully — invalid/absent front-matter yields `{}` and the
 * palette is recovered from hex literals in the prose, so a freeform DESIGN.md
 * (today's format) and a dropped-in `awesome-design-md` file both parse. The
 * parser only READS; it never rewrites the file.
 */
import { parse as parseYaml } from "yaml";

export interface ParsedDesign {
  /** `name:` from front-matter, if present. */
  name?: string;
  /** Color tokens — front-matter `colors:` map, else extracted from prose hexes. */
  colors: Record<string, string>;
  /** Typography tokens from front-matter `typography:` (shape left to the spec). */
  typography: Record<string, unknown>;
  /** `## ` section title → prose body (trimmed). */
  sections: Record<string, string>;
  /** Raw parsed front-matter object (`{}` when absent/invalid). */
  frontmatter: Record<string, unknown>;
  /** Original document. */
  raw: string;
}

const DESIGN_FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;
const SECTION_RE = /^##\s+(.+?)\s*$/gm;
const HEX_RE = /#[0-9a-fA-F]{6}\b/g;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Pull a `Record<string,string>` of color tokens from a front-matter value. */
function colorTokens(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

export function parseDesign(md: string): ParsedDesign {
  const raw = md.replace(/\r\n/g, "\n");

  let frontmatter: Record<string, unknown> = {};
  let body = raw;
  const fm = raw.match(DESIGN_FRONTMATTER_RE);
  if (fm) {
    try {
      const parsed = parseYaml(fm[1]);
      if (isPlainObject(parsed)) {
        frontmatter = parsed;
        body = raw.slice(fm[0].length);
      }
    } catch {
      // Invalid YAML → treat as freeform; leave body intact.
    }
  }

  // Sections: split the body on `## ` headings.
  const sections: Record<string, string> = {};
  const headings: Array<{ title: string; start: number; end: number }> = [];
  SECTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SECTION_RE.exec(body)) !== null) {
    headings.push({ title: m[1].trim(), start: m.index + m[0].length, end: body.length });
  }
  for (let i = 0; i < headings.length; i++) {
    if (i + 1 < headings.length) headings[i].end = headings[i + 1].start - 1;
    const h = headings[i];
    sections[h.title] = body.slice(h.start, h.end).replace(/^##\s+.+$/m, "").trim();
  }

  // Colors: front-matter `colors:` map wins; else recover hexes from the
  // Colors/Palette section (or whole body) as ordered tokens color-1..N.
  const colors = colorTokens(frontmatter.colors);
  if (Object.keys(colors).length === 0) {
    const source = sections.Colors ?? sections.Palette ?? body;
    const hexes = Array.from(new Set((source.match(HEX_RE) ?? []).map((h) => h.toUpperCase())));
    hexes.forEach((hex, i) => {
      colors[`color-${i + 1}`] = hex;
    });
  }

  return {
    name: typeof frontmatter.name === "string" ? frontmatter.name : undefined,
    colors,
    typography: isPlainObject(frontmatter.typography) ? frontmatter.typography : {},
    sections,
    frontmatter,
    raw,
  };
}

export interface DesignValidationIssue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
}

/**
 * Lint a DESIGN.md for the soft contract: parseable front-matter, at least a
 * couple of palette colors, and the core prose sections. Warnings/infos only —
 * a thin DESIGN.md is valid, just less useful to the composer.
 */
export function validateDesignMarkdown(md: string): DesignValidationIssue[] {
  const issues: DesignValidationIssue[] = [];
  const raw = md.replace(/\r\n/g, "\n");

  const fm = raw.match(DESIGN_FRONTMATTER_RE);
  if (fm) {
    try {
      const parsed = parseYaml(fm[1]);
      if (!isPlainObject(parsed)) {
        issues.push({
          severity: "warning",
          code: "DESIGN_FRONTMATTER_NOT_MAP",
          message: "DESIGN.md front-matter is not a key/value map; ignoring it.",
        });
      }
    } catch (err) {
      issues.push({
        severity: "error",
        code: "DESIGN_FRONTMATTER_INVALID",
        message: `DESIGN.md front-matter is not valid YAML: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const design = parseDesign(raw);
  const colorCount = Object.keys(design.colors).length;
  if (colorCount === 0) {
    issues.push({
      severity: "warning",
      code: "DESIGN_NO_PALETTE",
      message:
        "DESIGN.md declares no colors (front-matter `colors:` or hex values in the Colors/Palette section). The composer will fall back to default tokens.",
    });
  } else if (colorCount < 2) {
    issues.push({
      severity: "info",
      code: "DESIGN_THIN_PALETTE",
      message: "DESIGN.md declares only one color; 2–3 (primary/ground/accent) read best on video.",
    });
  }

  const hasMood = "Overview" in design.sections || "Style" in design.sections;
  if (!hasMood) {
    issues.push({
      severity: "info",
      code: "DESIGN_NO_MOOD",
      message: "DESIGN.md has no `## Overview` or `## Style` section describing the mood/feel.",
    });
  }

  return issues;
}
