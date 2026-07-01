# showcase-aurora — Scene Authoring Project

This is the canonical cross-agent guidance file for this scene project.
Claude Code imports it through `CLAUDE.md`; Codex, Cursor, Aider,
Gemini CLI, OpenCode, and other bash-capable agents should read it
directly.

This project is **bilingual**: it works with both VibeFrame (`vibe`) and
HeyGen Hyperframes (`hyperframes`). You can run either CLI inside this
directory.

## Route the request first

Before opening DESIGN.md, loading the hyperframes skill, or planning
scenes, decide which flow the user actually wants:

- **ASSET (default for ambiguous prompts).** Single image, single video
  clip, single TTS line. Even a verb-less paste of a visual brief lands
  here. Just run `vibe generate image|video|speech "<paste>" -o assets/<name>`.
  Skip DESIGN.md, skip the hyperframes skill.
- **BUILD.** Multi-scene / storyboard / composed video. Triggered when
  the user explicitly asks for "a video built from scenes", "a
  storyboard", "a multi-scene composition", or names `vibe build` /
  `vibe scene ...`. Only here does the hard-gate below apply.
- **REMIX.** Transform a media file already on disk: `vibe remix`,
  `vibe edit`, `vibe audio`.

If you can't tell, ask: *"single asset or multi-scene project?"* before
authoring DESIGN.md or invoking a skill.

## Visual identity hard-gate (BUILD flow only)

**Within the BUILD flow,** author `DESIGN.md` before any scene HTML.
It defines palette, typography, motion, and transition rules. Both the
agent-driven path and the fallback emit reference it; scenes that
contradict DESIGN.md are rejected by the Hyperframes `hyperframes`
skill.

Single-asset requests (`vibe generate image|video|speech|...`) do NOT
consult this file — run the generate command directly.

Browse named styles: `vibe scene list-styles`. Re-seed from one with
`vibe scene init . --visual-style "Swiss Pulse"` (idempotent).

## Brief and local media

`brief.md` is raw intent, not a strict schema. It may contain messy notes,
pasted research, links, product requirements, or a one-line idea. `vibe init
--from brief.md` uses it only to seed `STORYBOARD.md` and `DESIGN.md`;
after init, those two files are the working source of truth.

Use `media/` for user-provided source files: product photos, screenshots,
logos, B-roll, recorded narration, or reference clips. Keep those inputs
inside this project so build references stay project-relative. Do not put user
media in `references/`; that directory is reserved for local composition
rules installed by VibeFrame.

When a beat should reuse a local file, reference it from `STORYBOARD.md`
with a project-relative path:

```yaml
backdrop: "media/product-shot.png" # existing still image
video: "media/broll.mp4"           # existing video/B-roll
narration: "media/voice.wav"       # existing recorded narration
asset: "media/logo.png"            # generic local asset reference
```

Use text cues when you want VibeFrame to generate an asset. Use path cues
when you want VibeFrame to reuse a local file. Avoid absolute paths or parent
directory references; copy files into `media/` first.

## Provider keys and project scope

Use VibeFrame CLI generation for project assets:
`vibe generate image|video|speech ...`. This lets VibeFrame use keys
from `vibe setup --scope project`.

Project-scope keys may live in a parent directory, for example
`../.vibeframe/config.yaml` when this scene was created by
`vibe init launch`. The `vibe` CLI searches upward automatically, so do
not decide keys are missing just because `.vibeframe/config.yaml` is not
inside this scene folder.

To verify scope without exposing secrets, run `vibe doctor --json` from
this directory and inspect `data.scope.activeScope` plus
`data.scope.project.configPath`. Never print config contents. Do not use
a host agent's built-in image/audio generation tool for VibeFrame project
assets unless the user explicitly requests an external, non-VibeFrame
asset.

## App host setup

VibeFrame is CLI-first, not terminal-only. Codex, Claude Code, and Cursor can
drive this project through shell commands, and app hosts can use the MCP server
as a typed tool surface.

```bash
vibe host setup all         # print Codex/Claude/Cursor snippets
vibe host setup all --write # write project/app config
vibe host doctor all --json # verify readiness
```

## Host agent loop

For long-running work, use your host's agent loop (Claude Code, Codex, Cursor,
or another coding-agent host) as the outer loop. VibeFrame should not run a competing
project-level agent loop; it provides `--json` commands, dry runs, cost caps,
`build-report.json`, `review-report.json`, `nextActions`, `safeToAutoRun`,
`requiresConfirmation`, `fixOwner`, deterministic repair, and render
inspection for the host agent to reason over.

