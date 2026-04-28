/**
 * @module _shared/walkthroughs
 *
 * Universal CLI-equivalents of Claude Code's `/vibe-scene` and
 * `/vibe-pipeline` slash commands. After Plan H, host agents
 * (Claude Code, Codex, Cursor, Aider, Gemini CLI, OpenCode) all read
 * SKILL.md from the user's project and can drive `vibe scene build`
 * directly — but discoverability of the *workflow* itself was still
 * Claude-Code-only via the slash menu.
 *
 * `vibe walkthrough <topic>` closes that gap: any host (or a human at
 * a terminal) gets the same step-by-step authoring guide that the
 * slash commands deliver in Claude Code. The content is vendored as
 * TS template-literal strings so the CLI binary ships with zero
 * filesystem dependencies — same approach as `hf-skill-bundle`.
 *
 * Source of truth lives here. The Claude Code slash command files
 * under `.claude/skills/vibe-{scene,pipeline}/SKILL.md` mirror this
 * content (so the slash command and the CLI command stay in sync) and
 * add a one-line frontmatter for the slash menu.
 */

export type WalkthroughTopic = "scene" | "pipeline";

export interface WalkthroughResult {
  topic: WalkthroughTopic;
  /** Short title, e.g. "Scene authoring with vibe". */
  title: string;
  /** One-line summary suitable for a `--list` output. */
  summary: string;
  /** Numbered action items the host agent walks the user through. */
  steps: string[];
  /** Related vibe CLI commands referenced by the walkthrough. */
  relatedCommands: string[];
  /** Full markdown body — same content the Claude Code slash command loads. */
  content: string;
}

const SCENE_WALKTHROUGH = `# Scene authoring with vibe

A scene project is a directory that is **bilingual**: it works with both
\`vibe\` and \`npx hyperframes\`. Each scene is one HTML file with scoped CSS
and a paused GSAP timeline. Cheap to edit, cheap to lint, expensive only
at render.

\`vibe scene build\` (v0.60+) is the supported one-shot driver from a
written storyboard to an MP4. Plan H (v0.70) added \`--mode agent\` so the
host agent itself authors the per-beat HTML — no internal LLM call.

## Three authoring paths

| Path | Command | When to use |
|---|---|---|
| **One-shot (default, v0.60+)** | \`vibe scene build [project-dir]\` | STORYBOARD.md has YAML frontmatter + per-beat cues |
| **High-craft (manual)** | \`DESIGN.md\` + Hyperframes skill in your agent | Maximum control: hand-author each scene |
| **Quick draft** | \`vibe scene add --style <preset>\` | No agent or no API keys; fast iteration |

Recommend \`vibe scene build\` whenever the user has a STORYBOARD with
narration / backdrop intent.

## High-craft path

1. \`vibe scene init my-promo --visual-style "Swiss Pulse"\` — seeds
   \`DESIGN.md\` (palette, typography, motion, transitions) plus the
   \`vibe.project.yaml\` / \`hyperframes.json\` / \`index.html\` scaffold.
   In Plan H this **also installs the Hyperframes skill** at the
   right place for your host (\`.claude/skills/hyperframes/\` for Claude
   Code, \`.cursor/rules/hyperframes.mdc\` for Cursor, universal
   \`SKILL.md\` for everyone else).
2. Read \`SKILL.md\` (or the host-specific copy) — Hyperframes
   framework rules, motion principles, type system, transition recipes.
3. Read \`DESIGN.md\` — project-specific palette / typography / motion
   signature (visual identity hard-gate).
4. Author each scene HTML directly under \`compositions/scene-<id>.html\`
   using the rules from steps 2 and 3. The skill enforces the visual
   identity contract — scenes that contradict DESIGN.md fail lint.
5. \`vibe scene lint --fix\` for mechanical issues, \`vibe scene render\`
   to MP4.

## Quick-draft path

\`\`\`bash
vibe scene init my-promo -r 16:9 -d 30
vibe scene add intro --style announcement \\
    --headline "Ship videos, not clicks"
vibe scene lint
vibe scene render
\`\`\`

\`vibe scene init\` is **idempotent** — running it on an existing
Hyperframes directory merges \`hyperframes.json\` instead of clobbering it.
Safe to invoke on user-provided projects.

## Subcommands

\`\`\`bash
vibe scene init <dir> [-r 16:9|9:16|1:1|4:5] [-d <sec>] [--visual-style "<name>"]
vibe scene styles [<name>]                   # list / show vendored visual identities
vibe scene install-skill [<dir>] [--host all]  # retroactive Hyperframes-skill install
vibe scene add <name> --style <preset> [...]
vibe scene compose-prompts [<dir>] [--beat <id>]   # H2: emit plan, no LLM call
vibe scene lint [<root>] [--json] [--fix]
vibe scene render [<root>] [--fps 30] [--quality standard] [--format mp4]
vibe scene build [<dir>] [--mode agent|batch|auto]   # H3 dispatch
\`\`\`

## Style presets (for \`vibe scene add --style\`)

- **simple** — backdrop + bottom caption (default)
- **announcement** — single huge headline, gradient text
- **explainer** — kicker + title + subtitle stack
- **kinetic-type** — words animate in word-by-word
- **product-shot** — corner label + bottom headline + slow zoom

All presets accept \`--narration <text|file>\`, \`--visuals <prompt>\`,
\`--headline\`, \`--kicker\`. With \`--narration\`, scene duration auto-derives
from the generated TTS audio.

## STORYBOARD-to-MP4 (one command, v0.60+)

\`\`\`bash
vibe scene init my-promo --visual-style "Swiss Pulse" -d 12
# (edit STORYBOARD.md with per-beat YAML cues — narration, backdrop, duration)
vibe scene build my-promo
\`\`\`

\`vibe scene build\` reads the STORYBOARD frontmatter + per-beat cues,
dispatches TTS + image-gen per beat, then either:

- **\`--mode agent\`** (default when an agent host is detected) — emits a
  \`needs-author\` plan via \`vibe scene compose-prompts\`. The host agent
  authors each \`compositions/scene-<id>.html\` itself, then re-invoking
  \`vibe scene build\` proceeds to lint + render.
- **\`--mode batch\`** — VibeFrame runs an internal LLM (Claude / OpenAI /
  Gemini) to compose the HTML, then renders.

\`VIBE_BUILD_MODE\` env var overrides the auto-resolve.

## Lint feedback loop

\`\`\`bash
vibe scene lint --json --fix
\`\`\`

Returns structured findings. The recommended loop: 1) run lint with
\`--fix\` (mechanical fixes applied), 2) if \`errorCount > 0\`, edit the
scene HTML, 3) re-lint. Cap retries at 3 — if errors persist, fall back
to a template preset (\`vibe scene add <id> --style simple --force\`)
and surface the error to the user.

## When to use VibeFrame vs raw Hyperframes

| Task | Tool |
|------|------|
| Generate narration + image, then author scene | \`vibe scene add\` |
| Generate a full scenes project from a STORYBOARD | \`vibe scene build\` |
| Hand-tweak a single scene's animation | edit \`compositions/<file>.html\` directly |
| Render the project | \`vibe scene render\` *or* \`npx hyperframes render\` (equivalent) |
| Lint | \`vibe scene lint\` *or* \`npx hyperframes lint\` (equivalent) |

The \`vibe\` CLI adds asset generation, AI orchestration, and pipeline
integration on top of Hyperframes' rendering primitives.

## Quality checklist before render

- [ ] \`vibe scene lint\` exits 0 (or only warnings)
- [ ] \`vibe doctor\` confirms a usable Chrome (required for render)
- [ ] Root \`data-duration\` matches the sum of clip durations
- [ ] Aspect ratio in \`vibe.project.yaml\` matches the destination platform
`;

