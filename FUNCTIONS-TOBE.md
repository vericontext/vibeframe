# VibeFrame Functions TO-BE

Public usage reference: see [FUNCTIONS.md](FUNCTIONS.md). This file remains a
planning/design note and intentionally keeps TO-BE language.

This document describes the ideal VibeFrame CLI lineup and workflow.
It is intentionally product-facing and agent-facing, not a mirror of the
current command tree.

## Vision

VibeFrame should be an agentic CLI for turning a written storyboard into a
finished video.

The ideal user experience is:

```text
User describes the video intent
-> Agent writes or edits STORYBOARD.md and DESIGN.md
-> VibeFrame generates image/video/narration assets
-> VibeFrame composes timed scenes
-> Agent inspects, applies deterministic repairs or semantic edits, and re-renders
-> Final video is produced
```

The target hosts are Codex, Claude Code, Cursor, and other coding agents.
The CLI must be useful for humans, but the primary design goal is that an
agent can operate it reliably through shell commands, JSON output, schemas,
dry runs, and deterministic project files.

## Product Pillars

| Pillar                     | Meaning                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| Storyboard-first           | `STORYBOARD.md` is the source of truth for scene intent, narration, visual cues, and timing         |
| Design-aware               | `DESIGN.md` controls visual style, typography, palette, motion language, and tone                   |
| Asset orchestration        | Image, video, narration, music, and sound assets are generated from explicit cues                   |
| Scene composition          | Each beat becomes a timed scene composition with proper duration and root timeline wiring           |
| Agent loop                 | Agents can draft, plan, dry-run, build, inspect, repair, lint, and render without guessing          |
| Local-first where possible | FFmpeg, detection, timeline operations, and linting should be free/local when possible              |
| Provider-flexible          | AI providers are swappable behind stable command contracts                                          |
| Cached by content          | Re-running an agent loop should reuse unchanged narration, image, video, and composition outputs    |
| Small public surface       | Public commands should stay few and orthogonal; advanced primitives can remain hidden or agent-only |

## Canonical Project Workflow

This is the main flow VibeFrame should optimize.

```bash
vibe init my-video --from "45-second launch video for an AI-native editor" --json

# Agent or human edits:
# - my-video/STORYBOARD.md
# - my-video/DESIGN.md

vibe storyboard validate my-video --json
vibe plan my-video --json
vibe build my-video --dry-run --max-cost 5 --json
vibe build my-video --max-cost 5 --json
vibe inspect render my-video --cheap --json
vibe scene repair my-video --json
codex "fix any semantic issues from review-report.json"
vibe render my-video --json
```

The canonical mental model:

```text
init
-> author or revise storyboard/design
-> plan
-> generate primitives
-> compose scenes
-> sync timing
-> inspect
-> deterministic repair or host-agent edits
-> render
```

## Core Files

| File                             | Purpose                                                       |
| -------------------------------- | ------------------------------------------------------------- |
| `STORYBOARD.md`                  | Scene/beat source of truth                                    |
| `DESIGN.md`                      | Visual system and motion direction                            |
| `vibe.config.json`               | Provider, model, quality, and build defaults                  |
| `assets/`                        | Generated or user-provided media assets                       |
| `compositions/`                  | Per-scene HTML/TSX/Remotion composition files                 |
| `index.html` or root composition | Root timeline and scene/audio wiring                          |
| `build-report.json`              | Machine-readable build result, costs, warnings, asset paths   |
| `review-report.json`             | Machine-readable inspection results and suggested fixes       |
| `.vibeframe/cache/`              | Content-addressed cache for generated assets and compositions |
| `jobs/`                          | Optional async provider job records for polling/resume        |

## STORYBOARD.md TO-BE Shape

`STORYBOARD.md` should be directly editable by an agent and understandable
by a human.

Each beat should support explicit cues:

````md
## Beat 01 - Hook

The viewer sees the problem in one sentence.

```yaml
duration: 4
narration: "Most product videos explain too much before they show value."
backdrop: "clean SaaS dashboard, shallow depth of field, high contrast"
video: "slow camera push across a polished interface"
motion: "large kinetic headline, subtle parallax panels"
voice: "alloy"
music: "minimal pulse, confident"
```
````

Important rules:

| Cue         | Meaning                                       |
| ----------- | --------------------------------------------- |
| `duration`  | Minimum scene duration                        |
| `narration` | Text to synthesize and align                  |
| `backdrop`  | Image generation prompt or asset reference    |
| `video`     | AI video generation prompt or asset reference |
| `motion`    | Motion/composition instruction                |
| `voice`     | Voice override                                |
| `music`     | Music or sound design direction               |
| `asset`     | Existing media file to use                    |

