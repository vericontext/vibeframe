# @vibeframe/mcp-server

MCP (Model Context Protocol) server for [VibeFrame](https://github.com/vericontext/vibeframe) - AI-native video editing.

Edit video timelines with natural language through Claude Desktop, Cursor, or any MCP client.

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

## What You Can Do

Once connected, ask your AI assistant:

> "Create a new video project called Demo"

> "Add intro.mp4 to the project and export it as output.mp4"

> "Remove silent segments from my video"

> "Add captions to my video with bold style"

> "Generate a video from this script: A sunrise over the ocean..."

> "Extract 3 highlight clips from my interview recording"

## Available Tools (28)

### Project Management (2)

| Tool | Description |
|------|-------------|
| `project_create` | Create a new `.vibe.json` project |
| `project_info` | Get project metadata |

### Timeline Operations (10)

| Tool | Description |
|------|-------------|
| `timeline_add_source` | Import media (video/audio/image) |
| `timeline_add_clip` | Add clip to timeline |
| `timeline_split_clip` | Split clip at time |
| `timeline_trim_clip` | Trim clip start/end |
| `timeline_move_clip` | Move clip to new position |
| `timeline_delete_clip` | Remove clip |
| `timeline_duplicate_clip` | Duplicate clip |
| `timeline_add_effect` | Apply effect (fade, blur, etc.) |
| `timeline_add_track` | Add video/audio track |
| `timeline_list` | List all project contents |

### Export (1)

| Tool | Description |
|------|-------------|
| `export_video` | Export project to MP4/WebM/MOV via FFmpeg |

### AI Editing (7)

| Tool | Description | API Key |
|------|-------------|---------|
| `edit_silence_cut` | Remove silent segments | None (FFmpeg) or GOOGLE (Gemini) |
| `edit_caption` | Transcribe + burn styled captions | OPENAI (Whisper) |
| `edit_fade` | Fade in/out effects | None (FFmpeg) |
| `edit_noise_reduce` | Audio/video noise removal | None (FFmpeg) |
| `edit_jump_cut` | Remove filler words | OPENAI (Whisper) |
| `edit_text_overlay` | Apply text overlays | None (FFmpeg) |
| `edit_translate_srt` | Translate SRT subtitles | ANTHROPIC or OPENAI |

### AI Analysis (4)

| Tool | Description | API Key |
|------|-------------|---------|
| `ai_analyze` | Unified media analysis (image/video/YouTube) | GOOGLE |
| `ai_gemini_video` | Video analysis with temporal understanding | GOOGLE |
| `ai_review` | AI video review + auto-fix | GOOGLE |
| `ai_thumbnail` | Extract best thumbnail frame | GOOGLE |

### AI Pipelines (4)

| Tool | Description | API Key |
|------|-------------|---------|
| `ai_script_to_video` | Full script-to-video pipeline | Multiple (varies by provider) |
| `ai_highlights` | Extract highlight clips | OPENAI+ANTHROPIC or GOOGLE |
| `ai_auto_shorts` | Generate short-form content | OPENAI+ANTHROPIC or GOOGLE |
| `ai_narrate` | Auto-generate narration | GOOGLE + ELEVENLABS |

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
| `edit_video` | Get guidance on editing a video with natural language instructions |
| `create_montage` | Create a montage from multiple clips with automatic pacing |
| `add_transitions` | Add transitions between clips in the timeline |
| `color_grade` | Apply color grading to clips |
| `generate_subtitles` | Generate subtitles from audio using AI transcription |
| `create_shorts` | Create short-form content from a longer video |
| `sync_to_music` | Sync video cuts to music beats |

## Environment Variables

| Variable | Used By | Description |
|----------|---------|-------------|
| `VIBE_PROJECT_PATH` | Resources | Default project file path |
| `OPENAI_API_KEY` | caption, jump-cut, translate-srt, highlights | Whisper + GPT |
| `ANTHROPIC_API_KEY` | translate-srt, highlights, script-to-video | Claude |
| `GOOGLE_API_KEY` | analyze, gemini-video, review, thumbnail, narrate | Gemini |
| `ELEVENLABS_API_KEY` | narrate, script-to-video | TTS |
| `RUNWAY_API_SECRET` | script-to-video | Video generation |
| `KLING_API_KEY` | script-to-video | Video generation |

## Requirements

- Node.js 18+
- FFmpeg (for export, editing, and pipeline tools)

## License

MIT
