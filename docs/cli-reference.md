# VibeFrame CLI Reference

> **Auto-generated** from `vibe schema --list`. Do not edit by hand —
> run `pnpm gen:reference` after any flag/command change.

VibeFrame is CLI-first: every operation is a shell command. This file
lists every command, its arguments, and its options. For agentic /
machine-readable access use `vibe schema --list --json` and
`vibe schema <command> --json` directly.

> CLI version: `0.91.6`

## Mental model

The **project** is the implicit area. Bare top-level commands act on the
current project; grouped commands handle resources or one-shot
operations.

```
init → build → render          ← 90% users start here  (Tier 1)
gen / edit / inspect / remix    ← one-shot media tools  (Tier 2)
scene / timeline                ← lower-level authoring (Tier 3)
run / agent / schema / context  ← automation + agents   (Tier 4)
```

## Global flags

Work with any command:

| Flag | Effect |
|---|---|
| `-V, --version` | Print version and exit |
| `-h, --help` | Print help for the command and exit |
| `--json` | Output JSON (auto-enabled when stdout is piped) |
| `--fields <list>` | Limit JSON output fields (e.g. `--fields "path,duration"`) |
| `-q, --quiet` | Output only the result value (path / URL / ID) |
| `--stdin` | Read options from stdin as JSON (agent / script use) |
| `--describe` | Print the command's JSON Schema and exit (no execution) |
| `--dry-run` | Preview parameters without executing (most commands) |

## Standard short flags (per-command, dominant meaning only)

After the v0.78 dedup, each one-letter flag has a single canonical
meaning. Non-dominant uses are long-only.

| Short | Long | Uses |
|---|---|---|
| `-o` | `--output` | 40 |
| `-k` | `--api-key` | 31 |
| `-d` | `--duration` | 19 |
| `-m` | `--model` | 11 |
| `-p` | `--provider` | 10 |
| `-r` | `--ratio` | 9 |
| `-l` | `--language` | 9 |
| `-a` | `--aspect` | 5 |
| `-v` | `--verbose` | 3 |
| `-i` | `--image` / `--input` | 3 |
| `-c` | `--confirm` | 1 |

Flags without a short form (`--style`, `--name`, `--size`, `--count`,
`--mode`, `--text`, `--fps`, etc.) had no dominant meaning across the
surface and were collapsed to long-only.

## Cost tiers

| Tier | Commands | Per-call cost |
|---|---|---|
| **Free** | `detect *` · `edit silence-cut/fade/noise-reduce/text-overlay/interpolate` · `timeline *` · `scene lint` / `list-styles` · `audio duck` | $0 |
| **Low** | `inspect *` · `audio transcribe` / `list-voices` · `generate image` | ~$0.01–0.10 |
| **High** | `generate video` · `edit image` · `edit grade` / `reframe` / `speed-ramp` (Claude analysis) | ~$1–5 |
| **Very High** | `remix highlights` / `auto-shorts` / `regenerate-scene` · `vibe build` (full pipeline) | ~$5–50+ |

> **Tip:** Run `<paid command> --dry-run --json` first — the response
> includes a `costUsd` estimate without spending a cent.

## JSON envelope

### Success

```json
{
  "command": "<group> <leaf>",
  "elapsedMs": 12345,
  "costUsd": 0.07,
  "warnings": [],
  "data": { /* command-specific */ },
  "dryRun": true            // present only when --dry-run was passed
}
```

### Error (written to stderr)

```json
{
  "success": false,
  "error": "<message>",
  "code": "USAGE_ERROR | NOT_FOUND | API_ERROR | NETWORK_ERROR | AUTH_ERROR | ERROR",
  "exitCode": 0 | 1 | 2 | 3 | 4 | 5 | 6,
  "suggestion": "<actionable next step>",
  "retryable": true | false
}
```

| Exit code | Meaning |
|---|---|
| 0 | success |
| 1 | generic error |
| 2 | usage error (bad arg) |
| 3 | not found |
| 4 | auth failure |
| 5 | API error |
| 6 | network error |

## CLI ↔ MCP tool name mapping

`@vibeframe/mcp-server` exposes the same operations as MCP tools:

```
Rule 1.  vibe <group> <leaf>   →  <group>_<leaf>      (snake_case)
         e.g. vibe edit silence-cut → edit_silence_cut

Rule 2.  vibe <bare-name>      →  <bare-name>
         e.g. vibe init / build / render / run → init / build / render / run

Rule 3.  CLI-only (not exposed via MCP):
         setup, doctor, demo, agent, schema, context, walkthrough

Rule 4.  MCP-only agent tools (engine direct access):
         fs_*, media_*, project_open / project_save
```

## Commands

### Top-level commands

#### `vibe agent`

Start the AI agent with natural language interface

**Parameters:**

- `provider` *(string)* *(openai \| claude \| gemini \| ollama \| xai \| openrouter)* *(default: `"openai"`)* — LLM provider (openai, claude, gemini, ollama, xai, openrouter)
- `model` *(string)* — Model to use (provider-specific)
- `project` *(string)* — Timeline file or directory to load
- `verbose` *(boolean)* — Show verbose output including tool calls
- `maxTurns` *(number)* *(default: `10`)* — Maximum turns per request
- `input` *(string)* — Run a single query and exit (non-interactive)
- `confirm` *(boolean)* — Confirm before every tool — broadens the default cost gate (paid only) to all calls
- `noConfirm` *(boolean)* — Disable all confirm prompts including the high/very-high cost gate (CI / automation)
- `budgetUsd` *(string)* *(tier-estimated \| conservative)* — Reject tool calls past this cumulative USD ceiling (tier-estimated, conservative)

#### `vibe build`

Build a VibeFrame video project from STORYBOARD.md

**Parameters:**

- `project-dir` *(string)* — Video project directory
- `mode` *(string)* *(default: `"auto"`)* — Build mode: agent|batch|auto
- `effort` *(string)* *(default: `"medium"`)* — Compose effort tier (batch mode only): low|medium|high
- `composer` *(string)* — Batch composer: claude|openai|gemini
- `skipNarration` *(boolean)* — Don't dispatch TTS even when beats declare narration cues
- `skipBackdrop` *(boolean)* — Don't dispatch image-gen even when beats declare backdrop cues
- `skipRender` *(boolean)* — Compose only — don't render to MP4
- `tts` *(string)* — TTS provider: auto|elevenlabs|kokoro
- `voice` *(string)* — Voice id
- `imageProvider` *(string)* — Image provider: openai
- `quality` *(string)* *(default: `"hd"`)* — Image quality: standard|hd
- `imageSize` *(string)* *(default: `"1536x1024"`)* — Image size: 1024x1024|1536x1024|1024x1536
- `force` *(boolean)* — Re-dispatch primitives even when assets already exist
- `dryRun` *(boolean)* — Preview parameters without dispatching

