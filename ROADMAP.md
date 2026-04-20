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
- [x] **xAI Grok** - Agent LLM (`vibe agent -p xai`) + Grok Imagine image/video generation
- [x] **OpenRouter** - 300+ models via unified API (`vibe agent -p openrouter`)
  - Access to Claude, GPT, Gemini, Llama, Mistral and more through one API key
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
- [x] **OpenAI GPT Image 1.5** - Image generation (`vibe gen img -p openai`)
- [x] **Gemini Nano Banana** - Image generation (`vibe gen img`, default provider)
- [x] **Grok Imagine** - Image generation (`vibe gen img -p grok`)

### Video
- [x] Scene detection & auto-cutting (`vibe detect scenes`)
- [x] **Grok Imagine Video** - Video generation with native audio (`vibe gen vid`, default provider)
- [x] **Runway Gen-4.5** - Video generation (`vibe gen vid -p runway`)
- [x] **Kling v2.5/v3** - Video generation (`vibe gen vid -p kling`)
- [x] **Veo 3.1** - Video generation (`vibe gen vid -p veo`)

---

## Phase 3: MCP Integration ✅

Model Context Protocol for extensible AI workflows.

### Prerequisites
- [x] Project state schema for MCP Resource serialization
- [x] JSON-serializable state via Project class

### Implementation
- [x] MCP server implementation (`packages/mcp-server/`)
- [x] Tool definitions (47 tools: project, timeline, export, AI editing, AI analysis, AI pipelines, AI generation, AI video, AI audio, detection)
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
- [x] **Animated Caption** - Word-by-word TikTok/Reels-style captions (`vibe pipeline animated-caption`)
  - Whisper word-level → Word grouping → ASS fast tier or Remotion animated tier
  - 6 styles: highlight, bounce, pop-in, neon (Remotion) + karaoke-sweep, typewriter (ASS)
- [x] ~~**B-Roll Matcher**~~ - Deprecated (`vibe pipeline b-roll`)
- [x] ~~**Viral Optimizer**~~ - Deprecated (`vibe pipeline viral`)

### Video Understanding & Generation
- [x] **Gemini Video Analysis** - Summarize, Q&A, extract info (`vibe analyze video`)
- [x] **Unified Analyze** - Image/video/YouTube analysis in one command (`vibe analyze media`)
- [x] **Gemini Image Edit** - Multi-image editing (`vibe edit image`)
- [x] ~~**Auto Narrate**~~ - Deprecated (`vibe pipeline narrate`)
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
- [x] ~~Object Tracking (API)~~ - Deprecated (requires public URL, not local files)
- [ ] **Real-Time Subject Tracking** - Local model-based continuous tracking (`vibe edit reframe --track`)
  - MediaPipe Face/Pose for person tracking (free, local, real-time)
  - YOLO + ByteTrack for general object tracking (free, local)
  - SAM 2 (Meta) for high-precision segmentation tracking
  - Replaces current Claude Vision keyframe approach for fast-moving subjects
  - Auto-center subject in frame for any aspect ratio conversion
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
  - Tools across 7 categories (project, timeline, filesystem, media, AI, export, batch)
  - Multi-provider support (run `vibe doctor --json` for configured providers)
  - Verbose mode for tool call visibility (`-v`)
  - Confirm mode: `--confirm` prompts before each tool execution
  - Non-interactive mode: `-i "query"` for single query execution
  - Conversation memory with context management
  - **Advanced Pipeline Tools:**
    - `pipeline_script_to_video` - Full script→video pipeline via natural language
    - `pipeline_highlights` - Extract highlights from long-form content
    - `pipeline_auto_shorts` - Auto-generate vertical shorts
    - `pipeline_animated_caption` - Animated word-by-word captions
    - `analyze_video` - Analyze video with Gemini
    - `analyze_media` - Unified media analysis (image/video/YouTube)
- [x] **Config System** - YAML config at `~/.vibeframe/config.yaml`
- [x] **CLI Guide** - CLI reference in README.md + per-command `--help`

