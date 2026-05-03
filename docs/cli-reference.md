# VibeFrame CLI Reference

> **Auto-generated** from `vibe schema --list`. Do not edit by hand —
> run `pnpm gen:reference` after any flag/command change.

VibeFrame is CLI-first: every operation is a shell command. This file
lists every command, its arguments, and its options. For agentic /
machine-readable access use `vibe schema --list` and
`vibe schema <command>` directly; both return JSON.

> CLI version: `0.103.1`

## Mental model

The **storyboard project** is the primary product lane. `STORYBOARD.md`
and `DESIGN.md` are the source of truth; generated files under
`compositions/` are artifacts. Use `vibe storyboard revise --dry-run`
for project-aware STORYBOARD.md rewrites, `vibe storyboard *` for narrow
cue edits, and direct Markdown edits for larger DESIGN.md rewrites.

```
init --from → storyboard revise → storyboard validate → plan → build → inspect → render
generate / edit / inspect / remix                          ← one-shot media tools
scene / timeline                                            ← lower-level authoring
run / agent / schema / context                              ← automation + agents
```

`vibe plan --json` emits `data.kind:"build-plan"`,
`schemaVersion:"1"`, `status:"ready"|"invalid"`, `summary`,
`providerResolution`, cache-aware per-asset plans, asset reference metadata
(`sourcePath`, `referenceError`), `validation`, `retryWith`, and
`nextCommands`. Existing project-local media referenced by `backdrop`,
`video`, `music`, `narration`, or generic `asset` cues is planned as
`reason:"referenced-asset"` with no provider spend; invalid/out-of-project
paths are surfaced before provider dispatch. `vibe plan`,
`vibe build --dry-run`, and `vibe build` validate `STORYBOARD.md` before
cost caps or provider dispatch. Invalid storyboards return
`code:"STORYBOARD_VALIDATION_FAILED"` with validate/revise recovery commands.

Real `vibe build` runs deterministic scene repair after compose
(sub-compositions only) and after sync (including root `index.html`) before
render. Repair failures return `code:"SCENE_REPAIR_FAILED"` with
`sceneRepair.retryWith`, and `build-report.json` includes `sceneRepair`.
`vibe scene repair` also fixes deterministic root timeline drift: clip refs,
root duration, and root narration audio wiring.
Asset-stage failures stop the full build before compose/render and return
`currentStage:"assets"` with `code:"ASSET_REFERENCE_INVALID"`,
`code:"MISSING_API_KEY"`, or `code:"ASSET_GENERATION_FAILED"` plus
`suggestion`, `recoverable:true`, and `retryWith`.
Compose failures return `code:"COMPOSE_FAILED"`; render failures return the
render code or `code:"RENDER_FAILED"`. Both include `currentStage`,
`suggestion`, `recoverable:true`, and `retryWith`.

`vibe inspect project` and `vibe inspect render` write
`review-report.json` by default. The file uses `kind:"review"`,
`mode:"project"|"render"`, `status`, `score`, `issues[]`,
`summary:{issueCount,errorCount,warningCount,infoCount,fixOwners}`,
`sourceReports`, and `retryWith`. Issue-level `fixOwner:"vibe"` means
deterministic CLI recovery; `fixOwner:"host-agent"` means storyboard/design/
composition edits should be handled by the host agent.

## Global flags

Defined on the root `vibe` program and available across commands:

| Flag              | Effect                                                     |
| ----------------- | ---------------------------------------------------------- |
| `-V, --version`   | Print version and exit                                     |
| `-h, --help`      | Print help for the command and exit                        |
| `--json`          | Output JSON (auto-enabled when stdout is piped)            |
| `--fields <list>` | Limit JSON output fields (e.g. `--fields "path,duration"`) |
| `-q, --quiet`     | Output only the result value (path / URL / ID)             |
| `--stdin`         | Read options from stdin as JSON (agent / script use)       |
| `--describe`      | Print the command's JSON Schema and exit (no execution)    |

## Option discovery

Short aliases are command-local. Use `vibe <command> --help` for the
exact CLI spelling, and use `vibe schema <command>` for stable
machine-readable parameter names. Scripts and agents should prefer long
flags, `--stdin`, or schema fields over one-letter aliases.

`--dry-run` is also command-specific: most paid or mutating commands
support it, but it is not a root/global flag. Check the command schema or
`--help` page before assuming it exists.

## Product surfaces

Generated from the live `surface` field in `vibe schema --list`. Use
`vibe schema --list --surface public` for the small first-run command
surface, and inspect `replacement` on legacy commands before using them.

| Surface      | Count | Examples                                                                                                                                                                                                                  |
| ------------ | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Public**   |    36 | `generate.image` · `generate.video` · `generate.narration` · `generate.sound-effect` · `generate.music` · `generate.thumbnail` · `edit.silence-cut` · `edit.caption` · `edit.noise-reduce` · `edit.jump-cut` · +26 more   |
| **Agent**    |     8 | `storyboard.list` · `storyboard.get` · `storyboard.set` · `storyboard.move` · `run` · `scene.lint` · `scene.repair` · `context`                                                                                           |
| **Advanced** |    40 | `generate.motion` · `generate.video-cancel` · `generate.video-extend` · `edit.fade` · `edit.translate-srt` · `edit.fill-gaps` · `edit.motion-overlay` · `edit.grade` · `edit.text-overlay` · `edit.speed-ramp` · +30 more |
| **Legacy**   |     8 | `generate.speech` · `generate.music-status` · `generate.storyboard` · `generate.background` · `generate.video-status` · `inspect.video` · `inspect.review` · `remix.regenerate-scene`                                     |
| **Internal** |     2 | `scene.install-skill` · `scene.compose-prompts`                                                                                                                                                                           |

## Cost tiers

Generated from the live `cost` field in `vibe schema --list`. Examples
prefer public and agent-facing commands; legacy/internal commands remain
listed in their command sections for compatibility.

| Tier           | Count | Examples                                                                                                                                                                    | Per-call cost                                                                                     |
| -------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Free**       |    46 | `audio.duck` · `detect.beats` · `detect.scenes` · `detect.silence` · `edit.noise-reduce` · `generate.thumbnail` · `inspect.project` · `scene.list-styles` · +38 more        | FFmpeg only, no API call                                                                          |
| **Low**        |    22 | `audio.transcribe` · `edit.caption` · `edit.jump-cut` · `edit.silence-cut` · `generate.music` · `generate.narration` · `generate.sound-effect` · `inspect.media` · +14 more | $0.01–$0.10 per call                                                                              |
| **High**       |    10 | `audio.dub` · `edit.reframe` · `edit.upscale` · `generate.image` · `remix.auto-shorts` · `remix.highlights` · `edit.image` · `generate.motion` · +2 more                    | $1–$5 per call                                                                                    |
| **Very High**  |     4 | `generate.video` · `edit.fill-gaps` · `generate.video-extend` · `remix.regenerate-scene`                                                                                    | $5–$50+ per call                                                                                  |
| **Not tagged** |    12 | `build` · `doctor` · `guide` · `init` · `plan` · `render` · `setup` · `context` · +4 more                                                                                   | Utility/orchestration/reference commands; inspect command behavior before assuming provider spend |

> **Tip:** Run `<paid command> --dry-run --json` first — the response
> includes a `costUsd` estimate when the command supports dry-run.

## JSON envelope

### Success

```jsonc
{
  "command": "<group> <leaf>",
  "elapsedMs": 12345,
  "costUsd": 0.07,
  "warnings": [],
  "data": {
    /* command-specific */
  },
  "dryRun": true, // present only when --dry-run was passed
}
```

### Error (written to stderr)

```json
{
  "success": false,
  "error": "<message>",
  "message": "<message>",
  "code": "USAGE_ERROR | NOT_FOUND | API_ERROR | NETWORK_ERROR | AUTH_ERROR | ERROR",
  "exitCode": 0 | 1 | 2 | 3 | 4 | 5 | 6,
  "suggestion": "<actionable next step>",
  "retryWith": ["<command or action>"],
  "recoverable": true,
  "retryable": true | false
}
```

| Exit code | Meaning               |
| --------- | --------------------- |
| 0         | success               |
| 1         | generic error         |
| 2         | usage error (bad arg) |
| 3         | not found             |
| 4         | auth failure          |
| 5         | API error             |
| 6         | network error         |

## CLI ↔ MCP tool name mapping

`@vibeframe/mcp-server` is generated from the CLI/tool manifest, not
from this markdown file. The common naming convention is:

```
Rule 1.  vibe <group> <leaf>   →  <group>_<leaf>      (snake_case)
         e.g. vibe edit silence-cut → edit_silence_cut

Rule 2.  Manifest-only helpers may expose filesystem/project/media
         operations that do not have a 1:1 top-level CLI command.

Rule 3.  Interactive diagnostics and local setup commands may remain
         CLI-only. Use MCP tools/list or the manifest as the source of
         truth for exact availability.
```

## Commands

### Top-level commands

#### `vibe agent`

Optional built-in natural-language agent (fallback when no external coding agent is driving vibe)

Product surface: `advanced`
Note: Optional fallback REPL; external coding agents are the primary workflow.

Cost tier: _not tagged_

**Parameters:**

