# VibeFrame

**AI-native video editing. CLI-first. MCP-ready.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-135%20passing-brightgreen.svg)]()

> Edit videos with natural language. No timeline clicking. No export dialogs. Just tell the AI what you want.

```bash
npm install -g @vibeframe/cli

# Create a TikTok video from a script
vibe ai script-to-video "A day in the life of a developer..." -a 9:16 -o project.vibe.json

# Extract highlights from a podcast
vibe ai highlights podcast.mp4 -d 60 -p highlights.vibe.json

# Optimize for multiple platforms at once
vibe ai viral project.vibe.json -p tiktok,youtube-shorts,instagram-reels
```

<!-- TODO: Add demo GIF here -->
<!-- ![Demo](docs/demo.gif) -->

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

### Prerequisites
- Node.js 18+
- pnpm 9+
- FFmpeg (for video processing)

### Installation

```bash
git clone https://github.com/vericontext/vibeframe.git
cd vibeframe
pnpm install
```

### Try It

```bash
# Create a project
pnpm vibe project create "My First Video" -o my-video.vibe.json

# Add a video source
pnpm vibe timeline add-source my-video.vibe.json ./intro.mp4

# List what's in the project
pnpm vibe timeline list my-video.vibe.json

# Export to MP4
pnpm vibe export my-video.vibe.json -o output.mp4
```

---

## AI Pipelines

### Script-to-Video
Generate complete videos from text using Claude + ElevenLabs + DALL-E + Runway/Kling:

```bash
vibe ai script-to-video "A morning routine of a startup founder..." \
  -d 60 \              # Target: 60 seconds
  -a 9:16 \            # Vertical for TikTok
  -g kling \           # Use Kling AI for video
  -o startup.vibe.json
```

### Auto Highlights
Extract the best moments from long-form content:

```bash
vibe ai highlights interview.mp4 \
  -d 90 \              # 90-second highlight reel
  --criteria emotional \  # Focus on emotional moments
  -p highlights.vibe.json
```

### B-Roll Matcher
Auto-match B-roll footage to narration:

```bash
vibe ai b-roll podcast.mp3 \
  --broll-dir ./footage \
  -o matched.vibe.json
```

### Viral Optimizer
Optimize for multiple platforms at once:

```bash
vibe ai viral project.vibe.json \
  -p youtube-shorts,tiktok,instagram-reels \
  -o ./viral-output
```

Output:
```
🚀 Viral Optimizer Pipeline
───────────────────────────────────────

✓ Loaded project: My Video (2:34, 5 clips)
✓ Transcribed 45 segments

Viral Potential Summary
───────────────────────────────────────
  Overall Score: 78%
  Hook Strength: 85%

  Platform Suitability:
    TikTok           ████████░░ 82%
    YouTube Shorts   ███████░░░ 75%
    Instagram Reels  ████████░░ 80%

🎬 Generated:
  ✔ youtube-shorts.vibe.json (0:58, 9:16)
  ✔ tiktok.vibe.json (0:45, 9:16)
  ✔ instagram-reels.vibe.json (0:52, 9:16)
```

---

## MCP Integration

VibeFrame works with Claude Desktop and Cursor via MCP (Model Context Protocol):

```bash
pnpm mcp  # Start MCP server
```

Then in Claude Desktop:
> "Create a new video project called 'Demo', add the intro.mp4 file, and trim it to 10 seconds"

**Available Tools:**
- `project_create`, `project_info`
- `timeline_add_source`, `timeline_add_clip`
- `timeline_split_clip`, `timeline_trim_clip`
- `timeline_move_clip`, `timeline_delete_clip`
- `timeline_duplicate_clip`, `timeline_add_effect`
- `timeline_add_track`, `timeline_list`

**Resources:**
- `vibe://project/current` - Full project state
- `vibe://project/clips` - All clips
- `vibe://project/sources` - Media sources
- `vibe://project/tracks` - Track list

---

## CLI Reference

```bash
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

# Batch
vibe batch import <project> <dir>    # Import directory
vibe batch concat <project> --all    # Concatenate clips
vibe batch apply-effect <project> fadeIn --all

# Detection (FFmpeg-based, no API needed)
vibe detect scenes <video>           # Scene detection
vibe detect silence <audio>          # Silence detection
vibe detect beats <audio>            # Beat detection

# Export
vibe export <project> -o out.mp4 -p high

# AI Commands
vibe ai providers                    # List AI providers
vibe ai transcribe <audio>           # Whisper transcription
vibe ai edit <project> "instruction" # Natural language edit
vibe ai tts "text" -o voice.mp3      # Text-to-speech
vibe ai sfx "explosion" -o sfx.mp3   # Sound effects
vibe ai image "prompt" -o img.png    # DALL-E image
vibe ai video "prompt" -o vid.mp4    # Runway Gen-3 video
vibe ai kling "prompt" -o vid.mp4    # Kling AI video
vibe ai sd "prompt" -o img.png       # Stable Diffusion

# AI Pipelines
vibe ai script-to-video <script>     # Full video from text
vibe ai highlights <media>           # Extract highlights
vibe ai b-roll <narration>           # Match B-roll
vibe ai viral <project>              # Platform optimization
```

---

## AI Providers

| Provider | Capabilities | API Key |
|----------|-------------|---------|
| **OpenAI Whisper** | Transcription | `OPENAI_API_KEY` |
| **OpenAI GPT** | Natural language commands | `OPENAI_API_KEY` |
| **DALL-E** | Image generation | `OPENAI_API_KEY` |
| **Claude** | Storyboarding, analysis | `ANTHROPIC_API_KEY` |
| **Gemini** | Auto-edit suggestions | `GOOGLE_API_KEY` |
| **ElevenLabs** | TTS, SFX, vocal isolation | `ELEVENLABS_API_KEY` |
| **Runway Gen-3** | Video generation | `RUNWAY_API_SECRET` |
| **Kling AI** | Video generation | `KLING_API_KEY` |
| **Stability AI** | SD3.5, upscale, outpaint | `STABILITY_API_KEY` |

---

## Project Structure

```
vibeframe/
├── apps/web/              # Next.js web app (preview UI)
├── packages/
│   ├── cli/               # Command-line interface (135 tests)
│   ├── core/              # Timeline data structures
│   ├── ai-providers/      # AI provider plugins
│   ├── mcp-server/        # MCP server for AI assistants
│   └── ui/                # Shared UI components
└── docs/
    ├── roadmap.md         # Development roadmap
    └── progress.md        # Changelog
```

---

## Roadmap

| Phase | Status | Description |
|-------|--------|-------------|
| 1. Foundation | ✅ | Core CLI, FFmpeg.wasm export |
| 2. AI Providers | ✅ | 9 providers integrated |
| 3. MCP Integration | ✅ | Claude Desktop & Cursor support |
| 4. AI Pipelines | ✅ | Script-to-Video, Highlights, B-Roll, Viral |
| 5. Server Infrastructure | 📋 | Hybrid rendering, chunked uploads |
| 6. Collaboration | 📋 | CRDT-based local-first sync |

See [docs/roadmap.md](docs/roadmap.md) for details.

---

## Development

```bash
pnpm dev       # Start dev server
pnpm build     # Build all packages
pnpm test      # Run tests (135 passing)
pnpm lint      # Lint code
```

---

## Contributing

Contributions welcome! Areas we'd love help with:
- New AI provider integrations
- CLI command improvements
- Documentation & examples
- Bug fixes & tests

---

## License

MIT - see [LICENSE](LICENSE)

---

<p align="center">
  <b>Built for the AI age. Ship videos, not clicks.</b>
</p>
