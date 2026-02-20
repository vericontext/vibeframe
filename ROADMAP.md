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
- [x] **OpenAI GPT** - Natural language timeline commands (`vibe ai edit`)
- [x] **Gemini** - Multimodal understanding, auto-edit suggestions
- [x] **Claude** - AI-powered content creation
  - Natural language → Remotion motion graphics with auto-render & composite (`vibe ai motion --render --video`)
  - Long-form content analysis & storyboarding (`vibe ai storyboard`)
  - Timeline planning with AI suggestions
- [x] **Ollama** - Local LLM for natural language commands (no API key required)
  - Default: llama3.2 (2GB), also supports mistral (4GB), phi (1.6GB), tinyllama (0.6GB)
  - Offline-capable natural language timeline control

### Audio
- [x] **Whisper** - Speech-to-text, auto-subtitles (SRT/VTT export)
- [x] **ElevenLabs** - Text-to-speech (`vibe ai tts`)
- [x] **ElevenLabs** - Sound effects generation (`vibe ai sfx`)
- [x] **ElevenLabs** - Audio isolation / vocal extraction (`vibe ai isolate`)
- [x] **ElevenLabs** - Voice cloning (`vibe ai voice-clone`)
- [x] **Replicate MusicGen** - Music generation (`vibe ai music`)
- [x] Beat detection & silence detection (`vibe detect beats/silence`)

### Image
- [x] **OpenAI GPT Image 1.5** - Image generation (`vibe ai image --provider openai`)
- [x] **Gemini Nano Banana** - Image generation (`vibe ai image`, default provider)
- [x] **Stability AI** - Stable Diffusion SD3.5 (`vibe ai sd/sd-upscale/sd-img2img`)
- [x] Background removal (`vibe ai sd-remove-bg`)
- [x] Search & replace (`vibe ai sd-replace`) - AI-powered object replacement
- [x] Outpainting (`vibe ai sd-outpaint`) - Extend image canvas

### Video
- [x] Scene detection & auto-cutting (`vibe detect scenes`)
- [x] **Runway Gen-4** - Video generation (`vibe ai video`, default provider)
- [x] **Kling v2.5** - Video generation (`vibe ai video --provider kling`)
- [x] **Veo 3.1** - Video generation (`vibe ai video --provider veo`)

---

## Phase 3: MCP Integration ✅

Model Context Protocol for extensible AI workflows.

### Prerequisites
- [x] Project state schema for MCP Resource serialization
- [x] JSON-serializable state via Project class

### Implementation
- [x] MCP server implementation (`packages/mcp-server/`)
- [x] Tool definitions (12 tools for timeline, project, effects)
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
  - Full pipeline: `vibe ai script-to-video <script> -o project.vibe.json`
  - Automatic retry on video generation failures (`--retries`)
  - Individual scene regeneration: `vibe ai regenerate-scene <dir> --scene <n>`
- [x] **Auto Highlights** - Extract highlights from long-form content
  - FFmpeg audio extraction → Whisper transcription → Claude highlight analysis
  - Full pipeline: `vibe ai highlights <media> -o highlights.json -p project.vibe.json`
- [x] **B-Roll Matcher** - Auto-match B-roll to narration
  - Whisper transcription → Claude Vision B-roll analysis → Claude semantic matching
  - Full pipeline: `vibe ai b-roll <narration> --broll-dir ./broll -o project.vibe.json`
- [x] **Viral Optimizer** - Platform-specific optimization (YouTube, TikTok, Instagram)
  - Whisper transcription → Claude viral analysis → Platform cuts generation
  - Full pipeline: `vibe ai viral <project> -p youtube-shorts,tiktok -o ./viral-output`

### Video Understanding & Generation
- [x] **Gemini Video Analysis** - Summarize, Q&A, extract info (`vibe ai gemini-video`)
- [x] **Unified Analyze** - Image/video/YouTube analysis in one command (`vibe ai analyze`)
- [x] **Gemini Image Edit** - Multi-image editing (`vibe ai gemini-edit`)
- [x] **Auto Narrate** - AI narration for videos (`vibe ai narrate`)
- [x] Video Extend - AI-powered clip extension (`vibe ai video-extend`)
- [x] ~~Video Inpainting~~ - Deprecated (requires public URL, not local files)
- [x] Video Upscale - Low-res → 4K AI upscaling (`vibe ai video-upscale`)
- [x] Frame Interpolation - AI slow motion (`vibe ai video-interpolate`)
- [x] Fill Gaps - AI video generation to fill timeline gaps (`vibe ai fill-gaps`)

### Voice & Audio
- [x] Voice Clone - Custom AI voice from samples (`vibe ai voice-clone`)
- [x] AI Dubbing - Automatic multilingual dubbing (`vibe ai dub`)
- [x] Music Generation - Generate background music from prompts (`vibe ai music`)
- [x] ~~Audio Restoration~~ - Deprecated (use `vibe ai noise-reduce` instead)

