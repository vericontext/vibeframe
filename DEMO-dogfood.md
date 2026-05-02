# VibeFrame Dogfood Demo

This is the internal copy-paste dogfood path for this repo. It uses
`pnpm vibe` because the checkout is local. For an installed CLI workspace,
replace `pnpm vibe` with `vibe`.

The goal is to validate the current `FUNCTIONS-TOBE.md` direction:

```text
STORYBOARD.md and DESIGN.md are the source of truth
-> plan and dry-run expose cost/provider needs
-> build writes machine-readable reports
-> inspect and repair close the agent loop
-> render produces MP4
```

This document intentionally leads with the storyboard project loop. Media
primitives and YAML remain covered, but they are secondary paths.

---

## 0. Check Setup And Public Surface

Run these first:

```bash
pnpm vibe --help
pnpm vibe setup --show
pnpm vibe doctor
pnpm vibe context
pnpm vibe schema --list --surface public --json
```

Every command help screen and schema entry shows a cost tier such as `[FREE]`,
`[LOW]`, `[HIGH]`, or `[VERY-HIGH]`. Use `--dry-run`, `--max-cost`, and
`--json` whenever a host agent is driving the command.

Useful guides:

```bash
pnpm vibe guide
pnpm vibe guide scene
pnpm vibe guide pipeline
pnpm vibe guide architecture
```

Recommended keys for the full dogfood pass:

```text
OPENAI_API_KEY    image generation and optional batch composition
GOOGLE_API_KEY    optional render review and media understanding
FAL_API_KEY       Seedance image/video generation
IMGBB_API_KEY     local image upload host for image-to-video
```

The main dogfood path below uses Kokoro narration and can skip generated
backdrops/videos/music to keep cost low.

---

## 1. Create The Project

Start from a brief so `init` exercises the product-facing entry point:

```bash
pnpm vibe init my-video \
  --from "30-second product video showing VibeFrame as a storyboard-first video CLI for coding agents" \
  --profile agent \
  --visual-style "Swiss Pulse" \
  -r 16:9 \
  -d 30 \
  --json
```

Expected files:

```text
my-video/STORYBOARD.md
my-video/DESIGN.md
my-video/vibe.config.json
my-video/AGENTS.md
```

`STORYBOARD.md` is the intent layer. `DESIGN.md` is the visual system.
`assets/`, `compositions/`, `build-report.json`, and `review-report.json`
are generated or report artifacts.

---

## 2. Author A Reproducible Four-Beat Storyboard

For a stable dogfood run, replace the starter files with this compact project.

````bash
cat > my-video/DESIGN.md <<'MD'
# Design

## Style

Precise developer-tool product demo. Dark interface, blue graph lines,
high-contrast panels, clean editorial motion, no mascot or cartoon styling.

## Palette

- `#070A12` - background
- `#1B66FF` - primary blue
- `#F4F7FB` - text
- `#6EE7B7` - success accent

## Typography

Inter or system sans-serif. Short labels, strong hierarchy, generous spacing.

## Motion

Smooth panel slides, timeline wipes, restrained parallax, no bounce.
MD

cat > my-video/STORYBOARD.md <<'MD'
# VibeFrame Dogfood

## Beat setup - Project starts from intent

```yaml
duration: 6
narration: "Start with a storyboard. VibeFrame turns intent into project files."
backdrop: "developer terminal beside STORYBOARD.md and DESIGN.md, dark UI, blue highlights"
motion: "project files slide into a clean grid"
voice: "af_heart"
```

Show the command line as the control surface.

## Beat plan - Agents dry-run before spending

```yaml
duration: 6
narration: "Agents validate, plan, and dry-run before provider spend."
backdrop: "terminal showing JSON plan, cost cap, provider needs, and warnings"
motion: "cost and provider cards count up, then lock under a budget line"
voice: "af_heart"
```

Make `--json`, `--dry-run`, and `--max-cost` visible.

## Beat build - Files and reports drive the loop

```yaml
duration: 6
narration: "Builds create assets, scene compositions, and reports the next agent can read."
backdrop: "build-report.json and review-report.json beside generated scene cards"
motion: "report cards connect to composition files and render output"
voice: "af_heart"
```

Show build artifacts as normal files.

## Beat render - Inspect, repair, render again

