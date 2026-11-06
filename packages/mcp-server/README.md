# @vibeframe/mcp-server

The MCP (Model Context Protocol) **server** for [VibeFrame](https://github.com/vericontext/vibeframe), the frontier-video-generation layer for coding agents: generate video assets on your own provider keys (Seedance, Runway, Kling, Gemini Omni), behind dry runs and a hard `--max-cost` ceiling. This package is _only_ the MCP adapter - it exposes VibeFrame's operations as typed MCP tools so an MCP-capable host can call them by natural language.

VibeFrame is CLI-first, not terminal-only. The CLI is the stable runtime; MCP is the app-host surface for clients that prefer typed tools over shell commands.

Confirmed MCP hosts today: **Claude Desktop**, **Cursor**, and **Claude Code**. Codex can drive `vibe` natively via shell + `AGENTS.md`, and can also load a project-scoped MCP server through `.codex/config.toml`. For other shell-capable hosts, use [`@vibeframe/cli`](https://www.npmjs.com/package/@vibeframe/cli) directly — same operations.

For long-running video builds, use your host's agent loop as the outer
loop: Claude Code, Codex, Cursor, or another coding-agent host. VibeFrame's MCP
tools provide the inner video runtime: JSON-style
results, dry-run/cost gates, `build-report.json`, `review-report.json`,
`retryWith`, `fixOwner`, deterministic repair, and render inspection.

> **Just want a CLI?** Use [`@vibeframe/cli`](https://www.npmjs.com/package/@vibeframe/cli) instead — same operations, invoked directly in your shell as `vibe <command>`. This package and the CLI wrap the same underlying engine; pick whichever fits your workflow. Many users install both.

| Surface                                                             | Package                          | How you call it                                                                         |
| ------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------- |
| MCP host (Claude Desktop / Cursor / OpenCode / Claude Code)         | `@vibeframe/mcp-server` _(this)_ | host calls tool by name, for example `mcp__vibeframe__build({...})`                     |
| Shell / scripts (any agent host: Codex / Aider / Gemini CLI / etc.) | `@vibeframe/cli`                 | `vibe init my-video && vibe build my-video && vibe render my-video`                     |

Outer-loop stop rules should be explicit: final MP4 path exists, duration and
aspect ratio match the brief, render inspection has no errors, any AI review score
meets the review threshold when AI review is requested, and every `fixOwner:"host-agent"` issue is fixed,
accepted with rationale, or reported as blocked.

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

Rendering still needs Google Chrome and `ffmpeg` on the machine. Free local
Kokoro narration is bundled inside the extension — no install step; the first
use downloads a ~90 MB voice model to `~/.cache/vibeframe/models`. To update,
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
  left unspecified: narration provider (Kokoro free/local, Gemini TTS, OpenAI's
  gpt-4o-mini-tts, or ElevenLabs), backdrop image generation (skip vs paid
  OpenAI), and a max cost cap.
  Declining cancels the build before any provider spend. Set
  `VIBE_MCP_ELICIT=off` in the server env to disable the form (headless and
  automation setups).
- On hosts without elicitation (Claude Desktop today), the server
  instructions tell the agent to present the same choices in chat and wait
  for your answer.

## What You Can Do

Once connected, your MCP host can resolve prompts like these into typed tool calls:

> "Scaffold a 12-second Swiss-Pulse promo project, three beats, and render it"
> _→ `init` + 3× `scene_add` + `render`_

> "Generate a cinematic backdrop image, animate it for 5 seconds, add narration"
> _→ `generate_image` + `generate_video` + `generate_narration`_

> "Remove silent segments and add captions to my interview"
> _→ `edit_silence_cut` + `edit_caption`_

## Available Tools

Tool names are MCP-side. Your host typically prefixes them (e.g. Claude shows them as `mcp__vibeframe__init`). Each one wraps the same engine call as the matching `vibe` CLI subcommand.

### Project flow (top-level)

| Tool             | Description                                                                     |
| ---------------- | ------------------------------------------------------------------------------- |
| `project_list`   | List workspace video projects with build/render status (`_archive/` skipped)    |
| `init`           | Scaffold a video project with `STORYBOARD.md` + `DESIGN.md`                     |
| `plan`           | Build plan, missing artifacts, provider needs, and estimated cost               |
| `build`          | Build a storyboard project: narration TTS, image assets, scene HTML composition |
| `render`         | Deterministic Hyperframes render → MP4/WebM/MOV                                 |
| `status_project` | Summarize build, review, and async job state for a project                      |
| `status_job`     | Read one async job record and optionally refresh provider status                |

### Storyboard and design (7)

| Tool                                 | Description                                    |
| ------------------------------------ | ---------------------------------------------- |
| `storyboard_list` / `storyboard_get` | Read beats and cue blocks from `STORYBOARD.md` |
| `storyboard_set` / `storyboard_move` | Set one cue, or reorder one beat               |
| `storyboard_validate`                | Validate beat ids and cue blocks               |
| `storyboard_revise`                  | Revise the storyboard from a request (LLM)     |
| `design_validate`                    | Validate `DESIGN.md` tokens and sections       |

### Scene authoring (lower-level)

| Tool                    | Description                                                                     |
| ----------------------- | ------------------------------------------------------------------------------- |
| `scene_list_styles`     | List the 8 vendored visual identities (Swiss Pulse, Data Drift, …) or fetch one |
| `scene_add`             | Append a beat (narration + backdrop + composed HTML)                            |
| `scene_install_skill`   | Install the Hyperframes skill bundle into a scene project                       |
| `scene_lint`            | Validate composition HTML against the visual identity                           |
| `scene_repair`          | Apply deterministic mechanical scene repairs                                    |
| `scene_compose_prompts` | Emit the per-beat compose plan without making an LLM call                       |
| `scene_submit`          | Submit host-authored scene HTML for one beat                                    |

### Generation (9)

| Tool                                | Description                                  | Providers                                             |
| ----------------------------------- | -------------------------------------------- | ----------------------------------------------------- |
| `generate_image`                    | Text-to-image                                | Gemini, OpenAI, Grok                                  |
| `generate_video`                    | Text/image-to-video (long-running)           | Seedance via fal.ai, Grok, Kling, Runway, Gemini Omni |
| `generate_video_cancel` / `_extend` | Manage long-running video jobs               | (provider-specific)                                   |
| `generate_motion`                   | Generate standalone designed motion graphics | Claude or Gemini + Remotion                           |
| `generate_narration`                | Text-to-speech                               | ElevenLabs, Gemini, OpenAI, Kokoro (local)            |
| `generate_music`                    | AI background music                          | ElevenLabs, Replicate MusicGen                        |
| `generate_sound_effect`             | SFX from prompt                              | ElevenLabs                                            |
| `generate_thumbnail`                | Best thumbnail frame from a video            | Gemini                                                |

### Editing (15)

| Tool                                     | Description                                                 |
| ---------------------------------------- | ----------------------------------------------------------- |
| `edit_silence_cut`                       | Remove silent segments (FFmpeg or Gemini)                   |
| `edit_jump_cut`                          | Remove filler words (Scribe or Whisper)                     |
| `edit_caption` / `edit_animated_caption` | Burn styled / animated captions                             |
| `edit_text_overlay`                      | Simple static text burn-in                                  |
| `edit_motion_overlay`                    | Designed animated overlays or user-provided Lottie overlays |
| `edit_fade`                              | Fade in/out                                                 |
| `edit_grade`                             | Color grading                                               |
| `edit_speed_ramp`                        | Variable-speed segments                                     |
| `edit_reframe`                           | Aspect-ratio reframe (e.g. 16:9 → 9:16)                     |
| `edit_interpolate`                       | Frame interpolation / slow-mo                               |
| `edit_upscale`                           | Resolution upscale (FFmpeg)                                 |
| `edit_image`                             | Image editing (Gemini, OpenAI, Grok)                        |
| `edit_noise_reduce`                      | Audio/video denoise                                         |
| `edit_translate_srt`                     | Translate SRT subtitles                                     |

### Audio (5)

| Tool                | Description                                |
| ------------------- | ------------------------------------------ |
| `audio_dub`         | AI voice dubbing                           |
| `audio_clone_voice` | Voice clone from sample                    |
| `audio_isolate`     | Vocal / background isolation               |
| `audio_duck`        | Auto-duck BGM under speech                 |
| `audio_transcribe`  | Transcript with timing (Scribe or Whisper) |

### Detection (3)

| Tool             | Description          |
| ---------------- | -------------------- |
| `detect_silence` | Find silent segments |
| `detect_scenes`  | Find shot boundaries |
| `detect_beats`   | Find music beats     |

### Inspection (3)

| Tool              | Description                                            |
| ----------------- | ------------------------------------------------------ |
| `inspect_project` | Local project completeness and composition checks      |
| `inspect_render`  | Cheap local render checks, plus optional Gemini review |
| `inspect_media`   | Unified image / video / YouTube analysis (Gemini)      |

### Remix & pipelines (3)

| Tool                | Description                                                    |
| ------------------- | -------------------------------------------------------------- |
| `run`               | Execute a multi-stage YAML pipeline (`vibe run pipeline.yaml`) |
| `remix_highlights`  | Long-form → highlight clips                                    |
| `remix_auto_shorts` | Long-form → vertical shorts                                    |

### Guides (1)

| Tool    | Description                                                               |
| ------- | ------------------------------------------------------------------------- |
| `guide` | Cross-host guides for motion, scene, pipeline, and architecture workflows |

### Takes (4)

| Tool           | Description                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------- |
| `take_list`    | List takes, the record of every paid generation: provider, model, status, cost and its basis |
| `take_show`    | Show one take in full: prompt, inputs and outputs with sha256, provider session, cost        |
| `take_log`     | Total spend by provider, model, and kind, split into billing and estimates                   |
| `take_promote` | Put an earlier take back into a project's beat slot; later builds keep it                    |

> **CLI ↔ MCP sync**: `packages/mcp-server/src/tools/cli-sync.test.ts` is a vitest hook that fails CI when a CLI subcommand is added/removed/renamed without the matching MCP change. Open the test file to see the live mapping table - `null` rows mark CLI-only commands (e.g. `vibe audio list-voices`) that are intentionally not exposed via MCP.

The server exposes tools only; it registers no MCP resources or prompts.

## Environment Variables

API keys are read from the host's environment (`~/.zshrc`, MCP config `env` block, etc.). All optional — only set the ones whose providers you use.

| Variable                                                     | Used by                                                        |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| `OPENAI_API_KEY`                                             | gpt-image-2, Whisper, GPT                                      |
| `ANTHROPIC_API_KEY`                                          | Claude (translate-srt, highlights, build compose pipeline)     |
| `GOOGLE_API_KEY`                                             | Gemini (analyze, review, silence-cut, narrate, TTS narration)  |
| `ELEVENLABS_API_KEY`                                         | TTS, voice-clone, dubbing, SFX                                 |
| `XAI_API_KEY`                                                | Grok                                                           |
| `FAL_API_KEY`                                                | Seedance image-to-video                                        |
| `RUNWAY_API_SECRET`                                          | Runway video                                                   |
| `KLING_API_KEY`                                              | Kling video                                                    |
| `IMGBB_API_KEY`                                              | Default temporary image host for Seedance/Kling image-to-video |
| `VIBE_UPLOAD_PROVIDER`                                       | `imgbb` (default) or `s3` for temporary image uploads          |
| `VIBE_UPLOAD_S3_BUCKET`                                      | S3 bucket when `VIBE_UPLOAD_PROVIDER=s3`                       |
| `VIBE_UPLOAD_S3_PREFIX`                                      | Optional S3 key prefix for temporary image uploads             |
| `VIBE_UPLOAD_TTL_SECONDS`                                    | Optional TTL hint for temporary upload URLs                    |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` | S3 upload host credentials                                     |

## Requirements

- Node.js 20+
- FFmpeg on `PATH` (export, editing, pipelines)

## Privacy Policy

VibeFrame is local-first: no telemetry, no VibeFrame-operated servers in the
data path. Projects and generated media stay in the workspace folder you
choose; content is sent only to the AI providers you configure (Anthropic,
OpenAI, Google, ElevenLabs, …) when you explicitly invoke them, and API keys
live only on your machine. Tools that reach external services are marked with
`openWorldHint` in their MCP annotations; everything else (ffmpeg
operations, media detection, linting, rendering, local Kokoro TTS) runs fully locally.

Full policy: <https://vibeframe.ai/privacy> (source:
[PRIVACY.md](https://github.com/vericontext/vibeframe/blob/main/PRIVACY.md)).

> Installing the `.mcpb` file directly shows a standard "not verified by
> Anthropic" sideload notice in Claude Desktop — that is expected for
> extensions distributed outside the official directory.

## License

MIT
