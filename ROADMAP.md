# VibeFrame Roadmap

**Vision**: The open-source standard for AI-native video editing.

---

## Phase 1: Foundation (MVP) ✅

Core infrastructure and basic editing capabilities.

- [x] Turborepo monorepo setup
- [x] Next.js 14 app with App Router
- [x] Core timeline data structures (Zustand + Immer)
- [x] Basic UI components (Radix UI + Tailwind)
- [x] Drag-and-drop timeline
- [x] Video preview with playback controls
- [x] Media library with upload
- [x] CLI package for headless operations
- [x] FFmpeg.wasm export pipeline (client-side, <4GB projects)

---

## Phase 2: AI Provider Integration ✅

Unified interface for AI services.

### Text / Language
- [x] Provider interface design
- [x] Provider registry system
- [x] **OpenAI GPT** - Natural language timeline commands (replaced by Agent mode)
- [x] **Gemini** - Multimodal understanding, auto-edit suggestions
- [x] **Claude** - AI-powered content creation
  - Natural language → Remotion motion graphics with auto-render & composite (`vibe generate motion --render --video`)
  - Gemini video-aware motion: analyzes base video for style/layout context before code generation
  - Long-form content analysis & storyboarding (`vibe generate storyboard`)
  - Timeline planning with AI suggestions
- [x] **Ollama** - Local LLM for natural language commands (no API key required)
  - Default: llama3.2 (2GB), also supports mistral (4GB), phi (1.6GB), tinyllama (0.6GB)
  - Offline-capable natural language timeline control

### Audio
- [x] **Whisper** - Speech-to-text, auto-subtitles (SRT/VTT export)
- [x] **ElevenLabs** - Text-to-speech (`vibe generate speech`)
- [x] **ElevenLabs** - Sound effects generation (`vibe generate sound-effect`)
- [x] **ElevenLabs** - Audio isolation / vocal extraction (`vibe audio isolate`)
- [x] **ElevenLabs** - Voice cloning (`vibe audio voice-clone`)
- [x] **Replicate MusicGen** - Music generation (`vibe generate music`)
- [x] Beat detection & silence detection (`vibe detect beats/silence`)

### Image
- [x] **OpenAI GPT Image 1.5** - Image generation (`vibe generate image --provider openai`)
- [x] **Gemini Nano Banana** - Image generation (`vibe generate image`, default provider)

### Video
- [x] Scene detection & auto-cutting (`vibe detect scenes`)
- [x] **Runway Gen-4** - Video generation (`vibe generate video`, default provider)
- [x] **Kling v2.5** - Video generation (`vibe generate video --provider kling`)
- [x] **Veo 3.1** - Video generation (`vibe generate video --provider veo`)

---

## Phase 3: MCP Integration ✅

Model Context Protocol for extensible AI workflows.

### Prerequisites
- [x] Project state schema for MCP Resource serialization
- [x] JSON-serializable state via Project class

### Implementation
- [x] MCP server implementation (`packages/mcp-server/`)
- [x] Tool definitions (28 tools: project, timeline, export, AI editing, AI analysis, AI pipelines)
- [x] Resource providers (project state, clips, sources, tracks, settings)
- [x] Prompt templates (7 prompts for common editing tasks)
- [x] Claude Desktop / Cursor configuration

**MCP interface:**
```
vibe://project/current    # Full project state
vibe://project/clips      # Clip list
vibe://project/sources    # Media sources
vibe://project/tracks     # Track list
vibe://project/settings   # Project settings

Tools: project_create, project_info, timeline_add_source,
       timeline_add_clip, timeline_split_clip, timeline_trim_clip,
       timeline_move_clip, timeline_delete_clip, timeline_duplicate_clip,
       timeline_add_effect, timeline_add_track, timeline_list

Prompts: edit_video, create_montage, add_transitions, color_grade,
         generate_subtitles, create_shorts, sync_to_music
```

---

## Phase 4: AI-Native Editing 🚧

Intelligence built into every interaction.

