# scene-promo — `vibe scene` example

A minimal bilingual scene project (works with both `vibe` and
`npx hyperframes`) showing the **scene authoring** workflow shipped in
v0.53.0. No API keys required — every scene uses the template presets only.

## What this demonstrates

Three template scenes stitched into an 18-second 16:9 timeline:

| Scene | Preset         | Duration | Source                                     |
|-------|----------------|----------|--------------------------------------------|
| intro | `announcement` | 5s       | [`compositions/scene-intro.html`](compositions/scene-intro.html) |
| core  | `explainer`    | 7s       | [`compositions/scene-core.html`](compositions/scene-core.html)   |
| outro | `kinetic-type` | 6s       | [`compositions/scene-outro.html`](compositions/scene-outro.html) |

Each scene is a self-contained HTML file with scoped CSS and a paused GSAP
timeline. Edit them directly — text tweaks don't require regeneration. The
root [`index.html`](index.html) just splices `<div class="clip">` references.

## Recreate from scratch

```bash
vibe scene init scene-promo -r 16:9 -d 18

vibe scene add intro \
  --project scene-promo --style announcement \
  --headline "Ship videos, not clicks" \
  --duration 5 --no-audio --no-image

vibe scene add core \
  --project scene-promo --style explainer \
  --kicker "VIDEO AS CODE" --headline "Author scenes, not timelines" \
  --duration 7 --no-audio --no-image

vibe scene add outro \
  --project scene-promo --style kinetic-type \
  --headline "Made with vibe scene" \
  --duration 6 --no-audio --no-image
```

## Lint and render

```bash
vibe scene lint  --project scene-promo            # in-process Hyperframes lint
vibe scene render --project scene-promo \
                  --out renders/promo.mp4         # requires Chrome
```

Lint should report `ok: true` with 0 errors / 0 warnings (4 informational
notices about CDN script hoisting are expected and harmless).

## Add AI assets

Drop `--no-audio` / `--no-image` to wire in real providers:

```bash
vibe scene add intro \
  --project scene-promo --style announcement --force \
  --headline "Ship videos, not clicks" \
  --narration "Stop dragging clips. Start scripting them." \
  --visuals "studio desk at dusk, soft cinematic lighting" \
  --image-provider gemini
```

Costs: ~$0.02 ElevenLabs TTS + ~$0.04 Gemini image per scene. Set
`ELEVENLABS_API_KEY` and `GOOGLE_API_KEY` in `.env` first (or run
`vibe setup`).

## Free local TTS + word-level caption sync (v0.54)

Skip the ElevenLabs cost entirely with `--tts kokoro` — first call
downloads the ~330MB Kokoro-82M model to `~/.cache/huggingface/hub`,
subsequent calls run in seconds:

```bash
vibe scene add narrated \
  --project scene-promo --style explainer \
  --kicker "WHY VIBE SCENE" \
  --headline "Edit text, not pixels" \
  --narration "Each word lights up the moment it's spoken." \
  --tts kokoro --no-image
```

This emits three things into `assets/`:
- `narration-narrated.wav` — Kokoro audio output
- `transcript-narrated.json` — Whisper word-level timings (needs `OPENAI_API_KEY`)
- `compositions/scene-narrated.html` — subtitle is split into one
  `<span class="word">` per transcript entry, each fading in at its
  absolute audio start time.

Press `vibe scene render` and the captured MP4 has captions that appear
exactly when each word is spoken **and** the narration plays as the audio
track (v0.55+ — `vibe scene render` runs a post-producer ffmpeg mux pass
that overlays every `<audio>` element onto the video at its absolute
timeline position). The `simple`, `explainer`, and `kinetic-type` presets
all support word-sync; `announcement` and `product-shot` ignore the
transcript (their headlines are static by design).

Already have a wav from another tool (`npx hyperframes tts`, macOS `say`,
hand-recorded)? Pass it directly — VibeFrame still transcribes it for sync:

```bash
vibe scene add custom \
  --narration-file ./my-voice.wav \
  --headline "Custom voiceover" \
  --no-image
```

The generated `assets/narration-*.{wav,mp3}` and `assets/transcript-*.json`
files are `.gitignore`d — re-run the command above to regenerate.

## One-shot: script-to-scenes

`vibe pipeline script-to-video` can produce a scene project like this one
from a written script in a single command:

```bash
vibe pipeline script-to-video "..." --format scenes -o my-promo/ -a 16:9
```

Output is editable HTML — re-run `vibe scene render` after any edit.

## Hyperframes interop

This directory is also a valid Hyperframes project. If you have the upstream
CLI installed:

```bash
npx hyperframes preview        # live-reload preview
npx hyperframes render         # equivalent to `vibe scene render`
```
