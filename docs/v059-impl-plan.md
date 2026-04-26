# v0.59.0 — `compose-scenes-with-skills` implementation plan

> **Status:** plan, awaiting approval. Pre-flight (PR #111) validated the
> architecture; this doc translates that into 8 commits + tests + smoke.
> Re-read [`ROADMAP-v0.58.md`](ROADMAP-v0.58.md) Phase 2 before starting —
> this is the central bet of the v0.58 → v0.60 trajectory.

---

## What ships

A new YAML pipeline action — `compose-scenes-with-skills` — that takes
the scene project's `DESIGN.md` + `STORYBOARD.md` + Hyperframes skill
content and asks Claude Sonnet 4.6 to write each beat's
`compositions/scene-<id>.html` directly.

```yaml
# inside any pipeline.yaml
- id: compose
  action: compose-scenes-with-skills
  inputs:
    design:      DESIGN.md
    storyboard:  STORYBOARD.md
    transcript:  assets/transcript.json    # optional, enables word-sync
    project:     .                         # scene project root
  effort: medium                          # low|medium|high|xhigh — model selection
  retry-on-lint: 1                        # cap retries
```

Output: one HTML file per beat under `compositions/scene-<beat-id>.html`,
plus updated root `index.html` clip references.

## Architecture (validated in PR #111)

| Choice | Why | Pre-flight evidence |
|---|---|---|
| Per-beat fanout (Promise.all) | HF's own step-6-build prescribes "spawn a sub-agent per beat" — fresh context > full doc context | 5/5 lint pass on solo beat |
| Claude Sonnet 4.6 default | Output quality, $0.058/scene, 8.4s latency | Pass 1 + Pass 2 metrics |
| Cache by INPUT hash, not output | LLM output drifts ~33%; same input → same cached HTML hits 100% | Pass 2 diff measurement |
| `temperature: 0` | Cuts variance further; not in pre-flight, try in v0.59.1 if 0.59.0 drift > 20% | — |
| 1 retry max on lint error | First-pass success high enough that deeper retries burn budget | 5/5 first-pass |
| Skill bundle: SKILL + house-style + motion-principles + typography + transitions | Sufficient for valid HTML; ~50KB system prompt | Validated |
| Vendored skill snapshot + detect-installed | Works offline / in CI; uses upstream when user installed via `npx skills add heygen-com/hyperframes` | New decision |

## File layout

```
packages/cli/src/commands/_shared/
├── compose-scenes-skills.ts          NEW — orchestrator: storyboard parse → fanout → cache → emit
├── hf-skill-bundle/                  NEW — Apache 2.0 vendored snapshot
│   ├── NOTICE                            (HF attribution + license)
│   ├── SKILL.md                          (hyperframes core skill, snapshot)
│   ├── house-style.md
│   ├── motion-principles.md
│   ├── typography.md
│   └── transitions.md
├── storyboard-parse.ts               NEW — STORYBOARD.md → { global, beats[] }
├── compose-scenes-skills.test.ts     NEW — unit tests
└── storyboard-parse.test.ts          NEW — parse tests

packages/cli/src/pipeline/
├── executor.ts                       MOD — register `compose-scenes-with-skills`
└── types.ts                          MOD — extend PipelineAction

packages/cli/src/commands/output.ts   MOD — COST_ESTIMATES["compose-scenes"]

examples/
└── vibeframe-promo.yaml              NEW — end-to-end pipeline using the new action

tests/v059/
└── smoke.sh                          NEW — runs vibeframe-promo.yaml end-to-end (gated by ANTHROPIC_API_KEY)

~/.vibeframe/cache/compose-scenes/   (RUNTIME — sha256 → HTML, gitignored, user-local)
```

## Storyboard format

`STORYBOARD.md` parsed by H2 headings. Each beat MUST start with
`## Beat <id> — <title>` (e.g. `## Beat 1 — Hook`). Sections inside a
beat are optional but conventional (see HF's
`step-4-storyboard.md`):

- `### Concept` — what the viewer experiences
- `### VO cue` — narration text for this beat
- `### Visual` — backdrop, layout, type sizes
- `### Animations` — entrance tweens, eases, timings
- `### Assets` — paths to images / videos for this beat (relative)
- `### Beat duration` — seconds (overrides narration-derived)

Top-of-file sections (before any `## Beat`) are GLOBAL DIRECTION:
format, audio direction, style basis. Passed to every beat's prompt.

`parseStoryboard(md: string)` returns:

```ts
interface ParsedStoryboard {
  global: string;   // markdown block before any beat heading
  beats: Beat[];
}
interface Beat {
  id: string;       // e.g. "1", "hook" — derived from heading
  heading: string;  // full heading text
  body: string;     // markdown body of the beat
  duration?: number; // parsed from "### Beat duration" if present
}
```

## Compose flow per beat (orchestrator pseudo-code)

```ts
async function composeBeatHtml(beat: Beat, ctx: ComposeContext): Promise<string> {
  const cacheKey = sha256(ctx.skillBundleHash + ctx.designMd + beat.body + (ctx.transcript ?? ""));
  const cached = await readCache(cacheKey);
  if (cached) return cached;

  let html = await callClaudeOnce(beat, ctx);
  let lint = await lintHtml(html, ctx.projectRoot);
  if (lint.errorCount > 0) {
    // Retry once with lint findings appended
    html = await callClaudeOnce(beat, ctx, { lintFeedback: lint.findings });
    lint = await lintHtml(html, ctx.projectRoot);
  }
  if (lint.errorCount > 0) {
    throw new ComposeError("lint-fail", { beat: beat.id, findings: lint.findings });
  }
  await writeCache(cacheKey, html);
  return html;
}
```

## Cost integration

`COST_ESTIMATES["compose-scenes"] = { min: 0.05, max: 0.12, unit: "per beat" }`

Pipeline `--dry-run` multiplies by `beats.length`. For a 5-beat promo:
$0.25–$0.60 estimate, $0.29 actual (Pass 2 measurement). Budget ceilings
in `vibe.project.yaml#budget.maxUsd` and pipeline-level `budget.costUsd`
are checked before any beat fans out.

## Skill bundle sourcing

```ts
async function loadSkillBundle(): Promise<{ content: string; source: string }> {
  // 1. Prefer user-installed skill (~/.claude/skills/hyperframes/) — keeps in
  //    sync with whatever the user agent loop is using
  const installed = await tryReadInstalled();
  if (installed) return { content: installed, source: "installed" };

  // 2. Fall back to vendored snapshot in this package
  return { content: readVendored(), source: "vendored" };
}
```

Vendored snapshot lives in `_shared/hf-skill-bundle/`, with `NOTICE` for
Apache 2.0 attribution. The snapshot is a moment-in-time copy; we
update on a periodic cadence (no auto-fetch — that would defeat
deterministic builds).

## Commit sequence (8 commits)

| # | Title | Files | Test |
|---|---|---|---|
| C1 | feat(skills): vendor HF skill bundle (Apache 2.0) | `_shared/hf-skill-bundle/*` | hash test |
| C2 | feat(scene): parse STORYBOARD.md into beats | `_shared/storyboard-parse.ts` + test | 6 cases |
| C3 | feat(scene): single-beat Claude composer + cache | `_shared/compose-scenes-skills.ts` (Anthropic SDK call, cache I/O) | mock test |
| C4 | feat(scene): lint retry loop in composer | extend C3 | mock lint findings |
| C5 | feat(pipeline): register `compose-scenes-with-skills` action | `pipeline/types.ts`, `pipeline/executor.ts`, `output.ts` | unit |
| C6 | feat(pipeline): per-beat fanout + progress reporting | extend C3/C5 | parallel test |
| C7 | feat(examples): end-to-end `vibeframe-promo.yaml` | `examples/vibeframe-promo.yaml` + `examples/README.md` update | dry-run smoke |
| C8 | test(v059): smoke harness for full pipeline | `tests/v059/smoke.sh` | gated by `ANTHROPIC_API_KEY` |

Each commit lands as a separate PR (CI green required, no admin override
on red). Each builds on the previous. Estimated total: 6–10 hours of
focused work over 2–3 days.

## Acceptance criteria

- [ ] `vibe run examples/vibeframe-promo.yaml --dry-run` prints sensible cost (~$0.30–$1) and step plan
- [ ] `vibe run examples/vibeframe-promo.yaml` produces a working scene project + MP4 on a fresh machine with `ANTHROPIC_API_KEY` set
- [ ] Cache hits on second run with identical inputs (no Claude calls)
- [ ] Lint pass rate ≥ 80% across the 4 beat presets (announcement / explainer / kinetic-type / product-shot)
- [ ] All existing CLI tests (504+) still pass
- [ ] `pnpm -r exec tsc --noEmit` exits 0
- [ ] Apache 2.0 NOTICE attribution committed alongside vendored bundle

## Risks (carried forward from v0.58 diagnostic)

- **R2 (compose-scenes is the central bet)** — pre-flight de-risked the lint pass concern. Remaining risk: variety across beat types. Mitigate via C7's 4-preset coverage + C8 smoke.
- **R3 (Hyperframes coupling)** — vendoring the skill bundle adds inventory burden. Mitigate via NOTICE + dated snapshot tag in the bundle dir.
- **Determinism** — 33% diff is high; if `temperature: 0` doesn't bring it under 15%, agent re-runs feel inconsistent. Mitigate via cache-by-input-hash (already speced in C3).
- **Provider availability** — Anthropic API down or quota hit blocks the entire pipeline. Mitigate via clear error path in C3 (bubble up exit-code 6 with retry suggestion).

## Out of scope for v0.59.0

- Asset-aware rendering (passing `<img>` paths from a manifest into the prompt) → **v0.59.1**
- Word-sync caption integration in LLM-generated HTML (transcript-driven `<span class="word">`) → **v0.59.1**
- Multi-shot prompting (storyboard → multiple variants per beat) → **v0.59.2**
- Standalone CLI entry (`vibe scene compose-with-skills`) → **v0.59.3** (YAML pipeline is the canonical entry)
- New demo MP4 via the pipeline → **v0.60.0**

## Open questions (decide before C1)

1. **Storyboard heading anchor** — `## Beat 1 — Hook` is HF's convention. We can also accept `## Hook (3s)` etc. **Decision needed:** strict (HF format) or flexible (regex match for any H2)?
2. **Beat id derivation** — from heading prefix ("Beat 1" → "1") or from first slug-ifiable word ("Hook" → "hook")? **Recommend:** prefer explicit `## Beat 1 — Hook` → `id: "1"`, fallback to slug.
3. **Cache invalidation** — when the vendored skill bundle updates, all caches go stale. Include `BUNDLE_VERSION` in the hash so updates auto-invalidate. **Recommend:** yes; bundle ships a `VERSION` constant.
4. **Effort level mapping** — `low` → Sonnet 4.6 max_tokens 4000, `medium` → 6000, `high` → Sonnet with extended thinking on, `xhigh` → Opus 4.7. **Recommend:** start with low/medium tied to max_tokens only; defer Opus 4.7 wiring to v0.59.2.
5. **Failure mode if Hyperframes skill bundle missing** — vendored fallback always works, so n/a.
