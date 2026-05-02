# VibeFrame Quickstart Demo

This is the copy-paste first-run demo for a human or coding agent driving the
installed `vibe` CLI from a clean directory.

The primary workflow is storyboard-first:

```text
brief
-> STORYBOARD.md and DESIGN.md
-> plan and dry-run
-> build assets/compositions
-> inspect reports
-> repair deterministic issues
-> render MP4
```

The current recorded quickstart video still demonstrates lower-level media
primitives. Those commands remain useful, but they are now secondary to the
project loop below.

For the longer repo dogfood run, see [DEMO-dogfood.md](DEMO-dogfood.md).

---

## 0. Setup

Install:

```bash
curl -fsSL https://vibeframe.ai/install.sh | bash
```

Create a clean demo workspace:

```bash
mkdir -p ~/dev/vibeframe-demo
cd ~/dev/vibeframe-demo
```

Configure project-local settings and verify the machine:

```bash
vibe setup --scope project
vibe doctor
vibe context
vibe schema --list --surface public --json
```

Recommended keys for the full paid path:

| Key | Used for |
| --- | --- |
| `OPENAI_API_KEY` | image generation and optional batch composition |
| `FAL_API_KEY` | Seedance image/video generation |
| `GOOGLE_API_KEY` | render review and media understanding |
| `IMGBB_API_KEY` or S3 upload config | temporary image URL for image-to-video |

The main quickstart below uses Kokoro narration and can skip generated
backdrops/video/music for a low-cost first pass.

---

## 1. Start A Storyboard Project

### User prompt

Paste this to Claude Code, Codex, Cursor, or another agent running in the demo
directory:

```text
Create a 24 second launch video called apex-story.
Use a calm mountain sunrise identity.
The final output should be a reviewed MP4.
Use STORYBOARD.md and DESIGN.md as the source of truth, dry-run before
spending, keep cost under $5, and write JSON reports for the next agent pass.
```

### Command the agent should run

```bash
vibe init apex-story \
  --from "24-second calm mountain sunrise launch video for Apex Ridge" \
  --profile agent \
  --visual-style "Swiss Pulse" \
  -r 16:9 \
  -d 24 \
  --json
```

Expected files:

```text
apex-story/STORYBOARD.md
apex-story/DESIGN.md
apex-story/vibe.config.json
apex-story/AGENTS.md
```

---

## 2. Author The Intent Files

Agents can directly edit Markdown for larger creative changes. For narrow cue
edits, prefer `vibe storyboard set/get/move/list`.

Replace `apex-story/DESIGN.md` with:

````markdown
# Design

## Style

Calm cinematic mountain documentary. Golden sunrise, layered fog, clean
developer-tool editorial pacing, restrained type, no mascot or cartoon styling.

## Palette

- `#0E1622` - ridge shadow
- `#E8B36A` - sunrise gold
- `#F5EEE2` - warm title text
- `#6EE7B7` - success accent

## Typography

Inter or system sans-serif. Medium weight, generous spacing, short labels.

## Motion

Slow camera drift, soft fades, subtle parallax, no bounce or elastic motion.
````

Replace `apex-story/STORYBOARD.md` with:

````markdown
# Apex Story

## Beat hook - First light

```yaml
duration: 6
narration: "The first light finds the ridge before the world wakes."
backdrop: "misty mountain ridge at sunrise, golden light, fog layers, cinematic aerial frame"
video: "slow camera drift forward over the peak, fog moving gently"
motion: "quiet title reveal, soft parallax, restrained lower-third"
voice: "af_heart"
music: "minimal warm pulse, low intensity"
```

Show the mountain identity immediately. Keep text minimal.

## Beat proof - The path appears

```yaml
duration: 6
narration: "A clear path appears when every step is visible."
backdrop: "ridge trail emerging through fog, warm sunrise edge light, high contrast"
motion: "thin line traces the path, small labels fade in"
voice: "af_heart"
```

Connect the visual path to the product promise.

## Beat mechanism - Built from files

```yaml
duration: 6
narration: "A storyboard becomes files, reports, scenes, and a render plan."
backdrop: "developer terminal beside storyboard markdown and structured report cards"
motion: "STORYBOARD.md, build-report.json, and review-report.json cards slide into place"
voice: "af_heart"
```

Make the file-based workflow visible.

## Beat close - Day one

```yaml
duration: 6
narration: "Apex Ridge. Day one begins here."
backdrop: "wide mountain ridge at peak golden hour, valley filled with warm light"
motion: "clean lower-third title, slow fade to final frame"
voice: "af_heart"
```

End with a quiet branded title.
````

Validate the storyboard:

```bash
vibe storyboard validate apex-story --json
vibe storyboard list apex-story --json
```

---

## 3. Plan And Dry-Run

Read the storyboard and show provider needs, missing cues, and estimated cost:

```bash
vibe plan apex-story \
  --mode batch \
  --composer openai \
  --tts kokoro \
  --skip-backdrop \
  --skip-video \
  --skip-music \
  --max-cost 5 \
  --json
```

Preview the build before creating assets or compositions:

```bash
vibe build apex-story \
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

This writes no media. It should return a JSON envelope with the build plan,
warnings, cost estimate, and retry suggestions if something is missing.

---

## 4. Build, Inspect, Repair, Render

Build the storyboard project while keeping the render as a separate step:

```bash
vibe build apex-story \
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

