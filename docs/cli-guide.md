# VibeFrame CLI Guide

Complete guide to using VibeFrame's command-line interface for AI-powered video editing.

---

## Installation

```bash
# Create a new directory and install
mkdir vibeframe-test && cd vibeframe-test
curl -fsSL https://raw.githubusercontent.com/vericontext/vibeframe/main/scripts/install.sh | bash
```

**Requirements:**
- Node.js 18+
- Git
- FFmpeg (recommended)

---

## Quick Start: First 5 Minutes

### Step 1: Verify Installation

```bash
vibe --version
# Expected: 0.1.0

vibe --help
# Shows all available commands
```

### Step 2: Configure API Keys

**Option A: Interactive Setup**
```bash
# Basic setup - LLM provider only (for REPL natural language parsing)
vibe setup

# Full setup - LLM + all optional providers (TTS, video gen, images, etc.)
vibe setup --full
```

| Mode | What it configures |
|------|-------------------|
| `vibe setup` | LLM provider (Claude/OpenAI/Gemini/Ollama) + its API key |
| `vibe setup --full` | LLM + ElevenLabs, Runway, Kling, Stability, Replicate |

**Option B: Environment Variables**
```bash
# Minimum for testing (Gemini covers image + video analysis)
export GOOGLE_API_KEY="AIza..."

# Full setup
export GOOGLE_API_KEY="AIza..."          # Gemini (image gen, video analysis)
export ELEVENLABS_API_KEY="..."          # TTS, SFX
export ANTHROPIC_API_KEY="sk-ant-..."    # Claude (storyboard, highlights)
export OPENAI_API_KEY="sk-..."           # Whisper (transcription), DALL-E
export STABILITY_API_KEY="sk-..."        # Stable Diffusion
```

**API Keys Required by Command:**

| Command | Required API Key |
|---------|-----------------|
| `vibe ai image` (default) | `GOOGLE_API_KEY` |
| `vibe ai image -p dalle` | `OPENAI_API_KEY` |
| `vibe ai image -p stability` | `STABILITY_API_KEY` |
| `vibe ai tts`, `sfx`, `voices` | `ELEVENLABS_API_KEY` |
| `vibe ai transcribe` | `OPENAI_API_KEY` |
| `vibe ai highlights` | `OPENAI_API_KEY` + `ANTHROPIC_API_KEY` |
| `vibe ai highlights --use-gemini` | `GOOGLE_API_KEY` |
| `vibe ai auto-shorts` | Same as highlights |
| `vibe ai storyboard` | `ANTHROPIC_API_KEY` |
| `vibe ai script-to-video` | `ANTHROPIC_API_KEY` + `GOOGLE_API_KEY` |
| `vibe ai video` | `RUNWAY_API_SECRET` |
| `vibe ai kling` | `KLING_API_KEY` |

### Step 3: Test AI Features (CLI Mode)

```bash
# Test 1: Image Generation (Gemini)
vibe ai image "a friendly robot mascot, 3D render style" -o test-image.png

# Test 2: Text-to-Speech (ElevenLabs)
vibe ai tts "Welcome to VibeFrame, the AI video editor." -o test-tts.mp3

# Test 3: Sound Effect (ElevenLabs)
vibe ai sfx "magical sparkle sound" -o test-sfx.mp3 -d 2
```

### Step 4: Test REPL Mode (Natural Language)

```bash
vibe
```

In REPL mode, natural language input is automatically converted to commands by the LLM:

```
vibe> create a new project
# → vibe project create "new project"

vibe> add intro.mp4 file
# → vibe timeline add-source intro.mp4

vibe> trim the first clip to 5 seconds
# → vibe timeline trim clip-1 -d 5

vibe> add fade-in effect to all clips
# → vibe batch apply-effect fadeIn --all

vibe> export the video
# → vibe export output.mp4
```

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

### 2. REPL Mode (Natural Language)

Interactive mode. Speak naturally and the LLM converts to commands.

```bash
vibe  # Start REPL
```

```
vibe> create a sunset image and save as sunset.png
vibe> create a new project called my-video
vibe> export the video
```

---

## AI Commands Reference

### Image Generation

**CLI Mode:**
```bash
# Gemini (default) - fast and high quality
vibe ai image "cute cat illustration" -o cat.png

# Portrait ratio (9:16)
vibe ai image "phone wallpaper, aurora" -o wallpaper.png -r 9:16

# Landscape ratio (16:9)
vibe ai image "cinematic landscape" -o landscape.png -r 16:9

# Use DALL-E
vibe ai image "abstract art" -o art.png -p dalle

# Use Stability AI (realistic images)
vibe ai image "professional headshot" -o headshot.png -p stability
```

