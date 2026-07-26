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

Worked example - `vibe inspect project my-video --json` returns a review report
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

## Build And Review Reports

Two JSON files hold the state the outer loop reads between steps.
Both are written into the project root, both are overwritten on every run, and
both are safe to delete - the next `build` or `inspect` rewrites them.

| File                 | Written by                                     | Answers                                                              |
| -------------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| `build-report.json`  | `vibe build`                                   | What did this build produce, what did it cost, what stage is it in?  |
| `review-report.json` | `vibe inspect project`, `vibe inspect render`  | What is wrong, who fixes it, and what command fixes it?              |

`vibe build --dry-run` does not write a report.
It prices the build and returns the plan on stdout instead, so a dry run never
overwrites the record of your last real build.
`vibe render` additionally writes `render-report.json` with the latest render
output.

### build-report.json

```jsonc
{
  "schemaVersion": "1",
  "kind": "build",
  "project": "/abs/path/to/my-video",
  "phase": "needs-author",        // done | assets-only | transcript-only | pending-jobs
                                  // | compose-only | sync-only | render-only
                                  // | needs-author | failed
  "status": "needs-author",       // done | running | needs-author | failed | ready
  "currentStage": "compose",      // assets | transcript | compose | sync | render | done
  "mode": "agent",
  "selectedStage": "all",         // whatever --stage asked for
  "success": true,                // the run did not error; NOT "the video is finished"
  "estimatedCostUsd": 0,
  "costUsd": 0,                   // what was actually spent
  "beatSummary": { "total": 3, "assetsReady": 3, "compositionsReady": 0,
                   "needsAuthor": ["hook", "proof", "close"] },
  "stageReports": {               // one entry per stage, always all five
    "assets":     { "status": "done",         "costUsd": 0, "warnings": [], "retryWith": [] },
    "transcript": { "status": "skipped",      "costUsd": 0, "warnings": [], "retryWith": [] },
    "compose":    { "status": "needs-author", "costUsd": 0, "warnings": [], "retryWith": [] },
    "sync":       { "status": "skipped",      "costUsd": 0, "warnings": [], "retryWith": [] },
    "render":     { "status": "skipped",      "costUsd": 0, "warnings": [], "retryWith": [] }
  },
  "beats": [ /* per-beat detail, see below */ ],
  "jobs": [],                     // async provider tasks still in flight; poll with `vibe status job`
  "sceneRepair": { "ran": false, "stage": null, "status": "skipped",
                   "score": null, "fixed": [], "remainingIssues": [], "retryWith": [] },
  "providerResolution": [],       // which provider each stage actually resolved to
  "warnings": ["--skip-video: skipped render (no clips to capture). ..."],
  "retryWith": ["vibe build . --stage sync --json"],
  "totalLatencyMs": 1234
}
```

Read `status` and `currentStage` first: together they say where the project
stopped and what the next stage is.
`success: true` only means the command itself did not error - a build can
succeed and still leave `status: "needs-author"`, which is the normal state
after the asset stage when your agent has not written the scene HTML yet.

Each entry in `beats[]` carries `id`, `startSec`, `endSec`,
`sceneDurationSec`, a nested object per asset kind (`narration`, `backdrop`,
`video`, `music`) with `prompt`/`provider`/`path`/`status`/`sourcePath`/cache
metadata, and a `composition` object:

```jsonc
"composition": { "path": "compositions/scene-hook.html", "exists": false, "status": "needs-author" }
```

Flat `narrationStatus`/`backdropStatus`/`videoStatus`/`musicStatus` fields are
kept alongside the nested objects for older consumers.

### review-report.json

```jsonc
{
  "schemaVersion": "1",
  "kind": "review",
  "project": "/abs/path/to/my-video",
  "mode": "project",              // project | render
  "status": "fail",               // pass | warn | fail
  "score": 0,
  "summary": { "issueCount": 10, "errorCount": 4, "warningCount": 6, "infoCount": 0,
               "fixOwners": { "vibe": 5, "hostAgent": 5 } },
  "sourceReports": ["STORYBOARD.md", "DESIGN.md", "vibe.config.json"],
  "issues": [ /* see below */ ],
  "nextActions": [ /* the pre-classified fix list - prefer this */ ],
  "retryWith": ["..."],           // compatibility fallback only
  "reportPath": "/abs/path/to/my-video/review-report.json"
}
```

Each issue names its own owner and carries the actions that would resolve it:

```jsonc
{
  "severity": "warning",          // error | warning | info
  "code": "DESIGN_PLACEHOLDER_FIELD",
  "message": "DESIGN.md still contains placeholder palette entries.",
  "file": "DESIGN.md",
  "fixOwner": "host-agent",       // vibe | host-agent
  "suggestedFix": "Fill DESIGN.md or rerun `vibe init --from ... --visual-style <name>`.",
  "actions": [ /* same shape as nextActions entries */ ]
}
```

`nextActions` is the list to drive from, not `issues` - it is deduplicated
across issues and pre-classified:

```jsonc
{
  "id": "command:vibe-build-my-video",
  "kind": "command",              // command | agent | manual
  "label": "Sync the project root composition",
  "command": "vibe build my-video --stage sync --json",
  "fixOwner": "vibe",
  "costTier": "free",             // free | low | high | very-high | unknown
  "safeToAutoRun": true,
  "requiresConfirmation": false,
  "reason": "The root composition is missing or could not be verified.",
  "sourceIssueCodes": ["MISSING_ROOT_COMPOSITION"]
}
```

