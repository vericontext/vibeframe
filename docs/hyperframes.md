---
type: Reference
title: "Composition Engine Boundary"
description: "Where VibeFrame ends and the Hyperframes composition engine begins."
tags: [architecture, hyperframes]
---

# Composition Engine Boundary

VibeFrame is the generation, cost, and review layer around composition
engines. It does not try to replace Remotion or Hyperframes.

- Remotion owns React-based programmatic video and component-driven motion
  graphics.
- Hyperframes owns HTML/CSS/JS scene composition and deterministic browser
  capture for agents.
- VibeFrame owns everything around composition: frontier-model asset
  generation on the user's own keys (Seedance, Runway, Veo, Kling), dry runs
  and the hard `--max-cost` ceiling, `STORYBOARD.md`/`DESIGN.md`, build
  reports, render inspection, edit/remix commands, and host-agent guidance.

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

## The Zero-Key Render, Start To Finish

Because the composition half is local, the whole pipeline runs for $0 before
you own a single provider key: Kokoro TTS narration, HTML/CSS scenes composed
by your coding agent, and a headless Chrome plus FFmpeg render.
The scene authoring in the middle is Hyperframes' contract, not VibeFrame's -
this is the path to use when you want to see the machinery work before paying
for anything.

```bash
vibe init demo --from "30-second video introducing my project"
vibe scene install-skill demo    # upstream's own installer; the rules your agent authors against
```

Then ask your coding agent to finish it:

> Build demo/ into a rendered MP4 with zero API keys.
> Read `demo/AGENTS.md` ("Key Rules for hand-authored scene HTML") first, then
> run `vibe build demo --tts kokoro --skip-backdrop --json` and author the
> scene HTML from `vibe scene compose-prompts demo --json`.
> Run `vibe build demo --stage sync --json` and fix every lint error it
> reports before rendering - it exits non-zero while any remain.
> Then `vibe render demo --json`.

Treat `--stage sync` as the gate.
It lints the composed scenes and exits non-zero on real errors, such as an
unregistered GSAP timeline or a composition div missing
`data-width`/`data-height`.
Rendering past a failed sync produces a black MP4, so fix the scenes first.

That is about three minutes of machine time (measured on v0.113.29 in an
isolated environment: 63s install, 1s init, 66s build including the one-time
~88 MB voice model download, 64s render; repeat runs skip the download).
The scene-authoring pass in the middle is your agent's, so the wall clock
depends on it and on how many lint rounds it needs.

No coding agent available?
`vibe scene add <id> --style announcement --headline "..." --no-audio
--no-image` writes a lint-clean template scene with no model call, and doubles
as a reference for the file shape.

If this is the whole job for you - HTML scene authoring and rendering, no paid
generation - use Hyperframes directly.
It is the better tool for that, and `vibe scene install-skill` installs its
skill either way.

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
media/ (optional user-provided inputs)
AGENTS.md / CLAUDE.md
vibe.config.json
```

The Hyperframes composition rules are not part of the scaffold; upstream's own
installer puts them under `.agents/skills/hyperframes/` via
`vibe scene install-skill`.

Composition/backend files are created when the selected profile or later build
step needs them.

## What VibeFrame Is Not Trying To Replace

VibeFrame does not replace Remotion or Hyperframes. It builds around them. The
practical boundary is:

- choose Remotion for React-first programmatic video;
- choose Hyperframes for focused HTML scene authoring and deterministic
  browser rendering;
- choose VibeFrame for agent-driven video generation on your own provider
  keys, with dry-run pricing and a hard `--max-cost` ceiling around briefs,
  storyboards, build reports, inspection, editing, narration, and export.

This boundary keeps VibeFrame's CLI clear while still benefiting from dedicated
composition engines.
