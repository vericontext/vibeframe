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

## Two authoring paths

VibeFrame supports two paths into the same project layout. Pick by the kind
of output the user expects.

| Path | When to use | Output quality |
|---|---|---|
| **High-craft** — `DESIGN.md` + `/hyperframes` skill in Claude Code | User wants cinematic finish, named visual identity, motion principles, transitions that actually punctuate the narrative | Matches what the Hyperframes ecosystem ships |
| **Quick draft / fallback** — `vibe scene add --style <preset>` | No agent in the loop, or fast iteration on layout/timing/text — same project format, just template-rendered HTML | Generic but functional; great for proof-of-concept and CI dogfood |

**Default to the high-craft path when an agent is available.** The
`scene-html-emit` 5-preset path exists so non-agent flows still work — it
is intentionally not the cinematic finish layer.

## High-craft path (DESIGN.md → agent → HTML)

1. `vibe scene init my-promo --visual-style "Swiss Pulse"` — seeds
   `DESIGN.md` (palette, typography, motion, transitions) plus the
   `vibe.project.yaml`/`hyperframes.json`/`index.html` scaffold.
2. Install / load the Hyperframes skill set so `/hyperframes` is in scope:
   ```bash
   npx skills add heygen-com/hyperframes
   ```
3. Hand the user's `DESIGN.md` + `STORYBOARD.md` (and any narration text)
   to Claude Code with `/hyperframes` loaded; ask it to author each scene
   HTML directly under `compositions/scene-<id>.html`. The skill enforces
   the visual identity contract — scenes that contradict DESIGN.md are
   rejected on lint.
4. `vibe scene lint --fix` for mechanical issues, `vibe scene render` to
   MP4. Asset generation (`vibe scene add --visuals "..." --no-html`) can
   still run alongside.

`DESIGN.md` is the hard-gate: never author scene HTML before it exists.
Browse named styles via `vibe scene styles`; re-seed an existing project
with `vibe scene init . --visual-style "<name>"` (idempotent).

## Quick-draft path (5-preset `scene add`)

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
vibe scene init <dir> [-r 16:9|9:16|1:1|4:5] [-d <sec>] [--visual-style "<name>"]
vibe scene styles [<name>]                    # list / show vendored visual identities
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

- `--narration "..."` → TTS provider (see below) → `assets/narration-<id>.{mp3|wav}`
- `--narration-file <path>` → copies a pre-existing wav/mp3 (TTS skipped)
- After audio exists → Whisper word-level transcribe → `assets/transcript-<id>.json`
- `--visuals "..."` → Gemini (default) or OpenAI image → `assets/scene-<id>.png`
- `--no-audio` / `--no-image` / `--no-transcribe` skip individual stages
  (useful for hand-authored or CI-friendly seeds).

### TTS provider (`--tts <auto|elevenlabs|kokoro>`)

| Provider | Cost | Quality | Cold start | Output |
|---|---|---|---|---|
| **ElevenLabs** | ~$0.02/scene | high | none | mp3 |
| **Kokoro** (local, Apache 2.0) | $0 | medium-high | first call downloads ~330MB | wav |

`--tts auto` (default): picks ElevenLabs when `ELEVENLABS_API_KEY` is set,
otherwise falls back to Kokoro. Local-only users get a working pipeline
with no API key. The first Kokoro call shows a `~330MB download` spinner
and caches to `~/.cache/huggingface/hub`; subsequent calls add ~1–2s.

Voice: `--voice af_heart` (Kokoro, default), `--voice rachel` (ElevenLabs).

### Word-level caption sync

Whenever `assets/transcript-<id>.json` exists, three presets render each
narration word as its own `<span class="word">` and animate them at the
audio's absolute word start time:

- `simple` — caption splits into word spans with fade-in at each start.
- `explainer` — subtitle splits; kicker + title stay static.
- `kinetic-type` — uses transcript timing instead of even stagger.
  **Visible text comes from the transcript**, not `--headline` (narration
  is the ground truth).

`announcement` and `product-shot` ignore the transcript — their headlines
are intentionally static. Use `--no-transcribe` to skip Whisper if you
don't want word-sync (or have no `OPENAI_API_KEY`).

### Audio in the rendered MP4 (v0.55)

`vibe scene render` runs an ffmpeg post-pass that overlays every
`<audio>` element onto the producer's video at its absolute timeline
position. The producer's video stream is copied untouched (`-c:v copy`
— no re-encode) so the only added cost is one cheap audio mux.

The render JSON now reports `audioCount` (how many `<audio>` elements
were found) and `audioMuxApplied` (whether the ffmpeg pass succeeded).
If `ffmpeg` is missing from PATH the producer's silent video is left
in place and `audioMuxWarning` carries the reason.

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
