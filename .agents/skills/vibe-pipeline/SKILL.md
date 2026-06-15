---
name: vibe-pipeline
description: Author and run VibeFrame YAML pipelines with vibe run, checkpoints, and budget controls.
---

# Vibe Pipeline

A VibeFrame pipeline is a YAML manifest executed by `vibe run`. Steps can
reference earlier outputs with `$<step-id>.output`, and the executor writes a
checkpoint under the output directory so failed runs can resume.

Use this skill when the user wants a reproducible multi-step media workflow,
checkpointed execution, or budget-limited provider calls.

## Minimal Skeleton

```yaml
name: promo-video
budget:
  costUsd: 8
  maxToolErrors: 1
steps:
  - id: image
    action: generate-image
    provider: openai
    model: "2"
    size: 1536x1024
    quality: hd
    prompt: "sleek product shot on a quiet studio background"
    output: hero.png

  - id: video
    action: generate-video
    provider: seedance
    image: $image.output
    prompt: "slow cinematic camera push, polished product demo motion"
    duration: 5
    ratio: "16:9"
    output: hero.mp4

  - id: titled
    action: edit-motion-overlay
    input: $video.output
    description: "minimal lower-third title, clean sans-serif, subtle grain"
    model: gemini
    understand: auto
    output: titled.mp4
```

## Scene Project Skeleton

Use `scene-build` and `scene-render` when a storyboard project already exists:

```yaml
name: storyboard-render
budget:
  costUsd: 2
  maxToolErrors: 1
steps:
  - id: build
    action: scene-build
    project: my-video
    mode: batch
    composer: openai
    tts: kokoro
    skipBackdrop: true
    skipRender: true

  - id: render
    action: scene-render
    project: my-video
    output: renders/final.mp4
    quality: standard
    fps: 30
    format: mp4
```

## Supported Actions

Keep this in sync with `packages/cli/src/pipeline/types.ts` and
`packages/cli/src/pipeline/executor.ts`.

- Generate: `generate-image`, `generate-video`, `generate-tts`,
  `generate-sfx`, `generate-music`, `generate-storyboard`, `generate-motion`
- Edit: `edit-silence-cut`, `edit-jump-cut`, `edit-caption`,
  `edit-noise-reduce`, `edit-fade`, `edit-translate-srt`,
  `edit-text-overlay`, `edit-motion-overlay`, `edit-grade`,
  `edit-speed-ramp`, `edit-reframe`, `edit-interpolate`, `edit-upscale`,
  `edit-image`
- Audio: `audio-transcribe`, `audio-isolate`, `audio-dub`, `audio-duck`
- Detect: `detect-scenes`, `detect-silence`, `detect-beats`
- Analyze/review: `analyze-video`, `analyze-media`, `review-video`
- Scene: `compose-scenes-with-skills`, `scene-build`, `scene-render`
- Legacy/meta: `export`

If unsure, read the executor source. There is no public `vibe run
--list-actions` command.

## Running

```bash
vibe run pipeline.yaml --dry-run
vibe run pipeline.yaml -o pipeline-output
vibe run pipeline.yaml -o pipeline-output --resume
vibe run pipeline.yaml -o pipeline-output --budget-usd 5
vibe run pipeline.yaml -o pipeline-output --json
```

Useful flags:

- `--dry-run` validates the graph and shows upper-bound cost estimates.
- `--resume` skips completed checkpointed steps.
- `--budget-usd`, `--budget-tokens`, `--max-errors` override or extend the
  manifest budget.
- `--effort low|medium|high|xhigh` forwards an LLM effort hint where supported.
- `--json` returns structured output for agents.

Checkpoint file: `<output-dir>/.pipeline-state.yaml`.

## Authoring Rules

1. Dry-run before executing paid provider steps.
2. Keep step ids short and stable (`image`, `motion`, `title`, `render`).
3. Name outputs with the real extension (`.png`, `.mp4`, `.mp3`, `.json`).
4. Use `$<step-id>.output` rather than repeating file paths.
5. Add a `budget:` block for any pipeline that can call image/video providers.
6. Use `scene-build` for storyboard projects and `generate-*` / `edit-*` for
   standalone media chains.

When converting a shell sequence, map each `vibe ...` command to one action and
turn downstream input paths into step references.