#### `vibe completion`

Print a shell completion script for `vibe`

**Parameters:**

- `shell` *(string)* **required** — Target shell: zsh | bash | fish

#### `vibe context`

Print CLI context/guidelines for AI agent integration

*No parameters.*

#### `vibe demo`

Run sample edits on a test video (no API keys needed)

**Parameters:**

- `keep` *(boolean)* — Keep demo output files after completion
- `json` *(boolean)* — Output results as JSON

#### `vibe doctor`

Check system health and available commands

**Parameters:**

- `json` *(boolean)* — Output in JSON format
- `verbose` *(boolean)* — Show full report (every provider row, scene composer block, free-command list)
- `testKeys` *(boolean)* — Make a lightweight authenticated request to each provider (validates configured keys; skips providers without a cheap test endpoint)

#### `vibe init`

Scaffold a VibeFrame project (video scene project or project-scope agent files)

**Parameters:**

- `project-dir` *(string)* — Project directory (defaults to cwd)
- `type` *(string)* *(default: `"scene"`)* — Project type: scene (video project) | agent (agent files only)
- `profile` *(string)* *(minimal \| agent \| full)* *(default: `"agent"`)* — Scene profile: minimal (storyboard/design only), agent (recommended), full (render scaffold upfront)
- `ratio` *(string)* *(16:9 \| 9:16 \| 1:1 \| 4:5)* *(default: `"16:9"`)* — Scene aspect ratio: 16:9, 9:16, 1:1, 4:5
- `duration` *(number)* *(default: `10`)* — Default scene/root duration in seconds
- `visualStyle` *(string)* — Seed scene DESIGN.md from a named style
- `agent` *(string)* *(default: `"auto"`)* — Agent target: claude-code | codex | cursor | aider | gemini-cli | opencode | all | auto
- `force` *(boolean)* — Overwrite existing files instead of skipping
- `dryRun` *(boolean)* — Print the file list without writing anything

#### `vibe render`

Render a VibeFrame video project to MP4/WebM/MOV

**Parameters:**

- `project-dir` *(string)* — Video project directory
- `out` *(string)* — Output file (default: renders/<name>-<timestamp>.<format>)
- `root` *(string)* *(default: `"index.html"`)* — Root composition file
- `fps` *(number)* *(default: `30`)* — Frames per second: 24|30|60
- `quality` *(string)* *(default: `"standard"`)* — Quality preset: draft|standard|high
- `format` *(string)* *(default: `"mp4"`)* — Output container: mp4|webm|mov
- `workers` *(number)* *(default: `1`)* — Capture workers (1-16, default 1)
- `dryRun` *(boolean)* — Preview parameters without rendering

#### `vibe run`

Execute a YAML video pipeline (Video as Code)

**Parameters:**

- `pipeline` *(string)* **required** — Path to pipeline YAML file
- `output` *(string)* — Output directory for step results
- `dryRun` *(boolean)* — Validate and show execution plan without running
- `resume` *(boolean)* — Resume from last checkpoint (skip completed steps)
- `failFast` *(boolean)* — Stop on first failed step (default: continue)
- `budgetUsd` *(number)* — Abort if upper-bound cost estimate exceeds this USD amount
- `budgetTokens` *(number)* — Abort if provider token usage exceeds this count
- `maxErrors` *(number)* — Abort if failed step count exceeds this
- `effort` *(string)* — LLM effort level: low|medium|high|xhigh (Opus 4.7)
- `json` *(boolean)* — Output results as JSON

#### `vibe setup`

Configure VibeFrame (LLM provider, API keys)

**Parameters:**

- `reset` *(boolean)* — Reset configuration to defaults
- `full` *(boolean)* — Run full setup with all optional providers
- `show` *(boolean)* — Show current configuration (for debugging)
- `verbose` *(boolean)* — With --show: include unset providers + Resolution order + Defaults block
- `claudeCode` *(boolean)* — Show Claude Code integration guide
- `yes` *(boolean)* — Non-interactive: write config without prompting (CI / devcontainer)
- `provider` *(string)* — Set the Agent LLM provider (claude | openai | gemini | xai | openrouter | ollama)
- `importEnv` *(boolean)* — Promote API keys from .env / shell env into config.yaml
- `test` *(boolean)* — After save, live-test each configured key (exits 7 if any FAIL)
- `scope` *(string)* *(default: `"user"`)* — Where to save: 'user' (~/.vibeframe/config.yaml, shared) or 'project' (./.vibeframe/config.yaml, gitignored, this project only)

#### `vibe walkthrough`

Step-by-step authoring guide for a vibe workflow (universal /vibe-* slash-command equivalent)

**Parameters:**

- `topic` *(string)* — Walkthrough topic: scene | pipeline | architecture. Omit to list all.
- `list` *(boolean)* — List available walkthroughs and exit

### `generate`

#### `vibe generate background`

Generate video background using DALL-E

**Parameters:**

- `description` *(string)* **required** — Background description
- `apiKey` *(string)* — OpenAI API key (or set OPENAI_API_KEY env)
- `output` *(string)* — Output file path (downloads image)
- `aspect` *(string)* *(16:9 \| 9:16 \| 1:1)* *(default: `"16:9"`)* — Aspect ratio: 16:9, 9:16, 1:1
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe generate image`

Generate image using AI (Gemini, OpenAI gpt-image, Grok, or Runway)

**Parameters:**

- `prompt` *(string)* — Image description prompt (interactive if omitted)
- `provider` *(string)* *(openai \| gemini \| grok \| runway)* — Provider: openai (default when OPENAI_API_KEY set), gemini, grok, runway
- `apiKey` *(string)* — API key (or set env: OPENAI_API_KEY, GOOGLE_API_KEY)
- `output` *(string)* — Output file path (downloads image)
- `size` *(string)* *(default: `"1024x1024"`)* — Image size (openai: 1024x1024, 1536x1024, 1024x1536)
- `ratio` *(string)* *(default: `"1:1"`)* — Aspect ratio (gemini: 1:1, 1:4, 1:8, 4:1, 8:1, 16:9, 9:16, 3:4, 4:3, etc.)
- `quality` *(string)* *(standard \| hd)* *(default: `"standard"`)* — Quality: standard, hd (openai only)
- `style` *(string)* *(vivid \| natural)* *(default: `"vivid"`)* — Style: vivid, natural (openai only)
- `count` *(number)* *(default: `1`)* — Number of images to generate
- `model` *(string)* — Model. Gemini: flash, 3.1-flash, latest, pro. OpenAI: 1.5 (default), 2 (gpt-image-2)
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe generate motion`

