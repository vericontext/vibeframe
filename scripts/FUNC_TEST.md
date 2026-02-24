# VibeFrame Feature Test (Landing Page Features)

> Verify key features showcased on the landing page.
> **Prerequisite**: Run `QUICK_TEST.md` first to reuse `test-results/` outputs.

---

## Setup

If not set up yet, choose one of the two methods.

**Method A — curl install (end users)**
```bash
curl -fsSL https://vibeframe.ai/install.sh | bash
# Setup wizard runs automatically → enter API keys
# Add more keys: vibe setup --full
```

**Method B — Developer mode (clone repo)**
```bash
pnpm install && pnpm build
cp .env.example .env  # Edit .env and add API keys
```

> See `QUICK_TEST.md` setup section for details.

---

## Required API Keys

| Step | Feature | Required API Key |
|------|---------|-----------------|
| F0 | TED Talk download | None (`yt-dlp` required) |
| F1 | Agent Mode | `OPENAI_API_KEY` (default: GPT-4o) |
| F2 | Auto Narrate | `GOOGLE_API_KEY` + `ELEVENLABS_API_KEY` |
| F3 | Auto Dub | `OPENAI_API_KEY` + `ELEVENLABS_API_KEY` |
| F4 | Reframe (vertical) | `ANTHROPIC_API_KEY` |
| F5 | Auto Highlights (default) | `OPENAI_API_KEY` + `ANTHROPIC_API_KEY` |
| F5 | Auto Highlights (--use-gemini) | `GOOGLE_API_KEY` |
| F6 | Auto Shorts | `OPENAI_API_KEY` (default) or `GOOGLE_API_KEY` (--use-gemini) |
| F7 | B-Roll Matcher | `OPENAI_API_KEY` + `ANTHROPIC_API_KEY` |
| F8 | Viral Optimizer | `OPENAI_API_KEY` + `ANTHROPIC_API_KEY` |
| F9 | Image → Motion Graphic | `GOOGLE_API_KEY` + `ANTHROPIC_API_KEY` |
| F10 | Video → Motion Graphic | `GOOGLE_API_KEY` + `ANTHROPIC_API_KEY` |
| F11 | MCP Server | None (keys configured on Claude Desktop/Cursor side) |

**Additional system requirements**: `ffmpeg` (local install), `node` 18+

---

## F0. Download TED Talk — Long Video Source

> **Note**: F5 Auto Highlights / F6 Auto Shorts / F8 Viral Optimizer require longer videos for meaningful results.
> Short clips like `dog.mp4` will be selected entirely as a highlight or produce insufficient analysis.
> **Required API key**: None — only `yt-dlp` installation needed (`brew install yt-dlp`)

**Prerequisites: Install `yt-dlp`**
```bash
# macOS
brew install yt-dlp

# or pip
pip install yt-dlp
```

**Download TED Talk** (Robert Waldinger — "What makes a good life?", ~12 min)
```bash
yt-dlp -f "bestvideo[vcodec^=avc1]+bestaudio[ext=m4a]/mp4" \
  --merge-output-format mp4 \
  -o "test-results/ted-talk.mp4" \
  "https://www.youtube.com/watch?v=8KkKuTCFvzI"
```

Pass: `test-results/ted-talk.mp4` — ~12 minute talk video (reused in F5, F6, F8)

> **Any video works**: Just change the URL. 5+ minutes is sufficient.

---

## F1. Agent Mode — Multi-step Editing with Natural Language

> Landing page hero section: *"Just type `vibe` and let the AI agent handle multi-step tasks autonomously. 58 tools at your command."*

> **Model**: OpenAI GPT-4o (default)
> **How it works**: Natural language input → LLM plans tool call sequence → Auto-executes tools iteratively → Complete
> **Other options**: `-p claude` (Claude Sonnet), `-p gemini` (Gemini 2.5 Flash), `-p xai` (Grok-4), `-p ollama` (local model)
> **Required API key**: `OPENAI_API_KEY` — `-p claude` needs `ANTHROPIC_API_KEY`, `-p gemini` needs `GOOGLE_API_KEY`, `-p xai` needs `XAI_API_KEY`, `-p ollama` needs none

