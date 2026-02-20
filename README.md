# VibeFrame

**AI-native video editing. CLI-first. MCP-ready.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-283%20passing-brightgreen.svg)]()

> Edit videos with natural language. No timeline clicking. No export dialogs. Just tell the AI what you want.

```bash
# Install VibeFrame CLI
curl -fsSL https://vibeframe.ai/install.sh | bash

# Create a TikTok video from a script
vibe ai script-to-video "A day in the life of a developer with 5 scenes..." -a 9:16 -o ./tiktok/

# Extract highlights from a podcast
vibe ai highlights podcast.mp4 -d 60 -p highlights.vibe.json

# Optimize for multiple platforms at once
vibe ai viral project.vibe.json -p tiktok,youtube-shorts,instagram-reels
```

![Demo](docs/demo.gif)

---

## Why VibeFrame?

Traditional video editors are built for **clicking buttons**. VibeFrame is built for **AI agents**.

| Traditional Editor | VibeFrame |
|-------------------|----------|
| Import → Drag → Trim → Export | `vibe ai edit "trim intro to 3s"` |
| Manual scene detection | `vibe detect scenes video.mp4` |
| Export for each platform | `vibe ai viral project.vibe.json` |
| Click through menus | MCP → Claude does it for you |

**Design Principles:**
- **Headless First** - CLI/API before UI
- **AI-Native** - AI is the interface, not a feature
- **MCP Compatible** - Works with Claude Desktop & Cursor
- **Provider Agnostic** - Swap AI providers freely

---

## Quick Start

**Prerequisites:** Node.js 18+, FFmpeg

```bash
# Install & start Agent mode
curl -fsSL https://vibeframe.ai/install.sh | bash
vibe

# Or run commands directly
vibe project create "My First Video" -o my-video.vibe.json
vibe timeline add-source my-video.vibe.json ./intro.mp4
vibe export my-video.vibe.json -o output.mp4
```

For development:

```bash
git clone https://github.com/vericontext/vibeframe.git
cd vibeframe
pnpm install && pnpm build
```

---

## AI Pipelines

End-to-end workflows powered by multiple AI providers (Claude + ElevenLabs + Gemini + Kling/Runway):

```bash
# Script → storyboard → TTS → images → video
vibe ai script-to-video "A morning routine of a startup founder..." \
  -d 60 -a 9:16 -g kling -o startup.vibe.json

# Extract highlights, generate shorts, match B-roll, optimize for platforms
vibe ai highlights interview.mp4 -d 90 --criteria emotional
vibe ai auto-shorts podcast.mp4
vibe ai b-roll podcast.mp3 --broll-dir ./footage
vibe ai viral project.vibe.json -p tiktok,youtube-shorts,instagram-reels
```

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

**12 Tools** | **5 Resources** | **7 Prompts** — see [packages/mcp-server/README.md](packages/mcp-server/README.md) for details.

---

## CLI Reference