Generate motion graphics using Claude + Remotion (render & composite)

**Parameters:**

- `description` *(string)* **required** — Natural language description of the motion graphic
- `apiKey` *(string)* — Anthropic API key (or set ANTHROPIC_API_KEY env)
- `output` *(string)* *(default: `"motion.tsx"`)* — Output file path
- `duration` *(number)* *(default: `5`)* — Duration in seconds
- `width` *(number)* *(default: `1920`)* — Width in pixels
- `height` *(number)* *(default: `1080`)* — Height in pixels
- `fps` *(number)* *(default: `30`)* — Frame rate
- `style` *(string)* *(minimal \| corporate \| playful \| cinematic)* — Style preset: minimal, corporate, playful, cinematic
- `render` *(boolean)* — Render the generated code with Remotion (output .webm)
- `video` *(string)* — Base video to composite the motion graphic onto
- `image` *(string)* — Image to analyze with Gemini — color/mood fed into Claude prompt
- `fromTsx` *(string)* — Refine an existing TSX file instead of generating from scratch
- `model` *(string)* *(default: `"sonnet"`)* — LLM model: sonnet (default), opus, gemini, gemini-3.1-pro
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe generate music`

Generate background music from a text prompt (ElevenLabs or Replicate MusicGen)

**Parameters:**

- `prompt` *(string)* **required** — Description of the music to generate
- `provider` *(string)* *(elevenlabs \| replicate)* *(default: `"elevenlabs"`)* — Provider: elevenlabs (default, up to 10min), replicate (MusicGen, max 30s)
- `apiKey` *(string)* — API key (or set ELEVENLABS_API_KEY / REPLICATE_API_TOKEN env)
- `duration` *(number)* *(default: `8`)* — Duration in seconds (elevenlabs: 3-600, replicate: 1-30)
- `instrumental` *(boolean)* — Force instrumental music, no vocals (ElevenLabs only)
- `melody` *(string)* — Reference melody audio file for conditioning (Replicate only)
- `model` *(string)* *(large \| stereo-large \| melody-large \| stereo-melody-large)* *(default: `"stereo-large"`)* — Model variant (Replicate only): large, stereo-large, melody-large, stereo-melody-large
- `output` *(string)* *(default: `"music.mp3"`)* — Output audio file path
- `noWait` *(boolean)* — Don't wait for generation to complete (Replicate async mode)
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe generate music-status`

Check music generation status

**Parameters:**

- `task-id` *(string)* **required** — Task ID from music generation
- `apiKey` *(string)* — Replicate API token (or set REPLICATE_API_TOKEN env)

#### `vibe generate sound-effect`

Generate sound effect using ElevenLabs

**Parameters:**

- `prompt` *(string)* **required** — Description of the sound effect
- `apiKey` *(string)* — ElevenLabs API key (or set ELEVENLABS_API_KEY env)
- `output` *(string)* *(default: `"sound-effect.mp3"`)* — Output audio file path
- `duration` *(number)* — Duration in seconds (0.5-22, default: auto)
- `promptInfluence` *(string)* — Prompt influence (0-1, default: 0.3)
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe generate speech`

Generate speech from text using ElevenLabs

**Parameters:**

- `text` *(string)* — Text to convert to speech (interactive if omitted)
- `apiKey` *(string)* — ElevenLabs API key (or set ELEVENLABS_API_KEY env)
- `output` *(string)* *(default: `"output.mp3"`)* — Output audio file path
- `voice` *(string)* *(default: `"21m00Tcm4TlvDq8ikWAM"`)* — Voice ID (default: Rachel)
- `listVoices` *(boolean)* — List available voices
- `fitDuration` *(number)* — Speed up audio to fit target duration (via FFmpeg atempo)
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe generate storyboard`

Generate video storyboard from content using Claude

**Parameters:**

- `content` *(string)* **required** — Content to analyze (text or file path)
- `apiKey` *(string)* — Anthropic API key (or set ANTHROPIC_API_KEY env)
- `output` *(string)* — Output JSON file path
- `duration` *(number)* — Target total duration in seconds
- `file` *(boolean)* — Treat content argument as file path
- `creativity` *(string)* *(default: `"low"`)* — Creativity level: low (default, consistent) or high (varied, unexpected)
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe generate thumbnail`

Generate video thumbnail (DALL-E) or extract best frame from video (Gemini)

**Parameters:**

- `description` *(string)* — Thumbnail description (for DALL-E generation)
- `apiKey` *(string)* — API key (OpenAI for generation, Google for best-frame)
- `output` *(string)* — Output file path
- `style` *(string)* *(youtube \| instagram \| tiktok \| twitter)* — Platform style: youtube, instagram, tiktok, twitter
- `bestFrame` *(string)* — Extract best thumbnail frame from video using Gemini AI
- `prompt` *(string)* — Custom prompt for best-frame analysis
- `model` *(string)* *(flash \| latest \| pro)* *(default: `"flash"`)* — Gemini model: flash, latest, pro (default: flash)

#### `vibe generate video`

Generate video using AI (Seedance, Grok, Kling, Runway, or Veo)

**Parameters:**

- `prompt` *(string)* — Text prompt describing the video (interactive if omitted)
- `provider` *(string)* — Provider: seedance (ByteDance Seedance 2.0 via fal.ai), grok, kling, runway, veo. `fal` is a deprecated v0.x alias for seedance and will be removed in 1.0.
- `apiKey` *(string)* — API key (or set FAL_KEY / XAI_API_KEY / RUNWAY_API_SECRET / KLING_API_KEY / GOOGLE_API_KEY env)
- `output` *(string)* — Output file path (downloads video)
- `image` *(string)* — Reference image for image-to-video
- `duration` *(number)* *(default: `5`)* — Duration in seconds. Seedance accepts 4-15; Kling accepts 5 or 10; Veo maps to 6 or 8.
- `ratio` *(string)* *(16:9 \| 9:16 \| 1:1)* — Aspect ratio: 16:9, 9:16, or 1:1 (auto-detected from image if omitted)
- `seed` *(number)* — Random seed for reproducibility (Runway only)
- `mode` *(string)* *(default: `"std"`)* — Generation mode: std or pro (Kling only)
- `seedanceModel` *(string)* *(default: `"quality"`)* — Seedance variant: quality or fast (fal.ai only)
- `negative` *(string)* — Negative prompt - what to avoid (Kling/Veo)
- `resolution` *(string)* *(720p \| 1080p \| 4k)* — Video resolution: 720p, 1080p, 4k (Veo only)
- `lastFrame` *(string)* — Last frame image for frame interpolation (Veo only)
- `refImages` *(string)* — Reference images for character consistency (Veo 3.1 only, max 3)
- `person` *(string)* — Person generation: allow_all, allow_adult (Veo only)
- `veoModel` *(string)* *(default: `"3.1-fast"`)* — Veo model: 3.0, 3.1, 3.1-fast (default: 3.1-fast)
- `runwayModel` *(string)* *(default: `"gen4.5"`)* — Runway model: gen4.5 (default, text+image-to-video), gen4_turbo (image-to-video only)
- `noWait` *(boolean)* — Start generation and return task ID without waiting
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe generate video-cancel`