`kind: "manual"` entries carry no `command` - they need a human or the host
agent to edit a source file. `kind: "agent"` entries carry an `agentPrompt`
instead.

How to drive the loop from these two files is in
[Host Agent Loop](#host-agent-loop) above.

## Project File Roles

Use the folders consistently:

| Path            | Role                                                                                 |
| --------------- | ------------------------------------------------------------------------------------ |
| `brief.md`      | Optional rough input before `vibe init`; can live outside or beside the project.     |
| `STORYBOARD.md` | Beats, narration, duration, and image/video/music cues. Scene audio comes only from explicit `narration`/`music` cues - composition never invents ambient/foley SFX. |
| `DESIGN.md`     | Palette, typography, layout, motion, transitions, and visual anti-patterns.          |
| `media/`        | User-provided source files: photos, screenshots, logos, B-roll, voice recordings.    |
| `assets/`       | Generated or canonical build assets such as narration, backdrops, music, and videos. |
| `references/`   | Legacy only: older projects kept vendored composition rules here. New installs put them under `.agents/skills/hyperframes/` via `vibe scene install-skill`. |
| `renders/`      | Final and intermediate MP4 outputs.                                                  |

When a beat should reuse a local file, use a project-relative path in
`STORYBOARD.md`:

```yaml
backdrop: "media/product-shot.png"
video: "media/broll.mp4"
narration: "media/voice.wav"
asset: "media/logo.png"
```

### The cue vocabulary

Fifteen keys, and only these fifteen.
`vibe storyboard validate` warns on anything else and `vibe storyboard set`
refuses it, so a typo surfaces instead of being silently ignored.

| Cue | Drives |
| --- | --- |
| `duration` | Beat length in seconds. Aim for 6-15; longer beats render static and overstuffed. |
| `narration` | TTS text, or a path to an existing audio file. |
| `backdrop` | Image prompt for the backdrop plate, or a path to an existing image. |
| `video` | Motion prompt for video generation, or a path to existing footage. |
| `keyframe` | Still prompt. Generates a keyframe, then runs image-to-video on it. |
| `music` | Music prompt, or a path to an existing track. |
| `asset` | A project-relative file this beat reuses instead of generating. |
| `voice` | Voice override for this beat, above the project frontmatter default. |
| `characters` | Names from the frontmatter `characters:` pool. One name or a list. |
| `motion` | Animation direction for the scene-authoring agent (see below). |
| `eyebrow` / `kicker` | Lower-third eyebrow. `eyebrow` wins when both are set. |
| `title` | Lower-third headline. Falls back to the beat heading. |
| `caption` / `sub` | Lower-third sub-line. `caption` wins when both are set. |

`motion` is the one cue no deterministic stage reads.
It travels to the host agent in the compose plan, where the instructions treat
it as binding on how elements enter, hold, and leave - the same way `narration`
is binding on the audio.
Every other cue above feeds the build or the composer directly.

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

## Beat hook - Hook

```yaml
duration: 5
characters: [mira]
video: "MIRA treks across the moonlit snowfield, handheld tracking shot, wind and crunching snow"
```
```

Character sheets add image-generation cost, and each character video beat is a
provider video call - run `vibe build --dry-run` to see the estimate and gate
with `--max-cost`.

### Keyframe → image-to-video

For tighter art direction, a beat can declare a `keyframe` cue. During
`vibe build`, the keyframe prompt first produces a still
(`assets/keyframe-<beatId>.png`) - edited from the beat's `characters` sheet when
present (for consistency), otherwise generated from text - and that exact frame
is then animated with Seedance **image-to-video**. The `video` cue, if present,
supplies the motion prompt; otherwise the keyframe prompt is reused.

```yaml
duration: 5
characters: [mira]
keyframe: "MIRA stands on the frozen ice, low-angle hero shot, dramatic aurora light"
video: "slow tilt up as the aurora ripples and pulses overhead"
```

Keyframe mode costs one extra image generation per beat plus the clip
(image-to-video uses standard Seedance pricing, with no reference discount) -
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

- **Faces / character identity** - `--image-provider gemini` (Nano Banana) holds
  the same face across scenes noticeably better than `gpt-image-2`, whose
  identity tends to drift after a few scenes. Use it for character/keyframe-heavy
  pieces. Keyframe edits already pin facial features with an identity-lock
  instruction, but the model still matters.
- **Narration** - `--tts kokoro` is free and local (draft quality); for a final
  or shared cut use `--tts openai` (fast, ~$0.02/video) or `--tts elevenlabs`
  (premium voices). Switching providers regenerates narration and updates the
  render automatically.

## Profiles

`vibe init` supports three profiles:

| Profile   | Use when                                                                | What it creates                                                                                              |
| --------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `minimal` | You only want the authoring docs at first                               | `STORYBOARD.md`, `SCRIPT.md`, `CHARACTERS.md`, `DESIGN.md`, `vibe.config.json`, `.gitignore`                  |
| `agent`   | Recommended for Codex, Claude Code, Cursor, Aider, Gemini CLI, OpenCode | the above plus `AGENTS.md` and `CLAUDE.md`                                                                    |
| `full`    | You want all render/backend files up front                              | the above plus `index.html`, `compositions/`, `assets/`, `renders/`, `hyperframes.json`, `meta.json`          |

The default is `agent`. `CHARACTERS.md` is written for the character-driven
kinds (`cinema`, `story`, `aivideo`); `--kind product` and `--kind motion` skip
it.

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