### Content-Aware Automation
- [x] **Script-to-Video** - Generate complete videos from text scripts
  - Claude storyboard analysis → ElevenLabs TTS → DALL-E visuals → Runway/Kling video
  - Full pipeline: `vibe pipeline script-to-video <script> -o project.vibe.json`
  - Automatic retry on video generation failures (`--retries`)
  - Individual scene regeneration: `vibe pipeline regenerate-scene <dir> --scene <n>`
- [x] **Auto Highlights** - Extract highlights from long-form content
  - FFmpeg audio extraction → Whisper transcription → Claude highlight analysis
  - Full pipeline: `vibe pipeline highlights <media> -o highlights.json -p project.vibe.json`
- [x] **B-Roll Matcher** - Auto-match B-roll to narration
  - Whisper transcription → Claude Vision B-roll analysis → Claude semantic matching
  - Full pipeline: `vibe pipeline b-roll <narration> --broll-dir ./broll -o project.vibe.json`
- [x] **Viral Optimizer** - Platform-specific optimization (YouTube, TikTok, Instagram)
  - Whisper transcription → Claude viral analysis → Platform cuts generation
  - Full pipeline: `vibe pipeline viral <project> -p youtube-shorts,tiktok -o ./viral-output`

### Video Understanding & Generation
- [x] **Gemini Video Analysis** - Summarize, Q&A, extract info (`vibe analyze video`)
- [x] **Unified Analyze** - Image/video/YouTube analysis in one command (`vibe analyze media`)
- [x] **Gemini Image Edit** - Multi-image editing (`vibe edit image`)
- [x] **Auto Narrate** - AI narration for videos (`vibe pipeline narrate`)
- [x] Video Extend - AI-powered clip extension (`vibe generate video-extend`)
- [x] ~~Video Inpainting~~ - Deprecated (requires public URL, not local files)
- [x] Video Upscale - Low-res → 4K AI upscaling (`vibe edit upscale-video`)
- [x] Frame Interpolation - AI slow motion (`vibe edit interpolate`)
- [x] Fill Gaps - AI video generation to fill timeline gaps (`vibe edit fill-gaps`)

### Voice & Audio
- [x] Voice Clone - Custom AI voice from samples (`vibe audio voice-clone`)
- [x] AI Dubbing - Automatic multilingual dubbing (`vibe audio dub`)
- [x] Music Generation - Generate background music from prompts (`vibe generate music`)
- [x] ~~Audio Restoration~~ - Deprecated (use `vibe edit noise-reduce` instead)

### Smart Editing
- [x] Audio Ducking - Auto-duck music when voice is present (`vibe audio duck`)
- [x] AI Color Grading - Style-based color grading (`vibe edit grade`)
- [x] Speed Ramping - Content-aware speed ramping (`vibe edit speed-ramp`)
- [x] Natural Language Timeline - Extended with speed/reverse/crop/position actions
- [x] Auto Reframe - Smart 16:9 → 9:16 conversion (`vibe edit reframe`)
- [x] Auto-generate Shorts - From long-form with captions (`vibe pipeline auto-shorts`)
- [x] ~~Video Style Transfer~~ - Deprecated (requires public URL, not local files)
- [x] ~~Object Tracking~~ - Deprecated (requires public URL, not local files)
- [x] Text Overlay - Auto-compose text overlays on video (`vibe edit text-overlay`)
- [x] AI Video Review - Gemini-powered quality review & auto-fix (`vibe analyze review`)
- [x] Silence Cut - Remove silent segments from video (`vibe edit silence-cut`, `--use-gemini` for smart detection)
- [x] Jump Cut - Remove filler words using Whisper word-level timestamps (`vibe edit jump-cut`)
- [x] Auto Caption - Transcribe + burn styled captions (`vibe edit caption`)
  - FFmpeg subtitles (fast path) or Remotion overlay fallback (no libass/freetype required)
- [x] Noise Reduce - FFmpeg audio/video noise removal (`vibe edit noise-reduce`)
- [x] Fade Effects - FFmpeg fade in/out for audio and video (`vibe edit fade`)
- [x] Best-Frame Thumbnail - Gemini video analysis + FFmpeg frame extract (`vibe generate thumbnail --best-frame`)
- [x] SRT Translation - Translate subtitle files via Claude/OpenAI (`vibe edit translate-srt`)

