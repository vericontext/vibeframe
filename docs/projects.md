---
type: Reference
title: "Project Files And Flow"
description: "VibeFrame project file roles (STORYBOARD, DESIGN, characters) and the init to build to render flow."
tags: [projects, workflow]
---

# Project Files And Flow

VibeFrame has two main flows:

- **Create a new video from text:** `vibe init --from`, edit `STORYBOARD.md` and `DESIGN.md`, then run `vibe storyboard validate`, `vibe plan`, `vibe build`, and `vibe render`.
- **Process existing media:** use `vibe remix`, `vibe edit`, `vibe audio`, or `vibe inspect`.

`brief.md` is a raw starting point, not a strict schema. It can be messy notes,
pasted research, links, or a one-line idea. `vibe init --from` uses it to seed
`STORYBOARD.md` and `DESIGN.md`; after init, those files are the source of
truth.

## Project Commands

Use these commands first:

```bash
mkdir -p my-video/media
vibe init my-video --from "45-second launch video"
vibe host setup all my-video
vibe storyboard validate my-video
vibe plan my-video
vibe build my-video --dry-run --max-cost 5
vibe build my-video --max-cost 5
vibe render my-video -o renders/final.mp4
```

## Host Agent Loop

Use your host's agent loop (Claude Code, Codex, Cursor, or another coding-agent
host) as the outer loop for multi-step video builds. VibeFrame should not
compete with that loop. It should expose machine-readable state and recovery
paths:

```text
host agent loop -> vibe context/schema -> plan dry-run -> build with budget
-> status polling -> inspect project -> render -> inspect render
-> repair/edit using nextActions/fixOwner -> repeat
```

The outer loop should stop only when the final MP4 path exists, duration and aspect
ratio match the brief, render inspection has no errors, any AI review score
meets the review threshold when AI review is requested, and unresolved
`fixOwner:"host-agent"` issues are fixed,
accepted with rationale, or reported as blocked. Agents should read
`build-report.json` and `review-report.json` before choosing the next action
and prefer `nextActions`: run only `safeToAutoRun:true` actions automatically,
ask before `requiresConfirmation:true`, and use `retryWith` only as the
compatibility fallback.

Worked example — `vibe inspect project my-video --json` returns a review report
whose `nextActions` are pre-classified so the host loop never has to guess:

```jsonc
{
  "kind": "review", "status": "fail", "score": 17,
  "nextActions": [
    {
      "kind": "command",
      "command": "vibe build my-video --stage sync --json",
      "fixOwner": "vibe",        // VibeFrame can fix this itself
      "costTier": "free",
      "safeToAutoRun": true,     // → run it without asking
      "requiresConfirmation": false,
      "reason": "The root composition is missing or could not be verified."
    },
    {
      "kind": "command",
      "command": "vibe generate video ... --json",
      "fixOwner": "host-agent",  // the outer agent loop owns this
      "costTier": "very-high",
      "safeToAutoRun": false,
      "requiresConfirmation": true,  // → ask the user before spending
      "reason": "Regenerating the clip is a paid provider call."
    }
  ],
  "retryWith": ["vibe build my-video --stage sync --json"]
}
```

Host-loop logic: iterate `nextActions` → run every `safeToAutoRun:true` action
as-is → for `requiresConfirmation:true` (or any `very-high`/`unknown` `costTier`)
ask the user first → if a `command` is rejected by an older CLI, fall back to
`retryWith`. Stop when a re-`inspect` returns `status:"pass"` and no
`fixOwner:"host-agent"` issues remain. `fixOwner` tells you who acts:
`"vibe"` actions are safe local repairs; `"host-agent"` actions are yours to run
or escalate. Never invent commands when `nextActions` is present.

Claude Desktop uses global MCP config, so anchor it to the workspace you want
relative project names to resolve under. VibeFrame writes a shell wrapper
because Claude Desktop may not preserve a raw `cwd` field:

```bash
vibe host setup claude-desktop ~/dev/videos --write
```

`vibe scene ...` is the advanced namespace. It remains useful when you want to add a single HTML scene, lint scene files, install agent rules, or render a scene project with low-level options.

## Project File Roles

Use the folders consistently:

| Path            | Role                                                                                 |
| --------------- | ------------------------------------------------------------------------------------ |
| `brief.md`      | Optional rough input before `vibe init`; can live outside or beside the project.     |
| `STORYBOARD.md` | Beats, narration, duration, and image/video/music cues. Scene audio comes only from explicit `narration`/`music` cues — composition never invents ambient/foley SFX. |
| `DESIGN.md`     | Palette, typography, layout, motion, transitions, and visual anti-patterns.          |
| `media/`        | User-provided source files: photos, screenshots, logos, B-roll, voice recordings.    |
| `assets/`       | Generated or canonical build assets such as narration, backdrops, music, and videos. |
| `references/`   | Composition rule docs installed by VibeFrame skills; do not use for user media.      |
| `renders/`      | Final and intermediate MP4 outputs.                                                  |

When a beat should reuse a local file, use a project-relative path in
`STORYBOARD.md`:

