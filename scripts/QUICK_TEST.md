# VibeFrame Quick Test

> A golden retriever on a beach — image → audio → video → combine, step by step.

---

## Setup

VibeFrame can be set up in two ways.

---

### Method A: curl install (end users)

```bash
curl -fsSL https://vibeframe.ai/install.sh | bash
```

The setup wizard runs automatically after installation:

```
VibeFrame Setup
────────────────────────────
1. Choose your AI provider
   → Claude / OpenAI / Gemini / xAI / Ollama (free, local)

2. Enter API Key
   → Enter one key for your selected provider

✓ Setup complete!
```

Add more provider keys later:
```bash
vibe setup --full      # Interactive setup for all providers
vibe setup --show      # Verify current configuration
```

> **Key storage**: `~/.vibeframe/config.yaml`
> All `vibe` commands automatically read from this file.

---

### Method B: Developer mode (clone repo)

```bash
# 1. Install dependencies and build
pnpm install && pnpm build

# 2. Create .env file
cp .env.example .env
# Edit .env and add required API keys
```

`.env` example:
```bash
# Minimum setup — runs Q1~Q5
GOOGLE_API_KEY=...
ELEVENLABS_API_KEY=...
KLING_API_KEY=...

# Additional keys for full test
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
RUNWAY_API_SECRET=...
```

> **Key storage**: `.env` in current working directory
> Loaded automatically when running `vibe` commands.

---

### Comparison

| | curl install | Developer mode |
|--|-------------|---------------|
| **Command** | `vibe` | `pnpm vibe` |
| **Key storage** | `~/.vibeframe/config.yaml` | `.env` in project root |
| **Add/edit keys** | `vibe setup --full` | Edit `.env` directly |
| **Key priority** | config.yaml → .env → prompt |  |

> **Note**: Both methods can be used together. Keys missing from config.yaml are automatically supplemented from .env.

---

## Required API Keys

| Step | Feature | Required API Key |
|------|---------|-----------------|
| Q1 | Image generation | `GOOGLE_API_KEY` |
| Q2 | Image editing | `GOOGLE_API_KEY` |
| Q3 | Text-to-speech (TTS) | `ELEVENLABS_API_KEY` |
| Q4 | Video generation (Kling) | `KLING_API_KEY` |
| Q5 | Combine audio + video | None (FFmpeg only) |
| Q6 | Color grading | `ANTHROPIC_API_KEY` |
| Q7 | Speech recognition | `OPENAI_API_KEY` |
| Q8 | Video analysis | `GOOGLE_API_KEY` |
| Q9 | Image-to-video (Runway) | `RUNWAY_API_SECRET` |
| Q10 | Full pipeline | `ANTHROPIC_API_KEY` + `GOOGLE_API_KEY` + `ELEVENLABS_API_KEY` + `RUNWAY_API_SECRET` |

---

## Tests (in order)

### Q1. Generate an image

> **Model**: Google Gemini Nano Banana (`gemini-2.5-flash-image`, default)
> **How it works**: Text prompt → Gemini image generation API (Nano Banana) → Save PNG
> **Gemini model options**: `-m flash` (default, fast, 1024px) / `-m pro` (Nano Banana Pro `gemini-3-pro-image-preview`, higher quality, up to 4K, Thinking mode)
> **Other providers**: `--provider openai` (GPT Image 1.5), `--provider stability` (Stability AI SDXL), `--provider runway` (Runway image)
> **Required API key**: `GOOGLE_API_KEY` — For other providers: openai → `OPENAI_API_KEY`, stability → `STABILITY_API_KEY`, runway → `RUNWAY_API_SECRET`

```bash
vibe ai image "a golden retriever on a beach" -o test-results/dog.png --provider gemini
```
Pass: `dog.png` shows a dog on a beach

---

### Q2. Edit an image (uses Q1 result)

> **Model**: Google Gemini Nano Banana (`gemini-2.5-flash-image`, default)
> **How it works**: Original image + edit instruction text → Gemini multimodal editing API → Save modified PNG
> **Model options**: `-m flash` (default, up to 3 input images) / `-m pro` (Nano Banana Pro `gemini-3-pro-image-preview`, up to 14 input images, up to 4K, Thinking mode, more precise editing)
> **Note**: `gemini-edit` is Gemini-only. Stability AI's `ai sd-replace`/`ai sd-img2img` offer similar functionality.
> **Required API key**: `GOOGLE_API_KEY`

