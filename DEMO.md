# VibeFrame CLI Demo

Step-by-step demonstration matching the setup wizard use-cases.

## Prerequisites

```bash
# Install VibeFrame
curl -fsSL https://vibeframe.ai/install.sh | bash

# Create test media (5s color bars with tone)
mkdir -p demo
ffmpeg -y -f lavfi -i "testsrc2=duration=5:size=1280x720:rate=30" \
  -f lavfi -i "sine=frequency=440:duration=5" \
  -c:v libx264 -c:a aac -shortest demo/input.mp4

# Silent + speech simulation (3s silence + 2s tone + 3s silence)
ffmpeg -y -f lavfi -i "anullsrc=r=44100:cl=mono" -t 3 \
  -f lavfi -i "sine=frequency=440:duration=2" \
  -f lavfi -i "anullsrc=r=44100:cl=mono" -t 3 \
  -filter_complex "[0][1][2]concat=n=3:v=0:a=1" \
  -c:a aac demo/silence-test.mp4
```

---

## 1. Discovery (no API keys needed)

An AI agent can fully discover the CLI without any documentation.

```bash
# Top-level help
vibe --help

# All 107 commands as JSON
vibe schema --list --json

# JSON Schema for any command (types, enums, defaults, required)
vibe schema generate.video --json
vibe schema edit.caption --json

# System health — shows which providers are configured
vibe doctor --json

# Command group help with examples
vibe generate --help
vibe edit --help
vibe pipeline --help
```

---

## 2. Edit Videos (FREE — no API keys)

```bash
# Remove silence
vibe edit silence-cut demo/silence-test.mp4 -o demo/no-silence.mp4

# Fade in/out
vibe edit fade demo/input.mp4 -o demo/faded.mp4 --fade-in 1 --fade-out 1

# Noise reduction
vibe edit noise-reduce demo/input.mp4 -o demo/clean.mp4 -s medium

# Text overlay
vibe edit text-overlay demo/input.mp4 -t "VibeFrame Demo" -s center-bold -o demo/titled.mp4

# Scene & silence detection
vibe detect scenes demo/input.mp4 --json
vibe detect silence demo/silence-test.mp4 --json
```

---

## 3. Generate Images (requires GOOGLE_API_KEY)

```bash
# Default: Gemini Nano Banana
vibe generate image "a sunset over mountains, cinematic" -o demo/sunset.png

# OpenAI GPT Image
vibe generate image "a cute robot waving" -p openai -o demo/robot.png

# Grok Imagine
vibe generate image "neon city at night" -p grok -o demo/city.png

# Edit existing image
vibe edit image demo/sunset.png "add a bird flying in the sky" -o demo/sunset-bird.png
```

---

## 4. Generate Videos (requires XAI_API_KEY)

```bash
# Default: Grok Imagine Video (with native audio)
vibe generate video "ocean waves crashing on rocks" -o demo/waves.mp4 -d 5

# Preview without executing
vibe generate video "timelapse of a blooming flower" --dry-run --json

# Image-to-video
vibe generate video "the sunset comes alive" -i demo/sunset.png -o demo/sunset-alive.mp4

# Other providers
vibe generate video "aerial city view" -p kling -o demo/city.mp4
vibe generate video "epic landscape" -p runway -o demo/landscape.mp4
vibe generate video "underwater scene" -p veo -o demo/underwater.mp4
```

---

## 5. Text-to-Speech & Music (requires ELEVENLABS_API_KEY)

```bash
# Text-to-speech
vibe generate speech "Welcome to VibeFrame, the AI-native video editor." -o demo/welcome.mp3

# Sound effects
vibe generate sound-effect "thunderstorm with rain" -o demo/thunder.mp3 -d 5

# Music generation
vibe generate music "upbeat electronic background music" -o demo/bgm.mp3 -d 30
```

---

## 6. Full AI Pipeline (requires 3-4 keys)

```bash
# Script-to-video: script → storyboard → images → video → TTS → assembly
vibe pipeline script-to-video \
  "A morning routine of a startup founder. Scene 1: Alarm rings at 5am. Scene 2: Coffee and code review. Scene 3: Team standup meeting." \
  -o demo/startup/ -a 9:16 -d 60

# Extract highlights from long video
vibe pipeline highlights demo/input.mp4 -d 30 --json

# Auto-generate vertical shorts
vibe pipeline auto-shorts demo/input.mp4 -o demo/shorts/ -n 2 -d 30
```

---

## 7. Project Workflow

```bash
# Create project
vibe project create "My Demo" -o demo/project.vibe.json

# Add sources
vibe timeline add-source demo/project.vibe.json demo/input.mp4
# → returns source-id

# Add clip (use source-id from above)
vibe timeline add-clip demo/project.vibe.json <source-id>

# View timeline
vibe timeline list demo/project.vibe.json

# Export
vibe export demo/project.vibe.json -o demo/final.mp4 -y
```

---

## 8. Agent & Agentic Features

```bash
# Interactive natural language session
vibe
# > "remove silence from demo/input.mp4 and add captions"

# Non-interactive single query
vibe agent -i "what commands can edit video?" -p openai

# Stdin JSON input (for agent/script integration)
echo '{"provider":"kling","duration":5,"ratio":"9:16"}' | \
  vibe generate video "a cat on a rooftop" --stdin --dry-run --json

# Output modes
vibe doctor --json                                    # JSON output
vibe doctor --json --fields "readyCount,totalCount"   # Field filtering
vibe detect silence demo/silence-test.mp4 --quiet     # Value only
```

---

## Cleanup

```bash
rm -rf demo/
```
