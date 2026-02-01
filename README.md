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
- **Drag & Drop Timeline**: Intuitive timeline with multi-track support
- **Real-time Preview**: Canvas-based preview with playback controls
- **Headless CLI**: Full video editing via command line
- **AI Provider Plugins**: Extensible architecture supporting multiple AI models

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
│   │   ├── runway/             # Runway Gen-3
│   │   └── kling/              # Kling
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

# AI providers
pnpm vibe ai providers                   # List providers
pnpm vibe ai transcribe <audio>          # Transcribe with Whisper
pnpm vibe ai transcribe <audio> -o sub.srt   # Export as SRT subtitles
pnpm vibe ai edit <project> "trim to 5s"     # Natural language editing (GPT)
pnpm vibe ai suggest <project> "add fade"    # Get suggestions (Gemini)
pnpm vibe ai tts "Hello" -o voice.mp3        # Text-to-speech (ElevenLabs)

# Detection (FFmpeg-based)
pnpm vibe detect scenes <video>              # Auto-detect scene changes
pnpm vibe detect silence <audio>             # Detect silence periods
pnpm vibe detect beats <audio>               # Detect beats for music sync
```

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
- **Phase 2: Rendering Infrastructure** 📋 - Hybrid client/server rendering
- **Phase 3: AI Provider Integration** 🚧 - OpenAI, Gemini, Whisper, Runway, etc.
- **Phase 4: MCP Integration** 📋 - Model Context Protocol support
- **Phase 5: AI-Native Editing** 📋 - Natural language timeline control
- **Phase 6: Sync & Collaboration** 📋 - CRDT-based local-first sync

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](LICENSE) for details.