```yaml
backdrop: "media/product-shot.png"
video: "media/broll.mp4"
narration: "media/voice.wav"
asset: "media/logo.png"
```

### Characters (consistent AI video)

Declare a reusable character pool in the document frontmatter, then reference it
from a beat's `characters` cue. During `vibe build`, each referenced character
is rendered once as a turnaround sheet (`assets/character-<name>.png`) and used
as a reference image for that beat's `video` generation (Seedance
reference-to-video), so the same character stays consistent across beats. A
character value is a generation prompt, or `{ image: <path> }` to bring your own
reference (skips generation).

```yaml
---
characters:
  mira: "arctic aurora photographer, deep-red fur-lined parka, dark hair under a charcoal beanie, vintage 35mm camera"
  rival: { image: "media/rival-ref.png" }
---

## Beat hook — Hook

```yaml
duration: 5
characters: [mira]
video: "MIRA treks across the moonlit snowfield, handheld tracking shot, wind and crunching snow"
```
```

Character sheets add image-generation cost, and each character video beat is a
provider video call — run `vibe build --dry-run` to see the estimate and gate
with `--max-cost`.

### Keyframe → image-to-video

For tighter art direction, a beat can declare a `keyframe` cue. During
`vibe build`, the keyframe prompt first produces a still
(`assets/keyframe-<beatId>.png`) — edited from the beat's `characters` sheet when
present (for consistency), otherwise generated from text — and that exact frame
is then animated with Seedance **image-to-video**. The `video` cue, if present,
supplies the motion prompt; otherwise the keyframe prompt is reused.

```yaml
duration: 5
characters: [mira]
keyframe: "MIRA stands on the frozen ice, low-angle hero shot, dramatic aurora light"
video: "slow tilt up as the aurora ripples and pulses overhead"
```

Keyframe mode costs one extra image generation per beat plus the clip
(image-to-video uses standard Seedance pricing, with no reference discount) —
check `vibe build --dry-run` and gate with `--max-cost`.

**Review the image storyboard before paying for video.** Keyframe stills are a
first-class asset, so you can generate and review them before the expensive
image-to-video step:

```bash
vibe build my-film --skip-video        # generate assets/keyframe-*.png only (cheap)
# review the stills; regenerate a weak one and accept it:
vibe build my-film --beat grid --stage assets --force --skip-video
vibe build my-film --max-cost 6        # animate the approved keyframes
```

Use `--skip-keyframe` to opt a run out of keyframe generation entirely.

### Provider quality tiers

Provider choice drives perceived polish, especially for character-consistent
work:

- **Faces / character identity** — `--image-provider gemini` (Nano Banana) holds
  the same face across scenes noticeably better than `gpt-image-2`, whose
  identity tends to drift after a few scenes. Use it for character/keyframe-heavy
  pieces. Keyframe edits already pin facial features with an identity-lock
  instruction, but the model still matters.
- **Narration** — `--tts kokoro` is free and local (draft quality); for a final
  or shared cut use `--tts openai` (fast, ~$0.02/video) or `--tts elevenlabs`
  (premium voices). Switching providers regenerates narration and updates the
  render automatically.

## Profiles

`vibe init` supports three profiles:

| Profile   | Use when                                                                | What it creates                                 |
| --------- | ----------------------------------------------------------------------- | ----------------------------------------------- |
| `minimal` | You only want the authoring docs at first                               | `STORYBOARD.md`, `DESIGN.md`, project config    |
| `agent`   | Recommended for Codex, Claude Code, Cursor, Aider, Gemini CLI, OpenCode | authoring docs plus local agent guidance        |
| `full`    | You want all render/backend files up front                              | authoring docs, agent guidance, render scaffold |

The default is `agent`.

Pass `--mcp` to `vibe init` when you want project-scoped MCP config for Codex,
Claude Code, and Cursor created during init:

```bash
vibe init my-video --from brief.md --mcp
```

## Backend Metadata

`vibe.config.json` owns the VibeFrame project contract. Legacy
`vibe.project.yaml` files are still read for compatibility. Scene composition
is declared explicitly:

```json
{
  "composition": {
    "engine": "hyperframes",
    "entry": "index.html"
  }
}
```

`hyperframes` is the only supported composition engine today. Some
render/backend files may also include `hyperframes.json`. Treat that as
implementation metadata for the HTML renderer, not as the primary VibeFrame
project file.

New users normally do not need to edit it. The file is created only when the selected profile or later build/render steps need backend compatibility.

## Provider Naming

Use providers for what they are:

```bash
vibe generate image "..." -p openai
vibe generate video "..." -p seedance
```

`seedance` is the explicit provider name for ByteDance Seedance through
fal.ai. `fal` remains a backwards-compatible alias, but docs and demos should
prefer `seedance` so new users can see which video model they are selecting.
When you want a provider-specific option, check the command help:

```bash
vibe generate video --help
```

## Dry Runs

Use `--dry-run` before paid generation:

```bash
vibe plan my-video
vibe build my-video --dry-run --max-cost 5
vibe render my-video --dry-run
vibe generate video "..." -p seedance --dry-run
```

Dry runs do not create assets, call paid providers, or render files. They show the planned parameters so humans and agents can confirm the next action.
