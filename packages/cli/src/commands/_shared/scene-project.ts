/**
 * @module _shared/scene-project
 *
 * Helpers for scaffolding a "scene project" — a directory that works as both
 * a VibeFrame project (via `vibe.project.yaml`) AND a HeyGen Hyperframes
 * project (via `hyperframes.json` + `meta.json` + `index.html`). Either
 * toolchain can be run inside the directory.
 *
 * Pure functions; no I/O beyond `scaffoldSceneProject()` which orchestrates
 * file writes. Everything else returns strings or JSON-serializable objects
 * so it can be unit-tested without touching the filesystem.
 */

import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { stringify as yamlStringify } from "yaml";

import type { VisualStyle } from "./visual-styles.js";

/** Supported aspect ratios for scene projects (maps to CSS canvas dims). */
export type SceneAspect = "16:9" | "9:16" | "1:1" | "4:5";

const ASPECT_DIMS: Record<SceneAspect, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1":  { width: 1080, height: 1080 },
  "4:5":  { width: 1080, height: 1350 },
};

export function aspectToDims(aspect: SceneAspect): { width: number; height: number } {
  return ASPECT_DIMS[aspect];
}

/** Shape of the Hyperframes project config file. */
export interface HyperframesConfig {
  $schema?: string;
  registry?: string;
  paths?: {
    blocks?: string;
    components?: string;
    assets?: string;
  };
  // Preserve unknown keys on merge so we don't clobber user edits.
  [key: string]: unknown;
}

/** Shape of the Hyperframes meta file. */
export interface HyperframesMeta {
  id: string;
  name: string;
  createdAt: string;
  [key: string]: unknown;
}

/** Shape of the new VibeFrame-specific project config. */
export interface VibeProjectConfig {
  name: string;
  aspect: SceneAspect;
  /** Default scene duration in seconds when none is inferred from narration. */
  defaultSceneDuration: number;
  /** Default providers per capability. `null` means "auto-resolve from env". */
  providers: {
    image: "openai" | "gemini" | "grok" | null;
    tts: "elevenlabs" | "kokoro" | null;
    transcribe: "whisper" | null;
  };
  /** Cost ceiling for `vibe pipeline` runs in this project. 0 disables. */
  budget: { maxUsd: number };
}

/** Defaults for a fresh scene project. */
export function defaultVibeProjectConfig(name: string): VibeProjectConfig {
  return {
    name,
    aspect: "16:9",
    defaultSceneDuration: 5,
    providers: { image: null, tts: null, transcribe: null },
    budget: { maxUsd: 0 },
  };
}

/** The Hyperframes config we write on init. Matches the format at
 *  hyperframe-learn/my-first-video/hyperframes.json.
 */
export function buildHyperframesConfig(): HyperframesConfig {
  return {
    $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
    registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
    paths: {
      blocks: "compositions",
      components: "compositions/components",
      assets: "assets",
    },
  };
}

export function buildHyperframesMeta(name: string, now: Date = new Date()): HyperframesMeta {
  return { id: name, name, createdAt: now.toISOString() };
}

/**
 * Merge an existing Hyperframes config with our defaults, preserving any
 * user-authored keys and nested values. `vibe scene init` is idempotent:
 * running it on a directory that already has `hyperframes.json` must never
 * lose user config.
 */
export function mergeHyperframesConfig(
  existing: HyperframesConfig,
  defaults: HyperframesConfig,
): HyperframesConfig {
  const out: HyperframesConfig = { ...defaults, ...existing };
  // Preserve nested `paths` by shallow-merging.
  if (existing.paths || defaults.paths) {
    out.paths = { ...(defaults.paths ?? {}), ...(existing.paths ?? {}) };
  }
  return out;
}

/**
 * Minimal valid Hyperframes root composition — empty (no sub-compositions
 * yet). A later `vibe scene add` inserts `<div class="clip" ...>` children.
 */