- `provider` _(string)_ _(openai \| claude \| gemini \| ollama \| xai \| openrouter)_ _(default: `"openai"`)_ — LLM provider (openai, claude, gemini, ollama, xai, openrouter)
- `model` _(string)_ — Model to use (provider-specific)
- `project` _(string)_ — Timeline file or directory to load
- `verbose` _(boolean)_ — Show verbose output including tool calls
- `maxTurns` _(number)_ _(default: `10`)_ — Maximum turns per request
- `input` _(string)_ — Run a single query and exit (non-interactive)
- `confirm` _(boolean)_ — Confirm before every tool — broadens the default cost gate (paid only) to all calls
- `noConfirm` _(boolean)_ — Disable all confirm prompts including the high/very-high cost gate (CI / automation)
- `budgetUsd` _(number)_ — Reject tool calls past this cumulative USD ceiling using conservative tier estimates

#### `vibe build`

Build a VibeFrame video project from STORYBOARD.md

Product surface: `public`
Note: Primary storyboard-to-video build engine.

Cost tier: _not tagged_

**Parameters:**

- `project-dir` _(string)_ — Video project directory
- `stage` _(string)_ _(default: `"all"`)_ — Build stage: assets|compose|sync|render|all
- `beat` _(string)_ — Restrict asset/compose work to one beat id
- `mode` _(string)_ _(default: `"auto"`)_ — Build mode: agent|batch|auto
- `effort` _(string)_ _(default: `"medium"`)_ — Compose effort tier (batch mode only): low|medium|high
- `composer` _(string)_ — Batch composer: claude|openai|gemini
- `maxCost` _(number)_ — Fail before provider spend when estimated cost exceeds this USD cap
- `skipNarration` _(boolean)_ — Don't dispatch TTS even when beats declare narration cues
- `skipBackdrop` _(boolean)_ — Don't dispatch image-gen even when beats declare backdrop cues
- `skipVideo` _(boolean)_ — Don't dispatch video generation even when beats declare video cues
- `skipMusic` _(boolean)_ — Don't dispatch music generation even when beats declare music cues
- `skipRender` _(boolean)_ — Compose only — don't render to MP4
- `tts` _(string)_ — TTS provider: auto|elevenlabs|kokoro
- `voice` _(string)_ — Voice id
- `imageProvider` _(string)_ — Image provider: openai|gemini|grok
- `videoProvider` _(string)_ — Video provider: seedance|grok|kling|runway|veo
- `musicProvider` _(string)_ — Music provider: elevenlabs|replicate
- `quality` _(string)_ _(default: `"hd"`)_ — Image quality: standard|hd
- `imageSize` _(string)_ _(default: `"1536x1024"`)_ — Image size: 1024x1024|1536x1024|1024x1536
- `force` _(boolean)_ — Re-dispatch primitives even when assets already exist
- `dryRun` _(boolean)_ — Preview parameters without dispatching

`--dry-run --json` returns `data.plan.kind:"build-plan"`. `build --dry-run` and real `build` validate `STORYBOARD.md` before cost caps or provider dispatch, and invalid storyboards fail with `code:"STORYBOARD_VALIDATION_FAILED"` plus validate/revise `retryWith` commands.
Real `build` runs deterministic scene repair after compose and sync before render. JSON/build-report payloads include `providerResolution`, nested asset `sourcePath`, nested `composition` status/cache metadata, and `sceneRepair`; repair failures use `code:"SCENE_REPAIR_FAILED"` and `sceneRepair.retryWith`. `scene repair` also fixes root clip refs, root duration, and root narration audio wiring.
Asset-stage failures stop before compose/render and return `currentStage:"assets"` with `code:"ASSET_REFERENCE_INVALID"|"MISSING_API_KEY"|"ASSET_GENERATION_FAILED"`, `suggestion`, `recoverable:true`, and `retryWith`.
Compose failures return `code:"COMPOSE_FAILED"`; render failures return the render code or `code:"RENDER_FAILED"`. Both include `currentStage`, `suggestion`, `recoverable:true`, and `retryWith`.

#### `vibe completion`

Print a shell completion script for `vibe`

Product surface: `advanced`
Note: Shell ergonomics helper.

Cost tier: _not tagged_

**Parameters:**

- `shell` _(string)_ **required** — Target shell: zsh | bash | fish

#### `vibe context`

Print CLI context/guidelines for AI agent integration

Product surface: `agent`
Note: Host-agent integration contract.

Cost tier: _not tagged_

**Parameters:**

- `format` _(string)_ _(default: `"markdown"`)_ — Output format: markdown | json

#### `vibe demo`

Run sample edits on a test video (no API keys needed)

Product surface: `advanced`
Note: Smoke-test/demo helper, not a core workflow.

Cost tier: _not tagged_

**Parameters:**

- `keep` _(boolean)_ — Keep demo output files after completion
- `json` _(boolean)_ — Output results as JSON

#### `vibe doctor`

Check system health and available commands

Product surface: `public`
Note: System and provider health check.

Cost tier: _not tagged_

**Parameters:**

- `json` _(boolean)_ — Output in JSON format
- `verbose` _(boolean)_ — Show full report (every provider row, scene composer block, free-command list)
- `testKeys` _(boolean)_ — Make a lightweight authenticated request to each provider (validates configured keys; skips providers without a cheap test endpoint)

#### `vibe guide`

Step-by-step guide for a vibe workflow (universal /vibe-\* slash-command equivalent)

Product surface: `public`
Note: Workflow chooser and first-run guidance.

Cost tier: _not tagged_

**Parameters:**

- `topic` _(string)_ — Guide topic: motion | scene | pipeline | architecture. Omit to list all.
- `list` _(boolean)_ — List available guides and exit

#### `vibe init`

Scaffold a VibeFrame project (video scene project or project-scope agent files)

Product surface: `public`
Note: Storyboard-to-video cold-start entrypoint.

Cost tier: _not tagged_

**Parameters:**

- `project-dir` _(string)_ — Project directory (defaults to cwd)
- `type` _(string)_ _(default: `"scene"`)_ — Project type: scene (video project) | agent (agent files only)
- `profile` _(string)_ _(minimal \| agent \| full)_ _(default: `"agent"`)_ — Scene profile: minimal (storyboard/design only), agent (recommended), full (render scaffold upfront)
- `from` _(string)_ — Draft STORYBOARD.md and DESIGN.md from a brief string or text/markdown file
- `ratio` _(string)_ _(16:9 \| 9:16 \| 1:1 \| 4:5)_ _(default: `"16:9"`)_ — Scene aspect ratio: 16:9, 9:16, 1:1, 4:5
- `duration` _(number)_ _(default: `10`)_ — Default scene/root duration in seconds
- `visualStyle` _(string)_ — Seed scene DESIGN.md from a named style
- `agent` _(string)_ _(default: `"auto"`)_ — Agent target: claude-code | codex | cursor | aider | gemini-cli | opencode | all | auto
- `force` _(boolean)_ — Overwrite existing files instead of skipping
- `dryRun` _(boolean)_ — Print the file list without writing anything

#### `vibe plan`

Read STORYBOARD.md and show build plan, costs, missing cues, and provider needs

Product surface: `public`
Note: Storyboard-to-video planning contract.

Cost tier: _not tagged_

**Parameters:**

- `project-dir` _(string)_ — Video project directory
- `stage` _(string)_ _(default: `"all"`)_ — Stage to plan: assets|compose|sync|render|all
- `beat` _(string)_ — Restrict the plan to one beat
- `mode` _(string)_ _(default: `"auto"`)_ — Build mode: agent|batch|auto
- `skipNarration` _(boolean)_ — Don't include narration generation in the plan
- `skipBackdrop` _(boolean)_ — Don't include backdrop image generation in the plan
- `skipVideo` _(boolean)_ — Don't include video generation in the plan
- `skipMusic` _(boolean)_ — Don't include music generation in the plan
- `tts` _(string)_ — TTS provider: auto|elevenlabs|kokoro
- `voice` _(string)_ — Voice id
- `imageProvider` _(string)_ — Image provider: openai|gemini|grok
- `videoProvider` _(string)_ — Video provider: seedance|grok|kling|runway|veo
- `musicProvider` _(string)_ — Music provider: elevenlabs|replicate
- `quality` _(string)_ — Image quality: standard|hd
- `imageSize` _(string)_ — Image size: 1024x1024|1536x1024|1024x1536
- `composer` _(string)_ — Batch composer: claude|openai|gemini
- `force` _(boolean)_ — Plan regeneration even when outputs already exist
- `maxCost` _(number)_ — Fail if estimated cost exceeds this USD cap

JSON payload: `data.kind` is `"build-plan"` and includes `schemaVersion:"1"`, `status:"ready"|"invalid"`, `summary`, `providerResolution`, cache-aware asset plans, asset reference metadata, `validation`, `retryWith`, and `nextCommands`. Invalid storyboards exit non-zero with `code:"STORYBOARD_VALIDATION_FAILED"`.

#### `vibe render`

Render a VibeFrame video project to MP4/WebM/MOV

Product surface: `public`
Note: Project render entrypoint.

Cost tier: _not tagged_

**Parameters:**

- `project-dir` _(string)_ — Video project directory
- `out` _(string)_ — Output file (default: renders/<name>-<timestamp>.<format>)
- `root` _(string)_ _(default: `"index.html"`)_ — Root composition file
- `beat` _(string)_ — Render only one storyboard beat using a temporary root
- `fps` _(number)_ _(default: `30`)_ — Frames per second: 24|30|60
- `quality` _(string)_ _(default: `"standard"`)_ — Quality preset: draft|standard|high
- `format` _(string)_ _(default: `"mp4"`)_ — Output container: mp4|webm|mov
- `workers` _(number)_ _(default: `1`)_ — Capture workers (1-16, default 1)
- `dryRun` _(boolean)_ — Preview parameters without rendering

#### `vibe run`