Cancel video generation (Grok or Runway)

**Parameters:**

- `task-id` *(string)* **required** — Task ID to cancel
- `provider` *(string)* *(grok \| runway)* *(default: `"grok"`)* — Provider: grok, runway
- `apiKey` *(string)* — API key (or set XAI_API_KEY / RUNWAY_API_SECRET env)

#### `vibe generate video-extend`

Extend video duration (Kling by video ID, Veo by operation name)

**Parameters:**

- `id` *(string)* **required** — Kling video ID or Veo operation name
- `provider` *(string)* *(kling \| veo)* *(default: `"kling"`)* — Provider: kling, veo
- `apiKey` *(string)* — API key (KLING_API_KEY or GOOGLE_API_KEY)
- `output` *(string)* — Output file path
- `prompt` *(string)* — Continuation prompt
- `duration` *(number)* *(default: `5`)* — Duration: 5 or 10 (Kling), 4/6/8 (Veo)
- `negative` *(string)* — Negative prompt (what to avoid, Kling only)
- `veoModel` *(string)* *(default: `"3.1"`)* — Veo model: 3.0, 3.1, 3.1-fast
- `noWait` *(boolean)* — Start extension and return task ID without waiting
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe generate video-status`

Check video generation status (Grok, Runway, or Kling)

**Parameters:**

- `task-id` *(string)* **required** — Task ID from video generation
- `provider` *(string)* *(grok \| runway \| kling)* *(default: `"grok"`)* — Provider: grok, runway, kling
- `apiKey` *(string)* — API key (or set XAI_API_KEY / RUNWAY_API_SECRET / KLING_API_KEY env)
- `type` *(string)* *(default: `"text2video"`)* — Task type: text2video or image2video (Kling only)
- `wait` *(boolean)* — Wait for completion
- `output` *(string)* — Download video when complete

### `edit`

#### `vibe edit caption`

Transcribe and burn styled captions onto video (Whisper + FFmpeg)

**Parameters:**

- `video` *(string)* **required** — Video file path
- `output` *(string)* — Output file path (default: <name>-captioned.<ext>)
- `style` *(string)* *(minimal \| bold \| outline \| karaoke)* *(default: `"bold"`)* — Caption style: minimal, bold, outline, karaoke (default: bold)
- `fontSize` *(number)* — Override auto-calculated font size
- `color` *(string)* *(default: `"white"`)* — Font color (default: white)
- `language` *(string)* — Language code for transcription (e.g., en, ko)
- `position` *(string)* *(top \| center \| bottom)* *(default: `"bottom"`)* — Caption position: top, center, bottom (default: bottom)
- `apiKey` *(string)* — OpenAI API key (or set OPENAI_API_KEY env)
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe edit fade`

Apply fade in/out effects to video (FFmpeg only, no API key needed)

**Parameters:**

- `video` *(string)* **required** — Video file path
- `output` *(string)* — Output file path (default: <name>-faded.<ext>)
- `fadeIn` *(number)* *(default: `1`)* — Fade-in duration in seconds (default: 1)
- `fadeOut` *(number)* *(default: `1`)* — Fade-out duration in seconds (default: 1)
- `audioOnly` *(boolean)* — Apply fade to audio only (video stream copied)
- `videoOnly` *(boolean)* — Apply fade to video only (audio stream copied)
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe edit fill-gaps`

Fill timeline gaps with AI-generated video (Kling image-to-video)

**Parameters:**

- `project` *(string)* **required** — Timeline file or directory
- `provider` *(string)* *(default: `"kling"`)* — AI provider (kling)
- `output` *(string)* — Output project path (default: overwrite)
- `dir` *(string)* — Directory to save generated videos
- `prompt` *(string)* — Custom prompt for video generation
- `dryRun` *(boolean)* — Show gaps without generating
- `mode` *(string)* *(default: `"std"`)* — Generation mode: std or pro (Kling)
- `ratio` *(string)* *(16:9 \| 9:16 \| 1:1)* *(default: `"16:9"`)* — Aspect ratio: 16:9, 9:16, or 1:1

#### `vibe edit grade`

Apply AI-generated color grading (Claude + FFmpeg)

**Parameters:**

- `video` *(string)* **required** — Video file path
- `style` *(string)* — Style description (e.g., 'cinematic warm')
- `preset` *(string)* — Built-in preset: film-noir, vintage, cinematic-warm, cool-tones, high-contrast, pastel, cyberpunk, horror
- `output` *(string)* — Output video file path
- `analyzeOnly` *(boolean)* — Show filter without applying
- `apiKey` *(string)* — Anthropic API key (or set ANTHROPIC_API_KEY env)
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe edit image`

Edit image(s) using AI (Gemini, OpenAI, or Grok)

**Parameters:**

- `images` *(array)* **required** — Input image file(s) followed by edit prompt
- `provider` *(string)* *(gemini \| openai \| grok)* *(default: `"gemini"`)* — Provider: gemini (default), openai, grok
- `apiKey` *(string)* — API key (or set env variable)
- `output` *(string)* *(default: `"edited.png"`)* — Output file path
- `model` *(string)* *(default: `"flash"`)* — Model: flash/3.1-flash/latest/pro (Gemini only)
- `ratio` *(string)* — Output aspect ratio
- `size` *(string)* — Resolution: 1K, 2K, 4K (Gemini Pro only)
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe edit interpolate`

Create slow motion with frame interpolation (FFmpeg)

**Parameters:**

- `video` *(string)* **required** — Video file path
- `output` *(string)* — Output file path
- `factor` *(number)* *(2 \| 4 \| 8)* *(default: `2`)* — Slow motion factor: 2, 4, or 8
- `fps` *(number)* — Target output FPS
- `mode` *(string)* *(default: `"quality"`)* — Speed/quality tradeoff: fast or quality
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe edit jump-cut`