```bash
vibe agent -i "create a project called beach-ad, add test-results/dog-final.mp4 to it, trim the clip to 3 seconds, and export to test-results/agent-output.mp4" -v
```

Pass: Terminal shows tool calls in order:
- `project_create` → `timeline_add_source` → `timeline_trim_clip` → `export_video`

Pass: `test-results/agent-output.mp4` created (3-second video)

---

## F2. Auto Narrate — AI-Generated Narration from Video

> Landing page pipeline: *"Video → Claude Vision → ElevenLabs TTS"*

> **Model**: Gemini Flash Preview (video understanding + script writing) + ElevenLabs `eleven_multilingual_v2` (TTS)
> **How it works**: Video → Gemini analyzes scenes and writes narration script → ElevenLabs generates voice → Save MP3
> **Other options**: `-s energetic` / `calm` / `dramatic` (narration style), `-v adam` (different voice), `-l ko` (Korean narration)
> **Required API keys**: `GOOGLE_API_KEY` + `ELEVENLABS_API_KEY`

```bash
vibe ai narrate test-results/dog.mp4 -l en -s energetic -o test-results/narrate-out/
```

Pass: `test-results/narrate-out/narration.mp3` — AI-generated voice describing video content
Pass: `test-results/narrate-out/narration-script.txt` — AI-written narration script

---

## F3. Auto Dub — Dub Audio to Another Language

> Landing page code example: `vibe ai dub narrated/auto-narration.mp3 --language ko`

> **Model**: OpenAI Whisper (transcription) → Claude / GPT (translation) → ElevenLabs (target language TTS)
> **How it works**: Audio file → Text transcription → Translate to target language → Generate TTS in new language
> **Other options**: `--source en` (specify source language), `-v <voice-id>` (voice for target language)
> **Required API keys**: `OPENAI_API_KEY` (Whisper transcription) + `ELEVENLABS_API_KEY` (TTS) — Translation uses Claude by default, so `ANTHROPIC_API_KEY` may also be needed

```bash
vibe ai dub test-results/dog-narration.mp3 -l en -o test-results/dog-dubbed-en.mp3
```

Pass: Playing `dog-narration.mp3` and `dog-dubbed-en.mp3` delivers the same content in different languages

---

## F4. Reframe — Convert Landscape to Vertical (9:16)

> Landing page code example: `vibe ai reframe video.mp4 --aspect 9:16`

> **Model**: Claude Vision (subject position analysis + optimal crop coordinates) + FFmpeg (actual crop)
> **How it works**: Frame sampling → Claude identifies main subject position → Determines crop region → FFmpeg applies crop
> **Other options**: `--focus face` / `center` / `action` / `auto`, `--analyze-only` (preview crop region only)
> **Required API key**: `ANTHROPIC_API_KEY`

```bash
vibe ai reframe test-results/dog.mp4 --aspect 9:16 -o test-results/dog-vertical.mp4
```

Pass: `dog-vertical.mp4` plays in vertical (9:16) format with the subject (dog) centered
Pass: Sides are cropped but the main subject is not cut off

---

## F5. Auto Highlights — Extract Highlights from Long Video

> Landing page pipeline: *"Long video → AI analysis → Best moments"*

> **Mode A — Default (Whisper + Claude)**
> **Model**: OpenAI `whisper-1` (speech transcription) + Claude (emotional/informational importance analysis)
> **How it works**: FFmpeg extracts audio → Whisper transcribes with timestamps → Claude scores importance per segment → Select segments above threshold → JSON output
> **Best for**: TED talks, interviews, podcasts — dialogue-heavy content
> **Required API keys**: `OPENAI_API_KEY` + `ANTHROPIC_API_KEY`