Execute a YAML video pipeline (Video as Code)

Product surface: `agent`
Note: Automation surface for YAML pipelines.

Cost tier: _not tagged_

**Parameters:**

- `pipeline` _(string)_ **required** — Path to pipeline YAML file
- `output` _(string)_ — Output directory for step results
- `dryRun` _(boolean)_ — Validate and show execution plan without running
- `resume` _(boolean)_ — Resume from last checkpoint (skip completed steps)
- `failFast` _(boolean)_ — Stop on first failed step (default: continue)
- `budgetUsd` _(number)_ — Abort if upper-bound cost estimate exceeds this USD amount
- `budgetTokens` _(number)_ — Abort if provider token usage exceeds this count
- `maxErrors` _(number)_ — Abort if failed step count exceeds this
- `effort` _(string)_ — LLM effort level: low|medium|high|xhigh (Opus 4.7)
- `json` _(boolean)_ — Output results as JSON

#### `vibe setup`

Configure VibeFrame (LLM provider, API keys)

Product surface: `public`
Note: Initial configuration helper.

Cost tier: _not tagged_

**Parameters:**

- `reset` _(boolean)_ — Reset configuration to defaults
- `full` _(boolean)_ — Run full setup with all optional providers
- `show` _(boolean)_ — Show current configuration (for debugging)
- `verbose` _(boolean)_ — With --show: include unset providers + Resolution order + Defaults block
- `claudeCode` _(boolean)_ — Show Claude Code integration guide
- `yes` _(boolean)_ — Non-interactive: write config without prompting (CI / devcontainer)
- `provider` _(string)_ — Set the Agent LLM provider (claude | openai | gemini | xai | openrouter | ollama)
- `importEnv` _(boolean)_ — Promote API keys from .env / shell env into config.yaml
- `test` _(boolean)_ — After save, live-test each configured key (exits 7 if any FAIL)
- `scope` _(string)_ _(default: `"user"`)_ — Where to save: 'user' (~/.vibeframe/config.yaml, shared) or 'project' (./.vibeframe/config.yaml, gitignored, this project only)

### `generate`

#### `vibe generate background`

Generate video background using DALL-E

Product surface: `legacy`
Replacement: `vibe generate image or vibe build --stage assets`
Note: Backdrops are generated through image generation or the project build.

Cost tier: `high`

**Parameters:**

- `description` _(string)_ **required** — Background description
- `apiKey` _(string)_ — OpenAI API key (or set OPENAI_API_KEY env)
- `output` _(string)_ — Output file path (downloads image)
- `aspect` _(string)_ _(16:9 \| 9:16 \| 1:1)_ _(default: `"16:9"`)_ — Aspect ratio: 16:9, 9:16, 1:1
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe generate image`

Generate image using AI (Gemini, OpenAI gpt-image, Grok, or Runway)

Product surface: `public`

Cost tier: `high`

**Parameters:**

- `prompt` _(string)_ — Image description prompt (interactive if omitted)
- `provider` _(string)_ _(openai \| gemini \| grok \| runway)_ — Provider: openai (default when OPENAI_API_KEY set), gemini, grok, runway
- `apiKey` _(string)_ — API key (or set env: OPENAI_API_KEY, GOOGLE_API_KEY)
- `output` _(string)_ — Output file path (downloads image)
- `size` _(string)_ _(default: `"1024x1024"`)_ — Image size (openai: 1024x1024, 1536x1024, 1024x1536)
- `ratio` _(string)_ _(default: `"1:1"`)_ — Aspect ratio (gemini: 1:1, 1:4, 1:8, 4:1, 8:1, 16:9, 9:16, 3:4, 4:3, etc.)
- `quality` _(string)_ _(standard \| hd)_ _(default: `"standard"`)_ — Quality: standard, hd (openai only)
- `style` _(string)_ _(vivid \| natural)_ _(default: `"vivid"`)_ — Style: vivid, natural (openai only)
- `count` _(number)_ _(default: `1`)_ — Number of images to generate
- `model` _(string)_ — Model. Gemini: flash, 3.1-flash, latest, pro. OpenAI: 1.5 (default), 2 (gpt-image-2)
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe generate motion`

Advanced: generate standalone motion graphics using Claude + Remotion

Product surface: `advanced`
Replacement: `vibe edit motion-overlay or vibe build --stage compose`
Note: Standalone motion generation is a power primitive.

Cost tier: `high`

**Parameters:**

- `description` _(string)_ **required** — Natural language description of the motion graphic
- `apiKey` _(string)_ — Anthropic API key (or set ANTHROPIC_API_KEY env)
- `output` _(string)_ _(default: `"motion.tsx"`)_ — Output file path
- `duration` _(number)_ _(default: `5`)_ — Duration in seconds
- `width` _(number)_ _(default: `1920`)_ — Width in pixels
- `height` _(number)_ _(default: `1080`)_ — Height in pixels
- `fps` _(number)_ _(default: `30`)_ — Frame rate
- `style` _(string)_ _(minimal \| corporate \| playful \| cinematic)_ — Style preset: minimal, corporate, playful, cinematic
- `render` _(boolean)_ — Render the generated code with Remotion (output .webm)
- `video` _(string)_ — Base video to composite the motion graphic onto
- `image` _(string)_ — Image to analyze with Gemini — color/mood fed into Claude prompt
- `understand` _(string)_ _(default: `"auto"`)_ — Analyze --video with Gemini before generating motion: auto, off, required
- `understandingPrompt` _(string)_ — Custom prompt for --video understanding
- `fromTsx` _(string)_ — Refine an existing TSX file instead of generating from scratch
- `model` _(string)_ _(default: `"sonnet"`)_ — LLM model: sonnet (default), opus, gemini, gemini-3.1-pro
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe generate music`

Generate background music from a text prompt (ElevenLabs or Replicate MusicGen)

Product surface: `public`

Cost tier: `low`

**Parameters:**

- `prompt` _(string)_ **required** — Description of the music to generate
- `provider` _(string)_ _(elevenlabs \| replicate)_ _(default: `"elevenlabs"`)_ — Provider: elevenlabs (default, up to 10min), replicate (MusicGen, max 30s)
- `apiKey` _(string)_ — API key (or set ELEVENLABS_API_KEY / REPLICATE_API_TOKEN env)
- `duration` _(number)_ _(default: `8`)_ — Duration in seconds (elevenlabs: 3-600, replicate: 1-30)
- `instrumental` _(boolean)_ — Force instrumental music, no vocals (ElevenLabs only)
- `melody` _(string)_ — Reference melody audio file for conditioning (Replicate only)
- `model` _(string)_ _(large \| stereo-large \| melody-large \| stereo-melody-large)_ _(default: `"stereo-large"`)_ — Model variant (Replicate only): large, stereo-large, melody-large, stereo-melody-large
- `output` _(string)_ _(default: `"music.mp3"`)_ — Output audio file path
- `noWait` _(boolean)_ — Don't wait for generation to complete (Replicate async mode)
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe generate music-status`

Check music generation status

Product surface: `legacy`
Replacement: `vibe status job <job-id> --json`
Note: Provider-task polling primitive retained for compatibility.

Cost tier: `free`

**Parameters:**

- `task-id` _(string)_ **required** — Task ID from music generation
- `apiKey` _(string)_ — Replicate API token (or set REPLICATE_API_TOKEN env)

#### `vibe generate narration`

Generate narration from text (product-facing TTS)

Product surface: `public`
Note: Product-facing TTS command.

Cost tier: `low`

**Parameters:**

- `text` _(string)_ — Narration text (interactive if omitted)
- `apiKey` _(string)_ — ElevenLabs API key (or set ELEVENLABS_API_KEY env)
- `output` _(string)_ _(default: `"narration.mp3"`)_ — Output audio file path
- `voice` _(string)_ _(default: `"21m00Tcm4TlvDq8ikWAM"`)_ — Voice ID (default: Rachel)
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe generate sound-effect`

Generate sound effect using ElevenLabs

Product surface: `public`

Cost tier: `low`

**Parameters:**

- `prompt` _(string)_ **required** — Description of the sound effect
- `apiKey` _(string)_ — ElevenLabs API key (or set ELEVENLABS_API_KEY env)
- `output` _(string)_ _(default: `"sound-effect.mp3"`)_ — Output audio file path
- `duration` _(number)_ — Duration in seconds (0.5-22, default: auto)
- `promptInfluence` _(string)_ — Prompt influence (0-1, default: 0.3)
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe generate speech`

Generate speech from text using ElevenLabs

Product surface: `legacy`
Replacement: `vibe generate narration`
Note: Compatibility alias for product-facing narration generation.

Cost tier: `low`

**Parameters:**

- `text` _(string)_ — Text to convert to speech (interactive if omitted)
- `apiKey` _(string)_ — ElevenLabs API key (or set ELEVENLABS_API_KEY env)
- `output` _(string)_ _(default: `"output.mp3"`)_ — Output audio file path
- `voice` _(string)_ _(default: `"21m00Tcm4TlvDq8ikWAM"`)_ — Voice ID (default: Rachel)
- `listVoices` _(boolean)_ — List available voices
- `fitDuration` _(number)_ — Speed up audio to fit target duration (via FFmpeg atempo)
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe generate storyboard`

Generate video storyboard from content using Claude

Product surface: `legacy`
Replacement: `vibe init --from <brief> or vibe storyboard revise`
Note: Project-ready storyboard drafting belongs in init/revise.

Cost tier: `high`

**Parameters:**

- `content` _(string)_ **required** — Content to analyze (text or file path)
- `apiKey` _(string)_ — Anthropic API key (or set ANTHROPIC_API_KEY env)
- `output` _(string)_ — Output JSON file path
- `duration` _(number)_ — Target total duration in seconds
- `file` _(boolean)_ — Treat content argument as file path
- `creativity` _(string)_ _(default: `"low"`)_ — Creativity level: low (default, consistent) or high (varied, unexpected)
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe generate thumbnail`

