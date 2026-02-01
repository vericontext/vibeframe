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

## Phase 2: Rendering Infrastructure 📋

Overcome browser memory limits for AI-generated content.

- [ ] **Hybrid rendering architecture**
  - FFmpeg.wasm for lightweight edits (draft preview, <4GB)
  - Server-side FFmpeg for final export & heavy AI content
- [ ] Server rendering service (Docker-based)
- [ ] Chunked upload/download for large media
- [ ] Project state persistence (Supabase/Postgres)
- [ ] **Live Link**: CLI ↔ Web UI sync via WebSocket
  - CLI commands trigger real-time UI preview updates

---

## Phase 3: AI Provider Integration 🚧

Unified interface for AI services.

### Text / Language
- [x] Provider interface design
- [x] Provider registry system
- [ ] **OpenAI GPT** - Natural language commands, script generation
- [ ] **Gemini** - Multimodal understanding, auto-edit suggestions
- [ ] **Claude** - Long-form content analysis, timeline planning

### Audio
- [ ] **Whisper** - Speech-to-text, auto-subtitles
- [ ] **ElevenLabs** - TTS, voice cloning, sound effects
- [ ] **Audiocraft (Meta)** - Local music generation (open source)
- [ ] Beat detection & sync

### Image
- [ ] **DALL-E** - Thumbnail generation, image editing
- [ ] **Stable Diffusion** - Local image generation
- [ ] Background removal / replacement

### Video
- [ ] **Runway Gen-3** - Video generation, inpainting
- [ ] **Kling** - Video generation
- [ ] **Pika** - Video-to-video transformation
- [ ] **HeyGen** - AI avatars, lip sync
- [ ] Scene detection & auto-cutting

> **Note**: AI video outputs are processed server-side due to file size.

---

## Phase 4: MCP Integration 📋

Model Context Protocol for extensible AI workflows.

### Prerequisites
- [ ] Project state schema for MCP Resource serialization
- [ ] Zustand → JSON-serializable state mapping

### Implementation
- [ ] MCP server implementation for VibeEdit
- [ ] Tool definitions (timeline manipulation, export, effects)
- [ ] Resource providers (project state, media assets)
- [ ] Prompt templates for common editing tasks
- [ ] Claude Desktop / Cursor integration

**Example MCP interface:**
```
vibe://resources/project/{id}/state    # Full project state
vibe://resources/project/{id}/clips    # Clip list
vibe://tools/timeline/add-clip
vibe://tools/timeline/split
vibe://tools/export
vibe://prompts/suggest-edits
```

---

## Phase 5: AI-Native Editing 📋

Intelligence built into every interaction.

- [ ] Natural language timeline control ("trim last 3 seconds")
- [ ] Auto-reframe for different aspect ratios
- [ ] Smart scene detection & chapter markers
- [ ] AI color grading suggestions
- [ ] Automatic B-roll suggestions
- [ ] Content-aware speed ramping
- [ ] AI-powered audio ducking
- [ ] Auto-generate shorts from long-form content

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

**101 tests passing** (51 unit + 50 integration)

```
vibe project    create | info | set
vibe timeline   add-source | add-clip | add-track | add-effect | trim | list
                split | duplicate | delete | move
vibe batch      import | concat | apply-effect | remove-clips | info
vibe media      info | duration
vibe export     <project> -o <output> -p <preset>
vibe ai         providers | transcribe | suggest
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
