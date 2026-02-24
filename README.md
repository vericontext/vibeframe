# VibeFrame

**AI-native video editing. CLI-first. MCP-ready.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-240%2B%20passing-brightgreen.svg)]()

> Edit videos with natural language. No timeline clicking. No export dialogs. Just tell the AI what you want.

---

## Why VibeFrame?

Traditional video editors are built for **clicking buttons**. VibeFrame is built for **AI-powered workflows**.

| Traditional Editor | VibeFrame |
|-------------------|----------|
| Import → Drag → Trim → Export | `vibe ai edit "trim intro to 3s"` |
| Manual scene detection | `vibe detect scenes video.mp4` |
| Export for each platform | `vibe ai viral project.vibe.json` |
| Click through menus | Natural language → CLI → done |

**Design Principles:** Headless First — AI-Native — MCP Compatible — Provider Agnostic

---

## Quick Start (CLI)

**Prerequisites:** Node.js 18+, FFmpeg

CLI-first. Every video edit is a command.

```bash
# Install
curl -fsSL https://vibeframe.ai/install.sh | bash

# Remove silence from an interview
vibe ai silence-cut interview.mp4 -o clean.mp4

# Add captions with auto-transcription
vibe ai caption video.mp4 -o captioned.mp4

# Create a TikTok from a script
vibe ai script-to-video "A day in the life of a developer..." -a 9:16 -o ./tiktok/

# Export to MP4
vibe export project.vibe.json -o output.mp4
```

For development:

```bash
git clone https://github.com/vericontext/vibeframe.git
cd vibeframe
pnpm install && pnpm build
```

---

## Use with Claude Code

Already have the CLI installed? Claude Code runs `vibe` commands for you — just describe what you want in natural language.

| You say | Claude Code runs |
|---------|-----------------|
| "Remove silence from interview.mp4" | `vibe ai silence-cut interview.mp4 -o clean.mp4` |
| "Extract 3 best moments from podcast.mp4" | `vibe ai highlights podcast.mp4 -c 3` |
| "Add Korean subtitles to video.mp4" | `vibe ai caption video.mp4 -o captioned.mp4` |
| "Create a TikTok from this script" | `vibe ai script-to-video "..." -a 9:16` |
| "Remove background noise" | `vibe ai noise-reduce noisy.mp4 -o clean.mp4` |
| "Make a 60-second highlight reel" | `vibe ai highlights long-video.mp4 -d 60` |

No setup needed beyond installing the CLI. Claude Code discovers and runs `vibe` commands directly.

---

## MCP Integration

Works with Claude Desktop and Cursor via MCP. No clone needed — just add to your config and restart:

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

**28 Tools** | **5 Resources** | **7 Prompts** — see [packages/mcp-server/README.md](packages/mcp-server/README.md) for details.

---

## AI Pipelines

End-to-end workflows powered by multiple AI providers (Claude + ElevenLabs + Gemini + Kling/Runway):

```bash
vibe ai script-to-video "A morning routine of a startup founder..." \
  -d 60 -a 9:16 -g kling -o startup.vibe.json

vibe ai highlights interview.mp4 -d 90 --criteria emotional
vibe ai auto-shorts podcast.mp4
vibe ai b-roll podcast.mp3 --broll-dir ./footage
vibe ai viral project.vibe.json -p tiktok,youtube-shorts,instagram-reels
```

---

## CLI Reference

Every command supports `--help`. Run `vibe ai --help` for a full list.