export function buildEmptyRootHtml(opts: { aspect: SceneAspect; duration: number }): string {
  const { width, height } = ASPECT_DIMS[opts.aspect];
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        margin: 0;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: #000;
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${opts.duration}"
      data-width="${width}"
      data-height="${height}"
    >
      <!-- Scenes added via \`vibe scene add\` are inserted here. -->
      <!-- Each scene reference: data-composition-id, data-composition-src, data-start, data-duration, data-track-index. -->
      <!-- See compositions/*.html for sub-composition contents. -->

    </div>

    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;
}

/**
 * Project-local `DESIGN.md` template — the visual-identity hard-gate.
 *
 * Hyperframes' `hyperframes` skill teaches: "no scene HTML before DESIGN.md is
 * authored." This template seeds that contract so the project never opens
 * with a blank slate. When `style` is provided, the rules are pre-filled
 * from the vendored named-style data (`visual-styles.ts`); otherwise the
 * user (or agent) fills the placeholders.
 *
 * The agent-driven craft path expects this file as input — see
 * `.claude/skills/vibe-scene/SKILL.md`.
 */
export function buildDesignMd(opts: {
  name: string;
  style?: VisualStyle;
}): string {
  const { name, style } = opts;

  const intro = style
    ? `Visual identity for **${name}**, scaffolded from the **${style.name}** style (after ${style.designer}). Customise freely — this file is the single source of truth for every scene's palette, typography, and motion.`
    : `Visual identity for **${name}**. Fill the sections below before authoring any scene HTML or generating any backdrop. Pick a named style with \`vibe scene styles\` if you want a credible starting point.`;

  const moodLine = style
    ? `**Mood:** ${style.mood} · **Best for:** ${style.bestFor}`
    : `**Mood:** _(one line — what should the viewer FEEL?)_`;

  const palette = style
    ? `${style.palette.map((c) => `- \`${c}\``).join("\n")}\n\n${style.paletteNotes}`
    : `- _hex_ — primary\n- _hex_ — accent\n\n_2–3 colours max. Declare explicit hex values; never name colours abstractly._`;

  const typography = style
    ? style.typography
    : `_One family, two weights. State the role of each (headline / label / body)._`;

  const composition = style
    ? style.composition
    : `_Grid? Centered? Layered? How does negative space behave?_`;

  const motion = style
    ? `${style.motion}\n\n**GSAP signature:** ${style.gsapSignature}`
    : `_How fast? Snappy or fluid? Overshoot or precision?_\n\n**GSAP signature:** _e.g. \`expo.out\`, \`sine.inOut\`, \`back.out(1.8)\`_`;

  const transition = style
    ? style.transition
    : `_Which Hyperframes shader matches the energy? (Cinematic Zoom, Cross-Warp Morph, Glitch, Domain Warp, …)_`;

  const avoid = style
    ? style.avoid.map((a) => `- ${a}`).join("\n")
    : `- _anti-pattern 1_\n- _anti-pattern 2_\n- _anti-pattern 3_`;

  return `# ${name} — Design

> **Hard-gate.** This file defines the visual identity of every scene.
> Author it before generating any HTML, backdrop image, or motion.
> The Hyperframes \`hyperframes\` skill enforces this: scenes that
> contradict DESIGN.md are rejected.

${intro}

## Style

${moodLine}

## Palette

${palette}

## Typography

${typography}

## Composition

${composition}

## Motion

${motion}

## Transition

${transition}

## What NOT to do

${avoid}

---

_Browse other named styles: \`vibe scene styles\`_
${style ? `_This file was seeded by \`vibe scene init --visual-style "${style.name}"\`._` : `_Seed this file from a named style: \`vibe scene init <dir> --visual-style "<name>"\`._`}
`;
}

/** Project-local CLAUDE.md that orients an AI agent to both toolchains. */
export function buildProjectClaudeMd(name: string): string {
  return `# ${name} — Scene Authoring Project

