# Hyperframes Renderer Boundary

VibeFrame uses Hyperframes as its HTML scene rendering layer. They are not
competing abstractions in this repository: Hyperframes handles deterministic
browser-based composition and capture, while VibeFrame adds CLI workflows,
provider routing, YAML orchestration, agent guidance, media generation, and
traditional editing commands around that renderer.

## Current Mental Model

Use VibeFrame when you want a video workflow that an agent or shell script can
drive end to end:

```bash
vibe init my-video --profile agent
vibe build my-video
vibe render my-video -o renders/final.mp4
```

Use the lower-level scene namespace only when you need direct scene operations:

```bash
vibe scene lint index.html --project my-video --fix
vibe render index.html --project my-video --quality draft
```

Use Hyperframes directly when your task is only HTML composition/rendering and
you do not need VibeFrame's provider routing, YAML pipelines, MCP tools, or
editing commands.

## What Each Layer Provides

| Concern                                    | Hyperframes                  | VibeFrame                                                  |
| ------------------------------------------ | ---------------------------- | ---------------------------------------------------------- |
| HTML scene composition and browser capture | Primary layer                | Uses it through the scene renderer                         |
| Visual scene files                         | HTML/CSS/JS composition      | `compositions/*.html` inside a VibeFrame project           |
| Storyboard authoring                       | Not the main abstraction     | `STORYBOARD.md` + `DESIGN.md`                              |
| Project-level flow                         | Hyperframes project commands | `vibe init` -> `vibe build` -> `vibe render`               |
| AI image/video generation                  | Out of scope                 | `vibe generate image`, `vibe generate video`, YAML actions |
| Editing existing media                     | Out of scope                 | `vibe edit`, `vibe audio`, `vibe remix`                    |
| Agent guidance                             | Host-specific skills/rules   | `AGENTS.md`, `SKILL.md`, host scaffolding, guides          |
| MCP surface                                | Out of scope                 | `@vibeframe/mcp-server` typed tools                        |
| Video-as-code pipelines                    | Out of scope                 | `vibe run pipeline.yaml`                                   |

## Why Hyperframes Still Appears In Projects

Some generated project files may include `hyperframes.json` or Hyperframes
skill references. Treat those as renderer metadata and composition guidance,
not as the primary VibeFrame project API.

New users should start with:

```bash
vibe init my-video --profile agent
```

The default project surface is:

```text
STORYBOARD.md
DESIGN.md
SKILL.md
vibe.project.yaml
```

Render/backend files are created when the selected profile or later build step
needs them.

## What VibeFrame Is Not Trying To Replace

VibeFrame does not replace Hyperframes' renderer. It builds on it. The practical
boundary is:

- choose Hyperframes for focused HTML scene authoring and rendering;
- choose VibeFrame for agent-driven video workflows that combine storyboards,
  AI media generation, YAML pipelines, editing commands, narration, and export.

This boundary keeps VibeFrame's CLI clear while still benefiting from the
Hyperframes rendering engine.