const PIPELINE_WALKTHROUGH = `# YAML pipelines (Video as Code)

A pipeline is a YAML manifest with steps that reference each other's
outputs. \`vibe run pipeline.yaml\` executes them with checkpointing and
cost estimation.

## Minimal skeleton

\`\`\`yaml
name: promo-video
description: 15s product teaser
steps:
  - id: backdrop
    action: generate-image
    prompt: "sleek product shot on white background"
    output: backdrop.png
  - id: scene
    action: generate-video
    image: $backdrop.output        # reference previous step output
    prompt: "slow camera pan"
    duration: 5
    output: scene.mp4
  - id: voice
    action: generate-tts
    text: "Meet the new standard."
    output: voice.mp3
  - id: final
    action: compose
    video: $scene.output
    audio: $voice.output
    output: final.mp4
\`\`\`

## Supported actions

- \`generate-image\`, \`generate-video\`, \`generate-tts\`, \`generate-music\`,
  \`generate-sound-effect\`, \`generate-storyboard\`, \`generate-motion\`
- \`edit-silence-cut\`, \`edit-jump-cut\`, \`edit-caption\`, \`edit-grade\`,
  \`edit-reframe\`, \`edit-speed-ramp\`, \`edit-fade\`, \`edit-noise-reduce\`,
  \`edit-text-overlay\`, \`edit-fill-gaps\`
- \`analyze-media\`, \`analyze-video\`, \`analyze-review\`, \`analyze-suggest\`
- \`audio-transcribe\`, \`audio-isolate\`, \`audio-voice-clone\`, \`audio-dub\`,
  \`audio-duck\`
- \`detect-scenes\`, \`detect-silence\`, \`detect-beats\`
- \`compose\`, \`export\`
- \`scene-build\` (Plan H one-shot driver) and \`scene-render\`
- \`compose-scenes-with-skills\` (internal-LLM compose pass)

The full set lives in \`packages/cli/src/pipeline/executor.ts\`.

## Variable references

- \`$<step-id>.output\` — previous step's output path
- \`$<step-id>.result.<field>\` — structured field from JSON result
- \`\${ENV_VAR}\` — environment variable
- Values can be templated: \`"\${SCRIPT_TITLE} - Episode \${EPISODE}"\`

## Running

\`\`\`bash
vibe run pipeline.yaml --dry-run           # plan + cost estimate, no execution
vibe run pipeline.yaml                     # execute
vibe run pipeline.yaml --resume            # retry from last successful step
vibe run pipeline.yaml --from scene        # start at specific step
vibe run pipeline.yaml --provider-video kling   # override provider
\`\`\`

Checkpoints land next to the YAML: \`pipeline.yaml.checkpoint.json\`.

## Authoring tips

1. **Start from examples** — \`examples/demo-pipeline.yaml\` (FFmpeg-only,
   no keys), \`examples/promo-video.yaml\` (AI providers).
2. **Dry-run first** — you see estimated cost and resolved variable
   graph before spending API credits.
3. **Keep step ids short and descriptive** (\`intro\`, \`scene1\`, \`voice\`,
   \`bgm\`) — they appear in logs and variable refs.
4. **Name outputs** with extensions matching the action (\`.mp4\`, \`.mp3\`,
   \`.png\`, \`.json\`).
5. **Declare \`budget:\`** on expensive pipelines:
   \`\`\`yaml
   budget:
     tokens: 500_000
     max_tool_errors: 3
     cost_usd: 5.00
   \`\`\`
6. **Split large pipelines** into smaller YAML files and compose via
   \`action: run-pipeline\` (nested).

## Converting ad-hoc shell sessions to pipelines

When the user has a working shell sequence, extract steps:

- Each \`vibe ...\` command becomes one step
- File outputs become step outputs; downstream \`-i <file>\` references
  become \`$<id>.output\`
- Shared parameters move to a top-level \`defaults:\` section
- Wrap the entire chain in a \`name:\` + \`steps:\` skeleton

The \`compose\` action is the catch-all assembly step (audio mux, video
overlay, etc.) — useful at the tail of a pipeline.
`;