Generate video thumbnail (DALL-E) or extract best frame from video (Gemini)

Product surface: `public`

Cost tier: `free`

**Parameters:**

- `description` _(string)_ — Thumbnail description (for DALL-E generation)
- `apiKey` _(string)_ — API key (OpenAI for generation, Google for best-frame)
- `output` _(string)_ — Output file path
- `style` _(string)_ _(youtube \| instagram \| tiktok \| twitter)_ — Platform style: youtube, instagram, tiktok, twitter
- `bestFrame` _(string)_ — Extract best thumbnail frame from video using Gemini AI
- `prompt` _(string)_ — Custom prompt for best-frame analysis
- `model` _(string)_ _(flash \| latest \| pro)_ _(default: `"flash"`)_ — Gemini model: flash, latest, pro (default: flash)

#### `vibe generate video`

Generate video using AI (Seedance, Grok, Kling, Runway, or Veo)

Product surface: `public`

Cost tier: `very-high`

**Parameters:**

- `prompt` _(string)_ — Text prompt describing the video (interactive if omitted)
- `provider` _(string)_ — Provider: seedance (ByteDance Seedance 2.0 via fal.ai), grok, kling, runway, veo. `fal` is a deprecated v0.x alias for seedance and will be removed in 1.0.
- `apiKey` _(string)_ — API key (or set FAL_API_KEY / XAI_API_KEY / RUNWAY_API_SECRET / KLING_API_KEY / GOOGLE_API_KEY env)
- `output` _(string)_ — Output file path (downloads video)
- `image` _(string)_ — Reference image for image-to-video
- `duration` _(number)_ _(default: `5`)_ — Duration in seconds. Seedance accepts 4-15; Kling accepts 5 or 10; Veo maps to 6 or 8.
- `ratio` _(string)_ _(16:9 \| 9:16 \| 1:1)_ — Aspect ratio: 16:9, 9:16, or 1:1 (auto-detected from image if omitted)
- `seed` _(number)_ — Random seed for reproducibility (Runway only)
- `mode` _(string)_ _(default: `"std"`)_ — Generation mode: std or pro (Kling only)
- `seedanceModel` _(string)_ _(default: `"quality"`)_ — Seedance variant: quality or fast (fal.ai only)
- `negative` _(string)_ — Negative prompt - what to avoid (Kling/Veo)
- `resolution` _(string)_ _(720p \| 1080p \| 4k)_ — Video resolution: 720p, 1080p, 4k (Veo only)
- `lastFrame` _(string)_ — Last frame image for frame interpolation (Veo only)
- `refImages` _(string)_ — Reference images for character consistency (Veo 3.1 only, max 3)
- `person` _(string)_ — Person generation: allow_all, allow_adult (Veo only)
- `veoModel` _(string)_ _(default: `"3.1-fast"`)_ — Veo model: 3.0, 3.1, 3.1-fast (default: 3.1-fast)
- `runwayModel` _(string)_ _(default: `"gen4.5"`)_ — Runway model: gen4.5 (default, text+image-to-video), gen4_turbo (image-to-video only)
- `noWait` _(boolean)_ — Start generation and return task ID without waiting
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe generate video-cancel`

Cancel video generation (Grok or Runway)

Product surface: `advanced`
Note: Provider lifecycle control.

Cost tier: `free`

**Parameters:**

- `task-id` _(string)_ **required** — Task ID to cancel
- `provider` _(string)_ _(grok \| runway)_ _(default: `"grok"`)_ — Provider: grok, runway
- `apiKey` _(string)_ — API key (or set XAI_API_KEY / RUNWAY_API_SECRET env)

#### `vibe generate video-extend`

Extend video duration (Kling by video ID, Veo by operation name)

Product surface: `advanced`
Note: Provider lifecycle control.

Cost tier: `very-high`

**Parameters:**

- `id` _(string)_ **required** — Kling video ID or Veo operation name
- `provider` _(string)_ _(kling \| veo)_ _(default: `"kling"`)_ — Provider: kling, veo
- `apiKey` _(string)_ — API key (KLING_API_KEY or GOOGLE_API_KEY)
- `output` _(string)_ — Output file path
- `prompt` _(string)_ — Continuation prompt
- `duration` _(number)_ _(default: `5`)_ — Duration: 5 or 10 (Kling), 4/6/8 (Veo)
- `negative` _(string)_ — Negative prompt (what to avoid, Kling only)
- `veoModel` _(string)_ _(default: `"3.1"`)_ — Veo model: 3.0, 3.1, 3.1-fast
- `noWait` _(boolean)_ — Start extension and return task ID without waiting
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe generate video-status`

Check video generation status (Grok, Runway, or Kling)

Product surface: `legacy`
Replacement: `vibe status job <job-id> --json`
Note: Provider-task polling primitive retained for compatibility.

Cost tier: `free`

**Parameters:**

- `task-id` _(string)_ **required** — Task ID from video generation
- `provider` _(string)_ _(grok \| runway \| kling)_ _(default: `"grok"`)_ — Provider: grok, runway, kling
- `apiKey` _(string)_ — API key (or set XAI_API_KEY / RUNWAY_API_SECRET / KLING_API_KEY env)
- `type` _(string)_ _(default: `"text2video"`)_ — Task type: text2video or image2video (Kling only)
- `wait` _(boolean)_ — Wait for completion
- `output` _(string)_ — Download video when complete

### `edit`

#### `vibe edit caption`

Transcribe and burn styled captions onto video (Whisper + FFmpeg)

Product surface: `public`

Cost tier: `low`

**Parameters:**

- `video` _(string)_ **required** — Video file path
- `output` _(string)_ — Output file path (default: <name>-captioned.<ext>)
- `style` _(string)_ _(minimal \| bold \| outline \| karaoke)_ _(default: `"bold"`)_ — Caption style: minimal, bold, outline, karaoke (default: bold)
- `fontSize` _(number)_ — Override auto-calculated font size
- `color` _(string)_ _(default: `"white"`)_ — Font color (default: white)
- `language` _(string)_ — Language code for transcription (e.g., en, ko)
- `position` _(string)_ _(top \| center \| bottom)_ _(default: `"bottom"`)_ — Caption position: top, center, bottom (default: bottom)
- `apiKey` _(string)_ — OpenAI API key (or set OPENAI_API_KEY env)
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe edit fade`

Apply fade in/out effects to video (FFmpeg only, no API key needed)

Product surface: `advanced`

Cost tier: `free`

**Parameters:**

- `video` _(string)_ **required** — Video file path
- `output` _(string)_ — Output file path (default: <name>-faded.<ext>)
- `fadeIn` _(number)_ _(default: `1`)_ — Fade-in duration in seconds (default: 1)
- `fadeOut` _(number)_ _(default: `1`)_ — Fade-out duration in seconds (default: 1)
- `audioOnly` _(boolean)_ — Apply fade to audio only (video stream copied)
- `videoOnly` _(boolean)_ — Apply fade to video only (audio stream copied)
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe edit fill-gaps`

Fill timeline gaps with AI-generated video (Kling image-to-video)

Product surface: `advanced`

Cost tier: `very-high`

**Parameters:**

- `project` _(string)_ **required** — Timeline file or directory
- `provider` _(string)_ _(default: `"kling"`)_ — AI provider (kling)
- `output` _(string)_ — Output project path (default: overwrite)
- `dir` _(string)_ — Directory to save generated videos
- `prompt` _(string)_ — Custom prompt for video generation
- `dryRun` _(boolean)_ — Show gaps without generating
- `mode` _(string)_ _(default: `"std"`)_ — Generation mode: std or pro (Kling)
- `ratio` _(string)_ _(16:9 \| 9:16 \| 1:1)_ _(default: `"16:9"`)_ — Aspect ratio: 16:9, 9:16, or 1:1

#### `vibe edit grade`

Apply AI-generated color grading (Claude + FFmpeg)

Product surface: `advanced`

Cost tier: `low`

**Parameters:**

- `video` _(string)_ **required** — Video file path
- `style` _(string)_ — Style description (e.g., 'cinematic warm')
- `preset` _(string)_ — Built-in preset: film-noir, vintage, cinematic-warm, cool-tones, high-contrast, pastel, cyberpunk, horror
- `output` _(string)_ — Output video file path
- `analyzeOnly` _(boolean)_ — Show filter without applying
- `apiKey` _(string)_ — Anthropic API key (or set ANTHROPIC_API_KEY env)
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe edit image`

Edit image(s) using AI (Gemini, OpenAI, or Grok)

Product surface: `advanced`

Cost tier: `high`

**Parameters:**

- `images` _(array)_ **required** — Input image file(s) followed by edit prompt
- `provider` _(string)_ _(gemini \| openai \| grok)_ _(default: `"gemini"`)_ — Provider: gemini (default), openai, grok
- `apiKey` _(string)_ — API key (or set env variable)
- `output` _(string)_ _(default: `"edited.png"`)_ — Output file path
- `model` _(string)_ _(default: `"flash"`)_ — Model: flash/3.1-flash/latest/pro (Gemini only)
- `ratio` _(string)_ — Output aspect ratio
- `size` _(string)_ — Resolution: 1K, 2K, 4K (Gemini Pro only)
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe edit interpolate`

