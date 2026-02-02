# VibeFrame CLI Guide

Complete guide to using VibeFrame's command-line interface for AI-powered video editing.

## Quick Start

Get started with VibeFrame in 5 minutes:

### 1. Install

```bash
# Default: CLI-only installation (fastest)
curl -fsSL https://vibeframe.ai/install.sh | bash

# Full installation (includes web UI)
curl -fsSL https://vibeframe.ai/install.sh | bash -s -- --full
```

### 2. Configure

```bash
vibe setup
```

Choose your preferred LLM provider:
- **Ollama** - Free, runs locally, no API key needed
- **Claude** - Most capable, requires Anthropic API key
- **OpenAI** - GPT-4, requires OpenAI API key
- **Gemini** - Google AI, requires Google API key

### 3. Create Your First Project

```bash
vibe                    # Start interactive mode
vibe> new my-video      # Create project
vibe> add intro.mp4     # Add media
vibe> trim clip-1 to 5s # Edit with natural language
vibe> export            # Render video
```

---

## AI Provider Structure

VibeFrame uses a pluggable AI provider system. Different providers serve different purposes.

### LLM Providers (Natural Language Commands)

These providers interpret your natural language commands and translate them into editing operations.

| Provider | Model | API Key Required | Best For |
|----------|-------|------------------|----------|
| **Ollama** | llama3.2 (default) | No (local) | Offline use, privacy, free |
| **Claude** | claude-sonnet-4-20250514 | `ANTHROPIC_API_KEY` | Complex edits, best understanding |
| **OpenAI** | gpt-4o-mini | `OPENAI_API_KEY` | General purpose |
| **Gemini** | gemini-1.5-flash | `GOOGLE_API_KEY` | Fast responses |

**Setting the LLM provider:**
```bash
vibe setup              # Interactive setup
# Or in ~/.vibeframe/config.yaml:
# llm:
#   provider: ollama    # claude, openai, gemini
```

### Media Processing Providers

These providers handle media generation and transformation tasks.

| Provider | Capabilities | API Key |
|----------|-------------|---------|
| **Whisper** | Speech-to-text transcription | `OPENAI_API_KEY` |
| **ElevenLabs** | Text-to-speech, voice cloning, SFX | `ELEVENLABS_API_KEY` |
| **DALL-E** | Image generation | `OPENAI_API_KEY` |
| **Gemini Imagen 3** | Image generation (high quality) | `GOOGLE_API_KEY` |
| **Stability AI** | Image generation, editing, inpainting | `STABILITY_API_KEY` |
| **Runway** | Video generation (Gen-3) | `RUNWAY_API_SECRET` |
| **Kling** | Video generation | `KLING_API_KEY` |
| **Replicate** | Various AI models | `REPLICATE_API_TOKEN` |

---

## Command Reference

### Project Commands

| Command | Description | Example |
|---------|-------------|---------|
| `new <name>` | Create new project | `new my-video` |
| `open <path>` | Open project file | `open project.vibe.json` |
| `save [path]` | Save current project | `save`, `save backup.vibe.json` |
| `info` | Show project information | `info` |
| `export [path]` | Render video | `export`, `export output.mp4` |

### Media Commands

| Command | Description | Example |
|---------|-------------|---------|
| `add <file>` | Add media source | `add intro.mp4` |
| `list` | List timeline contents | `list` |

### Editing Commands

| Command | Description | Example |
|---------|-------------|---------|
| `undo` | Undo last action | `undo` |

### Natural Language Examples

```bash
vibe> "Add intro.mp4 to the timeline"
vibe> "Trim the first clip to 5 seconds"
vibe> "Add fade in effect to all clips"
vibe> "Split the clip at 3 seconds"
vibe> "Delete the last clip"
vibe> "Move clip-2 to the beginning"
vibe> "Add a crossfade between clip-1 and clip-2"
```

### CLI Commands (Non-Interactive)

For scripting and automation, use CLI commands directly:

**Project Management**
```bash
vibe project create <name> -o <output.vibe.json>
vibe project info <project.vibe.json>
vibe project set <project> --name "New Name"
```

**Timeline Operations**
```bash
vibe timeline add-source <project> <media> -d <duration>
vibe timeline add-clip <project> <source-id> -s <start> -d <duration>
vibe timeline add-effect <project> <clip-id> fadeIn -d 1
vibe timeline list <project>
vibe timeline trim <project> <clip-id> -d <duration>
vibe timeline split <project> <clip-id> -t <time>
vibe timeline delete <project> <clip-id>
```

**Batch Operations**
```bash
vibe batch import <project> <directory> --filter ".mp4"
vibe batch concat <project> --all
vibe batch apply-effect <project> fadeIn --all
vibe batch info <project>
```

