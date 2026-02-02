# VibeFrame CLI Guide

Complete guide to using VibeFrame's command-line interface for AI-powered video editing.

## Installation

```bash
# Create a new directory and install
mkdir vibeframe-test && cd vibeframe-test
curl -fsSL https://raw.githubusercontent.com/vericontext/vibeframe/main/scripts/install.sh | bash
```

**Requirements:**
- Node.js 18+
- Git
- FFmpeg (optional but recommended)

---

## First 5 Minutes: Step-by-Step Tutorial

After installation, follow these steps to verify everything works.

### Step 1: Verify Installation

```bash
# Check version
vibe --version
# Expected: 0.1.0

# Check available commands
vibe --help
```

### Step 2: Configure API Keys

```bash
vibe setup
```

Or set environment variables:

```bash
# Required for most AI features
export OPENAI_API_KEY="sk-..."           # DALL-E, Whisper
export ANTHROPIC_API_KEY="sk-ant-..."    # Claude (storyboard, analysis)
export GOOGLE_API_KEY="AIza..."          # Gemini (image, video analysis)
export ELEVENLABS_API_KEY="..."          # TTS, SFX
export STABILITY_API_KEY="sk-..."        # Stable Diffusion

# Optional (video generation)
export RUNWAY_API_SECRET="..."           # Runway Gen-3
export KLING_API_KEY="..."               # Kling video
```

### Step 3: Test Basic AI Commands

```bash
# Test 1: Generate an image (DALL-E)
vibe ai image "a cute robot waving hello, digital art" -o robot.png

# Test 2: Generate TTS
vibe ai tts "Hello! Welcome to VibeFrame." -o hello.mp3

# Test 3: Generate sound effect
vibe ai sfx "whoosh transition sound" -o whoosh.mp3 -d 2
```

### Step 4: Create Your First Project

```bash
# Create a new project
vibe project create "my-first-video" -o my-project.vibe.json

# Check project info
vibe project info my-project.vibe.json

# Start interactive REPL
vibe
```

In the REPL:
```
vibe> open my-project.vibe.json
vibe> info
vibe> help
vibe> exit
```

---

## AI Commands Quick Reference

### Image Generation (Multi-Provider)

```bash
# DALL-E (default) - Best for creative/artistic images
vibe ai image "sunset over mountains" -o sunset-dalle.png

# Stability AI - Best for photorealistic
vibe ai image "sunset over mountains" -o sunset-stability.png -p stability

# Gemini Imagen 3 - High quality, fast
vibe ai image "sunset over mountains" -o sunset-gemini.png -p gemini

# With aspect ratio
vibe ai image "vertical phone wallpaper" -o wallpaper.png -r 9:16
```

### Text-to-Speech & Sound Effects

```bash
# TTS with default voice
vibe ai tts "Your narration text here" -o narration.mp3

# List available voices
vibe ai voices

# TTS with specific voice (Bella - soft female)
vibe ai tts "Hello world" -o hello.mp3 -v EXAVITQu4vr4xnSDxMaL

# Sound effect generation
vibe ai sfx "thunder crash" -o thunder.mp3 -d 3
vibe ai sfx "typing on keyboard" -o typing.mp3 -d 5
vibe ai sfx "cinematic boom impact" -o boom.mp3 -d 2
```

### Video Generation

```bash
# Image-to-video with Runway (requires image input)
vibe ai video "camera slowly zooming in" -i input.png -o output.mp4

# Image-to-video with Kling
vibe ai kling "dramatic zoom with particles" -i input.png -o output.mp4

# Check video generation status
vibe ai video-status <task-id>
```

### Transcription

```bash
# Transcribe audio to SRT subtitles
vibe ai transcribe audio.mp3 -o subtitles.srt

# Transcribe to VTT format
vibe ai transcribe audio.mp3 -o subtitles.vtt

# Transcribe with language hint
vibe ai transcribe korean-audio.mp3 -o subtitles.srt -l ko
```

---

## Advanced AI Workflows

### 1. Script-to-Video Pipeline

Generate a complete video from a text script using multiple AI providers.

```bash
# Basic: Generate storyboard + images only
vibe ai script-to-video "A day in the life of a developer. Morning coffee. Coding session. Team meeting. Deploy to production." \
  -o ./my-video/ \
  --images-only \
  --no-voiceover

# With DALL-E images (default)
vibe ai script-to-video "Space exploration journey. Rockets launch. Astronauts float. Earth from orbit." \
  -o ./space-video/ \
  --image-provider dalle \
  --images-only

# With Stability AI images
vibe ai script-to-video "Cyberpunk city tour. Neon streets. Flying cars. Robot vendors." \
  -o ./cyber-video/ \
  --image-provider stability \
  --images-only

# With Gemini images (fast, 2 credits each)
vibe ai script-to-video "Nature documentary. Forest scenes. Wildlife. Sunset." \
  -o ./nature-video/ \
  --image-provider gemini \
  --images-only

# Full pipeline with voiceover (requires ElevenLabs)
vibe ai script-to-video "Welcome to our product demo. Feature one. Feature two. Call to action." \
  -o ./demo-video/ \
  --image-provider gemini \
  -v EXAVITQu4vr4xnSDxMaL
```

