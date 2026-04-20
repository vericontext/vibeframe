# VibeFrame

**The video CLI for AI agents.** YAML pipelines. 5 AI providers. 53 MCP tools bundled.

[![GitHub stars](https://img.shields.io/github/stars/vericontext/vibeframe)](https://github.com/vericontext/vibeframe/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/vericontext/vibeframe/actions/workflows/ci.yml/badge.svg)](https://github.com/vericontext/vibeframe/actions/workflows/ci.yml)
[![Contributors](https://img.shields.io/github/contributors/vericontext/vibeframe)](https://github.com/vericontext/vibeframe/graphs/contributors)

> Edit videos with natural language. Every edit is a command. Every workflow is scriptable.

---

## Demo

**CLI walkthrough** → https://youtu.be/EJUUpPp2d_8

**Claude Code integration** → https://youtu.be/sdf930sZ7co

---

## Why VibeFrame?

Traditional video editors are built for **clicking buttons**. VibeFrame is built for **AI-powered workflows** — a well-designed CLI that AI agents can compose, pipe, and script.

| Traditional Editor | VibeFrame |
|-------------------|----------|
| Import → Drag → Trim → Export | `vibe edit silence-cut interview.mp4 -o clean.mp4` |
| Manual scene detection | `vibe detect scenes video.mp4` |
| Export for each platform | `vibe pipeline viral project.vibe.json` |
| Click through menus | Natural language → CLI → done |

### vs other open-source video agents

| Feature | VibeFrame | [Hyperframes](https://github.com/heygen-com/hyperframes) | [OpenMontage](https://github.com/calesthio/OpenMontage) | [Remotion](https://github.com/remotion-dev/remotion) |
|---|---|---|---|---|
| CLI-first | ✅ | ✅ | ✅ | ❌ (library) |
| YAML pipelines | ✅ (`vibe run`) | partial | ✅ | ❌ |
| AI providers | **5** (OpenAI/Anthropic/Gemini/xAI/OpenRouter) | TTS + transcribe | many | ❌ |
| MCP server bundled | ✅ **53 MCP tools** | ❌ | ❌ | ❌ |
| Claude Code Skill | [planned](https://github.com/vericontext/vibeframe/issues/32) | ✅ | ❌ | ❌ |
| Render backend | FFmpeg + Remotion | HTML + Puppeteer | FFmpeg | React → Video |
| License | MIT | Apache 2.0 | AGPLv3 | MIT |

**Design Principles:** CLI-First — AI-Native — Provider Agnostic — MCP Compatible

---

## Quick Start (CLI)

**Prerequisites:** Node.js 20+, FFmpeg

CLI-first. Every video edit is a command.

```bash
# Install
curl -fsSL https://vibeframe.ai/install.sh | bash

# Remove silence from an interview
vibe edit silence-cut interview.mp4 -o clean.mp4

# Add captions with auto-transcription
vibe edit caption video.mp4 -o captioned.mp4

# Create a TikTok from a script
vibe pipeline script-to-video "A day in the life of a developer..." -a 9:16 -o ./tiktok/

# Export to MP4
vibe export project.vibe.json -o output.mp4
```

**Try without API keys** (FFmpeg only, free):

```bash
# Detect scene changes in a video
vibe detect scenes video.mp4

# Remove silence from an interview
vibe edit silence-cut interview.mp4 -o clean.mp4

# Add fade in/out effects
vibe edit fade video.mp4 -o faded.mp4 --fade-in 1 --fade-out 1

# Remove background noise
vibe edit noise-reduce video.mp4 -o clean.mp4

# Detect beats in audio
vibe detect beats music.mp3
```

For development:

```bash
git clone https://github.com/vericontext/vibeframe.git
cd vibeframe
pnpm install && pnpm build
```

### Render backends

By default, `vibe export` uses FFmpeg. Since v0.47.0, a **Hyperframes** backend is available (experimental) — renders VibeFrame timelines through a Chrome BeginFrame → FFmpeg pipeline, unlocking CSS animations. v0.50.0 adds **Lottie overlays**: add any `.lottie` source with `vibe timeline add-source project.vibe.json anim.lottie` (or `--type lottie` for `.json`) and render with `vibe export --backend hyperframes`.

```bash
# Default (FFmpeg)
vibe export project.vibe.json -o output.mp4

# Hyperframes backend (experimental — requires Chrome)
vibe export project.vibe.json -o output.mp4 --backend hyperframes

# Check Chrome detection
vibe doctor
```

Or in a YAML pipeline:

```yaml
render:
  backend: hyperframes
  fps: 30
  quality: standard
```

---

## Use with Claude Code

Already have the CLI installed? Claude Code runs `vibe` commands for you — just describe what you want in natural language.

| You say | Claude Code runs |
|---------|-----------------|
| "Remove silence from interview.mp4" | `vibe edit silence-cut interview.mp4 -o clean.mp4` |
| "Extract 3 best moments from podcast.mp4" | `vibe pipeline highlights podcast.mp4 -c 3` |
| "Add Korean subtitles to video.mp4" | `vibe edit caption video.mp4 -o captioned.mp4` |
| "Create a TikTok from this script" | `vibe pipeline script-to-video "..." -a 9:16` |
| "Remove background noise" | `vibe edit noise-reduce noisy.mp4 -o clean.mp4` |
| "Make a 60-second highlight reel" | `vibe pipeline highlights long-video.mp4 -d 60` |

No setup needed beyond installing the CLI. Claude Code discovers and runs `vibe` commands directly.

### Install as a Claude Code Skill

For richer guidance, install the Claude Code Skill pack — it adds three slash commands that walk Claude through common workflows:

```bash
# From the repo root (or any project where you want the skill active)
mkdir -p .claude/skills
curl -fsSL https://raw.githubusercontent.com/vericontext/vibeframe/main/scripts/install-skills.sh | bash
```

This registers:
- **`/vibeframe`** — overview, command groups, and common workflows
- **`/vibe-pipeline`** — YAML pipeline authoring helper (Video as Code)
- **`/vibe-script-to-video`** — guided script-to-video walkthrough

Prefer manual install? Copy [`.claude/skills/`](https://github.com/vericontext/vibeframe/tree/main/.claude/skills) from this repo into your project.

---

## MCP Integration (Claude Desktop / Cursor)

The CLI is the primary interface; MCP is the gateway for Claude Desktop & Cursor users (53 MCP tools exposed). No clone needed — add to your config and restart:

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

Config file locations:
- **Claude Desktop (macOS):** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Desktop (Windows):** `%APPDATA%\Claude\claude_desktop_config.json`
- **Cursor:** `.cursor/mcp.json` in your workspace

See [packages/mcp-server/README.md](packages/mcp-server/README.md) for full tool, resource, and prompt reference.

---

## Video as Code

Define reproducible video workflows in YAML. Each step maps to a CLI command.

```yaml
# promo.yaml
name: promo-video
steps:
  - id: backdrop
    action: generate-image
    prompt: "modern tech studio"
    output: backdrop.png
  - id: narration
    action: generate-tts
    text: "Introducing the future of video editing."
    output: voice.mp3
  - id: video
    action: generate-video
    image: $backdrop.output     # reference previous step
    prompt: "camera push in"
    output: scene.mp4
```

```bash
vibe run promo.yaml --dry-run     # preview plan + cost estimate
vibe run promo.yaml               # execute pipeline
vibe run promo.yaml --resume      # retry from last checkpoint
```

See [examples/](examples/) for ready-to-use pipeline templates.

---

## AI Pipelines

End-to-end workflows powered by multiple AI providers (Claude + ElevenLabs + Gemini + Kling/Runway):

```bash
vibe pipeline script-to-video "A morning routine of a startup founder..." \
  -d 60 -a 9:16 -g kling -o startup.vibe.json

vibe pipeline highlights interview.mp4 -d 90 --criteria emotional
vibe pipeline auto-shorts podcast.mp4
vibe pipeline animated-caption video.mp4 -s bounce -o captioned.mp4
```

Storyboards are saved as YAML for easy editing and version control.

---

## CLI Reference

Every command supports `--help`. Run `vibe --help` for a full list.

| Group | Commands | Example |
|-------|----------|---------|
| **`vibe generate`** | `image`, `video`, `speech`, `sound-effect`, `music`, `motion`, `storyboard`, `thumbnail`, `background` | `vibe generate image "prompt" -o img.png` |
| **`vibe edit`** | `silence-cut`, `jump-cut`, `caption`, `grade`, `reframe`, `speed-ramp`, `text-overlay`, `fade`, `noise-reduce`, `image`, `fill-gaps` | `vibe edit caption video.mp4 -o out.mp4` |
| **`vibe analyze`** | `media`, `video`, `review`, `suggest` | `vibe analyze media video.mp4 "summarize"` |
| **`vibe audio`** | `transcribe`, `voices`, `isolate`, `voice-clone`, `dub`, `duck` | `vibe audio transcribe audio.mp3` |
| **`vibe pipeline`** | `script-to-video`, `highlights`, `auto-shorts`, `regenerate-scene`, `animated-caption` | `vibe pipeline script-to-video "..." -a 9:16` |
| **`vibe project`** | `create`, `info`, `set` | `vibe project create "name"` |
| **`vibe timeline`** | `add-source`, `add-clip`, `split`, `trim`, `move`, `delete`, `list` | `vibe timeline add-source project file` |
| **`vibe batch`** | `import`, `concat`, `apply-effect` | `vibe batch import project dir/` |
| **`vibe detect`** | `scenes`, `silence`, `beats` | `vibe detect scenes video.mp4` |
| **`vibe export`** | - | `vibe export project.vibe.json -o out.mp4` (supports mp4, webm, gif) |
| **`vibe run`** | - | `vibe run pipeline.yaml` (Video as Code) |
| **`vibe demo`** | - | `vibe demo` (no API keys needed) |

Every command supports `--help`, `--json`, `--dry-run`, `--stdin`, and `--describe`. Run `vibe schema --list` for a full machine-readable command index.

See [Cookbook](docs/cookbook.md) for 10 practical recipes combining multiple commands.

---

## Agent Mode (Standalone)

For environments without Claude Code, Codex, or MCP — a built-in interactive session:

```bash
vibe agent                     # Start (default: OpenAI)
vibe agent -p claude           # Use Claude
vibe agent -p ollama           # Free, local, no API key
```

Best used for onboarding and quick experiments. For production workflows, use CLI commands directly or via Claude Code / MCP.

---

## AI Providers

> See [MODELS.md](MODELS.md) for detailed model information (SSOT).

| Category | Providers | Default |
|----------|-----------|---------|
| **Agent LLM** | OpenAI, Claude, Gemini, xAI, OpenRouter, Ollama | GPT-5-mini |
| **Image** | Gemini, OpenAI, xAI Grok | Gemini Nano Banana |
| **Video** | xAI Grok, Kling, Runway, Veo | Grok Imagine |
| **Audio** | ElevenLabs, Whisper | - |

**Required API Keys:** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `ELEVENLABS_API_KEY`, `RUNWAY_API_SECRET`, `KLING_API_KEY`, `XAI_API_KEY`

---

## Project Structure

```
vibeframe/
├── packages/
│   ├── cli/               # CLI + Agent mode
│   ├── core/              # Timeline engine (Zustand + Immer + FFmpeg)
│   ├── ai-providers/      # Pluggable AI providers
│   ├── mcp-server/        # MCP server (npm: @vibeframe/mcp-server)
│   └── ui/                # Shared React components
├── apps/web/              # Next.js landing & preview UI
├── MODELS.md              # AI models reference (SSOT)
└── ROADMAP.md             # Development roadmap
```

---

## Roadmap

| Phase | Status | Description |
|-------|--------|-------------|
| 1. Foundation | Done | Core CLI, FFmpeg.wasm export |
| 2. AI Providers | Done | Multi-provider integrated |
| 3. MCP Integration | Done | Claude Desktop & Cursor support |
| 4. AI Pipelines | Done | Script-to-Video, Highlights, B-Roll, Viral |
| 5. Server Infrastructure | Planned | Hybrid rendering, chunked uploads |
| 6. Collaboration | Planned | CRDT-based local-first sync |

See [ROADMAP.md](ROADMAP.md) for details.

---

## Open Core Model

**VibeFrame Core is 100% open source** (MIT License). Core features will always remain free and open source.

---

## Contributing

```bash
pnpm build     # Build all packages
pnpm test      # Run all tests
pnpm lint      # Lint code
```

Contributions welcome — AI provider integrations, CLI improvements, docs, bug fixes & tests. See [CONTRIBUTING.md](CONTRIBUTING.md).

### Contributors

<a href="https://github.com/vericontext/vibeframe/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=vericontext/vibeframe" />
</a>

---

## License

MIT - see [LICENSE](LICENSE)

---

<p align="center">
  <b>Built for the AI age. Ship videos, not clicks.</b>
</p>
