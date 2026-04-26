# VibeFrame Demo

Three surfaces, same tools. Pick the entry point that matches how you already
work — every section below is **copy-pasteable** and produces a real artifact
on disk.

> The asciinema recordings in the [README](README.md#demo) show v0.57 commands and
> pre-date the v0.58 visual-identity features (`vibe scene init --visual-style "<name>"`,
> `vibe scene styles`, the `DESIGN.md` hard-gate). The walkthroughs below include both —
> start with whichever surface fits you.

| Surface | Best for | API keys needed |
|---|---|---|
| [1. CLI direct (`vibe`)](#1-cli-direct--vibe-quickstart) | Scripted workflows, CI, terminal-first authors | None for the offline path; `OPENAI_API_KEY` for word-sync captions |
| [2. Standalone agent REPL (`vibe agent`)](#2-standalone-agent-repl--vibe-agent) | One-off prompts without leaving the terminal — BYO LLM | One of: `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY` / `XAI_API_KEY` / `OPENROUTER_API_KEY`, or local Ollama |
| [3. Inside Claude Code / Cursor (MCP)](#3-inside-claude-code--cursor-mcp) | Natural-language editing inside an existing agent host | Whatever the host already uses |

> **Prerequisites for all three:** Node.js ≥ 20 and FFmpeg on `PATH`. Install via
> `curl -fsSL https://vibeframe.ai/install.sh | bash` (or
> `npm install -g @vibeframe/cli`). Confirm with `vibe doctor`.

---

## 1. CLI direct — `vibe` quickstart

**Goal:** end up with `demo.mp4` — a 12-second narrated clip rendered from a
scene project. **No API keys required for the render** (uses local Kokoro
TTS); a Whisper key adds word-synced captions if you set one.

```bash
# 0. (Optional) confirm prerequisites
vibe doctor                                   # checks Node, FFmpeg, Chrome

# 1. Scaffold a scene project (16:9, default 30s root)
#    --visual-style seeds DESIGN.md from a named identity. Browse the 8
#    available styles with `vibe scene styles`. Omit the flag to write a
#    placeholder DESIGN.md you fill in yourself.
vibe scene init my-promo --visual-style "Swiss Pulse"
cd my-promo

# 2. Add a narrated hook scene
#    --tts auto picks ElevenLabs if ELEVENLABS_API_KEY is set,
#    otherwise falls back to local Kokoro (first call: ~330MB download)
vibe scene add hook \
  --style announcement \
  --headline "Ship videos, not clicks" \
  --narration "Stop fighting timelines. Author scenes that an agent can edit."

# 3. Add a follow-up scene with a generated backdrop
#    --visuals invokes Gemini by default; pass --image-provider openai for gpt-image-2
vibe scene add tagline \
  --style explainer \
  --kicker "VIDEO AS CODE" \
  --headline "Author scenes, not timelines" \
  --narration "Each word lights up the moment it is spoken." \
  --visuals "minimalist studio desk, soft warm lighting, top-down 16:9"

# 4. Validate
vibe scene lint                               # 0 errors expected

# 5. Render to MP4 (Chrome required)
vibe scene render -o demo.mp4
```

**What you get back:**

- `demo.mp4` — narrated, captioned, 1920×1080.
- `compositions/scene-hook.html`, `compositions/scene-tagline.html` — editable
  per-scene HTML you can hand-tweak and re-render without regenerating audio.
- `assets/narration-*.wav` and (if `OPENAI_API_KEY` is set)
  `assets/transcript-*.json` for word-level caption sync.

**Iterate in seconds:** edit headline text in `compositions/scene-hook.html`
directly, then `vibe scene render -o demo.mp4` — text tweaks skip TTS and
image generation, so the second render finishes in ~10 s.

**One-shot variant** (script → finished MP4) when you don't want to author
scenes manually:

```bash
vibe pipeline script-to-video \
  "Scene 1: founder wakes at 5 a.m.\nScene 2: coffee brewing.\nScene 3: ship time." \
  --format scenes -a 9:16 -d 30 -o ./morning/
# → ./morning/ is a full scene project + rendered MP4
```

---

## 2. Standalone agent REPL — `vibe agent`

**Goal:** drive VibeFrame in natural language without spinning up Claude Code,
Cursor, or any MCP host. The REPL discovers the same tools the MCP server
exposes and runs them locally with structured tool-use.

```bash
# 0. Set ONE LLM key — agent picks an available provider automatically
export ANTHROPIC_API_KEY=sk-ant-...           # or OPENAI / GOOGLE / XAI / OPENROUTER
# Local-only? export OLLAMA_HOST=http://localhost:11434  (no API key needed)

# 1. Start the REPL (default: Claude — override with -p openai|gemini|grok|openrouter|ollama)
vibe agent
```

Once the REPL is open, paste any of these prompts in turn:

```text
> Generate an image of a sunrise over a quiet city, then turn it into a 4-second video where the camera slowly pushes in.

> Now narrate it: "A new day, a new build."  Pick the cheapest TTS provider available.

> Mix the narration over the video and save the final clip as morning.mp4.

> Run vibe doctor and tell me which providers I'm authenticated against.
```

**What the agent does** (visible in the REPL trace):

1. Picks tools (`generate_image`, `generate_video`, `generate_speech`,
   `audio_dub`, …) by reading their schemas — no hand-written prompt
   engineering on your side.
2. Calls each via the same code path as `vibe ...` on the command line, so
   you can replay any step from the trace verbatim in your shell.
3. Confirms before any high-cost operation (`pipeline`, `generate_video`)
   when the budget guard is active.

**Useful flags:**

```bash
vibe agent -p ollama --model llama3.1        # offline, no API key
vibe agent --max-turns 6                     # cap loops in CI / cron
vibe agent --json                            # machine-readable trace
```

Exit any time with `Ctrl-D` or `:exit`. Every artifact lives in the working
directory you launched from — nothing is uploaded.

---

## 3. Inside Claude Code / Cursor (MCP)

**Goal:** keep editing prose / code in your existing agent host while the same
58 tools run alongside. Two paths — pick the one your host supports.

### Path A — MCP server (recommended for Claude Desktop, Cursor)

Add the block below to your host's MCP config and restart it. No clone, no
local install — `npx` fetches the bundle on demand.

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

| Host | Path |
|---|---|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Cursor | `.cursor/mcp.json` in the workspace |

After restart, just describe what you want — the host calls VibeFrame tools
directly:

```text
"Make a 30-second 9:16 hype reel from script.txt with synced captions."

"Detect the 3 most exciting scenes in interview.mp4 and turn each into a 30-second short."

"Generate a backdrop image of a cyberpunk skyline, animate a 5-second push-in,
 then dub the line 'The future is shipping' over it."
```

The host shows tool calls inline (`generate_image → generate_video → audio_dub`)
and you can interrupt or edit at any step.

### Path B — Claude Code without MCP (CLI discovery)

If you already use Claude Code in a directory where `vibe` is on `PATH`,
Claude Code finds the CLI automatically — no config block needed. Just open
the project and ask:

```bash
claude                                       # opens Claude Code in cwd
```

```text
"Run vibe --help and walk me through the script-to-video pipeline."

"Use vibe to create a 9:16 short about my morning coffee with narration and music."
```

Claude Code calls `vibe schema --list` to discover commands, `vibe schema <cmd>`
for parameters, and `vibe ... --json` for structured output. The
[`/vibe-pipeline`](.claude/skills/vibe-pipeline/SKILL.md) and
[`/vibe-scene`](.claude/skills/vibe-scene/SKILL.md) skills (auto-loaded if
you clone this repo, or add via `scripts/install-skills.sh`) tighten the
loop — they teach Claude the right command shapes for common workflows.
For a one-page overview, run `vibe init` to scaffold `AGENTS.md` (cross-tool)
and `CLAUDE.md` (Claude Code, imports `@AGENTS.md`) into your project.

[`assets/demos/claude-code-walkthrough.md`](assets/demos/claude-code-walkthrough.md)
has the original 5-prompt walkthrough plus a recording recipe.

---

## Cleanup

Each surface produces artifacts in the directory you ran from. Remove them
when you're done:

```bash
# Surface 1
rm -rf my-promo morning

# Surface 2 / 3
rm -f *.png *.mp4 *.mp3 *.wav *.vibe.json
```

---

## Where to next

| You want to… | Read |
|---|---|
| See every CLI command at a glance | `vibe --help` or [README › CLI Reference](README.md#cli-reference) |
| Author a multi-step pipeline as code | [`docs/cookbook.md`](docs/cookbook.md), [`examples/`](examples/) |
| Compare the scene render vs. raw Hyperframes | [`docs/comparison.md`](docs/comparison.md) |
| Track what's coming next | [`docs/ROADMAP-v0.58.md`](docs/ROADMAP-v0.58.md), [`ROADMAP.md`](ROADMAP.md) |