Remove filler words (um, uh, like, etc.) from video using Whisper word-level timestamps

**Parameters:**

- `video` *(string)* **required** — Video file path
- `output` *(string)* — Output file path (default: <name>-jumpcut.<ext>)
- `fillers` *(string)* — Comma-separated filler words to detect
- `padding` *(number)* *(default: `0.05`)* — Padding around cuts in seconds (default: 0.05)
- `language` *(string)* — Language code for transcription (e.g., en, ko)
- `analyzeOnly` *(boolean)* — Only detect fillers, don't cut
- `apiKey` *(string)* — OpenAI API key (or set OPENAI_API_KEY env)
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe edit noise-reduce`

Remove background noise from audio/video using FFmpeg (no API key needed)

**Parameters:**

- `input` *(string)* **required** — Audio or video file path
- `output` *(string)* — Output file path (default: <name>-denoised.<ext>)
- `strength` *(string)* *(low \| medium \| high)* *(default: `"medium"`)* — Noise reduction strength: low, medium, high (default: medium)
- `noiseFloor` *(number)* — Custom noise floor in dB (overrides strength preset)
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe edit reframe`

Auto-reframe video to different aspect ratio (Claude Vision + FFmpeg)

**Parameters:**

- `video` *(string)* **required** — Video file path
- `aspect` *(string)* *(9:16 \| 1:1 \| 4:5)* *(default: `"9:16"`)* — Target aspect ratio: 9:16, 1:1, 4:5
- `focus` *(string)* *(auto \| face \| center \| action)* *(default: `"auto"`)* — Focus mode: auto, face, center, action
- `output` *(string)* — Output video file path
- `analyzeOnly` *(boolean)* — Show crop regions without applying
- `keyframes` *(string)* — Export keyframes to JSON file
- `apiKey` *(string)* — Anthropic API key (or set ANTHROPIC_API_KEY env)
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe edit silence-cut`

Remove silent segments from video (FFmpeg default, or Gemini for smart detection)

**Parameters:**

- `video` *(string)* **required** — Video file path
- `output` *(string)* — Output file path (default: <name>-cut.<ext>)
- `noise` *(number)* *(default: `-30`)* — Silence threshold in dB (default: -30)
- `minDuration` *(number)* *(default: `0.5`)* — Minimum silence duration to cut (default: 0.5)
- `padding` *(number)* *(default: `0.1`)* — Padding around non-silent segments (default: 0.1)
- `analyzeOnly` *(boolean)* — (deprecated — use `vibe detect silence`) Only detect silence, don't cut
- `useGemini` *(boolean)* — Use Gemini Video Understanding for context-aware silence detection
- `model` *(string)* — Gemini model (default: flash)
- `lowRes` *(boolean)* — Low resolution mode for longer videos (Gemini only)
- `apiKey` *(string)* — Google API key override (or set GOOGLE_API_KEY env)
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe edit speed-ramp`

Apply content-aware speed ramping (Whisper + Claude + FFmpeg)

**Parameters:**

- `video` *(string)* **required** — Video file path
- `output` *(string)* — Output video file path
- `style` *(string)* *(dramatic \| smooth \| action)* *(default: `"dramatic"`)* — Style: dramatic, smooth, action
- `minSpeed` *(string)* *(default: `"0.25"`)* — Minimum speed factor
- `maxSpeed` *(string)* *(default: `"4.0"`)* — Maximum speed factor
- `analyzeOnly` *(boolean)* — Show keyframes without applying
- `language` *(string)* — Language code for transcription
- `apiKey` *(string)* — Anthropic API key (or set ANTHROPIC_API_KEY env)
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe edit text-overlay`

Apply text overlays to video (FFmpeg drawtext)

**Parameters:**

- `video` *(string)* **required** — Video file path
- `text` *(string)* — Text lines to overlay (repeat for multiple)
- `style` *(string)* *(lower-third \| center-bold \| subtitle \| minimal)* *(default: `"lower-third"`)* — Overlay style: lower-third, center-bold, subtitle, minimal
- `fontSize` *(string)* — Font size in pixels (auto-calculated if omitted)
- `fontColor` *(string)* *(default: `"white"`)* — Font color (default: white)
- `fade` *(number)* *(default: `0.3`)* — Fade in/out duration in seconds
- `start` *(number)* *(default: `0`)* — Start time in seconds
- `end` *(number)* — End time in seconds (default: video duration)
- `output` *(string)* — Output video file path
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe edit translate-srt`

Translate SRT subtitle file to another language (Claude or OpenAI)

**Parameters:**

- `srt` *(string)* **required** — SRT file path
- `target` *(string)* — Target language (e.g., ko, es, fr, ja, zh)
- `output` *(string)* — Output file path (default: <name>-<target>.srt)
- `provider` *(string)* *(claude \| openai)* *(default: `"claude"`)* — Translation provider: claude, openai (default: claude)
- `source` *(string)* — Source language (auto-detected if omitted)
- `apiKey` *(string)* — API key (or set ANTHROPIC_API_KEY / OPENAI_API_KEY env)
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe edit upscale`

Upscale video resolution using AI or FFmpeg

**Parameters:**

- `video` *(string)* **required** — Video file path
- `output` *(string)* — Output file path
- `scale` *(string)* *(default: `"2"`)* — Scale factor: 2 or 4
- `model` *(string)* *(real-esrgan \| topaz)* *(default: `"real-esrgan"`)* — Model: real-esrgan, topaz
- `ffmpeg` *(boolean)* — Use FFmpeg lanczos (free, no API)
- `apiKey` *(string)* — Replicate API token (or set REPLICATE_API_TOKEN env)
- `noWait` *(boolean)* — Start processing and return task ID without waiting
- `dryRun` *(boolean)* — Preview parameters without executing

### `inspect`

#### `vibe inspect media`

Analyze any media: images, videos, or YouTube URLs using Gemini

**Parameters:**

- `source` *(string)* **required** — Image/video file path, image URL, or YouTube URL
- `prompt` *(string)* **required** — Analysis prompt (e.g., 'Describe this image', 'Summarize this video')
- `apiKey` *(string)* — Google API key (or set GOOGLE_API_KEY env)
- `model` *(string)* *(default: `"flash"`)* — Model: flash (default), flash-2.5, pro
- `fps` *(number)* — Frames per second for video (default: 1)
- `start` *(number)* — Start offset in seconds (video only)
- `end` *(number)* — End offset in seconds (video only)
- `lowRes` *(boolean)* — Use low resolution mode (fewer tokens)
- `verbose` *(boolean)* — Show token usage
- `fields` *(string)* — Comma-separated fields to include in output (e.g., response,model)
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe inspect review`

