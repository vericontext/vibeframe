# VibeFrame Roadmap

> **For the *current* architectural direction, see [`docs/ROADMAP-v0.58.md`](docs/ROADMAP-v0.58.md).**
> That doc supersedes anything below for active development.
>
> This file is the longer historical and forward-looking plan: what shipped (Phases 1-4),
> what's on the horizon (Phases 5-7).
> Per-release detail lives in [`CHANGELOG.md`](CHANGELOG.md).

---

## Shipped (Phases 1-3) ✅

- **Phase 1 — Foundation:** Turborepo monorepo, Zustand+Immer timeline, FFmpeg.wasm export, CLI package.
- **Phase 2 — AI Providers:** 13 providers across text/audio/image/video (OpenAI, Claude, Gemini, Grok, OpenRouter, Ollama, Whisper, ElevenLabs, Kokoro, Runway, Kling, Veo, Replicate, fal.ai). See [`MODELS.md`](MODELS.md) for the canonical list.
- **Phase 3 — MCP Integration:** `@vibeframe/mcp-server` exposes 58 tools + project state resources for Claude Desktop / Cursor / any MCP host.

---

## Phase 4 — AI-Native Editing ✅ (mostly shipped, ongoing polish)

This is where day-to-day work happens. Major capabilities all delivered through v0.58:

### Pipelines
- `vibe pipeline script-to-video` (Claude storyboard → TTS → image → video → assemble; `--retries`, `--resume`, regenerate-scene)
- `vibe pipeline highlights` / `auto-shorts` (FFmpeg + Whisper + Claude analysis)
- `vibe pipeline animated-caption` (6 styles across ASS fast-path and Remotion overlay)

### Smart editing & analysis (`vibe edit` / `vibe analyze`)
silence-cut, jump-cut, caption, grade, reframe, speed-ramp, fade, noise-reduce, text-overlay, upscale, interpolate, fill-gaps, translate-srt, image edit, video review (84+ commands total).

### Voice & audio
TTS (ElevenLabs + Kokoro local fallback), voice-clone, dub, duck, music generation, sound effects, isolation.

### Scene authoring (Hyperframes-backed)
`vibe scene init/add/lint/render` produces editable per-scene HTML instead of opaque MP4s. v0.58 added the DESIGN.md hard-gate + 8 named visual styles. **The agent-driven craft path is now the focus** — see [`docs/ROADMAP-v0.58.md`](docs/ROADMAP-v0.58.md) for the v0.59 (`compose-scenes-with-skills`) and v0.60 (new demo MP4 + landing reorg) plan.

### CLI UX
Aliases (`gen`, `ed`, `az`, `pipe`, …), `--describe`, `--dry-run` cost preview, `--json`/auto-JSON, `--quiet`, `--fields`, structured exit codes (0–6), provider auto-fallback, `vibe doctor`, `vibe context`, `vibe demo`, smart error hints, `--budget-usd` ceiling.

### Video as Code
`vibe run pipeline.yaml` — 20+ actions, `$step.output` references, `.pipeline-state.yaml` checkpointing, `--dry-run`/`--resume`, budget ceilings. See [`examples/README.md`](examples/README.md).

### Agent surface
`vibe agent` REPL (BYO LLM × 6 — Claude / OpenAI / Gemini / Grok / OpenRouter / Ollama). MCP server bundled. Claude Code skill pack (`/vibeframe`, `/vibe-pipeline`, `/vibe-script-to-video`, `/vibe-scene`).

### Demo & showcase
- [x] Asciinema recordings (CLI / agent / Claude Code) — README hero
- [x] [`DEMO.md`](DEMO.md) three-surface follow-along
- [ ] Cinematic-finish demo MP4 — pending v0.60.0 (`compose-scenes-with-skills`)
- [ ] Output gallery / interactive web demo

### Open items in Phase 4
- **Real-Time Subject Tracking** — local MediaPipe / YOLO / SAM-2 for fast-moving subject reframing, replacing today's Claude Vision keyframe approach (`vibe edit reframe --track`).

---

## Phase 5 — Server Infrastructure 📋

Overcome browser memory limits + heavy AI content sizes.

- Hybrid rendering: FFmpeg.wasm for draft preview (<4 GB), server-side FFmpeg for final export
- Docker-based server rendering service
- Chunked upload/download for AI video outputs (Runway/Kling/Veo all produce large files)
- Project state persistence (Supabase / Postgres)
- **Live Link** — CLI ↔ Web UI sync via WebSocket so CLI commands stream real-time preview updates

---

## Phase 6 — Local-First Sync 📋

Offline-first editing with optional collaboration.

- CRDT-based state (Yjs or Automerge)
- Offline-capable editing
- Conflict-free merge on reconnect

> Design principle: local-first by default. Collaboration is additive, never required.

---

## Phase 7 — Ecosystem 📋

- Plugin architecture
- Community templates & presets
- Effect sharing (JSON export/import)
- REST API + webhooks for automation
- SDK for custom integrations

---

## Design principles

1. **AI-Native** — AI is the foundation, not a feature
2. **CLI-First** — terminal before UI; agents before humans
3. **Provider-Agnostic** — swap AI providers freely
4. **MCP Compatible** — standard protocol for AI tools
5. **Local-First** — works offline, sync when online
6. **Hybrid Rendering** — client for preview, server for heavy lifting

## Legend

✅ shipped · 🚧 in progress · 📋 planned
