# VibeFrame CLI Guide

Complete guide to using VibeFrame's command-line interface for AI-powered video editing.

---

## Installation

```bash
# Create a new directory and install
mkdir vibeframe-test && cd vibeframe-test
curl -fsSL https://vibeframe.ai/install.sh | bash
```

**Requirements:**
- Node.js 18+
- Git
- FFmpeg (recommended)

---

## Supported Capabilities

> **See [models.md](MODELS.md) for detailed model information** (SSOT - Single Source of Truth)

| Category | Providers | Default |
|----------|-----------|---------|
| **Agent LLM** | OpenAI, Claude, Gemini, xAI, Ollama | OpenAI GPT-4o |
| **Image Generation** | Gemini, OpenAI, Stability | Gemini Nano Banana |
| **Video Generation** | Kling, Runway, Veo, xAI Grok | Kling v2.5 |
| **Audio** | ElevenLabs (TTS/SFX), Whisper (transcription) | - |
| **Video Analysis** | Gemini | Gemini Flash |

For model IDs, environment variables, and CLI options → **[models.md](MODELS.md)**

---

## Quick Start: First 5 Minutes

### Step 1: Verify Installation

```bash
vibe --version
# Expected: 0.19.x

vibe --help
# Shows all available commands
```

### Step 2: Configure API Keys

```bash
# Basic setup - LLM provider only (for Agent natural language)
vibe setup

# Full setup - LLM + all optional providers (TTS, video gen, images, etc.)
vibe setup --full
```

| Mode | What it configures |
|------|-------------------|
| `vibe setup` | LLM provider (Claude/OpenAI/Gemini/Ollama) + its API key |
| `vibe setup --full` | LLM + ElevenLabs, Runway, Kling, Stability, Replicate |