Narration duration should be authoritative when it is longer than the
declared duration.

```text
actual scene duration = max(storyboard duration, narration duration + padding)
```

### Agent-Safe Storyboard Editing

The human-readable format can remain Markdown with cue blocks, but agents
should not have to rely on fragile regex edits for routine changes.

TO-BE mutation commands:

| Command                                      | Role                                           |
| -------------------------------------------- | ---------------------------------------------- |
| `vibe storyboard list`                       | List beats, ids, cues, and durations           |
| `vibe storyboard get <beat>`                 | Print one beat as structured JSON              |
| `vibe storyboard set <beat> <key> <value>`   | Update one cue without raw file editing        |
| `vibe storyboard move <beat> --after <beat>` | Reorder beats safely                           |
| `vibe storyboard revise`                     | Revise existing `STORYBOARD.md` from a request |
| `vibe storyboard validate`                   | Validate cue blocks and beat ids               |

Humans can edit `STORYBOARD.md` directly. Agents should prefer the mutation
API for narrow changes and direct file edits for larger creative rewrites.

Layer mental model:

```text
storyboard = intent layer
scene      = generated artifact layer
```

`vibe storyboard *` edits or validates the source of truth. `vibe scene *`
validates or repairs generated composition artifacts. README and
`vibe context` should state this explicitly to prevent hallucinated commands
such as `vibe scene set`.

`DESIGN.md` should stay directly editable in P0. It is less structurally
fragile than per-beat storyboard cues, so a separate `vibe design set`
surface is not required until repeated agent failures prove otherwise.
`vibe scene list-styles` can seed or inspect design presets.

## Surface Area Policy

The TO-BE design should reduce the public mental model even if the internal
CLI keeps many primitives.

| Surface              | Policy                                                                |
| -------------------- | --------------------------------------------------------------------- |
| First-run docs       | Show only project, generation, edit, inspect, and agent loop commands |
| Full reference       | Include all commands, but label power/advanced/legacy clearly         |
| Schema for agents    | Prefer fewer high-level commands with stable structured parameters    |
| Existing subcommands | Keep for compatibility unless they actively confuse the product story |
| New commands         | Add only when they remove ambiguity or enable a missing agent loop    |

Do not add a top-level command just because an internal stage exists. A stage
flag on `vibe build` is often clearer than another public verb.

### Public / Advanced / Legacy Candidates

This table is intentionally opinionated. It turns the surface-area policy
into an implementation queue.

| Command or area                           | TO-BE classification        | Replacement / rationale                                                                   |
| ----------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------- |
| `vibe init --from`                        | Public                      | Cold-start entry point                                                                    |
| `vibe storyboard revise`                  | Public/agent-facing         | Revision path after project creation                                                      |
| `vibe generate storyboard`                | Legacy unless project-ready | Replace with `init --from` or `storyboard revise`; keep only if it writes `STORYBOARD.md` |
| `vibe generate narration`                 | Public primitive            | Product-facing name for TTS                                                               |
| `vibe generate speech`                    | Legacy alias                | Keep as compatibility alias for `generate narration`                                      |
| `vibe generate image/video`               | Public primitives           | Useful directly and through `build --stage assets`                                        |
| `vibe generate music/sound-effect`        | Public primitives           | Useful directly and through `build --stage assets`                                        |
| `vibe generate background`                | Legacy alias                | Fold into `generate image --role backdrop` or build asset generation                      |
| `vibe generate motion`                    | Legacy/advanced             | Replace project use with `build --stage compose`; keep media-overlay use under `edit`     |
| `vibe generate video-status/*-status`     | Legacy/internal             | Replace with `vibe status job`                                                            |
| `vibe generate video-cancel/extend`       | Advanced provider controls  | Keep hidden or advanced; connect to stable job records                                    |
| `vibe build --stage compose`              | Public/agent-facing         | Preferred over top-level `vibe compose`                                                   |
| `vibe scene compose-prompts`              | Internal/agent primitive    | Used by `build --mode agent`; not first-run UX                                            |
| `vibe scene install-skill`                | Internal                    | Build/init should install what is needed                                                  |
| `vibe scene add`                          | Advanced                    | Useful for one-off scene authoring, not core workflow                                     |
| `vibe scene list-styles`                  | Public helper               | Design preset discovery for `DESIGN.md`                                                   |
| `vibe remix regenerate-scene`             | Legacy/advanced             | Replace with `build --beat <id> --force`                                                  |
| `vibe inspect media`                      | Public                      | Main AI understanding entry point                                                         |
| `vibe inspect video`                      | Legacy alias                | Fold into `inspect media`                                                                 |
| `vibe inspect review`                     | Legacy alias                | Fold into `inspect render --ai`                                                           |
| `vibe inspect suggest`                    | Advanced                    | Useful, but reports should drive host-agent edits                                         |
| `vibe edit caption/silence-cut/reframe`   | Public media edits          | Clear user-facing operations                                                              |
| `vibe edit text-overlay/fade/interpolate` | Advanced local edits        | Useful primitives, not first-run product story                                            |
| `vibe edit fill-gaps/speed-ramp/grade`    | Advanced AI edits           | Keep, but require dry-run/cost visibility                                                 |
| `vibe audio list-voices`                  | Tooling/helper              | Provider discovery, not a video feature                                                   |
| `vibe timeline *`                         | Power/agent tool            | Precise timeline JSON manipulation only                                                   |
| `vibe batch *`                            | Power/script tool           | Bulk operations only                                                                      |
| `vibe media *`                            | Power/script utility        | Metadata/duration lookup                                                                  |
| `vibe demo`                               | Smoke test                  | Useful for OSS confidence, not a product lane                                             |
| `vibe guide`                              | Documentation helper        | Keep as walkthrough support                                                               |
| `vibe completion`                         | Tooling appendix            | Shell ergonomics, not a video feature                                                     |
| `vibe agent`                              | Fallback/demo               | Host-agent integration is the north star                                                  |