### Installation & Interactive Mode
- [x] **Install Script** - One-line installation: `curl -fsSL https://vibeframe.ai/install.sh | bash`
  - CLI-only by default (fastest), `--full` for web UI
  - `--skip-setup` to skip setup wizard
- [x] **Setup Wizard** - Interactive API key configuration (`vibe setup`)
  - Provider descriptions explaining characteristics
  - Ollama-specific guidance for local setup
  - Environment variable fallback notes
- [x] ~~**Interactive REPL**~~ (deprecated) - Legacy single-command mode
  - Replaced by Agent mode as default entry point
  - Code kept for library usage (marked `@deprecated`)
- [x] **Agent Mode (Default)** - Claude Code-like autonomous agent (`vibe` or `vibe agent`)
  - Default entry point: `vibe` starts Agent mode
  - Multi-turn agentic loop: LLM reasoning → tool call → result → repeat
  - **57 tools** across 7 categories (project, timeline, filesystem, media, AI, export, batch)
  - Multi-provider support: OpenAI, Claude, Gemini, xAI, Ollama
  - Verbose mode for tool call visibility (`-v`)
  - Confirm mode: `--confirm` prompts before each tool execution
  - Non-interactive mode: `-i "query"` for single query execution
  - Conversation memory with context management
  - **Advanced Pipeline Tools:**
    - `pipeline_script_to_video` - Full script→video pipeline via natural language
    - `pipeline_highlights` - Extract highlights from long-form content
    - `pipeline_auto_shorts` - Auto-generate vertical shorts
    - `analyze_video` - Analyze video with Gemini
    - `analyze_media` - Unified media analysis (image/video/YouTube)
- [x] **Config System** - YAML config at `~/.vibeframe/config.yaml`
- [x] **CLI Guide** - CLI reference in README.md + per-command `--help`

---

## Phase 5: Server Infrastructure 📋

Overcome browser memory limits for AI-generated content.

- [ ] **Hybrid rendering architecture**
  - FFmpeg.wasm for lightweight edits (draft preview, <4GB)
  - Server-side FFmpeg for final export & heavy AI content
- [ ] Server rendering service (Docker-based)
- [ ] Chunked upload/download for large media
- [ ] Project state persistence (Supabase/Postgres)
- [ ] **Live Link**: CLI ↔ Web UI sync via WebSocket
  - CLI commands trigger real-time UI preview updates

> **Note**: AI video outputs (Runway, Kling, etc.) require server-side processing due to file size.

---

## Phase 6: Local-First Sync 📋

Local-first editing with offline support.

- [ ] **CRDT-based state** (Yjs or Automerge)
- [ ] Offline-capable editing
- [ ] Conflict-free merge on reconnect

> **Design**: Local-first by default. Collaboration is additive, not required.

---

## Phase 7: Ecosystem 📋

- [ ] Plugin architecture
- [ ] Community templates & presets
- [ ] Effect sharing (JSON export/import)
- [ ] REST API for automation
- [ ] Webhooks for CI/CD pipelines
- [ ] SDK for custom integrations

---

## Design Principles

1. **AI-Native** - AI is not a feature, it's the foundation
2. **Open Source** - Community-driven development
3. **Headless First** - CLI/API before UI
4. **Provider Agnostic** - Swap AI providers freely
5. **MCP Compatible** - Standard protocol for AI tools
6. **Local First** - Works offline, CRDT sync when online
7. **Hybrid Rendering** - Client for preview, server for heavy lifting

---

## Technical Decisions

| Challenge | Solution |
|-----------|----------|
| Browser memory limit (~4GB) | Hybrid rendering: FFmpeg.wasm for preview, server for export |
| AI video file sizes | Server-side processing, chunked transfers |
| Local-first + Collaboration | CRDT (Yjs/Automerge) for conflict-free sync |
| MCP Resource exposure | JSON-serializable project state schema |
| CLI ↔ UI sync | WebSocket Live Link for real-time preview |

---

## Legend

- ✅ Completed
- 🚧 In Progress
- 📋 Planned
