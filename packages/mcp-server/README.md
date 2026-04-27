# @vibeframe/mcp-server

MCP (Model Context Protocol) server for [VibeFrame](https://github.com/vericontext/vibeframe) — AI-native video editing.

Author scenes, generate media, run pipelines, and edit timelines from any MCP host (Claude Desktop, Claude Code, Cursor, …) by natural language.

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

Once connected, ask your AI assistant:

> "Scaffold a 12-second Swiss-Pulse promo project, three beats, and render it"

> "Generate a cinematic backdrop image, animate it for 5 seconds, add narration"

> "Remove silent segments and add captions to my interview"

> "Extract three highlight clips and make a 60-second short"

## Available Tools (58)

### Scene authoring (4) — v0.58+

| Tool | Description |
|------|-------------|
| `scene_init` | Scaffold a scene project with `STORYBOARD.md` + `DESIGN.md` |
| `scene_add` | Append a beat (narration + backdrop + composed HTML) |
| `scene_lint` | Validate composition HTML against the visual identity |
| `scene_render` | Deterministic Hyperframes render → MP4 |

### Generation (11)

| Tool | Description | Providers |
|------|-------------|-----------|
| `generate_image` | Text-to-image | OpenAI, Google, Stability |
| `generate_video` | Text/image-to-video (long-running) | Runway, Kling, FAL Seedance, Google Veo |
| `generate_video_status` / `_cancel` / `_extend` | Manage long-running video jobs | (provider-specific) |
| `generate_motion` | Animate a still image | FAL Seedance, Runway |
| `generate_speech` | Text-to-speech | ElevenLabs |
| `generate_music` | AI background music | Suno, ElevenLabs |
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

### Analysis (3)

| Tool | Description |
|------|-------------|
| `analyze_media` | Unified image / video / YouTube analysis (Gemini) |
| `analyze_video` | Temporal video understanding (Gemini) |
| `analyze_review` | AI video review + auto-fix suggestions |

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

### Pipelines (5)

| Tool | Description |
|------|-------------|
| `pipeline_run` | Execute a multi-stage YAML pipeline |
| `pipeline_script_to_video` | Script → narration → video → mux |
| `pipeline_highlights` | Long-form → highlight clips |
| `pipeline_auto_shorts` | Long-form → vertical shorts |
| `pipeline_regenerate_scene` | Re-render a single scene of an existing render |

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
| `ANTHROPIC_API_KEY` | Claude (translate-srt, highlights, script-to-video) |
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