## Ideal Command Lineup

### 1. Project Commands

These are the commands a first-time user should learn first.

| Command                  | Role                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `vibe init`              | Create a storyboard-first project                                                     |
| `vibe init --from`       | Draft initial `STORYBOARD.md` and `DESIGN.md` from a brief                            |
| `vibe storyboard revise` | Revise an existing `STORYBOARD.md` from a request or source file                      |
| `vibe plan`              | Read `STORYBOARD.md` and show the build plan, costs, missing cues, and provider needs |
| `vibe build`             | Generate primitives, compose scenes, sync timing, optionally render                   |
| `vibe status job`        | Poll async provider jobs                                                              |
| `vibe status project`    | Poll project build/generation state                                                   |
| `vibe render`            | Render the current project                                                            |
| `vibe doctor`            | Check local tools, providers, keys, and project health                                |

TO-BE behavior:

```bash
vibe init my-video --from brief.md --json
vibe storyboard validate my-video --json
vibe plan my-video --json
vibe build my-video --stage assets --json
vibe build my-video --stage compose --json
vibe build my-video --stage sync --json
vibe build my-video --stage render --json
vibe build my-video --beat hook --stage all --force --json
vibe build my-video --stage all --max-cost 5 --json
vibe status project my-video --json
vibe render my-video --json
```

`vibe build` should be the main scene-composition engine, not a thin wrapper.

It should:

1. Parse `STORYBOARD.md`.
2. Parse `DESIGN.md`.
3. Resolve providers and models.
4. Generate missing narration assets.
5. Generate missing image/video/backdrop assets.
6. Compose per-beat scene files.
7. Lint and repair mechanical composition issues.
8. Sync root timeline clips and audio.
9. Adjust durations from narration/audio.
10. Reuse cached assets when cue content has not changed.
11. Emit job ids and status records for long-running providers.
12. Produce `build-report.json`.
13. Render when requested.

Build stages should be explicit enough for debugging and retries:

| Stage     | Responsibility                                                     |
| --------- | ------------------------------------------------------------------ |
| `assets`  | Generate or reuse narration, image, video, music, and sound assets |
| `compose` | Generate or update per-beat composition files                      |
| `sync`    | Wire root timeline clips/audio and update durations                |
| `render`  | Render the current project to the requested output                 |
| `all`     | Run the full stage sequence                                        |

Every stage should write a stage-specific report section and provide
`retryWith` suggestions when it fails.

### 2. Asset Generation Commands

These are lower-level primitives. Humans can call them directly, but their
main purpose is to be called by `vibe build` or an agent.

| Command                      | Role                               |
| ---------------------------- | ---------------------------------- |
| `vibe generate image`        | Generate still images or backdrops |
| `vibe generate video`        | Generate video clips               |
| `vibe generate narration`    | Generate narration from text       |
| `vibe generate music`        | Generate background music          |
| `vibe generate sound-effect` | Generate sound effects             |
| `vibe generate thumbnail`    | Generate or extract thumbnails     |
| `vibe status job`            | Poll long-running generation jobs  |

Preferred TO-BE naming:

```text
generate narration
```