> **Mode B — `--use-gemini` (Gemini Video Understanding)**
> **Model**: Gemini Flash Preview — analyzes video + audio simultaneously
> **How it works**: Upload entire video to Gemini → Analyze visuals (expressions, slides, actions) + audio together → Select highlights
> **Best for**: Sports, visual demos, videos without audio, visually impactful content
> **Required API key**: `GOOGLE_API_KEY` only

> **Note**: Highlight JSON alone doesn't produce a video. Use `-p` to generate a project file, then `vibe export` to extract the video.

**Mode A: Whisper + Claude (recommended for TED talks)**
```bash
# Generate JSON analysis + project file
vibe ai highlights test-results/ted-talk.mp4 \
  -o test-results/highlights.json \
  -p test-results/highlights-project.vibe.json \
  -d 60

# Extract highlight video
vibe export test-results/highlights-project.vibe.json \
  -o test-results/ted-highlights.mp4 -y
```

**Mode B: Gemini Video Understanding (visual analysis)**
```bash
# Analyze video + audio simultaneously (longer processing time)
vibe ai highlights test-results/ted-talk.mp4 \
  --use-gemini \
  -o test-results/highlights-gemini.json \
  -p test-results/highlights-gemini-project.vibe.json \
  -d 60 --low-res

# Extract video
vibe export test-results/highlights-gemini-project.vibe.json \
  -o test-results/ted-highlights-gemini.mp4 -y
```

Pass: `highlights.json` — List of timestamps (`startTime`, `endTime`), reasons (`reason`), confidence scores (`confidence`)
Pass: `ted-highlights.mp4` — Highlight segments concatenated (~60 seconds)

---

## F6. Auto Shorts — Auto-edit Long Video into Short-form Clips

> **Model**: OpenAI Whisper / Gemini (content analysis + optimal segment selection) + FFmpeg (crop + trim)
> **How it works**: Analyze video → Select most engaging segments → 9:16 crop + length adjustment → Optional captions
> **Other options**: `--use-gemini` (Gemini video understanding), `--add-captions` (auto-add captions), `-n 3` (generate multiple)
> **Required API key**: `OPENAI_API_KEY` (default) or `GOOGLE_API_KEY` (with `--use-gemini`)

```bash
vibe ai auto-shorts test-results/ted-talk.mp4 -d 60 -a 9:16 -o test-results/ted-short.mp4 --add-captions
```

Pass: `ted-short.mp4` — Vertical (9:16) 60-second short-form video (most impactful segment auto-selected)
Pass: Video includes auto-generated caption subtitles

---

## F7. B-Roll Matcher — Auto-place B-Roll to Match Narration

> Landing page pipeline: *"Narration → Vision analysis → Auto-cut"*

> **Model**: OpenAI Whisper (narration transcription) + Claude (content-to-video matching analysis)
> **How it works**: Narration → Extract text per segment → Match best B-roll clip per segment → Generate `.vibe.json` timeline
> **Note**: More B-roll clips improve matching quality. Output is a project file that can be exported with `vibe export`.
> **Required API keys**: `OPENAI_API_KEY` + `ANTHROPIC_API_KEY`

```bash
vibe ai b-roll test-results/dog-narration.mp3 \
  --broll test-results/dog.mp4,test-results/dog-cool.mp4 \
  -o test-results/broll-project.vibe.json
```

Pass: `broll-project.vibe.json` created — Timeline with B-roll clips placed to narration timing
Pass: `vibe export test-results/broll-project.vibe.json -o test-results/broll-result.mp4 -y` generates the final video

---

## F8. Viral Optimizer — Auto-optimize Video per Platform

> Landing page code example: `vibe ai viral project.vibe.json -p tiktok,youtube-shorts`
> Landing page pipeline: *"One video → TikTok, Shorts, Reels"*

