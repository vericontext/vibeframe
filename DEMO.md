# VibeFrame Demo

From install to "wow" in 5 minutes.

---

## 0. Install + Setup (30 sec)

```bash
# One-line install
curl -fsSL https://vibeframe.ai/install.sh | bash

# Setup wizard — pick what you need
vibe setup

#   1. Edit videos offline (FREE)
#   2. AI features (images, videos, audio, editing)
#   3. Full AI pipeline
#   4. Custom setup

# Verify
vibe doctor
```

---

## 1. Edit Right Now (no API keys)

Grab any video you have. No setup, no API keys, no waiting.

```bash
# Remove dead air from an interview
vibe edit silence-cut interview.mp4 -o clean.mp4

# Add fade in/out
vibe edit fade clean.mp4 -o faded.mp4 --fade-in 1 --fade-out 1

# Remove background noise
vibe edit noise-reduce noisy-recording.mp4 -o clean.mp4 -s high

# Burn a title into the video
vibe edit text-overlay faded.mp4 -t "My First Edit" -s center-bold -o titled.mp4

# Detect scene changes
vibe detect scenes video.mp4 --json

# Detect silent gaps
vibe detect silence video.mp4 --json
```

---

## 2. One Key, Big Impact

Each section needs just one API key. Set up only what you use.

### Images (GOOGLE_API_KEY)

```bash
# Generate an image
vibe generate image "a cozy coffee shop in the rain, cinematic lighting" -o coffee.png

# Edit it
vibe edit image coffee.png "add steam rising from a cup" -o coffee-steam.png

# Turn it into a video
vibe generate video "camera slowly pushes into the coffee shop" -i coffee-steam.png -o coffee.mp4
```

### Videos (XAI_API_KEY)

```bash
# Text-to-video with native audio
vibe generate video "ocean waves crashing on rocks at golden hour" -o waves.mp4 -d 5

# Image-to-video
vibe generate video "the city wakes up at dawn" -i skyline.png -o dawn.mp4
```

### Audio (ELEVENLABS_API_KEY)

```bash
# Narration
vibe generate speech "Every great story starts with a single frame." -o narration.mp3

# Sound effects
vibe generate sound-effect "gentle rain on a window" -o rain.mp3 -d 10

# Background music
vibe generate music "lo-fi chill beat, relaxing" -o bgm.mp3 -d 30
```

### AI Editing (OPENAI_API_KEY + ANTHROPIC_API_KEY)

```bash
# Auto-transcribe and burn captions
vibe edit caption video.mp4 -o captioned.mp4 -s bold

# Cinematic color grade
vibe edit grade video.mp4 -o graded.mp4 --preset cinematic-warm

# Smart reframe: landscape → vertical
vibe edit reframe video.mp4 -o vertical.mp4 -a 9:16

# Motion graphics overlay
vibe generate motion "minimal lower-third with the text 'VibeFrame Demo'" \
  --render --video video.mp4 -o with-graphics.mp4
```

---

## 3. Compose: Chain Commands

Build a complete video by chaining CLI commands. This is exactly what Claude Code or Codex would do.

```bash
# 1. Generate a hero image
vibe generate image "a startup founder coding at sunrise" -o hero.png

# 2. Bring it to life as video
vibe generate video "the founder types code, sun rises through the window" \
  -i hero.png -o hero.mp4 -d 5

# 3. Add narration
vibe generate speech "Building the future, one line at a time." -o voice.mp3

# 4. Add background music
vibe generate music "inspiring ambient, minimal" -o bgm.mp3 -d 10

# 5. Assemble into a project
vibe project create "Startup Intro" -o project.vibe.json
vibe timeline add-source project.vibe.json hero.mp4
vibe timeline add-source project.vibe.json voice.mp3
vibe timeline add-source project.vibe.json bgm.mp3

# 6. Export
vibe export project.vibe.json -o startup-intro.mp4 -y
```

---

## 4. Full Pipeline: Script to Video

One command. Complete video. This is the "wow" moment.

```bash
vibe pipeline script-to-video \
  "Scene 1: A developer wakes up at 5am, alarm buzzing.
   Scene 2: Coffee brewing while reviewing pull requests on a laptop.
   Scene 3: Team standup — everyone shares progress on the product launch." \
  -o ./startup-video/ -a 9:16 -d 60

# Review what was generated
ls ./startup-video/

# Regenerate a specific scene if needed
vibe pipeline regenerate-scene ./startup-video/ --scene 2

# Extract highlights from any long video
vibe pipeline highlights long-interview.mp4 -d 60

# Auto-generate vertical shorts
vibe pipeline auto-shorts podcast.mp4 -o ./shorts/ -n 3 -d 30
```

---

## 5. For AI Agents

The CLI is fully self-discoverable. No docs needed.

```bash
# Discover all commands
vibe schema --list --json

# Get JSON Schema for any command
vibe schema generate.video --json

# Preview before executing
vibe generate video "test" --dry-run --json

# Pipe options as JSON
echo '{"provider":"kling","duration":5}' | vibe generate video "sunset" --stdin --json

# Check available providers
vibe doctor --json
```

---

## Cleanup

```bash
rm -f coffee.png coffee-steam.png coffee.mp4 waves.mp4 dawn.mp4
rm -f narration.mp3 rain.mp3 bgm.mp3 voice.mp3 hero.png hero.mp4
rm -f project.vibe.json startup-intro.mp4
rm -rf ./startup-video/ ./shorts/
```
