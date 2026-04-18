---
name: vibeframe
description: VibeFrame CLI — natural-language video editing, AI generation, and YAML pipelines. Invoke when the user wants to create, edit, or transform video/audio/images from the terminal.
---

# VibeFrame — The video CLI for AI agents

You are working with VibeFrame CLI (`vibe`). Video editing, generation, and post-production run as shell commands you can compose and pipe.

## Install check

```bash
vibe --version    # If missing: curl -fsSL https://vibeframe.ai/install.sh | bash
```

## Discovery

- `vibe --help` — top-level groups
- `vibe <command> --help` — per-command flags
- `vibe <command> --describe` — machine-readable input/output schema
- `vibe schema --list` — full command index (JSON)

Every command accepts `--json` (structured output), `--dry-run` (preview + cost estimate), `--stdin` (pipe input).

## Common workflows

**Image → video → narration → compose** (recommended path):

```bash
vibe gen img "neon city skyline at dusk" -o city.png
vibe gen vid "camera slowly zooms in, lights flicker" -i city.png -o city.mp4
vibe gen tts "Welcome to the future" -o voice.mp3
vibe edit compose city.mp4 voice.mp3 -o final.mp4
```

**Silence removal + captions** (no API keys needed):

```bash
vibe edit silence-cut interview.mp4 -o clean.mp4
vibe edit caption clean.mp4 -o captioned.mp4
```

**YAML pipeline** (recommended for multi-step work — see `/vibe-pipeline`):

```bash
vibe run pipeline.yaml --dry-run   # preview + cost estimate
vibe run pipeline.yaml             # execute with checkpointing
vibe run pipeline.yaml --resume    # retry from last checkpoint
```

## Command groups

- `vibe generate` — `image`, `video`, `speech`, `sound-effect`, `music`, `motion`, `storyboard`
- `vibe edit` — `silence-cut`, `jump-cut`, `caption`, `grade`, `reframe`, `speed-ramp`, `text-overlay`, `fade`, `noise-reduce`, `image`, `fill-gaps`
- `vibe analyze` — `media`, `video`, `review`, `suggest`
- `vibe audio` — `transcribe`, `isolate`, `voice-clone`, `dub`, `duck`
- `vibe pipeline` — `script-to-video`, `highlights`, `auto-shorts`, `animated-caption`
- `vibe detect` — `scenes`, `silence`, `beats`
- `vibe run` — execute YAML pipelines
- `vibe demo` — end-to-end demo (FFmpeg only, no keys)

## Provider defaults & keys

- Set API keys in `.env` or run `vibe setup`
- Providers: OpenAI, Anthropic, Gemini, xAI Grok, OpenRouter, Runway, Kling, Veo, ElevenLabs
- Override per-run: `-g <provider>` on generation commands

## Useful patterns for agents

- **Always dry-run** on multi-step or paid work: `vibe <cmd> --dry-run --json`
- **Check costs** before batch runs — dry-run output includes `costUsd`
- **Read --describe** instead of guessing flags — it emits a typed schema
- **Pipe when possible**: `vibe detect scenes video.mp4 --json | jq '.scenes'`

## When to defer to sub-skills

- Authoring YAML pipelines → `/vibe-pipeline`
- Script → narrated video → `/vibe-script-to-video`

## When NOT to use VibeFrame

- Real-time video streaming (not supported)
- Non-destructive editing with a GUI timeline (use the web editor if you need that — `/editor` route)
- Very short one-off shell work that doesn't touch video/audio/images
