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
vibe storyboard validate my-video
vibe plan my-video
vibe build my-video --dry-run --max-cost 5
vibe build my-video --max-cost 5
vibe render my-video -o renders/final.mp4
```

`vibe scene ...` is the advanced namespace. It remains useful when you want to add a single HTML scene, lint scene files, install agent rules, or render a scene project with low-level options.

## Project File Roles

Use the folders consistently:

| Path            | Role                                                                                 |
| --------------- | ------------------------------------------------------------------------------------ |
| `brief.md`      | Optional rough input before `vibe init`; can live outside or beside the project.     |
| `STORYBOARD.md` | Beats, narration, duration, and image/video/music cues.                              |
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

## Profiles

`vibe init` supports three profiles:

| Profile   | Use when                                                                | What it creates                                 |
| --------- | ----------------------------------------------------------------------- | ----------------------------------------------- |
| `minimal` | You only want the authoring docs at first                               | `STORYBOARD.md`, `DESIGN.md`, project config    |
| `agent`   | Recommended for Codex, Claude Code, Cursor, Aider, Gemini CLI, OpenCode | authoring docs plus local agent guidance        |
| `full`    | You want all render/backend files up front                              | authoring docs, agent guidance, render scaffold |

The default is `agent`.

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