Create slow motion with frame interpolation (FFmpeg)

Product surface: `advanced`

Cost tier: `free`

**Parameters:**

- `video` _(string)_ **required** — Video file path
- `output` _(string)_ — Output file path
- `factor` _(number)_ _(2 \| 4 \| 8)_ _(default: `2`)_ — Slow motion factor: 2, 4, or 8
- `fps` _(number)_ — Target output FPS
- `mode` _(string)_ _(default: `"quality"`)_ — Speed/quality tradeoff: fast or quality
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe edit jump-cut`

Remove filler words (um, uh, like, etc.) from video using Whisper word-level timestamps

Product surface: `public`

Cost tier: `low`

**Parameters:**

- `video` _(string)_ **required** — Video file path
- `output` _(string)_ — Output file path (default: <name>-jumpcut.<ext>)
- `fillers` _(string)_ — Comma-separated filler words to detect
- `padding` _(number)_ _(default: `0.05`)_ — Padding around cuts in seconds (default: 0.05)
- `language` _(string)_ — Language code for transcription (e.g., en, ko)
- `analyzeOnly` _(boolean)_ — Only detect fillers, don't cut
- `apiKey` _(string)_ — OpenAI API key (or set OPENAI_API_KEY env)
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe edit motion-overlay`

Apply designed motion graphics overlays to an existing video

Product surface: `advanced`

Cost tier: `low`

**Parameters:**

- `video` _(string)_ **required** — Video file path
- `description` _(string)_ — Motion overlay description (omit when using --asset)
- `asset` _(string)_ — User-provided .json/.lottie animation to overlay
- `output` _(string)_ — Output video file path
- `duration` _(number)_ — Overlay/render duration in seconds
- `start` _(number)_ _(default: `0`)_ — Overlay start time in seconds
- `style` _(string)_ — Style preset for generated overlays: minimal, corporate, playful, cinematic
- `model` _(string)_ _(default: `"sonnet"`)_ — LLM model for generated overlays: sonnet, opus, gemini, gemini-3.1-pro
- `understand` _(string)_ _(default: `"auto"`)_ — Analyze video before generated overlay: auto, off, required
- `understandingPrompt` _(string)_ — Custom prompt for video understanding
- `position` _(string)_ _(full \| center \| top-left \| top-right \| bottom-left \| bottom-right)_ _(default: `"full"`)_ — Lottie position: full, center, top-left, top-right, bottom-left, bottom-right
- `scale` _(number)_ — Lottie overlay scale (0.01-2)
- `opacity` _(number)_ _(default: `1`)_ — Lottie overlay opacity (0-1)
- `loop` _(boolean)_ _(default: `true`)_ — Loop Lottie overlay
- `noLoop` _(boolean)_ — Do not loop Lottie overlay
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe edit noise-reduce`

Remove background noise from audio/video using FFmpeg (no API key needed)

Product surface: `public`

Cost tier: `free`

**Parameters:**

- `input` _(string)_ **required** — Audio or video file path
- `output` _(string)_ — Output file path (default: <name>-denoised.<ext>)
- `strength` _(string)_ _(low \| medium \| high)_ _(default: `"medium"`)_ — Noise reduction strength: low, medium, high (default: medium)
- `noiseFloor` _(number)_ — Custom noise floor in dB (overrides strength preset)
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe edit reframe`

Auto-reframe video to different aspect ratio (Claude Vision + FFmpeg)

Product surface: `public`

Cost tier: `high`

**Parameters:**

- `video` _(string)_ **required** — Video file path
- `aspect` _(string)_ _(9:16 \| 1:1 \| 4:5)_ _(default: `"9:16"`)_ — Target aspect ratio: 9:16, 1:1, 4:5
- `focus` _(string)_ _(auto \| face \| center \| action)_ _(default: `"auto"`)_ — Focus mode: auto, face, center, action
- `output` _(string)_ — Output video file path
- `analyzeOnly` _(boolean)_ — Show crop regions without applying
- `keyframes` _(string)_ — Export keyframes to JSON file
- `apiKey` _(string)_ — Anthropic API key (or set ANTHROPIC_API_KEY env)
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe edit silence-cut`

Remove silent segments from video (FFmpeg default, or Gemini for smart detection)

Product surface: `public`

Cost tier: `low`

**Parameters:**

- `video` _(string)_ **required** — Video file path
- `output` _(string)_ — Output file path (default: <name>-cut.<ext>)
- `noise` _(number)_ _(default: `-30`)_ — Silence threshold in dB (default: -30)
- `minDuration` _(number)_ _(default: `0.5`)_ — Minimum silence duration to cut (default: 0.5)
- `padding` _(number)_ _(default: `0.1`)_ — Padding around non-silent segments (default: 0.1)
- `analyzeOnly` _(boolean)_ — (deprecated — use `vibe detect silence`) Only detect silence, don't cut
- `useGemini` _(boolean)_ — Use Gemini Video Understanding for context-aware silence detection
- `model` _(string)_ — Gemini model (default: flash)
- `lowRes` _(boolean)_ — Low resolution mode for longer videos (Gemini only)
- `apiKey` _(string)_ — Google API key override (or set GOOGLE_API_KEY env)
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe edit speed-ramp`

Apply content-aware speed ramping (Whisper + Claude + FFmpeg)

Product surface: `advanced`

Cost tier: `low`

**Parameters:**

- `video` _(string)_ **required** — Video file path
- `output` _(string)_ — Output video file path
- `style` _(string)_ _(dramatic \| smooth \| action)_ _(default: `"dramatic"`)_ — Style: dramatic, smooth, action
- `minSpeed` _(string)_ _(default: `"0.25"`)_ — Minimum speed factor
- `maxSpeed` _(string)_ _(default: `"4.0"`)_ — Maximum speed factor
- `analyzeOnly` _(boolean)_ — Show keyframes without applying
- `language` _(string)_ — Language code for transcription
- `apiKey` _(string)_ — Anthropic API key (or set ANTHROPIC_API_KEY env)
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe edit text-overlay`

Apply simple static text burn-in to video (FFmpeg drawtext)

Product surface: `advanced`

Cost tier: `free`

**Parameters:**

- `video` _(string)_ **required** — Video file path
- `text` _(string)_ — Text lines to overlay (repeat for multiple)
- `style` _(string)_ _(lower-third \| center-bold \| subtitle \| minimal)_ _(default: `"lower-third"`)_ — Overlay style: lower-third, center-bold, subtitle, minimal
- `fontSize` _(string)_ — Font size in pixels (auto-calculated if omitted)
- `fontColor` _(string)_ _(default: `"white"`)_ — Font color (default: white)
- `fade` _(number)_ _(default: `0.3`)_ — Fade in/out duration in seconds
- `start` _(number)_ _(default: `0`)_ — Start time in seconds
- `end` _(number)_ — End time in seconds (default: video duration)
- `output` _(string)_ — Output video file path
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe edit translate-srt`

Translate SRT subtitle file to another language (Claude or OpenAI)

Product surface: `advanced`

Cost tier: `low`

**Parameters:**

- `srt` _(string)_ **required** — SRT file path
- `target` _(string)_ — Target language (e.g., ko, es, fr, ja, zh)
- `output` _(string)_ — Output file path (default: <name>-<target>.srt)
- `provider` _(string)_ _(claude \| openai)_ _(default: `"claude"`)_ — Translation provider: claude, openai (default: claude)
- `source` _(string)_ — Source language (auto-detected if omitted)
- `apiKey` _(string)_ — API key (or set ANTHROPIC_API_KEY / OPENAI_API_KEY env)
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe edit upscale`

Upscale video resolution using AI or FFmpeg

Product surface: `public`

Cost tier: `high`

**Parameters:**

- `video` _(string)_ **required** — Video file path
- `output` _(string)_ — Output file path
- `scale` _(string)_ _(default: `"2"`)_ — Scale factor: 2 or 4
- `model` _(string)_ _(real-esrgan \| topaz)_ _(default: `"real-esrgan"`)_ — Model: real-esrgan, topaz
- `ffmpeg` _(boolean)_ — Use FFmpeg lanczos (free, no API)
- `apiKey` _(string)_ — Replicate API token (or set REPLICATE_API_TOKEN env)
- `noWait` _(boolean)_ — Start processing and return task ID without waiting
- `dryRun` _(boolean)_ — Preview parameters without executing

### `inspect`

#### `vibe inspect media`

Analyze any media: images, videos, or YouTube URLs using Gemini

Product surface: `public`

Cost tier: `low`

**Parameters:**

- `source` _(string)_ **required** — Image/video file path, image URL, or YouTube URL
- `prompt` _(string)_ **required** — Analysis prompt (e.g., 'Describe this image', 'Summarize this video')
- `apiKey` _(string)_ — Google API key (or set GOOGLE_API_KEY env)
- `model` _(string)_ _(default: `"flash"`)_ — Model: flash (default), flash-2.5, pro
- `fps` _(number)_ — Frames per second for video (default: 1)
- `start` _(number)_ — Start offset in seconds (video only)
- `end` _(number)_ — End offset in seconds (video only)
- `lowRes` _(boolean)_ — Use low resolution mode (fewer tokens)
- `verbose` _(boolean)_ — Show token usage
- `fields` _(string)_ — Comma-separated fields to include in output (e.g., response,model)
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe inspect project`

Inspect project completeness, storyboard validity, scene lint, and asset references

Product surface: `public`

Cost tier: `free`

**Parameters:**

