/**
 * @module _shared/hf-skill-bundle
 *
 * Loads the vendored Hyperframes skill content as a single concatenated
 * system-prompt string. Used by `compose-scenes-with-skills` (v0.59+).
 *
 * Hyperframes (https://github.com/heygen-com/hyperframes, Apache 2.0)
 * publishes this skill content as the agent-loadable definition of its
 * composition craft. VibeFrame is not affiliated with HeyGen — see
 * `/CREDITS.md` and `./NOTICE` for the relationship + license obligations
 * VibeFrame honours.
 *
 * Sourcing order (highest precedence first):
 *   1. User-installed skill — `~/.claude/skills/hyperframes/` (read at runtime
 *      via readFileSync — kept fresh by the user's `npx skills update` flow)
 *   2. Vendored snapshot in this directory (always available, even after
 *      `npm install -g @vibeframe/cli` because the .md files are inlined
 *      into the esbuild bundle via the text loader — see `build.js`)
 *
 * The vendored copy is byte-identical to upstream: no semantic edits. We
 * mirror Hyperframes' own treatment of prior art (see their CREDITS.md
 * "Prior art" section about Remotion). Refresh the snapshot with
 * `scripts/refresh-hf-bundle.sh`, which re-copies from a sibling clone of
 * the upstream repo and bumps BUNDLE_VERSION.
 *
 * The cache for `compose-scenes-with-skills` keys on `BUNDLE_VERSION` (folded
 * into the hash) so snapshot upgrades automatically invalidate previously-cached
 * HTML.
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

// Vendored snapshot — esbuild's `text` loader inlines these .md files as
// string literals at build time, so `npm install -g @vibeframe/cli` ships
// the skill content inside the single bundled dist/index.js.
import SKILL_MD              from "./SKILL.md";
import HOUSE_STYLE_MD        from "./house-style.md";
import MOTION_PRINCIPLES_MD  from "./motion-principles.md";
import TYPOGRAPHY_MD         from "./typography.md";
import TRANSITIONS_MD        from "./transitions.md";

/**
 * Snapshot identifier. Bump on every refresh of the vendored MD files.
 * Format: `<upstream-git-sha>-<YYYY-MM-DD>` so cache keys auto-invalidate
 * even when the upstream sha alone is unchanged but our local copy wasn't
 * actually re-fetched.
 *
 * **Update rule:** any time you change a file under this directory, also
 * bump this constant. `scripts/refresh-hf-bundle.sh` does this automatically.
 */
export const BUNDLE_VERSION = "970367f-2026-04-25";

/**
 * Files included in the bundle, in concatenation order (matches what
 * `tests/v059-preflight/run-pass-1.ts` validated as system prompt).
 */
const VENDORED_SECTIONS: ReadonlyArray<{ label: string; content: string }> = [
  { label: "hyperframes/SKILL.md",             content: SKILL_MD             },
  { label: "hyperframes/house-style.md",       content: HOUSE_STYLE_MD       },
  { label: "hyperframes/motion-principles.md", content: MOTION_PRINCIPLES_MD },
  { label: "hyperframes/typography.md",        content: TYPOGRAPHY_MD        },
  { label: "hyperframes/transitions.md",       content: TRANSITIONS_MD       },
];

/** Path to the user-installed Hyperframes skill, if present. */
function installedSkillPath(): string | null {
  const candidate = join(homedir(), ".claude", "skills", "hyperframes");
  if (!existsSync(candidate)) return null;
  if (!statSync(candidate).isDirectory()) return null;
  return candidate;
}

function joinSections(sections: ReadonlyArray<{ label: string; content: string }>): string {
  return sections
    .map((s) => `\n\n=== ${s.label} ===\n\n${s.content}`)
    .join("\n");
}

function buildVendored(): { content: string; hint: string } {
  return {
    content: joinSections(VENDORED_SECTIONS),
    hint:
      `[skill] using vendored Hyperframes snapshot ${BUNDLE_VERSION}. ` +
      `For latest, run \`npx skills add heygen-com/hyperframes\`.`,
  };
}

function buildInstalled(skillRoot: string): { content: string; hint: string } | null {
  const installedPaths: Record<string, string> = {
    "hyperframes/SKILL.md":             join(skillRoot, "SKILL.md"),
    "hyperframes/house-style.md":       join(skillRoot, "house-style.md"),
    "hyperframes/motion-principles.md": join(skillRoot, "references", "motion-principles.md"),
    "hyperframes/typography.md":        join(skillRoot, "references", "typography.md"),
    "hyperframes/transitions.md":       join(skillRoot, "references", "transitions.md"),
  };

  const sections: Array<{ label: string; content: string }> = [];
  for (const [label, path] of Object.entries(installedPaths)) {
    if (!existsSync(path)) return null; // installed copy incomplete; fall back to vendored
    sections.push({ label, content: readFileSync(path, "utf-8") });
  }

  return {
    content: joinSections(sections),
    hint: `[skill] using installed Hyperframes skill from ${skillRoot}.`,
  };
}

/**
 * Load the Hyperframes skill bundle as a single string. Prefers the
 * user-installed skill (kept fresh by `npx skills add heygen-com/hyperframes`
 * + `npx skills update`) and falls back to the vendored snapshot inlined
 * into this bundle.
 *
 * Side-effect free except for the optional `~/.claude/skills/hyperframes/`
 * filesystem read.
 */
export function loadHyperframesSkillBundle(): {
  content: string;
  /** "installed" (user has ~/.claude/skills/hyperframes/) or "vendored" (esbuild-inlined snapshot). */
  source: "installed" | "vendored";
  /** Human-readable hint for first-load logging. */
  hint: string;
  /** Stable hash of (BUNDLE_VERSION + content). Used as cache-key input. */
  hash: string;
} {
  const installedRoot = installedSkillPath();
  if (installedRoot) {
    const r = buildInstalled(installedRoot);
    if (r) {
      return {
        content: r.content,
        source: "installed",
        hint: r.hint,
        hash: hashBundle(BUNDLE_VERSION, r.content),
      };
    }
  }
  const v = buildVendored();
  return {
    content: v.content,
    source: "vendored",
    hint: v.hint,
    hash: hashBundle(BUNDLE_VERSION, v.content),
  };
}

function hashBundle(version: string, content: string): string {
  return createHash("sha256")
    .update(version)
    .update(" ")
    .update(content)
    .digest("hex");
}
