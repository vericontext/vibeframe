# v0.59 pre-flight experiment — report

**Date:** 2026-04-26 (run pre-v0.59 implementation)
**Question:** Can a single Claude Sonnet 4.6 API call, given the Hyperframes
skill bundle + DESIGN.md + per-beat storyboard, produce a sub-composition
HTML file that survives `vibe scene lint`?
**Verdict:** **Yes — green light for v0.59 `compose-scenes-with-skills` action.**

---

## Setup

- **Fixtures:** `fixtures/DESIGN.md` (Swiss Pulse style for VibeFrame brand),
  `fixtures/STORYBOARD.md` (one beat: 3-second hook with two text elements),
  `fixtures/SCRIPT.md`.
- **Skill bundle:** Hyperframes' `SKILL.md`, `house-style.md`,
  `references/motion-principles.md`, `references/typography.md`,
  `references/transitions.md` — concatenated into the system prompt
  (50,996 chars).
- **Project shell:** scaffolded via `vibe scene init project-shell`. The
  LLM-generated `compositions/scene-beat-1.html` is dropped into this
  shell, then `vibe scene lint --json` runs.
- **Model:** `claude-sonnet-4-6`, max_tokens=6000, temperature default.

## Pass 1 — single shot

| Metric | Value |
|---|---|
| Latency | 8.5 s |
| Input tokens | 15,253 |
| Output tokens | 758 |
| Cost | $0.057 |
| HTML size | 2,134 chars |
| Lint result | **0 errors / 2 info warnings — PASS** |

The two warnings are `external_script_dependency` (informational, expected
for `<script src="…gsap.min.js">`) and two `root_composition_missing_data_*`
on the inner `<div data-composition-id="scene-beat-1">` — the linter treats
the inner template root as a "root composition" and asks for
`data-start`/`data-duration`, even though those live on the outer clip
reference in `index.html`. Borderline linter quirk; not a generation
failure.

### Quality audit (manual)

The HTML matched DESIGN.md and the storyboard precisely:

- Palette: `#0A0A0F`, `#F5F5F7`, `#0066FF` — exact hex from DESIGN.md
- Typography: Inter weight 800 for headline, weight 400 for subhead, with
  `letter-spacing: 0.15em` on the all-caps subhead — matches DESIGN.md
- Sizing: headline 120px, subhead 32px — matches storyboard
- Layout: scene-content fills via flex + padding (correct
  layout-before-animation pattern)
- Animations: `gsap.from()` only, no exit `gsap.to()` (correct per HF
  multi-scene rules), eases `expo.out` and `power3.out` matching DESIGN.md
  motion section
- Timing: 0.3 s headline entrance, 1.0 s subhead entrance — matches
  storyboard exactly
- No banned constructs (`Math.random`, `Date.now`, `repeat: -1`, `<br>`)

## Pass 2 — determinism (5 runs, same prompt)

| Metric | Value |
|---|---|
| Lint pass rate | **5 / 5 (100 %)** |
| Mean latency | 8.4 s |
| Mean HTML size | 2,217 chars |
| Total cost (5 runs) | $0.289 ($0.058/run) |
| Pairwise diff (line-Jaccard) — mean | **33.1 %** |
| Pairwise diff — max | 45.9 % |

Pairwise diffs:

```
  run 1 ↔ run 2: 12.9%      run 2 ↔ run 5: 22.4%
  run 1 ↔ run 3: 45.9%      run 3 ↔ run 4: 18.3%
  run 1 ↔ run 4: 42.0%      run 3 ↔ run 5: 39.3%
  run 1 ↔ run 5: 26.0%      run 4 ↔ run 5: 42.9%
  run 2 ↔ run 3: 44.7%      run 2 ↔ run 4: 36.7%
```

Outputs vary in element ordering, CSS class names, and timeline
construction patterns — but every run is semantically equivalent and
lint-clean.

## Architectural implications for v0.59

### Cost / latency budget

- 5-scene promo: ~$0.29, ~42 s sequential / ~8 s with per-beat fanout
- 20-scene long-form: ~$1.16, ~3 m sequential / ~8 s with fanout
- Acceptable for `--dry-run` budget surface; well under HF's "agent in a
  Claude Code session" cost (which runs the same calls but un-cached).

### Caching strategy

ROADMAP-v0.58.md called for "content-hash cache". Pass 2 confirms:
**cache by INPUT hash, not output hash.** Same input prompt → cached
HTML returned without re-calling Claude. Output drift between runs (33 %
mean line-diff) means an output-content cache would never hit; an
input-prompt-hash cache hits perfectly.

```
cache_key = sha256(system_prompt || user_prompt)
cache_path = ~/.vibeframe/cache/compose-scenes/<key>.html
```

### Determinism reduction (optional)

Add `temperature: 0` to cut variance further. Won't be perfectly
deterministic (Anthropic doesn't guarantee bit-stable output), but should
reduce the 33 % drift to ~10 %. Worth a Pass 2.5 before locking the v0.59
action signature.

### Lint feedback loop

Given 100 % first-pass success in this experiment, the retry loop matters
less than the roadmap suggested. Spec:

1. Call LLM, parse HTML.
2. Drop into project shell, run `vibe scene lint --json`.
3. If `errorCount > 0`, append the findings to the prompt and retry **once**.
4. If second attempt also fails, fall back to the 5-preset emit path
   (`vibe scene add --style simple`) and surface the lint findings to the
   user.

Cap retries at 1 (not 3 as initially specced) — at this success rate,
deeper retry loops just burn budget.

## Risks confirmed *not* present

- ❌ "LLM-generated HTML doesn't compile" — every run linted clean.
- ❌ "Output is creatively bankrupt / generic" — Pass 1 audit shows the
  model honours DESIGN.md and storyboard with surgical precision.
- ❌ "Cost is too high to justify" — $0.058/scene; even 50-scene project
  costs $2.90.
- ❌ "Latency is unacceptable" — 8.4 s/scene; with per-beat fanout, total
  wall-clock = single-scene latency.

## Risks still to verify (deferred to v0.59 implementation, not blocking)

- 🔍 **Beat-type variety** — this experiment used one announcement-style
  beat (two text elements). Need to verify explainer, kinetic-type,
  product-shot, and density-8-elements beats also lint-pass at ≥80 %.
  Add fixtures incrementally during v0.59 implementation; abort if any
  type drops below 50 %.
- 🔍 **Asset-aware rendering** — this experiment had no images. Need to
  verify the LLM correctly references `<img src="...">` paths from an
  asset manifest without inlining file contents (HF's #1 sub-agent
  failure mode per `step-6-build.md`).
- 🔍 **Word-sync caption integration** — does the LLM correctly emit
  `<span class="word">` per-word divs when `transcript.json` is provided?

## Files

- `fixtures/{DESIGN.md, STORYBOARD.md, SCRIPT.md}` — input fixtures.
- `project-shell/` — scaffolded scene project; LLM output drops into
  `compositions/scene-beat-1.html`.
- `run-pass-1.ts` — single-shot harness.
- `run-pass-2.ts` — N-run determinism harness.
- `tmp/pass-1-summary.json`, `tmp/pass-2-summary.json` — per-run metrics.
- `tmp/pass-2-run-{1..5}.html` — archived LLM outputs for inspection.

## Re-running

```bash
# pre-req: ANTHROPIC_API_KEY in .env or env
pnpm exec tsx tests/v059-preflight/run-pass-1.ts            # ~$0.06
pnpm exec tsx tests/v059-preflight/run-pass-2.ts 5          # ~$0.30
```