- `project-dir` _(string)_ — VibeFrame project directory
- `beat` _(string)_ — Inspect only one storyboard beat where beat-scoped checks apply
- `output` _(string)_ — Write review report to this path (default: <project>/review-report.json)
- `noReport` _(boolean)_ — Do not write review-report.json

`review-report.json` payload uses `kind:"review"`, `mode:"project"`, `summary`, `sourceReports`, `retryWith`, and issue-level `fixOwner:"vibe"|"host-agent"`. Command output keeps `data.kind:"project"`.

#### `vibe inspect render`

Inspect a rendered project video with local checks and optional Gemini review

Product surface: `public`

Cost tier: `low`

**Parameters:**

- `project-dir` _(string)_ — VibeFrame project directory
- `cheap` _(boolean)_ — Run local checks only (default; no AI/API calls)
- `ai` _(boolean)_ — Also run Gemini video review and merge findings into review-report.json
- `model` _(string)_ _(default: `"flash"`)_ — Gemini model for --ai: flash (default), flash-2.5, pro
- `beat` _(string)_ — Inspect a render for one storyboard beat
- `video` _(string)_ — Rendered video path. Defaults to build-report outputPath or latest renders/\* video.
- `output` _(string)_ — Write review report to this path (default: <project>/review-report.json)
- `noReport` _(boolean)_ — Do not write review-report.json
- `dryRun` _(boolean)_ — Preview parameters without probing video or calling Gemini

`review-report.json` payload uses `kind:"review"`, `mode:"render"`, `summary`, `sourceReports`, `retryWith`, and issue-level `fixOwner:"vibe"|"host-agent"`. `--ai` maps Gemini findings to host-agent-owned issues.

#### `vibe inspect review`

Review video quality using Gemini AI and optionally auto-fix issues

Product surface: `legacy`
Replacement: `vibe inspect render --ai`
Note: Project render review now lives under inspect render.

Cost tier: `low`

**Parameters:**

- `source` _(string)_ **required** — Video file path
- `storyboard` _(string)_ — Storyboard JSON file for context
- `autoApply` _(boolean)_ — Automatically apply fixable corrections
- `verify` _(boolean)_ — Run verification pass after applying fixes
- `model` _(string)_ _(default: `"flash"`)_ — Gemini model: flash (default), flash-2.5, pro
- `output` _(string)_ — Output video file path (for auto-apply)
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe inspect suggest`

Get AI edit suggestions using Gemini

Product surface: `advanced`
Note: Suggestion primitive; reports should drive host-agent edits.

Cost tier: `low`

**Parameters:**

- `project` _(string)_ **required** — Timeline file or directory
- `instruction` _(string)_ **required** — Natural language instruction
- `apiKey` _(string)_ — Google API key (or set GOOGLE_API_KEY env)
- `apply` _(boolean)_ — Apply the first suggestion automatically
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe inspect video`

Analyze video using Gemini (summarize, Q&A, extract info)

Product surface: `legacy`
Replacement: `vibe inspect media`
Note: Compatibility alias for media understanding.

Cost tier: `low`

**Parameters:**

- `source` _(string)_ **required** — Video file path or YouTube URL
- `prompt` _(string)_ **required** — Analysis prompt (e.g., 'Summarize this video')
- `apiKey` _(string)_ — Google API key (or set GOOGLE_API_KEY env)
- `model` _(string)_ _(default: `"flash"`)_ — Model: flash (default), flash-2.5, pro
- `fps` _(number)_ — Frames per second (default: 1, higher for action)
- `start` _(number)_ — Start offset in seconds (for clipping)
- `end` _(number)_ — End offset in seconds (for clipping)
- `lowRes` _(boolean)_ — Use low resolution mode (fewer tokens, longer videos)
- `verbose` _(boolean)_ — Show token usage
- `fields` _(string)_ — Comma-separated fields to include in output (e.g., response,model)
- `dryRun` _(boolean)_ — Preview parameters without executing

### `audio`

#### `vibe audio clone-voice`

Clone a voice from audio samples using ElevenLabs (requires explicit consent)

Product surface: `advanced`
Note: Requires explicit user consent for voice cloning.

Cost tier: `low`

**Parameters:**

- `samples` _(array)_ — Audio sample files (1-25 files)
- `apiKey` _(string)_ — ElevenLabs API key (or set ELEVENLABS_API_KEY env)
- `name` _(string)_ — Voice name (required)
- `description` _(string)_ — Voice description
- `labels` _(string)_ — Labels as JSON (e.g., '{"accent": "american"}')
- `removeNoise` _(boolean)_ — Remove background noise from samples
- `list` _(boolean)_ — List all available voices
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe audio dub`

Dub audio/video to another language (transcribe, translate, TTS)

Product surface: `public`

Cost tier: `high`

**Parameters:**

- `media` _(string)_ **required** — Input media file (video or audio)
- `language` _(string)_ — Target language code (e.g., es, ko, ja) (required)
- `source` _(string)_ — Source language code (default: auto-detect)
- `voice` _(string)_ — ElevenLabs voice ID for output
- `analyzeOnly` _(boolean)_ — Only analyze and show timing, don't generate audio
- `output` _(string)_ — Output file path
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe audio duck`

Auto-duck background music when voice is present (FFmpeg)

Product surface: `public`

Cost tier: `free`

**Parameters:**

- `music` _(string)_ **required** — Background music file path
- `voice` _(string)_ — Voice/narration track (required)
- `output` _(string)_ — Output audio file path
- `threshold` _(number)_ _(default: `-30`)_ — Sidechain threshold in dB
- `ratio` _(string)_ _(default: `"3"`)_ — Compression ratio
- `attack` _(number)_ _(default: `20`)_ — Attack time in ms
- `release` _(number)_ _(default: `200`)_ — Release time in ms
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe audio isolate`

Isolate vocals from audio using ElevenLabs

Product surface: `advanced`

Cost tier: `low`

**Parameters:**

- `audio` _(string)_ **required** — Input audio file path
- `apiKey` _(string)_ — ElevenLabs API key (or set ELEVENLABS_API_KEY env)
- `output` _(string)_ _(default: `"vocals.mp3"`)_ — Output audio file path
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe audio list-voices`

List available ElevenLabs voices

Product surface: `advanced`
Note: Provider discovery helper.

Cost tier: `low`

**Parameters:**

- `apiKey` _(string)_ — ElevenLabs API key (or set ELEVENLABS_API_KEY env)

#### `vibe audio transcribe`

Transcribe audio using Whisper

Product surface: `public`

Cost tier: `low`

**Parameters:**

- `audio` _(string)_ **required** — Audio file path
- `apiKey` _(string)_ — OpenAI API key (or set OPENAI_API_KEY env)
- `language` _(string)_ — Language code (e.g., en, ko)
- `output` _(string)_ — Output file path
- `format` _(string)_ _(json \| srt \| vtt)_ — Output format: json, srt, vtt (auto-detected from extension)

### `remix`

#### `vibe remix animated-caption`

Add animated captions with word-by-word effects (Whisper + Remotion/ASS)

Product surface: `public`

Cost tier: `low`

**Parameters:**

- `video` _(string)_ **required** — Video file path
- `style` _(string)_ _(default: `"highlight"`)_ — Style preset (default: highlight)
- `highlightColor` _(string)_ _(default: `"#FFFF00"`)_ — Active word highlight color
- `fontSize` _(string)_ — Font size (default: auto based on resolution)
- `position` _(string)_ _(top \| center \| bottom)_ _(default: `"bottom"`)_ — Caption position: top, center, bottom
- `wordsPerGroup` _(number)_ — Words shown at once (default: auto 3-5)
- `maxChars` _(number)_ — Max characters per group
- `language` _(string)_ — Whisper language hint
- `fast` _(boolean)_ — Use ASS/FFmpeg only (no Remotion, forces ASS tier styles)
- `output` _(string)_ — Output file path
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe remix auto-shorts`

Auto-generate shorts from long-form video

Product surface: `public`

Cost tier: `high`

**Parameters:**

- `video` _(string)_ **required** — Video file path
- `output` _(string)_ — Output file (single) or directory (multiple)
- `duration` _(number)_ _(default: `60`)_ — Target duration in seconds (15-60)
- `count` _(number)_ _(default: `1`)_ — Number of shorts to generate
- `aspect` _(string)_ _(9:16 \| 1:1)_ _(default: `"9:16"`)_ — Aspect ratio: 9:16, 1:1
- `outputDir` _(string)_ — Output directory for multiple shorts
- `addCaptions` _(boolean)_ — Add auto-generated captions
- `captionStyle` _(string)_ _(minimal \| bold \| animated)_ _(default: `"bold"`)_ — Caption style: minimal, bold, animated
- `analyzeOnly` _(boolean)_ — Show segments without generating
- `language` _(string)_ — Language code for transcription
- `useGemini` _(boolean)_ — Use Gemini Video Understanding for enhanced visual+audio analysis
- `lowRes` _(boolean)_ — Use low resolution mode for longer videos (Gemini only)
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe remix highlights`

Extract highlights from long-form video/audio content

Product surface: `public`

Cost tier: `high`

**Parameters:**