```bash
vibe ai gemini-edit test-results/dog.png "put sunglasses on the dog" -o test-results/dog-cool.png
```
Pass: Comparing `dog.png` and `dog-cool.png` shows sunglasses added

---

### Q3. Generate narration audio

> **Model**: ElevenLabs `eleven_multilingual_v2`
> **How it works**: Text → ElevenLabs TTS API (Rachel voice, multilingual) → Save MP3
> **Other options**: `-v <voice-id>` to select a different voice (`vibe ai voices` to list available voices). Only the voice changes; the model is fixed.
> **Required API key**: `ELEVENLABS_API_KEY`

```bash
vibe ai tts "A golden retriever is playing on a sunny beach." -o test-results/dog-narration.mp3
```
Pass: `dog-narration.mp3` plays natural-sounding speech

---

### Q4. Generate a video from text (1-2 min, silent)

> **Model**: Kling v2.5 Turbo (`kling-v2-5-turbo`, default)
> **How it works**: Text prompt → Kling API async generation (polling) → Download MP4
> **Other options**: `-m std` (Standard mode, faster). Use `vibe ai video` for Runway Gen-4.5 instead. Higher quality auto-selects `kling-v2-6`.
> **Note**: Kling-generated videos have no audio track → combined in Q5
> **Required API key**: `KLING_API_KEY` — For Runway: `RUNWAY_API_SECRET`

```bash
vibe ai kling "a golden retriever running on a sunny beach, cinematic slow motion" -o test-results/dog.mp4 -d 5
```
Pass: `dog.mp4` plays a beach video with **no audio** — audio is combined in the next step

---

### Q5. Combine audio and video (Q3 audio + Q4 video)

> **Model**: None (no AI used)
> **How it works**: Register video/audio sources in a VibeFrame project file (`.vibe.json`) → Build timeline → Mux with FFmpeg → Export MP4
> **Note**: Core VibeFrame workflow — layer multiple sources on a timeline and combine into a single video
> **Required API key**: None — FFmpeg only (local install required: `brew install ffmpeg`)

```bash
# Create project
vibe project create dog-video -o test-results/dog-project.vibe.json

# Add sources (auto-capture IDs)
VID=$(vibe timeline add-source test-results/dog-project.vibe.json test-results/dog.mp4 2>&1 | grep "Source added:" | awk '{print $NF}')
AUD=$(vibe timeline add-source test-results/dog-project.vibe.json test-results/dog-narration.mp3 2>&1 | grep "Source added:" | awk '{print $NF}')

# Add clips to timeline
vibe timeline add-clip test-results/dog-project.vibe.json $VID
vibe timeline add-clip test-results/dog-project.vibe.json $AUD

# Export
vibe export test-results/dog-project.vibe.json -o test-results/dog-final.mp4 -y
```
Pass: `dog-final.mp4` plays beach video with narration audio

---

### Q6. Color grade a video (uses Q5 result)

> **Model**: Claude (Anthropic) + FFmpeg (local)
> **How it works**: Preset/style text → Claude API generates FFmpeg `vf` filter string → Local FFmpeg applies color correction
> **Other options**: Use `--style "film noir"` instead of `-p` presets. Presets: `cinematic-warm`, `cinematic-cool`, `vintage`, `high-contrast`
> **Note**: AI only decides which filters to use; actual processing is done by local FFmpeg → minimal API cost, fast processing
> **Required API key**: `ANTHROPIC_API_KEY`

```bash
vibe ai grade test-results/dog-final.mp4 -p cinematic-warm -o test-results/dog-warm.mp4
```
Pass: Comparing `dog-final.mp4` and `dog-warm.mp4` shows a warm cinematic color shift

---

### Q7. Verify audio with speech recognition (uses Q5 result)

> **Model**: OpenAI Whisper (`whisper-1`)
> **How it works**: Video/audio file → OpenAI Whisper API → Text transcription output
> **Other options**: `-l en` to specify language (auto-detection also supported). Currently Whisper is the only model.
> **Required API key**: `OPENAI_API_KEY`