should become the product-facing name for TTS. Internally this may map to
the current speech/TTS implementation.

`generate storyboard` should not remain a disconnected JSON generator. Cold
start is part of the core product loop, so project-ready storyboard drafting
belongs in P0. It should become one of these:

| Option                                                 | Meaning                                             |
| ------------------------------------------------------ | --------------------------------------------------- |
| `vibe init --from`                                     | Create a new project with drafted storyboard/design |
| `vibe storyboard revise`                               | Revise existing `STORYBOARD.md` from a request      |
| `vibe generate storyboard --format md --write-project` | Legacy-compatible path if retained                  |

The ideal revision command is:

```bash
vibe storyboard revise my-video --from brief.md --duration 45 --json
```

The ideal cold-start command is:

```bash
vibe init my-video --from brief.md --duration 45 --json
```

Long-running generation should return a stable job id when it cannot finish
within the command invocation. Agents should be able to poll:

```bash
vibe status job <job-id> --json
vibe status project my-video --json
```

### 3. Scene Composition Stage

Scene composition is a core product capability, but users should usually
experience it through `vibe build`.

| Command                      | Role                                                   |
| ---------------------------- | ------------------------------------------------------ |
| `vibe build --stage compose` | Compose scenes from `STORYBOARD.md` and `DESIGN.md`    |
| `vibe build --beat <id>`     | Regenerate one beat's assets/composition/render path   |
| `vibe scene lint`            | Validate generated scene files                         |
| `vibe scene repair`          | Apply deterministic mechanical fixes to scene files    |
| `vibe scene list-styles`     | Browse style presets for `DESIGN.md`                   |
| `vibe scene compose-prompts` | Internal/agent primitive for host-authored scene files |

TO-BE:

```bash
vibe build my-video --stage compose --json
vibe build my-video --stage compose --beat hook --json
vibe scene lint my-video --json
vibe scene repair my-video --json
```

Do not introduce a public top-level `vibe compose` until there is strong
evidence that `vibe build --stage compose` is insufficient. Composition
deserves a clear product concept, but the public command surface should stay
small.

`vibe scene repair` must stay deterministic. It may fix root timeline wiring,
duration mismatches, missing marker blocks, malformed generated HTML shells,
and other mechanical issues. It should not perform semantic creative rewrites;
those belong to the host agent using the reports.

Composition requirements:

| Requirement                                     | Why                                                  |
| ----------------------------------------------- | ---------------------------------------------------- |
| Beat duration must match root timeline duration | Prevents black frames and timing drift               |
| Narration audio must be root-wired              | Sub-composition audio is not enough for final muxing |
| Generated scenes must respect `DESIGN.md`       | Keeps multi-scene videos coherent                    |
| Scene files must be deterministic               | Enables agent repair loops                           |
| Lint output must be machine-readable            | Lets Codex/Claude/Cursor fix issues                  |

### 4. Review, Inspect, and Repair Commands

Agents need reliable feedback loops.

| Command                       | Role                                                             |
| ----------------------------- | ---------------------------------------------------------------- |
| `vibe inspect project`        | Inspect project completeness and likely render issues            |
| `vibe inspect media`          | Ask AI to understand an image/video/URL                          |
| `vibe inspect render --cheap` | Local render checks: black frames, duration drift, missing audio |
| `vibe inspect render --ai`    | AI critique of final render quality                              |
| `vibe detect scenes`          | Detect scene changes locally                                     |
| `vibe detect silence`         | Detect silence locally                                           |
| `vibe detect beats`           | Detect music beats locally                                       |
| `vibe scene repair`           | Apply deterministic mechanical fixes                             |

TO-BE agent loop:

```bash
vibe storyboard validate my-video --json
vibe plan my-video --json
vibe inspect project my-video --json
vibe inspect render my-video --cheap --json
vibe scene lint my-video --json
vibe scene repair my-video --json
codex "fix semantic issues from review-report.json"
vibe render my-video --json
```

`inspect` should mean AI understanding. `detect` should mean local
timestamp/structure detection.

The cheap local render inspection should run before expensive AI critique.
Agents should reserve `--ai` for final review or ambiguous visual quality
checks.

### 5. Edit Existing Media Commands

These commands operate on existing files. They are useful, but they are
not the core storyboard-to-video workflow.

| Command                    | Role                            |
| -------------------------- | ------------------------------- |
| `vibe edit caption`        | Add captions                    |
| `vibe edit silence-cut`    | Remove silent sections          |
| `vibe edit jump-cut`       | Remove filler-word sections     |
| `vibe edit reframe`        | Reframe to another aspect ratio |
| `vibe edit upscale`        | Upscale                         |
| `vibe edit grade`          | Color grade                     |
| `vibe edit motion-overlay` | Overlay motion graphics         |
| `vibe edit image`          | Edit still images               |