For manual configuration, see [Configuration](#configuration).

### Step 3: Test AI Features (CLI Mode)

```bash
# Test 1: Image Generation (Gemini)
vibe ai image "a friendly robot mascot, 3D render style" -o robot.png

# Test 2: Text-to-Speech (ElevenLabs)
vibe ai tts "Welcome to VibeFrame, the AI video editor." -o welcome.mp3

# Test 3: Sound Effect (ElevenLabs)
vibe ai sfx "magical sparkle sound" -o sparkle.mp3 -d 2
```

### Step 4: Test Agent Mode (Natural Language)

```bash
vibe  # Start Agent mode (default)
```

Agent mode shows a welcome banner and waits for your input:

```
  ██╗   ██╗██╗██████╗ ███████╗
  ██║   ██║██║██╔══██╗██╔════╝
  ██║   ██║██║██████╔╝█████╗    VibeFrame v0.4.x
  ╚██╗ ██╔╝██║██╔══██╗██╔══╝    openai
   ╚████╔╝ ██║██████╔╝███████╗  ~/vibeframe-test
    ╚═══╝  ╚═╝╚═════╝ ╚══════╝

  47 tools

  Commands: exit · reset · tools · context

you> create an image and convert it to video

vibe> What kind of image should I create? (e.g., space landscape, cute robot, product photo)

you> futuristic city at night

vibe> (uses: ai_image, ai_video)

Done:
- Image generated: futuristic-city.png
- Video generation started: task-abc123 (check: vibe ai video-status abc123)
```

**Key Points:**
- Agent mode executes multi-step tasks autonomously
- Use `--confirm` flag to review each tool before execution
- Type `tools` to see all 46 available tools
- Type `exit` to quit

> **Note:** IDs shown as `source-1`, `clip-1` are simplified for readability.
> Actual IDs are timestamp-based (e.g., `1770107336723-8jfmo7kvu`).

---

## Configuration

### Config File Location
```
~/.vibeframe/config.yaml
```

### Example Configuration
```yaml
version: "1.0.0"
llm:
  provider: claude          # claude, openai, gemini, ollama, xai
providers:
  anthropic: sk-ant-...     # Claude
  openai: sk-...            # GPT, Whisper, DALL-E
  google: AIza...           # Gemini
  xai: xai-...              # xAI Grok
  elevenlabs: ...           # TTS, SFX
  stability: sk-...         # Stable Diffusion
  runway: ...               # Video generation
  kling: ...                # Video generation
defaults:
  aspectRatio: "16:9"
  exportQuality: standard
```

### Environment Variables
```bash
export GOOGLE_API_KEY="AIza..."          # Gemini (image, Veo video)
export ELEVENLABS_API_KEY="..."          # TTS, SFX
export ANTHROPIC_API_KEY="sk-ant-..."    # Claude
export OPENAI_API_KEY="sk-..."           # GPT, Whisper, GPT Image 1.5
export STABILITY_API_KEY="sk-..."        # Stability AI (image editing)
export RUNWAY_API_SECRET="..."           # Runway Gen-4.5
export KLING_API_KEY="..."               # Kling v2.5/v2.6
export XAI_API_KEY="..."                 # xAI Grok (Agent LLM + Grok Imagine)
```

### API Keys by Command

| Command | Required API Key | Model |
|---------|-----------------|-------|
| `vibe` / `vibe -p openai` | `OPENAI_API_KEY` | GPT-4o (Agent LLM) |
| `vibe -p claude` | `ANTHROPIC_API_KEY` | Claude Sonnet 4 (Agent LLM) |
| `vibe -p gemini` | `GOOGLE_API_KEY` | Gemini 2.0 Flash (Agent LLM) |
| `vibe -p xai` | `XAI_API_KEY` | Grok-3 (Agent LLM) |
| `vibe -p ollama` | (none) | Local models (Agent LLM) |
| `vibe ai image` (default) | `GOOGLE_API_KEY` | Gemini Nano Banana |
| `vibe ai image -p openai` | `OPENAI_API_KEY` | GPT Image 1.5 |
| `vibe ai gemini-edit` | `GOOGLE_API_KEY` | Gemini Nano Banana |
| `vibe ai analyze` | `GOOGLE_API_KEY` | Gemini Flash (vision + video) |
| `vibe ai image -p stability` | `STABILITY_API_KEY` | Stable Diffusion XL |
| `vibe ai tts`, `sfx`, `voices` | `ELEVENLABS_API_KEY` | ElevenLabs |
| `vibe ai transcribe` | `OPENAI_API_KEY` | Whisper |
| `vibe ai highlights` | `OPENAI_API_KEY` + `ANTHROPIC_API_KEY` | Whisper + Claude |
| `vibe ai highlights --use-gemini` | `GOOGLE_API_KEY` | Gemini |
| `vibe ai auto-shorts` | Same as highlights | Same as highlights |
| `vibe ai storyboard` | `ANTHROPIC_API_KEY` | Claude |
| `vibe ai script-to-video` | `ANTHROPIC_API_KEY` + `GOOGLE_API_KEY` | Claude + Gemini |
| `vibe ai video` | `RUNWAY_API_SECRET` | Runway Gen-4.5 |
| `vibe ai video -p veo` | `GOOGLE_API_KEY` | Veo 3.0/3.1 |
| `vibe ai video -p grok` | `XAI_API_KEY` | Grok Imagine |
| `vibe ai kling` | `KLING_API_KEY` | Kling v2.5-turbo/v2.6 |

---

## Core Concepts

### What is a Project?

A **project** is a `.vibe.json` file that stores your video editing state:

```
my-video.vibe.json
├── name: "my-video"        # Project name
├── aspectRatio: "16:9"     # Output aspect ratio
├── frameRate: 30           # Output frame rate
├── sources: [...]          # Media files (images, videos, audio)
├── tracks: [...]           # Timeline layers (video, audio)
├── clips: [...]            # Pieces of media placed on timeline
└── transitions: [...]      # Transitions between clips
```

### When Do You Need a Project?

| Task | Project Needed? |
|------|----------------|
| Generate image (`vibe ai image`) | ❌ No |
| Generate audio (`vibe ai tts`) | ❌ No |
| Generate sound effect (`vibe ai sfx`) | ❌ No |
| Combine multiple files into video | ✅ Yes |
| Add effects (fade, trim) | ✅ Yes |
| Export final video | ✅ Yes |

**Think of it this way:**
- **No project** = Just generate files (images, audio, etc.)
- **With project** = Assemble files into a video (timeline + export)

---

## Two Ways to Use VibeFrame

### 1. CLI Mode (Direct Commands)

Execute commands directly in the terminal. Ideal for scripting and automation.

```bash
# Direct command execution
vibe ai image "sunset" -o sunset.png
vibe project create "my-video" -o project.vibe.json
vibe export project.vibe.json -o output.mp4
```

### 2. Agent Mode (Default, Autonomous AI)

Start an autonomous AI agent that can plan and execute multi-step tasks. Agent mode uses an agentic loop where the LLM reasons, calls tools, receives results, and continues until the task is complete.

```bash
vibe         # Start Agent mode (default)
vibe agent   # Explicit agent command
```

**Agent Commands:**

| Command | Description |
|---------|-------------|
| `exit` / `quit` | Exit agent |
| `reset` | Clear conversation context |
| `tools` | List all available tools (46 total) |
| `context` | Show current project context |

### Agent Mode Options

```bash
vibe agent  # Start agent with default provider (OpenAI)
```

**Options:**

| Flag | Description |
|------|-------------|
| `-p, --provider <provider>` | LLM provider: openai, claude, gemini, ollama, xai (default: openai) |
| `-m, --model <model>` | Model to use (provider-specific) |
| `--project <path>` | Load project file on start |
| `-v, --verbose` | Show tool calls in output |
| `--max-turns <n>` | Maximum turns per request (default: 10) |
| `-c, --confirm` | Confirm before each tool execution |
| `-i, --input <query>` | Run a single query and exit (non-interactive) |

**Example Session:**

```
$ vibe -p claude

  ██╗   ██╗██╗██████╗ ███████╗
  ██║   ██║██║██╔══██╗██╔════╝
  ██║   ██║██║██████╔╝█████╗    VibeFrame v0.4.x
  ╚██╗ ██╔╝██║██╔══██╗██╔══╝    claude
   ╚████╔╝ ██║██████╔╝███████╗  ~/vibeframe-test
    ╚═══╝  ╚═╝╚═════╝ ╚══════╝

  47 tools

  Commands: exit · reset · tools · context

you> create a new project, add sunset.mp4, keep only the first 10 seconds, and add fade out

vibe> I'll create the project and edit the media.
(uses: project_create, timeline_add_source, timeline_add_clip, timeline_trim, timeline_add_effect)

Done:
- Project created
- sunset.mp4 added
- Trimmed to 0-10 seconds
- Fade out effect applied
```

**Available Tools (47 total):**

| Category | Count | Tools |
|----------|-------|-------|
| Project | 5 | project_create, project_info, project_set, project_open, project_save |
| Timeline | 11 | timeline_add_source, timeline_add_clip, timeline_add_track, timeline_add_effect, timeline_trim, timeline_split, timeline_move, timeline_delete, timeline_duplicate, timeline_list, timeline_clear |
| Filesystem | 4 | fs_list, fs_read, fs_write, fs_exists |
| Media | 8 | media_info, detect_scenes, detect_silence, detect_beats, ai_transcribe, media_compress, media_convert, media_concat |
| AI | 13 | ai_image, ai_video, ai_kling, ai_tts, ai_sfx, ai_music, ai_storyboard, ai_motion, ai_script_to_video, ai_highlights, ai_auto_shorts, ai_gemini_video, ai_gemini_edit |
| Export | 3 | export_video, export_audio, export_subtitles |
| Batch | 3 | batch_import, batch_concat, batch_apply_effect |

> **Note:** REPL mode is deprecated. Use Agent mode instead.

---

## AI Commands Reference

### Image Generation

**Providers:** `gemini` (default), `openai`, `stability` → See [models.md](MODELS.md) for details

> Note: `dalle` is deprecated, use `openai` instead.

```bash
# Gemini (default) - fast and high quality
vibe ai image "cute robot mascot" -o robot.png

# Portrait ratio (9:16) for phone wallpaper
vibe ai image "aurora borealis, night sky" -o wallpaper.png -r 9:16

# Landscape ratio (16:9) for video background
vibe ai image "cinematic mountain landscape" -o background.png -r 16:9

# Use GPT Image 1.5 (OpenAI)
vibe ai image "abstract digital art" -o art.png -p openai

# GPT Image 1.5 with quality tier
vibe ai image "professional photo" -o photo.png -p openai --quality high

# Use Stability AI (realistic images)
vibe ai image "professional headshot, studio lighting" -o headshot.png -p stability
```

**Agent Mode:**
```
you> create a cute robot mascot image
you> generate a portrait aurora image for phone wallpaper
you> make a 16:9 mountain landscape image for video background
```

**Defaults:**
| Option | Default |
|--------|---------|
| `--provider` | `gemini` |
| `--ratio` | `1:1` |
| `--quality` (OpenAI) | `medium` |

---

### Image Editing (Gemini)

Edit or compose multiple images using Gemini's multimodal capabilities.

**Models:**
| Model | Max Images | Best For |
|-------|------------|----------|
| `flash` (default) | 3 | Fast editing, 1K output |
| `pro` | 14 | Multi-image composition, up to 4K |

```bash
# Single image editing
vibe ai gemini-edit photo.png "convert to watercolor painting style" -o watercolor.png

# Change specific elements
vibe ai gemini-edit room.png "change the sofa to red leather" -o red-sofa.png

# Multi-image composition (Pro model)
vibe ai gemini-edit person1.png person2.png "create a group photo of these people in an office" -m pro -o group.png

# With specific output ratio
vibe ai gemini-edit product.png "add professional studio background" -o product-final.png -r 16:9
```

**Agent Mode:**
```
you> edit photo.png to look like a watercolor painting
you> combine person1.png and person2.png into a group photo
you> change the background of product.png to a studio setting
```

**Defaults:**
| Option | Default |
|--------|---------|
| `--model` | `flash` |
| `--output` | `edited.png` |

---

### Text-to-Speech (TTS)

```bash
# Default voice (Rachel)
vibe ai tts "Hello, welcome to VibeFrame." -o greeting.mp3

# List available voices
vibe ai voices

# Use specific voice (by voice ID)
vibe ai tts "Welcome to our channel" -o intro.mp3 -v EXAVITQu4vr4xnSDxMaL

# Long narration
vibe ai tts "This is a product demo video explaining all features." -o narration.mp3
```

**Agent Mode:**
```
you> convert "Hello, this is VibeFrame" to speech
you> show me available voices
you> create an intro narration
```

**Available Voices (use name or ID):**

| Name | Voice ID | Description |
|------|----------|-------------|
| Rachel | 21m00Tcm4TlvDq8ikWAM | American female (default) |
| Adam | pNInz6obpgDQGcFmaJgB | American male |
| Sam | yoZ06aMxZJJ28mfd3POQ | American male |
| Bella | EXAVITQu4vr4xnSDxMaL | American female |
| Josh | TxGEqnHWrfWFTfGW9XjX | American male |
| Arnold | VR6AewLTigWG4xSOukaG | American male |

```bash
# Use voice name (case-insensitive)
vibe ai tts "Hello" -o greeting.mp3 -v Rachel
vibe ai tts "Hello" -o greeting.mp3 -v sam

# Or use voice ID for custom voices
vibe ai tts "Hello" -o greeting.mp3 -v EXAVITQu4vr4xnSDxMaL
```

**Defaults:**
| Option | Default |
|--------|---------|
| `--voice` | `Rachel` (21m00Tcm4TlvDq8ikWAM) |
| `--output` | `output.mp3` |

---

### Sound Effects (SFX)

```bash
# Transition sound
vibe ai sfx "whoosh transition" -o whoosh.mp3 -d 2

# Notification sound
vibe ai sfx "notification ding" -o ding.mp3 -d 1

# Ambient sound
vibe ai sfx "rain on window" -o rain.mp3 -d 10

# Impact sound
vibe ai sfx "cinematic boom impact" -o boom.mp3 -d 3
```

**Agent Mode:**
```
you> create a whoosh sound effect for transitions
you> generate 10 seconds of rain sound effect
you> make an impactful cinematic sound
```

**Defaults:**
| Option | Default |
|--------|---------|
| `--duration` | auto (AI decides) |
| `--output` | `sound-effect.mp3` |

---

### Transcription (Audio to Subtitles)

```bash
# Generate SRT subtitles
vibe ai transcribe interview.mp3 -o subtitles.srt

# VTT format
vibe ai transcribe podcast.mp3 -o subtitles.vtt

# Korean language hint
vibe ai transcribe korean-audio.mp3 -o subs.srt -l ko
```

**Agent Mode:**
```
you> extract subtitles from interview.mp3
you> convert podcast audio to VTT subtitles
you> create subtitles for Korean audio
```

---

### Video Generation (Image-to-Video / Text-to-Video)

**Providers:** `runway` (default), `veo`, `grok`, `kling` → See [models.md](MODELS.md) for details

> **Note:** Video generation requires an image for image-to-video. Generate one first if you don't have one.

#### Complete Workflow (Recommended)

```bash
# Step 1: Generate image (if needed)
vibe ai image "beautiful sunset over ocean, cinematic" -o sunset.png

# Step 2: Generate video from image (Runway Gen-4.5)
vibe ai video "gentle waves, golden hour" -i sunset.png -o sunset.mp4

# Step 3: Check status (async operation)
vibe ai video-status <task-id>
```

#### Different Providers

```bash
# Runway Gen-4.5 (default, highest quality)
vibe ai video "camera slowly zooms in, golden hour lighting" -i my-photo.png -o video.mp4

# Kling v2.5 turbo (fast, ~36 seconds)
vibe ai kling "waves gently moving, cinematic" -i my-photo.png -o video-kling.mp4

# Kling v2.6 (higher quality)
vibe ai kling "waves gently moving, cinematic" -i my-photo.png -o video-kling.mp4 --model kling-v2-6

# Google Veo 3.1 (native audio)
vibe ai video "cinematic scene" -i my-photo.png -o video-veo.mp4 -p veo

# xAI Grok Imagine (1-15 sec, native audio)
vibe ai video "cinematic scene" -i my-photo.png -o video-grok.mp4 -p grok
```

#### Status & Control

```bash
# Check generation status
vibe ai video-status <task-id>

# Cancel generation
vibe ai video-cancel <task-id>
```

**Agent Mode:**
```
you> create an image and convert it to video
# Agent will: 1) Generate image 2) Generate video

you> convert sunset.png to video using kling
# Agent will use Kling v2.5-turbo

you> check video generation status
```

---

### Motion Graphics (Remotion)

Generate animated overlays on images or videos using Claude/Gemini + Remotion.

```bash
# Standalone motion graphic (renders .mp4 directly)
vibe ai motion "cinematic title card: 'VibeFrame'" --render -o title.mp4

# Composite onto an image (Gemini analyzes image → Claude generates overlay)
vibe ai motion "warm beach title card, slow fade-in" \
  --image photo.png -o photo-motion.mp4 -d 5 -s cinematic

# Composite onto a video (Gemini analyzes video → Claude generates lower-third)
vibe ai motion "lower third: 'John Doe — CEO'" \
  --video interview.mp4 -o interview-overlay.mp4 -s minimal

# Refine an existing motion graphic without regenerating
vibe ai motion "make the text larger and add gold glow" \
  --from-tsx interview-overlay.tsx \
  --video interview.mp4 -o interview-overlay-v2.mp4
```

**Style presets** (`-s` / `--style`):

| Style | Description |
|-------|-------------|
| `minimal` | Center-aligned typography, thin lines, no panels (Apple Keynote) |
| `corporate` | Data bar + counters, brand stripe (Bloomberg/CNBC) |
| `playful` | Bounce animations, bright colors (YouTube/TikTok) |
| `cinematic` | Glass lower-third + typewriter (Netflix/ESPN) |
| `fullscreen` | Full-screen title card, particle field (film opening) |
| `hud` | HUD data overlay, corner brackets, scan line (sci-fi) |
| `split` | Diagonal split, dual-panel (sports matchup) |

**Model options** (`-m` / `--model`):

| Alias | Model | Notes |
|-------|-------|-------|
| `sonnet` (default) | `claude-sonnet-4-6` | Best for motion graphics |
| `opus` | `claude-opus-4-6` | Highest quality |
| `gemini` | `gemini-2.5-pro` | Fast Gemini alternative |
| `gemini-3.1-pro` | `gemini-3.1-pro-preview` | Gemini alternative |

---

### Color Grading

Apply cinematic color grades to videos using FFmpeg (Claude generates the filter).

```bash
# Preset-based grading
vibe ai grade video.mp4 -p cinematic-warm -o graded.mp4

# Presets: cinematic-warm, cinematic-cool, vintage, high-contrast
vibe ai grade video.mp4 -p vintage -o vintage.mp4

# Free-text style description
vibe ai grade video.mp4 --style "dark moody horror, desaturated blues" -o moody.mp4
```

---

### Auto-Editing

AI-powered post-production editing commands (FFmpeg, no video generation cost).

```bash
# Remove silent segments
vibe ai silence-cut video.mp4 -o cut.mp4

# Remove filler words (um, uh, like…) using Whisper
vibe ai jump-cut video.mp4 -o clean.mp4

# Burn styled captions (Whisper transcription → FFmpeg drawtext)
vibe ai caption video.mp4 -s bold -o captioned.mp4

# Reframe 16:9 → 9:16 (Claude detects subject position)
vibe ai reframe video.mp4 --aspect 9:16 -o vertical.mp4

# Noise reduction
vibe ai noise-reduce video.mp4 -o denoised.mp4

# Fade in/out
vibe ai fade video.mp4 --fade-in 1.5 --fade-out 1.5 -o faded.mp4
```

---

### Auto Narrate & Dub

```bash
# Auto-generate narration from video content (Gemini Vision → ElevenLabs TTS)
vibe ai narrate video.mp4 -l ko -s energetic -o narrated/

# Dub audio to another language (Whisper → translation → TTS)
vibe ai dub narration.mp3 -l en -o dubbed-en.mp3
```

---

### Viral Optimizer & B-Roll Matcher

```bash
# Optimize for multiple platforms (Whisper + Claude + FFmpeg)
vibe ai viral project.vibe.json -p youtube-shorts,tiktok -o viral-out/
vibe export viral-out/youtube-shorts.vibe.json -o youtube-shorts.mp4 -y
vibe export viral-out/tiktok.vibe.json -o tiktok.mp4 -y

# Match B-roll to narration segments (Whisper + Claude)
vibe ai b-roll narration.mp3 \
  --broll clip1.mp4,clip2.mp4,clip3.mp4 \
  -o broll-project.vibe.json
vibe export broll-project.vibe.json -o broll-result.mp4 -y
```

---

## Advanced Workflows

### 1. Script-to-Video Pipeline

Automatically convert text scripts into complete videos with images, narration, and video clips.

**Complete Workflow:**
```bash
# Step 1: Create output directory
mkdir product-demo && cd product-demo

# Step 2: Generate video from script (images + narration + video)
vibe ai script-to-video "Product intro. Core feature demo. User reviews. Purchase guide." \
  -o ./ \
  --image-provider gemini \
  -g runway

# Step 3: Check generated files
ls -la
# storyboard.json, scene-1.png, scene-1.mp4, narration-1.mp3, ...

# Step 4: Export final video
vibe export project.vibe.json -o final.mp4
```

**Images Only (Quick Test):**
```bash
# Skip video generation for faster iteration
vibe ai script-to-video "Space exploration. Rocket launch. Mars landing." \
  -o ./space/ \
  --images-only \
  --no-voiceover
```

**Agent Mode:**
```
you> create a video from script "product intro, feature demo, purchase guide"
you> generate images only from the script first
you> export the generated project
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--images-only` | off | Skip video generation, produce images only |
| `--no-voiceover` | off | Skip TTS narration |
| `-g, --generator` | `runway` | Video generator: `runway` or `kling` |
| `-i, --image-provider` | `dalle` | Image provider: `dalle`, `stability`, `gemini` |
| `--retries` | `2` | Number of retries for video generation failures |

**Output Structure:**
```
./product-demo/
├── storyboard.json      # Scene breakdown from Claude
├── narration-1.mp3      # Per-scene narration
├── scene-1.png          # Generated image
├── scene-1.mp4          # Generated video
├── scene-2.png
├── scene-2.mp4
└── project.vibe.json    # Timeline project file
```

#### Scene Regeneration

If a scene fails or you want to modify it:

```bash
# Regenerate video only (keeps existing image)
vibe ai regenerate-scene ./product-demo/ --scene 3 --video-only

# Regenerate image only
vibe ai regenerate-scene ./product-demo/ --scene 3 --image-only

# Regenerate all assets
vibe ai regenerate-scene ./product-demo/ --scene 3

# Use different provider
vibe ai regenerate-scene ./product-demo/ --scene 3 --video-only -g kling
```

---

### 2. Highlights Extraction

Extract best moments from long videos automatically.

**Prerequisites:** You need a video file to analyze.

```bash
# Gemini Video analysis (recommended)
vibe ai highlights lecture.mp4 -o highlights.json --use-gemini

# Emotional moments only
vibe ai highlights wedding.mp4 -o highlights.json --use-gemini --criteria emotional

# Informative moments only
vibe ai highlights tutorial.mp4 -o highlights.json --use-gemini --criteria informative

# Max 5 highlights, 80% confidence threshold
vibe ai highlights video.mp4 -o highlights.json --use-gemini -n 5 -t 0.8

# Generate project file for export
vibe ai highlights event.mp4 -o hl.json -p highlight-reel.vibe.json --use-gemini
```

**Agent Mode:**
```
you> extract highlights from lecture.mp4
you> find emotional moments from wedding video
you> pick 5 important parts from the tutorial
```

**Output (highlights.json):**
```json
{
  "sourceFile": "lecture.mp4",
  "totalDuration": 3600,
  "highlights": [
    {
      "startTime": 120.5,
      "endTime": 145.2,
      "duration": 24.7,
      "category": "informative",
      "confidence": 0.95,
      "reason": "Core concept explanation",
      "transcript": "This is the most important part..."
    }
  ]
}
```

---

### 3. Auto-Shorts (Long Video → Short Clips)

Convert long videos into TikTok/Reels/Shorts clips.

**Prerequisites:** You need a long video file.

```bash
# Analyze first (preview without generating)
vibe ai auto-shorts podcast.mp4 -n 5 --analyze-only --use-gemini

# TikTok/Reels format (9:16, 30 seconds)
vibe ai auto-shorts podcast.mp4 \
  -n 3 \
  -d 30 \
  --output-dir ./shorts/ \
  --use-gemini \
  -a 9:16

# YouTube Shorts (60 seconds)
vibe ai auto-shorts interview.mp4 \
  -n 5 \
  -d 60 \
  --output-dir ./yt-shorts/ \
  --use-gemini \
  -a 9:16

# Instagram square
vibe ai auto-shorts vlog.mp4 \
  -n 3 \
  -d 45 \
  --output-dir ./insta/ \
  --use-gemini \
  -a 1:1
```

**Agent Mode:**
```
you> create 5 shorts clips from the podcast
you> cut interview video for TikTok
you> extract Instagram square clips from vlog
```

**Output:**
```
./shorts/
├── podcast-short-1.mp4   # 608x1080 (9:16), 30 seconds
├── podcast-short-2.mp4   # 608x1080 (9:16), 28 seconds
└── podcast-short-3.mp4   # 608x1080 (9:16), 32 seconds
```

---

### 4. Gemini Video Analysis

Analyze video content and get answers about what's in the video.

**Prerequisites:** You need a video file or YouTube URL.

```bash
# Summarize video
vibe ai gemini-video video.mp4 "summarize this video in 3 sentences"

# Extract timestamps
vibe ai gemini-video tutorial.mp4 "give me timestamps for each major step"

# Q&A about video
vibe ai gemini-video product.mp4 "what is the product name in this video?"

# YouTube URL analysis
vibe ai gemini-video "https://youtube.com/watch?v=xxx" "what is this video about?"

# Analyze specific segment
vibe ai gemini-video movie.mp4 "what happens in this scene?" --start 60 --end 120
```

**Agent Mode:**
```
you> summarize video.mp4
you> extract timestamps from the tutorial video
you> tell me what this YouTube video is about
```

---

### Unified Media Analysis

Analyze any media source — images, videos, or YouTube URLs — with a single command. Auto-detects the source type.

**Prerequisites:** You need an image file, video file, image URL, or YouTube URL.

```bash
# Analyze a local image
vibe ai analyze photo.png "describe this image in detail"

# Analyze a local video
vibe ai analyze demo.mp4 "summarize what happens in this video"

# Analyze a YouTube video
vibe ai analyze "https://youtube.com/watch?v=xxx" "what are the key topics covered?"

# Analyze an image from URL
vibe ai analyze "https://example.com/photo.jpg" "what objects are in this image?"

# Use Pro model for higher quality analysis
vibe ai analyze photo.png "describe the composition and lighting" -m pro

# Low-res mode for large files (fewer tokens)
vibe ai analyze long-video.mp4 "summarize this" --low-res

# Verbose mode (show token usage)
vibe ai analyze image.png "describe this" -v
```

**Supported Sources:**
| Source | Detection |
|--------|-----------|
| YouTube URL | `youtube.com` or `youtu.be` in URL |
| Image URL | URL ending in `.png`, `.jpg`, `.webp`, `.gif` |
| Local image | File with `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` extension |
| Local video | File with `.mp4`, `.mov`, `.webm`, `.avi`, `.mkv` extension |

**Agent Mode:**
```
you> analyze photo.png and describe what you see
you> what's happening in this video?
you> summarize this YouTube video
```

**Options:**
| Option | Default | Description |
|--------|---------|-------------|
| `-m, --model` | `flash` | Gemini model: `flash`, `flash-2.5`, `pro` |
| `--low-res` | off | Low resolution mode (fewer tokens) |
| `--fps` | 1 | Frames per second for video sampling |
| `--start` | - | Start offset in seconds (video only) |
| `--end` | - | End offset in seconds (video only) |
| `-v, --verbose` | off | Show token usage |

---

## Image Editing (Stability AI)

```bash
# Upscale (4x)
vibe ai sd-upscale small.png -o large.png -s 4

# Remove background
vibe ai sd-remove-bg photo.png -o no-bg.png

# Image transformation
vibe ai sd-img2img photo.png "watercolor style" -o watercolor.png
vibe ai sd-img2img photo.png "cyberpunk neon style" -o cyberpunk.png

# Object replacement
vibe ai sd-replace photo.png "car" "motorcycle" -o replaced.png

# Outpainting (extend image)
vibe ai sd-outpaint photo.png --left 200 --right 200 -o wider.png
```

**Agent Mode:**
```
you> upscale the image 4x
you> remove the photo background
you> convert this photo to watercolor style
you> replace the car with a motorcycle
```

---

## Project & Timeline

### Project Management

```bash
# Create project
vibe project create "My Video" -o project.vibe.json

# View project info
vibe project info project.vibe.json

# Update project settings
vibe project set project.vibe.json --name "New Name"
```

**Agent Mode:**
```
you> create a new project
you> show project info
you> change the project name
```

### Timeline Operations

```bash
# Add source media
vibe timeline add-source project.vibe.json intro.mp4 -d 30

# Add clip to timeline
vibe timeline add-clip project.vibe.json source-1 -s 0 -d 10

# Add effect
vibe timeline add-effect project.vibe.json clip-1 fadeIn -d 1

# View timeline
vibe timeline list project.vibe.json

# Trim clip
vibe timeline trim project.vibe.json clip-1 --duration 5

# Split clip
vibe timeline split project.vibe.json clip-1 -t 3

# Delete clip
vibe timeline delete project.vibe.json clip-1

# Clear timeline (remove all clips)
vibe timeline clear project.vibe.json --clips

# Clear everything (clips + sources)
vibe timeline clear project.vibe.json --all
```

**Agent Mode:**
```
you> add intro.mp4
you> create a 10-second clip from the first source
you> add fade in effect
you> show the timeline
you> trim clip to 5 seconds
you> delete all timeline clips
you> reset the project
```

### Export

```bash
vibe export project.vibe.json -o output.mp4 -p standard
vibe export project.vibe.json -o output.mp4 -p high -y
```

**Agent Mode:**
```
you> export the video
you> export in high quality
```

**Presets:**
| Preset | Resolution |
|--------|------------|
| `draft` | 360p |
| `standard` | 720p |
| `high` | 1080p |
| `ultra` | 4K |

### Auto-Detection

```bash
# Scene detection (finds cut points in video)
vibe detect scenes video.mp4
vibe detect scenes video.mp4 -o scenes.json

# Silence detection (finds quiet moments)
vibe detect silence video.mp4
vibe detect silence podcast.mp3 -d 0.5

# Beat detection (finds music beats for sync)
vibe detect beats music.mp3
vibe detect beats song.mp3 -o beats.json
```

**Agent Mode:**
```
you> find scene changes in the video
you> detect silence in the podcast
you> analyze music beats
```

---

## Batch Operations

### Import Multiple Files

```bash
# Import all mp4 files from a directory
vibe batch import ./media -p project.vibe.json --extensions mp4

# Import with specific extensions
vibe batch import ./assets -p project.vibe.json --extensions mp4,mov,mp3
```

**Agent Mode:**
```
you> import all video files from media folder
you> get only mp4 and mov files from assets folder
```

### Apply Effect to Multiple Clips

```bash
vibe batch apply-effect project.vibe.json fadeIn -d 1
```

**Agent Mode:**
```
you> add fadeIn effect to all clips
you> set fadeOut to 1 second for all clips
```

### Concatenate Multiple Files

```bash
vibe batch concat video1.mp4 video2.mp4 video3.mp4 -o combined.mp4
```

**Agent Mode:**
```
you> concatenate 3 video files
you> merge video1.mp4 and video2.mp4 into output.mp4
```

---

## Media Manipulation

### Compress Video

```bash
vibe media compress video.mp4 -o compressed.mp4 -c 23
```

**Agent Mode:**
```
you> compress video.mp4
you> reduce the video file size
```

### Convert Format

```bash
vibe media convert video.mov -o video.mp4
vibe media convert audio.wav -o audio.mp3
```

**Agent Mode:**
```
you> convert mov file to mp4
you> change wav to mp3
```

### Concatenate Media

```bash
vibe media concat video1.mp4 video2.mp4 -o combined.mp4
```

**Agent Mode:**
```
you> concatenate two videos
you> merge intro.mp4 and main.mp4
```

---

## Complete Workflow Examples

### Example A: Image → Video (Basic)

```bash
# 1. Generate image
vibe ai image "futuristic city at night, neon lights" -o city.png

# 2. Convert to video
vibe ai video "camera flying through the city, cinematic" -i city.png -o city.mp4

# 3. Check status (if async)
vibe ai video-status <task-id>
```

**Agent Mode:**
```
you> create a futuristic city image and convert it to video
```

### Example B: Podcast → Short Clips

```bash
# 1. Create folder
mkdir podcast-shorts && cd podcast-shorts

# 2. Analyze (preview)
vibe ai auto-shorts ../podcast.mp4 -n 5 --analyze-only --use-gemini

# 3. Generate shorts
vibe ai auto-shorts ../podcast.mp4 \
  -n 5 \
  -d 45 \
  --output-dir ./ \
  --use-gemini \
  -a 9:16

# 4. Check results
ls -la
```

**Agent Mode:**
```
you> find 5 viral-worthy clips from the podcast and make them for TikTok
```

### Example C: Script → Product Demo

```bash
# 1. Create folder
mkdir demo && cd demo

# 2. Generate complete video from script
vibe ai script-to-video "Product intro. Dashboard demo. Report feature. Sign up guide." \
  -o ./ \
  --image-provider gemini \
  -g runway

# 3. Export final video
vibe export project.vibe.json -o demo.mp4

# 4. Check results
ls -la
```

**Agent Mode:**
```
you> create a demo video from script "product intro, feature demo, sign up guide"
```

### Example D: Event → Highlight Reel

```bash
# 1. Extract highlights
vibe ai highlights event.mp4 \
  -o highlights.json \
  -p reel.vibe.json \
  --use-gemini \
  --criteria emotional \
  -d 120

# 2. Check project
vibe project info reel.vibe.json

# 3. Export
vibe export reel.vibe.json -o highlight-reel.mp4 -p high
```

**Agent Mode:**
```
you> find emotional moments from event video and create a 2-minute highlight reel
```

---

## Troubleshooting

### "Command not found: vibe"
```bash
curl -fsSL https://vibeframe.ai/install.sh | bash
```

### "FFmpeg not found"
```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg
```

### "API key invalid"
```bash
vibe setup  # Reconfigure
```

### Video analysis fails (large files)
```bash
vibe ai highlights video.mp4 --use-gemini --low-res
```

---

## Getting Help

```bash
vibe --help              # All commands
vibe ai --help           # AI commands
vibe ai image --help     # Specific command
```

- **GitHub:** https://github.com/vericontext/vibeframe
- **Issues:** https://github.com/vericontext/vibeframe/issues
