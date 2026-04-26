# VibeFrame

**The video CLI for AI agents.** YAML pipelines. 13 AI providers. 58 MCP tools bundled.

[![GitHub stars](https://img.shields.io/github/stars/vericontext/vibeframe)](https://github.com/vericontext/vibeframe/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/vericontext/vibeframe/actions/workflows/ci.yml/badge.svg)](https://github.com/vericontext/vibeframe/actions/workflows/ci.yml)
[![Contributors](https://img.shields.io/github/contributors/vericontext/vibeframe)](https://github.com/vericontext/vibeframe/graphs/contributors)

> Edit videos with natural language. Every edit is a command. Every workflow is scriptable.

---

## Demo

VibeFrame meets you wherever you write — same 58 MCP tools, three surfaces. The
recordings below are being re-cut for v0.58; in the meantime,
**[`DEMO.md`](DEMO.md)** has a copy-pasteable follow-along for each surface that
produces a real artifact in under five minutes.

### 1. Quickstart — `vibe` CLI directly (≈90 s)

Install, scaffold a scene project, narrate with free local Kokoro TTS, render to
MP4 with synced captions.

<p align="center">
  <i>📹 Recording coming soon (v0.58 re-cut). Follow along in
  <a href="DEMO.md#1-cli-direct--vibe-quickstart">DEMO.md › 1. CLI direct</a>.</i>
</p>

### 2. Standalone agent mode — `vibe agent` (≈50 s)

Bring your own LLM (Claude / OpenAI / Gemini / Grok / OpenRouter / Ollama).
Natural language in, multi-tool execution out — no MCP host required.

<p align="center">
  <i>📹 Recording coming soon (v0.58 re-cut). Follow along in
  <a href="DEMO.md#2-standalone-agent-repl--vibe-agent">DEMO.md › 2. Standalone agent REPL</a>.</i>
</p>

### 3. Inside Claude Code / Cursor (MCP) — `@vibeframe/mcp-server`

Same tools as `vibe agent`, surfaced through MCP for any compatible host. One
JSON config block, no CLI install needed (`npx` pulls the bundle on demand).

<p align="center">
  <i>📹 Recording coming soon (v0.58 re-cut). Follow along in
  <a href="DEMO.md#3-inside-claude-code--cursor-mcp">DEMO.md › 3. Inside Claude Code / Cursor</a>.</i>
</p>

[`assets/demos/claude-code-walkthrough.md`](assets/demos/claude-code-walkthrough.md) has the original 5-prompt walkthrough plus the recording recipe.

**Older long-form videos**: [CLI walkthrough](https://youtu.be/EJUUpPp2d_8) · [Claude Code integration](https://youtu.be/sdf930sZ7co)

---

## Why VibeFrame?

Traditional video editors are built for **clicking buttons**. VibeFrame is built for **AI-powered workflows** — a well-designed CLI that AI agents can compose, pipe, and script.

| Traditional Editor | VibeFrame |
|-------------------|----------|
| Import → Drag → Trim → Export | `vibe edit silence-cut interview.mp4 -o clean.mp4` |
| Manual scene detection | `vibe detect scenes video.mp4` |
| Export for each platform | `vibe pipeline viral project.vibe.json` |
| Click through menus | Natural language → CLI → done |

### Built on Hyperframes

VibeFrame is **not** a competitor to [Hyperframes](https://github.com/heygen-com/hyperframes) — it builds on it. Hyperframes solves the hard rendering problem (Chrome BeginFrame deterministic capture, parity harness, native HDR pipeline, Studio NLE editor) and VibeFrame uses it as a render backend (`vibe export --backend hyperframes` since v0.47, `vibe scene` produces Hyperframes-compatible HTML since v0.53). The two layers are complementary:

- **Hyperframes** — HTML composition format · deterministic rendering · Studio editor · native HDR · local Kokoro TTS · local whisper-cpp transcribe · Claude Code skills
- **VibeFrame** — AI generation providers (image/video/audio) · agent integrations (MCP, REPL) · traditional editing/analysis commands · multi-stage AI pipelines

See [`docs/comparison.md`](docs/comparison.md) for a measured side-by-side of `vibe scene render` vs `npx hyperframes render` on the same project — same h264 stream both directions, +33 KB for the AAC narration track. Reproducible with [`tests/comparison/render-bench.sh`](tests/comparison/render-bench.sh).

### What VibeFrame adds on top

| Layer | Hyperframes | VibeFrame |
|---|---|---|
| **AI generation** | — | OpenAI gpt-image-2 (image default since v0.56), fal.ai Seedance 2.0 (video default since v0.57), Veo, Kling, Runway, Grok, ElevenLabs, Replicate |
| **Agent integrations** | — | MCP server (59 tools, `@vibeframe/mcp-server`) · `vibe agent` REPL (BYO LLM × 6) |
| **Traditional editing** | — | `vibe edit` silence-cut · jump-cut · caption · grade · reframe · speed-ramp · fade · noise-reduce (84+ commands total) |
| **AI analysis** | — | `vibe analyze` media/video/review/suggest (multimodal LLMs) |
| **AI pipelines** | composition format only | `vibe pipeline script-to-video` · `highlights` · `auto-shorts` · `animated-caption` |
| **Video as Code** | composition is somewhat declarative | `vibe run pipeline.yaml` · `--dry-run` cost preview · `--resume` checkpoints · step references (`$step.output`) |
| **Local Kokoro TTS** | ✅ Python `kokoro-onnx` | ✅ Node `kokoro-js` — same Kokoro-82M model, auto-fallback when no `ELEVENLABS_API_KEY` |
| **Local Whisper transcribe** | ✅ whisper-cpp (offline) | OpenAI Whisper API (cloud, word-level) |
| **Claude Code skills** | ✅ `hyperframes skills add` | ✅ ships `/vibeframe`, `/vibe-pipeline`, `/vibe-script-to-video`, `/vibe-scene` |
| **MCP server** | ❌ | ✅ 59 tools |
| **Render** | ✅ native (BeginFrame, parity, HDR, Studio NLE) | uses Hyperframes backend or FFmpeg |
| **License** | Apache 2.0 | MIT |

The short version: **if you already write HTML compositions and want them rendered well, use Hyperframes directly. If you want AI to *write* those compositions for you, edit them traditionally, surface them to Claude Code via MCP, or stitch a multi-stage AI pipeline — that's VibeFrame.**

**Design Principles:** CLI-First — AI-Native — Provider Agnostic — MCP Compatible

---

## Quick Start (CLI)

**Prerequisites:** Node.js 20+, FFmpeg

CLI-first. Every video edit is a command.

```bash
# Install
curl -fsSL https://vibeframe.ai/install.sh | bash

# Remove silence from an interview
vibe edit silence-cut interview.mp4 -o clean.mp4

# Add captions with auto-transcription
vibe edit caption video.mp4 -o captioned.mp4

# Create a TikTok from a script
vibe pipeline script-to-video "A day in the life of a developer..." -a 9:16 -o ./tiktok/

# Export to MP4
vibe export project.vibe.json -o output.mp4
```

**Try without API keys** (FFmpeg only, free):

```bash
# Detect scene changes in a video
vibe detect scenes video.mp4

# Remove silence from an interview
vibe edit silence-cut interview.mp4 -o clean.mp4

# Add fade in/out effects
vibe edit fade video.mp4 -o faded.mp4 --fade-in 1 --fade-out 1

# Remove background noise
vibe edit noise-reduce video.mp4 -o clean.mp4

# Detect beats in audio
vibe detect beats music.mp3
```

For development:

```bash
git clone https://github.com/vericontext/vibeframe.git
cd vibeframe
pnpm install && pnpm build
```

### Render backends

By default, `vibe export` uses FFmpeg. Since v0.47.0, a **Hyperframes** backend is available (experimental) — renders VibeFrame timelines through a Chrome BeginFrame → FFmpeg pipeline, unlocking CSS animations. v0.50.0 adds **Lottie overlays**: add any `.lottie` source with `vibe timeline add-source project.vibe.json anim.lottie` (or `--type lottie` for `.json`) and render with `vibe export --backend hyperframes`.

```bash
# Default (FFmpeg)
vibe export project.vibe.json -o output.mp4

# Hyperframes backend (experimental — requires Chrome)
vibe export project.vibe.json -o output.mp4 --backend hyperframes

# Check Chrome detection
vibe doctor
```

Or in a YAML pipeline:

```yaml
render:
  backend: hyperframes
  fps: 30
  quality: standard
```

---

## Use with Claude Code

Already have the CLI installed? Claude Code runs `vibe` commands for you — just describe what you want in natural language.

| You say | Claude Code runs |
|---------|-----------------|
| "Remove silence from interview.mp4" | `vibe edit silence-cut interview.mp4 -o clean.mp4` |
| "Extract 3 best moments from podcast.mp4" | `vibe pipeline highlights podcast.mp4 -c 3` |
| "Add Korean subtitles to video.mp4" | `vibe edit caption video.mp4 -o captioned.mp4` |
| "Create a TikTok from this script" | `vibe pipeline script-to-video "..." -a 9:16` |
| "Remove background noise" | `vibe edit noise-reduce noisy.mp4 -o clean.mp4` |
| "Make a 60-second highlight reel" | `vibe pipeline highlights long-video.mp4 -d 60` |

No setup needed beyond installing the CLI. Claude Code discovers and runs `vibe` commands directly.

### Install as a Claude Code Skill

For richer guidance, install the Claude Code Skill pack — it adds three slash commands that walk Claude through common workflows:

```bash
# From the repo root (or any project where you want the skill active)
mkdir -p .claude/skills
curl -fsSL https://raw.githubusercontent.com/vericontext/vibeframe/main/scripts/install-skills.sh | bash
```

This registers:
- **`/vibeframe`** — overview, command groups, and common workflows
- **`/vibe-pipeline`** — YAML pipeline authoring helper (Video as Code)
- **`/vibe-script-to-video`** — guided script-to-video walkthrough
- **`/vibe-scene`** — per-scene HTML authoring (Hyperframes-backed, editable)

Prefer manual install? Copy [`.claude/skills/`](https://github.com/vericontext/vibeframe/tree/main/.claude/skills) from this repo into your project.

---

## MCP Integration (Claude Desktop / Cursor)

The CLI is the primary interface; MCP is the gateway for Claude Desktop & Cursor users (58 MCP tools exposed). No clone needed — add to your config and restart:

```json
{
  "mcpServers": {
    "vibeframe": {
      "command": "npx",
      "args": ["-y", "@vibeframe/mcp-server"]
    }
  }
}
```

Config file locations:
- **Claude Desktop (macOS):** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Desktop (Windows):** `%APPDATA%\Claude\claude_desktop_config.json`
- **Cursor:** `.cursor/mcp.json` in your workspace

See [packages/mcp-server/README.md](packages/mcp-server/README.md) for full tool, resource, and prompt reference.

---

## Video as Code

Define reproducible video workflows in YAML. Each step maps to a CLI command.

```yaml
# promo.yaml
name: promo-video
steps:
  - id: backdrop
    action: generate-image
    prompt: "modern tech studio"
    output: backdrop.png
  - id: narration
    action: generate-tts
    text: "Introducing the future of video editing."
    output: voice.mp3
  - id: video
    action: generate-video
    image: $backdrop.output     # reference previous step
    prompt: "camera push in"
    output: scene.mp4
```

```bash
vibe run promo.yaml --dry-run     # preview plan + cost estimate
vibe run promo.yaml               # execute pipeline
vibe run promo.yaml --resume      # retry from last checkpoint
```

See [examples/](examples/) for ready-to-use pipeline templates.

---

## AI Pipelines

End-to-end workflows powered by multiple AI providers (Claude + ElevenLabs / Kokoro + OpenAI gpt-image-2 + fal Seedance 2.0 / Grok / Veo / Kling / Runway):

```bash
vibe pipeline script-to-video "A morning routine of a startup founder..." \
  -d 60 -a 9:16 -g fal -o startup.vibe.json

vibe pipeline highlights interview.mp4 -d 90 --criteria emotional
vibe pipeline auto-shorts podcast.mp4
vibe pipeline animated-caption video.mp4 -s bounce -o captioned.mp4
```

Storyboards are saved as YAML for easy editing and version control.

---

## Scene Authoring (HTML, not MP4)

Since v0.53.0, `vibe scene` produces **editable per-scene HTML** instead of
opaque MP4s. Each scene is a self-contained HTML file with scoped CSS and a
paused GSAP timeline — text tweaks don't require regenerating video.

```bash
vibe scene init my-promo -r 16:9 -d 30
vibe scene add intro --style announcement --headline "Ship videos, not clicks"
vibe scene add core  --style explainer --kicker "VIDEO AS CODE" \
                     --headline "Author scenes, not timelines"
vibe scene lint                        # in-process Hyperframes linter
vibe scene render -o promo.mp4         # requires Chrome
```

Scene projects are bilingual — they work with both `vibe` and
[`npx hyperframes`](https://github.com/heygen-com/hyperframes). To produce a
full scenes project from a written script in one shot:

```bash
vibe pipeline script-to-video "..." --format scenes -o my-promo/ -a 16:9
```

### Free local TTS + word-level caption sync (v0.54)

`vibe scene add --narration "..."` now works with **no API key**. Without
`ELEVENLABS_API_KEY`, VibeFrame falls back to **Kokoro-82M** (Apache 2.0)
running locally — first call downloads ~330MB to
`~/.cache/huggingface/hub`, then renders are free.

```bash
# Free local TTS (Kokoro)
vibe scene add hook --narration "Ship videos, not clicks." --tts kokoro

# Or use any external wav (npx hyperframes tts, macOS say, voice memo)
vibe scene add hook --narration-file ./my-voice.wav
```

Whenever audio is present and `OPENAI_API_KEY` is set, narration is
auto-transcribed (Whisper word-level) into `assets/transcript-<id>.json`
and threaded into the scene HTML. Captions then **fade in word-by-word at
the exact audio timestamp** — no more "scene says X but caption shows Y"
drift. Supported on `simple`, `explainer`, and `kinetic-type` presets.

In v0.55, `vibe scene render` adds a post-producer **ffmpeg audio mux
pass** so the rendered MP4 actually carries the narration track instead
of being silent. `-c:v copy` keeps it cheap (no video re-encode); the
render JSON reports `audioCount` + `audioMuxApplied` for agent
introspection.

Run [`examples/scene-promo/`](examples/scene-promo/) for an end-to-end
walkthrough. See `/vibe-scene` for the agent skill, including the lint
feedback loop pattern (`--json --fix`, ≤3 retries, template fallback).

---

## CLI Reference

Every command supports `--help`. Run `vibe --help` for a full list.

| Group | Commands | Example |
|-------|----------|---------|
| **`vibe generate`** | `image`, `video`, `speech`, `sound-effect`, `music`, `motion`, `storyboard`, `thumbnail`, `background` | `vibe generate image "prompt" -o img.png` |
| **`vibe edit`** | `silence-cut`, `jump-cut`, `caption`, `grade`, `reframe`, `speed-ramp`, `text-overlay`, `fade`, `noise-reduce`, `image`, `fill-gaps` | `vibe edit caption video.mp4 -o out.mp4` |
| **`vibe analyze`** | `media`, `video`, `review`, `suggest` | `vibe analyze media video.mp4 "summarize"` |
| **`vibe audio`** | `transcribe` (Whisper), `tts` (ElevenLabs · Kokoro local fallback), `voices`, `isolate`, `voice-clone`, `dub`, `duck` | `vibe audio transcribe audio.mp3` |
| **`vibe pipeline`** | `script-to-video`, `highlights`, `auto-shorts`, `regenerate-scene`, `animated-caption` | `vibe pipeline script-to-video "..." -a 9:16` |
| **`vibe scene`** | `init`, `add`, `lint`, `render` | `vibe scene add intro --style announcement --headline "..."` |
| **`vibe project`** | `create`, `info`, `set` | `vibe project create "name"` |
| **`vibe timeline`** | `add-source`, `add-clip`, `split`, `trim`, `move`, `delete`, `list` | `vibe timeline add-source project file` |
| **`vibe batch`** | `import`, `concat`, `apply-effect` | `vibe batch import project dir/` |
| **`vibe detect`** | `scenes`, `silence`, `beats` | `vibe detect scenes video.mp4` |
| **`vibe export`** | - | `vibe export project.vibe.json -o out.mp4` (supports mp4, webm, gif) |
| **`vibe run`** | - | `vibe run pipeline.yaml` (Video as Code) |
| **`vibe demo`** | - | `vibe demo` (no API keys needed) |

Every command supports `--help`, `--json`, `--dry-run`, `--stdin`, and `--describe`. Run `vibe schema --list` for a full machine-readable command index.

See [Cookbook](docs/cookbook.md) for 10 practical recipes combining multiple commands.

---

## Agent Mode (Standalone)

For environments without Claude Code, Codex, or MCP — a built-in interactive session:

```bash
vibe agent                     # Start (default: OpenAI)
vibe agent -p claude           # Use Claude
vibe agent -p ollama           # Free, local, no API key
```

Best used for onboarding and quick experiments. For production workflows, use CLI commands directly or via Claude Code / MCP.

---

## AI Providers

> See [MODELS.md](MODELS.md) for detailed model information (SSOT).

| Category | Providers | Default |
|----------|-----------|---------|
| **Agent LLM** | OpenAI, Claude, Gemini, xAI, OpenRouter, Ollama | GPT-5-mini |
| **Image** | OpenAI, Gemini, xAI Grok | OpenAI gpt-image-2 (since v0.56 — Artificial Analysis ELO #1) · Gemini fallback when no `OPENAI_API_KEY` |
| **Video** | fal.ai (Seedance 2.0), xAI Grok, Veo, Kling, Runway | fal.ai Seedance 2.0 (since v0.57 — Artificial Analysis ELO #2 on both text-to-video and image-to-video) · Grok fallback when no `FAL_KEY` |
| **TTS** | ElevenLabs, Kokoro (local) | ElevenLabs · Kokoro local fallback when no `ELEVENLABS_API_KEY` (since v0.54) |
| **Transcription** | Whisper | OpenAI Whisper (`OPENAI_API_KEY`) |

**Required API Keys:** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `ELEVENLABS_API_KEY`, `RUNWAY_API_SECRET`, `KLING_API_KEY`, `XAI_API_KEY`, `FAL_KEY`

---

## Project Structure

```
vibeframe/
├── packages/
│   ├── cli/               # CLI + Agent mode
│   ├── core/              # Timeline engine (Zustand + Immer + FFmpeg)
│   ├── ai-providers/      # Pluggable AI providers
│   ├── mcp-server/        # MCP server (npm: @vibeframe/mcp-server)
│   └── ui/                # Shared React components
├── apps/web/              # Next.js landing & preview UI
├── MODELS.md              # AI models reference (SSOT)
└── ROADMAP.md             # Development roadmap
```

---

## Roadmap

| Phase | Status | Description |
|-------|--------|-------------|
| 1. Foundation | Done | Core CLI, FFmpeg.wasm export |
| 2. AI Providers | Done | Multi-provider integrated |
| 3. MCP Integration | Done | Claude Desktop & Cursor support |
| 4. AI Pipelines | Done | Script-to-Video, Highlights, B-Roll, Viral |
| 5. Server Infrastructure | Planned | Hybrid rendering, chunked uploads |
| 6. Collaboration | Planned | CRDT-based local-first sync |

See [ROADMAP.md](ROADMAP.md) for details.

---

## Open Core Model

**VibeFrame Core is 100% open source** (MIT License). Core features will always remain free and open source.

---

## Contributing

```bash
pnpm build     # Build all packages
pnpm test      # Run all tests
pnpm lint      # Lint code
```

Contributions welcome — AI provider integrations, CLI improvements, docs, bug fixes & tests. See [CONTRIBUTING.md](CONTRIBUTING.md).

### Contributors

<a href="https://github.com/vericontext/vibeframe/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=vericontext/vibeframe" />
</a>

---

## License

MIT - see [LICENSE](LICENSE)

---

<p align="center">
  <b>Built for the AI age. Ship videos, not clicks.</b>
</p>
