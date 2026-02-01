# VibeEdit

> The Open-Source Standard for AI-Native Video Editing

VibeEdit is a web-based video editor that prioritizes natural language over traditional buttons and menus. Edit videos using everyday language instead of professional terminology.

## Philosophy

**"Buttons < Agents"** - Instead of clicking buttons, tell the AI what you want and it handles the editing.

## Design Principles

1. **AI-Native** - AI is not a feature, it's the foundation
2. **Open Source** - Community-driven development
3. **Headless First** - CLI/API before UI
4. **Provider Agnostic** - Swap AI providers freely
5. **MCP Compatible** - Standard protocol for AI tools
6. **Local First** - Works offline, sync when online

## Features

- **Natural Language Editing**: Say "trim intro to 3 seconds and add fadeout at the end"
- **Script-to-Video**: Generate complete videos from text scripts with AI
- **Drag & Drop Timeline**: Intuitive timeline with multi-track support
- **Real-time Preview**: Canvas-based preview with playback controls
- **Headless CLI**: Full video editing via command line
- **AI Provider Plugins**: Extensible architecture supporting multiple AI models
- **MCP Server**: Control VibeEdit from Claude Desktop or Cursor

## Tech Stack

- **Frontend**: React 18+, TypeScript, Next.js 14
- **State Management**: Zustand + Immer
- **Styling**: Tailwind CSS, Radix UI
- **Video Processing**: FFmpeg.wasm (client), FFmpeg (server)
- **AI Integration**: Plugin-based provider system
- **Testing**: Vitest (125 tests)

## Project Structure

```
vibe-edit/
├── apps/
│   └── web/                    # Next.js web app
├── packages/
│   ├── core/                   # Core video logic
│   │   └── timeline/           # Timeline data structures
│   ├── cli/                    # Command-line interface
│   ├── ai-providers/           # AI plugins
│   │   ├── whisper/            # OpenAI Whisper
│   │   ├── gemini/             # Google Gemini
│   │   ├── claude/             # Anthropic Claude
│   │   ├── openai/             # OpenAI GPT
│   │   ├── elevenlabs/         # ElevenLabs TTS/SFX
│   │   ├── dalle/              # DALL-E images
│   │   ├── stability/          # Stable Diffusion
│   │   ├── runway/             # Runway Gen-3
│   │   └── kling/              # Kling AI
│   ├── mcp-server/             # MCP server for AI assistants
│   └── ui/                     # Shared UI components
└── docs/                       # Documentation
```

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 9+

### Installation

```bash
# Clone the repository
git clone https://github.com/vericontext/vibe-edit.git
cd vibe-edit

# Install dependencies
pnpm install

# Start development server
pnpm dev
```

### Development Commands

```bash
pnpm dev          # Start development server
pnpm build        # Build for production
pnpm test         # Run tests
pnpm lint         # Run linting
pnpm format       # Format code with Prettier
```

## CLI Usage

VibeEdit includes a comprehensive CLI for headless video editing:

