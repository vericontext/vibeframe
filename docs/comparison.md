# VibeFrame vs Hyperframes — what each ships

A scene project authored once, rendered through both pipelines. Reproducible
from `examples/scene-promo` plus one extra narrated scene. The point is *not*
that one is better — VibeFrame uses the Hyperframes producer for the actual
frame capture. The point is what each layer adds on top.

## Setup

Same project (3 template scenes from `examples/scene-promo` + one narrated
scene authored via `vibe scene add … --tts kokoro`). Output directory is
identical for both; we just point each renderer at it.

```bash
# Identical project, two renderers
cp -r examples/scene-promo project-A
cp -r examples/scene-promo project-B
for p in project-A project-B; do
  vibe scene add narrated --project "$p" --style explainer \
    --kicker "WHY VIBEFRAME" --headline "Edit text, not pixels." \
    --narration "Each word lights up the moment it is spoken." \
    --tts kokoro --duration 6 --no-image
done

vibe scene render --project project-A --quality draft --fps 24 --workers 6 -o A.mp4
( cd project-B && npx hyperframes render --quality draft --fps 24 -o ../B.mp4 )
```

## Output comparison (`ffprobe`)

| Metric | `vibe scene render` | `npx hyperframes render` |
|---|---|---|
| File size | 851 KB | 818 KB |
| Video codec | h264 (Constrained Baseline) | h264 (Constrained Baseline) |
| Video duration | 24.000 s | 24.000 s |
| Video bitrate | 277.9 kbps | 278.2 kbps |
| **Audio codec** | **AAC** | _(none)_ |
| **Audio duration** | **20.85 s** | _(none)_ |
| **Audio bitrate** | **10.6 kbps** | _(none)_ |

Same h264 stream both directions — VibeFrame uses the Hyperframes producer
for frame capture, then runs a single ffmpeg pass with `-c:v copy` to mux
audio. No video re-encode, +33 KB on disk for the AAC track.

## Wall-clock render time (1080p draft, 24 fps, 24 s output)

| Mode | Workers | Time | Notes |
|---|---|---|---|
| `npx hyperframes render` | 6 (default) | **~16 s** | silent video only |
| `vibe scene render` | 1 (default, more reliable) | ~31 s | + audio mux |
| `vibe scene render --workers 6` | 6 | **~10 s** | + audio mux |

VibeFrame's audio-mux pass is bounded by ffmpeg `-c:v copy` so it costs
roughly the I/O of the video file (≈800 KB), not a re-encode. Capture is
the long pole; with the same worker count, VibeFrame ends up slightly
ahead because Chrome warm-up amortises across more frames.

## What each layer ships

| Concern | Hyperframes (producer) | VibeFrame on top |
|---|---|---|
| Scene HTML primitive (`<div class="clip">` + GSAP) | ✓ | inherited |
| Frame capture (Chrome BeginFrame / screenshot) | ✓ | inherited |
| In-process lint (`runHyperframeLint`) | ✓ | inherited |
| `npx hyperframes tts` (Kokoro local) | ✓ | wired into `vibe scene add --tts kokoro` |
| `npx hyperframes transcribe` (Whisper) | ✓ | wired into `vibe scene add` (auto when audio + key) |
| Project scaffold (`init`) — bilingual layout | own format | `vibe scene init` writes both `vibe.project.yaml` + `hyperframes.json` |
| **Audio in rendered MP4** | not yet (silent output) | `vibe scene render` ffmpeg post-mux pass |
| **Word-sync captions** | manual JS hardcoding (see [`hyperframe-learn` example](https://github.com/heygen-com/hyperframes)) | `vibe scene add` emits `<span class="word">` from transcript automatically |
| Pipeline (script → scenes → MP4) | not in scope | `vibe pipeline script-to-video --format scenes` |
| Provider routing (TTS/image/video) | n/a | `--tts auto\|kokoro\|elevenlabs`, `--image-provider gemini\|openai`, `-g grok\|kling\|runway\|veo` |
| Agent + MCP tool surface | n/a | 53 MCP tools incl. `scene_init/add/lint/render` |
| Pricing | $0 (local) | $0 with Kokoro+Gemini, ≤$0.10 with ElevenLabs+OpenAI |

## What VibeFrame is *not* solving

- Replacing Hyperframes' scene rendering. We import `@hyperframes/producer`
  and call its `executeRenderJob` directly. The producer is the engine.
- Running on a server. Both VibeFrame and Hyperframes assume Chrome is
  available locally — same constraint as Remotion.
- Removing the Chrome dependency. The frame-capture model needs a real
  browser; that's the deal you sign for HTML composability.

## Why "AI-native CLI" is the gap, not "another renderer"

Hyperframes is a renderer + small tool ecosystem. VibeFrame is the layer
that turns "I have a script, write me a captioned video" into one command,
running through configurable providers, with the lint / transcript /
audio-mux glue automated. If you're already comfortable hand-authoring
scene HTML, `npx hyperframes` covers ~80% of what you'd want. VibeFrame
absorbs the remaining glue + adds the agent / MCP / pipeline surface.

## Reproducing this comparison

The script that produced these numbers lives in
[`tests/comparison/render-bench.sh`](../tests/comparison/render-bench.sh)
(self-contained — clones `examples/scene-promo`, runs both renderers,
prints the table above). Numbers above were measured on macOS 14.x,
Apple Silicon, Chrome 138, ffmpeg 8.1.
