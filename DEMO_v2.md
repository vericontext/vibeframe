# VibeFrame Demo v2 — Mountain Sunrise (Text → Image → Video → Motion → Narration)

A linear 4-step demo that takes a single text prompt and ends with a
narrated cinematic clip. Each step's output feeds the next, so the
story stays coherent and the audience can follow along.

**Estimated runtime:** ~3-4 minutes wall-clock (depends on provider
speeds — Seedance video gen is the long pole at ~60-90s).

**Estimated cost:** ~$0.30-0.50 with default providers (gpt-image-2,
Seedance via fal.ai, Claude for motion graphics, ElevenLabs for TTS).

**Required keys:** `OPENAI_API_KEY`, `FAL_API_KEY`, `ANTHROPIC_API_KEY`,
`ELEVENLABS_API_KEY`. Set in `.env` or run `vibe setup` first.

---

## 1. Text → Image (`vibe generate image`)

Lay down the establishing shot. One still frame, cinematic.

**Prompt:**

```
aerial view of a misty mountain peak at sunrise, golden hour light hitting the ridges,
layered fog drifting through the valleys, soft volumetric god rays, cinematic 16:9,
shot on Arri Alexa
```

**Command:**

```bash
vibe generate image \
  "aerial view of a misty mountain peak at sunrise, golden hour light hitting the ridges, layered fog drifting through the valleys, soft volumetric god rays, cinematic 16:9, shot on Arri Alexa" \
  -o peak.png
```

**Output:** `peak.png` (1920×1080 still). Cost ≈ $0.05.

---

## 2. Image → Video (`vibe generate video --image`)

Bring the still to life. Camera drift + atmospheric motion.

**Prompt:**

```
the camera slowly drifts forward over the peak, fog moves gently with the wind,
sunlight strengthens as the sun climbs higher, 5 seconds, smooth cinematic motion
```

**Command:**

```bash
vibe generate video \
  "the camera slowly drifts forward over the peak, fog moves gently with the wind, sunlight strengthens as the sun climbs higher, smooth cinematic motion" \
  --image peak.png \
  --duration 5 \
  -o peak.mp4
```

**Output:** `peak.mp4` (5s clip, 16:9, 1080p). Cost ≈ $0.20-0.40 on
Seedance via fal.ai. The image-to-video URL hosting goes through
`VIBE_UPLOAD_PROVIDER` (imgbb default, or your S3 bucket).

---

## 3. Motion Graphics Overlay (`vibe generate motion --video`)

Composite a minimal lower-third title over the live footage. Claude
generates the Remotion TSX, Remotion renders it, FFmpeg overlays it
back onto the source video.

**Prompt:**

```
add a minimal lower-third title 'Day One' in clean white sans-serif,
fade in from bottom-left at 1s, hold 3s, fade out at 5s.
add subtle film grain and a soft vignette.
```

**Command:**

```bash
vibe generate motion \
  "add a minimal lower-third title 'Day One' in clean white sans-serif, fade in from bottom-left at 1s, hold 3s, fade out at 5s. add subtle film grain and a soft vignette." \
  --video peak.mp4 \
  --duration 5 \
  --style cinematic \
  --render \
  -o peak-titled.mp4
```

**Output:** `peak-titled.mp4` (same 5s, with title + grain + vignette
baked in). Cost ≈ $0.02 (Claude Sonnet for the TSX).

---

## 4. Narration (`vibe generate speech` + FFmpeg mux)

Generate the voice track, then mux it onto the titled video. Two
small steps because vibeframe's surface intentionally keeps speech
generation and audio muxing separate.

**Narration text:**

```
The world wakes up before we do. Every ridge has its own way of greeting the light.
```

**Command:**

```bash
# 4a. Generate the voice file
vibe generate speech \
  "The world wakes up before we do. Every ridge has its own way of greeting the light." \
  -o narration.mp3

# 4b. Mux narration onto the titled video (FFmpeg one-liner)
ffmpeg -i peak-titled.mp4 -i narration.mp3 -c:v copy -c:a aac -shortest final.mp4
```

**Output:** `final.mp4` (5s, with title overlay + narration). Cost
≈ $0.02 (ElevenLabs).

---

## Final asset

```
final.mp4 — 5s cinematic short, ~3-4MB
```

If the narration is longer than 5s, drop `-shortest` and bump
`--duration 8` (or whatever) on Step 2 so the visual lasts as long as
the audio.

---

## Variants

Same 4-step structure, different theme:

| Theme | Step 1 prompt seed |
|---|---|
| Coffee shop morning | `steaming cup of coffee on a wooden table by a window, morning sunlight, shallow depth of field, cinematic` |
| Cyberpunk alley | `neon-lit Tokyo back alley at night, rain-slicked pavement reflecting signs, lone figure with umbrella, cinematic` |
| Underwater | `sunlight beams cutting through clear ocean water, school of small fish drifting near a coral reef, cinematic depth` |
| Tokyo street | `crowded Shibuya crossing at dusk, neon billboards reflecting on wet asphalt, motion blur on pedestrians, cinematic` |