```yaml
duration: 6
narration: "Inspect, repair deterministic issues, then render the final MP4."
backdrop: "render preview with passing checks and a final MP4 file"
motion: "repair checklist resolves, final video card lands"
voice: "af_heart"
```

End on the closed agent loop.
MD
````

Validate and inspect the authored storyboard:

```bash
pnpm vibe storyboard validate my-video --json
pnpm vibe storyboard list my-video --json
pnpm vibe storyboard get my-video setup --json
```

---

## 3. Plan And Dry-Run

Plan the build with the same options you intend to run:

```bash
pnpm vibe plan my-video \
  --mode batch \
  --composer openai \
  --tts kokoro \
  --skip-backdrop \
  --skip-video \
  --skip-music \
  --max-cost 5 \
  --json
```

Dry-run the build:

```bash
pnpm vibe build my-video \
  --dry-run \
  --mode batch \
  --composer openai \
  --tts kokoro \
  --skip-backdrop \
  --skip-video \
  --skip-music \
  --max-cost 5 \
  --json
```

Expected behavior:

```text
no media files are written
estimated cost is visible
provider needs are visible
retry suggestions are machine-readable
```

---

## 4. Build, Inspect, Repair, Render

Build generated assets and compositions, but render in a separate command:

```bash
pnpm vibe build my-video \
  --mode batch \
  --composer openai \
  --tts kokoro \
  --skip-backdrop \
  --skip-video \
  --skip-music \
  --skip-render \
  --max-cost 5 \
  --json
```

Poll the project state. This is especially useful when paid providers create
async jobs:

```bash
pnpm vibe status project my-video --refresh --json
```

Inspect project artifacts and write/refresh report state:

```bash
pnpm vibe inspect project my-video --json
```

Apply deterministic repairs:

```bash
pnpm vibe scene repair --project my-video --json
```

Render the final MP4:

```bash
pnpm vibe render my-video \
  -o renders/my-video-final.mp4 \
  --quality standard \
  --fps 30 \
  --json
```

Inspect the render locally:

```bash
pnpm vibe inspect render my-video \
  --video renders/my-video-final.mp4 \
  --cheap \
  --json
```

Optional AI review:

```bash
pnpm vibe inspect render my-video \
  --video renders/my-video-final.mp4 \
  --ai \
  --json
```

Expected files:

```text
my-video/build-report.json
my-video/review-report.json
my-video/renders/my-video-final.mp4
```

Expected shape:

```text
H.264 + AAC MP4
1920x1080
30fps
about 24 seconds, or longer if narration timing stretches a beat
```

---

## 5. Exercise The Agent-Safe Storyboard API

Use structured mutation commands for narrow cue changes:

```bash
pnpm vibe storyboard get my-video setup --json

pnpm vibe storyboard set \
  my-video \
  setup \
  narration \
  "Start with a storyboard. VibeFrame turns one brief into files, reports, and a render." \
  --json

pnpm vibe storyboard validate my-video --json
```

Rebuild one beat:

```bash
pnpm vibe build my-video \
  --beat setup \
  --stage sync \
  --mode batch \
  --composer openai \
  --tts kokoro \
  --skip-backdrop \
  --skip-video \
  --skip-music \
  --json

pnpm vibe inspect project my-video --beat setup --json
pnpm vibe render my-video --beat setup --json
pnpm vibe inspect render my-video --beat setup --cheap --json
```

Use larger Markdown edits for creative rewrites, then validate again.

---

## 6. Video As YAML

Use pipeline YAML when the same process needs to be reproducible.

Create `my-video/video-as-yaml.yaml`:

```bash
cat > my-video/video-as-yaml.yaml <<'YAML'
name: my-video-yaml
budget:
  costUsd: 5
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
    output: renders/my-video-yaml-final.mp4
    quality: standard
    fps: 30
    format: mp4
YAML
```

Preview:

```bash
pnpm vibe run my-video/video-as-yaml.yaml \
  -o . \
  --dry-run
```

Execute:

```bash
pnpm vibe run my-video/video-as-yaml.yaml \
  -o .
```

Expected file:

```text
my-video/renders/my-video-yaml-final.mp4
```

The pipeline does:

```text
scene-build -> scene-render
```

---

## 7. Optional Paid AI Media Layer

This path validates generated image/video primitives that can be referenced by
storyboard cues or used independently.

