---
name: vibe-script-to-video
description: Guided script-to-video workflow. Use when the user has a written script (or wants one) and wants a narrated, captioned video.
---

# vibe-script-to-video — Script to finished video

Turn written text into a narrated, illustrated, captioned video.

## Fast path (one command)

```bash
vibe pipeline script-to-video "A morning routine of a startup founder…" \
  -d 60 -a 9:16 -g kling -o founder.vibe.json
```

Output: a VibeFrame project file + rendered video.

Flags:
- `-d <sec>` — target duration
- `-a <ratio>` — aspect ratio (`9:16`, `16:9`, `1:1`)
- `-g <provider>` — video generator (`runway`, `kling`, `veo`, `grok`)
- `-o <path>` — output path
- `--voice <id>` — override TTS voice
- `--music <prompt>` — add background music from prompt

## What it does (under the hood)

1. Generate storyboard (YAML) from the script
2. For each scene: generate image → animate to video clip
3. Generate narration audio for each scene
4. Generate background music (if `--music`)
5. Compose all clips + audio into final video
6. Burn captions from the script

All steps are checkpointed — safe to rerun with `--resume`.

## Staged path (more control)

Use this when you want to review or swap assets between stages:

```bash
# 1. Generate storyboard YAML only
vibe generate storyboard "script…" -o storyboard.yaml

# 2. Edit storyboard.yaml manually — change prompts, scene order, voices

# 3. Run the rest as a YAML pipeline
vibe run storyboard.yaml --dry-run
vibe run storyboard.yaml
```

See `/vibe-pipeline` for YAML authoring.

## Quality checklist before running

- [ ] Script length matches target duration (≈150 wpm → 150 words for 60s)
- [ ] Aspect ratio matches destination (TikTok/Reels: 9:16, YouTube: 16:9)
- [ ] Provider keys configured (`vibe setup` or `.env`)
- [ ] Dry-run passed without errors: `vibe pipeline script-to-video "..." --dry-run`
- [ ] Expected cost reviewed — scripts with many scenes can be >$5

## Common failures & fixes

- **Rate limit on image gen**: switch provider with `-g` or add `--retry-delay 30`
- **Voice mismatch**: `vibe audio voices` to list, then `--voice <id>`
- **Empty scene outputs**: rerun with `--resume`; checkpoint skips completed steps
- **Out-of-order narration**: check storyboard YAML — scene `order:` field controls sequence