> **Model**: Whisper (transcription) + Claude (viral hook analysis + edit planning) + FFmpeg (crop / trim / captions)
> **How it works**: Analyze project → Determine optimal length, aspect ratio, and hook segments per platform → Generate video for each platform format
> **Other options**: `-p youtube,instagram-reels,twitter`, `--skip-captions`, `--caption-style animated`, `--analyze-only`
> **Note**: Short videos (e.g., dog.mp4) may produce empty frames or repetition since they don't meet platform target lengths. 5+ minute videos recommended. Reuse `ted-talk.mp4` from F0.
> **Required API keys**: `OPENAI_API_KEY` + `ANTHROPIC_API_KEY`

```bash
# Step 0: Create project from TED Talk (requires ted-talk.mp4 from F0)
vibe project create ted-viral -o test-results/ted-viral-project.vibe.json
VID=$(vibe timeline add-source test-results/ted-viral-project.vibe.json test-results/ted-talk.mp4 2>&1 | grep "Source added:" | awk '{print $NF}')
vibe timeline add-clip test-results/ted-viral-project.vibe.json $VID

# Step 1: Generate per-platform project files (analysis + edit plan)
vibe ai viral test-results/ted-viral-project.vibe.json \
  -p youtube-shorts,tiktok \
  -o test-results/viral-out/

# Step 2: Export each platform video
vibe export test-results/viral-out/youtube-shorts.vibe.json \
  -o test-results/viral-out/youtube-shorts.mp4 -y

vibe export test-results/viral-out/tiktok.vibe.json \
  -o test-results/viral-out/tiktok.mp4 -y
```

Pass: `test-results/viral-out/analysis.json` — Viral analysis results (hook segments, per-platform edit plans)
Pass: `test-results/viral-out/youtube-shorts.vibe.json` / `tiktok.vibe.json` — Per-platform project files
Pass: `test-results/viral-out/youtube-shorts.mp4` — YouTube Shorts optimized video (9:16, under 60s)
Pass: `test-results/viral-out/tiktok.mp4` — TikTok optimized video (9:16, under 60s)

---

## F9. Image Understanding → Remotion Motion Graphics

> **Model**: Gemini Flash Preview (image analysis) → Claude Sonnet (Remotion TSX code generation) → Remotion (rendering)
> **How it works**: Image → Gemini analyzes colors, subject position, and mood → Claude generates Remotion component reflecting analysis context → Remotion renders
> **Note**: `--image` is a dedicated option. Unlike `--video`, it doesn't composite onto video — it generates standalone motion graphics reflecting the image style.
> **Required API keys**: `GOOGLE_API_KEY` (image analysis) + `ANTHROPIC_API_KEY` (Remotion code generation)

```bash
vibe ai motion "Animated title card with golden retriever theme, warm beach tones, slow fade-in text" \
  --image test-results/dog.png \
  -o test-results/dog-motion.mp4 -d 5 -s cinematic
```

Pass: `test-results/dog-motion.tsx` — Remotion TSX component reflecting image colors, safe zones, and mood
Pass: `test-results/dog-motion.mp4` — 5-second MP4 with motion graphics composited over `dog.png`

### F9-edit. Edit Image Motion Graphic (--from-tsx)

> **How it works**: Pass existing TSX code to LLM + edit instructions → Return modified TSX → Re-render
> **Note**: Modifies only the requested parts while preserving existing animation logic
> **Required API key**: `ANTHROPIC_API_KEY` (default) or `GOOGLE_API_KEY` with `-m gemini`

```bash
# Modify TSX only (no re-render)
vibe ai motion "Make the text larger and change color from gold to white" \
  --from-tsx test-results/dog-motion.tsx

# Modify and re-composite onto image
vibe ai motion "Make the text larger and change color from gold to white" \
  --from-tsx test-results/dog-motion.tsx \
  --image test-results/dog.png \
  -o test-results/dog-motion-v2.mp4
```

Pass: `test-results/dog-motion.tsx` — Modified TSX (overwrites original, or use `-o` for separate file)
Pass: `test-results/dog-motion-v2.mp4` — New MP4 with modified motion graphics composited

---

## F10. Video Understanding → Remotion Motion Graphics Overlay