This project is **bilingual**: it works with both VibeFrame (\`vibe\`) and
HeyGen Hyperframes (\`hyperframes\`). You can run either CLI inside this
directory.

## Visual identity hard-gate

**Author \`DESIGN.md\` before any scene HTML.** It defines palette,
typography, motion, and transition rules. Both the agent-driven path and
the fallback emit reference it; scenes that contradict DESIGN.md are
rejected by the Hyperframes \`hyperframes\` skill.

Browse named styles: \`vibe scene styles\`. Re-seed from one with
\`vibe scene init . --visual-style "Swiss Pulse"\` (idempotent).

## Skills — USE THESE FIRST

**Always invoke the relevant skill before authoring scenes.** Skills encode
framework-specific patterns (GSAP timeline registration, data-attribute
semantics, VibeFrame pipeline conventions) that are NOT in generic web docs.

| Skill             | Command          | When to use                                                                           |
| ----------------- | ---------------- | ------------------------------------------------------------------------------------- |
| **hyperframes**   | \`/hyperframes\`   | Cinematic-quality composition — DESIGN.md hard-gate, named styles, motion principles  |
| **vibe-scene**    | \`/vibe-scene\`    | VibeFrame's authoring loop, AI assets, lint feedback, pipeline integration            |
| **gsap**          | \`/gsap\`          | GSAP tweens, timelines, easing                                                        |

Install the Hyperframes skills once per machine:

\`\`\`bash
npx skills add heygen-com/hyperframes
\`\`\`

Restart your agent session (or reload the skill list) after installing.
If skills aren't available, follow the **Key Rules** below — they cover
the framework-level minimum, not the cinematic craft layer.

## Project structure

- \`DESIGN.md\` — visual identity contract (palette, type, motion, transitions)
- \`index.html\` — root composition (timeline)
- \`compositions/scene-*.html\` — per-scene HTML authored by you or the agent
- \`assets/\` — shared media (narration audio, images, video)
- \`transcript.json\` — Whisper word-level transcript (if narration exists)
- \`hyperframes.json\` — HF registry config (speak to both toolchains)
- \`vibe.project.yaml\` — VibeFrame config (providers, budget)
- \`renders/\` — output MP4s

## Commands

\`\`\`bash
vibe scene add <name> --narration "..." --visuals "..."   # Author a new scene via AI
vibe scene lint                                             # Validate scenes (in-process HF linter)
vibe scene render                                           # Render to MP4

# Hyperframes CLI (if installed — works in this project too)
npx hyperframes preview
npx hyperframes render
\`\`\`

## Key Rules (for hand-authored scene HTML)

1. Every timed element needs \`data-start\`, \`data-duration\`, and \`data-track-index\`.
2. Elements with timing **MUST** have \`class="clip"\` — the framework uses this for visibility control.
3. Timelines must be paused and registered on \`window.__timelines\`:
   \`\`\`js
   window.__timelines = window.__timelines || {};
   window.__timelines["composition-id"] = gsap.timeline({ paused: true });
   \`\`\`
4. Videos use \`muted\` with a separate \`<audio>\` element for the audio track.
5. Sub-compositions use \`data-composition-src="compositions/file.html"\`.
6. Only deterministic logic — no \`Date.now()\`, \`Math.random()\`, or network fetches.

## Linting — run after changes

\`\`\`bash
vibe scene lint           # preferred — in-process, no network
vibe scene lint --fix     # auto-fix mechanical issues
vibe scene lint --json    # structured output for agent loops
\`\`\`
`;
}

/** Minimal .gitignore for a scene project. */
export function buildSceneGitignore(): string {
  return `# VibeFrame caches
.vibeframe/cache/
.vibeframe/checkpoints/

# Render outputs
renders/*.mp4
tmp/

# OS / editor
.DS_Store
*.log
`;
}

// ---------------------------------------------------------------------------
// Filesystem orchestration
// ---------------------------------------------------------------------------

export interface ScaffoldOptions {
  dir: string;
  name?: string;
  aspect?: SceneAspect;
  duration?: number;
  now?: Date;
  /**
   * Optional named visual style (e.g. "Swiss Pulse"). When provided,
   * `DESIGN.md` is seeded with the style's palette / typography / motion
   * rules instead of placeholders. Resolved via `getVisualStyle()`.
   */
  visualStyle?: VisualStyle;
}