### CLI UX Improvements
- [x] **Command Aliases** - Short aliases for all command groups (`gen`, `ed`, `az`, `au`, `pipe`) and subcommands (`img`, `vid`, `tts`, `cap`, `sc`, `s2v`, `shorts`)
- [x] **Structured Errors** - Exit codes (0-6) with machine-readable JSON errors (`ExitCode` enum, `StructuredError` interface)
- [x] **Auto-JSON** - Automatic JSON output when stdout is not a TTY (piped/scripted usage)
- [x] **`--quiet` Mode** - Output only the primary result value (path, URL, or ID)
- [x] **`--fields` Filter** - Limit JSON output to specific fields for context window discipline
- [x] **Provider Auto-Fallback** - If default provider's API key is missing, auto-select an available one
- [x] **Doctor Command** - System health check showing configured providers and available commands (`vibe doctor`)
- [x] **First-Run Banner** - Welcome banner for new users, guides to setup/doctor
- [x] **Post-Setup Suggestions** - "Try it" command suggestion after `vibe setup` based on configured providers
- [x] **Concise Error Output** - Missing argument shows brief error + "--help" hint instead of full help
- [x] **Non-TTY Prompt Bypass** - Throws error instead of hanging when prompts are used in non-interactive mode
- [x] **`--describe` Flag** - Any command + `--describe` outputs JSON schema without executing
- [x] **`vibe context`** - Print CLI guidelines for AI agent integration (`vibe context --json`)
- [x] **`vibe demo`** - Run sample edits on generated test video (no API keys needed)
- [x] **Cost Estimation** - `--dry-run` output includes estimated cost per command
- [x] **Smart Error Hints** - Pattern-matched suggestions for 429, 401, timeout, content policy, etc.
- [x] **Default Provider Settings** - `imageProvider`, `videoProvider` in `~/.vibeframe/config.yaml`
- [x] **GIF Export** - `vibe export -f gif` for animated GIF output
- [x] **Storyboard YAML** - Pipeline storyboards saved as human-editable YAML

### Video as Code
- [x] **`vibe run`** - Execute declarative YAML video pipelines (`vibe run pipeline.yaml`)
  - 20+ actions mapping to CLI execute functions
  - Variable references: `$step_id.output`, `${ENV_VAR}`
  - Checkpointing with `.pipeline-state.yaml` for resumability
  - `--dry-run` to preview plan, `--resume` to retry from failure
  - Example pipelines in `examples/`

### Claude Code Harness
- [x] **Path-Scoped Rules** - All 7 rules load on-demand via `paths:` frontmatter (no global loading)
- [x] **PostToolUse Lint Hook** - Auto-runs ESLint on edited TypeScript files
- [x] **Improved Pre-Push Hook** - Added lint check, better error messages with fix commands
- [x] **Workflow Skills** - `/test`, `/release`, `/sync-check` as user-invocable skills
- [x] **Agent Memory** - `code-reviewer` agent with persistent project memory
- [x] **Lint-Fixer Agent** - Dedicated agent for fixing ESLint errors
- [x] **Harness Documentation** - `.claude/README.md` documenting full harness structure

### Hyperframes Render Backend (experimental)
- [x] **HTML Render Pipeline** - Chrome BeginFrame → FFmpeg rendering via `@hyperframes/producer` (`vibe export --backend hyperframes`)
- [x] **Lottie Overlays** - Add `.lottie` or `.json` vector animations as timeline sources; composed via `<dotlottie-wc>` in the Chrome render (bundled runtime, no CDN dependency at render time)

### Demo & Showcase
- [ ] **Self-demo Video** - Use `pipeline script-to-video` to create VibeFrame intro video (dogfooding)
- [ ] **Terminal Recording** - VHS/asciinema recordings of CLI workflows for README
- [ ] **Output Gallery** - Static page showcasing generated images/videos with the CLI commands used
- [ ] **Interactive Web Demo** - Browser-based CLI playground (`apps/web`)

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
- [ ] **Demo UI** - Visual showcase of CLI outputs (images, videos, audio) with command reference

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
