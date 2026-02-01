# VibeEdit Roadmap

Overall project roadmap and milestone tracking.

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
  - [x] Project management (create, info, set)
  - [x] Timeline editing (add-source, add-clip, add-track, trim, list)
  - [x] Timeline operations (split, duplicate, delete, move)
  - [x] Batch operations (import, concat, apply-effect, remove-clips)
  - [x] Media info utilities (info, duration)

---

## Phase 2: AI Integration 🚧

Connect AI providers and enable natural language editing.

- [x] AI Provider interface design
- [x] Provider registry system
- [ ] Whisper integration for subtitles (API ready, UI pending)
- [ ] Gemini auto-edit suggestions (basic parser done, LLM integration pending)
- [ ] Natural language command parser (regex-based, needs LLM upgrade)
- [ ] Real-time transcription display

---

## Phase 3: Video Processing 🚧

Actual video rendering and export capabilities.

- [ ] WebCodecs API integration
- [x] FFmpeg.wasm for encoding (CLI export command)
- [ ] Real-time effect preview
- [x] Export pipeline (MP4, WebM, MOV)
- [x] Quality presets (draft, standard, high, ultra)
- [ ] Aspect ratio handling (16:9, 9:16, 1:1) - CLI only

---

## Phase 4: Advanced Features 📋

Power user features and collaboration.

- [ ] Beat sync (auto-cut to music beats)
- [ ] Scene/silence detection
- [ ] Real-time collaboration
- [ ] Template system
- [ ] Plugin marketplace
- [ ] Keyboard shortcuts customization

---

## CLI Status

**101 tests passing** (51 unit + 50 integration)

Commands available:
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

## Legend

- ✅ Completed
- 🚧 In Progress
- 📋 Planned
