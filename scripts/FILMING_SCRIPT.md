# VibeFrame Demo Filming Script

> Open this on a second monitor. Start screen recording, then follow step by step.
> You'll work in a fresh empty folder — no project clone needed.

## Before Recording (off-camera)

```bash
# 1. Terminal: dark theme, font 15pt+, Do Not Disturb ON

# 2. Set API keys in advance
#    OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY,
#    ELEVENLABS_API_KEY, KLING_API_KEY

# 3. Clean previous install (fresh start for demo)
rm -rf ~/.vibeframe ~/.local/bin/vibe

# 4. Create a fresh demo folder and go there
mkdir -p ~/vibeframe-demo && cd ~/vibeframe-demo

# 5. Copy .env with API keys to the demo folder
#    Agent mode and AI commands look for .env in the working directory
cp ~/.vibeframe/.env ~/vibeframe-demo/.env  # or create manually

# 6. Clear terminal
clear
```

---

## START RECORDING

---

### Scene 1: Install VibeFrame (1-2 min)

Type:
```bash
curl -fsSL https://vibeframe.ai/install.sh | bash
```

> You'll see:
> - Banner
> - Dependency check (Node, Git, FFmpeg)
> - Clone repo
> - Install deps + build
> - Symlink created
> - "Run setup wizard now?" → press `n` (skip for demo)

After install completes, verify:
```bash
vibe --version
```

> Shows `0.19.2`. Pause 2s.

---

### Scene 2: Script-to-Video Pipeline (3-5 min)

```bash
clear
```

Type:
```bash
vibe ai script-to-video \
  "A developer types one command. AI generates visuals. A finished video plays back." \
  --voice rachel \
  --image-provider gemini \
  --generator kling
```

> Pipeline runs 5 steps:
> 1. Storyboard (Claude)
> 2. TTS narration (ElevenLabs)
> 3. Images (Gemini)
> 4. Videos (Kling)
> 5. Assembly
>
> Wait for "Done!". Project file is in `script-video-output/`.

Then export to a final video:
```bash
vibe export script-video.vibe.json -o final.mp4 -p high
```

> Merges all scenes into one MP4. Wait for completion.

---

### Scene 3: Post-Production Combo (2-3 min)

```bash
clear
```

Download a sample video (Tim Urban TED Talk — "Inside the Mind of a Procrastinator", ~2 min clip):
```bash
curl -L -o /tmp/ted.mp4 "https://download.ted.com/talks/TimUrban_2016.mp4"
ffmpeg -y -i /tmp/ted.mp4 -ss 00:00:30 -t 120 -c copy sample.mp4
```

> Or use your own video: `cp ~/Desktop/my-video.mp4 sample.mp4`
>
> **Other free sample videos to try:**
> | Video | Content | Command |
> |-------|---------|---------|
> | Simon Sinek TED | How Great Leaders Inspire Action (~59MB) | `curl -L -o sample.mp4 "https://download.ted.com/talks/SimonSinek_2009X.mp4"` |
> | Brene Brown TED | The Power of Vulnerability (~66MB) | `curl -L -o sample.mp4 "https://download.ted.com/talks/BreneBrown_2010X.mp4"` |
> | Tears of Steel | Blender open movie with dialogue (~185MB) | `curl -L -o sample.mp4 "https://storage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4"` |
> | VW GTI Review | Car review narration (~3 min) | `curl -L -o sample.mp4 "https://storage.googleapis.com/gtv-videos-bucket/sample/VolkswagenGTIReview.mp4"` |
> | Big Buck Bunny | Animation, music only — no speech (~10 min) | `curl -L -o sample.mp4 "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"` |

Then run 4 commands one by one. Wait for each to finish:

**1. Denoise:**
```bash
vibe ai noise-reduce sample.mp4 -o clean.mp4
```

**2. Cut silence:**
```bash
vibe ai silence-cut clean.mp4 -o cut.mp4
```

**3. Captions:**
```bash
vibe ai caption cut.mp4 -o captioned.mp4 --style bold
```

**4. Fade:**
```bash
vibe ai fade captioned.mp4 -o final.mp4 --fade-in 1.0 --fade-out 1.5
```

> Pause 2s after the last command.

---

### Scene 4: Agent Mode (1-2 min)

```bash
clear
```

Type:
```bash
vibe agent -i "Analyze sample.mp4, find the best thumbnail frame, extract it, and generate captions." -v
```

> Agent plans 3 steps and executes autonomously:
> 1. ai_analyze
> 2. ai_thumbnail
> 3. ai_caption
>
> Wait for "Done!". Pause 2s.

---

### Scene 5: Motion Graphics (1-2 min)

```bash
clear
```

**Step 1 — Title card:**
```bash
vibe ai motion \
  "cinematic title card with 'VIBEFRAME' text, spring bounce animation, gold gradient" \
  --render -o title.mp4
```

> Claude writes TSX → Remotion renders. Wait for output.

**Step 2 — Composite onto video:**
```bash
vibe ai motion \
  "lower-third: 'Kiyeon, CEO' with slide-in from left" \
  --video sample.mp4 -o with-title.mp4
```

> Generates overlay → composites via FFmpeg. Wait for output. Pause 3s.

---

### Scene 6: End (5s)

```bash
vibe --help
```

> Let help output sit on screen 5s.

---

## STOP RECORDING

---

## Checklist

```
[ ] ~/.vibeframe removed (fresh install)
[ ] API keys set in env
[ ] ~/vibeframe-demo folder created
[ ] Do Not Disturb ON
[ ] Screen recording started
[ ] Scene 1: curl install → vibe --version
[ ] Scene 2: script-to-video → export
[ ] Scene 3: noise → silence → caption → fade
[ ] Scene 4: agent autonomous
[ ] Scene 5: motion render + composite
[ ] Scene 6: --help
[ ] Screen recording stopped
```