Create `my-video/ai-media.yaml`:

```bash
cat > my-video/ai-media.yaml <<'YAML'
name: my-video-ai-media
budget:
  costUsd: 6
  maxToolErrors: 2
steps:
  - id: hero
    action: generate-image
    provider: openai
    model: "2"
    size: 1536x1024
    quality: hd
    prompt: "A polished VibeFrame CLI product demo frame, dark terminal UI, blue timeline accents, cinematic developer-tool composition"
    output: my-video-ai-hero.png

  - id: motion
    action: generate-video
    provider: seedance
    image: $hero.output
    prompt: "A clean camera push through a terminal-driven video timeline, panels animating into place, polished product demo motion"
    duration: 5
    ratio: "16:9"
    output: my-video-ai-motion.mp4
YAML
```

Preview:

```bash
pnpm vibe run my-video/ai-media.yaml \
  -o my-video/assets \
  --dry-run
```

Execute:

```bash
pnpm vibe run my-video/ai-media.yaml \
  -o my-video/assets \
  --budget-usd 6
```

Expected files:

```text
my-video/assets/my-video-ai-hero.png
my-video/assets/my-video-ai-motion.mp4
```

Required keys:

```text
OPENAI_API_KEY
FAL_API_KEY
IMGBB_API_KEY
```

---

## 8. Validate Outputs

Inspect the final storyboard video:

```bash
ffprobe -v error \
  -show_entries stream=index,codec_type,codec_name,width,height,r_frame_rate,duration \
  -show_entries format=duration,size \
  -of json \
  my-video/renders/my-video-final.mp4
```

Inspect the YAML-rendered video:

```bash
ffprobe -v error \
  -show_entries stream=index,codec_type,codec_name,width,height,r_frame_rate,duration \
  -show_entries format=duration,size \
  -of json \
  my-video/renders/my-video-yaml-final.mp4
```

Run focused tests for this dogfood surface:

```bash
pnpm -F @vibeframe/cli test -- \
  src/commands/_shared/build-plan.test.ts \
  src/commands/_shared/scene-build.test.ts \
  src/commands/_shared/scene-inspect.test.ts \
  src/commands/_shared/scene-repair.test.ts \
  src/commands/_shared/render-inspect.test.ts \
  src/commands/_shared/status-jobs.test.ts \
  --run
```

---

## 9. Command Map

| Goal | Command |
| --- | --- |
| Start a storyboard project | `pnpm vibe init my-video --from "..." --profile agent --json` |
| Validate storyboard cues | `pnpm vibe storyboard validate my-video --json` |
| Mutate one beat safely | `pnpm vibe storyboard set/get/move/list` |
| Show cost and provider needs | `pnpm vibe plan my-video --max-cost 5 --json` |
| Preview without spending | `pnpm vibe build my-video --dry-run --max-cost 5 --json` |
| Build assets and compositions | `pnpm vibe build my-video --json` |
| Poll project jobs/state | `pnpm vibe status project my-video --refresh --json` |
| Inspect project artifacts | `pnpm vibe inspect project my-video --json` |
| Repair deterministic scene issues | `pnpm vibe scene repair --project my-video --json` |
| Render MP4 | `pnpm vibe render my-video --json` |
| Inspect final MP4 | `pnpm vibe inspect render my-video --cheap --json` |
| Run a YAML workflow | `pnpm vibe run workflow.yaml` |
| Generate a standalone image/video | `pnpm vibe generate image ...`, `pnpm vibe generate video ...` |
| Edit an existing media file | `pnpm vibe edit ...`, `pnpm vibe remix ...`, `pnpm vibe audio ...` |
| Print integration context for agents | `pnpm vibe context` |
| List public commands | `pnpm vibe schema --list --surface public --json` |

Advanced namespace:

```text
vibe scene ...
```

Use `vibe scene ...` for generated composition artifacts. Use
`vibe storyboard ...` for the source-of-truth intent layer.

---

## 10. Terminal Recordings

The VHS terminal recordings live in [`assets/demos/`](assets/demos/).

```text
assets/demos/quickstart-claude-code.tape
assets/demos/dogfood-claude-code.tape
```

The existing quickstart MP4 is a media primitive demo. The dogfood tape should
be regenerated when we want a fresh recording of the storyboard-first project
loop.
