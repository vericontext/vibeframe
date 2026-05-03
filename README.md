# VibeFrame

**A storyboard-first video CLI for coding agents.**

VibeFrame helps humans and AI coding agents turn `STORYBOARD.md` and
`DESIGN.md` into generated assets, timed scene compositions, review reports,
and final MP4 renders. The primary workflow is plain shell commands with JSON
output, dry runs, deterministic project files, and machine-readable reports
that Codex, Claude Code, Cursor, and other coding agents can act on.

It still includes FFmpeg-style editing commands, AI media primitives, YAML
pipelines, and an optional MCP server, but the north-star path is a
storyboard-driven project loop.

Most users do not need a new chat UI. Use VibeFrame from your terminal,
Claude Code, Codex, Cursor, Aider, Gemini CLI, OpenCode, or any other agent
that can run shell commands. `vibe agent` exists as an optional built-in
fallback when you do not already have an AI coding agent.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/vericontext/vibeframe/actions/workflows/ci.yml/badge.svg)](https://github.com/vericontext/vibeframe/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/vericontext/vibeframe)](https://github.com/vericontext/vibeframe/stargazers)

```bash
curl -fsSL https://vibeframe.ai/install.sh | bash

mkdir launch-demo && cd launch-demo
vibe setup --scope project
vibe init launch --from brief.md --json

# Ask Codex, Claude Code, Cursor, or another host agent:
# "Research this topic and update launch/STORYBOARD.md and launch/DESIGN.md.
#  Tighten the image-generation cues, then build and inspect the video."

vibe storyboard validate launch --json
vibe build launch --dry-run --json
vibe build launch --json
vibe render launch -o renders/final.mp4 --json
vibe inspect render launch --cheap --json
```

## Demo

This demo shows the intended first-run shape:

1. Install `vibe`.
2. Run `vibe setup --scope project`.
3. Run `vibe init launch`.
4. Ask a coding agent to research a topic and update `STORYBOARD.md` and
   `DESIGN.md`.
5. Let the storyboard include explicit image-generation cues.
6. Build, render, inspect, and share the final MP4.

<table>
  <tr>
    <td width="50%">
      <video src="https://raw.githubusercontent.com/vericontext/vibeframe/main/assets/demos/process-highlights/demo-process-highlight-bgm.mp4" controls muted width="100%"></video>
      <br />
      <strong>Process highlight</strong><br />
      <sub>Agent-driven setup, research, storyboard/design edits, image cues, build, render, and review.</sub>
    </td>
    <td width="50%">
      <video src="https://raw.githubusercontent.com/vericontext/vibeframe/main/assets/demos/demo-result.mp4" controls muted width="100%"></video>
      <br />
      <strong>Rendered result</strong><br />
      <sub>The final MP4 produced from the storyboard composition workflow.</sub>
    </td>
  </tr>
</table>

The older [DEMO-quickstart.md](DEMO-quickstart.md) still shows direct media
primitives such as standalone image generation, image-to-video, inspection,
and motion overlay. Those remain useful, but the primary workflow is the
storyboard project loop.

## What It Does

- **Build videos from storyboards:** author `STORYBOARD.md` and `DESIGN.md`,
  then run `vibe plan`, `vibe build`, `vibe inspect`, and `vibe render`.
- **Run the agent loop safely:** use JSON output, dry runs, cost caps,
  `build-report.json`, `review-report.json`, and deterministic repair commands.
- **Generate media primitives:** create images, videos, narration, music, sound
  effects, motion graphics, and thumbnails through pluggable AI providers.
- **Edit existing video:** silence cut, captions, translation, fades, speed
  ramps, reframing, noise reduction, upscaling, and more.
- **Understand and organize media:** inspect images/videos, detect scenes,
  silence, and beats, and script low-level timeline or batch operations.
- **Automate from any host:** drive the same workflows from a terminal, coding
  agent, YAML pipeline, or optional MCP server.

## Three Workflow Lanes

Use the highest-level lane that matches the job:

| Lane             | Use it when...                                        | Commands                                                        |
| ---------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| **Build**        | You want a complete video from a written brief        | `vibe init`, `storyboard`, `plan`, `build`, `render`, `inspect` |
| **Generate**     | You need one standalone asset                         | `vibe generate image`, `video`, `narration`, `music`, `motion`  |
| **Edit / Remix** | You already have media and want to change or reuse it | `vibe edit`, `vibe remix`, `vibe audio`, `vibe detect`          |

For the longer product-surface direction and command classification, see
[FUNCTIONS-TOBE.md](FUNCTIONS-TOBE.md). The README stays focused on what a
new user should run first.

## 30-Second Map

| You want to...                                                        | Use                                                               |
| --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Start a storyboard-driven video project                               | `vibe init --from ...`, then edit `STORYBOARD.md` and `DESIGN.md` |
| Validate, cost, and explain the project plan                          | `vibe storyboard validate`, `vibe plan`, `vibe build --dry-run`   |
| Generate assets, compose scenes, and sync timing                      | `vibe build`, `vibe status project`                               |
| Review quality and produce the final MP4                              | `vibe inspect project`, `vibe render`, `vibe inspect render`      |
| Apply deterministic scene fixes after review                          | `vibe scene repair`                                               |
| Generate a standalone image, video, narration, music, or motion asset | `vibe generate ...`                                               |
| Change an existing media file                                         | `vibe edit ...`, `vibe remix ...`, `vibe audio ...`               |
| Run a repeatable multi-step workflow                                  | `vibe run pipeline.yaml`                                          |
| Script low-level timeline edits or bulk imports                       | `vibe timeline ...`, `vibe batch ...`                             |
| Decide which path fits                                                | `vibe guide motion`, `vibe guide scene`, `vibe guide pipeline`    |

## Requirements

- Node.js 20+
- FFmpeg
- Chrome or Chromium for HTML scene rendering
- API keys only for the providers you use

Local/free paths are available for many editing tasks and for Kokoro TTS. AI
image/video generation requires provider keys such as `OPENAI_API_KEY`,
`FAL_API_KEY`, `GOOGLE_API_KEY`, or others listed in [MODELS.md](MODELS.md).

## Install

```bash
curl -fsSL https://vibeframe.ai/install.sh | bash
vibe doctor
```

The installer places the CLI checkout under the XDG data directory
(`~/.local/share/vibeframe` by default). User-scope API keys stay in a clean
`~/.vibeframe/config.yaml`; project-scope setup still writes
`./.vibeframe/config.yaml`.

For local development:

```bash
git clone https://github.com/vericontext/vibeframe.git
cd vibeframe
pnpm install
pnpm build
pnpm vibe --help
```

## Quick Start

First run:

```bash
vibe setup
vibe setup --scope project  # optional: store provider keys in this repo only
vibe doctor
vibe guide
```

### Build A Storyboard Video

```bash
vibe init my-video \
  --from "45-second launch video for an AI-native editor" \
  --profile agent \
  --visual-style "Swiss Pulse" \
  -r 16:9 \
  -d 45 \
  --json

# Edit my-video/STORYBOARD.md and my-video/DESIGN.md
vibe storyboard validate my-video --json
vibe plan my-video --json
vibe build my-video --dry-run --max-cost 5 --json
vibe build my-video --max-cost 5 --json
vibe status project my-video --refresh --json
vibe inspect project my-video --json
vibe render my-video -o renders/final.mp4 --quality standard --json
vibe inspect render my-video --cheap --json
vibe scene repair my-video --json

# Focus a single beat during iteration
vibe build my-video --beat hook --stage sync --json
vibe inspect project my-video --beat hook --json
vibe render my-video --beat hook --json
vibe inspect render my-video --beat hook --cheap --json

# Let a host agent handle semantic issues from the report
codex "fix issues from my-video/review-report.json"
```

Each storyboard beat can include YAML cues:

````markdown
## Beat hook — Open

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

Agents should use `vibe storyboard set/get/move/list` for narrow cue edits
and direct Markdown edits for larger creative rewrites. `STORYBOARD.md` is
the intent layer, `DESIGN.md` is the visual system, `vibe.config.json` stores
provider/model defaults, and files under `assets/` and `compositions/` are
generated artifacts. `build-report.json` records build results and costs;
`review-report.json` records inspection findings and suggested fixes.
When paid video or music providers return async jobs, `vibe status project
--refresh` downloads completed outputs, updates `build-report.json`, and
writes freshness metadata under `.vibeframe/assets/`. The sync stage wires
ready narration and music into the root timeline, so render inspection can map
audio/visual issues back to the affected beat.

### Edit Existing Media

```bash
# Remove silence
vibe edit silence-cut interview.mp4 -o clean.mp4

# Add captions
vibe edit caption video.mp4 -o captioned.mp4

# Detect scene changes
vibe detect scenes video.mp4

# Reduce background noise
vibe edit noise-reduce noisy.mp4 -o clean.mp4
```

### Generate Media Primitives

Use primitives directly when you need a standalone asset or when an agent is
debugging one stage of a storyboard build.

```bash
vibe generate image \
  "A cinematic product demo frame, clean terminal UI, blue highlights" \
  -p openai \
  -o frame.png

vibe generate video \
  "The interface animates into a polished product demo" \
  -p seedance \
  -i frame.png \
  -d 8 \
  -o motion.mp4

vibe generate narration \
  "Start with a storyboard. VibeFrame turns each beat into a render plan." \
  -o narration.mp3
```

## Video As YAML

Use `vibe run` when you want a reproducible multi-step workflow:

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

VibeFrame is designed to be easy for AI coding agents to drive because the CLI
is the UI. The primary agent path is still plain shell commands plus project
guidance files, not a separate VibeFrame chat surface.

```text
"Build a 45-second launch video from this brief"
-> vibe init launch --from brief.md --json
-> edit launch/STORYBOARD.md and launch/DESIGN.md
-> vibe plan launch --json
-> vibe build launch --dry-run --max-cost 5 --json
-> vibe build launch --max-cost 5 --json
-> vibe status project launch --refresh --json
-> vibe inspect project launch --json
-> vibe render launch --json
-> vibe inspect render launch --cheap --json

"Fix quality issues from the render review"
-> read review-report.json
-> vibe scene repair launch --json
-> edit STORYBOARD.md or composition artifacts only where needed
-> vibe render launch --json
-> vibe inspect render launch --cheap --json
```

`vibe init` creates project guidance files for common hosts, including Claude
Code, Codex, Cursor, Aider, Gemini CLI, OpenCode, and a universal `AGENTS.md`
fallback.

How agents discover the right command:

- Claude Code reads `CLAUDE.md`, which imports `AGENTS.md`.
- Codex reads `AGENTS.md` directly.
- Cursor/OpenCode can use `AGENTS.md` and MCP.
- Every host can fall back to `vibe schema`, `vibe context`, `vibe doctor`,
  and `vibe guide`.

Built-in workflow guides are the first stop when intent is ambiguous:

```bash
vibe guide
vibe guide motion
vibe guide scene
vibe guide pipeline
```

`vibe agent` is available for environments without Claude Code, Codex, Cursor,
or another coding agent. Treat it as optional/advanced; external agents driving
the CLI through `AGENTS.md`, `--json`, `--dry-run`, `vibe context`, and
`vibe schema --list --surface public` are the primary workflow.

## MCP Server

The CLI is the primary interface. For hosts that prefer MCP, VibeFrame also
ships `@vibeframe/mcp-server`.

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
generation, TTS, transcription, and analysis. Common environment variables:

```text
OPENAI_API_KEY
ANTHROPIC_API_KEY
GOOGLE_API_KEY
FAL_API_KEY
ELEVENLABS_API_KEY
RUNWAY_API_SECRET
KLING_API_KEY
XAI_API_KEY
REPLICATE_API_TOKEN
OPENROUTER_API_KEY
IMGBB_API_KEY
```

The canonical list is `vibe doctor --json | jq '.data.providers'` — that
shape derives from `packages/ai-providers/src/api-keys.ts` and stays in
sync with new providers automatically.

Use:

```bash
vibe setup --show
vibe doctor
```

For model and provider details, see [MODELS.md](MODELS.md).

## Relationship To Hyperframes

VibeFrame is a video workflow CLI. Scene projects use `vibe.config.json` for
provider, model, quality, and build defaults. Legacy projects may still carry
`vibe.project.yaml`, where the composition engine can be declared like this:

```yaml
composition:
  engine: hyperframes
  entry: index.html
```

[Hyperframes](https://github.com/heygen-com/hyperframes) provides deterministic
browser-based capture and composition primitives. VibeFrame adds the
storyboard/design source files, build and review reports, CLI workflows,
provider routing, YAML orchestration, agent guidance, media generation, and
traditional editing commands around that rendering layer.

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

## Useful Docs

- [docs/README.md](docs/README.md): compact docs index
- [docs/cli-reference.md](docs/cli-reference.md): every command, flag, and JSON envelope (auto-generated from `vibe schema --list`)
- [DEMO-quickstart.md](DEMO-quickstart.md): copy-paste first-video flow
- [DEMO-dogfood.md](DEMO-dogfood.md): contributor dogfood flow
- [docs/cookbook.md](docs/cookbook.md): practical recipes
- [docs/video-project-concepts.md](docs/video-project-concepts.md): project model
- [docs/comparison.md](docs/comparison.md): how VibeFrame relates to Hyperframes
- [FUNCTIONS-TOBE.md](FUNCTIONS-TOBE.md): product-surface direction and command classification
- [MODELS.md](MODELS.md): provider/model reference
- [ROADMAP.md](ROADMAP.md): roadmap

For machine-readable access (agents, scripts) use the live introspection
hooks instead of this README:

```bash
vibe schema --list --surface public  # small first-run/product surface
vibe schema --list --json     # full command catalog (current count via `length`)
vibe schema --list --filter very-high  # narrow to a cost tier
vibe schema <command> --json  # JSON Schema for one command
vibe context                  # agent quickstart (rules, envelope shape, conventions)
```

Schema entries include a `surface` field. Treat `public` as the first-run
product path, `agent` as host-agent automation, and `advanced`/`legacy` as
compatible power primitives with replacements where applicable.

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
# Scaffold a provider declaration
pnpm scaffold:provider <name>

# Scaffold a command under generate or edit
pnpm scaffold:command <generate|edit> <name>
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

## License

MIT. See [LICENSE](LICENSE).