| Category | Commands | Examples |
|----------|----------|---------|
| **Pipelines** | `script-to-video`, `highlights`, `auto-shorts`, `b-roll`, `viral` | `vibe ai script-to-video "..." -a 9:16` |
| **Generation** | `image`, `video`, `kling`, `tts`, `sfx`, `music`, `motion`, `storyboard`, `thumbnail`, `background` | `vibe ai image "prompt" -o img.png` |
| **Image Editing** | `gemini-edit`, `sd-upscale`, `sd-remove-bg`, `sd-img2img`, `sd-replace`, `sd-outpaint` | `vibe ai gemini-edit img.png "make it blue"` |
| **Video Tools** | `video-extend`, `video-upscale`, `video-interpolate`, `fill-gaps` | `vibe ai video-upscale input.mp4` |
| **Audio Tools** | `voices`, `voice-clone`, `isolate`, `noise-reduce`, `duck`, `dub` | `vibe ai noise-reduce input.mp4` |
| **Post-Production** | `edit`, `suggest`, `grade`, `text-overlay`, `fade`, `silence-cut`, `jump-cut`, `caption`, `reframe`, `speed-ramp`, `narrate`, `review`, `regenerate-scene` | `vibe ai caption video.mp4` |
| **Analysis** | `analyze`, `gemini-video`, `transcribe`, `translate-srt`, `providers` | `vibe ai analyze video.mp4 "summarize"` |
| **Project** | `project create/info/set`, `timeline add-source/add-clip/split/trim/move/delete/list` | `vibe project create "name"` |
| **Batch** | `batch import/concat/apply-effect/remove-clips/info` | `vibe batch import project dir/` |
| **Detection** | `detect scenes/silence/beats` | `vibe detect scenes video.mp4` |
| **Export** | `export` | `vibe export project.vibe.json -o out.mp4` |
| **Agent** | `agent`, `setup` | `vibe agent -p claude` |

**56+ AI commands** across 11 providers. Every command supports `--help`.

---

## Agent Mode

For environments without Claude Code or MCP, run `vibe` for an interactive natural language session:

```bash
vibe                           # Start Agent mode (default: OpenAI)
vibe agent -p claude           # Use Claude
vibe agent -p gemini           # Use Gemini
vibe agent -p xai              # Use xAI Grok
vibe agent -p ollama           # Use local Ollama
```

58 tools across project, timeline, AI generation, media, export, batch, and filesystem. The LLM reasons, calls tools, and executes autonomously.

---

## AI Providers

> See [MODELS.md](MODELS.md) for detailed model information (SSOT).

| Category | Providers | Default |
|----------|-----------|---------|
| **Agent LLM** | OpenAI, Claude, Gemini, xAI, Ollama | GPT-4o |
| **Image** | Gemini, OpenAI, Stability | Gemini Nano Banana |
| **Video** | Kling, Runway, Veo, xAI Grok | Kling v2.5/v2.6 |
| **Audio** | ElevenLabs, Whisper | - |

**Required API Keys:** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `ELEVENLABS_API_KEY`, `RUNWAY_API_SECRET`, `KLING_API_KEY`, `XAI_API_KEY`, `STABILITY_API_KEY`

---

## Project Structure

```
vibeframe/
├── packages/
│   ├── cli/               # CLI + Agent (58 tools, 240+ tests)
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
| 2. AI Providers | Done | 11 providers integrated |
| 3. MCP Integration | Done | Claude Desktop & Cursor support |
| 4. AI Pipelines | Done | Script-to-Video, Highlights, B-Roll, Viral |
| 5. Server Infrastructure | Planned | Hybrid rendering, chunked uploads |
| 6. Collaboration | Planned | CRDT-based local-first sync |

See [ROADMAP.md](ROADMAP.md) for details.

---

## Open Core Model

**VibeFrame Core is 100% open source** (MIT License).

**VibeFrame Cloud** (coming soon) will add distributed rendering, team workspaces, hosted MCP endpoint, and a template marketplace.

> Core features will always remain free and open source.

---

## Contributing

```bash
pnpm build     # Build all packages
pnpm test      # Run tests (240+ passing)
pnpm lint      # Lint code
```

Contributions welcome — AI provider integrations, CLI improvements, docs, bug fixes & tests. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT - see [LICENSE](LICENSE)

---

<p align="center">
  <b>Built for the AI age. Ship videos, not clicks.</b>
</p>