Review video quality using Gemini AI and optionally auto-fix issues

**Parameters:**

- `source` *(string)* **required** — Video file path
- `storyboard` *(string)* — Storyboard JSON file for context
- `autoApply` *(boolean)* — Automatically apply fixable corrections
- `verify` *(boolean)* — Run verification pass after applying fixes
- `model` *(string)* *(default: `"flash"`)* — Gemini model: flash (default), flash-2.5, pro
- `output` *(string)* — Output video file path (for auto-apply)
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe inspect suggest`

Get AI edit suggestions using Gemini

**Parameters:**

- `project` *(string)* **required** — Timeline file or directory
- `instruction` *(string)* **required** — Natural language instruction
- `apiKey` *(string)* — Google API key (or set GOOGLE_API_KEY env)
- `apply` *(boolean)* — Apply the first suggestion automatically
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe inspect video`

Analyze video using Gemini (summarize, Q&A, extract info)

**Parameters:**

- `source` *(string)* **required** — Video file path or YouTube URL
- `prompt` *(string)* **required** — Analysis prompt (e.g., 'Summarize this video')
- `apiKey` *(string)* — Google API key (or set GOOGLE_API_KEY env)
- `model` *(string)* *(default: `"flash"`)* — Model: flash (default), flash-2.5, pro
- `fps` *(number)* — Frames per second (default: 1, higher for action)
- `start` *(number)* — Start offset in seconds (for clipping)
- `end` *(number)* — End offset in seconds (for clipping)
- `lowRes` *(boolean)* — Use low resolution mode (fewer tokens, longer videos)
- `verbose` *(boolean)* — Show token usage
- `fields` *(string)* — Comma-separated fields to include in output (e.g., response,model)
- `dryRun` *(boolean)* — Preview parameters without executing

### `audio`

#### `vibe audio clone-voice`

Clone a voice from audio samples using ElevenLabs

**Parameters:**

- `samples` *(array)* — Audio sample files (1-25 files)
- `apiKey` *(string)* — ElevenLabs API key (or set ELEVENLABS_API_KEY env)
- `name` *(string)* — Voice name (required)
- `description` *(string)* — Voice description
- `labels` *(string)* — Labels as JSON (e.g., '{"accent": "american"}')
- `removeNoise` *(boolean)* — Remove background noise from samples
- `list` *(boolean)* — List all available voices
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe audio dub`

Dub audio/video to another language (transcribe, translate, TTS)

**Parameters:**

- `media` *(string)* **required** — Input media file (video or audio)
- `language` *(string)* — Target language code (e.g., es, ko, ja) (required)
- `source` *(string)* — Source language code (default: auto-detect)
- `voice` *(string)* — ElevenLabs voice ID for output
- `analyzeOnly` *(boolean)* — Only analyze and show timing, don't generate audio
- `output` *(string)* — Output file path
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe audio duck`

Auto-duck background music when voice is present (FFmpeg)

**Parameters:**

- `music` *(string)* **required** — Background music file path
- `voice` *(string)* — Voice/narration track (required)
- `output` *(string)* — Output audio file path
- `threshold` *(number)* *(default: `-30`)* — Sidechain threshold in dB
- `ratio` *(string)* *(default: `"3"`)* — Compression ratio
- `attack` *(number)* *(default: `20`)* — Attack time in ms
- `release` *(number)* *(default: `200`)* — Release time in ms
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe audio isolate`

Isolate vocals from audio using ElevenLabs

**Parameters:**

- `audio` *(string)* **required** — Input audio file path
- `apiKey` *(string)* — ElevenLabs API key (or set ELEVENLABS_API_KEY env)
- `output` *(string)* *(default: `"vocals.mp3"`)* — Output audio file path
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe audio list-voices`

List available ElevenLabs voices

**Parameters:**

- `apiKey` *(string)* — ElevenLabs API key (or set ELEVENLABS_API_KEY env)

#### `vibe audio transcribe`

Transcribe audio using Whisper

**Parameters:**

- `audio` *(string)* **required** — Audio file path
- `apiKey` *(string)* — OpenAI API key (or set OPENAI_API_KEY env)
- `language` *(string)* — Language code (e.g., en, ko)
- `output` *(string)* — Output file path
- `format` *(string)* *(json \| srt \| vtt)* — Output format: json, srt, vtt (auto-detected from extension)

### `remix`

#### `vibe remix animated-caption`

Add animated captions with word-by-word effects (Whisper + Remotion/ASS)

**Parameters:**

- `video` *(string)* **required** — Video file path
- `style` *(string)* *(default: `"highlight"`)* — Style preset (default: highlight)
- `highlightColor` *(string)* *(default: `"#FFFF00"`)* — Active word highlight color
- `fontSize` *(string)* — Font size (default: auto based on resolution)
- `position` *(string)* *(top \| center \| bottom)* *(default: `"bottom"`)* — Caption position: top, center, bottom
- `wordsPerGroup` *(number)* — Words shown at once (default: auto 3-5)
- `maxChars` *(number)* — Max characters per group
- `language` *(string)* — Whisper language hint
- `fast` *(boolean)* — Use ASS/FFmpeg only (no Remotion, forces ASS tier styles)
- `output` *(string)* — Output file path
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe remix auto-shorts`

Auto-generate shorts from long-form video

**Parameters:**

- `video` *(string)* **required** — Video file path
- `output` *(string)* — Output file (single) or directory (multiple)
- `duration` *(number)* *(default: `60`)* — Target duration in seconds (15-60)
- `count` *(number)* *(default: `1`)* — Number of shorts to generate
- `aspect` *(string)* *(9:16 \| 1:1)* *(default: `"9:16"`)* — Aspect ratio: 9:16, 1:1
- `outputDir` *(string)* — Output directory for multiple shorts
- `addCaptions` *(boolean)* — Add auto-generated captions
- `captionStyle` *(string)* *(minimal \| bold \| animated)* *(default: `"bold"`)* — Caption style: minimal, bold, animated
- `analyzeOnly` *(boolean)* — Show segments without generating
- `language` *(string)* — Language code for transcription
- `useGemini` *(boolean)* — Use Gemini Video Understanding for enhanced visual+audio analysis
- `lowRes` *(boolean)* — Use low resolution mode for longer videos (Gemini only)
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe remix highlights`

