---
name: vibe-pipeline
description: Author and run VibeFrame YAML pipelines with vibe run, checkpoints, and budget controls.
---

# Vibe Pipeline

Use this skill when the user wants a reproducible multi-step media workflow,
checkpointed execution, or budget-limited provider calls.

## Minimal Pattern

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

## Running

```bash
vibe run pipeline.yaml --dry-run
vibe run pipeline.yaml -o pipeline-output --json
vibe run pipeline.yaml -o pipeline-output --resume
vibe run pipeline.yaml -o pipeline-output --budget-usd 5
```

Rules:

- Dry-run before paid provider steps.
- Use short stable step ids such as `image`, `motion`, `title`, `render`.
- Name outputs with real extensions.
- Reference earlier outputs with `$<step-id>.output`.
- Add a `budget:` block for pipelines that may call image or video providers.
- Use `scene-build` / `scene-render` for storyboard projects and
  `generate-*` / `edit-*` for standalone media chains.