- `media` _(string)_ **required** — Video or audio file path
- `output` _(string)_ — Output JSON file with highlights
- `project` _(string)_ — Create project with highlight clips
- `duration` _(number)_ _(default: `60`)_ — Target highlight reel duration
- `count` _(number)_ — Maximum number of highlights
- `threshold` _(number)_ _(default: `0.7`)_ — Confidence threshold (0-1)
- `criteria` _(string)_ _(default: `"all"`)_ — Selection criteria: emotional | informative | funny | all
- `language` _(string)_ — Language code for transcription (e.g., en, ko)
- `useGemini` _(boolean)_ — Use Gemini Video Understanding for enhanced visual+audio analysis
- `lowRes` _(boolean)_ — Use low resolution mode for longer videos (Gemini only)
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe remix regenerate-scene`

Regenerate a specific scene in a script-to-video output directory

Product surface: `legacy`
Replacement: `vibe build <project> --beat <id> --force --json`
Note: Scene regeneration belongs in the project build flow.

Cost tier: `very-high`

**Parameters:**

- `project-dir` _(string)_ **required** — Path to the script-to-video output directory
- `scene` _(string)_ — Scene number(s) to regenerate (1-based), e.g., 3 or 3,4,5
- `videoOnly` _(boolean)_ — Only regenerate video
- `narrationOnly` _(boolean)_ — Only regenerate narration
- `imageOnly` _(boolean)_ — Only regenerate image
- `generator` _(string)_ _(default: `"grok"`)_ — Video generator: grok | kling | runway | veo
- `imageProvider` _(string)_ _(default: `"gemini"`)_ — Image provider: gemini | openai | grok
- `voice` _(string)_ — ElevenLabs voice ID for narration
- `aspectRatio` _(string)_ _(default: `"16:9"`)_ — Aspect ratio: 16:9 | 9:16 | 1:1
- `retries` _(number)_ _(default: `2`)_ — Number of retries for video generation failures
- `referenceScene` _(string)_ — Use another scene's image as reference for character consistency
- `dryRun` _(boolean)_ — Preview parameters without executing

### `scene`

#### `vibe scene add`

Add a new scene to a project: AI narration + image + per-scene HTML

Product surface: `advanced`

Cost tier: `free`

**Parameters:**

- `name` _(string)_ **required** — Scene name (slugified into the composition id)
- `style` _(string)_ _(simple \| announcement \| explainer \| kinetic-type \| product-shot)_ _(default: `"simple"`)_ — Style preset: simple, announcement, explainer, kinetic-type, product-shot
- `narration` _(string)_ — Narration text (or path to a .txt file). Drives TTS + scene duration.
- `narrationFile` _(string)_ — Existing narration audio file (.wav/.mp3). Skips TTS — useful with hyperframes tts, Mac say, or other external tools.
- `duration` _(number)_ — Explicit scene duration in seconds (overrides narration audio)
- `visuals` _(string)_ — Image prompt — generates assets/scene-<id>.png via the configured image provider
- `headline` _(string)_ — Visible headline (defaults to the humanised scene name)
- `kicker` _(string)_ — Small label above the headline (explainer / product-shot)
- `insertInto` _(string)_ _(default: `"index.html"`)_ — Root composition file to update
- `project` _(string)_ _(default: `"."`)_ — Project directory
- `imageProvider` _(string)_ _(gemini \| openai)_ _(default: `"gemini"`)_ — Image provider: gemini, openai
- `tts` _(string)_ _(auto \| elevenlabs \| kokoro)_ _(default: `"auto"`)_ — TTS provider: auto, elevenlabs, kokoro (default auto — picks ElevenLabs when key set, else Kokoro local)
- `voice` _(string)_ — Voice id (ElevenLabs name/id, or Kokoro id like af_heart, am_michael)
- `noAudio` _(boolean)_ — Skip TTS even when --narration is provided (useful for tests/agent dry runs)
- `noImage` _(boolean)_ — Skip image generation even when --visuals is provided
- `noTranscribe` _(boolean)_ — Skip Whisper word-level transcribe step (no transcript-<id>.json emitted)
- `transcribeLanguage` _(string)_ — BCP-47 language code passed to Whisper (e.g. en, ko)
- `force` _(boolean)_ — Overwrite an existing compositions/scene-<id>.html
- `dryRun` _(boolean)_ — Preview parameters without writing files or calling APIs

#### `vibe scene compose-prompts`

Emit the per-beat compose plan for the host agent to author HTML itself (Phase H2 — no LLM call)

Product surface: `internal`
Note: Agent-mode build primitive; prefer vibe build --mode agent.

Cost tier: `free`

**Parameters:**

- `project-dir` _(string)_ — Project directory containing STORYBOARD.md / DESIGN.md
- `beat` _(string)_ — Restrict the plan to a single beat by id (e.g. 'hook', '1')

#### `vibe scene install-skill`

Install the Hyperframes skill into a scene project so the host agent can read it (Phase H1)

Product surface: `internal`
Note: Build/init installs the host-agent composition skill when needed.

Cost tier: `free`

**Parameters:**

- `project-dir` _(string)_ — Project directory containing STORYBOARD.md / DESIGN.md
- `host` _(string)_ _(default: `"auto"`)_ — Host layout target: claude-code | cursor | auto | all
- `force` _(boolean)_ — Overwrite existing skill files (default: skip-on-exist)
- `dryRun` _(boolean)_ — Preview which files would be written without changing anything

#### `vibe scene lint`

Validate scene HTML against composition rules (in-process, no Chrome required)

Product surface: `agent`

Cost tier: `free`

**Parameters:**

- `root` _(string)_ — Root composition file relative to --project
- `project` _(string)_ _(default: `"."`)_ — Project directory
- `fix` _(boolean)_ — Apply mechanical auto-fixes (currently: missing class="clip")

#### `vibe scene list-styles`

List vendored visual styles (or show one) for DESIGN.md seeding

Product surface: `public`

Cost tier: `free`

**Parameters:**

- `name` _(string)_ — Style name to inspect (omit to list all)

#### `vibe scene repair`

Apply deterministic mechanical repairs to scene HTML

Product surface: `agent`

Cost tier: `free`

**Parameters:**

- `root` _(string)_ — Project directory, or root composition file relative to --project
- `project` _(string)_ _(default: `"."`)_ — Project directory
- `dryRun` _(boolean)_ — Preview repairs without writing files

### `timeline`

#### `vibe timeline add-clip`

Add a clip to the timeline

Product surface: `advanced`
Note: Power tool for low-level timeline JSON edits.

Cost tier: `free`

**Parameters:**

- `project` _(string)_ **required** — Timeline file or directory
- `source-id` _(string)_ **required** — Source ID to use
- `track` _(string)_ — Track ID (defaults to first matching track)
- `start` _(number)_ _(default: `0`)_ — Start time in timeline
- `duration` _(number)_ — Clip duration (defaults to source duration)
- `offset` _(number)_ _(default: `0`)_ — Source start offset
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe timeline add-effect`

Add an effect to a clip

Product surface: `advanced`
Note: Power tool for low-level timeline JSON edits.

Cost tier: `free`

**Parameters:**

- `project` _(string)_ **required** — Timeline file or directory
- `clip-id` _(string)_ **required** — Clip ID
- `effect-type` _(string)_ **required** — Effect type (fadeIn, fadeOut, blur, brightness, contrast, saturation, speed, volume)
- `start` _(number)_ _(default: `0`)_ — Effect start time (relative to clip)
- `duration` _(number)_ — Effect duration (defaults to clip duration)
- `params` _(string)_ _(default: `"{}"`)_ — Effect parameters as JSON
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe timeline add-source`

Add a media source to the timeline

Product surface: `advanced`
Note: Power tool for low-level timeline JSON edits.

Cost tier: `free`

**Parameters:**

- `project` _(string)_ **required** — Timeline file or directory
- `media` _(string)_ **required** — Media file path
- `name` _(string)_ — Source name (defaults to filename)
- `type` _(string)_ _(video \| audio \| image \| lottie)_ — Media type (video, audio, image, lottie)
- `duration` _(number)_ — Duration in seconds (required for images)
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe timeline add-track`

Add a new track

Product surface: `advanced`
Note: Power tool for low-level timeline JSON edits.

Cost tier: `free`

**Parameters:**

- `project` _(string)_ **required** — Timeline file or directory
- `type` _(string)_ **required** — Track type (video, audio)
- `name` _(string)_ — Track name
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe timeline create`

Create a low-level timeline JSON file

Product surface: `advanced`
Note: Power tool for low-level timeline JSON edits.

Cost tier: `free`

**Parameters:**

- `name` _(string)_ **required** — Timeline name or path (e.g., 'my-video' or 'output/my-video')
- `output` _(string)_ — Output file path (overrides name-based path)
- `ratio` _(string)_ _(16:9 \| 9:16 \| 1:1 \| 4:5)_ _(default: `"16:9"`)_ — Aspect ratio (16:9, 9:16, 1:1, 4:5)
- `fps` _(number)_ _(default: `30`)_ — Frame rate
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe timeline delete-clip`

Delete a clip from the timeline

Product surface: `advanced`
Note: Power tool for low-level timeline JSON edits.

Cost tier: `free`

**Parameters:**

- `project` _(string)_ **required** — Timeline file or directory
- `clip-id` _(string)_ **required** — Clip ID to delete
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe timeline duplicate-clip`

Duplicate a clip

Product surface: `advanced`
Note: Power tool for low-level timeline JSON edits.

Cost tier: `free`

**Parameters:**

- `project` _(string)_ **required** — Timeline file or directory
- `clip-id` _(string)_ **required** — Clip ID to duplicate
- `time` _(number)_ — Start time for duplicate (default: after original)
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe timeline info`

Show timeline information

Product surface: `advanced`
Note: Power tool for low-level timeline JSON edits.

Cost tier: `free`

**Parameters:**

- `file` _(string)_ **required** — Timeline file or directory

#### `vibe timeline list`

List timeline contents

Product surface: `advanced`
Note: Power tool for low-level timeline JSON edits.