### Smart Editing
- [x] Audio Ducking - Auto-duck music when voice is present (`vibe ai duck`)
- [x] AI Color Grading - Style-based color grading (`vibe ai grade`)
- [x] Speed Ramping - Content-aware speed ramping (`vibe ai speed-ramp`)
- [x] Natural Language Timeline - Extended with speed/reverse/crop/position actions
- [x] Auto Reframe - Smart 16:9 → 9:16 conversion (`vibe ai reframe`)
- [x] Auto-generate Shorts - From long-form with captions (`vibe ai auto-shorts`)
- [x] ~~Video Style Transfer~~ - Deprecated (requires public URL, not local files)
- [x] ~~Object Tracking~~ - Deprecated (requires public URL, not local files)
- [x] Text Overlay - Auto-compose text overlays on video (`vibe ai text-overlay`)
- [x] AI Video Review - Gemini-powered quality review & auto-fix (`vibe ai review`)
- [x] Silence Cut - Remove silent segments from video (`vibe ai silence-cut`, `--use-gemini` for smart detection)
- [x] Jump Cut - Remove filler words using Whisper word-level timestamps (`vibe ai jump-cut`)
- [x] Auto Caption - Transcribe + burn styled captions (`vibe ai caption`)
  - FFmpeg subtitles (fast path) or Remotion overlay fallback (no libass/freetype required)
- [x] Noise Reduce - FFmpeg audio/video noise removal (`vibe ai noise-reduce`)
- [x] Fade Effects - FFmpeg fade in/out for audio and video (`vibe ai fade`)
- [x] Best-Frame Thumbnail - Gemini video analysis + FFmpeg frame extract (`vibe ai thumbnail --best-frame`)
- [x] SRT Translation - Translate subtitle files via Claude/OpenAI (`vibe ai translate-srt`)

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
  - **58 tools** across 7 categories (project, timeline, filesystem, media, AI, export, batch)
  - Multi-provider support: OpenAI, Claude, Gemini, xAI, Ollama
  - Verbose mode for tool call visibility (`-v`)
  - Confirm mode: `--confirm` prompts before each tool execution
  - Non-interactive mode: `-i "query"` for single query execution
  - Conversation memory with context management
  - **Advanced Pipeline Tools:**
    - `ai_script_to_video` - Full script→video pipeline via natural language
    - `ai_highlights` - Extract highlights from long-form content
    - `ai_auto_shorts` - Auto-generate vertical shorts
    - `ai_gemini_video` - Analyze video with Gemini
    - `ai_analyze` - Unified media analysis (image/video/YouTube)
- [x] **Config System** - YAML config at `~/.vibeframe/config.yaml`
- [x] **CLI Guide** - Comprehensive documentation at `GUIDE.md`

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

## CLI Status

**283 unit tests passing** | **85 E2E tests** (57 Agent tools)

```
vibe                      Start Agent mode (default: OpenAI)
vibe agent -p <provider>  Start Agent with options (-p, -v, --confirm, -i)
vibe setup                Configure API keys and preferences

vibe project    create | info | set
vibe timeline   add-source | add-clip | add-track | add-effect | trim | list
                split | duplicate | delete | move
vibe batch      import | concat | apply-effect | remove-clips | info
vibe media      info | duration
vibe export     <project> -o <output> -p <preset>
vibe detect     scenes | silence | beats
vibe ai         providers | transcribe | suggest | edit | tts | voices | sfx | isolate
                motion | storyboard | image | thumbnail | background
                gemini | gemini-edit | gemini-video | analyze | narrate
                video | video-status | video-cancel
                kling | kling-status
                video-extend | video-upscale | video-interpolate | fill-gaps
                sd | sd-upscale | sd-remove-bg | sd-img2img | sd-replace | sd-outpaint
                script-to-video | regenerate-scene | highlights | b-roll | viral
                voice-clone | music | music-status | dub
                duck | grade | speed-ramp | reframe | auto-shorts
                silence-cut | jump-cut | caption
                noise-reduce | fade | translate-srt
```

### Agent Mode (Default)
```bash
# Start Agent mode
vibe                         # Default: OpenAI GPT-4o
vibe agent -p claude         # Use Claude
vibe agent -p gemini         # Use Gemini
vibe agent -p xai            # Use xAI Grok
vibe agent -p ollama         # Use local Ollama

# Natural language → autonomous tool execution
you> create a new project called "Demo"
[Tool: project_create] Created project: Demo.vibe.json

you> add intro.mp4 to the project
[Tool: timeline_add_source] Added source: source-abc123
[Tool: timeline_add_clip] Added clip: clip-xyz789

you> trim the clip to 5 seconds and add a fade in
[Tool: timeline_trim_clip] Trimmed to 5s
[Tool: timeline_add_effect] Added fadeIn effect

you> generate a thumbnail image for the video
[Tool: ai_image] Generated: thumbnail.png
```

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
