---
name: vibe-scene
description: Author, repair, render, and inspect VibeFrame scene projects built from STORYBOARD.md and DESIGN.md.
---

# Vibe Scene

VibeFrame scene projects are editable video projects built from:

- `STORYBOARD.md` - beats, narration, backdrop cues, duration hints
- `DESIGN.md` - visual identity, palette, typography, motion rules
- `compositions/scene-*.html` - per-beat HTML compositions
- `index.html` - root timeline that references scene compositions
- `assets/` and `renders/` - generated inputs and final outputs

Use this skill when the user wants editable HTML-based scene composition,
storyboard-to-MP4 work, or a host-agent authoring loop.

Use the top-level commands for the main project lifecycle:

```bash
vibe init my-video --profile agent --ratio 16:9
vibe build my-video
vibe render my-video -o renders/final.mp4
```

The `vibe scene ...` namespace is the lower-level authoring surface:
`install-skill`, `compose-prompts`, `list-styles`, `add`, and `lint`.

## Pick The Right Path

| Path                       | Use when                                                                                | Commands                                                     |
| -------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Self-contained batch build | A human is running the demo or CI should produce scene HTML without a host coding agent | `vibe build --mode batch --composer openai`                  |
| Host-agent authoring       | Claude Code/Codex/Cursor should write the scene HTML from a plan                        | `vibe build --mode agent`, then `vibe scene compose-prompts` |
| Single-scene draft         | You need a quick template scene or fallback HTML                                        | `vibe scene add`                                             |

Default recommendation for public demos and reproducible dogfood runs:

```bash
vibe init my-video --profile agent --ratio 16:9
# edit DESIGN.md and STORYBOARD.md
vibe build my-video \
  --mode batch \
  --composer openai \
  --tts kokoro \
  --skip-backdrop \
  --skip-render
vibe scene lint index.html --project my-video --fix
vibe render my-video -o renders/final.mp4 --quality standard
```

Use `--skip-backdrop` when you want a low-cost composition test. Remove it when
the demo should exercise OpenAI image generation from each beat's `backdrop`
cue.

## Host-Agent Loop

Use this when Claude Code or another coding agent should be the reasoner that
authors `compositions/scene-*.html`.

```bash
vibe build my-video \
  --mode agent \
  --tts kokoro \
  --skip-backdrop \
  --skip-render

vibe scene compose-prompts my-video --json
```

If `vibe build --mode agent` returns a `needs-author` plan:

1. Read the compose plan.
2. Author each missing `compositions/scene-<id>.html`.
3. Run `vibe scene lint index.html --project my-video --fix`.
4. Fix remaining lint errors by editing the HTML.
5. Run `vibe render my-video`.

Hard rules for authored scene HTML:

- Every timed element needs `data-start`, `data-duration`, and `data-track-index`.
- Timed elements must have `class="clip"`.
- GSAP timelines must be paused and registered on `window.__timelines`.
- Do not use `Date.now()`, `Math.random()`, or network fetches in render paths.
- Route final audio through root-level `<audio>` elements when possible.
- For factual, typography-heavy videos, keep claims and layout in HTML/CSS/JS;
  treat provider assets as inputs rather than the whole product.

## Low-Level Scene Commands

```bash
vibe scene install-skill my-video --host auto
vibe scene compose-prompts my-video --json
vibe scene list-styles
vibe scene add intro --project my-video --style announcement --headline "Hello"
vibe scene lint index.html --project my-video --json --fix
```

Run `vibe schema scene.<subcommand>` before using less common flags.

## STYLE And STORYBOARD Guidance

Never author scene HTML before `DESIGN.md` exists. Treat it as the hard gate
for visual decisions:

- palette and contrast
- typography and hierarchy
- layout density
- animation timing and transition style
- what to avoid

For `STORYBOARD.md`, prefer compact beat blocks:

````markdown
## Beat hook - First claim

```yaml
narration: "The first sentence the viewer hears."
backdrop: "Specific visual prompt for the scene backdrop"
duration: 5
```

What the scene should show.
````

## Lint Feedback Loop

```bash
vibe scene lint index.html --project my-video --json --fix
```

Recommended loop:

1. Run lint with `--json --fix`.
2. Fix any `error` findings in the referenced scene file.
3. Re-run lint.
4. Cap retries at 3; if errors persist, replace the scene with a simpler
   `vibe scene add ... --style simple --force` draft and explain the tradeoff.

Warnings can be acceptable for demos only when the final render is visually
correct and deterministic.

## Render Checklist

- `vibe doctor` reports Chrome and FFmpeg as available.
- `vibe scene lint` exits 0 or only acceptable warnings remain.
- `index.html` references every `compositions/scene-*.html` file needed.
- `vibe render my-video -o renders/final.mp4` writes the expected MP4.
- Final `media info` or `ffprobe` confirms the intended duration, fps, and
  codec shape.

## Common Failures

- `Root composition not found`: run `vibe build` once so the render scaffold is
  created, or use `vibe init --profile full`.
- `needs-author`: expected in `--mode agent`; author the listed scene files and
  rerun build.
- `OPENAI_API_KEY not set`: use `--skip-backdrop` for a local composition test,
  or configure the key before generating backdrops.
- Render hangs at 0%: run `vibe doctor`; install Chrome or set `CHROME_PATH`.