**REPL Mode:**
```
vibe> create a cat illustration
vibe> generate an aurora background in portrait mode and save as wallpaper.png
vibe> draw abstract art using DALL-E
```

**Defaults:**
| Option | Default |
|--------|---------|
| `--provider` | `gemini` |
| `--ratio` | `1:1` |
| `--size` (DALL-E) | `1024x1024` |

---

### Text-to-Speech (TTS)

**CLI Mode:**
```bash
# Default voice (Rachel)
vibe ai tts "Hello, welcome to VibeFrame." -o greeting.mp3

# List available voices
vibe ai voices

# Use specific voice (Bella - soft female)
vibe ai tts "Welcome to our channel" -o intro.mp3 -v EXAVITQu4vr4xnSDxMaL

# Long narration
vibe ai tts "This is a longer narration for a video. It explains the product features in detail." -o narration.mp3
```

**REPL Mode:**
```
vibe> convert "Hello" to speech
vibe> show available voices
vibe> create intro narration with Bella voice
```

**Defaults:**
| Option | Default |
|--------|---------|
| `--voice` | `Rachel` (21m00Tcm4TlvDq8ikWAM) |
| `--output` | `output.mp3` |

---

### Sound Effects (SFX)

**CLI Mode:**
```bash
# Transition sound
vibe ai sfx "whoosh transition" -o whoosh.mp3 -d 2

# Notification sound
vibe ai sfx "notification ding" -o ding.mp3 -d 1

# Ambient sound
vibe ai sfx "rain on window" -o rain.mp3 -d 10

# Impact sound
vibe ai sfx "cinematic boom impact" -o boom.mp3 -d 3

# Typing sound
vibe ai sfx "keyboard typing" -o typing.mp3 -d 5
```

**REPL Mode:**
```
vibe> create a whoosh transition sound effect
vibe> generate 10 seconds of rain sound
vibe> make a cinematic impact sound
```

**Defaults:**
| Option | Default |
|--------|---------|
| `--duration` | auto (AI decides) |
| `--output` | `sound-effect.mp3` |

---

### Transcription (Audio to Subtitles)

**CLI Mode:**
```bash
# Generate SRT subtitles
vibe ai transcribe interview.mp3 -o subtitles.srt

# VTT format
vibe ai transcribe podcast.mp3 -o subtitles.vtt

# Korean language hint
vibe ai transcribe korean-audio.mp3 -o subs.srt -l ko

# English language hint
vibe ai transcribe english-audio.mp3 -o subs.srt -l en
```

**REPL Mode:**
```
vibe> create subtitles for interview.mp3
vibe> convert podcast audio to VTT format
vibe> extract subtitles from Korean audio
```

---

### Video Generation (Image-to-Video)

**CLI Mode:**
```bash
# Runway Gen-3 (default)
vibe ai video "camera slowly zooms in, cinematic" -i photo.png -o video.mp4

# Kling AI
vibe ai kling "dramatic lighting change" -i scene.png -o dramatic.mp4

# Check generation status
vibe ai video-status abc123

# Cancel generation
vibe ai video-cancel abc123
```

**REPL Mode:**
```
vibe> turn photo.png into a video with slow zoom in
vibe> generate dramatic video with Kling
vibe> check video generation status
```

---

## Advanced Workflows

### 1. Script-to-Video

Automatically convert text scripts into images/videos.

**CLI Mode:**
```bash
# Generate images only (quick test)
vibe ai script-to-video "Space exploration story. Rocket launch. Astronauts. Earth view." \
  -o ./space-video/ \
  --images-only \
  --no-voiceover

# Gemini images + narration
vibe ai script-to-video "Product intro. Dashboard screen. Report generation. Call to action." \
  -o ./demo/ \
  --image-provider gemini

# Use DALL-E images
vibe ai script-to-video "Fantasy world. Magical forest. Dragon and knight." \
  -o ./fantasy/ \
  --image-provider dalle \
  --images-only

# Stability AI images (realistic)
vibe ai script-to-video "Cooking recipe. Ingredient prep. Cooking process. Final dish." \
  -o ./cooking/ \
  --image-provider stability \
  --images-only
```