If the build starts async provider jobs in a paid path, poll the project:

```bash
vibe status project apex-story --refresh --json
```

Inspect generated project artifacts:

```bash
vibe inspect project apex-story --json
```

Apply deterministic mechanical repairs:

```bash
vibe scene repair --project apex-story --json
```

Render the final MP4:

```bash
vibe render apex-story \
  -o renders/storyboard-demo.mp4 \
  --quality standard \
  --fps 30 \
  --json
```

Inspect the rendered video locally:

```bash
vibe inspect render apex-story \
  --video renders/storyboard-demo.mp4 \
  --cheap \
  --json
```

Optional AI review:

```bash
vibe inspect render apex-story \
  --video renders/storyboard-demo.mp4 \
  --ai \
  --json
```

Expected files:

```text
apex-story/build-report.json
apex-story/review-report.json
apex-story/compositions/
apex-story/renders/storyboard-demo.mp4
```

If `review-report.json` contains semantic issues, ask the host agent to fix
them from the report:

```bash
codex "fix issues from apex-story/review-report.json"
```

Then rerun:

```bash
vibe scene repair --project apex-story --json
vibe render apex-story -o renders/storyboard-demo.mp4 --json
vibe inspect render apex-story --video renders/storyboard-demo.mp4 --cheap --json
```

---

## 5. Focus One Beat During Iteration

Use the storyboard mutation API for narrow changes:

```bash
vibe storyboard get apex-story hook --json
vibe storyboard set apex-story hook narration "First light reaches the ridge before the world wakes." --json
vibe storyboard validate apex-story --json
```

Rebuild and inspect just that beat:

```bash
vibe build apex-story --beat hook --stage sync --json
vibe inspect project apex-story --beat hook --json
vibe render apex-story --beat hook --json
vibe inspect render apex-story --beat hook --cheap --json
```

---

## 6. Paid Asset Path

The low-cost path above skips generated backdrops, videos, and music. To
exercise the full asset orchestration path, remove the skip flags and choose
providers:

```bash
vibe build apex-story \
  --mode batch \
  --composer openai \
  --tts kokoro \
  --image-provider openai \
  --video-provider seedance \
  --music-provider elevenlabs \
  --max-cost 5 \
  --json
```

If the estimate exceeds your cap, keep the generated-image path only:

```bash
vibe build apex-story \
  --mode batch \
  --composer openai \
  --tts kokoro \
  --image-provider openai \
  --skip-video \
  --skip-music \
  --max-cost 5 \
  --json
```

---

## 7. Media Primitives Demo

Use these commands when you need one standalone asset or you want to reproduce
the older quickstart recording.

```bash
mkdir -p assets renders

vibe generate image \
  "aerial view of a misty mountain peak at sunrise, golden hour light, layered fog, cinematic 16:9" \
  -p openai \
  -m 2 \
  --size 1536x1024 \
  --quality hd \
  --style natural \
  -o assets/peak.png

vibe generate video \
  "slow cinematic camera drift forward over the mountain peak, fog moving gently, sunrise light strengthening" \
  -p seedance \
  -i assets/peak.png \
  -d 6 \
  -r 16:9 \
  -o assets/peak-seedance.mp4

vibe inspect media \
  assets/peak-seedance.mp4 \
  "Describe the mood, motion, and safest lower-third region." \
  --fps 1 \
  --low-res

vibe edit motion-overlay \
  assets/peak-seedance.mp4 \
  "minimal lower-third title 'Day One - Apex Ridge', bottom-left, clean white sans-serif, subtle film grain, warm vignette" \
  --understand auto \
  -m gemini \
  --duration 6 \
  --style cinematic \
  -o renders/peak-titled.mp4
```

---

## 8. Expected File Tree

```text
.
+-- apex-story/
|   +-- AGENTS.md
|   +-- DESIGN.md
|   +-- STORYBOARD.md
|   +-- assets/
|   +-- build-report.json
|   +-- compositions/
|   +-- renders/
|   |   +-- storyboard-demo.mp4
|   +-- review-report.json
|   +-- vibe.config.json
+-- assets/
|   +-- peak.png
|   +-- peak-seedance.mp4
+-- renders/
    +-- peak-titled.mp4
```

Pixels vary by provider, model, and seed. The command routing, project files,
JSON reports, and render location should stay stable.

---

## Which Command Should The Agent Choose?

| User intent | Correct route |
| --- | --- |
| "Make a multi-scene video from this brief" | `vibe init --from` -> edit `STORYBOARD.md` / `DESIGN.md` -> `vibe plan` -> `vibe build` -> `vibe render` |
| "Change one beat cue" | `vibe storyboard set/get/move/list` |
| "Preview cost before spending" | `vibe plan --max-cost ...`, `vibe build --dry-run --max-cost ...` |
| "Check project artifacts" | `vibe inspect project` |
| "Fix mechanical scene issues" | `vibe scene repair --project ...` |
| "Review the final MP4" | `vibe inspect render --cheap` or `vibe inspect render --ai` |
| "Make one image/video/narration/music asset" | `vibe generate ...` |
| "Change an existing media file" | `vibe edit ...`, `vibe remix ...`, `vibe audio ...` |
| "Make this repeatable" | `vibe run pipeline.yaml` |

When unsure:

```bash
vibe context
vibe guide
vibe guide scene
vibe schema --list --surface public --json
vibe doctor
```