**AI Commands**
```bash
# Natural language editing (uses configured LLM)
vibe ai edit <project> "trim all clips to 10 seconds"

# Text-to-speech
vibe ai tts "Your text here" -o output.mp3

# Image generation (supports: dalle, gemini, stability)
vibe ai image "description" -o output.png                    # Default: DALL-E
vibe ai image "description" -o output.png -p gemini          # Gemini Imagen 3
vibe ai image "description" -o output.png -p stability       # Stability AI

# Video generation (supports: runway, kling)
vibe ai video "description" -o output.mp4                    # Default: Runway
vibe ai video "description" -o output.mp4 -p kling           # Kling AI
vibe ai video "description" -i ref.png -o output.mp4         # Image-to-video

# Motion graphics (Remotion + Claude)
vibe ai motion "animated title card for YouTube" -o title.tsx
vibe ai motion "lower third with name" -o lower.tsx -s corporate

# Storyboard generation
vibe ai storyboard "content" -d 30 -o storyboard.json

# Sound effects
vibe ai sfx "whoosh sound" -o effect.mp3

# Transcription
vibe ai transcribe audio.mp3 -o subtitles.srt

# Image editing (Stability AI)
vibe ai sd-img2img input.png "make it look vintage" -o output.png
vibe ai sd-replace input.png "cat" "dog" -o output.png
vibe ai sd-outpaint input.png --left 200 --right 200 -o wider.png
vibe ai sd-remove-bg input.png -o no-bg.png
```

**Export**
```bash
vibe export <project> -o output.mp4 -p standard -y
# Presets: draft (360p), standard (720p), high (1080p), ultra (4K)
```

---

## API Requirements by Feature

### Features That Work Offline (No API Key)

These features work without any API key:

- **Basic editing** - Cut, trim, split, delete, move clips
- **Timeline manipulation** - Reorder tracks, adjust timing
- **Effects** - Fade in/out, crossfade (using FFmpeg)
- **Export** - Render video to file
- **Project management** - Save, load, organize projects

With **Ollama** (local LLM), you also get:
- **Natural language commands** - Control editing with plain English
- **AI-assisted editing** - Intelligent suggestions and automation

### Features Requiring API Keys

| Feature | Required API Key | Provider |
|---------|------------------|----------|
| Natural language commands | One LLM provider | Claude, OpenAI, Gemini, or Ollama (free) |
| Speech-to-text transcription | `OPENAI_API_KEY` | Whisper |
| Auto-generate subtitles | `OPENAI_API_KEY` | Whisper |
| Text-to-speech narration | `ELEVENLABS_API_KEY` | ElevenLabs |
| Voice cloning | `ELEVENLABS_API_KEY` | ElevenLabs |
| AI image generation | `OPENAI_API_KEY` or `STABILITY_API_KEY` | DALL-E or Stability |
| AI video generation | `RUNWAY_API_SECRET` or `KLING_API_KEY` | Runway or Kling |

---

## Workflow Examples

### Example 1: Quick Social Media Clip

```bash
vibe
vibe> new tiktok-video
vibe> add raw-footage.mp4
vibe> "Trim to the best 15 seconds"
vibe> "Add vertical crop for TikTok"
vibe> "Add captions"
vibe> export output-9x16.mp4
```

### Example 2: YouTube Video with Intro

```bash
vibe
vibe> new youtube-tutorial
vibe> add intro-template.mp4
vibe> add screen-recording.mp4
vibe> add outro.mp4
vibe> "Add fade transition between all clips"
vibe> "Speed up the middle section by 1.5x"
vibe> export final.mp4
```

### Example 3: Podcast with Subtitles

```bash
vibe
vibe> new podcast-ep1
vibe> add audio.mp3
vibe> add background.jpg
vibe> "Generate subtitles from audio"      # Requires OPENAI_API_KEY
vibe> "Style subtitles for YouTube"
vibe> export podcast-ep1.mp4
```

### Example 4: AI-Generated Content

```bash
vibe
vibe> new ai-short
vibe> "Generate a 5-second intro video about nature"  # Requires Runway/Kling
vibe> "Add voiceover: Welcome to our channel"         # Requires ElevenLabs
vibe> "Generate background music"
vibe> export ai-generated.mp4
```

### Example 5: Multi-Provider Promo Video (Advanced)

Create a professional promotional video using multiple AI providers together.

**What you'll use:**
- **Claude** - Storyboard generation
- **ElevenLabs** - TTS narration + sound effects
- **DALL-E** - Visual assets (logo, UI mockups)
- **OpenAI GPT** - Natural language editing

**Step 1: Write script and generate storyboard (Claude)**

```bash
# Create script file
cat > promo/script.txt << 'EOF'
VibeFrame: Edit Videos with Your Voice.
Tired of complex video editing software?
Just type what you want. That's it.
No timelines. No buttons. Your words become edits.
Open source. Free forever.
EOF

# Generate storyboard with Claude
vibe ai storyboard promo/script.txt -f -d 30 -o promo/storyboard.json
```

**Step 2: Generate narration (ElevenLabs TTS)**

```bash
# List available voices
vibe ai voices

# Generate TTS narration
vibe ai tts "Tired of complex video editing? Meet VibeFrame. \
Just type what you want. Trim clips. Add effects. Export. \
Your words become edits. Open source. Free forever." \
  -v EXAVITQu4vr4xnSDxMaL -o promo/narration.mp3
```

**Step 3: Generate visual assets (DALL-E)**

