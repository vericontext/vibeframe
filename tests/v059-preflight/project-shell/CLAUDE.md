# project-shell — Scene Authoring Project

This project is **bilingual**: it works with both VibeFrame (`vibe`) and
HeyGen Hyperframes (`hyperframes`). You can run either CLI inside this
directory.

## Visual identity hard-gate

**Author `DESIGN.md` before any scene HTML.** It defines palette,
typography, motion, and transition rules. Both the agent-driven path and
the fallback emit reference it; scenes that contradict DESIGN.md are
rejected by the Hyperframes `hyperframes` skill.

Browse named styles: `vibe scene styles`. Re-seed from one with
`vibe scene init . --visual-style "Swiss Pulse"` (idempotent).

## Skills — USE THESE FIRST

**Always invoke the relevant skill before authoring scenes.** Skills encode
framework-specific patterns (GSAP timeline registration, data-attribute
semantics, VibeFrame pipeline conventions) that are NOT in generic web docs.

| Skill             | Command          | When to use                                                                           |
| ----------------- | ---------------- | ------------------------------------------------------------------------------------- |
| **hyperframes**   | `/hyperframes`   | Cinematic-quality composition — DESIGN.md hard-gate, named styles, motion principles  |
| **vibe-scene**    | `/vibe-scene`    | VibeFrame's authoring loop, AI assets, lint feedback, pipeline integration            |
| **gsap**          | `/gsap`          | GSAP tweens, timelines, easing                                                        |

Install the Hyperframes skills once per machine:

```bash
npx skills add heygen-com/hyperframes
```

Restart your agent session (or reload the skill list) after installing.
If skills aren't available, follow the **Key Rules** below — they cover
the framework-level minimum, not the cinematic craft layer.

## Project structure

- `DESIGN.md` — visual identity contract (palette, type, motion, transitions)
- `index.html` — root composition (timeline)
- `compositions/scene-*.html` — per-scene HTML authored by you or the agent
- `assets/` — shared media (narration audio, images, video)
- `transcript.json` — Whisper word-level transcript (if narration exists)
- `hyperframes.json` — HF registry config (speak to both toolchains)
- `vibe.project.yaml` — VibeFrame config (providers, budget)
- `renders/` — output MP4s

## Commands

```bash
vibe scene add <name> --narration "..." --visuals "..."   # Author a new scene via AI
vibe scene lint                                             # Validate scenes (in-process HF linter)
vibe scene render                                           # Render to MP4

# Hyperframes CLI (if installed — works in this project too)
npx hyperframes preview
npx hyperframes render
```

## Key Rules (for hand-authored scene HTML)

1. Every timed element needs `data-start`, `data-duration`, and `data-track-index`.
2. Elements with timing **MUST** have `class="clip"` — the framework uses this for visibility control.
3. Timelines must be paused and registered on `window.__timelines`:
   ```js
   window.__timelines = window.__timelines || {};
   window.__timelines["composition-id"] = gsap.timeline({ paused: true });
   ```
4. Videos use `muted` with a separate `<audio>` element for the audio track.
5. Sub-compositions use `data-composition-src="compositions/file.html"`.
6. Only deterministic logic — no `Date.now()`, `Math.random()`, or network fetches.

## Linting — run after changes

```bash
vibe scene lint           # preferred — in-process, no network
vibe scene lint --fix     # auto-fix mechanical issues
vibe scene lint --json    # structured output for agent loops
```
