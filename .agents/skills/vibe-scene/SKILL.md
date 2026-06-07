---
name: vibe-scene
description: Author, repair, render, and inspect VibeFrame scene projects built from STORYBOARD.md and DESIGN.md.
---

# Vibe Scene

Use this skill when the user wants editable HTML-based scene composition,
storyboard-to-MP4 work, or a host-agent authoring loop.

Scene projects are built from:

- `STORYBOARD.md` - beats, narration, backdrop cues, and duration hints.
- `DESIGN.md` - visual identity, palette, typography, motion, and constraints.
- `compositions/scene-*.html` - per-beat HTML compositions.
- `index.html` - root timeline.
- `assets/` and `renders/` - generated inputs and final outputs.

## Default Loop

```bash
vibe build my-video --mode agent --tts kokoro --skip-backdrop --skip-render --json
vibe scene compose-prompts my-video --json
vibe scene lint index.html --project my-video --json --fix
vibe render my-video -o renders/final.mp4 --quality standard
vibe inspect render my-video --cheap --json
```

Use `--skip-backdrop` for low-cost composition tests. Remove it when the demo
should exercise image generation from each beat's `backdrop` cue.

## Authoring Rules

- Do not author scene HTML before `DESIGN.md` exists.
- Every timed visual element needs `data-start`, `data-duration`, and
  `data-track-index`.
- Timed visual elements must have `class="clip"`.
- GSAP timelines must be paused and registered on `window.__timelines`.
- Avoid `Date.now()`, `Math.random()`, and network fetches in render paths.
- For factual, typography-heavy videos, keep claims and layout in HTML/CSS/JS;
  treat provider assets as inputs rather than the whole product.
