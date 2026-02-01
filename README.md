# VibeEdit

> AI-First Open Source Video Editor for the GenAI Era

VibeEdit is a web-based video editor that prioritizes natural language over traditional buttons and menus. Edit videos using everyday language instead of professional terminology.

## Philosophy

**"Buttons < Agents"** - Instead of clicking buttons, tell the AI what you want and it handles the editing.

## Features

- **Natural Language Editing**: Say "인트로 3초로 줄이고 마지막에 페이드아웃" or "trim intro to 3 seconds and add fadeout at the end"
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
| Timeline | 스토리보드 | Video sequence |
| Keyframe | 포인트 | Change point |
| Render | 내보내기 | Create final video |
| Layer | 겹침 | Stacking order |
| Transition | 전환 | Scene change |
| Clip | 조각 | Video piece |
| Trim | 자르기 | Cut edges |
| Aspect Ratio | 화면 비율 | YouTube/TikTok/Instagram |
| Color Grading | 분위기 | Color mood |

## Tech Stack

- **Frontend**: React 18+, TypeScript, Next.js 14
- **State Management**: Zustand
- **Styling**: Tailwind CSS, Radix UI
- **Video Processing**: WebCodecs API, FFmpeg.wasm
- **AI Integration**: Plugin-based provider system

## Project Structure

```
videocontext/
├── apps/
│   └── web/                    # Next.js web app
├── packages/
│   ├── core/                   # Core video logic
│   │   ├── timeline/           # Timeline data structures
│   │   ├── effects/            # Effect system
│   │   └── export/             # Export pipeline
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