```bash
vibe ai transcribe test-results/dog-final.mp4
```
Pass: Terminal outputs text matching the narration → confirms audio was properly embedded in the video

---

### Q8. Analyze a video (uses Q5 result)

> **Model**: Google Gemini Flash Preview (`gemini-3-flash-preview`, default)
> **How it works**: Video file → Gemini multimodal API (video understanding) → Text response to query
> **Other options**: `--model gemini-2.5-flash` or `--model gemini-2.5-pro` to select model
> **Required API key**: `GOOGLE_API_KEY`

```bash
vibe ai gemini-video test-results/dog-final.mp4 "What is happening in this video?"
```
Pass: Terminal outputs description containing keywords like "golden retriever", "beach"

---

### Q9. Image-to-video (uses Q2 result, 1-2 min)

> **Model**: Runway Gen-4 Turbo (`gen4_turbo`)
> **How it works**: Local image file → base64 conversion → Runway Image-to-Video API → Download MP4
> **Why not Kling**: Kling v2.5/v2.6 only accepts image URLs (no local files). Runway supports local files directly.
> **Difference from Q4**: Q4 generates video from text only (unpredictable results). Q9 uses an image as the starting point (character/composition preserved from original image).
> **Required API key**: `RUNWAY_API_SECRET`

```bash
vibe ai video "the dog starts running toward the ocean" -p runway -i test-results/dog-cool.png -o test-results/dog-cool.mp4 -d 5
```
Pass: `dog-cool.mp4` shows the sunglasses-wearing dog in motion — compared to Q4 (text-to-video), the original image is preserved

---

### Q10. Full pipeline — create an ad (5-10 min)

> **Model**: Claude (storyboard) → Gemini Nano Banana (scene images) → Kling v2.5 Turbo or Runway Gen-4 Turbo (scene videos) → ElevenLabs (narration)
> **How it works**: Script → Claude splits into scenes + generates storyboard JSON → Generate image per scene → Image-to-video conversion → TTS narration → Full assembly

> **Video generator selection (`-g`)**:
> - `-g kling` (default): Kling only accepts image URLs for image-to-video, so images are uploaded to **ImgBB** internally. Requires `KLING_API_KEY` + `IMGBB_API_KEY`. Without `IMGBB_API_KEY`, falls back to text-to-video (no image reference).
> - `-g runway` (recommended): Converts local image files directly to base64 — no external upload service needed. Only requires `RUNWAY_API_SECRET`.

> **Other options**: `-i openai` (use GPT Image for image generation), `--images-only` (skip video generation)
> **Required API keys** (`-g runway`): `ANTHROPIC_API_KEY` + `GOOGLE_API_KEY` + `ELEVENLABS_API_KEY` + `RUNWAY_API_SECRET`
> **Required API keys** (`-g kling`): `ANTHROPIC_API_KEY` + `GOOGLE_API_KEY` + `ELEVENLABS_API_KEY` + `KLING_API_KEY` (+ `IMGBB_API_KEY` recommended)

```bash
# Using Runway (recommended: 1 API key, no image upload needed)
vibe ai script-to-video "A 15-second ad featuring a golden retriever on a sunny beach" -g runway -o test-results/dog-ad/

# Using Kling (also needs IMGBB_API_KEY)
# vibe ai script-to-video "..." -g kling -o test-results/dog-ad/

# Combine into final video (after the above command completes)
vibe export test-results/dog-ad/project.vibe.json -o test-results/dog-ad-final.mp4 -y
```
Pass: `test-results/dog-ad/` contains `scene-1.mp4`, `narration-1.mp3`, `storyboard.json`, `project.vibe.json`
Pass: `test-results/dog-ad-final.mp4` — all scenes + narration combined into the final ad video

---

## Results

```
Q1  Image generation:      PASS / FAIL
Q2  Image editing:         PASS / FAIL
Q3  TTS generation:        PASS / FAIL
Q4  Video generation:      PASS / FAIL
Q5  Audio+video combine:   PASS / FAIL
Q6  Color grading:         PASS / FAIL
Q7  Speech recognition:    PASS / FAIL
Q8  Video analysis:        PASS / FAIL
Q9  Image-to-video:        PASS / FAIL
Q10 Full pipeline:         PASS / FAIL
```
