---
name: vibe-scene
description: Author and edit per-scene HTML compositions (Hyperframes-backed). Use when the user wants editable, agent-friendly scenes instead of opaque MP4s — or wants to iterate on a single scene without re-rendering the whole project.
---

# vibe-scene — Per-scene HTML authoring

A scene project is a directory that is **bilingual**: it works with both
`vibe` and `npx hyperframes`. Each scene is one HTML file with scoped CSS and
a paused GSAP timeline. Cheap to edit, cheap to lint, expensive only at render.

Prefer this over `vibe pipeline script-to-video --format mp4` whenever the
user expects to **iterate** on text, layout, or timing — text tweaks don't
require regenerating video.

## Authoring loop

```bash
vibe scene init my-promo -r 16:9 -d 30          # 1. scaffold project
vibe scene add intro --style announcement \
    --headline "Ship videos, not clicks"        # 2. author scene(s)
vibe scene lint                                 # 3. validate
vibe scene render                               # 4. render to MP4 (Chrome)
```

`vibe scene init` is **idempotent** — running it on an existing Hyperframes
directory merges `hyperframes.json` instead of clobbering it. Safe to invoke
on user-provided projects.

## Subcommands

```bash
vibe scene init <dir> [-r 16:9|9:16|1:1|4:5] [-d <sec>]
vibe scene add <name> --style <preset> [...]
vibe scene lint [<root>] [--json] [--fix]
vibe scene render [<root>] [--fps 30] [--quality standard] [--format mp4]
```

Run `vibe scene <sub> --help` for the full flag list, or
`vibe schema scene.<sub>` for a machine-readable JSON shape.

## Style presets (for `vibe scene add --style`)

- **simple** — backdrop + bottom caption (default)
- **announcement** — single huge headline, gradient text
- **explainer** — kicker + title + subtitle stack
- **kinetic-type** — words animate in word-by-word
- **product-shot** — corner label + bottom headline + slow zoom

All presets accept `--narration <text|file>`, `--visuals <prompt>`,
`--headline`, `--kicker`. With `--narration`, scene duration auto-derives
from the generated TTS audio.

## Asset generation

`vibe scene add` integrates the existing AI providers:

- `--narration "..."` → ElevenLabs TTS → `assets/narration-<id>.mp3`
- `--visuals "..."` → Gemini (default) or OpenAI image → `assets/scene-<id>.png`
- `--no-audio` / `--no-image` skip generation (useful for hand-authored or
  CI-friendly seeds).

If keys are missing, the command exits with a usage error before any spend —
no partial state.

## Lint feedback loop (agent pattern)

```bash
vibe scene lint --json
```

Returns structured `{ ok, errorCount, warningCount, files: [{file, findings:[...]}], fixed: [...] }`.
Each finding has `severity`, `code`, `message`, and an optional `fixHint`. The
recommended agent loop:

1. Run `vibe scene lint --json --fix` (mechanical fixes applied).
2. If `errorCount > 0`, read the findings and edit the scene HTML.
3. Re-lint. **Cap retries at 3** — if errors persist, fall back to a template
   preset (`vibe scene add <id> --style simple --force`) and surface the
   error to the user.

`--fix` currently auto-resolves: missing `class="clip"`, missing
`data-track-index`, GSAP timeline registration. Layout and content errors
must be hand-fixed.

## Scripts-to-scenes (one command)

```bash
vibe pipeline script-to-video "..." --format scenes -o my-video/ -a 16:9
```

This bundles `scene init` + segment-to-scene authoring + lint + render into a
single pipeline. Output is an editable scene project, not a sealed MP4. Re-run
`vibe scene render` after editing any scene to refresh the final video.

Default `--format` is **mp4** for back-compat in v0.53; flips to **scenes** in
v0.54.

## Hyperframes interop

If `/hyperframes` and `/gsap` skills are installed, prefer them for
scene-internal animation work — they encode the upstream framework rules
directly. VibeFrame's `vibe scene lint` is the same in-process linter HF uses,
so findings transfer 1:1.

If neither is installed, the **Key Rules** at the top of every scene project's
`CLAUDE.md` (written by `vibe scene init`) cover the essentials:

1. Every timed element needs `data-start`, `data-duration`, `data-track-index`.
2. Timed elements **MUST** have `class="clip"`.
3. Timelines must be paused and registered: `window.__timelines["<id>"] = gsap.timeline({ paused: true })`.
4. `<video>` uses `muted`; route audio through a separate `<audio>` element.
5. Sub-compositions reference scenes via `data-composition-src="compositions/<file>.html"`.
6. No `Date.now()`, `Math.random()`, or network fetches — render must be deterministic.

## When to use VibeFrame vs raw Hyperframes

| Task | Tool |
|------|------|
| Generate narration + image, then author scene | `vibe scene add` |
| Generate a full scenes project from a script | `vibe pipeline script-to-video --format scenes` |
| Hand-tweak a single scene's animation | edit `compositions/<file>.html` directly |
| Render the project | `vibe scene render` *or* `npx hyperframes render` (equivalent) |
| Lint | `vibe scene lint` *or* `npx hyperframes lint` (equivalent) |

The `vibe` CLI adds asset generation, AI orchestration, and pipeline
integration on top of Hyperframes' rendering primitives. Pick `npx hyperframes`
for pure framework work; pick `vibe` when AI assets or pipelines are involved.

## Quality checklist before render

- [ ] `vibe scene lint` exits 0 (or only warnings)
- [ ] `vibe doctor` confirms a usable Chrome (required for render)
- [ ] Root `data-duration` matches the sum of clip durations (auto-managed by
      `vibe scene add` — only verify if you hand-edited)
- [ ] Aspect ratio in `vibe.project.yaml` matches the destination platform

## Common failures & fixes

- **`Root composition not found`** — run `vibe scene init` first or pass `--project <dir>`.
- **`Could not determine canvas dimensions`** — `index.html` lost its `data-width`/`data-height`. Re-init or copy them from `vibe.project.yaml`.
- **`host_missing_composition_id` lint error** — root clip refs lost their `data-composition-id`. `--fix` doesn't repair this; re-add the scene with `--force`.
- **Render hangs at 0% on macOS** — Chrome detection failed. Run `vibe doctor`; install Chrome / set `CHROME_PATH`.
- **Scene HTML produced by Claude fails lint repeatedly** — drop to a template preset (`--style simple`) and treat the AI output as a starting point for hand-edits, not a finished asset.
