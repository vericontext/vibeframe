---
name: vibe-pipeline
description: Author and run VibeFrame YAML pipelines (Video as Code). Use when the user wants a reproducible, multi-step video workflow or wants to convert a ad-hoc sequence of commands into a pipeline file.
---

# vibe-pipeline — Video as Code

A pipeline is a YAML manifest with steps that reference each other's outputs. Executes with checkpointing and cost estimation.

## Minimal skeleton

```yaml
name: promo-video
description: 15s product teaser
steps:
  - id: backdrop
    action: generate-image
    prompt: "sleek product shot on white background"
    output: backdrop.png
  - id: scene
    action: generate-video
    image: $backdrop.output        # reference previous step output
    prompt: "slow camera pan"
    duration: 5
    output: scene.mp4
  - id: voice
    action: generate-tts
    text: "Meet the new standard."
    output: voice.mp3
  - id: final
    action: compose
    video: $scene.output
    audio: $voice.output
    output: final.mp4
```

## Supported actions (keep in sync with `packages/cli/src/pipeline/executor.ts`)

- `generate-image`, `generate-video`, `generate-tts`, `generate-music`, `generate-sound-effect`, `generate-storyboard`, `generate-motion`
- `edit-silence-cut`, `edit-jump-cut`, `edit-caption`, `edit-grade`, `edit-reframe`, `edit-speed-ramp`, `edit-fade`, `edit-noise-reduce`, `edit-text-overlay`, `edit-fill-gaps`
- `analyze-media`, `analyze-video`, `analyze-review`, `analyze-suggest`
- `audio-transcribe`, `audio-isolate`, `audio-voice-clone`, `audio-dub`, `audio-duck`
- `detect-scenes`, `detect-silence`, `detect-beats`
- `compose`, `export`

If unsure, run `vibe run --list-actions` (if implemented) or read the executor source.

## Variable references

- `$<step-id>.output` — previous step's output path
- `$<step-id>.result.<field>` — structured field from JSON result
- `${ENV_VAR}` — environment variable
- Values can be templated: `"${SCRIPT_TITLE} - Episode ${EPISODE}"`

## Running

```bash
vibe run pipeline.yaml --dry-run           # plan + cost estimate, no execution
vibe run pipeline.yaml                     # execute
vibe run pipeline.yaml --resume            # retry from last successful step
vibe run pipeline.yaml --from scene        # start at specific step
vibe run pipeline.yaml --provider-video kling   # override provider
```

Checkpoints land next to the YAML: `pipeline.yaml.checkpoint.json`.

## Authoring tips

1. **Start from examples**: `examples/demo-pipeline.yaml` (FFmpeg-only, no keys), `examples/promo-video.yaml` (AI providers).
2. **Dry-run first** — you see estimated cost and resolved variable graph before spending API credits.
3. **Keep step ids short and descriptive** (`intro`, `scene1`, `voice`, `bgm`) — they appear in logs and variable refs.
4. **Name outputs** with extensions matching the action (`.mp4`, `.mp3`, `.png`, `.json`).
5. **Declare `budget:`** on expensive pipelines (see Opus 4.7 task budgets):
   ```yaml
   budget:
     tokens: 500_000
     max_tool_errors: 3
     cost_usd: 5.00
   ```
6. **Split large pipelines** into smaller YAML files and compose via `action: run-pipeline` (nested).

## Converting ad-hoc shell sessions to pipelines

When a user has a working shell sequence, extract steps:
- Each `vibe ...` command becomes one step
- File outputs become step outputs; downstream `-i <file>` references become `$<id>.output`
- Shared parameters move to top-level `defaults:` section