The Step 2/3/4 prompts adapt naturally — describe the motion you want,
the title overlay you want, and the line of narration that ties it
together.

---

## Appendix: Scene Project Flow (`vibe init` / `vibe scene` / `vibe build`)

Use the four steps above when you want one asset chain:

```
text prompt -> one image -> one video clip -> one overlay -> final.mp4
```

Use the scene flow when you want a reusable video project with
`STORYBOARD.md`, `DESIGN.md`, per-scene HTML, linting, and repeatable
renders.

Important routing rule:

- Single image request: use `vibe generate image`
- Single video clip request: use `vibe generate video`
- Multi-scene / storyboard / composed video request: use `vibe init`,
  `vibe build`, `vibe render`, and optionally `vibe scene ...`

### A. Create a Scene Project

```bash
vibe init mountain-sunrise --profile agent --ratio 16:9
cd mountain-sunrise
```

This creates the project scaffold:

```text
STORYBOARD.md
DESIGN.md
AGENTS.md
CLAUDE.md        # when Claude Code is detected
SKILL.md
references/
compositions/
assets/
renders/
```

Check setup before spending money:

```bash
vibe doctor
vibe setup --show
```

If you keep keys project-local:

```bash
vibe setup --scope project
```

Project-scope config is read from the current directory or an ancestor
`.vibeframe/config.yaml`, so commands run inside subfolders still pick up
the project keys.

### B. Lock the Visual Direction

Edit `DESIGN.md` so the agent and linter know the visual identity.
For this demo, use the same mountain sunrise direction:

```md
## Style

Misty mountain sunrise, golden-hour ridgelines, layered fog, quiet
cinematic atmosphere.

## Palette

- #0E1622 — pre-dawn ridge shadow
- #E8B36A — golden-hour highlight
- #F1E4CC — warm haze

## Motion

Slow drone drift, gentle fog movement, no snappy UI easing.
```

You can browse starter visual styles:

```bash
vibe scene list-styles
vibe scene list-styles swiss-pulse
```

### C. Add One Scene Directly

`vibe scene add` is useful when you want to add or regenerate one scene
inside the project. Here we generate a scene image with OpenAI, generate
narration, and create a per-scene HTML composition.

```bash
vibe scene add hook \
  --project . \
  --headline "Day One" \
  --narration "The world wakes up before we do. Every ridge has its own way of greeting the light." \
  --visuals "aerial view of a misty mountain peak at sunrise, golden hour light hitting the ridges, layered fog drifting through the valleys, soft volumetric god rays, cinematic 16:9, shot on Arri Alexa" \
  --image-provider openai \
  --tts auto
```

Expected outputs:

```text
assets/scene-hook.png
assets/narration-hook.mp3
compositions/scene-hook.html
index.html updated to include the scene
```

Preview without API calls:

```bash
vibe scene add hook \
  --project . \
  --headline "Day One" \
  --visuals "misty mountain sunrise, cinematic fog" \
  --image-provider openai \
  --no-audio \
  --dry-run
```

### D. Lint the Scene HTML

Run this before rendering, especially after an agent edits
`compositions/*.html`.

```bash
vibe scene lint --project .
vibe scene lint --project . --fix
```

### E. Build from STORYBOARD.md

For a composed video, put beats in `STORYBOARD.md`, then run the
top-level build command. This is the recommended project flow.

Example `STORYBOARD.md` beat:

````md
## Beat hook — Day One

```yaml
narration: "The world wakes up before we do."
backdrop: "aerial misty mountain peak at sunrise, golden ridgelines, layered fog"
duration: 5
```

Open on the mountain peak. Keep text sparse and let the fog carry the
motion.
````

Build with OpenAI images and automatic TTS:

```bash
vibe build . \
  --mode agent \
  --image-provider openai \
  --tts auto \
  --quality hd
```

If you only want to dispatch assets and inspect the generated scene plan:

```bash
vibe build . --mode agent --skip-render
```

### F. Render the Project

After the scene HTML exists:

```bash
vibe render . -o renders/mountain-sunrise.mp4
```

Final output:

```text
renders/mountain-sunrise.mp4
```

### G. Agent-Friendly Loop

When driving this from Claude Code, Codex, or another coding agent:

```bash
vibe scene compose-prompts . --json
vibe scene lint --project . --json
vibe render . -o renders/mountain-sunrise.mp4
```

The intended loop is:

1. `vibe scene compose-prompts . --json`
2. Agent writes/updates `compositions/scene-*.html`
3. `vibe scene lint --project . --json`
4. Agent fixes lint issues
5. `vibe render . -o renders/final.mp4`

Use this when you want precise, editable scene composition. For one-off
image generation, stay with `vibe generate image`.