Extract highlights from long-form video/audio content

**Parameters:**

- `media` *(string)* **required** — Video or audio file path
- `output` *(string)* — Output JSON file with highlights
- `project` *(string)* — Create project with highlight clips
- `duration` *(number)* *(default: `60`)* — Target highlight reel duration
- `count` *(number)* — Maximum number of highlights
- `threshold` *(number)* *(default: `0.7`)* — Confidence threshold (0-1)
- `criteria` *(string)* *(default: `"all"`)* — Selection criteria: emotional | informative | funny | all
- `language` *(string)* — Language code for transcription (e.g., en, ko)
- `useGemini` *(boolean)* — Use Gemini Video Understanding for enhanced visual+audio analysis
- `lowRes` *(boolean)* — Use low resolution mode for longer videos (Gemini only)
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe remix regenerate-scene`

Regenerate a specific scene in a script-to-video output directory

**Parameters:**

- `project-dir` *(string)* **required** — Path to the script-to-video output directory
- `scene` *(string)* — Scene number(s) to regenerate (1-based), e.g., 3 or 3,4,5
- `videoOnly` *(boolean)* — Only regenerate video
- `narrationOnly` *(boolean)* — Only regenerate narration
- `imageOnly` *(boolean)* — Only regenerate image
- `generator` *(string)* *(default: `"grok"`)* — Video generator: grok | kling | runway | veo
- `imageProvider` *(string)* *(default: `"gemini"`)* — Image provider: gemini | openai | grok
- `voice` *(string)* — ElevenLabs voice ID for narration
- `aspectRatio` *(string)* *(default: `"16:9"`)* — Aspect ratio: 16:9 | 9:16 | 1:1
- `retries` *(number)* *(default: `2`)* — Number of retries for video generation failures
- `referenceScene` *(string)* — Use another scene's image as reference for character consistency
- `dryRun` *(boolean)* — Preview parameters without executing

### `scene`

#### `vibe scene add`

Add a new scene to a project: AI narration + image + per-scene HTML

**Parameters:**

- `name` *(string)* **required** — Scene name (slugified into the composition id)
- `style` *(string)* *(simple \| announcement \| explainer \| kinetic-type \| product-shot)* *(default: `"simple"`)* — Style preset: simple, announcement, explainer, kinetic-type, product-shot
- `narration` *(string)* — Narration text (or path to a .txt file). Drives TTS + scene duration.
- `narrationFile` *(string)* — Existing narration audio file (.wav/.mp3). Skips TTS — useful with hyperframes tts, Mac say, or other external tools.
- `duration` *(number)* — Explicit scene duration in seconds (overrides narration audio)
- `visuals` *(string)* — Image prompt — generates assets/scene-<id>.png via the configured image provider
- `headline` *(string)* — Visible headline (defaults to the humanised scene name)
- `kicker` *(string)* — Small label above the headline (explainer / product-shot)
- `insertInto` *(string)* *(default: `"index.html"`)* — Root composition file to update
- `project` *(string)* *(default: `"."`)* — Project directory
- `imageProvider` *(string)* *(gemini \| openai)* *(default: `"gemini"`)* — Image provider: gemini, openai
- `tts` *(string)* *(auto \| elevenlabs \| kokoro)* *(default: `"auto"`)* — TTS provider: auto, elevenlabs, kokoro (default auto — picks ElevenLabs when key set, else Kokoro local)
- `voice` *(string)* — Voice id (ElevenLabs name/id, or Kokoro id like af_heart, am_michael)
- `noAudio` *(boolean)* — Skip TTS even when --narration is provided (useful for tests/agent dry runs)
- `noImage` *(boolean)* — Skip image generation even when --visuals is provided
- `noTranscribe` *(boolean)* — Skip Whisper word-level transcribe step (no transcript-<id>.json emitted)
- `transcribeLanguage` *(string)* — BCP-47 language code passed to Whisper (e.g. en, ko)
- `force` *(boolean)* — Overwrite an existing compositions/scene-<id>.html
- `dryRun` *(boolean)* — Preview parameters without writing files or calling APIs

#### `vibe scene compose-prompts`

Emit the per-beat compose plan for the host agent to author HTML itself (Phase H2 — no LLM call)

**Parameters:**

- `project-dir` *(string)* — Project directory containing STORYBOARD.md / DESIGN.md
- `beat` *(string)* — Restrict the plan to a single beat by id (e.g. 'hook', '1')

#### `vibe scene install-skill`

Install the Hyperframes skill into a scene project so the host agent can read it (Phase H1)

**Parameters:**

- `project-dir` *(string)* — Project directory containing STORYBOARD.md / DESIGN.md
- `host` *(string)* *(default: `"auto"`)* — Host layout target: claude-code | cursor | auto | all
- `force` *(boolean)* — Overwrite existing skill files (default: skip-on-exist)
- `dryRun` *(boolean)* — Preview which files would be written without changing anything

#### `vibe scene lint`

Validate scene HTML against composition rules (in-process, no Chrome required)

**Parameters:**

- `root` *(string)* — Root composition file relative to --project
- `project` *(string)* *(default: `"."`)* — Project directory
- `fix` *(boolean)* — Apply mechanical auto-fixes (currently: missing class="clip")

#### `vibe scene list-styles`

List vendored visual styles (or show one) for DESIGN.md seeding

**Parameters:**

- `name` *(string)* — Style name to inspect (omit to list all)

### `timeline`

#### `vibe timeline add-clip`

Add a clip to the timeline

**Parameters:**

- `project` *(string)* **required** — Timeline file or directory
- `source-id` *(string)* **required** — Source ID to use
- `track` *(string)* — Track ID (defaults to first matching track)
- `start` *(number)* *(default: `0`)* — Start time in timeline
- `duration` *(number)* — Clip duration (defaults to source duration)
- `offset` *(number)* *(default: `0`)* — Source start offset
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe timeline add-effect`

Add an effect to a clip

**Parameters:**