**Output:**
- `storyboard.json` - Scene breakdown
- `scene-1.png`, `scene-2.png`, ... - Generated images
- `voiceover.mp3` - TTS narration (if enabled)
- `project.vibe.json` - VibeFrame project file

### 2. Video Highlights Extraction

Extract the best moments from long-form video content.

```bash
# Traditional method (Whisper + Claude, audio-only)
vibe ai highlights video.mp4 -o highlights.json

# Gemini Video Understanding (visual + audio analysis)
vibe ai highlights video.mp4 -o highlights.json --use-gemini

# With options
vibe ai highlights video.mp4 \
  -o highlights.json \
  --use-gemini \
  --criteria emotional \
  -n 5 \
  -t 0.8

# Create project from highlights
vibe ai highlights video.mp4 \
  -o highlights.json \
  -p highlight-reel.vibe.json \
  --use-gemini
```

**Options:**
- `--use-gemini` - Use Gemini Video Understanding (analyzes visuals + audio)
- `--low-res` - Low resolution mode for longer videos (Gemini only)
- `--criteria` - `emotional`, `informative`, `funny`, or `all`
- `-n, --count` - Maximum number of highlights
- `-t, --threshold` - Confidence threshold (0-1)
- `-d, --duration` - Target total duration in seconds

### 3. Auto-Generate Shorts

Automatically create short-form content from long videos.

```bash
# Analyze only (preview without generating)
vibe ai auto-shorts video.mp4 \
  -n 3 \
  --analyze-only \
  --use-gemini

# Generate 3 shorts (9:16 aspect ratio)
vibe ai auto-shorts video.mp4 \
  -n 3 \
  -d 30 \
  --output-dir ./shorts/ \
  --use-gemini \
  -a 9:16

# Generate square shorts for Instagram
vibe ai auto-shorts video.mp4 \
  -n 2 \
  -d 60 \
  --output-dir ./shorts/ \
  --use-gemini \
  -a 1:1
```

**Output:**
- `video-short-1.mp4` - First short (cropped to aspect ratio)
- `video-short-2.mp4` - Second short
- ...

### 4. Gemini Video Analysis

Analyze and understand video content using Gemini.

```bash
# Summarize a video
vibe ai gemini-video video.mp4 "Summarize this video in 3 bullet points"

# Extract key events with timestamps
vibe ai gemini-video video.mp4 "List all key events with timestamps"

# Answer questions about video
vibe ai gemini-video video.mp4 "What products are shown in this video?"

# Analyze YouTube video (URL)
vibe ai gemini-video "https://www.youtube.com/watch?v=VIDEO_ID" "What is the main topic?"

# Custom frame rate for action videos
vibe ai gemini-video action.mp4 "Describe the movements" --fps 5

# Analyze specific segment
vibe ai gemini-video long-video.mp4 "What happens here?" --start 60 --end 120
```

---

## Complete Workflow Examples

### Example A: YouTube Shorts from Podcast

Convert a podcast episode into viral short clips.

```bash
# 1. Create output directory
mkdir podcast-shorts && cd podcast-shorts

# 2. Analyze and generate shorts with Gemini
vibe ai auto-shorts ../podcast-episode.mp4 \
  -n 5 \
  -d 45 \
  --output-dir ./ \
  --use-gemini \
  -a 9:16

# 3. Check generated files
ls -la
# podcast-episode-short-1.mp4
# podcast-episode-short-2.mp4
# ...
```

### Example B: Product Demo Video

Create a product demo from a script.

```bash
# 1. Create project directory
mkdir product-demo && cd product-demo

# 2. Generate video assets from script
vibe ai script-to-video "Introducing our new app. \
Simple dashboard for tracking metrics. \
One-click reports. \
Export to PDF or Excel. \
Start your free trial today." \
  -o ./ \
  --image-provider gemini \
  --images-only

# 3. Add narration
vibe ai tts "Introducing our new app. A simple dashboard for tracking all your metrics. Generate reports with one click. Export to PDF or Excel instantly. Start your free trial today." \
  -o narration.mp3

# 4. Add background music
vibe ai sfx "upbeat corporate background music" -o bgm.mp3 -d 30

# 5. Check generated assets
ls -la
# storyboard.json
# scene-1.png, scene-2.png, ...
# narration.mp3
# bgm.mp3
# project.vibe.json
```

### Example C: Highlight Reel from Event

Create a highlight reel from event footage.