> **Model**: Gemini Flash Preview (video analysis) → Claude Sonnet (Remotion TSX code generation) → Remotion (rendering + FFmpeg compositing)
> **How it works**: Video → Gemini analyzes visual style, layout, and pacing → Claude generates Remotion component reflecting context → Render transparent WebM overlay → FFmpeg composites over video → MP4 output (original audio preserved)
> **Required API keys**: `GOOGLE_API_KEY` + `ANTHROPIC_API_KEY`

```bash
vibe ai motion "Lower third with animated name tag: 'Golden Retriever — Sunny Beach', minimal white text" \
  --video test-results/dog-final.mp4 \
  -o test-results/dog-overlay.mp4 -d 5 -s minimal
```

Pass: `test-results/dog-overlay.tsx` — Remotion TSX reflecting video context (colors, layout, pacing)
Pass: `test-results/dog-overlay.mp4` — Final video with motion graphics composited over `dog-final.mp4`

### F10-edit. Edit Video Motion Graphic (--from-tsx)

> **How it works**: Pass existing TSX code to LLM + edit instructions → Return modified TSX → Re-render
> **Note**: Preserves original animation logic (spring timing, interpolate values), only changes requested parts
> **Required API key**: `ANTHROPIC_API_KEY` (default) or `GOOGLE_API_KEY` with `-m gemini`

```bash
# Modify TSX only (no re-render)
vibe ai motion "Remove the background panel and add a gold glow effect to the text" \
  --from-tsx test-results/dog-overlay.tsx

# Modify and re-composite onto video (save as new file)
vibe ai motion "Remove the background panel and add a gold glow effect to the text" \
  --from-tsx test-results/dog-overlay.tsx \
  --video test-results/dog-final.mp4 \
  -o test-results/dog-overlay-v2.mp4

# Modify with Gemini model (different interpretation)
vibe ai motion "Change slide direction from left to right and use a thinner font" \
  --from-tsx test-results/dog-overlay.tsx \
  --video test-results/dog-final.mp4 \
  -o test-results/dog-overlay-v3.mp4 \
  -m gemini
```

Pass: `test-results/dog-overlay.tsx` — Modified TSX
Pass: `test-results/dog-overlay-v2.mp4` — New MP4 with modified motion graphics composited

---

## F11. MCP — Control via Natural Language in Claude Desktop / Cursor

> Landing page: *"Works with Claude Desktop and Cursor. Let AI control your edits."*

> **How it works**: MCP server → Claude Desktop / Cursor directly calls VibeFrame tools (`project_create`, `timeline_add_source`, etc.)
> **Note**: Same features as CLI, but controlled via chat in Claude/Cursor
> **Required API key**: None — VibeFrame MCP server itself needs no keys. If the agent invokes AI features (e.g., image generation), the corresponding keys must be in `.env`.

**Verify MCP server runs locally:**
```bash
# Developer mode
pnpm mcp

# Or via npx (end users)
npx -y @vibeframe/mcp-server
```
Pass: `VibeFrame MCP server running` message displayed (exit: Ctrl+C)

**Cursor integration (`.cursor/mcp.json`):**
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

**Claude Desktop integration (`~/Library/Application Support/Claude/claude_desktop_config.json`):**
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

Pass: Typing *"Create a new project and add intro.mp4"* in Cursor chat triggers VibeFrame tools automatically

---

## Results

```
F1      Agent Mode:                PASS / FAIL
F2      Auto Narrate:              PASS / FAIL
F3      Auto Dub:                  PASS / FAIL
F4      Reframe:                   PASS / FAIL
F0      TED Talk download:         PASS / FAIL
F5      Auto Highlights:           PASS / FAIL
F6      Auto Shorts:               PASS / FAIL
F7      B-Roll Matcher:            PASS / FAIL
F8      Viral Optimizer:           PASS / FAIL
F9      Image → Motion Graphic:    PASS / FAIL
F9-edit Image Motion edit:         PASS / FAIL
F10     Video → Motion Graphic:    PASS / FAIL
F10-edit Video Motion edit:        PASS / FAIL
F11     MCP Server:                PASS / FAIL
```
