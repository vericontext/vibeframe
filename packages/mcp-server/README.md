# @vibeframe/mcp-server

The MCP (Model Context Protocol) **server** for [VibeFrame](https://github.com/vericontext/vibeframe). This package is *only* the MCP adapter — it exposes VibeFrame's operations as typed MCP tools so an MCP-capable host can call them by natural language.

VibeFrame is CLI-first, not terminal-only. The CLI is the stable runtime; MCP is the app-host surface for clients that prefer typed tools over shell commands.

Confirmed MCP hosts today: **Claude Desktop**, **Cursor**, and **Claude Code**. Codex can drive `vibe` natively via shell + `AGENTS.md`, and can also load a project-scoped MCP server through `.codex/config.toml`. For other shell-capable hosts, use [`@vibeframe/cli`](https://www.npmjs.com/package/@vibeframe/cli) directly — same operations.

> **Just want a CLI?** Use [`@vibeframe/cli`](https://www.npmjs.com/package/@vibeframe/cli) instead — same operations, invoked directly in your shell as `vibe <command>`. This package and the CLI wrap the same underlying engine; pick whichever fits your workflow. Many users install both.

| Surface | Package | How you call it |
|---------|---------|-----------------|
| MCP host (Claude Desktop / Cursor / OpenCode / Claude Code) | `@vibeframe/mcp-server` *(this)* | host calls tool by name, for example `mcp__vibeframe__build({...})` |
| Shell / scripts (any agent host: Codex / Aider / Gemini CLI / etc.) | `@vibeframe/cli` | `vibe init my-video && vibe build my-video && vibe render my-video` |
| Optional standalone agent REPL | `@vibeframe/cli` (`vibe agent`) | natural language -> CLI calls when you do not already use Claude Code/Codex/Cursor/etc. |

The tool list below is what the MCP host sees. The same operations exist as `vibe <verb> <noun>` subcommands in the CLI — see `vibe --help`.

## Quick Setup

The easiest way to generate the right snippet is:

```bash
vibe host setup codex
vibe host setup claude
vibe host setup cursor
vibe host doctor all
```

`vibe host setup` prints snippets by default. Add `--write` to merge the config
into the relevant project/app file.

### Codex

Add to `.codex/config.toml`:

```toml
[mcp_servers.vibeframe]
command = "npx"
args = ["-y", "@vibeframe/mcp-server"]
enabled = true
```

### Claude Desktop (recommended: extension)

Install the prebuilt Desktop Extension — no Node, npx, or JSON editing needed:

1. Download the extension: [vibeframe.mcpb (always latest)](https://github.com/vericontext/vibeframe/releases/latest/download/vibeframe.mcpb)
   — or pick a specific version from the [releases page](https://github.com/vericontext/vibeframe/releases).
2. In Claude Desktop open **Settings → Extensions** and drag the `.mcpb` file in
   (or double-click the file).
3. In the extension's settings pick your **Workspace folder** (projects are
   created there; a `.env` file in that folder is loaded for API keys) and
   optionally paste provider keys.

Rendering still needs Google Chrome and `ffmpeg` on the machine. For free local
Kokoro TTS, run `npm i kokoro-js` once inside the workspace folder. To update,
download the new release's `.mcpb` and install it over the old one.

To build the bundle from source: `pnpm -F @vibeframe/mcp-server build:mcpb`
(output in `packages/mcp-server/dist-mcpb/`).

#### Claude Desktop (manual JSON config)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vibeframe": {
      "command": "bash",
      "args": [
        "-lc",
        "cd '/absolute/path/to/your/vibeframe-workspace' && exec npx -y @vibeframe/mcp-server"
      ]
    }
  }
}
```

The shell wrapper is important for Claude Desktop because it is a global app
config and may not preserve a raw `cwd` field. It anchors relative project paths
so prompts like "create a project named launch" create `launch/` under your
workspace instead of a temporary directory.

Note: some Claude Desktop builds rewrite this file from memory and can mangle
hand-edited entries (the entry comes back as `"command": "custom"`). The
extension install above avoids that entirely and is the recommended path.

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

### OpenCode

Add to `.opencode/mcp.json` (or your global config per [opencode.ai/docs/config](https://opencode.ai/docs/config/)):

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

Claude Code drives `vibe` natively via shell + the scaffolded `AGENTS.md` / `CLAUDE.md` — MCP isn't required. If you'd like the typed-tool surface anyway:

```bash
claude mcp add vibeframe --scope project -- npx -y @vibeframe/mcp-server
```

## Human-in-the-Loop Choices

The server prefers asking over silently picking defaults:

- On hosts that support **MCP elicitation** (Claude Code 2.1.76+), the `build`
  tool opens a native form before the build starts for any choice the call
  left unspecified: narration provider (Kokoro free/local vs ElevenLabs),
  backdrop image generation (skip vs paid OpenAI), and a max cost cap.
  Declining cancels the build before any provider spend. Set
  `VIBE_MCP_ELICIT=off` in the server env to disable the form (headless and
  automation setups).
- On hosts without elicitation (Claude Desktop today), the server
  instructions tell the agent to present the same choices in chat and wait
  for your answer.

## What You Can Do

Once connected, your MCP host can resolve prompts like these into typed tool calls:

> "Scaffold a 12-second Swiss-Pulse promo project, three beats, and render it"
> *→ `init` + 3× `scene_add` + `render`*

> "Generate a cinematic backdrop image, animate it for 5 seconds, add narration"
> *→ `generate_image` + `generate_video` + `generate_speech`*

> "Remove silent segments and add captions to my interview"
> *→ `edit_silence_cut` + `edit_caption`*

## Available Tools

Tool names are MCP-side. Your host typically prefixes them (e.g. Claude shows them as `mcp__vibeframe__init`). Each one wraps the same engine call as the matching `vibe` CLI subcommand.

### Project flow (top-level)

| Tool | Description |
|------|-------------|
| `project_list` | List workspace video projects with build/render status (`_archive/` skipped) |
| `init` | Scaffold a video project with `STORYBOARD.md` + `DESIGN.md` |
| `build` | Build a storyboard project: narration TTS, image assets, scene HTML composition |
| `render` | Deterministic Hyperframes render → MP4/WebM/MOV |

### Scene authoring (lower-level)

| Tool | Description |
|------|-------------|
| `scene_list_styles` | List the 8 vendored visual identities (Swiss Pulse, Data Drift, …) or fetch one |
| `scene_add` | Append a beat (narration + backdrop + composed HTML) |
| `scene_install_skill` | Install the Hyperframes skill bundle into a scene project |
| `scene_lint` | Validate composition HTML against the visual identity |
| `scene_compose_prompts` | Emit the per-beat compose plan without making an LLM call |

### Generation (13)

| Tool | Description | Providers |
|------|-------------|-----------|
| `generate_image` | Text-to-image | OpenAI, Google, Stability |
| `generate_background` | Cinematic backdrop image (video-tuned prompt) | OpenAI |
| `generate_video` | Text/image-to-video (long-running) | Seedance via fal.ai, Grok, Kling, Runway, Google Veo |
| `generate_video_status` / `_cancel` / `_extend` | Manage long-running video jobs | (provider-specific) |
| `generate_motion` | Generate standalone designed motion graphics | Claude or Gemini + Remotion |
| `generate_speech` | Text-to-speech | ElevenLabs |
| `generate_music` | AI background music | Suno, ElevenLabs, Replicate MusicGen |
| `generate_music_status` | Poll Replicate music task | Replicate |
| `generate_sound_effect` | SFX from prompt | ElevenLabs |
| `generate_thumbnail` | AI thumbnail composition | OpenAI, Google |
| `generate_storyboard` | Multi-beat storyboard frames | OpenAI, Google |

### Editing (16)

| Tool | Description |
|------|-------------|
| `edit_silence_cut` | Remove silent segments (FFmpeg or Gemini) |
| `edit_jump_cut` | Remove filler words (Whisper) |
| `edit_caption` / `edit_animated_caption` | Burn styled / animated captions |
| `edit_text_overlay` | Simple static text burn-in |
| `edit_motion_overlay` | Designed animated overlays or user-provided Lottie overlays |
| `edit_fade` | Fade in/out |
| `edit_grade` | Color grading |
| `edit_speed_ramp` | Variable-speed segments |
| `edit_reframe` | Aspect-ratio reframe (e.g. 16:9 → 9:16) |
| `edit_interpolate` | Frame interpolation / slow-mo |
| `edit_upscale` | AI upscaling |
| `edit_image` | Image editing (gpt-image-2, Gemini) |
| `edit_noise_reduce` | Audio/video denoise |
| `edit_translate_srt` | Translate SRT subtitles |
| `edit_fill_gaps` | Detect & fill missing video segments via TTS narration timing (Plan G — Phase 4) |

### Audio (5)

| Tool | Description |
|------|-------------|
| `audio_dub` | AI voice dubbing (ElevenLabs) |
| `audio_clone_voice` | Voice clone from sample |
| `audio_isolate` | Vocal / background isolation |
| `audio_duck` | Auto-duck BGM under speech |
| `audio_transcribe` | Transcript with word-level timing (Whisper) |

### Detection (3)

| Tool | Description |
|------|-------------|
| `detect_silence` | Find silent segments |
| `detect_scenes` | Find shot boundaries |
| `detect_beats` | Find music beats |

### Inspection (4)

| Tool | Description |
|------|-------------|
| `inspect_media` | Unified image / video / YouTube analysis (Gemini) |
| `inspect_video` | Temporal video understanding (Gemini) |
| `inspect_review` | AI video review + auto-fix suggestions |
| `inspect_suggest` | Natural-language project edit suggestions (Gemini); optional auto-apply |

### Timeline (10)

| Tool | Description |
|------|-------------|
| `timeline_create` / `timeline_info` | Create or inspect low-level timeline JSON state |
| `timeline_add_source` | Import media (video/audio/image) |
| `timeline_add_clip` / `_split_clip` / `_trim_clip` | Build & shape clips |
| `timeline_move_clip` / `_duplicate_clip` / `_delete_clip` | Arrange clips |
| `timeline_add_track` | Add video/audio track |
| `timeline_add_effect` | Apply effect (fade, blur, …) |
| `timeline_list` | List all project contents |

### Compatibility & Export

| Tool | Description |
|------|-------------|
| `project_create` / `project_info` | Deprecated compatibility aliases for timeline JSON state |
| `export_video` | Export timeline JSON to MP4/WebM/MOV via FFmpeg |

### Remix & pipelines (4)

| Tool | Description |
|------|-------------|
| `run` | Execute a multi-stage YAML pipeline (`vibe run pipeline.yaml`) |
| `remix_highlights` | Long-form → highlight clips |
| `remix_auto_shorts` | Long-form → vertical shorts |
| `remix_regenerate_scene` | Re-render a single scene against an existing storyboard.{yaml,json} |

### Guides (1)

| Tool | Description |
|------|-------------|
| `guide` | Cross-host guides for motion, scene, pipeline, and architecture workflows |

> **CLI ↔ MCP sync**: `packages/mcp-server/src/tools/cli-sync.test.ts` is a vitest hook that fails CI when a CLI subcommand is added/removed/renamed without the matching MCP change. Open the test file to see the live mapping table — `null` rows mark CLI-only commands (e.g. `vibe audio list-voices`, `vibe timeline set`) that are intentionally not exposed via MCP.

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
| `ANTHROPIC_API_KEY` | Claude (translate-srt, highlights, build compose pipeline) |
| `GOOGLE_API_KEY` | Gemini (analyze, review, silence-cut, narrate) |
| `ELEVENLABS_API_KEY` | TTS, voice-clone, dubbing, SFX |
| `XAI_API_KEY` | Grok |
| `FAL_API_KEY` | Seedance image-to-video |
| `RUNWAY_API_SECRET` | Runway video |
| `KLING_API_KEY` | Kling video |
| `IMGBB_API_KEY` | Default temporary image host for Seedance/Kling image-to-video |
| `VIBE_UPLOAD_PROVIDER` | `imgbb` (default) or `s3` for temporary image uploads |
| `VIBE_UPLOAD_S3_BUCKET` | S3 bucket when `VIBE_UPLOAD_PROVIDER=s3` |
| `VIBE_UPLOAD_S3_PREFIX` | Optional S3 key prefix for temporary image uploads |
| `VIBE_UPLOAD_TTL_SECONDS` | Optional TTL hint for temporary upload URLs |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` | S3 upload host credentials |
| `VIBE_PROJECT_PATH` | Default timeline JSON path for resources |

## Requirements

- Node.js 20+
- FFmpeg on `PATH` (export, editing, pipelines)

## Privacy Policy

VibeFrame is local-first: no telemetry, no VibeFrame-operated servers in the
data path. Projects and generated media stay in the workspace folder you
choose; content is sent only to the AI providers you configure (Anthropic,
OpenAI, Google, ElevenLabs, …) when you explicitly invoke them, and API keys
live only on your machine. Tools that reach external services are marked with
`openWorldHint` in their MCP annotations; everything else (timeline edits,
ffmpeg operations, linting, rendering, local Kokoro TTS) runs fully locally.

Full policy: <https://vibeframe.ai/privacy> (source:
[PRIVACY.md](https://github.com/vericontext/vibeframe/blob/main/PRIVACY.md)).

> Installing the `.mcpb` file directly shows a standard "not verified by
> Anthropic" sideload notice in Claude Desktop — that is expected for
> extensions distributed outside the official directory.

## License

MIT
