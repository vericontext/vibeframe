# VibeFrame Roadmap

> Active per-release detail lives in [`CHANGELOG.md`](CHANGELOG.md).
> The v0.58-era architectural pivot doc is preserved for historical
> context at [`docs/archive/ROADMAP-v0.58.md`](docs/archive/ROADMAP-v0.58.md)
> — its substance landed in v0.59 (`compose-scenes-with-skills`) and v0.60
> (`vibe build` / `vibe render` on top of the scene primitives), so it no
> longer drives active development.
>
> This file is the longer-running plan: what shipped (Phases 1-4),
> what's on the horizon (Phases 5-7).

---

## Shipped (Phases 1-3) ✅

- **Phase 1 — Foundation:** Turborepo monorepo, Zustand+Immer timeline, FFmpeg.wasm export, CLI package.
- **Phase 2 — AI Providers:** 13 providers across text/audio/image/video (OpenAI, Claude, Gemini, Grok, OpenRouter, Ollama, Whisper, ElevenLabs, Kokoro, Runway, Kling, Veo, Replicate, fal.ai). See [`MODELS.md`](MODELS.md) for the canonical list.
- **Phase 3 — MCP Integration:** `@vibeframe/mcp-server` exposes 66 tools + project state resources for Claude Desktop / Cursor / any MCP host.

---

## Phase 4 — AI-Native Editing ✅ (mostly shipped, ongoing polish)

This is where day-to-day work happens. Major capabilities all delivered through v0.58:

### BUILD-from-text (Scene authoring)
- `vibe init` / `vibe build` / `vibe render` — project-level storyboard → final video workflow
- `vibe scene ...` — lower-level primitives behind the project commands

### PROCESS existing video (`vibe remix`)
- `vibe remix highlights` / `auto-shorts` (FFmpeg + Whisper + Claude analysis)
- `vibe remix animated-caption` (6 styles across ASS fast-path and Remotion overlay)
- (`vibe pipeline` and `vibe pipe` are kept as deprecated aliases until v1.0.)

### Smart editing & inspection (`vibe edit` / `vibe inspect`)
silence-cut, jump-cut, caption, grade, reframe, speed-ramp, fade, noise-reduce, text-overlay, upscale-video, interpolate, fill-gaps, translate-srt, image edit, video review (100+ commands total).

### Voice & audio
TTS (ElevenLabs + Kokoro local fallback), voice-clone, dub, duck, music generation, sound effects, isolation.

### Scene authoring (Hyperframes-backed)
`vibe build` produces editable per-scene HTML instead of opaque intermediate
MP4s, then `vibe render` exports the final video. The lower-level
`vibe scene ...` namespace remains available for direct lint/render/add
operations. The current sample output is
[`assets/demos/sample-demo-final.mp4`](assets/demos/sample-demo-final.mp4).

### CLI UX
Aliases (`gen`, `ed`, `az`, `pipe`, …), `--describe`, `--dry-run` cost preview, `--json`/auto-JSON, `--quiet`, `--fields`, structured exit codes (0–6), provider auto-fallback, `vibe doctor`, `vibe context`, `vibe demo`, smart error hints, `--budget-usd` ceiling.

### Video as Code
`vibe run pipeline.yaml` — multi-step actions, `$step.output` references,
checkpointing, `--dry-run`/`--resume`, and budget ceilings. See
[`DEMO.md`](DEMO.md) and [`docs/cookbook.md`](docs/cookbook.md).

### Agent surface
`vibe agent` REPL (BYO LLM × 6 — Claude / OpenAI / Gemini / Grok /
OpenRouter / Ollama). MCP server bundled for typed tool-call hosts. Project
scaffolds include host guidance for Codex, Claude Code, Cursor, Aider, Gemini
CLI, OpenCode, and a universal `AGENTS.md` fallback.

### Demo & showcase
- [x] [`assets/demos/sample-demo-final.mp4`](assets/demos/sample-demo-final.mp4) — current storyboard sample with Kokoro narration, composed scenes, and Seedance motion media
- [x] [`DEMO.md`](DEMO.md) copy-paste follow-along
- [x] VHS tape recordings (`assets/demos/{cli,agent,host-agent,host-agent-i2v}.tape`) — reproducible terminal clips
- [x] `vibe init` project scaffold — authoring docs plus host guidance based on the selected profile

### Open items in Phase 4 (tracked as GitHub issues)

These were the v0.61+ candidates from earlier ROADMAP drafts. Each now has a tracking issue with current code references and acceptance criteria:

- **[#202](https://github.com/vericontext/vibeframe/issues/202)** — Multi-provider T2I in the storyboard build flow (Gemini + Grok routing; help text fix)
- **[#203](https://github.com/vericontext/vibeframe/issues/203)** — I2V backdrop integration (motion video from Runway / Kling / Veo / fal.ai instead of still + Ken-Burns)
- **[#204](https://github.com/vericontext/vibeframe/issues/204)** — `compose-scenes-with-skills` narration awareness (word-level transcript timings into compose prompt)
- **[#205](https://github.com/vericontext/vibeframe/issues/205)** — Local subject tracking (MediaPipe / YOLO / SAM-2) for `vibe edit reframe --track` — `help wanted`
- **[#206](https://github.com/vericontext/vibeframe/issues/206)** — Tracking: drop Hyperframes `workers: 1` workaround once heygen-com/hyperframes#334 ships

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