**REPL Mode:**
```
vibe> create a video from the script "space exploration story"
vibe> generate product intro script with Gemini images
vibe> make a cooking recipe video with realistic images
```

**Output:**
```
./space-video/
├── storyboard.json      # Scene composition
├── scene-1.png          # Rocket launch
├── scene-2.png          # Astronauts
├── scene-3.png          # Earth view
├── voiceover.mp3        # Narration (optional)
└── project.vibe.json    # Project file
```

---

### 2. Highlights Extraction

Automatically extract best moments from long videos.

**CLI Mode:**
```bash
# Default (Whisper + Claude, audio analysis)
vibe ai highlights lecture.mp4 -o highlights.json

# Gemini Video (visual + audio analysis) - recommended
vibe ai highlights lecture.mp4 -o highlights.json --use-gemini

# Emotional moments only
vibe ai highlights wedding.mp4 -o highlights.json --use-gemini --criteria emotional

# Informative moments only
vibe ai highlights tutorial.mp4 -o highlights.json --use-gemini --criteria informative

# Funny moments only
vibe ai highlights comedy.mp4 -o highlights.json --use-gemini --criteria funny

# Max 5 highlights, 80% confidence threshold
vibe ai highlights video.mp4 -o highlights.json --use-gemini -n 5 -t 0.8

# Target 60-second highlight reel
vibe ai highlights video.mp4 -o highlights.json --use-gemini -d 60

# Long videos (low resolution mode)
vibe ai highlights long-video.mp4 -o highlights.json --use-gemini --low-res

# Generate project file
vibe ai highlights event.mp4 -o hl.json -p highlight-reel.vibe.json --use-gemini
```

**REPL Mode:**
```
vibe> extract highlights from the lecture video
vibe> find emotional moments in the wedding video
vibe> get the important parts from the tutorial
vibe> find 5 funny moments in this video
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

### 3. Auto-Shorts

Automatically convert long videos into TikTok/Reels/Shorts clips.

**CLI Mode:**
```bash
# Analyze only (preview)
vibe ai auto-shorts podcast.mp4 -n 5 --analyze-only --use-gemini

# TikTok/Reels format (9:16)
vibe ai auto-shorts podcast.mp4 \
  -n 3 \
  -d 30 \
  --output-dir ./shorts/ \
  --use-gemini \
  -a 9:16

# YouTube Shorts format (60 seconds)
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

# Long videos (low resolution mode)
vibe ai auto-shorts webinar.mp4 \
  -n 5 \
  --output-dir ./clips/ \
  --use-gemini \
  --low-res
```

**REPL Mode:**
```
vibe> create 3 short clips from the podcast
vibe> cut the interview video for TikTok
vibe> make Instagram square clips from the vlog
vibe> find viral-worthy moments in this video
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

Analyze video content and Q&A with Gemini.

**CLI Mode:**
```bash
# Summary
vibe ai gemini-video video.mp4 "Summarize this video in 3 sentences"

# Extract timestamps
vibe ai gemini-video tutorial.mp4 "List the main steps with timestamps"

# Q&A
vibe ai gemini-video product.mp4 "What is the product name in this video?"

# YouTube URL analysis
vibe ai gemini-video "https://youtube.com/watch?v=xxx" "What is the video about?"

# Action videos (high FPS)
vibe ai gemini-video sports.mp4 "Find the scoring moments" --fps 5

# Analyze specific segment
vibe ai gemini-video movie.mp4 "What happens in this scene?" --start 60 --end 120

# Long videos (low resolution)
vibe ai gemini-video lecture.mp4 "Create an outline" --low-res
```

**REPL Mode:**
```
vibe> summarize this video
vibe> extract timestamps from the tutorial
vibe> what product is shown in the video?
vibe> analyze this YouTube video
vibe> what happens between 60 seconds and 2 minutes?
```

---

## Image Editing (Stability AI)

**CLI Mode:**
```bash
# Upscale (4x)
vibe ai sd-upscale small.png -o large.png -s 4

# Remove background
vibe ai sd-remove-bg photo.png -o no-bg.png

# Image transformation
vibe ai sd-img2img photo.png "watercolor style" -o watercolor.png
vibe ai sd-img2img photo.png "cyberpunk style" -o cyberpunk.png
vibe ai sd-img2img photo.png "anime style" -o anime.png

# Object replacement
vibe ai sd-replace photo.png "car" "motorcycle" -o replaced.png
vibe ai sd-replace room.png "chair" "sofa" -o new-room.png

# Outpainting (extend image)
vibe ai sd-outpaint photo.png --left 200 --right 200 -o wider.png
vibe ai sd-outpaint portrait.png --up 100 --down 100 -o taller.png
```