TO-BE grouping:

```text
Common edits:
caption / silence-cut / jump-cut / reframe / upscale

Advanced edits:
grade / motion-overlay / image / fill-gaps / speed-ramp
```

Agents should prefer:

```text
inspect/detect -> dry-run -> edit -> inspect again
```

### 6. Audio Commands

Audio commands should support both standalone media work and project builds.

| Command                   | Role                                     |
| ------------------------- | ---------------------------------------- |
| `vibe audio transcribe`   | Transcribe audio/video                   |
| `vibe generate narration` | Generate narration for scenes            |
| `vibe audio duck`         | Duck music under speech                  |
| `vibe audio dub`          | Dub media into another language          |
| `vibe audio isolate`      | Isolate vocals                           |
| `vibe audio clone-voice`  | Clone a voice with explicit user consent |

TO-BE:

`narration` should be a first-class project concept, not just a generic
speech generation command.

In build reports, narration should expose:

| Field              | Meaning                            |
| ------------------ | ---------------------------------- |
| `text`             | Narration text                     |
| `voice`            | Resolved voice                     |
| `provider`         | Provider used                      |
| `path`             | Generated audio asset              |
| `durationSec`      | Measured audio duration            |
| `sceneDurationSec` | Final scene duration after padding |

### 7. Repurpose Existing Content

This is a separate product lane from storyboard-to-video.

| Command                       | Role                  |
| ----------------------------- | --------------------- |
| `vibe remix highlights`       | Extract highlights    |
| `vibe remix auto-shorts`      | Generate shorts       |
| `vibe remix animated-caption` | Add animated captions |

TO-BE:

`remix regenerate-scene` should either be reworked into the project build
flow or moved to advanced/legacy. Scene regeneration belongs closer to:

```bash
vibe build my-video --beat hook --force
vibe build my-video --stage compose --beat hook --force
```

### 8. Timeline, Batch, and Media Utilities

These are power tools. They should remain available for agents and scripts,
but should not be presented as first-run features.

| Command               | Role                                 |
| --------------------- | ------------------------------------ |
| `vibe timeline *`     | Low-level timeline JSON operations   |
| `vibe batch *`        | Bulk import/concat/effect operations |
| `vibe media info`     | Media metadata                       |
| `vibe media duration` | Script-friendly duration lookup      |

TO-BE agent policy:

```text
Use timeline commands only when:
- the project already has a timeline JSON file
- the user asks for precise clip-level edits
- build/render workflow is not the right abstraction
```

### 9. Automation and Agent Integration

These commands are not video features. They are the control plane that lets
agents operate VibeFrame safely.

| Command               | Role                                            |
| --------------------- | ----------------------------------------------- |
| `vibe run`            | Execute YAML pipelines                          |
| `vibe schema`         | Expose command schemas                          |
| `vibe context`        | Print agent instructions                        |
| `vibe status job`     | Poll async provider jobs                        |
| `vibe status project` | Poll project build/generation state             |
| `vibe agent`          | Optional fallback REPL, not the product default |
| `vibe completion`     | Shell completion                                |

Agent-facing requirements:

| Requirement                                     | Why                                       |
| ----------------------------------------------- | ----------------------------------------- |
| Every command has `--json` support where useful | Agents need structured output             |
| Expensive commands support `--dry-run`          | Agents need cost previews                 |
| Commands expose schemas                         | Agents need parameter discovery           |
| Failures include suggestions                    | Agents need recovery paths                |
| Reports include file paths                      | Agents need to inspect and modify outputs |
| Cost caps are available on expensive flows      | Agents need hard spend limits             |

North-star integration is host-agent driven: Codex, Claude Code, Cursor, and
similar tools should operate the CLI directly. `vibe agent` may remain useful
as a fallback or demo, but it should not split the product story.

`vibe context` should default to AGENTS.md-style Markdown for host agents and
also support structured output:

```bash
vibe context --format markdown
vibe context --json
```

The context output should include the storyboard-vs-scene mental model,
preferred command flow, cost rules, provider precedence, and the rule that
semantic fixes belong to the host agent while `scene repair` is deterministic.

Markdown context should be pasteable into AGENTS.md-like host instructions.
JSON context should be a compact contract:

