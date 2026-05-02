# VibeFrame

**A video CLI for agentic workflows.**

VibeFrame helps humans and AI coding agents create, edit, analyze, and render
video from the terminal. It combines FFmpeg-style editing commands, AI media
generation, storyboard-based scene composition, YAML pipelines, and an optional
MCP server for hosts that prefer tool calls over shell commands.

Most users do not need a new chat UI. Use VibeFrame from your terminal,
Claude Code, Codex, Cursor, Aider, Gemini CLI, OpenCode, or any other agent
that can run shell commands. `vibe agent` exists as an optional built-in
fallback when you do not already have an AI coding agent.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/vericontext/vibeframe/actions/workflows/ci.yml/badge.svg)](https://github.com/vericontext/vibeframe/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/vericontext/vibeframe)](https://github.com/vericontext/vibeframe/stargazers)

```bash
vibe init my-video --from "45-second launch video for an AI-native editor"
vibe storyboard validate my-video
vibe plan my-video
vibe build my-video --max-cost 5
vibe inspect project my-video
vibe render my-video -o renders/final.mp4
vibe inspect render my-video --cheap
```

## Demo

The current quickstart recording shows Claude Code driving the installed
`vibe` CLI through image generation, image-to-video, media inspection, and a
motion-overlay edit.

<p align="center">
  <video src="https://raw.githubusercontent.com/vericontext/vibeframe/main/assets/demos/quickstart-claude-code.mp4" controls width="800" muted></video>
</p>

For the full copy-paste quickstart, see [DEMO-quickstart.md](DEMO-quickstart.md).

## What It Does

- **Edit existing video:** silence cut, captions, translation, fades, speed
  ramps, reframing, noise reduction, upscaling, and more.
- **Generate media:** images, videos, speech, music, sound effects, motion
  graphics, storyboards, and thumbnails through pluggable AI providers.
- **Build videos from storyboards:** author `STORYBOARD.md` and `DESIGN.md`,
  then run `vibe build` and `vibe render`.
- **Run YAML pipelines:** define reproducible multi-step workflows with
  dry-runs, budgets, checkpoints, and step references.
- **Understand and organize media:** inspect images/videos, detect scenes,
  silence, and beats, and script low-level timeline or batch operations.
- **Work with AI agents:** every workflow is scriptable from shell, and an MCP
  server is available for typed tool-call hosts.

## 30-Second Map

| You want to...                                                        | Use                                                            |
| --------------------------------------------------------------------- | -------------------------------------------------------------- |
| Generate a new image, video, voice, music, or standalone motion asset | `vibe generate ...`                                            |
| Change an existing media file                                         | `vibe edit ...`, `vibe remix ...`, `vibe audio ...`            |
| Understand, review, or ask questions about media                      | `vibe inspect ...`, `vibe media ...`                           |
| Detect scenes, silence, or beats                                      | `vibe detect ...`                                              |
| Add designed motion graphics to an existing clip                      | `vibe edit motion-overlay ...`                                 |
| Build a storyboard-driven composed video                              | `vibe init`, `vibe build`, `vibe render`                       |
| Run a repeatable multi-step workflow                                  | `vibe run pipeline.yaml`                                       |
| Script low-level timeline edits or bulk imports                       | `vibe timeline ...`, `vibe batch ...`                          |
| Decide which path fits                                                | `vibe guide motion`, `vibe guide scene`, `vibe guide pipeline` |

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
vibe doctor
vibe guide
```

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

### Generate Image And Video

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

vibe edit motion-overlay motion.mp4 \
  "minimal lower-third title, clean white type, subtle grain and vignette" \
  --understand auto \
  -o titled.mp4
```

### Build A Storyboard Video

```bash
vibe init my-video \
  --from "45-second launch video for an AI-native editor" \
  --profile agent \
  --visual-style "Swiss Pulse" \
  -r 16:9 \
  -d 45

# Edit my-video/STORYBOARD.md and my-video/DESIGN.md
vibe storyboard validate my-video --json
vibe plan my-video --json
vibe build my-video --dry-run --max-cost 5 --json
vibe build my-video --tts kokoro --max-cost 5 --json
vibe inspect project my-video --json
vibe render my-video -o renders/final.mp4 --quality standard
vibe inspect render my-video --cheap --json
vibe scene repair --project my-video --json

# Focus a single beat during iteration
vibe build my-video --beat hook --stage sync --json
vibe inspect project my-video --beat hook --json
vibe render my-video --beat hook --json
vibe inspect render my-video --beat hook --cheap --json
```

Each storyboard beat can include YAML cues:

````markdown
## Beat hook — Open

```yaml
narration: "Start with a storyboard. VibeFrame turns each beat into a render plan."
backdrop: "Clean developer terminal beside structured storyboard cues"
duration: 5
```
````

Agents should use `vibe storyboard set/get/move/list` for narrow cue edits
and direct Markdown edits for larger creative rewrites. `STORYBOARD.md` is
the intent layer; files under `compositions/` are generated scene artifacts.

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
"Remove silence from interview.mp4"
-> vibe edit silence-cut interview.mp4 -o clean.mp4

"Build a 20-second product video from this storyboard"
-> vibe init, edit STORYBOARD.md, vibe build, vibe render
```

`vibe init` creates project guidance files for common hosts, including Claude
Code, Codex, Cursor, Aider, Gemini CLI, OpenCode, and a universal `AGENTS.md`
fallback.

How agents discover the right command:

- Claude Code reads `CLAUDE.md`, which imports `AGENTS.md`.
- Codex reads `AGENTS.md` directly.
- Cursor/OpenCode can use `AGENTS.md` and MCP.
- Every host can fall back to `vibe schema`, `vibe doctor`, and `vibe guide`.

Built-in workflow guides are the first stop when intent is ambiguous:

```bash
vibe guide
vibe guide motion
vibe guide scene
vibe guide pipeline
```

`vibe agent` is available for environments without Claude Code, Codex, Cursor,
or another coding agent. Treat it as optional/advanced; external agents driving
the CLI through `AGENTS.md`, `--json`, `--dry-run`, and `vibe schema` are the
primary workflow.

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

VibeFrame is a video workflow CLI. Scene projects declare their composition
engine in `vibe.project.yaml`; today the supported engine is Hyperframes:

```yaml
composition:
  engine: hyperframes
  entry: index.html
```

[Hyperframes](https://github.com/heygen-com/hyperframes) provides deterministic
browser-based capture and composition primitives. VibeFrame adds CLI workflows,
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
- [MODELS.md](MODELS.md): provider/model reference
- [ROADMAP.md](ROADMAP.md): roadmap

For machine-readable access (agents, scripts) use the live introspection
hooks instead of this README:

```bash
vibe schema --list --json     # full command catalog (current count via `length`)
vibe schema --list --surface public  # small first-run/product surface
vibe schema --list --filter very-high  # narrow to a cost tier
vibe schema <command> --json  # JSON Schema for one command
vibe context                  # agent quickstart (rules, envelope shape, conventions)
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
# Scaffold a provider declaration
pnpm scaffold:provider <name>

# Scaffold a command under generate or edit
pnpm scaffold:command <generate|edit> <name>
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

## License

MIT. See [LICENSE](LICENSE).
