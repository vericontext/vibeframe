# vibeframe-promo

End-to-end example for the v0.59 `compose-scenes-with-skills` pipeline
action. Hands [`DESIGN.md`](DESIGN.md) + [`STORYBOARD.md`](STORYBOARD.md)
to Claude Sonnet 4.6 (with the Hyperframes skill bundle as system
prompt) and writes one HTML composition per beat.

3 beats × ~$0.06/beat = **≈$0.18** for a fresh run. **$0** on re-runs
because identical inputs hit the input-hash cache at
`~/.vibeframe/cache/compose-scenes/`.

## Run

```bash
# 1. Set Anthropic key
export ANTHROPIC_API_KEY=sk-ant-...

# 2. Preview cost (no API calls)
vibe run examples/vibeframe-promo/vibeframe-promo.yaml --dry-run
# → "estimatedCost": "≤$1.50"

# 3. Execute (calls Claude per beat in parallel; ~8 s wall-clock)
vibe run examples/vibeframe-promo/vibeframe-promo.yaml
# → writes compositions/scene-hook.html, scene-claim.html, scene-close.html

# 4. Render to MP4 (separate step, requires Chrome)
vibe scene render --project examples/vibeframe-promo -o promo.mp4
```

Re-run step 3 with no edits to verify cache: should report `cacheHits: 3`,
`totalCostUsd: 0`, sub-second wall-clock.

## What's in this directory

| File | Purpose |
|---|---|
| [`vibeframe-promo.yaml`](vibeframe-promo.yaml) | The pipeline. One step (`compose-scenes-with-skills`). |
| [`DESIGN.md`](DESIGN.md) | Visual identity (Swiss Pulse — black canvas + electric-blue accent + Inter Bold). |
| [`STORYBOARD.md`](STORYBOARD.md) | 3 beats × 3 s — hook, claim, close. |
| [`index.html`](index.html) | Root composition. References `compositions/scene-{hook,claim,close}.html` (regenerated). |
| `hyperframes.json`, `meta.json`, `vibe.project.yaml` | Project shell — bilingual (works with `npx hyperframes` and `vibe scene` both). |
| `compositions/` | Output destination. Generated files are gitignored. |

## What you can change

| Change | Re-run cost |
|---|---|
| Edit `STORYBOARD.md` body of a beat | $0.06 (only the changed beat re-renders) |
| Edit `DESIGN.md` | ≈$0.18 (every beat re-renders — DESIGN.md affects all) |
| Add a new beat | $0.06 (just that beat) — but you must also add a clip ref in `index.html` and update its `data-duration`. |
| Edit `vibeframe-promo.yaml` step parameters (e.g. `effort: high`) | ≈$0.18 (cache key changes) |

## How this maps to the v0.58/v0.59 architecture

The pipeline action sources Hyperframes' published agent skill content
(`hyperframes` skill, vendored at
[`packages/cli/src/commands/_shared/hf-skill-bundle/`](../../packages/cli/src/commands/_shared/hf-skill-bundle/),
falling back to your locally-installed copy when present) and combines
it with this project's DESIGN.md as the system prompt. Per-beat fanout
runs the prompts in parallel via `Promise.all`. Each beat goes through
a 1-retry lint feedback loop (PR #111 pre-flight measured 100 % first-
pass success at $0.058/beat).

The relationship between VibeFrame and Hyperframes is documented in
[`/CREDITS.md`](../../CREDITS.md). Both are open source — Hyperframes
under Apache 2.0, VibeFrame under MIT.