```json
{
  "product": "vibeframe",
  "sourceOfTruth": ["STORYBOARD.md", "DESIGN.md"],
  "preferredFlow": [
    "storyboard validate",
    "plan",
    "build --dry-run",
    "build",
    "inspect render --cheap",
    "render"
  ],
  "mentalModel": {
    "storyboard": "intent layer",
    "scene": "generated artifact layer"
  },
  "semanticFixes": "host-agent",
  "mechanicalFixes": "vibe scene repair"
}
```

## Ideal Agentic Flow

### Flow A: Create a Video From a Brief

```text
User:
Create a 45-second launch video for this product.

Agent:
1. vibe init launch-video --from brief.md --json
2. Review and refine STORYBOARD.md
3. Review and refine DESIGN.md
4. vibe storyboard validate launch-video --json
5. vibe plan launch-video --json
6. vibe build launch-video --dry-run --max-cost 5 --json
7. Ask for approval if cost is high
8. vibe build launch-video --max-cost 5 --json
9. vibe inspect render launch-video --cheap --json
10. vibe inspect render launch-video --ai --json when needed
11. Fix STORYBOARD.md / DESIGN.md / scene files as needed
12. vibe render launch-video --json
```

### Flow B: Revise an Existing Project

```text
User:
Make the second scene more dramatic and shorten the ending.

Agent:
1. Read STORYBOARD.md and DESIGN.md
2. Edit affected beats
3. vibe storyboard validate my-video --json
4. vibe build my-video --beat scene-02 --stage assets --force --json
5. vibe build my-video --beat scene-02 --stage compose --force --json
6. vibe build my-video --stage sync --json
7. vibe scene lint my-video --json
8. vibe inspect render my-video --cheap --json
9. vibe render my-video --json
```

### Flow C: Generate Assets Only

```text
User:
Create a hero image and narration for this scene.

Agent:
1. vibe generate image "..." --json
2. vibe generate narration "..." --json
3. Update STORYBOARD.md cues or assets references
```

### Flow D: Repurpose Existing Video

```text
User:
Turn this 20-minute recording into 3 shorts.

Agent:
1. vibe inspect media long.mp4 "Find the best segments" --json
2. vibe remix auto-shorts long.mp4 --dry-run --json
3. vibe remix auto-shorts long.mp4 --json
4. vibe inspect render shorts/ --cheap --json
```

## Build Modes TO-BE

| Mode    | Meaning                                                                 |
| ------- | ----------------------------------------------------------------------- |
| `agent` | North-star path: host agent writes or repairs scene composition files   |
| `batch` | Headless fallback: CLI calls LLM providers internally to compose scenes |
| `auto`  | Prefer host-agent mode when detected; otherwise use batch fallback      |

TO-BE behavior:

```bash
vibe build my-video --mode agent
```

should return a clear `needs-author` plan when scene files are missing.

```bash
vibe build my-video --mode batch
```

should call the internal composer and produce scene files automatically.

Both modes should converge on the same project structure and render output.
But product investment should treat `agent` mode as the default experience
and `batch` mode as fallback/CI support, not two equally important product
stories.

## Reports and Machine Contracts

Every major command should produce stable JSON.

### Provider Resolution

Provider and model selection must be deterministic.

Recommended precedence:

```text
CLI flag
-> per-beat STORYBOARD.md cue
-> project vibe.config.json
-> environment/configured default
-> VibeFrame default
```

Every resolved provider should be visible in `plan`, `build-report.json`, and
dry-run output.

### Cost Caps

Expensive project commands should support hard cost caps:

```bash
vibe build my-video --dry-run --max-cost 5 --json
vibe build my-video --max-cost 5 --json
```

If the dry-run estimate or projected stage cost exceeds the cap, the command
should fail before spending and return `retryWith` options such as lowering
quality, skipping a stage, or increasing the cap.

### Error Envelope

Errors should use a stable machine-readable shape:

```json
{
  "success": false,
  "code": "MISSING_API_KEY",
  "message": "OPENAI_API_KEY is required for backdrop generation.",
  "suggestion": "Run `vibe setup` or set OPENAI_API_KEY.",
  "retryWith": ["vibe setup", "vibe build my-video --skip-backdrop --json"],
  "recoverable": true
}
```

`retryWith` is especially important for coding agents: it turns a failure
into a small set of next actions instead of free-form guessing.

### `vibe plan --json`

Should include:

```json
{
  "project": "my-video",
  "beats": 5,
  "missing": ["assets", "compositions"],
  "providers": ["openai", "elevenlabs", "claude"],
  "estimatedCostUsd": 4.25,
  "warnings": []
}
```

### `vibe build --json`

Should include:

