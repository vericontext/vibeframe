# VibeFrame

Let your coding agent generate real video, on your own provider keys, under a spend ceiling it cannot cross.

VibeFrame is a CLI and MCP server that gives Claude Code, Codex, Cursor, or any bash-capable agent the commands to plan a video, generate the assets from frontier models - Seedance, Runway, Veo, Kling - and render a finished MP4.
Every paid step sits behind a dry run and a hard `--max-cost` ceiling, and every failure comes back as machine-readable recovery actions instead of a stack trace.

Scene composition is [Hyperframes](https://github.com/heygen-com/hyperframes)' job, not ours.
VibeFrame installs its skill and builds the generation, cost, and review layer around it.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/vericontext/vibeframe/actions/workflows/ci.yml/badge.svg)](https://github.com/vericontext/vibeframe/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/vericontext/vibeframe)](https://github.com/vericontext/vibeframe/stargazers)

## Know the price before anything is spent

`--dry-run` prices the whole build without calling a provider or needing a single key.
Pair it with `--max-cost` and the build refuses to start when the estimate is over your ceiling:

```bash
vibe build film --dry-run --max-cost 3 --json
```

```json
{
  "success": false,
  "error": "Estimated cost $10.93 exceeds --max-cost $3.00.",
  "code": "COST_CAP_EXCEEDED",
  "exitCode": 1,
  "suggestion": "Raise --max-cost or reduce the stage/provider scope.",
  "retryWith": [
    "vibe build . --stage all --skip-backdrop --json",
    "vibe build . --stage all --max-cost 10.93 --json"
  ],
  "recoverable": true,
  "retryable": false,
  "data": { "plan": { "estimatedCostUsd": 10.93, "...": "the full priced plan" } }
}
```

The envelope goes to stderr and the command exits 1, so an agent loop stops
instead of guessing. `retryWith` gives it the two cheaper ways forward it can
take without asking you, and `data.plan` carries the priced plan the refusal
was based on, so it never has to re-run just to learn the estimate.
The same dry run also names the keys each stage would need, so you find out what a video costs before you own an account:

```text
Keyframe generation will need openai (OPENAI_API_KEY), but no key/config is available.
Video generation will need seedance (FAL_API_KEY), but no key/config is available.
```

This is the part of VibeFrame that has no equivalent in a credit-based tool.
Your keys, your bill, your ceiling.

## Try it with no keys at all

Before wiring up any provider, the whole pipeline runs locally for $0: local Kokoro TTS narration, HTML/CSS scenes composed by your coding agent, and a headless Chrome plus FFmpeg render.

```bash
npm install -g @vibeframe/cli
vibe init demo --from "30-second video introducing my project"
```

Then ask your coding agent to finish it:

> Build demo/ into a rendered MP4 with zero API keys.
> Use `vibe build demo --tts kokoro --skip-backdrop --json`, author the scene
> HTML from `vibe scene compose-prompts demo --json`, then run
> `vibe build demo --stage sync --json` and `vibe render demo --json`.

Measured cold start on that exact sequence: about 4 to 5 minutes from `npm install` to a reviewed 1080p MP4, including a one-time ~88 MB voice model download.
Repeat runs skip the download.
No coding agent available? The same commands work by hand - `vibe scene compose-prompts` prints the full per-scene authoring brief for you.

It is a real render, and it is the cheapest way to see whether the workflow fits you.
It is not the point of the tool: the paid generation path above is.

## Requirements

- Node.js 20+
- FFmpeg
- Chrome or Chromium (for HTML scene rendering)

Everything local runs on those three: FFmpeg edits, Kokoro narration, HTML scene composition, detection, timeline work, and rendering.
Generation is BYO-key - add `OPENAI_API_KEY`, `FAL_API_KEY`, `GOOGLE_API_KEY`, `RUNWAY_API_SECRET`, or `KLING_API_KEY` only for the providers you actually use (full list in [MODELS.md](MODELS.md)).
`vibe doctor` lists exactly which commands each key unlocks.

## Install

```bash
curl -fsSL https://vibeframe.ai/install.sh | bash
vibe doctor
```

The installer places the CLI under the XDG data directory
(`~/.local/share/vibeframe` by default). User-scope API keys live in
`~/.vibeframe/config.yaml`; project-scope setup writes `./.vibeframe/config.yaml`.
When a project config exists at or above your current directory, VibeFrame uses
that project config in isolation and does not merge user-scope keys.

> **npm package names:** the CLI is published as
> [`@vibeframe/cli`](https://www.npmjs.com/package/@vibeframe/cli) (binary
> `vibe`) and the MCP server as
> [`@vibeframe/mcp-server`](https://www.npmjs.com/package/@vibeframe/mcp-server).
> There is no bare `vibeframe` npm package from this project - that name belongs
> to an unrelated package, so `npx vibeframe` will not run this tool.

For local development:

```bash
git clone https://github.com/vericontext/vibeframe.git
cd vibeframe
pnpm install
pnpm build
pnpm vibe --help
```

## How The Pieces Fit Together

Use the highest-level lane that fits the job:

| Lane               | Use it when...                                        | Commands                                                             |
| ------------------ | ----------------------------------------------------- | -------------------------------------------------------------------- |
| **BUILD**          | You want a complete video from a written brief        | `init`, `storyboard`, `plan`, `build`, `preview`, `render`, `inspect` |
| **GENERATE/ASSET** | You need one standalone image, clip, voice, or music  | `generate image/video/narration/music/motion`                        |
| **EDIT/REMIX**     | You already have media and want to change or reuse it | `edit`, `remix`, `audio`, `detect`                                   |

BUILD is the primary path; the other two need no storyboard.

Within a BUILD project, the files have defined roles:

| Path            | Role                                                                              |
| --------------- | --------------------------------------------------------------------------------- |
| `brief.md`      | Optional rough input before `vibe init`; can be messy notes, links, or one line. |
| `STORYBOARD.md` | Beats, narration, duration, and image/video/music cues. The intent layer.         |
| `DESIGN.md`     | Palette, typography, layout, motion, and transitions. The visual system.          |
| `media/`        | User-provided source files: photos, screenshots, logos, B-roll, voice recordings. |
| `assets/`       | Generated or canonical build artifacts: narration, backdrops, music, video clips. |
| `renders/`      | Final and intermediate MP4 outputs.                                               |

`vibe.config.json` owns the project contract (provider, model, quality, and
build defaults). The composition engine today is Hyperframes (HTML/CSS/JS scene
rendering in a headless browser).

## Quick Start

```bash
vibe setup    # this is where provider keys go - optional until a step generates
vibe doctor
vibe guide
```

Scaffold a project from a brief:

```bash
mkdir -p launch/media
# optional: add your own photos, logos, screenshots, or B-roll
# cp ~/Desktop/product-shot.png launch/media/

cat > brief.md <<'EOF'
Make a 30-second launch video for VibeFrame.

Audience: developers using Codex, Claude Code, or Cursor.
Message: a coding agent can turn a brief into a rendered MP4.
Tone: technical, concise, credible.
EOF

vibe setup --scope project
vibe init launch --from brief.md --json
```

`--from` also accepts an inline string:

```bash
vibe init launch --from "30-second launch video for VibeFrame" --json
```

After init, `STORYBOARD.md` and `DESIGN.md` are the working source of truth.
Edit them directly or ask a coding agent to research and revise them.

## Project Flow

```bash
vibe storyboard validate my-video --json
vibe plan my-video --json
vibe build my-video --dry-run --max-cost 5 --json
vibe build my-video --max-cost 5 --json
vibe status project my-video --refresh --json
vibe inspect project my-video --json
vibe preview my-video --json
vibe render my-video -o renders/final.mp4 --json
vibe inspect render my-video --cheap --json
vibe scene repair my-video --json
```

To iterate on a single beat without rebuilding everything:

```bash
vibe build my-video --beat hook --stage sync --json
vibe inspect project my-video --beat hook --json
vibe render my-video --beat hook --json
vibe inspect render my-video --beat hook --cheap --json
```

Each storyboard beat carries YAML cues:

````markdown
## Beat hook - Open

```yaml
narration: "Start with a storyboard. VibeFrame turns each beat into a render plan."
backdrop: "Clean developer terminal beside structured storyboard cues"
video: "Slow push-in across generated interface panels"
motion: "Kinetic headline, subtle parallax, clean lower-third"
voice: "alloy"
music: "minimal pulse, confident"
duration: 5
```
````

When a beat should reuse a local file instead of generating one, use a
project-relative path:

```yaml
backdrop: "media/product-shot.png"
video: "media/broll.mp4"
narration: "media/voice.wav"
asset: "media/logo.png"
```

### `vibe init` profiles

| Profile   | Use when                                              | What it creates                               |
| --------- | ----------------------------------------------------- | --------------------------------------------- |
| `minimal` | You only want the authoring docs at first             | `STORYBOARD.md`, `DESIGN.md`, project config  |
| `agent`   | Recommended for Codex, Claude Code, Cursor, and Aider | authoring docs plus local agent guidance      |
| `full`    | You want all render/backend files up front            | authoring docs, agent guidance, render scaffold |

The default is `agent`. Pass `--mcp` to also create project-scoped MCP config
during init.

## What the spend buys: one character, many scenes

Generating four shots that look like the same film is the hard part, and it is what the paid path is for.
Declare a character pool in the storyboard frontmatter and reference it from individual beats.
VibeFrame generates the character sheet once and reuses it as the reference image for Seedance image-to-video, so the character stays consistent across scenes.

````markdown
---
characters:
  mira: "arctic aurora photographer, deep-red fur-lined parka, dark hair under a charcoal beanie, vintage 35mm camera"
  rival: { image: "media/rival-ref.png" }
---

## Beat hook - Hook

```yaml
duration: 5
characters: [mira]
keyframe: "MIRA stands on the frozen ice, camera lowered, looking up as the aurora fills the sky"
video: "slow tilt up as the aurora ripples and pulses overhead"
```
````

Each beat pairs a `keyframe` still with a `video` motion prompt.
Generate the cheap image storyboard first, review it, then animate only the stills you approve - that is also the cheapest way to keep a run under its ceiling, since stills cost a fraction of the video.

```bash
vibe build my-film --skip-video   # keyframe stills only (cheap) - review them first
vibe build my-film --beat wonder --stage assets --force --skip-video  # redo one beat
vibe build my-film --max-cost 12  # animate the approved stills (image-to-video)
```

▶ **[Watch the full render](https://github.com/vericontext/vibeframe/releases/download/v0.113.11/vibeframe-showcase.mp4)**:
one photographer across a single arctic night (trek → first aurora → the
whole sky → dawn), 1080p, generated end-to-end. Open source, MIT.

![One consistent character across a directed arctic night: a trek under the stars, the first aurora, the whole sky ablaze, and the walk home at dawn](docs/media/showcase-aurora.gif)

Prompt craft for both models lives in the
[AI video prompting playbook](docs/ai-video-prompting.md); the storyboard cues
(`characters:`, `keyframe:`) are documented in [docs/projects.md](docs/projects.md).

## One-Shot Media Commands

Use these when the job is a single asset or media transformation, not a
full storyboard project:

```bash
# Generate standalone assets
vibe generate image "cinematic product demo frame" -p openai -o frame.png
vibe generate video "interface animates into a polished demo" -p seedance -i frame.png -o motion.mp4
vibe generate narration "Start with a storyboard." -o narration.mp3
vibe generate music "minimal instrumental tech pulse" --instrumental -d 60 -o bgm.mp3

# Edit existing media
vibe edit silence-cut interview.mp4 -o clean.mp4
vibe edit caption video.mp4 -o captioned.mp4
vibe edit noise-reduce noisy.mp4 -o clean.mp4
vibe detect scenes video.mp4

# Remix and audio
vibe remix highlights demo-process.mp4 -d 60 -o highlight.mp4
vibe audio duck bgm.mp3 --voice highlight.mp4 -o bgm-ducked.mp3
```

## YAML Pipelines

Use `vibe run` for reproducible multi-step workflows:

```yaml
name: promo
budget:
  costUsd: 5
steps:
  - id: image
    action: generate-image
    prompt: "A cinematic developer-tool hero frame"
    output: frame.png

  - id: video
    action: generate-video
    prompt: "Slow camera push-in, subtle interface motion"
    image: $image.output
    provider: seedance
    duration: 8
    output: motion.mp4
```

```bash
vibe run promo.yaml --dry-run
vibe run promo.yaml
vibe run promo.yaml --resume
```

## Agent Workflows

The intended agent path: use your host's agent loop as the outer loop,
drive VibeFrame CLI commands with `--json`, and use `build-report.json` and
`review-report.json` as loop state.

The forward pass is the Project Flow above. What makes it a loop is the
recovery pass:

```text
"fix quality issues from the render review"
-> read review-report.json
-> vibe scene repair launch --json
-> edit STORYBOARD.md or composition artifacts only where needed
-> vibe render launch --json
-> vibe inspect render launch --cheap --json
```

`inspect` returns a `review-report.json` with pre-classified `nextActions`:
run `safeToAutoRun:true` actions automatically, ask before
`requiresConfirmation:true` actions, and use `retryWith` only as a fallback.
`fixOwner:"vibe"` means the CLI can repair it deterministically;
`fixOwner:"host-agent"` means the outer loop (or a human) must edit
`STORYBOARD.md`, `DESIGN.md`, or compositions.

### Outer-loop agent prompts

Hand your coding agent a prompt like the following - a plain prompt, not a
built-in command. It works the same in Codex, Claude Code, or Cursor:

```text
Build launch/ into a reviewed VibeFrame MP4 from brief.md, using your own agent
loop as the outer loop.
Use vibe context/schema first when command details are unclear. Use --json for
all vibe commands. Run --dry-run before paid operations and keep generated-asset
spend under $5 with --max-cost 5 where supported. Read build-report.json and
review-report.json before choosing the next action. Prefer nextActions:
run only safeToAutoRun:true actions automatically, ask before
requiresConfirmation:true actions, and use retryWith only as the compatibility
fallback. Treat fixOwner:"vibe" issues as deterministic CLI repair work and
fixOwner:"host-agent" issues as storyboard, DESIGN.md, or composition edits.

Stop only when launch/renders/final.mp4 exists, the target duration is 30s or
less, the aspect ratio is 16:9 unless brief.md says otherwise,
vibe inspect render launch --cheap --json reports no errors, any AI review score
is at least 90 when AI review is requested, and every remaining host-agent issue is fixed,
intentionally accepted with a written reason, or reported as blocked.
```

### Configuring hosts

`vibe init` creates agent guidance files for Codex, Claude Code, Cursor, Aider,
Gemini CLI, OpenCode, and a universal `AGENTS.md` fallback.

`vibe host` turns that guidance into app-ready configuration:

```bash
vibe host list --json
vibe host setup all              # print snippets only
vibe host setup cursor --write   # write .cursor/mcp.json
vibe host doctor all --json
```

By default, `--write` is required to apply config; `vibe host setup` prints
only. For Claude Desktop, pass the workspace directory so relative project
names resolve correctly:

```bash
vibe host setup claude-desktop ~/dev/videos --write
```

### Schema and introspection

```bash
vibe schema --list                  # full command catalog
vibe schema --list --surface public # first-run / product surface only
vibe schema --list --filter free    # narrow to cost tier
vibe schema <command> --json        # JSON Schema for one command
vibe context                        # agent quickstart: rules, envelope, conventions
vibe guide                          # workflow guides
vibe guide motion
vibe guide scene
vibe guide pipeline
```

`vibe schema` is the source of truth for command availability and parameters.
The `surface` field on each entry signals intent: `public` = first-run product
path; `agent` = host-agent automation; `advanced`/`legacy` = compatible power
primitives.

## MCP Server

The CLI is the primary runtime. For hosts that prefer MCP, VibeFrame also
ships `@vibeframe/mcp-server` (binary `vibeframe-mcp`).

**Claude Desktop users:** install the prebuilt extension instead of editing
JSON - download [vibeframe.mcpb](https://github.com/vericontext/vibeframe/releases/latest/download/vibeframe.mcpb)
and drop it into **Settings → Extensions**, then pick a workspace folder.

For other hosts, generate snippets with:

```bash
vibe host setup codex
vibe host setup claude
vibe host setup cursor
```

Or configure directly:

```json
{
  "mcpServers": {
    "vibeframe": {
      "command": "npx",
      "args": ["-y", "@vibeframe/mcp-server"]
    }
  }
}
```

See [packages/mcp-server/README.md](packages/mcp-server/README.md) for tool,
resource, and prompt details.

## Providers

VibeFrame routes to multiple providers for LLMs, image generation, video
generation, TTS, transcription, and analysis. Rather than duplicate the list
here, read it from the CLI - it stays in sync with new providers automatically:

```bash
vibe doctor --json | jq '.data.providers'   # every provider and its env var
vibe setup --show                           # which keys you have configured
vibe doctor                                 # verify keys and dependencies
```

For model and provider details, see [MODELS.md](MODELS.md).

Cost tiers are stamped on commands. General expectations:

- **Free/local:** schema, setup/doctor, timeline/batch/detect/media, many FFmpeg edits
- **Low:** speech, transcription, inspection, simple AI-assisted edits
- **High:** image generation, storyboard/motion generation
- **Very high:** video generation and expensive provider-backed transforms

Use `vibe schema --list --filter <tier>` to check before running.

## Relationship To Composition Engines

VibeFrame wraps lower-level composition engines rather than replacing them:

| Layer                                                    | Owns                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Remotion](https://github.com/remotion-dev/remotion)     | React-based programmatic video and component-driven motion graphics.             |
| [Hyperframes](https://github.com/heygen-com/hyperframes) | HTML/CSS/JS scene composition and deterministic browser capture.                 |
| VibeFrame                                                | Frontier-model generation on your own keys, dry runs and the hard `--max-cost` ceiling, storyboard/design files, build reports, render inspection, edit/remix commands, and host-agent guidance. |

If the job is only HTML scene authoring and rendering, use Hyperframes directly - it is the better tool for that and VibeFrame installs its skill for you either way.
Reach for VibeFrame when the job involves paid generation: frontier image and video models, character continuity across scenes, narration, cost ceilings, build reports, or editing steps around the composition layer.

VibeFrame is not affiliated with HeyGen. See [CREDITS.md](CREDITS.md) for
dependency and provenance notes.

## Repository Layout

```text
packages/cli/            CLI and agent mode
packages/core/           Timeline engine and shared core types
packages/ai-providers/   Provider registry and implementations
packages/mcp-server/     MCP server package
packages/ui/             Shared React UI
apps/web/                Next.js landing/demo app
docs/                    Compact public docs
scripts/                 Install, docs generation, demos, and maintainer helpers
tests/                   Manual smoke checks outside CI
```

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

Useful local commands:

```bash
pnpm vibe --help
pnpm -F @vibeframe/cli test
pnpm -F @vibeframe/web dev
```

## Contributing

Contributions are welcome: bug fixes, provider integrations, CLI UX
improvements, docs, and tests.

```bash
pnpm scaffold:provider <name>
pnpm scaffold:command <generate|edit> <name>
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

## Reference

- [MODELS.md](MODELS.md): provider and model reference.
- [CHANGELOG.md](CHANGELOG.md): versioned release notes.
- [ROADMAP.md](ROADMAP.md): short public roadmap.
- [docs/projects.md](docs/projects.md): project file roles, profiles, characters, and dry runs.

## License

MIT. See [LICENSE](LICENSE).