```bash
# 1. Analyze video for highlights
vibe ai highlights event-footage.mp4 \
  -o highlights.json \
  -p highlight-project.vibe.json \
  --use-gemini \
  --criteria emotional \
  -d 120

# 2. View generated project
vibe project info highlight-project.vibe.json

# 3. Export final video
vibe export highlight-project.vibe.json -o highlight-reel.mp4
```

---

## Image Editing with Stability AI

```bash
# Upscale image (4x)
vibe ai sd-upscale input.png -o upscaled.png -s 4

# Remove background
vibe ai sd-remove-bg photo.png -o no-bg.png

# Image-to-image transformation
vibe ai sd-img2img photo.png "make it look like a watercolor painting" -o watercolor.png

# Replace objects
vibe ai sd-replace photo.png "car" "motorcycle" -o replaced.png

# Outpaint (extend image)
vibe ai sd-outpaint photo.png --left 200 --right 200 -o wider.png
```

---

## Project Commands

### Creating and Managing Projects

```bash
# Create new project
vibe project create "My Video" -o project.vibe.json

# View project info
vibe project info project.vibe.json

# Rename project
vibe project set project.vibe.json --name "New Name"
```

### Timeline Operations

```bash
# Add media source
vibe timeline add-source project.vibe.json video.mp4 -d 30

# Add clip to timeline
vibe timeline add-clip project.vibe.json source-1 -s 0 -d 10

# Add effect to clip
vibe timeline add-effect project.vibe.json clip-1 fadeIn -d 1

# List timeline contents
vibe timeline list project.vibe.json

# Trim clip
vibe timeline trim project.vibe.json clip-1 -d 5

# Split clip at timestamp
vibe timeline split project.vibe.json clip-1 -t 3

# Delete clip
vibe timeline delete project.vibe.json clip-1
```

### Batch Operations

```bash
# Import all MP4 files from directory
vibe batch import project.vibe.json ./videos/ --filter ".mp4"

# Concatenate all clips
vibe batch concat project.vibe.json --all

# Apply effect to all clips
vibe batch apply-effect project.vibe.json fadeIn --all
```

### Export

```bash
# Export with preset
vibe export project.vibe.json -o output.mp4 -p standard

# Presets: draft (360p), standard (720p), high (1080p), ultra (4K)

# Export with auto-confirm
vibe export project.vibe.json -o output.mp4 -p high -y
```

---

## Interactive REPL Mode

Start interactive mode for conversational editing:

```bash
vibe
```

**Available Commands:**

| Command | Description |
|---------|-------------|
| `new <name>` | Create new project |
| `open <path>` | Open project file |
| `save [path]` | Save current project |
| `info` | Show project information |
| `list` | List timeline contents |
| `add <file>` | Add media source |
| `undo` | Undo last action |
| `export [path]` | Render video |
| `help` | Show help |
| `exit` | Exit REPL |

**Natural Language Examples:**

```
vibe> "Add intro.mp4 to the timeline"
vibe> "Trim the first clip to 5 seconds"
vibe> "Add fade in effect to all clips"
vibe> "Split the clip at 3 seconds"
vibe> "Delete the last clip"
```

---

## Configuration

### Config File

Location: `~/.vibeframe/config.yaml`

```yaml
version: "1.0.0"
llm:
  provider: ollama          # claude, openai, gemini, ollama
providers:
  anthropic: sk-ant-...     # For Claude
  openai: sk-...            # For GPT-4, Whisper, DALL-E
  google: AIza...           # For Gemini
  elevenlabs: ...           # For TTS, SFX
  stability: sk-...         # For Stable Diffusion
  runway: ...               # For video generation
  kling: ...                # For video generation
defaults:
  aspectRatio: "16:9"
  exportQuality: standard
```

### Environment Variables

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
export GOOGLE_API_KEY="AIza..."
export ELEVENLABS_API_KEY="..."
export STABILITY_API_KEY="sk-..."
export RUNWAY_API_SECRET="..."
export KLING_API_KEY="..."
export REPLICATE_API_TOKEN="..."
```

---

## Troubleshooting

### "Command not found: vibe"

```bash
# Reinstall
curl -fsSL https://raw.githubusercontent.com/vericontext/vibeframe/main/scripts/install.sh | bash

# Or add to PATH manually
export PATH="$HOME/.vibeframe/packages/cli/dist:$PATH"
```

### "FFmpeg not found"

```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg

# Windows
winget install ffmpeg
```

### "API key invalid"

1. Verify your API key is correct
2. Check if the key has required permissions
3. Run `vibe setup` to re-enter the key

### Video analysis fails with large files

Use `--low-res` flag for videos longer than 30 minutes:

```bash
vibe ai highlights long-video.mp4 --use-gemini --low-res
```

---

## Getting Help

- **In-app:** `vibe --help` or `vibe ai --help`
- **REPL:** `vibe` then `help`
- **GitHub:** https://github.com/vericontext/vibeframe
- **Issues:** https://github.com/vericontext/vibeframe/issues