Cost tier: `free`

**Parameters:**

- `project` _(string)_ **required** — Timeline file or directory
- `sources` _(boolean)_ — List sources only
- `tracks` _(boolean)_ — List tracks only
- `clips` _(boolean)_ — List clips only

#### `vibe timeline move-clip`

Move a clip to a new position

Product surface: `advanced`
Note: Power tool for low-level timeline JSON edits.

Cost tier: `free`

**Parameters:**

- `project` _(string)_ **required** — Timeline file or directory
- `clip-id` _(string)_ **required** — Clip ID to move
- `time` _(number)_ — New start time
- `track` _(string)_ — Move to different track
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe timeline set`

Update timeline settings

Product surface: `advanced`
Note: Power tool for low-level timeline JSON edits.

Cost tier: `free`

**Parameters:**

- `file` _(string)_ **required** — Timeline file or directory
- `name` _(string)_ — Timeline name
- `ratio` _(string)_ _(16:9 \| 9:16 \| 1:1 \| 4:5)_ — Aspect ratio (16:9, 9:16, 1:1, 4:5)
- `fps` _(number)_ — Frame rate
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe timeline split-clip`

Split a clip at a specific time

Product surface: `advanced`
Note: Power tool for low-level timeline JSON edits.

Cost tier: `free`

**Parameters:**

- `project` _(string)_ **required** — Timeline file or directory
- `clip-id` _(string)_ **required** — Clip ID to split
- `time` _(number)_ _(default: `0`)_ — Split time relative to clip start
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe timeline trim-clip`

Trim a clip

Product surface: `advanced`
Note: Power tool for low-level timeline JSON edits.

Cost tier: `free`

**Parameters:**

- `project` _(string)_ **required** — Timeline file or directory
- `clip-id` _(string)_ **required** — Clip ID
- `start` _(number)_ — New start time
- `duration` _(number)_ — New duration
- `dryRun` _(boolean)_ — Preview parameters without executing

### `detect`

#### `vibe detect beats`

Detect beats in audio (for music sync)

Product surface: `public`

Cost tier: `free`

**Parameters:**

- `audio` _(string)_ **required** — Audio file path
- `output` _(string)_ — Output JSON file with timestamps
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe detect scenes`

Detect scene changes in video

Product surface: `public`

Cost tier: `free`

**Parameters:**

- `video` _(string)_ **required** — Video file path
- `threshold` _(number)_ _(default: `0.3`)_ — Scene change threshold (0-1)
- `output` _(string)_ — Output JSON file with timestamps
- `project` _(string)_ — Add scenes as clips to project
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe detect silence`

Detect silence in audio/video

Product surface: `public`

Cost tier: `free`

**Parameters:**

- `media` _(string)_ **required** — Media file path
- `noise` _(number)_ _(default: `-30`)_ — Noise threshold in dB
- `duration` _(number)_ _(default: `0.5`)_ — Minimum silence duration
- `output` _(string)_ — Output JSON file with timestamps
- `dryRun` _(boolean)_ — Preview parameters without executing

### `batch`

#### `vibe batch apply-effect`

Apply an effect to multiple clips

Product surface: `advanced`
Note: Power tool for bulk timeline/media operations.

Cost tier: `free`

**Parameters:**

- `project` _(string)_ **required** — Timeline file or directory
- `effect-type` _(string)_ **required** — Effect type (fadeIn, fadeOut, blur, etc.)
- `clip-ids` _(array)_ — Clip IDs to apply effect to (or --all)
- `all` _(boolean)_ _(default: `false`)_ — Apply to all clips
- `duration` _(number)_ _(default: `1`)_ — Effect duration
- `start` _(number)_ _(default: `0`)_ — Effect start time (relative to clip)
- `intensity` _(string)_ _(default: `"1"`)_ — Effect intensity (0-1)
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe batch concat`

Concatenate multiple sources into sequential clips

Product surface: `advanced`
Note: Power tool for bulk timeline/media operations.

Cost tier: `free`

**Parameters:**

- `project` _(string)_ **required** — Timeline file or directory
- `source-ids` _(array)_ — Source IDs to concatenate (or --all)
- `all` _(boolean)_ _(default: `false`)_ — Concatenate all sources in order
- `track` _(string)_ — Track to place clips on
- `start` _(number)_ _(default: `0`)_ — Starting time
- `gap` _(number)_ _(default: `0`)_ — Gap between clips
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe batch import`

Import multiple media files from a directory

Product surface: `advanced`
Note: Power tool for bulk timeline/media operations.

Cost tier: `free`

**Parameters:**

- `project` _(string)_ **required** — Timeline file or directory
- `directory` _(string)_ **required** — Directory containing media files
- `recursive` _(boolean)_ _(default: `false`)_ — Search subdirectories
- `duration` _(number)_ _(default: `5`)_ — Default duration for images
- `filter` _(string)_ — Filter files by extension (e.g., '.mp4,.mov')
- `dryRun` _(boolean)_ — Preview parameters without executing

#### `vibe batch info`

Show batch processing statistics

Product surface: `advanced`
Note: Power tool for bulk timeline/media operations.

Cost tier: `free`

**Parameters:**

- `project` _(string)_ **required** — Timeline file or directory

#### `vibe batch remove-clips`

Remove multiple clips from the timeline

Product surface: `advanced`
Note: Power tool for bulk timeline/media operations.

Cost tier: `free`

**Parameters:**

- `project` _(string)_ **required** — Timeline file or directory
- `clip-ids` _(array)_ — Clip IDs to remove
- `all` _(boolean)_ _(default: `false`)_ — Remove all clips
- `track` _(string)_ — Remove clips from specific track only
- `dryRun` _(boolean)_ — Preview parameters without executing

### `media`

#### `vibe media duration`

Get media duration in seconds (for scripting)

Product surface: `advanced`
Note: Script utility for media metadata.

Cost tier: `free`

**Parameters:**

- `file` _(string)_ **required** — Media file path

#### `vibe media info`

Get media file information

Product surface: `advanced`
Note: Script utility for media metadata.

Cost tier: `free`

**Parameters:**

- `file` _(string)_ **required** — Media file path

### `storyboard`

#### `vibe storyboard get`

Print one beat as structured JSON

Product surface: `agent`

Cost tier: `free`

**Parameters:**

- `project-dir` _(string)_ **required** — Project directory
- `beat` _(string)_ **required** — Beat id

#### `vibe storyboard list`

List beats, ids, cues, and durations from STORYBOARD.md

Product surface: `agent`

Cost tier: `free`

**Parameters:**

- `project-dir` _(string)_ — Project directory

#### `vibe storyboard move`

Reorder beats safely

Product surface: `agent`

Cost tier: `free`

**Parameters:**

- `project-dir` _(string)_ **required** — Project directory
- `beat` _(string)_ **required** — Beat id to move
- `after` _(string)_ — Place the beat after this beat id

#### `vibe storyboard revise`

Revise STORYBOARD.md from a request or source file

Product surface: `public`

Cost tier: `low`

**Parameters:**

- `project-dir` _(string)_ **required** — Project directory
- `from` _(string)_ — Revision request or path to a text/markdown file
- `duration` _(number)_ — Target total duration in seconds
- `composer` _(string)_ — Revision LLM provider: claude|openai|gemini
- `dryRun` _(boolean)_ — Preview the revised storyboard without writing

JSON payload: `data.kind` is `"storyboard-revision"` and includes `provider`, `summary`, `changedBeats`, `validation`, `wrote`, `warnings`, and `retryWith`. Use `--dry-run` before writing.

#### `vibe storyboard set`

Update one cue in one beat without raw Markdown editing

Product surface: `agent`

Cost tier: `free`

**Parameters:**

- `project-dir` _(string)_ **required** — Project directory
- `beat` _(string)_ **required** — Beat id
- `key` _(string)_ **required** — Cue key: duration | narration | backdrop | video | motion | voice | music | asset
- `value` _(array)_ — Cue value. Use --json-value to pass a JSON scalar/object.
- `jsonValue` _(boolean)_ — Parse value as JSON instead of a string
- `unset` _(boolean)_ — Remove the cue key from the beat

#### `vibe storyboard validate`

Validate cue blocks and beat ids

Product surface: `public`

Cost tier: `free`

**Parameters:**

- `project-dir` _(string)_ — Project directory

### `status`

#### `vibe status job`

Show one async job status

Product surface: `public`

Cost tier: `free`

**Parameters:**

- `job-id` _(string)_ **required** — Local job id from a no-wait command
- `project` _(string)_ — Project directory containing .vibeframe/jobs
- `noRefresh` _(boolean)_ — Read local job record only; do not call provider APIs
- `wait` _(boolean)_ — Wait for completion when the provider status helper supports it
- `output` _(string)_ — Download result media when complete

JSON payload: `data.kind` is `"job"` and includes flat job fields (`id`, `jobType`, `provider`, `status`, timestamps), `progress`, `result`, `retryWith`, and the raw `job` record for compatibility.

#### `vibe status project`

Summarize build, review, and async job status for a project

Product surface: `public`

Cost tier: `free`

**Parameters:**

- `project-dir` _(string)_ — VibeFrame project directory
- `refresh` _(boolean)_ — Refresh active supported jobs before summarizing

JSON payload: `data.kind` is `"project"` and includes `status`, `currentStage`, `beats` readiness counts, `jobs.latest`, `build`, `review`, `warnings`, and `retryWith`. `review` includes `mode`, issue/error/warning/info counts, `fixOwners`, `sourceReports`, and `retryWith`; top-level `retryWith` is the resume contract.
