# VibeEdit

> AI-First Open Source Video Editor for the GenAI Era

VibeEdit is a web-based video editor that prioritizes natural language over traditional buttons and menus. Edit videos using everyday language instead of professional terminology.

## Philosophy

**"Buttons < Agents"** - Instead of clicking buttons, tell the AI what you want and it handles the editing.

## Features

- **Natural Language Editing**: Say "trim intro to 3 seconds and add fadeout at the end"
- **Drag & Drop Timeline**: Intuitive timeline with multi-track support
- **Real-time Preview**: Canvas-based preview with playback controls
- **AI Provider Plugins**: Extensible architecture supporting multiple AI models
  - OpenAI Whisper (speech-to-text)
  - Google Gemini (auto-edit suggestions)
  - Runway Gen-4 (video generation)
  - Kling 2.x (video generation)

## Vibe Terminology

We use friendlier terms instead of traditional video editing jargon:

| Traditional | Vibe Term | Description |
|-------------|-----------|-------------|
| Timeline | Storyboard | Video sequence |
| Keyframe | Point | Change point |
| Render | Export | Create final video |
| Layer | Stack | Stacking order |
| Transition | Switch | Scene change |
| Clip | Piece | Video piece |
| Trim | Cut | Cut edges |
| Aspect Ratio | Screen Ratio | YouTube/TikTok/Instagram |
| Color Grading | Mood | Color mood |

## Tech Stack

- **Frontend**: React 18+, TypeScript, Next.js 14
- **State Management**: Zustand
- **Styling**: Tailwind CSS, Radix UI
- **Video Processing**: WebCodecs API, FFmpeg.wasm
- **AI Integration**: Plugin-based provider system

## Project Structure

```
vibe-edit/
├── apps/
│   └── web/                    # Next.js web app
├── packages/
│   ├── core/                   # Core video logic
│   │   ├── timeline/           # Timeline data structures
│   │   ├── effects/            # Effect system
│   │   └── export/             # Export pipeline
│   ├── cli/                    # Command-line interface
│   ├── ai-providers/           # AI plugins
│   │   ├── interface/          # Common interface
│   │   ├── whisper/            # OpenAI Whisper
│   │   ├── gemini/             # Google Gemini
│   │   ├── runway/             # Runway Gen-4
│   │   └── kling/              # Kling 2.x
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
git clone https://github.com/your-username/vibe-edit.git
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

### CLI Usage

VibeEdit includes a CLI for headless video editing operations:

```bash
pnpm vibe project create "My Video"     # Create a new project
pnpm vibe timeline add-source proj.vibe.json video.mp4
pnpm vibe timeline add-clip proj.vibe.json <source-id>
pnpm vibe timeline list proj.vibe.json  # View timeline contents
pnpm vibe ai providers                  # List AI providers
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Roadmap

### Phase 1: Foundation (MVP)
- [x] Turborepo monorepo setup
- [x] Next.js 14 app with App Router
- [x] Core timeline data structures
- [x] Basic UI components
- [x] Drag-and-drop timeline
- [x] Video preview with playback controls
- [x] Media library with upload

### Phase 2: AI Integration
- [ ] AI Provider interface implementation
- [ ] Whisper integration for subtitles
- [ ] Gemini auto-edit suggestions
- [ ] Natural language command parser

### Phase 3: Advanced Features
- [ ] Beat sync (auto-cut to music beats)
- [ ] Real-time collaboration
- [ ] Template system
- [ ] Plugin marketplace