```bash
# Agent (default entry point)
vibe                                 # Start Agent mode (natural language)
vibe agent -p claude                 # Use specific LLM provider
vibe setup                           # Configure LLM provider & API keys

# Project
vibe project create <name>           # Create project
vibe project info <file>             # Show info
vibe project set <file>              # Update settings

# Timeline
vibe timeline add-source <project> <media>
vibe timeline add-clip <project> <source-id>
vibe timeline split <project> <clip-id> -t <time>
vibe timeline trim <project> <clip-id>
vibe timeline move <project> <clip-id> -t <time>
vibe timeline delete <project> <clip-id>
vibe timeline list <project>

# Media
vibe media info <file>               # Media file information
vibe media duration <file>           # Media duration in seconds

# Batch
vibe batch import <project> <dir>    # Import directory
vibe batch concat <project> --all    # Concatenate clips
vibe batch apply-effect <project> fadeIn --all
vibe batch remove-clips <project>    # Remove multiple clips
vibe batch info <project>            # Batch processing stats

# Detection (FFmpeg-based, no API needed)
vibe detect scenes <video>           # Scene detection
vibe detect silence <audio>          # Silence detection
vibe detect beats <audio>            # Beat detection

# Export
vibe export <project> -o out.mp4 -p high

# AI — Generation
vibe ai image "prompt" -o img.png    # Image (Gemini default, -p openai/stability)
vibe ai gemini "prompt" -o img.png   # Image (Gemini Nano Banana)
vibe ai sd "prompt" -o img.png       # Image (Stable Diffusion)
vibe ai video "prompt" -o vid.mp4    # Video (Kling default, -p runway/veo)
vibe ai kling "prompt" -o vid.mp4    # Video (Kling AI)
vibe ai tts "text" -o voice.mp3      # Text-to-speech (ElevenLabs)
vibe ai sfx "explosion" -o sfx.mp3   # Sound effects (ElevenLabs)
vibe ai music "prompt" -o bgm.mp3    # Music generation (Replicate)
vibe ai motion "description"         # Motion graphics (Remotion, --render --video)
vibe ai storyboard "content"         # Script → storyboard (Claude)
vibe ai thumbnail "description"      # Generate thumbnail (DALL-E / --best-frame via Gemini)
vibe ai background "description"     # Generate background (DALL-E)

# AI — Image Editing
vibe ai gemini-edit img.png "edit"   # Multi-image editing (Gemini)
vibe ai sd-upscale <image>           # Upscale image (Stability)
vibe ai sd-remove-bg <image>         # Remove background (Stability)
vibe ai sd-img2img <image> "prompt"  # Image-to-image (Stability)
vibe ai sd-replace <img> <s> <r>     # Search & replace objects (Stability)
vibe ai sd-outpaint <image>          # Extend image canvas (Stability)

# AI — Video Tools
vibe ai video-extend <video-id>      # Extend video duration (Kling)
vibe ai video-upscale <video>        # Upscale video resolution (FFmpeg)
vibe ai video-interpolate <video>    # Slow motion / frame interpolation
vibe ai fill-gaps <project>          # Fill timeline gaps with AI video

# AI — Audio Tools
vibe ai voices                       # List ElevenLabs voices
vibe ai voice-clone [samples...]     # Clone voice (ElevenLabs)
vibe ai isolate <audio>              # Isolate vocals
vibe ai noise-reduce <media>         # Remove noise (FFmpeg)
vibe ai duck <music>                 # Auto-duck music under voice
vibe ai dub <media>                  # Dub to another language

# AI — Video Post-Production
vibe ai edit <project> "instruction" # Natural language edit
vibe ai suggest <project> "query"    # AI edit suggestions (Gemini)
vibe ai grade <video>                # AI color grading (Claude + FFmpeg)
vibe ai text-overlay <video>         # Text overlays (FFmpeg drawtext)
vibe ai fade <video>                 # Fade in/out effects (FFmpeg)
vibe ai silence-cut <video>          # Remove silent segments (FFmpeg)
vibe ai jump-cut <video>             # Remove filler words (Whisper + FFmpeg)
vibe ai caption <video>              # Transcribe + burn styled captions
vibe ai reframe <video>              # Auto-reframe aspect ratio
vibe ai speed-ramp <video>           # Content-aware speed ramping
vibe ai narrate <input>              # AI narration for video
vibe ai review <video>               # AI video review & auto-fix (Gemini)
vibe ai regenerate-scene <dir>       # Regenerate scene in project

# AI — Pipelines
vibe ai script-to-video <script>     # Full video from text
vibe ai highlights <media>           # Extract highlights
vibe ai auto-shorts <video>          # Auto-generate shorts
vibe ai b-roll <narration>           # Match B-roll to narration
vibe ai viral <project>              # Platform optimization

# AI — Analysis & Status
vibe ai providers                    # List AI providers
vibe ai transcribe <audio>           # Whisper transcription
vibe ai translate-srt <file>         # Translate SRT subtitles (Claude/OpenAI)
vibe ai analyze <source> "prompt"     # Unified analysis (image/video/YouTube)
vibe ai gemini-video <source> "q"    # Video analysis (Gemini)
vibe ai video-status <task-id>       # Check Runway status
vibe ai video-cancel <task-id>       # Cancel Runway generation
vibe ai kling-status <task-id>       # Check Kling status
vibe ai music-status <task-id>       # Check music generation status
```

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
├── README.md              # Quick start (CLI + MCP)
├── GUIDE.md               # CLI usage guide
├── ROADMAP.md             # Development roadmap
├── MODELS.md              # AI models reference (SSOT)
├── apps/web/              # Next.js web app (preview UI)
├── packages/
│   ├── cli/               # Command-line interface (283 tests, 58 tools)
│   ├── core/              # Timeline data structures
│   ├── ai-providers/      # AI provider plugins
│   ├── mcp-server/        # MCP server (npm: @vibeframe/mcp-server)
│   └── ui/                # Shared UI components
└── docs/                  # Media assets (demo.gif)
```

---

## Roadmap

| Phase | Status | Description |
|-------|--------|-------------|
| 1. Foundation | ✅ | Core CLI, FFmpeg.wasm export |
| 2. AI Providers | ✅ | 11 providers integrated |
| 3. MCP Integration | ✅ | Claude Desktop & Cursor support |
| 4. AI Pipelines | ✅ | Script-to-Video, Highlights, B-Roll, Viral |
| 5. Server Infrastructure | 📋 | Hybrid rendering, chunked uploads |
| 6. Collaboration | 📋 | CRDT-based local-first sync |

See [ROADMAP.md](ROADMAP.md) for details.

---

## Open Core Model

**VibeFrame Core is 100% open source** (MIT License).

For teams and production workloads, **VibeFrame Cloud** (coming soon) will offer:
- 🚀 **Distributed Rendering** - Auto-scaling render queues, no memory limits
- 👥 **Team Workspaces** - Real-time collaboration, version history, comments
- 🌐 **Hosted MCP Endpoint** - Connect Claude/Cursor without local setup
- 📦 **Template Marketplace** - Premium templates and AI presets

> Core features will always remain free and open source.

---

## Contributing

```bash
pnpm dev       # Start dev server
pnpm build     # Build all packages
pnpm test      # Run tests (283 passing)
pnpm lint      # Lint code
```

Contributions welcome — AI provider integrations, CLI improvements, docs, bug fixes & tests.

---

## License

MIT - see [LICENSE](LICENSE)

---

<p align="center">
  <b>Built for the AI age. Ship videos, not clicks.</b>
</p>