- `project` *(string)* **required** — Timeline file or directory
- `clip-id` *(string)* **required** — Clip ID
- `effect-type` *(string)* **required** — Effect type (fadeIn, fadeOut, blur, brightness, contrast, saturation, speed, volume)
- `start` *(number)* *(default: `0`)* — Effect start time (relative to clip)
- `duration` *(number)* — Effect duration (defaults to clip duration)
- `params` *(string)* *(default: `"{}"`)* — Effect parameters as JSON
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe timeline add-source`

Add a media source to the timeline

**Parameters:**

- `project` *(string)* **required** — Timeline file or directory
- `media` *(string)* **required** — Media file path
- `name` *(string)* — Source name (defaults to filename)
- `type` *(string)* *(video \| audio \| image \| lottie)* — Media type (video, audio, image, lottie)
- `duration` *(number)* — Duration in seconds (required for images)
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe timeline add-track`

Add a new track

**Parameters:**

- `project` *(string)* **required** — Timeline file or directory
- `type` *(string)* **required** — Track type (video, audio)
- `name` *(string)* — Track name
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe timeline create`

Create a low-level timeline JSON file

**Parameters:**

- `name` *(string)* **required** — Timeline name or path (e.g., 'my-video' or 'output/my-video')
- `output` *(string)* — Output file path (overrides name-based path)
- `ratio` *(string)* *(16:9 \| 9:16 \| 1:1 \| 4:5)* *(default: `"16:9"`)* — Aspect ratio (16:9, 9:16, 1:1, 4:5)
- `fps` *(number)* *(default: `30`)* — Frame rate
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe timeline delete-clip`

Delete a clip from the timeline

**Parameters:**

- `project` *(string)* **required** — Timeline file or directory
- `clip-id` *(string)* **required** — Clip ID to delete
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe timeline duplicate-clip`

Duplicate a clip

**Parameters:**

- `project` *(string)* **required** — Timeline file or directory
- `clip-id` *(string)* **required** — Clip ID to duplicate
- `time` *(number)* — Start time for duplicate (default: after original)
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe timeline info`

Show timeline information

**Parameters:**

- `file` *(string)* **required** — Timeline file or directory

#### `vibe timeline list`

List timeline contents

**Parameters:**

- `project` *(string)* **required** — Timeline file or directory
- `sources` *(boolean)* — List sources only
- `tracks` *(boolean)* — List tracks only
- `clips` *(boolean)* — List clips only

#### `vibe timeline move-clip`

Move a clip to a new position

**Parameters:**

- `project` *(string)* **required** — Timeline file or directory
- `clip-id` *(string)* **required** — Clip ID to move
- `time` *(number)* — New start time
- `track` *(string)* — Move to different track
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe timeline set`

Update timeline settings

**Parameters:**

- `file` *(string)* **required** — Timeline file or directory
- `name` *(string)* — Timeline name
- `ratio` *(string)* *(16:9 \| 9:16 \| 1:1 \| 4:5)* — Aspect ratio (16:9, 9:16, 1:1, 4:5)
- `fps` *(number)* — Frame rate
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe timeline split-clip`

Split a clip at a specific time

**Parameters:**

- `project` *(string)* **required** — Timeline file or directory
- `clip-id` *(string)* **required** — Clip ID to split
- `time` *(number)* *(default: `0`)* — Split time relative to clip start
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe timeline trim-clip`

Trim a clip

**Parameters:**

- `project` *(string)* **required** — Timeline file or directory
- `clip-id` *(string)* **required** — Clip ID
- `start` *(number)* — New start time
- `duration` *(number)* — New duration
- `dryRun` *(boolean)* — Preview parameters without executing

### `detect`

#### `vibe detect beats`

Detect beats in audio (for music sync)

**Parameters:**

- `audio` *(string)* **required** — Audio file path
- `output` *(string)* — Output JSON file with timestamps
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe detect scenes`

Detect scene changes in video

**Parameters:**

- `video` *(string)* **required** — Video file path
- `threshold` *(number)* *(default: `0.3`)* — Scene change threshold (0-1)
- `output` *(string)* — Output JSON file with timestamps
- `project` *(string)* — Add scenes as clips to project
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe detect silence`

Detect silence in audio/video

**Parameters:**

- `media` *(string)* **required** — Media file path
- `noise` *(number)* *(default: `-30`)* — Noise threshold in dB
- `duration` *(number)* *(default: `0.5`)* — Minimum silence duration
- `output` *(string)* — Output JSON file with timestamps
- `dryRun` *(boolean)* — Preview parameters without executing

### `batch`

#### `vibe batch apply-effect`

Apply an effect to multiple clips

**Parameters:**

- `project` *(string)* **required** — Timeline file or directory
- `effect-type` *(string)* **required** — Effect type (fadeIn, fadeOut, blur, etc.)
- `clip-ids` *(array)* — Clip IDs to apply effect to (or --all)
- `all` *(boolean)* *(default: `false`)* — Apply to all clips
- `duration` *(number)* *(default: `1`)* — Effect duration
- `start` *(number)* *(default: `0`)* — Effect start time (relative to clip)
- `intensity` *(string)* *(default: `"1"`)* — Effect intensity (0-1)
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe batch concat`

Concatenate multiple sources into sequential clips

**Parameters:**

- `project` *(string)* **required** — Timeline file or directory
- `source-ids` *(array)* — Source IDs to concatenate (or --all)
- `all` *(boolean)* *(default: `false`)* — Concatenate all sources in order
- `track` *(string)* — Track to place clips on
- `start` *(number)* *(default: `0`)* — Starting time
- `gap` *(number)* *(default: `0`)* — Gap between clips
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe batch import`

Import multiple media files from a directory

**Parameters:**

- `project` *(string)* **required** — Timeline file or directory
- `directory` *(string)* **required** — Directory containing media files
- `recursive` *(boolean)* *(default: `false`)* — Search subdirectories
- `duration` *(number)* *(default: `5`)* — Default duration for images
- `filter` *(string)* — Filter files by extension (e.g., '.mp4,.mov')
- `dryRun` *(boolean)* — Preview parameters without executing

#### `vibe batch info`

Show batch processing statistics

**Parameters:**

- `project` *(string)* **required** — Timeline file or directory

#### `vibe batch remove-clips`

Remove multiple clips from the timeline

**Parameters:**

- `project` *(string)* **required** — Timeline file or directory
- `clip-ids` *(array)* — Clip IDs to remove
- `all` *(boolean)* *(default: `false`)* — Remove all clips
- `track` *(string)* — Remove clips from specific track only
- `dryRun` *(boolean)* — Preview parameters without executing

### `media`

#### `vibe media duration`

Get media duration in seconds (for scripting)

**Parameters:**

- `file` *(string)* **required** — Media file path

#### `vibe media info`

Get media file information

**Parameters:**

- `file` *(string)* **required** — Media file path