```json
{
  "phase": "done",
  "beats": [
    {
      "id": "hook",
      "narrationPath": "assets/narration-hook.mp3",
      "narrationDurationSec": 4.2,
      "sceneDurationSec": 4.7,
      "backdropPath": "assets/backdrop-hook.png",
      "compositionPath": "compositions/scene-hook.html"
    }
  ],
  "outputPath": "dist/my-video.mp4",
  "costUsd": 3.18,
  "stageReports": {
    "assets": {
      "status": "done",
      "costUsd": 1.4
    },
    "compose": {
      "status": "done",
      "costUsd": 1.2
    },
    "sync": {
      "status": "done",
      "costUsd": 0
    },
    "render": {
      "status": "done",
      "costUsd": 0
    }
  },
  "warnings": []
}
```

### `vibe status job --json`

Should include:

```json
{
  "kind": "job",
  "id": "job_123",
  "jobType": "generate-video",
  "status": "running",
  "provider": "veo",
  "createdAt": "2026-05-02T00:00:00.000Z",
  "updatedAt": "2026-05-02T00:01:30.000Z",
  "progress": {
    "phase": "provider-processing"
  },
  "result": null,
  "retryWith": []
}
```

### `vibe status project --json`

Should include:

```json
{
  "kind": "project",
  "project": "my-video",
  "status": "needs-author",
  "currentStage": "compose",
  "beats": {
    "total": 5,
    "assetsReady": 5,
    "compositionsReady": 3,
    "needsAuthor": ["hook", "cta"]
  },
  "jobs": [
    {
      "id": "job_123",
      "jobType": "generate-video",
      "status": "running"
    }
  ],
  "retryWith": ["vibe build my-video --stage compose --json"]
}
```

### `vibe inspect render --json`

Should include:

```json
{
  "score": 8.1,
  "issues": [
    {
      "severity": "medium",
      "scene": "hook",
      "message": "Caption overlaps the product UI",
      "suggestedFix": "Move caption to lower third with 64px margin"
    }
  ]
}
```

## Recommended Public Feature Lineup

For README and first-run docs:

```text
1. Storyboard-to-Video
   init --from / storyboard validate / plan / build / render

2. Scene Composition
   narration + image/video assets + timed scenes from STORYBOARD.md

3. AI Asset Generation
   image / video / narration / music / sound effects

4. Media Editing
   captions / cuts / reframing / upscaling / overlays

5. Understanding and Review
   inspect / detect / lint / deterministic repair

6. Repurposing
   highlights / shorts / animated captions

7. Agent Automation
   schema / context / run / status job/project / reports
```

For the full reference:

```text
Project:
init / init --from / plan / build / status job / status project / render / doctor

Story/Design:
storyboard revise / direct DESIGN.md edits / scene list-styles

Generate:
image / video / narration / music / sound-effect / thumbnail / background

Compose:
build --stage assets / build --stage compose / build --stage sync / build --beat / scene lint / scene repair / scene list-styles

Edit:
caption / silence-cut / jump-cut / reframe / upscale / grade / motion-overlay

Audio:
transcribe / duck / dub / isolate / clone-voice

Understand:
inspect project / inspect media / inspect render --cheap / inspect render --ai / detect scenes / detect silence / detect beats

Repurpose:
highlights / auto-shorts / animated-caption

Power:
timeline / batch / media

Automation:
run / schema / context / status job / status project / agent fallback / completion
```

## Development Priorities

### P0: Make the storyboard-to-video loop excellent

Status: implemented for both the low-cost and paid dogfood loops. Remaining
work is ongoing quality tuning, not broad command design.

Done:

1. `vibe init --from` solves cold start with project-ready files.
2. `vibe storyboard revise` supports project-aware revisions.
3. `vibe storyboard validate` is called by plan/build and can be run directly.
4. `vibe build` explains stages, provider needs, cost, cache, and retry paths.
5. `vibe build --dry-run --json` is agent-usable.
6. `build-report.json` includes status, current stage, stage reports, beat
   timing, nested asset metadata, jobs, warnings, and retry commands.
7. `--max-cost` fails before provider spend when the estimate exceeds the cap.
8. Content-addressed caches cover narration, image/backdrop, video, music, and
   batch scene composition.
9. `--beat` works across build, render, inspect project, and inspect render.
10. Build stages are `assets`, `compose`, `sync`, `render`, and `all`.
11. Narration duration drives scene timing and root sync.
12. Root timeline sync is deterministic and repairable.
13. Error envelopes include `code`, `suggestion`, `recoverable`, and
    `retryWith` where useful.
14. `vibe context` defines host-agent flow, report contracts, surface policy,
    and semantic-vs-mechanical fix ownership.