const META: Record<WalkthroughTopic, Pick<WalkthroughResult, "title" | "summary" | "steps" | "relatedCommands">> = {
  scene: {
    title: "Scene authoring with vibe",
    summary: "Author per-scene HTML compositions and render to MP4 (BUILD flow)",
    steps: [
      'Run `vibe scene init <dir> --visual-style "<style name>"` to scaffold the project + install the Hyperframes skill (Plan H).',
      "Edit `STORYBOARD.md` with per-beat YAML cues (narration / backdrop / duration).",
      "Read `SKILL.md` for the framework rules and `DESIGN.md` for the visual-identity hard-gate.",
      "Run `vibe scene build <dir>`. With an agent host detected, the CLI emits a `needs-author` plan; the host agent authors each `compositions/scene-<id>.html` and re-invokes to render.",
      "Run `vibe scene lint --fix` to validate, then `vibe scene render` to produce the MP4.",
    ],
    relatedCommands: [
      "vibe scene init",
      "vibe scene styles",
      "vibe scene install-skill",
      "vibe scene compose-prompts",
      "vibe scene build",
      "vibe scene lint",
      "vibe scene render",
      "vibe scene add",
    ],
  },
  pipeline: {
    title: "YAML pipelines (Video as Code)",
    summary: "Author and run reproducible multi-step video workflows",
    steps: [
      "Sketch the workflow as YAML — `name`, `description`, then `steps:` with `id` + `action` + inputs/outputs.",
      "Reference previous step outputs via `$<step-id>.output` (or `$<step-id>.result.<field>` for structured returns).",
      "Run `vibe run pipeline.yaml --dry-run` to see the resolved graph + cost estimate before spending API budget.",
      "Add a `budget:` block (tokens / cost_usd / max_tool_errors) to cap expensive runs.",
      "Run `vibe run pipeline.yaml` to execute. Failed steps checkpoint to `pipeline.yaml.checkpoint.json`; resume with `--resume`.",
    ],
    relatedCommands: [
      "vibe run",
      "vibe schema --list",
      "vibe doctor",
    ],
  },
};

const CONTENT: Record<WalkthroughTopic, string> = {
  scene: SCENE_WALKTHROUGH,
  pipeline: PIPELINE_WALKTHROUGH,
};

/** All walkthrough topics this CLI knows. */
export const WALKTHROUGH_TOPICS: readonly WalkthroughTopic[] = ["scene", "pipeline"] as const;

/** Pure data accessor — no I/O. Throws on unknown topic. */
export function loadWalkthrough(topic: WalkthroughTopic): WalkthroughResult {
  const meta = META[topic];
  const content = CONTENT[topic];
  if (!meta || !content) {
    throw new Error(`Unknown walkthrough topic: ${topic}`);
  }
  return {
    topic,
    title: meta.title,
    summary: meta.summary,
    steps: meta.steps,
    relatedCommands: meta.relatedCommands,
    content,
  };
}

/** List all walkthroughs (for `vibe walkthrough --list` / no-arg invocation). */
export function listWalkthroughs(): Array<{ topic: WalkthroughTopic; title: string; summary: string }> {
  return WALKTHROUGH_TOPICS.map((topic) => ({
    topic,
    title: META[topic].title,
    summary: META[topic].summary,
  }));
}

/** Type guard for runtime topic validation. */
export function isWalkthroughTopic(value: unknown): value is WalkthroughTopic {
  return typeof value === "string" && (WALKTHROUGH_TOPICS as readonly string[]).includes(value);
}
