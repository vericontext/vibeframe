# Composition Engine Boundary

VibeFrame is the workflow layer around composition engines. It does not try to
replace Remotion or Hyperframes.

- Remotion owns React-based programmatic video and component-driven motion
  graphics.
- Hyperframes owns HTML/CSS/JS scene composition and deterministic browser
  capture for agents.
- VibeFrame owns the agentic path around those engines: `STORYBOARD.md`,
  `DESIGN.md`, provider routing, generated assets, build reports, render
  inspection, edit/remix commands, and host-agent guidance.

## Current Mental Model

Use VibeFrame when you want a coding agent or shell script to drive a video
from brief to MP4:

```bash
vibe setup --scope project
vibe init my-video --from brief.md --profile agent
vibe build my-video --dry-run --json
vibe build my-video --json
vibe render my-video -o renders/final.mp4 --json
vibe inspect render my-video --cheap --json
```

Use the lower-level scene namespace only when you need direct scene operations:

```bash
vibe scene lint index.html --project my-video --fix
vibe render index.html --project my-video --quality draft
```

Use Hyperframes directly when the task is only HTML composition/rendering and
you do not need storyboard files, provider routing, generated assets, build
reports, YAML pipelines, MCP tools, or editing commands.

Use Remotion directly when the task is a React video application or a
component-driven motion graphics workflow and you do not need VibeFrame's
agent/project layer.

## What Each Layer Provides

| Concern                         | Remotion                    | Hyperframes          | VibeFrame                                                 |
| ------------------------------- | --------------------------- | -------------------- | --------------------------------------------------------- |
| Primary abstraction             | React components            | HTML/CSS/JS scenes   | Brief, `STORYBOARD.md`, `DESIGN.md`                       |
| Render/composition layer        | Primary layer               | Primary layer        | Uses composition engines through project workflows        |
| Agent-first project loop        | Not the main abstraction    | Composition-focused  | Setup, init, plan, build, render, inspect                 |
| AI image/video/audio generation | Optional ecosystem packages | Out of scope         | Provider-routed CLI commands and build stages             |
| Existing-media edits            | Out of scope                | Out of scope         | `vibe edit`, `vibe audio`, `vibe remix`                   |
| Machine-readable reports        | Out of scope                | Renderer diagnostics | `build-report.json`, `review-report.json`, JSON envelopes |

## Why Hyperframes Still Appears In Projects

Generated projects may include Hyperframes metadata or skill references. Treat
those as renderer metadata and composition guidance, not as the primary
VibeFrame project API.

New users should start with:

```bash
vibe init my-video --profile agent
```

The default public project surface is:

```text
STORYBOARD.md
DESIGN.md
AGENTS.md / CLAUDE.md
SKILL.md
vibe.config.json
```

Composition/backend files are created when the selected profile or later build
step needs them.

## What VibeFrame Is Not Trying To Replace

VibeFrame does not replace Remotion or Hyperframes. It builds around them. The
practical boundary is:

- choose Remotion for React-first programmatic video;
- choose Hyperframes for focused HTML scene authoring and deterministic
  browser rendering;
- choose VibeFrame for agent-driven video workflows that combine briefs,
  storyboards, AI media generation, build reports, inspection, editing,
  narration, and export.

This boundary keeps VibeFrame's CLI clear while still benefiting from dedicated
composition engines.