15. The low-cost dogfood loop completed three repeated acceptance runs with
    valid MP4 renders and actionable `review-report.json` warnings.
16. `build-report.json` fixture coverage now includes failed validation,
    invalid assets, pending jobs, beat-only builds, render-only builds, render
    failures, and skip-render builds.
17. Repo-level paid acceptance is covered by
    `VIBE_PAID_ACCEPTANCE=1 pnpm dogfood:paid -- --max-cost 25`, including
    OpenAI/Gemini/Grok standalone image generation, Gemini/Grok build
    backdrops, Seedance video, ElevenLabs narration/music, Gemini AI review,
    render, and ffprobe verification.
18. `vibe build`/`vibe plan` support build backdrops through
    `--image-provider openai|gemini|grok`, with provider-specific API keys,
    cache keys, and image ratio metadata.

Ongoing:

1. Keep low-cost and paid dogfood acceptance in release checks when report
   shape, provider plumbing, or render timing changes.
2. Add fixtures for new build-report fields as they are introduced.

### P1: Make review and repair loops reliable

Status: implemented for cheap local review and paid AI review acceptance, with
ongoing signal/noise tuning remaining.

Done:

1. `inspect project` writes project review reports.
2. `inspect render --cheap` checks render existence, duration drift, audio,
   aspect ratio, black frames, long silence, and static-frame holds.
3. `inspect render --ai` runs project-aware Gemini review when configured.
4. `scene repair` applies deterministic mechanical scene/root fixes.
5. Reports include `summary`, `fixOwners`, `sourceReports`, and `retryWith`.
6. `status job` and `status project` cover async jobs and project workflow
   state.
7. Repeated dogfood renders produce beat-level `LONG_SILENCE` warnings with
   `timeRange`, `beatId`, timing context, and host-agent ownership instead of
   vague project-level failures.
8. Fresh paid/generated-media acceptance runs `inspect render --cheap` and
   `inspect render --ai` against rendered MP4s and verifies report shape.

Ongoing:

1. Keep cheap local checks useful without producing noisy false positives.
2. Keep AI render review findings actionable at `beatId`/`timeRange` level.

### P2: Rationalize the command surface

Status: implemented.

1. Advanced primitives are labeled or hidden from first-run help.
2. No public top-level `compose` was added; `build --stage compose` is the
   product path.
3. `vibe agent` is documented as fallback.
4. Public/agent/advanced/legacy/internal surface classification is exposed by
   schema and reference docs.

### P3: Clean up product taxonomy

Status: implemented. Demo and tape alignment is now part of normal release
maintenance, with current VHS MP4s regenerated from the local checkout.

1. `scene` is presented as generated composition internals.
2. `timeline`, `batch`, and `media` are power tools.
3. `completion`, `schema`, and `context` are tooling/control-plane support.
4. `demo` is hidden from product-first help.
5. `generate storyboard` is legacy; project-ready drafting lives in
   `init --from` and `storyboard revise`.
6. `DEMO-quickstart.md`, `DEMO-dogfood.md`, and the VHS tapes cover the
   storyboard-first paid path with a `$25` cap and local CLI wrapper.
7. Current VHS MP4s exist for quickstart and dogfood demos:
   `assets/demos/quickstart-claude-code.mp4` and
   `assets/demos/dogfood-claude-code.mp4`.

Ongoing:

1. Keep `DEMO-quickstart.md`, `DEMO-dogfood.md`, and VHS tapes aligned when
   the storyboard-first flow, provider defaults, or cost examples change.

## Non-Goals

VibeFrame should not become a generic video editor first.

The primary promise is not:

```text
manually edit timelines with many tiny commands
```

Nor is it:

```text
expose every internal primitive as a first-run feature
```

The primary promise is:

```text
write a storyboard, let an agent and CLI compose it into a video,
then inspect and refine the result
```

## North Star

The north star command sequence should feel like this:

```bash
vibe init launch --from "45-second launch video for an AI-native editor" --json
codex "review and sharpen STORYBOARD.md and DESIGN.md"
vibe storyboard validate launch --json
vibe plan launch --json
vibe build launch --dry-run --max-cost 5 --json
vibe build launch --max-cost 5 --json
vibe status project launch --refresh --json
vibe inspect project launch --json
vibe render launch --json
vibe inspect render launch --cheap --json
vibe scene repair launch --json
codex "fix semantic issues from launch/review-report.json"
vibe render launch --json
vibe inspect render launch --ai --json
```

When this loop works reliably on the dogfood demos and `review-report.json`
points to actionable beat-level fixes, VibeFrame has achieved its core vision.
