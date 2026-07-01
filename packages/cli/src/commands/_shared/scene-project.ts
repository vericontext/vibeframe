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
import { projectConfigJson, VIBE_CONFIG_FILENAME } from "./project-config.js";

/** Supported aspect ratios for scene projects (maps to CSS canvas dims). */
export type SceneAspect = "16:9" | "9:16" | "1:1" | "4:5";
export type SceneScaffoldProfile = "minimal" | "agent" | "full";

/**
 * Project KIND — orthogonal to {@link SceneScaffoldProfile} (which decides which
 * files exist). Kind decides which pipeline STAGES run and which composer is the
 * default:
 * - `cinema` / `story` — directed, character-driven; keyframe→i2v, LLM composer.
 * - `aivideo` — character + i2v, the deterministic `template` composer.
 * - `product` — backdrop/asset-centric (no i2v keyframes).
 * - `motion` — pure HTML/CSS/GSAP graphics (no AI image/video assets).
 */
export type SceneKind = "cinema" | "product" | "aivideo" | "story" | "motion";

export const VALID_SCENE_KINDS: readonly SceneKind[] = [
  "cinema",
  "product",
  "aivideo",
  "story",
  "motion",
];

/** Default kind preserves today's behavior (LLM composer, cue-driven assets). */
export const DEFAULT_SCENE_KIND: SceneKind = "cinema";

export function isSceneKind(value: string): value is SceneKind {
  return (VALID_SCENE_KINDS as readonly string[]).includes(value);
}

/**
 * Per-kind default asset skips, OR'd with the explicit `--skip-*` flags. Returns
 * only the skips a kind forces; `cinema`/`story`/`aivideo` add none (assets run
 * from their cues).
 */
export function kindAssetPolicy(
  kind: SceneKind
): { skipKeyframe?: boolean; skipVideo?: boolean; skipBackdrop?: boolean } {
  switch (kind) {
    case "product":
      return { skipKeyframe: true, skipVideo: true }; // backdrop-centric, no i2v
    case "motion":
      return { skipKeyframe: true, skipVideo: true, skipBackdrop: true }; // pure graphics
    default:
      return {};
  }
}

/** The composer a kind defaults to when `--composer` is not given. */
export function composerDefaultForKind(kind: SceneKind): "template" | undefined {
  return kind === "aivideo" ? "template" : undefined;
}

/**
 * Whether a kind has a recurring cast worth a `CHARACTERS.md` bible. Character-
 * driven kinds (cinema/story/aivideo) do; product/motion do not.
 */
export function kindHasCast(kind: SceneKind): boolean {
  return kind === "cinema" || kind === "story" || kind === "aivideo";
}

const ASPECT_DIMS: Record<SceneAspect, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
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
    tts: "elevenlabs" | "openai" | "kokoro" | null;
    transcribe: "whisper" | null;
  };
  /** Cost ceiling for `vibe remix` runs in this project. 0 disables. */
  budget: { maxUsd: number };
  /** Scene composition renderer boundary. Hyperframes is the only supported engine today. */
  composition: {
    engine: "hyperframes";
    entry: string;
  };
}