**REPL Mode:**
```
vibe> upscale the image 4x
vibe> remove the photo background
vibe> convert this photo to watercolor style
vibe> replace the car with a motorcycle
vibe> extend the image horizontally
```

---

## Project Management

### Creating Projects

**CLI Mode:**
```bash
vibe project create "My Video" -o project.vibe.json
vibe project info project.vibe.json
vibe project set project.vibe.json --name "New Name"
```

**REPL Mode:**
```
vibe> create a new project
vibe> show project info
vibe> rename the project
```

### Timeline Operations

**CLI Mode:**
```bash
# Add source
vibe timeline add-source project.vibe.json intro.mp4 -d 30

# Add clip
vibe timeline add-clip project.vibe.json source-1 -s 0 -d 10

# Add effect
vibe timeline add-effect project.vibe.json clip-1 fadeIn -d 1

# View timeline
vibe timeline list project.vibe.json

# Trim clip
vibe timeline trim project.vibe.json clip-1 -d 5

# Split clip
vibe timeline split project.vibe.json clip-1 -t 3

# Delete clip
vibe timeline delete project.vibe.json clip-1
```

**REPL Mode:**
```
vibe> add intro.mp4
vibe> create a 10-second clip from the first source
vibe> add fade-in to clip-1
vibe> show timeline
vibe> trim the first clip to 5 seconds
vibe> split the clip at 3 seconds
vibe> delete the last clip
```

### Batch Operations

**CLI Mode:**
```bash
vibe batch import project.vibe.json ./videos/ --filter ".mp4"
vibe batch concat project.vibe.json --all
vibe batch apply-effect project.vibe.json fadeIn --all
```

**REPL Mode:**
```
vibe> import all mp4 files from videos folder
vibe> concatenate all clips
vibe> apply fade-in to all clips
```

### Export

**CLI Mode:**
```bash
vibe export project.vibe.json -o output.mp4 -p standard
vibe export project.vibe.json -o output.mp4 -p high -y
```

**REPL Mode:**
```
vibe> export the video
vibe> export in high quality
vibe> save as output.mp4
```

**Presets:**
| Preset | Resolution |
|--------|------------|
| `draft` | 360p |
| `standard` | 720p |
| `high` | 1080p |
| `ultra` | 4K |

---

## Complete Workflow Examples

### Example A: Podcast → Short Clips

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

**Using REPL:**
```
vibe> find 5 viral-worthy moments in podcast.mp4
vibe> convert them to vertical TikTok videos
```

### Example B: Script → Product Demo

```bash
# 1. Create folder
mkdir demo && cd demo

# 2. Generate images from script
vibe ai script-to-video "Product intro. Dashboard. Reports. Call to action." \
  -o ./ \
  --image-provider gemini \
  --images-only

# 3. Add narration
vibe ai tts "Introducing our new dashboard. See all your data at a glance." \
  -o narration.mp3

# 4. Add background music
vibe ai sfx "upbeat corporate music" -o bgm.mp3 -d 30

# 5. Check results
ls -la
```

**Using REPL:**
```
vibe> create images from "product intro video" script
vibe> generate narration audio
vibe> create background music
```

### Example C: Event → Highlight Reel

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

**Using REPL:**
```
vibe> find emotional moments in event.mp4 and create a 2-minute highlight reel
vibe> show project info
vibe> export in high quality
```

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
  provider: claude          # claude, openai, gemini, ollama
providers:
  anthropic: sk-ant-...     # Claude
  openai: sk-...            # GPT, Whisper, DALL-E
  google: AIza...           # Gemini
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
export GOOGLE_API_KEY="AIza..."          # Gemini (image, video analysis)
export ELEVENLABS_API_KEY="..."          # TTS, SFX
export ANTHROPIC_API_KEY="sk-ant-..."    # Claude
export OPENAI_API_KEY="sk-..."           # Whisper, DALL-E
export STABILITY_API_KEY="sk-..."        # Stable Diffusion
export RUNWAY_API_SECRET="..."           # Runway
export KLING_API_KEY="..."               # Kling
```

---

## Troubleshooting

### "Command not found: vibe"
```bash
curl -fsSL https://raw.githubusercontent.com/vericontext/vibeframe/main/scripts/install.sh | bash
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
