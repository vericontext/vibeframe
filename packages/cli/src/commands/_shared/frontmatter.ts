/**
 * @module _shared/frontmatter
 *
 * One canonical "YAML frontmatter + markdown body" splitter for all VibeFrame
 * `.md` files. Previously each consumer (storyboard, design, install-skill)
 * declared its own `/^---\n…\n---/` regex + `yaml.parse` — this consolidates
 * them.
 *
 * The shape matches Google's Open Knowledge Format (OKF) and Mintlify: a leading
 * `---` YAML block, then a free-form markdown body. VibeFrame project files
 * (STORYBOARD.md, DESIGN.md, CHARACTERS.md, …) are OKF concept documents; docs/
 * pages carry OKF/Mintlify frontmatter (`type`, `title`, `description`, `tags`).
 */

import { parse as parseYaml } from "yaml";

/** Leading `---\n…\n---` block. Anchored to the start of the (normalized) text. */
export const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;

export interface ExtractedFrontmatter {
  /** Parsed frontmatter map, or `null` when absent / invalid / not a map. */
  data: Record<string, unknown> | null;
  /** Markdown body after the frontmatter block (or the whole doc when absent). */
  body: string;
  /** The full document, CRLF-normalized to LF. */
  raw: string;
}

/**
 * Split a leading YAML frontmatter block from the markdown body. CRLF is
 * normalized to LF. Returns `data: null` (freeform) when there is no leading
 * block, the YAML is invalid, or it is not a plain object — callers decide
 * whether that means `undefined` or `{}`.
 */
export function extractFrontmatter(md: string): ExtractedFrontmatter {
  const raw = md.replace(/\r\n/g, "\n");
  const match = raw.match(FRONTMATTER_RE);
  if (match) {
    try {
      const parsed = parseYaml(match[1]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { data: parsed as Record<string, unknown>, body: raw.slice(match[0].length), raw };
      }
    } catch {
      // Invalid YAML → treat the whole doc as freeform body.
    }
  }
  return { data: null, body: raw, raw };
}