```bash
# Generate logo
vibe ai image "Futuristic minimalist logo for VibeFrame video editor, \
purple and blue gradients, dark background" -o promo/logo.png

# Generate UI mockup
vibe ai image "Clean terminal interface showing video editing commands, \
dark theme, purple accents" -o promo/terminal-ui.png
```

**Step 4: Generate sound effects (ElevenLabs SFX)**

```bash
vibe ai sfx "digital whoosh transition, modern tech" \
  -o promo/whoosh.mp3 --duration 2
```

**Step 5: Create project and edit with natural language (OpenAI GPT)**

```bash
# Create project with B-roll videos
vibe project create "promo" -o promo/promo.vibe.json
vibe timeline add-source promo/promo.vibe.json footage1.mp4 -d 40
vibe timeline add-source promo/promo.vibe.json footage2.mp4 -d 40
vibe batch concat promo/promo.vibe.json --all

# Edit with natural language
vibe ai edit promo/promo.vibe.json "trim first clip to 15 seconds, \
trim second clip to 15 seconds, add fade in to first clip, \
add fade out to second clip"

# Export video
vibe export promo/promo.vibe.json -o promo/video.mp4 -p standard
```

**Step 6: Mix audio with FFmpeg**

```bash
# Combine video with narration
ffmpeg -y -i promo/video.mp4 -i promo/narration.mp3 \
  -filter_complex "[0:a]volume=0.3[bg];[1:a][bg]amix=inputs=2[aout]" \
  -map 0:v -map "[aout]" -c:v copy -c:a aac \
  promo/final.mp4
```

**Result:** A 24-second promo video with:
- AI-generated storyboard structure
- Professional TTS narration
- Custom visual assets
- Natural language edited B-roll
- Mixed audio track

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
  provider: ollama          # claude, openai, gemini, ollama
providers:
  anthropic: sk-ant-...     # For Claude
  openai: sk-...            # For GPT-4, Whisper, DALL-E
  google: AIza...           # For Gemini
  elevenlabs: ...           # For TTS
  stability: sk-...         # For image generation
  runway: ...               # For video generation
  kling: ...                # For video generation
defaults:
  aspectRatio: "16:9"       # 16:9, 9:16, 1:1, 4:5
  exportQuality: standard   # draft, standard, high, ultra
repl:
  autoSave: true
```

### Environment Variable Fallbacks

API keys can also be set via environment variables:

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

The CLI checks environment variables if no key is found in the config file.

---

## Troubleshooting

### "No LLM provider configured"

**Problem:** Natural language commands aren't working.

**Solution:**
1. Run `vibe setup` to configure a provider
2. Or use Ollama for free local AI:
   ```bash
   # Install Ollama: https://ollama.ai
   ollama serve              # Start server
   ollama pull llama3.2      # Download model
   vibe setup                # Select Ollama
   ```

### "Ollama server not running"

**Problem:** Ollama is configured but commands fail.

**Solution:**
```bash
# Start Ollama server
ollama serve

# Verify it's running
curl http://localhost:11434/api/tags

# Pull the model if needed
ollama pull llama3.2
```

### "API key invalid"

**Problem:** Commands fail with authentication errors.

**Solution:**
1. Verify your API key is correct
2. Check if the key has the required permissions
3. Run `vibe setup` to re-enter the key
4. Check environment variables aren't overriding config

### "FFmpeg not found"

**Problem:** Export fails or video processing doesn't work.

**Solution:**
```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg

# Windows
winget install ffmpeg
```

### "Command not found: vibe"

**Problem:** CLI not in PATH after installation.

**Solution:**
```bash
# Add to PATH (add to ~/.bashrc or ~/.zshrc)
export PATH="$HOME/.vibeframe/packages/cli/dist:$PATH"

# Or reinstall
curl -fsSL https://vibeframe.ai/install.sh | bash
```

### Project file corrupted

**Problem:** Can't open a `.vibe.json` file.

**Solution:**
1. Check the JSON syntax with a validator
2. Look for backup files: `*.vibe.json.bak`
3. The file format is documented in the schema

---

## Tips & Best Practices

### 1. Start Simple

Begin with basic commands before trying complex natural language:
```bash
vibe> add video.mp4          # Simple
vibe> list                   # Check what you have
vibe> "trim clip-1 to 10s"   # Then use NL
```

### 2. Use Ollama for Offline Work

Set up Ollama once and you can edit anywhere:
```bash
ollama pull llama3.2         # ~2GB download
vibe setup                   # Select Ollama
# Now works offline!
```

### 3. Save Frequently

Enable auto-save or save manually:
```bash
vibe> save                   # Manual save
vibe> save backup.vibe.json  # Named backup
```

### 4. Check Project Info

Use `info` to understand your project state:
```bash
vibe> info
# Shows: duration, clips, tracks, sources
```

### 5. Use Tab Completion

The REPL supports tab completion for:
- File paths
- Command names
- Clip IDs

---

## Getting Help

- **In-app help:** `vibe> help`
- **Command help:** `vibe --help`
- **Documentation:** https://github.com/vericontext/vibeframe
- **Issues:** https://github.com/vericontext/vibeframe/issues
