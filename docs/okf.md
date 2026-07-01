---
type: Reference
title: "Open Knowledge Format in VibeFrame"
description: "How VibeFrame's project and docs files map onto Google's Open Knowledge Format (OKF), and how the build workflow flows with it."
tags: [okf, format, frontmatter, agents]
---

# Open Knowledge Format in VibeFrame

[Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
is Google Cloud's vendor-neutral spec (Apache-2.0, announced 2026-06-12) for
storing knowledge as a **directory of markdown files, each with YAML frontmatter
on top and a free-form markdown body below**. One required field — `type` — plus
recommended `title`, `description`, `resource`, `tags`, `timestamp`. Custom keys
are allowed; consumers preserve unknown fields. `index.md` is the bundle listing;
links are plain markdown.

That is exactly the shape VibeFrame already uses, just made explicit.

## Why it fits VibeFrame

A VibeFrame project **is** a curated knowledge bundle for the coding agent that
builds the video. The agent doesn't hold the whole film in its head — it reads
the project's files as context, then acts:

| File | OKF `type` | What the agent reads it for |
| --- | --- | --- |
| `STORYBOARD.md` | `Storyboard` | beats, narration, character/keyframe/video cues |
| `DESIGN.md` | `Design` | palette, typography, motion, transition rules |
| `CHARACTERS.md` | `Characters` | the recurring cast + identity anchors |
| `SCRIPT.md` | `Script` | the spoken/narration script |
| `COMPOSITION.md` | `Composition` | the structural compose contract |
| `docs/*.md` | `Reference` | the product/CLI knowledge base |

Frontmatter + body was already the pattern (`storyboard-parse.ts`,
`design-parse.ts`), previously with three independent parsers. This is now
consolidated behind one `extractFrontmatter()` helper
(`packages/cli/src/commands/_shared/frontmatter.ts`), and the scaffolded
`STORYBOARD.md` / `DESIGN.md` carry an OKF `type`.

## How the workflow flows with it

```text
vibe init  → scaffolds an OKF bundle (typed STORYBOARD/DESIGN + docs)
             ↓ the agent reads by type, not by guessing filenames
edit       → STORYBOARD/DESIGN stay human- and agent-editable markdown
vibe build → parsers read the same frontmatter; unknown OKF keys pass through
             ↓
render     → the bundle is portable: `git clone` ships it, `cat` reads it
```

Practical wins:
- **Routing by `type`** — an OKF-aware agent (or a future `vibe` command) can
  pick up "the `Design` doc" or "all `Storyboard` docs" without hardcoded paths.
- **Portability** — no database or SDK; the project directory is the knowledge.
- **Interop** — any OKF-consuming tool can read a VibeFrame project, and
  VibeFrame docs render directly in Mintlify (OKF's `title`/`description` are the
  fields Mintlify needs — see `docs/docs.json`).

## Current status & what's deliberately left

- **Done:** shared frontmatter helper; `type` on scaffolded `STORYBOARD.md` /
  `DESIGN.md`; OKF frontmatter on all `docs/*.md`; an OKF `index.md` listing.
- **Assessed, not yet adopted:** `type` on the prose files (`CHARACTERS.md`,
  `SCRIPT.md`, `COMPOSITION.md`) — additive and safe, but those files aren't
  parsed today, so it buys OKF-conformance without changing behavior; worth doing
  when there's an OKF consumer to justify it. Routing helpers (`vibe` reading a
  bundle by `type`) are a natural follow-up, not a requirement.

OKF changes nothing about how VibeFrame runs — it just names a pattern the
project already followed, which makes the whole project legible to agents.