```bash
# Project management
pnpm vibe project create "My Video"        # Create new project
pnpm vibe project info project.vibe.json   # Show project info
pnpm vibe project set project.vibe.json    # Update settings

# Timeline editing
pnpm vibe timeline add-source <project> <media>   # Add media source
pnpm vibe timeline add-clip <project> <source-id> # Add clip
pnpm vibe timeline split <project> <clip-id> -t 4 # Split clip at 4s
pnpm vibe timeline duplicate <project> <clip-id>  # Duplicate clip
pnpm vibe timeline delete <project> <clip-id>     # Delete clip
pnpm vibe timeline move <project> <clip-id> -t 10 # Move to 10s
pnpm vibe timeline list <project>                 # List contents

# Batch operations
pnpm vibe batch import <project> ./media/         # Import directory
pnpm vibe batch concat <project> --all            # Concatenate all
pnpm vibe batch apply-effect <project> fadeIn --all
pnpm vibe batch info <project>                    # Show statistics

# Media utilities
pnpm vibe media info <file>              # Get media info
pnpm vibe media duration <file>          # Get duration (seconds)

# Export
pnpm vibe export <project> -o out.mp4 -p high    # Export video

# AI Commands
pnpm vibe ai providers                           # List providers
pnpm vibe ai transcribe <audio> -o sub.srt       # Transcribe (Whisper)
pnpm vibe ai edit <project> "trim to 5s"         # Natural language editing (GPT)
pnpm vibe ai suggest <project> "add fade"        # Get suggestions (Gemini)
pnpm vibe ai tts "Hello" -o voice.mp3            # Text-to-speech (ElevenLabs)
pnpm vibe ai sfx "explosion" -o boom.mp3         # Sound effects (ElevenLabs)
pnpm vibe ai isolate audio.mp3 -o vocals.mp3     # Vocal isolation (ElevenLabs)
pnpm vibe ai motion "logo intro" -o intro.tsx    # Motion graphics (Claude)
pnpm vibe ai storyboard "script..." -o story.json  # Storyboard (Claude)
pnpm vibe ai image "prompt" -o image.png         # Generate image (DALL-E)
pnpm vibe ai thumbnail "desc" -s youtube         # Video thumbnail (DALL-E)
pnpm vibe ai background "desc" -a 16:9           # Video background (DALL-E)
pnpm vibe ai sd "prompt" -o image.png            # Generate image (Stable Diffusion)
pnpm vibe ai sd-upscale image.png -o big.png     # Upscale image
pnpm vibe ai sd-remove-bg photo.png              # Remove background
pnpm vibe ai sd-img2img img.png "oil painting"   # Image-to-image
pnpm vibe ai sd-replace img.png "cat" "dog"      # Search & replace objects
pnpm vibe ai sd-outpaint img.png --left 512      # Extend image canvas
pnpm vibe ai video "prompt" -o video.mp4         # Generate video (Runway Gen-3)
pnpm vibe ai video "prompt" -i image.jpg         # Image-to-video (Runway)
pnpm vibe ai kling "prompt" -o video.mp4         # Generate video (Kling AI)
pnpm vibe ai kling "prompt" -i image.jpg         # Image-to-video (Kling)

# Script-to-Video (Full AI Pipeline)
pnpm vibe ai script-to-video "A day in the life..." -o project.vibe.json
pnpm vibe ai script-to-video script.txt -f -d 60 -a 9:16 -g kling

# Detection (FFmpeg-based)
pnpm vibe detect scenes <video>              # Auto-detect scene changes
pnpm vibe detect silence <audio>             # Detect silence periods
pnpm vibe detect beats <audio>               # Detect beats for music sync
```

## Script-to-Video

Generate complete videos from text scripts using a multi-provider AI pipeline:

```bash
# Basic usage
pnpm vibe ai script-to-video "A developer's morning routine..." -o project.vibe.json

# From file with options
pnpm vibe ai script-to-video script.txt -f \
  -d 60 \           # Target duration: 60 seconds
  -a 9:16 \         # Aspect ratio for TikTok/Reels
  -g kling \        # Use Kling instead of Runway
  -v <voice-id> \   # Custom ElevenLabs voice
  -o project.vibe.json

# Images only (faster iteration)
pnpm vibe ai script-to-video "..." --images-only -o test.vibe.json
```

**Pipeline:**
1. **Claude** - Analyzes script, generates storyboard with timing
2. **ElevenLabs** - Generates voiceover narration
3. **DALL-E** - Creates visual assets for each scene
4. **Runway/Kling** - Generates video clips from images
5. **Project Engine** - Assembles everything into a .vibe.json project

## MCP Server

VibeEdit includes an MCP (Model Context Protocol) server for integration with Claude Desktop and Cursor:

```bash
pnpm mcp  # Start MCP server
```

**Tools**: `project_create`, `project_info`, `timeline_add_source`, `timeline_add_clip`, `timeline_split_clip`, `timeline_trim_clip`, `timeline_move_clip`, `timeline_delete_clip`, `timeline_duplicate_clip`, `timeline_add_effect`, `timeline_add_track`, `timeline_list`

**Resources**: `vibe://project/current`, `vibe://project/clips`, `vibe://project/sources`, `vibe://project/tracks`, `vibe://project/settings`

## Vibe Terminology

We use friendlier terms instead of traditional video editing jargon:

| Traditional | Vibe Term | Description |
|-------------|-----------|-------------|
| Timeline | Storyboard | Video sequence |
| Clip | Piece | Video piece |
| Track | Stack | Stacking order |
| Keyframe | Point | Change point |
| Render | Export | Create final video |
| Transition | Switch | Scene change |
| Trim | Cut | Cut edges |

## Roadmap

See [docs/roadmap.md](docs/roadmap.md) for the full roadmap.

### Current Status

- **Phase 1: Foundation** ✅ - Core infrastructure, CLI, FFmpeg.wasm export
- **Phase 2: AI Provider Integration** ✅ - OpenAI, Gemini, Claude, Whisper, ElevenLabs, DALL-E, Stability AI, Runway, Kling
- **Phase 3: MCP Integration** ✅ - Model Context Protocol server for AI assistants
- **Phase 4: AI-Native Editing** 🚧 - Script-to-Video, Auto Highlights, Smart Editing
- **Phase 5: Server Infrastructure** 📋 - Hybrid rendering, Live Link
- **Phase 6: Sync & Collaboration** 📋 - CRDT-based local-first sync

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](LICENSE) for details.
