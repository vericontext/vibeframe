# VibeFrame Cookbook

Verified recipes for common VibeFrame workflows.

These examples use the current top-level CLI surface: `vibe init`, `vibe build`,
`vibe render`, `vibe generate`, `vibe edit`, `vibe remix`, and `vibe run`.
Run `vibe doctor` first to confirm FFmpeg, Chrome/Chromium, and configured API
keys.

```bash
vibe doctor
```

## 1. Clean Up An Interview

Use this when you already have a recording and want a cleaner edit with
captions.

Requires:

- FFmpeg for silence cutting and noise reduction
- `OPENAI_API_KEY` for Whisper captions

```bash
vibe edit silence-cut interview.mp4 -o interview-trimmed.mp4
vibe edit noise-reduce interview-trimmed.mp4 -o interview-clean.mp4
vibe edit caption interview-clean.mp4 -o interview-captioned.mp4
```

Preview paid or destructive-looking steps before running them:

```bash
vibe edit caption interview-clean.mp4 -o interview-captioned.mp4 --dry-run
```

## 2. Generate An Image, Then Animate It

This is the recommended AI media generation path: create a still frame first,
then use it as the reference image for image-to-video.

Requires:

- `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `XAI_API_KEY`, or another supported image provider key
- `FAL_API_KEY` for Seedance via fal.ai
- `IMGBB_API_KEY` when the selected video provider needs an HTTPS image URL

```bash
vibe generate image \
  "A cinematic product demo frame, clean terminal UI, blue highlights" \
  -p openai \
  -s 1536x1024 \
  -o frame.png

vibe generate video \
  "Slow camera push-in, subtle interface motion, polished product demo" \
  -p seedance \
  -i frame.png \
  -d 8 \
  -r 16:9 \
  -o motion.mp4
```

Notes:

- `seedance` is the explicit provider name. `fal` remains a compatibility alias.
- Seedance currently accepts `-d` values from 4 to 15 seconds.
- Other video providers have different duration constraints; run
  `vibe generate video --help` before switching providers.

## 3. Build A Storyboard Video

Use this when you want to author a video from `STORYBOARD.md` and `DESIGN.md`.
This is the main "storyboard to final video" workflow.

Requires:

- Chrome or Chromium for HTML scene capture
- FFmpeg for final media assembly
- Provider keys only for the generation steps you use
- Kokoro can be used for local narration when available

```bash
vibe init my-video --profile agent --visual-style "Swiss Pulse" -r 16:9 -d 18
```

Edit:

- `my-video/STORYBOARD.md`
- `my-video/DESIGN.md`

Then build and render:

```bash
vibe build my-video --dry-run
vibe build my-video --tts kokoro
vibe render my-video -o renders/my-video-final.mp4 --quality standard
```

Use these flags to control cost and regeneration:

```bash
vibe build my-video --skip-narration
vibe build my-video --skip-backdrop
vibe build my-video --force
```

`vibe build` prepares assets and scene composition. `vibe render` exports the
final MP4/WebM/MOV.

## 4. Turn Long Video Into Shorts

Use this when you have existing long-form content and want highlights or
vertical clips.

Requires:

- FFmpeg for clipping/reframing
- `GOOGLE_API_KEY` when using Gemini visual+audio analysis
- `OPENAI_API_KEY` when captions/transcription are needed

Extract highlight metadata:

```bash
vibe remix highlights long-video.mp4 \
  -n 3 \
  -d 60 \
  --use-gemini \
  -o highlights.json
```

Generate vertical shorts:

```bash
vibe remix auto-shorts long-video.mp4 \
  -n 3 \
  -d 45 \
  -a 9:16 \
  --add-captions \
  -o ./shorts/
```

Manual path for one selected clip:

```bash
vibe edit reframe highlight-clip.mp4 -a 9:16 -o vertical.mp4
vibe remix animated-caption vertical.mp4 -s bounce -o vertical-captioned.mp4
```

## 5. Run A Video-As-YAML Pipeline

Use `vibe run` when you want a reproducible workflow with step references,
budgets, dry-runs, and checkpoints.

Create `promo.yaml`:

```yaml
name: promo
budget:
  costUsd: 5
  maxToolErrors: 2
steps:
  - id: image
    action: generate-image
    prompt: "A cinematic developer-tool hero frame"
    provider: openai
    output: frame.png

  - id: video
    action: generate-video
    prompt: "Slow camera push-in, subtle interface motion"
    image: $image.output
    provider: seedance
    duration: 8
    output: motion.mp4

  - id: grade
    action: edit-grade
    input: $video.output
    preset: cinematic-warm
    output: final.mp4
```

Run it:

```bash
vibe run promo.yaml --dry-run
vibe run promo.yaml --budget-usd 5
vibe run promo.yaml --resume
```

Checkpoints are written next to the YAML file. Use `--resume` after fixing a
failed provider key, network issue, or invalid step input.

## Tips

- Use `--dry-run` before provider-backed steps.
- Add `--json` where available when an agent needs structured output.
- Use `vibe schema --list` to inspect the command surface.
- Use `vibe walkthrough` for built-in step-by-step guides.
- Prefer explicit providers in docs and demos, for example `-p openai` or
  `-p seedance`, so new users can see which API key is required.
