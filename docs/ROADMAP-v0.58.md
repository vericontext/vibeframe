# ROADMAP — v0.58 / v0.59 / v0.60

Architectural pivot: **stop reinventing video composition craft, adopt
Hyperframes' skill ecosystem, and lean into VibeFrame's actual unique
value (asset generation + YAML orchestration + agent integration).**

This document is the plan, not a polished design doc. Bullets reflect
the smallest credible step at each phase. Each phase is one PR.

---

## Why this pivot

A long iteration chain on `vibe scene` (PRs #98 → #104) tried to encode
video composition craft into 5 hardcoded preset templates plus
~600 lines of hand-tuned helpers (`idleHeroPulse`, `kenBurnsTween`,
`fitFontSize`, z-index inversion, scope crossfade, …). Every iteration
fixed one regression and surfaced two more, and every rendered demo
still felt generic compared to Hyperframes.

A deep read of `oss/hyperframes/skills/` clarified why: Hyperframes
publishes **2,972 lines of explicit craft knowledge** as agent skills
— `DESIGN.md` hard-gate, eight named visual styles (Swiss Pulse /
Velvet Standard / Deconstructed / …), motion-principles, typography
rules, anti-patterns ("Lazy Defaults to Question"), validation
scripts. That is the layer where pixel-level cinematic quality lives.
A 600-line TypeScript emit can never reach it.

**The right move is to stop competing on that layer and integrate.**

| Layer | Owner |
|---|---|
| Pixel render (BeginFrame, parity, HDR) | Hyperframes |
| Composition craft (skills, DESIGN.md, motion-principles) | Hyperframes |
| Asset generation (gpt-image-2, fal Seedance, Kokoro, Whisper) | **VibeFrame** |
| Pipeline orchestration (YAML, cost preview, --resume, --dry-run) | **VibeFrame** |
| Agent integration (MCP server, vibe agent, Claude Code skills) | **VibeFrame** |

VibeFrame's job is the top half. We let Hyperframes do the bottom
half. The two compose.

---

## Demo MP4 — already removed

The `apps/web/public/demo/v0.55-self-promo.mp4` artefact has been
deleted from this branch. The /demo hero now leads with the three
asciinema recordings (CLI / agent / Claude Code) which were already
authentic and hand-recorded. When this roadmap ships a credible new
demo, that slot is where it goes back in.

---

## Phase 1 — v0.58 (target: 1 week)

**Goal: bring the Hyperframes skill ecosystem into VibeFrame projects
without forking it.**

### v0.58.0 — `vibe scene init` adopts Hyperframes skills

- `vibe scene init` runs `npx skills add heygen-com/hyperframes` (or
  copies skills into `.claude/skills/`) — same install pattern
  Hyperframes documents.
- Generates a `DESIGN.md` template in the project root with the
  hard-gate sections (`## Style Prompt`, `## Colors`, `## Typography`,
  `## What NOT to Do`).
- Optional flag: `vibe scene init my-promo --visual-style "Swiss Pulse"`
  pre-fills `DESIGN.md` from one of Hyperframes' 8 named visual
  styles. (List them via `vibe scene styles --list`.)
- Existing `scene-html-emit.ts` 5-preset path is **kept** but documented
  as "quick draft / fallback when no agent is in the loop". Not the
  intended primary path.
- Documentation update: `.claude/skills/vibe-scene/SKILL.md` says "for
  high-craft compositions, hand `DESIGN.md` + `STORYBOARD.md` to
  Claude Code with the `hyperframes` skill loaded — emit is a
  fallback".

**Out of scope for v0.58.0:** any change to `scene-html-emit.ts`
internals, any change to YAML pipeline, demo MP4 regeneration.

### v0.58.1 — DESIGN.md feeds image generation

- `vibe scene add --visuals "..."` reads `DESIGN.md` if present and
  prepends the `## Style Prompt` paragraph to the gpt-image-2 prompt.
- Gives every generated backdrop the same visual register without
  asking the user to repeat themselves.
- Smoke test: regenerate `examples/scene-promo/assets/scene-*.png`
  with a single `DESIGN.md` and confirm the five backdrops feel like
  they came from one art director.

---

## Phase 2 — v0.59 (target: 1 week)

**Goal: YAML pipeline action that orchestrates skill-aware composition.**

### v0.59.0 — `compose-scenes-with-skills` action

- New `PipelineAction` value: `compose-scenes-with-skills`.
- Action body: collect Hyperframes skill content + `DESIGN.md` +
  `STORYBOARD.md` + the asset paths from prior pipeline steps; send
  them to a Claude API call (Sonnet 4.6 default, Opus 4.7 with
  `--effort high` flag); parse the returned HTML; write each scene
  to `compositions/scene-<id>.html`.
- Cost estimate enters the YAML `--dry-run` budget calculation:
  scene count × Sonnet 4.6 prompt+completion cost (≈ $0.10 / scene
  with skill context).
- Determinism: include a seed in the prompt; cache by content hash
  in `~/.vibeframe/cache/compose-scenes/<sha>.html`. Re-runs hit
  cache unless any input changes.
- Lint pass after compose: every emitted HTML is fed through
  `runProjectLint()` and any errors abort the step (caller can
  `--resume`).

### v0.59.1 — End-to-end YAML

- Author `examples/vibeframe-promo.yaml` that runs the full pipeline
  in a single command:
  ```yaml
  inputs: { design: DESIGN.md, script: SCRIPT.md, storyboard: STORYBOARD.md }
  steps:
    - id: assets    # generate-image × N + Kokoro TTS × N + Whisper × N
    - id: compose   # compose-scenes-with-skills
    - id: render    # scene-render (Hyperframes producer, already wired)
  ```
- `vibe run examples/vibeframe-promo.yaml --dry-run` should print a
  cost preview that reads sensibly (≈ $1 for a 5-scene promo).
- `vibe run examples/vibeframe-promo.yaml` should produce a working
  MP4 on a clean machine with the API keys set.

---

## Phase 3 — v0.60 (target: 1 week)

**Goal: ship the new demo + position the docs accordingly.**

### v0.60.0 — Demo MP4 v2 + page reorg

- Run the v0.59 pipeline against a real, considered DESIGN.md (one of
  the 8 Hyperframes named styles, e.g. **Swiss Pulse** for "developer
  tool launch" mood) + a SCRIPT.md / STORYBOARD.md authored for the
  demo specifically (not "VibeFrame about VibeFrame" — pick a
  different topic so visitors don't have to understand the product
  to evaluate the output).
- Slot the rendered MP4 back into the /demo hero slot we vacated.
- Side-by-side the YAML file with the rendered MP4 in the hero — the
  point is "this YAML produced this video".

### v0.60.1 — Landing-page copy + README pivot

- Reposition the YAML pipeline as the primary differentiator
  ("Video as Code"), with explicit acknowledgement that composition
  craft comes from Hyperframes skills underneath.
- README's existing "Built on Hyperframes" framing (PR #96) gets
  upgraded: not just "we use the renderer", but "we use the entire
  skill ecosystem".
- Show HN draft (separate doc, not committed yet): leads with
  "Type a YAML, get a video, 13 AI providers, runs in agent loops"
  — not "best-looking AI video tool".

---

## Risks / open questions

1. **LLM cost per scene.** Compose-scenes calls cost ~$0.10/scene with
   skill context. A 10-scene promo is $1. Acceptable, but
   `--dry-run` budget must surface it clearly.
2. **Determinism.** LLM HTML output isn't bit-stable across runs.
   Mitigation: content-hash cache + explicit seed in prompt. Worst
   case: ship pinned `compositions/*.html` files that downstream
   pipelines can choose to re-emit or reuse.
3. **Skill bundling.** Apache 2.0 license on Hyperframes skills — we
   can vendor copies into VibeFrame projects, or invoke their `skills
   add` command. Vendoring is simpler for offline / CI but creates a
   sync burden. Punt this decision to v0.58.0 — try invocation first.
4. **The agent-driven craft path requires Claude Code (or compatible)
   in the loop.** Users without agents fall back to the 5-preset
   `scene-html-emit` path. That's fine for a v0.58 ship; document the
   distinction clearly.
5. **`vibe scene` CLI surface area gets confusing.** `add` (5
   presets, ad-hoc), `compile` (MD-driven), `compose-scenes-with-skills`
   (YAML pipeline action). Phase 4+ may merge these — out of scope
   for this roadmap.

---

## What this roadmap explicitly is NOT

- Not "fix the v0.55 self-promo MP4 one more time."
- Not "iterate on `scene-html-emit.ts` presets."
- Not "implement composition variables / shader transitions / layered
  GSAP per preset." (That's Hyperframes' lane.)
- Not "compete on cinematic finish with hand-authored motion graphics."

If the next round of feedback pushes any of those — pause and re-read
this section.