Copy-paste agent prompts — plain prompts, not a built-in command:

```text
Build this VibeFrame project into renders/final.mp4. Use --json for every
vibe command, run --dry-run before paid operations, use --max-cost 5 for builds
unless the user sets another budget, read build-report.json and
review-report.json before deciding the next action, prefer nextActions before
guessing, run only safeToAutoRun:true actions automatically, and ask before
requiresConfirmation:true actions. Treat retryWith as the compatibility
fallback, fixOwner:"vibe" as CLI repair work, and fixOwner:"host-agent" as
STORYBOARD.md, DESIGN.md, or composition edits.
Stop only when renders/final.mp4 exists, duration and aspect ratio match the
brief, inspect render --cheap has no errors, any AI review score is >= 90 when AI review is requested, and every
remaining host-agent issue is fixed, accepted with rationale, or reported as
blocked.
```

```text
Finish this VibeFrame render using your host's agent loop as the outer
loop. Use vibe context/schema when unsure, --json everywhere, dry-run before
paid operations, budget cap via --max-cost 5, nextActions before guessing,
build-report.json/review-report.json as loop state, and safeToAutoRun,
requiresConfirmation, and fixOwner to decide between vibe scene repair and
host-agent edits. Stop only after final MP4,
target duration/aspect ratio, clean render inspection, any AI review score >= 90 when AI review is requested, and
no unresolved unacknowledged host-agent issues.
```

## Skills — USE THESE FIRST

**Load the `hyperframes` skill before authoring scenes** — it encodes the
composition rules, motion principles, type system, and visual-identity gate.
If your agent has it installed globally it is already available; otherwise run
`vibe scene install-skill` to eject a local, editable copy (`SKILL.md` +
`references/`, gitignored by default) and read `SKILL.md`.

**Always invoke the relevant skill before authoring scenes.** Skills encode
framework-specific patterns (GSAP timeline registration, data-attribute
semantics, VibeFrame pipeline conventions) that are NOT in generic web docs.

| Skill             | Command          | When to use                                                                           |
| ----------------- | ---------------- | ------------------------------------------------------------------------------------- |
| **hyperframes**   | `/hyperframes`   | Cinematic-quality composition — DESIGN.md hard-gate, named styles, motion principles  |
| **vibe-scene**    | `/vibe-scene`    | VibeFrame's authoring loop, AI assets, lint feedback, pipeline integration            |
| **gsap**          | `/gsap`          | GSAP tweens, timelines, easing                                                        |

Optional: install the upstream Hyperframes skills once per machine when your agent supports skill commands:

```bash
npx skills add heygen-com/hyperframes
```

Restart your agent session (or reload the skill list) after installing.
If skills aren't available, follow the **Key Rules** below — they cover
the framework-level minimum, not the cinematic craft layer.

## Project structure

- `DESIGN.md` — visual identity contract (palette, type, motion, transitions)
- `STORYBOARD.md` — per-beat narration/backdrop/duration cues for `vibe build`
- `media/` — user-provided source files (photos, logos, clips, voice recordings)
- `index.html` — root composition (timeline)
- `compositions/scene-*.html` — per-scene HTML authored by you or the agent
- `assets/` — generated/canonical build media (narration audio, images, video)
- `references/` — composition rule docs, only when ejected via `vibe scene install-skill` (not user media)
- `transcript.json` — Whisper word-level transcript (if narration exists)
- `hyperframes.json` — HF registry config (speak to both toolchains)
- `vibe.config.json` — canonical VibeFrame config (providers, budget)
- `renders/` — output MP4s

## Commands

```bash
vibe scene add <name> --narration "..." --visuals "..."   # Author a new scene via AI
vibe build                                                 # STORYBOARD.md → narrated MP4
vibe scene lint                                             # Validate scenes (in-process HF linter)
vibe render                                                 # Render to MP4

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
6. For render-stable text, do not apply continuous `scale`, `x`, `y`, or
   `filter` tweens to `.scene-content` or any ancestor containing live text.
   Animate background/media layers instead; text/cards should enter briefly and
   then hold still at their final CSS positions.
7. Only deterministic logic — no `Date.now()`, `Math.random()`, or network fetches.

## Linting — run after changes

```bash
vibe scene lint           # preferred — in-process, no network
vibe scene lint --fix     # auto-fix mechanical issues
vibe scene lint --json    # structured output for agent loops
```
