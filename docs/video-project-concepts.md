# Video Project Concepts

VibeFrame has two main flows:

- **Create a new video from text:** `vibe init`, edit `STORYBOARD.md` and `DESIGN.md`, then run `vibe build` and `vibe render`.
- **Process existing media:** use `vibe remix`, `vibe edit`, `vibe audio`, or `vibe inspect`.

## Project Commands

Use these commands first:

```bash
vibe init my-video
vibe build my-video --dry-run
vibe build my-video
vibe render my-video -o renders/final.mp4
```

`vibe scene ...` is the advanced namespace. It remains useful when you want to add a single HTML scene, lint scene files, install agent rules, or render a scene project with low-level options.

## Profiles

`vibe init` supports three profiles:

| Profile | Use when | What it creates |
|---|---|---|
| `minimal` | You only want the authoring docs at first | `STORYBOARD.md`, `DESIGN.md`, project config |
| `agent` | Recommended for Codex, Claude Code, Cursor, Aider, Gemini CLI, OpenCode | authoring docs plus local agent guidance |
| `full` | You want all render/backend files up front | authoring docs, agent guidance, render scaffold |

The default is `agent`.

## Backend Metadata

Some render/backend files may include `hyperframes.json`. Treat this as implementation metadata for the HTML renderer, not as the primary VibeFrame project file.

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
vibe build my-video --dry-run
vibe render my-video --dry-run
vibe generate video "..." -p seedance --dry-run
```

Dry runs do not create assets, call paid providers, or render files. They show the planned parameters so humans and agents can confirm the next action.
