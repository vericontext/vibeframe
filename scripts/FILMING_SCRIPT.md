# VibeFrame Demo Filming Script

> Open this on a second monitor. Start screen recording, then follow step by step.

## Before Recording (off-camera)

```bash
# 1. Terminal: dark theme, font 15pt+, Do Not Disturb ON

# 2. Prepare a sample video (30-60s clip) on Desktop
ls ~/Desktop/sample.mp4

# 3. Set API keys in advance (so setup wizard has them)
#    OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY,
#    ELEVENLABS_API_KEY, KLING_API_KEY

# 4. Clean previous install (fresh start for demo)
rm -rf ~/.vibeframe ~/.local/bin/vibe

# 5. Clear terminal
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

> Shows `0.17.1`. Pause 2s.

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
> Wait for "Done!". Output is in `script-video-output/`.

---

### Scene 3: Post-Production Combo (2-3 min)

```bash
clear
```

Copy sample video into working dir first:
```bash
cp ~/Desktop/sample.mp4 demo-output/sample.mp4
```

Then run 4 commands one by one. Wait for each to finish:

**1. Denoise:**
```bash
vibe ai noise-reduce demo-output/sample.mp4 -o demo-output/clean.mp4
```

**2. Cut silence:**
```bash
vibe ai silence-cut demo-output/clean.mp4 -o demo-output/cut.mp4
```

**3. Captions:**
```bash
vibe ai caption demo-output/cut.mp4 -o demo-output/captioned.mp4 --style bold
```

**4. Fade:**
```bash
vibe ai fade demo-output/captioned.mp4 -o demo-output/final.mp4 --fade-in 1.0 --fade-out 1.5
```

> Pause 2s after the last command.

---

### Scene 4: Agent Mode (1-2 min)

```bash
clear
```

Type:
```bash
vibe agent -i "Analyze demo-output/sample.mp4, find the best thumbnail frame, extract it, and generate captions." -v
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
  --render -o demo-output/title.webm
```

> Claude writes TSX → Remotion renders. Wait for output.

**Step 2 — Composite onto video:**
```bash
vibe ai motion \
  "lower-third: 'Kiyeon, CEO' with slide-in from left" \
  --video demo-output/sample.mp4 -o demo-output/with-title.mp4
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
[ ] ~/Desktop/sample.mp4 ready
[ ] API keys set in env
[ ] Do Not Disturb ON
[ ] Screen recording started
[ ] Scene 1: curl install → vibe --version
[ ] Scene 2: script-to-video
[ ] Scene 3: noise → silence → caption → fade
[ ] Scene 4: agent autonomous
[ ] Scene 5: motion render + composite
[ ] Scene 6: --help
[ ] Screen recording stopped
```