/** Defaults for a fresh scene project. */
export function defaultVibeProjectConfig(name: string): VibeProjectConfig {
  return {
    name,
    aspect: "16:9",
    defaultSceneDuration: 5,
    providers: { image: null, tts: null, transcribe: null },
    budget: { maxUsd: 0 },
    composition: { engine: "hyperframes", entry: "index.html" },
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
  defaults: HyperframesConfig
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
/**
 * Derive google-labs `colors:` role tokens (primary/ground/accent) from a named
 * style's palette by luminance (darkest→ground, lightest→primary, most-saturated
 * remaining→accent), falling back to the default video token palette.
 */
function designColorRoles(style?: VisualStyle): { primary: string; ground: string; accent: string } {
  const fallback = { primary: "#EAF2F7", ground: "#0E1A24", accent: "#E2683C" };
  const uniq = Array.from(
    new Set((style?.palette ?? []).filter((c) => /^#[0-9a-fA-F]{6}$/.test(c)).map((c) => c.toUpperCase()))
  );
  if (uniq.length < 3) return fallback;
  const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const lum = (h: string) => { const [r, g, b] = rgb(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const sat = (h: string) => { const [r, g, b] = rgb(h).map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };
  const sorted = [...uniq].sort((a, b) => lum(a) - lum(b));
  const ground = sorted[0];
  const primary = sorted[sorted.length - 1];
  const accent = uniq.filter((h) => h !== ground && h !== primary).sort((a, b) => sat(b) - sat(a))[0] ?? fallback.accent;
  return { primary, ground, accent };
}

export function buildDesignMd(opts: { name: string; style?: VisualStyle }): string {
  const { name, style } = opts;
  const roles = designColorRoles(style);
  const frontmatter = `---
name: ${name}
colors:
  primary: "${roles.primary}"
  ground: "${roles.ground}"
  accent: "${roles.accent}"
---

`;

  const intro = style
    ? `Visual identity for **${name}**, scaffolded from the **${style.name}** style (after ${style.designer}). Customise freely — this file is the single source of truth for every scene's palette, typography, and motion.`
    : `Visual identity for **${name}**. Fill the sections below before authoring any scene HTML or generating any backdrop. Pick a named style with \`vibe scene list-styles\` if you want a credible starting point.`;

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

  return `${frontmatter}# ${name} — Design

> **Hard-gate (BUILD flow only).** This file is the visual contract for
> the scene-project flow (\`vibe build\`, \`vibe scene ...\`, composition
> HTML, backdrop image-gen). Author it before authoring scene HTML; the
> Hyperframes \`hyperframes\` skill enforces it at composition time.
>
> **Single-asset requests (\`vibe generate image|video|speech|...\`) do
> NOT consult this file.** Run the generate command directly with the
> user's prompt. See AGENTS.md → "Route by the user's actual request".

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

_Browse other named styles: \`vibe scene list-styles\`_
${style ? `_This file was seeded by \`vibe scene init --visual-style "${style.name}"\`._` : `_Seed this file from a named style: \`vibe scene init <dir> --visual-style "<name>"\`._`}
`;
}

/**
 * Always-on `SCRIPT.md` — the narrative spine authored before the beat-level
 * STORYBOARD.md. Kind tailors the guidance (a `motion`/`product` script is a
 * shot/asset list; a `story`/`cinema` script is a scene-by-scene narrative).
 */
export function buildScriptMd(name: string, kind: SceneKind = DEFAULT_SCENE_KIND): string {
  const intent =
    kind === "product"
      ? "Product walkthrough — what each section demonstrates, in order."
      : kind === "motion"
        ? "Motion piece — the message and the beats of on-screen text/graphics."
        : kind === "aivideo"
          ? "AI-video script — the spoken/voiced narrative the generated shots illustrate."
          : "Narrative script — scene-by-scene story, dialogue, and voiceover.";
  return `# ${name} — Script

> **Authoring order:** SCRIPT.md (this file) → STORYBOARD.md (beats + cues)${
    kindHasCast(kind) ? " → CHARACTERS.md (cast bible)" : ""
  }.
> ${intent}

## Logline

One or two sentences: who/what this is for and the single takeaway.

## Script

Write the spoken/voiceover line and the on-screen intent for each moment. Each
\`##\`-level section below maps to one STORYBOARD beat.

### 1. Open

Voiceover / on-screen: …

### 2. Develop

Voiceover / on-screen: …

### 3. Close

Voiceover / on-screen: …
`;
}

/**
 * Kind-gated `CHARACTERS.md` — the cast bible. Promotes today's STORYBOARD
 * \`characters:\` frontmatter into first-class identity blocks (reference sheet
 * path + an identity-lock description used to keep keyframes/i2v on-model).
 */
export function buildCharactersMd(name: string): string {
  return `# ${name} — Characters

> Each character is referenced from STORYBOARD beats via the \`characters:\` cue.
> The reference sheet + identity block keep keyframes and image-to-video on-model
> across scenes (the Director continuity contract).

## hero

- **Reference sheet:** \`assets/characters/hero.png\` (a clean, front-lit full-body
  or portrait sheet — the identity anchor for keyframe edits).
- **Identity:** one paragraph of fixed, on-model traits — age, build, hair,
  wardrobe, palette. Keep this stable across every beat.
- **Range:** expressions / poses this character should hit.

<!-- Add one ## block per recurring character. Delete this file for kinds with
     no recurring cast. -->
`;
}

/** Starter `STORYBOARD.md` for the one-shot `vibe build` flow. */
export function buildStoryboardMd(name: string, duration = 12): string {
  return `---
title: ${name}
duration: ${duration}
aspect: 16:9
tts: auto
imageProvider: openai
---

# ${name} — Storyboard

Edit these beats before running \`vibe build\`. Each beat starts with
YAML cues that drive narration, backdrop generation, and timing.
Pacing: keep beats 6-15 seconds (split longer ones); a 90s video should
have 6-8 beats, not 3 long ones.

## Beat hook — Hook

\`\`\`yaml
narration: "Introduce the promise in one crisp sentence."
backdrop: "Topic-aligned editorial background plate, abstract visual system, no readable text, no logos, no consumer products, clean negative space for HTML overlays"
duration: 4
\`\`\`

Show the core visual identity immediately. Keep copy short enough for one
screen and one spoken breath.

## Beat proof — Proof

\`\`\`yaml
narration: "Show the mechanism or proof point that makes the promise believable."
backdrop: "Topic-aligned analytical background plate, abstract dashboard structure, no readable text, no product photos, no shoes, no unrelated objects"
duration: 4
\`\`\`

Use this beat for the concrete differentiator: command, workflow, metric, or
before/after.

## Beat close — Close

\`\`\`yaml
narration: "Close with the action the viewer should remember."
backdrop: "Resolved editorial background plate, confident final composition, clean negative space, no readable text, no logos, no unrelated products"
duration: 4
\`\`\`

End on the product name, offer, or command. Avoid adding a new idea in the
final beat.
`;
}

/** Project-local AGENTS.md that orients every agent host to both toolchains. */
export function buildProjectAgentsMd(name: string): string {
  return `# ${name} — Scene Authoring Project

This is the canonical cross-agent guidance file for this scene project.
Claude Code imports it through \`CLAUDE.md\`; Codex, Cursor, Aider,
Gemini CLI, OpenCode, and other bash-capable agents should read it
directly.

This project is **bilingual**: it works with both VibeFrame (\`vibe\`) and
HeyGen Hyperframes (\`hyperframes\`). You can run either CLI inside this
directory.

## Route the request first

Before opening DESIGN.md, loading the hyperframes skill, or planning
scenes, decide which flow the user actually wants:

- **ASSET (default for ambiguous prompts).** Single image, single video
  clip, single TTS line. Even a verb-less paste of a visual brief lands
  here. Just run \`vibe generate image|video|speech "<paste>" -o assets/<name>\`.
  Skip DESIGN.md, skip the hyperframes skill.
- **BUILD.** Multi-scene / storyboard / composed video. Triggered when
  the user explicitly asks for "a video built from scenes", "a
  storyboard", "a multi-scene composition", or names \`vibe build\` /
  \`vibe scene ...\`. Only here does the hard-gate below apply.
- **REMIX.** Transform a media file already on disk: \`vibe remix\`,
  \`vibe edit\`, \`vibe audio\`.

If you can't tell, ask: *"single asset or multi-scene project?"* before
authoring DESIGN.md or invoking a skill.

## Visual identity hard-gate (BUILD flow only)

**Within the BUILD flow,** author \`DESIGN.md\` before any scene HTML.
It defines palette, typography, motion, and transition rules. Both the
agent-driven path and the fallback emit reference it; scenes that
contradict DESIGN.md are rejected by the Hyperframes \`hyperframes\`
skill.

Single-asset requests (\`vibe generate image|video|speech|...\`) do NOT
consult this file — run the generate command directly.

Browse named styles: \`vibe scene list-styles\`. Re-seed from one with
\`vibe scene init . --visual-style "Swiss Pulse"\` (idempotent).

## Brief and local media

\`brief.md\` is raw intent, not a strict schema. It may contain messy notes,
pasted research, links, product requirements, or a one-line idea. \`vibe init
--from brief.md\` uses it only to seed \`STORYBOARD.md\` and \`DESIGN.md\`;
after init, those two files are the working source of truth.

Use \`media/\` for user-provided source files: product photos, screenshots,
logos, B-roll, recorded narration, or reference clips. Keep those inputs
inside this project so build references stay project-relative. Do not put user
media in \`references/\`; that directory is reserved for local composition
rules installed by VibeFrame.

When a beat should reuse a local file, reference it from \`STORYBOARD.md\`
with a project-relative path:

\`\`\`yaml
backdrop: "media/product-shot.png" # existing still image
video: "media/broll.mp4"           # existing video/B-roll
narration: "media/voice.wav"       # existing recorded narration
asset: "media/logo.png"            # generic local asset reference
\`\`\`

Use text cues when you want VibeFrame to generate an asset. Use path cues
when you want VibeFrame to reuse a local file. Avoid absolute paths or parent
directory references; copy files into \`media/\` first.

## Provider keys and project scope

Use VibeFrame CLI generation for project assets:
\`vibe generate image|video|speech ...\`. This lets VibeFrame use keys
from \`vibe setup --scope project\`.

Project-scope keys may live in a parent directory, for example
\`../.vibeframe/config.yaml\` when this scene was created by
\`vibe init launch\`. The \`vibe\` CLI searches upward automatically, so do
not decide keys are missing just because \`.vibeframe/config.yaml\` is not
inside this scene folder.

To verify scope without exposing secrets, run \`vibe doctor --json\` from
this directory and inspect \`data.scope.activeScope\` plus
\`data.scope.project.configPath\`. Never print config contents. Do not use
a host agent's built-in image/audio generation tool for VibeFrame project
assets unless the user explicitly requests an external, non-VibeFrame
asset.

## App host setup

VibeFrame is CLI-first, not terminal-only. Codex, Claude Code, and Cursor can
drive this project through shell commands, and app hosts can use the MCP server
as a typed tool surface.

\`\`\`bash
vibe host setup all         # print Codex/Claude/Cursor snippets
vibe host setup all --write # write project/app config
vibe host doctor all --json # verify readiness
\`\`\`

## Host agent loop

For long-running work, use your host's agent loop (Claude Code, Codex, Cursor,
or another coding-agent host) as the outer loop. VibeFrame should not run a competing
project-level agent loop; it provides \`--json\` commands, dry runs, cost caps,
\`build-report.json\`, \`review-report.json\`, \`nextActions\`, \`safeToAutoRun\`,
\`requiresConfirmation\`, \`fixOwner\`, deterministic repair, and render
inspection for the host agent to reason over.

Copy-paste agent prompts — plain prompts, not a built-in command:

\`\`\`text
Build this VibeFrame project into renders/final.mp4. Use --json for every
vibe command, run --dry-run before paid operations, use --max-cost 5 for builds
unless the user sets another budget, read build-report.json and
review-report.json before deciding the next action, prefer nextActions before
guessing, run only safeToAutoRun:true actions automatically, and ask before
requiresConfirmation:true actions. Treat retryWith as the compatibility
fallback, fixOwner:"vibe" as CLI repair work, and fixOwner:"host-agent" as
STORYBOARD.md, DESIGN.md, or composition edits.
Stop only when renders/final.mp4 exists, duration and aspect ratio match the
brief, inspect render --cheap has no errors, any AI review score is >= 90 when AI review is requested, and every
remaining host-agent issue is fixed, accepted with rationale, or reported as
blocked.
\`\`\`

\`\`\`text
Finish this VibeFrame render using your host's agent loop as the outer
loop. Use vibe context/schema when unsure, --json everywhere, dry-run before
paid operations, budget cap via --max-cost 5, nextActions before guessing,
build-report.json/review-report.json as loop state, and safeToAutoRun,
requiresConfirmation, and fixOwner to decide between vibe scene repair and
host-agent edits. Stop only after final MP4,
target duration/aspect ratio, clean render inspection, any AI review score >= 90 when AI review is requested, and
no unresolved unacknowledged host-agent issues.
\`\`\`

## Skills — USE THESE FIRST

**Load the \`hyperframes\` skill before authoring scenes** — it encodes the
composition rules, motion principles, type system, and visual-identity gate.
If your agent has it installed globally it is already available; otherwise run
\`vibe scene install-skill\` to eject a local, editable copy (\`SKILL.md\` +
\`references/\`, gitignored by default) and read \`SKILL.md\`.

**Always invoke the relevant skill before authoring scenes.** Skills encode
framework-specific patterns (GSAP timeline registration, data-attribute
semantics, VibeFrame pipeline conventions) that are NOT in generic web docs.

| Skill             | Command          | When to use                                                                           |
| ----------------- | ---------------- | ------------------------------------------------------------------------------------- |
| **hyperframes**   | \`/hyperframes\`   | Cinematic-quality composition — DESIGN.md hard-gate, named styles, motion principles  |
| **vibe-scene**    | \`/vibe-scene\`    | VibeFrame's authoring loop, AI assets, lint feedback, pipeline integration            |
| **gsap**          | \`/gsap\`          | GSAP tweens, timelines, easing                                                        |

Optional: install the upstream Hyperframes skills once per machine when your agent supports skill commands:

\`\`\`bash
npx skills add heygen-com/hyperframes
\`\`\`

Restart your agent session (or reload the skill list) after installing.
If skills aren't available, follow the **Key Rules** below — they cover
the framework-level minimum, not the cinematic craft layer.

## Project structure

- \`DESIGN.md\` — visual identity contract (palette, type, motion, transitions)
- \`STORYBOARD.md\` — per-beat narration/backdrop/duration cues for \`vibe build\`
- \`media/\` — user-provided source files (photos, logos, clips, voice recordings)
- \`index.html\` — root composition (timeline)
- \`compositions/scene-*.html\` — per-scene HTML authored by you or the agent
- \`assets/\` — generated/canonical build media (narration audio, images, video)
- \`references/\` — composition rule docs, only when ejected via \`vibe scene install-skill\` (not user media)
- \`transcript.json\` — Whisper word-level transcript (if narration exists)
- \`hyperframes.json\` — HF registry config (speak to both toolchains)
- \`vibe.config.json\` — canonical VibeFrame config (providers, budget)
- \`vibe.project.yaml\` — legacy compatibility config
- \`renders/\` — output MP4s

## Commands

\`\`\`bash
vibe scene add <name> --narration "..." --visuals "..."   # Author a new scene via AI
vibe build                                                 # STORYBOARD.md → narrated MP4
vibe scene lint                                             # Validate scenes (in-process HF linter)
vibe render                                                 # Render to MP4

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
6. For render-stable text, do not apply continuous \`scale\`, \`x\`, \`y\`, or
   \`filter\` tweens to \`.scene-content\` or any ancestor containing live text.
   Animate background/media layers instead; text/cards should enter briefly and
   then hold still at their final CSS positions.
7. Only deterministic logic — no \`Date.now()\`, \`Math.random()\`, or network fetches.

## Linting — run after changes

\`\`\`bash
vibe scene lint           # preferred — in-process, no network
vibe scene lint --fix     # auto-fix mechanical issues
vibe scene lint --json    # structured output for agent loops
\`\`\`
`;
}

/** Claude Code wrapper. Keeps scene guidance single-sourced in AGENTS.md. */
export function buildProjectClaudeMd(name: string): string {
  return `@AGENTS.md

# ${name} — Claude Code Overrides

This file imports \`AGENTS.md\`; keep cross-agent VibeFrame and
Hyperframes instructions there so Codex, Cursor, Aider, Gemini CLI, and
OpenCode see the same project rules. Add Claude-Code-specific notes below
only when this project needs them.
`;
}

/** Minimal .gitignore for a scene project. */
export function buildSceneGitignore(): string {
  return `# VibeFrame — caches, checkpoints, and project-scope config.yaml (may contain API keys)
.vibeframe/

# Render outputs
renders/*.mp4
tmp/

# Vendored Hyperframes skill copies — regenerable via 'vibe scene install-skill'.
# Delete these lines if you eject and want to commit per-project customizations.
/SKILL.md
/references/
/.claude/skills/hyperframes/
/.cursor/rules/hyperframes.mdc

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
  /** Scaffold shape. Defaults to "full" for backward-compatible programmatic use. */
  profile?: SceneScaffoldProfile;
  /** Project kind — drives which pipeline stages run + the default composer. */
  kind?: SceneKind;
}

export interface ScaffoldResult {
  /** Files written (absolute paths). */
  created: string[];
  /** Files that already existed and were NOT overwritten. */
  skipped: string[];
  /** Files that were merge-updated (currently only hyperframes.json). */
  merged: string[];
  /** Files grouped by product purpose for human and JSON output. */
  groups: SceneScaffoldGroups;
}

export interface SceneScaffoldGroups {
  authoring: string[];
  render: string[];
  agent: string[];
}

export function isSceneScaffoldProfile(value: string): value is SceneScaffoldProfile {
  return value === "minimal" || value === "agent" || value === "full";
}

export function describeSceneScaffold(opts: {
  dir: string;
  profile?: SceneScaffoldProfile;
  kind?: SceneKind;
}): SceneScaffoldGroups {
  const dir = resolve(opts.dir);
  const profile = opts.profile ?? "full";
  const kind = opts.kind ?? DEFAULT_SCENE_KIND;
  const groups: SceneScaffoldGroups = {
    authoring: [
      resolve(dir, "SCRIPT.md"),
      resolve(dir, "STORYBOARD.md"),
      resolve(dir, "DESIGN.md"),
      ...(kindHasCast(kind) ? [resolve(dir, "CHARACTERS.md")] : []),
      resolve(dir, VIBE_CONFIG_FILENAME),
      resolve(dir, "vibe.project.yaml"),
      resolve(dir, ".gitignore"),
    ],
    render: [],
    agent: [],
  };

  if (profile === "full") {
    groups.render = [
      resolve(dir, "index.html"),
      resolve(dir, "compositions"),
      resolve(dir, "assets"),
      resolve(dir, "renders"),
      resolve(dir, "hyperframes.json"),
      resolve(dir, "meta.json"),
    ];
  }

  if (profile === "agent" || profile === "full") {
    groups.agent = [
      resolve(dir, "AGENTS.md"),
      resolve(dir, "SKILL.md"),
      resolve(dir, "references"),
      resolve(dir, "CLAUDE.md"),
    ];
  }

  return groups;
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
  const profile = opts.profile ?? "full";
  const kind = opts.kind ?? DEFAULT_SCENE_KIND;

  await mkdir(dir, { recursive: true });
  if (profile === "full") {
    await mkdir(resolve(dir, "compositions"), { recursive: true });
    await mkdir(resolve(dir, "assets"), { recursive: true });
    await mkdir(resolve(dir, "renders"), { recursive: true });
  }

  const created: string[] = [];
  const skipped: string[] = [];
  const merged: string[] = [];

  if (profile === "full") {
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
      await writeFile(
        metaPath,
        JSON.stringify(buildHyperframesMeta(name, now), null, 2) + "\n",
        "utf-8"
      );
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
  }

  // vibe.project.yaml — preserve existing; this is VibeFrame's own config.
  const vibeConfigJsonPath = resolve(dir, VIBE_CONFIG_FILENAME);
  if (await pathExists(vibeConfigJsonPath)) {
    skipped.push(vibeConfigJsonPath);
  } else {
    await writeFile(vibeConfigJsonPath, projectConfigJson({ name, aspect, kind }), "utf-8");
    created.push(vibeConfigJsonPath);
  }

  // vibe.project.yaml — legacy compatibility. New code reads
  // vibe.config.json first, but we still write the legacy file during the
  // transition so older render/build paths and external scripts keep working.
  const vibePath = resolve(dir, "vibe.project.yaml");
  if (await pathExists(vibePath)) {
    skipped.push(vibePath);
  } else {
    const cfg = { ...defaultVibeProjectConfig(name), aspect };
    await writeFile(vibePath, yamlStringify(cfg), "utf-8");
    created.push(vibePath);
  }

  if (profile === "agent" || profile === "full") {
    // AGENTS.md — canonical cross-tool guidance; preserve existing.
    const agentsPath = resolve(dir, "AGENTS.md");
    if (await pathExists(agentsPath)) {
      skipped.push(agentsPath);
    } else {
      await writeFile(agentsPath, buildProjectAgentsMd(name), "utf-8");
      created.push(agentsPath);
    }

    // CLAUDE.md — preserve existing content, but ensure it imports AGENTS.md.
    const claudePath = resolve(dir, "CLAUDE.md");
    if (await pathExists(claudePath)) {
      const existing = await readFile(claudePath, "utf-8");
      if (existing.includes("@AGENTS.md")) {
        skipped.push(claudePath);
      } else {
        await writeFile(claudePath, `@AGENTS.md\n\n${existing}`, "utf-8");
        merged.push(claudePath);
      }
    } else {
      await writeFile(claudePath, buildProjectClaudeMd(name), "utf-8");
      created.push(claudePath);
    }
  }

  // DESIGN.md — visual-identity hard-gate (Hyperframes skill convention).
  // Preserve existing so users can hand-edit between init runs.
  const designPath = resolve(dir, "DESIGN.md");
  if (await pathExists(designPath)) {
    skipped.push(designPath);
  } else {
    await writeFile(designPath, buildDesignMd({ name, style: opts.visualStyle }), "utf-8");
    created.push(designPath);
  }

  // STORYBOARD.md — starter cues for the one-shot build flow.
  // Preserve existing so users can hand-edit between init runs.
  const storyboardPath = resolve(dir, "STORYBOARD.md");
  if (await pathExists(storyboardPath)) {
    skipped.push(storyboardPath);
  } else {
    await writeFile(storyboardPath, buildStoryboardMd(name, duration), "utf-8");
    created.push(storyboardPath);
  }

  // SCRIPT.md — always-on narrative spine (authored before STORYBOARD beats).
  const scriptPath = resolve(dir, "SCRIPT.md");
  if (await pathExists(scriptPath)) {
    skipped.push(scriptPath);
  } else {
    await writeFile(scriptPath, buildScriptMd(name, kind), "utf-8");
    created.push(scriptPath);
  }

  // CHARACTERS.md — only for kinds with a recurring cast (cinema/story/aivideo).
  if (kindHasCast(kind)) {
    const charactersPath = resolve(dir, "CHARACTERS.md");
    if (await pathExists(charactersPath)) {
      skipped.push(charactersPath);
    } else {
      await writeFile(charactersPath, buildCharactersMd(name), "utf-8");
      created.push(charactersPath);
    }
  }

  // .gitignore — preserve existing.
  const gitignorePath = resolve(dir, ".gitignore");
  if (await pathExists(gitignorePath)) {
    skipped.push(gitignorePath);
  } else {
    await writeFile(gitignorePath, buildSceneGitignore(), "utf-8");
    created.push(gitignorePath);
  }

  return { created, skipped, merged, groups: describeSceneScaffold({ dir, profile }) };
}
