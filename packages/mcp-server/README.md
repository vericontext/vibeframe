# @vibeframe/mcp-server

The MCP (Model Context Protocol) **server** for [VibeFrame](https://github.com/vericontext/vibeframe). This package is *only* the MCP adapter — it exposes VibeFrame's operations as typed MCP tools so a host (Claude Desktop, Claude Code, Cursor, …) can call them by natural language.

> **Just want a CLI?** Use [`@vibeframe/cli`](https://www.npmjs.com/package/@vibeframe/cli) instead — same operations, invoked directly in your shell as `vibe <command>`. This package and the CLI wrap the same underlying engine; pick whichever fits your workflow. Many users install both.

| Surface | Package | How you call it |
|---------|---------|-----------------|
| MCP host (Claude Desktop / Cursor / Claude Code) | `@vibeframe/mcp-server` *(this)* | host calls tool by name → `mcp__vibeframe__scene_init({...})` |
| Shell / scripts | `@vibeframe/cli` | `vibe scene init my-promo` |
| Standalone agent REPL | `@vibeframe/cli` (`vibe agent`) | natural language → CLI calls |

The tool list below is what the MCP host sees. The same operations exist as `vibe <verb> <noun>` subcommands in the CLI — see `vibe --help`.

## Quick Setup

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

### Cursor

Add to `.cursor/mcp.json`:

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

### Claude Code

```bash
claude mcp add vibeframe -- npx -y @vibeframe/mcp-server
```

## What You Can Do

Once connected, your MCP host can resolve prompts like these into typed tool calls:

> "Scaffold a 12-second Swiss-Pulse promo project, three beats, and render it"
> *→ `scene_init` + 3× `scene_add` + `scene_render`*

> "Generate a cinematic backdrop image, animate it for 5 seconds, add narration"
> *→ `generate_image` + `generate_motion` + `generate_speech`*

> "Remove silent segments and add captions to my interview"
> *→ `edit_silence_cut` + `edit_caption`*

## Available Tools (63)

Tool names are MCP-side. Your host typically prefixes them (e.g. Claude shows them as `mcp__vibeframe__scene_init`). Each one wraps the same engine call as the matching `vibe` CLI subcommand.

### Scene authoring (6) — v0.58–v0.60

| Tool | Description |
|------|-------------|
| `scene_init` | Scaffold a scene project with `STORYBOARD.md` + `DESIGN.md` |
| `scene_styles` | List the 8 vendored visual identities (Swiss Pulse, Data Drift, …) or fetch one |
| `scene_add` | Append a beat (narration + backdrop + composed HTML) |
| `scene_lint` | Validate composition HTML against the visual identity |
| `scene_render` | Deterministic Hyperframes render → MP4 |
| `scene_build` | **v0.60 one-shot**: STORYBOARD.md cues → TTS + image + compose + render → MP4 (cached, idempotent) |

### Generation (13)

| Tool | Description | Providers |
|------|-------------|-----------|
| `generate_image` | Text-to-image | OpenAI, Google, Stability |
| `generate_background` | Cinematic backdrop image (video-tuned prompt) | OpenAI |
| `generate_video` | Text/image-to-video (long-running) | Runway, Kling, FAL Seedance, Google Veo |
| `generate_video_status` / `_cancel` / `_extend` | Manage long-running video jobs | (provider-specific) |
| `generate_motion` | Animate a still image | FAL Seedance, Runway |
| `generate_speech` | Text-to-speech | ElevenLabs |
| `generate_music` | AI background music | Suno, ElevenLabs, Replicate MusicGen |
| `generate_music_status` | Poll Replicate music task | Replicate |
| `generate_sound_effect` | SFX from prompt | ElevenLabs |
| `generate_thumbnail` | AI thumbnail composition | OpenAI, Google |
| `generate_storyboard` | Multi-beat storyboard frames | OpenAI, Google |

### Editing (14)

| Tool | Description |
|------|-------------|
| `edit_silence_cut` | Remove silent segments (FFmpeg or Gemini) |
| `edit_jump_cut` | Remove filler words (Whisper) |
| `edit_caption` / `edit_animated_caption` | Burn styled / animated captions |
| `edit_text_overlay` | Static text overlay |
| `edit_fade` | Fade in/out |
| `edit_grade` | Color grading |
| `edit_speed_ramp` | Variable-speed segments |
| `edit_reframe` | Aspect-ratio reframe (e.g. 16:9 → 9:16) |
| `edit_interpolate` | Frame interpolation / slow-mo |
| `edit_upscale` | AI upscaling |
| `edit_image` | Image editing (gpt-image-2, Gemini) |
| `edit_noise_reduce` | Audio/video denoise |
| `edit_translate_srt` | Translate SRT subtitles |

### Audio (5)

| Tool | Description |
|------|-------------|
| `audio_dub` | AI voice dubbing (ElevenLabs) |
| `audio_voice_clone` | Voice clone from sample |
| `audio_isolate` | Vocal / background isolation |
| `audio_duck` | Auto-duck BGM under speech |
| `audio_transcribe` | Transcript with word-level timing (Whisper) |

### Detection (3)

| Tool | Description |
|------|-------------|
| `detect_silence` | Find silent segments |
| `detect_scenes` | Find shot boundaries |
| `detect_beats` | Find music beats |

### Analysis (4)

| Tool | Description |
|------|-------------|
| `analyze_media` | Unified image / video / YouTube analysis (Gemini) |
| `analyze_video` | Temporal video understanding (Gemini) |
| `analyze_review` | AI video review + auto-fix suggestions |
| `analyze_suggest` | Natural-language project edit suggestions (Gemini); optional auto-apply |

### Timeline (10)

| Tool | Description |
|------|-------------|
| `timeline_add_source` | Import media (video/audio/image) |
| `timeline_add_clip` / `_split_clip` / `_trim_clip` | Build & shape clips |
| `timeline_move_clip` / `_duplicate_clip` / `_delete_clip` | Arrange clips |
| `timeline_add_track` | Add video/audio track |
| `timeline_add_effect` | Apply effect (fade, blur, …) |
| `timeline_list` | List all project contents |

### Project & Export (3)

| Tool | Description |
|------|-------------|
| `project_create` / `project_info` | `.vibe.json` lifecycle |
| `export_video` | Export project to MP4/WebM/MOV via FFmpeg |

### Pipelines (4)

| Tool | Description |
|------|-------------|
| `pipeline_run` | Execute a multi-stage YAML pipeline |
| `pipeline_highlights` | Long-form → highlight clips |
| `pipeline_auto_shorts` | Long-form → vertical shorts |
| `pipeline_regenerate_scene` | Re-render a single scene against an existing storyboard.{yaml,json} |

> **CLI ↔ MCP sync**: `packages/mcp-server/src/tools/cli-sync.test.ts` is a vitest hook that fails CI when a CLI subcommand is added/removed/renamed without the matching MCP change. Open the test file to see the live mapping table — `null` rows mark known TODOs (currently `edit_fill_gaps` and `analyze_suggest`).

## Resources

| URI | Description |
|-----|-------------|
| `vibe://project/current` | Full project state |
| `vibe://project/clips` | All clips |
| `vibe://project/sources` | Media sources |
| `vibe://project/tracks` | Track list |
| `vibe://project/settings` | Project settings |

## Prompts

| Prompt | Description |
|--------|-------------|
| `edit_video` | Natural-language editing instructions |
| `create_montage` | Montage with automatic pacing |
| `add_transitions` | Add transitions between clips |
| `color_grade` | Apply color grading |
| `generate_subtitles` | Subtitles via AI transcription |
| `create_shorts` | Short-form from longer video |
| `sync_to_music` | Cut to music beats |

## Environment Variables

API keys are read from the host's environment (`~/.zshrc`, MCP config `env` block, etc.). All optional — only set the ones whose providers you use.

| Variable | Used by |
|----------|---------|
| `OPENAI_API_KEY` | gpt-image-2, Whisper, GPT |
| `ANTHROPIC_API_KEY` | Claude (translate-srt, highlights, scene_build compose pipeline) |
| `GOOGLE_API_KEY` | Gemini (analyze, review, silence-cut, narrate) |
| `ELEVENLABS_API_KEY` | TTS, voice-clone, dubbing, SFX |
| `XAI_API_KEY` | Grok |
| `FAL_KEY` | Seedance image-to-video |
| `RUNWAY_API_SECRET` | Runway video |
| `KLING_API_KEY` | Kling video |
| `VIBE_PROJECT_PATH` | Default `.vibe.json` path for resources |

## Requirements

- Node.js 20+
- FFmpeg on `PATH` (export, editing, pipelines)

## License

MIT
