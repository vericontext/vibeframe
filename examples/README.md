# VibeFrame examples

Each YAML below is a runnable pipeline. Pass `--dry-run` first to see the
projected cost; remove the flag to actually execute.

| File | What it does | API keys | Est. cost |
|---|---|---|---|
| [`demo-pipeline.yaml`](demo-pipeline.yaml) | Detect scene changes, cut silence, add fade in/out — entirely offline | _(none — FFmpeg only)_ | $0 |
| [`promo-video.yaml`](promo-video.yaml) | Image + narration + music + image-to-video + audio mix + colour grade — six steps, full AI promo | `GOOGLE_API_KEY`, `XAI_API_KEY`, `ELEVENLABS_API_KEY` | ≈ $5 |
| [`promo-with-budget.yaml`](promo-with-budget.yaml) | Same shape as `promo-video.yaml` but with a `budget.costUsd: 5.00` ceiling — executor aborts before any step that would exceed it. Demonstrates Opus 4.7 Task Budgets. | same as above | ≤ $5 (enforced) |
| [`scene-promo/`](scene-promo/) | Bilingual scene-authoring project (works with both `vibe scene` and `npx hyperframes`). The canonical scene example referenced by [`docs/comparison.md`](../docs/comparison.md) and [`tests/comparison/render-bench.sh`](../tests/comparison/render-bench.sh). | optional `OPENAI_API_KEY` (Whisper word-sync), `ELEVENLABS_API_KEY` (else local Kokoro) | ≤ $0.20 |
| [`vibeframe-promo/`](vibeframe-promo/) | **v0.59 end-to-end** — DESIGN.md + STORYBOARD.md → Claude Sonnet 4.6 (with the Hyperframes skill bundle) → 3 scene HTMLs via `compose-scenes-with-skills`. Render to MP4 with `vibe scene render` after. | `ANTHROPIC_API_KEY` | ≈ $0.18 fresh / $0 cached |

## Running

```bash
vibe run examples/demo-pipeline.yaml             # offline, ~30 s
vibe run examples/promo-video.yaml --dry-run     # preview cost, no API calls
vibe run examples/promo-video.yaml               # execute (will spend ≈ $5)

# scene-promo lives in its own dir — see its README
vibe scene render --project examples/scene-promo

# vibeframe-promo: hands DESIGN.md + STORYBOARD.md to Claude
vibe run examples/vibeframe-promo/vibeframe-promo.yaml --dry-run
ANTHROPIC_API_KEY=sk-... vibe run examples/vibeframe-promo/vibeframe-promo.yaml
vibe scene render --project examples/vibeframe-promo -o promo.mp4
```

For a step-by-step authoring walkthrough, see [`DEMO.md`](../DEMO.md). For
the full command reference, [`docs/cookbook.md`](../docs/cookbook.md). For
the YAML pipeline DSL itself, [`/vibe-pipeline`](../.claude/skills/vibe-pipeline/SKILL.md)
(Claude Code skill).
