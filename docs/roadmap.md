# VibeEdit Roadmap

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
  - Natural language → Remotion motion graphics (`vibe ai motion`)
  - Long-form content analysis & storyboarding (`vibe ai storyboard`)
  - Timeline planning with AI suggestions

### Audio
- [x] **Whisper** - Speech-to-text, auto-subtitles (SRT/VTT export)
- [x] **ElevenLabs** - Text-to-speech (`vibe ai tts`)
- [x] **ElevenLabs** - Sound effects generation (`vibe ai sfx`)
- [x] **ElevenLabs** - Audio isolation / vocal extraction (`vibe ai isolate`)
- [x] Beat detection & silence detection (`vibe detect beats/silence`)

### Image
- [x] **DALL-E** - Thumbnail generation, image editing (`vibe ai image/thumbnail/background`)
- [x] **Stability AI** - Stable Diffusion SD3.5 (`vibe ai sd/sd-upscale/sd-img2img`)
- [x] Background removal (`vibe ai sd-remove-bg`)
- [x] Search & replace (`vibe ai sd-replace`) - AI-powered object replacement
- [x] Outpainting (`vibe ai sd-outpaint`) - Extend image canvas

### Video
- [x] Scene detection & auto-cutting (`vibe detect scenes`)
- [x] **Runway Gen-3** - Video generation (`vibe ai video`)
- [x] **Kling** - Video generation (`vibe ai kling`)
- [ ] **Pika** - Video-to-video transformation
- [ ] **HeyGen** - AI avatars, lip sync

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
- [x] **Auto Highlights** - Extract highlights from long-form content
  - FFmpeg audio extraction → Whisper transcription → Claude highlight analysis
  - Full pipeline: `vibe ai highlights <media> -o highlights.json -p project.vibe.json`
- [x] **B-Roll Matcher** - Auto-match B-roll to narration
  - Whisper transcription → Claude Vision B-roll analysis → Claude semantic matching
  - Full pipeline: `vibe ai b-roll <narration> --broll-dir ./broll -o project.vibe.json`
- [ ] Viral Optimizer - Platform-specific optimization (YouTube, TikTok, Instagram)

### Video Understanding & Generation
- [ ] Video Extend - AI-powered clip extension
- [ ] Video Inpainting - Remove objects from video
- [ ] Video Upscale - Low-res → 4K AI upscaling
- [ ] Frame Interpolation - AI slow motion

### Voice & Audio
- [ ] Voice Clone - Custom AI voice from samples
- [ ] AI Dubbing - Automatic multilingual dubbing with lip-sync
- [ ] Music Generation - Generate background music from prompts
- [ ] Audio Restoration - Noise removal, quality enhancement

### Smart Editing
- [ ] Video-to-Video - Style transfer for videos
- [ ] Object Tracking - Automatic object tracking
- [ ] Auto Reframe - Smart 16:9 → 9:16 conversion
- [ ] Natural language timeline control ("trim last 3 seconds")
- [ ] AI color grading suggestions
- [ ] Content-aware speed ramping
- [ ] AI-powered audio ducking
- [ ] Auto-generate shorts from long-form

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

## Phase 6: Sync & Collaboration 📋

Local-first with optional real-time sync.

### Local-First Foundation
- [ ] **CRDT-based state** (Yjs or Automerge)
- [ ] Offline-capable editing
- [ ] Conflict-free merge on reconnect

### Collaboration (opt-in)
- [ ] Real-time multiplayer editing (CRDT sync)
- [ ] Version history & branching
- [ ] Comments & review workflow
- [ ] Team workspaces

> **Design**: Local-first by default. Collaboration is additive, not required.

---

## Phase 7: Ecosystem & Scale 📋

### Ecosystem
- [ ] Plugin marketplace
- [ ] Template library
- [ ] Effect presets sharing
- [ ] Community AI prompts

### Developer Experience
- [ ] REST API for automation
- [ ] Webhooks for CI/CD pipelines
- [ ] SDK for custom integrations

### Enterprise
- [ ] Self-hosted deployment (Docker Compose)
- [ ] S3/GCS media storage
- [ ] Distributed rendering workers
- [ ] Usage analytics
- [ ] White-label solution

---

## CLI Status

**125 tests passing** (75 unit + 50 integration)

```
vibe project    create | info | set
vibe timeline   add-source | add-clip | add-track | add-effect | trim | list
                split | duplicate | delete | move
vibe batch      import | concat | apply-effect | remove-clips | info
vibe media      info | duration
vibe export     <project> -o <output> -p <preset>
vibe detect     scenes | silence | beats
vibe ai         providers | transcribe | suggest | edit | tts | voices | sfx | isolate
                motion | storyboard | image | thumbnail | background
                video | video-status | video-cancel
                kling | kling-status
                sd | sd-upscale | sd-remove-bg | sd-img2img | sd-replace | sd-outpaint
                script-to-video | highlights | b-roll
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