export interface ScaffoldResult {
  /** Files written (absolute paths). */
  created: string[];
  /** Files that already existed and were NOT overwritten. */
  skipped: string[];
  /** Files that were merge-updated (currently only hyperframes.json). */
  merged: string[];
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Scaffold (or update) a scene project at `dir`. Idempotent: running twice is
 * a no-op; running on an existing Hyperframes project merges `hyperframes.json`
 * instead of overwriting.
 */
export async function scaffoldSceneProject(opts: ScaffoldOptions): Promise<ScaffoldResult> {
  const dir = resolve(opts.dir);
  const name = opts.name ?? basename(dir);
  const aspect: SceneAspect = opts.aspect ?? "16:9";
  const duration = opts.duration ?? 10;
  const now = opts.now ?? new Date();

  await mkdir(dir, { recursive: true });
  await mkdir(resolve(dir, "compositions"), { recursive: true });
  await mkdir(resolve(dir, "assets"), { recursive: true });

  const created: string[] = [];
  const skipped: string[] = [];
  const merged: string[] = [];

  // hyperframes.json — merge if exists, else create.
  const hfPath = resolve(dir, "hyperframes.json");
  const hfDefaults = buildHyperframesConfig();
  if (await pathExists(hfPath)) {
    const existingRaw = await readFile(hfPath, "utf-8");
    const existing = JSON.parse(existingRaw) as HyperframesConfig;
    const mergedConfig = mergeHyperframesConfig(existing, hfDefaults);
    await writeFile(hfPath, JSON.stringify(mergedConfig, null, 2) + "\n", "utf-8");
    merged.push(hfPath);
  } else {
    await writeFile(hfPath, JSON.stringify(hfDefaults, null, 2) + "\n", "utf-8");
    created.push(hfPath);
  }

  // meta.json — preserve existing (id shouldn't change).
  const metaPath = resolve(dir, "meta.json");
  if (await pathExists(metaPath)) {
    skipped.push(metaPath);
  } else {
    await writeFile(metaPath, JSON.stringify(buildHyperframesMeta(name, now), null, 2) + "\n", "utf-8");
    created.push(metaPath);
  }

  // index.html — preserve existing (user may have edited root).
  const rootPath = resolve(dir, "index.html");
  if (await pathExists(rootPath)) {
    skipped.push(rootPath);
  } else {
    await writeFile(rootPath, buildEmptyRootHtml({ aspect, duration }), "utf-8");
    created.push(rootPath);
  }

  // vibe.project.yaml — preserve existing; this is VibeFrame's own config.
  const vibePath = resolve(dir, "vibe.project.yaml");
  if (await pathExists(vibePath)) {
    skipped.push(vibePath);
  } else {
    const cfg = { ...defaultVibeProjectConfig(name), aspect };
    await writeFile(vibePath, yamlStringify(cfg), "utf-8");
    created.push(vibePath);
  }

  // CLAUDE.md — preserve existing.
  const claudePath = resolve(dir, "CLAUDE.md");
  if (await pathExists(claudePath)) {
    skipped.push(claudePath);
  } else {
    await writeFile(claudePath, buildProjectClaudeMd(name), "utf-8");
    created.push(claudePath);
  }

  // DESIGN.md — visual-identity hard-gate (Hyperframes skill convention).
  // Preserve existing so users can hand-edit between init runs.
  const designPath = resolve(dir, "DESIGN.md");
  if (await pathExists(designPath)) {
    skipped.push(designPath);
  } else {
    await writeFile(
      designPath,
      buildDesignMd({ name, style: opts.visualStyle }),
      "utf-8",
    );
    created.push(designPath);
  }

  // .gitignore — preserve existing.
  const gitignorePath = resolve(dir, ".gitignore");
  if (await pathExists(gitignorePath)) {
    skipped.push(gitignorePath);
  } else {
    await writeFile(gitignorePath, buildSceneGitignore(), "utf-8");
    created.push(gitignorePath);
  }

  return { created, skipped, merged };
}
