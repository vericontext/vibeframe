# VibeFrame

**A video CLI for agentic workflows.**

VibeFrame helps humans and AI coding agents create, edit, analyze, and render
video from the terminal. It combines FFmpeg-style editing commands, AI media
generation, storyboard-based scene composition, YAML pipelines, and an optional
MCP server for hosts that prefer tool calls over shell commands.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/vericontext/vibeframe/actions/workflows/ci.yml/badge.svg)](https://github.com/vericontext/vibeframe/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/vericontext/vibeframe)](https://github.com/vericontext/vibeframe/stargazers)

```bash
vibe init my-video
vibe build my-video
vibe render my-video -o renders/final.mp4
```

## Demo

This sample was rendered from a VibeFrame storyboard project. It uses local
Kokoro narration, authored HTML scene composition, and a Seedance
image-to-video clip mounted into the final timeline.

<p align="center">
  <video src="https://raw.githubusercontent.com/vericontext/vibeframe/main/assets/demos/sample-demo-final.mp4" controls width="800" muted></video>
</p>

For the full copy-paste walkthrough, see [DEMO.md](DEMO.md).

## What It Does

- **Edit existing video:** silence cut, captions, translation, fades, speed
  ramps, reframing, noise reduction, upscaling, and more.
- **Generate media:** images, videos, speech, music, sound effects, motion
  graphics, storyboards, and thumbnails through pluggable AI providers.
- **Build videos from storyboards:** author `STORYBOARD.md` and `DESIGN.md`,
  then run `vibe build` and `vibe render`.
- **Run YAML pipelines:** define reproducible multi-step workflows with
  dry-runs, budgets, checkpoints, and step references.
- **Work with AI agents:** every workflow is scriptable from shell, and an MCP
  server is available for typed tool-call hosts.

## Requirements

- Node.js 20+
- FFmpeg
- Chrome or Chromium for HTML scene rendering
- API keys only for the providers you use

Local/free paths are available for many editing tasks and for Kokoro TTS. AI
image/video generation requires provider keys such as `OPENAI_API_KEY`,
`FAL_KEY`, `GOOGLE_API_KEY`, or others listed in [MODELS.md](MODELS.md).

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
```

### Build A Storyboard Video

```bash
vibe init my-video --profile agent --visual-style "Swiss Pulse" -r 16:9 -d 18

# Edit my-video/STORYBOARD.md and my-video/DESIGN.md
vibe build my-video --dry-run
vibe build my-video --tts kokoro
vibe render my-video -o renders/final.mp4 --quality standard
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
is the UI. Any agent that can run shell commands can use it:

```text
"Remove silence from interview.mp4"
-> vibe edit silence-cut interview.mp4 -o clean.mp4

"Build a 20-second product video from this storyboard"
-> vibe init, edit STORYBOARD.md, vibe build, vibe render
```

`vibe init` creates project guidance files for common hosts, including Claude
Code, Codex, Cursor, Aider, Gemini CLI, OpenCode, and a universal `AGENTS.md`
fallback.

Built-in walkthroughs are available from the CLI:

```bash
vibe walkthrough
vibe walkthrough scene
vibe walkthrough pipeline
```

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
FAL_KEY
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

VibeFrame uses [Hyperframes](https://github.com/heygen-com/hyperframes) as an
HTML scene rendering backend. Hyperframes provides deterministic browser-based
capture and composition primitives. VibeFrame adds CLI workflows, provider
routing, YAML orchestration, agent guidance, media generation, and traditional
editing commands around that rendering layer.

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
docs/                    Design notes, cookbook, comparisons
```

## Useful Docs

- [docs/cli-reference.md](docs/cli-reference.md): every command, flag, and JSON envelope (auto-generated from `vibe schema --list`)
- [docs/cli-mental-model.md](docs/cli-mental-model.md): when to use which verb (`generate` / `edit` / `remix` / `inspect` / `audio` / `detect`)
- [docs/cli-architecture.md](docs/cli-architecture.md): when to pick `agent` vs `build` vs `run` (orchestrating entrypoints)
- [docs/1.0-readiness.md](docs/1.0-readiness.md): public API surface, historical breaking changes (v0.74 / v0.80 renames), 1.0 cut checklist
- [DEMO.md](DEMO.md): copy-paste demo flow
- [docs/cookbook.md](docs/cookbook.md): practical recipes
- [docs/video-project-concepts.md](docs/video-project-concepts.md): project model
- [MODELS.md](MODELS.md): provider/model reference
- [ROADMAP.md](ROADMAP.md): roadmap

For machine-readable access (agents, scripts) use the live introspection
hooks instead of this README:

```bash
vibe schema --list --json     # full command catalog (current count via `length`)
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
