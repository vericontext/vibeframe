# CLI UX Audit (Issue #33) — Baseline (2a)

> **Status**: 2a baseline. **No code changes**. This document inventories the
> current state so 2b–2e (exit codes, `--json` envelope, `--describe`,
> snapshot tests) work from facts, not guesses.
>
> **Date**: 2026-04-28 · **CLI version**: 0.71.0 · **Manifest counts**:
> MCP=66, Agent=82, CLI=80+

## TL;DR

The CLI is mostly consistent inside large groups (`generate.*`, `edit.*`,
`audio.*`, `detect.*` follow the same envelope pattern), but has three
concrete blockers and a handful of smaller gaps that prevent Issue #33's
"every command emits an identical envelope" goal.

| # | Severity | Blocker | Files |
|---|---|---|---|
| 1 | High | `timeline.*` (10 cmds) emits JSON only on `--dry-run`; real success path goes through `spinner.succeed()` + `console.log()` | `commands/timeline.ts` |
| 2 | High | Pipeline commands call `process.exit(0)` on success (skips cleanup hooks, breaks return-based testing) | `commands/ai-highlights.ts:929,937` |
| 3 | High | `scene.*` render/build/styles/add/compose-prompts/install-skill have no `--json` mode at all (6/8 leaves) | `commands/scene.ts` |
| 4 | Medium | 5 `process.exit(1)` sites in `scene.ts` should route through `exitWithError()` | `commands/scene.ts:361,1034,1072,1173,1302` |
| 5 | Medium | 29/64 commands missing from `COST_ESTIMATES` map → no `--dry-run --json` cost annotation | `commands/output.ts:132-175` |

Existing standard (already in code, **not Issue #33's proposal**):

```ts
// packages/cli/src/commands/output.ts
enum ExitCode { SUCCESS=0, GENERAL=1, USAGE=2, NOT_FOUND=3, AUTH=4, API_ERROR=5, NETWORK=6 }
StructuredError = { success: false, error, code, exitCode, suggestion?, retryable }
```

Issue #33 proposed a *different* exit-code scheme (0/1/2/3/64+) and a new
success envelope `{ ok, command, result, elapsedMs, costUsd? }`. Neither
is implemented. **2b should pick one and document it as the canonical
standard before fixing the violators.**

---

## What is and isn't standardized today

### Standardized (in `commands/output.ts`)

- **Exit codes**: `ExitCode` enum (0–6) — adopted by `exitWithError()`,
  `apiError()`, `usageError()`, `authError()`, `notFoundError()`,
  `networkError()`, `generalError()`.
- **Error envelope**: `StructuredError = { success: false, error, code,
  exitCode, suggestion?, retryable }` — written via `exitWithError()` to
  **stderr** in JSON mode (`output.ts:104-115`).
- **Output mode flags**: `--json` → `VIBE_JSON_OUTPUT=1`, `--quiet` →
  `VIBE_QUIET_OUTPUT=1`. `outputResult()` / `log()` / `spinner()` /
  `suggestNext()` honor both.
- **Cost annotation on dry-run**: `outputResult()` injects
  `estimatedCost` when `result.dryRun && result.command` matches a key
  in `COST_ESTIMATES` (~30 entries).
- **`--describe`**: handled globally in `index.ts:240-263`. Walks the
  Commander tree, calls `buildSchema()` (`commands/schema.ts:191`),
  emits JSON Schema. Works for every command **automatically** — no
  per-command opt-in needed.

### Not standardized

- **Success envelope shape**. `outputResult(result: Record<string, unknown>)`
  takes any object. Each command picks its own keys.
- **Timing / cost-actual reporting**. No `elapsedMs`, no `costUsd`
  surfaced from real (non-dry-run) runs.
- **Whether `--json` is even supported**. `scene.*` (most), `setup`,
  `doctor`, `walkthrough`, `export`, `demo`, `context` emit human text only.
- **`--dry-run` semantics for inspection commands**. Some skip it
  (correct — `audio voices`, `analyze media`), some are missing it where
  it would help (`scene render`, `scene build`).

---

## Per-group inventory

Columns: `--json` (real success path), `--dry-run`, `outputResult` use,
`exitWithError` use, success envelope keys.

### Generate (13 leaves) — gold standard

All 13 use the same skeleton: `--json` + `--dry-run` + `outputResult()`
+ `exitWithError()`. Envelope keys: `success, provider, <asset>,
outputPath` (asset = `image | video | audio | speech | music | etc.`).

| Path | --json | --dry-run | outputResult | exitWithError | envelope |
|---|---|---|---|---|---|
| `generate image` | ✓ | ✓ | ✓ | ✓ | `success, provider, images[], outputPath` |
| `generate video` | ✓ | ✓ | ✓ | ✓ | `success, provider, taskId, outputPath` |
| `generate motion` | ✓ | ✓ | ✓ | ✓ | `success, video, duration` |
| `generate speech` | ✓ | ✓ | ✓ | ✓ | `success, provider, audio, duration` |
| `generate music` | ✓ | ✓ | ✓ | ✓ | `success, provider, audio, duration` |
| `generate sound-effect` | ✓ | ✓ | ✓ | ✓ | `success, effect, duration, provider` |
| `generate storyboard` | ✓ | ✓ | ✓ | ✓ | `success, scenes[]` |
| `generate thumbnail` | ✓ | ✓ | ✓ | ✓ | `success, images[]` |
| `generate background` | ✓ | ✓ | ✓ | ✓ | `success, image, provider` |
| `generate video-status` | ✓ | n/a | ✓ | ✓ | `success, status, progress, result` |
| `generate video-cancel` | ✓ | n/a | ✓ | ✓ | `success, cancelled` |
| `generate video-extend` | ✓ | ✓ | ✓ | ✓ | `success, taskId, provider` |
| `generate music-status` | ✓ | n/a | ✓ | ✓ | `success, status, progress` |

**Verdict**: reference implementation. Use as the template when fixing
other groups. (Plan G Phase 2 split these into per-file modules under
`commands/generate/<name>.ts` — pattern is uniform.)

### Edit (15 leaves)

| Path | --json | --dry-run | outputResult | exitWithError | envelope |
|---|---|---|---|---|---|
| `edit silence-cut` | ✓ | ✓ | ✓ | ✓ | `success, video, segments, outputPath` |
| `edit fade` | ✓ | ✓ | ✓ | ✓ | `success, clips, outputPath` |
| `edit noise-reduce` | ✓ | ✓ | ✓ | ✓ | `success, video, outputPath` |
| `edit caption` | ✓ | ✓ | ✓ | ✓ | `success, video, srt, outputPath` |
| `edit jump-cut` | ✓ | ✓ | ✓ | ✓ | `success, cuts[], outputPath` |
| `edit translate-srt` | ✓ | ✓ | ✓ | ✓ | `success, srt, language, outputPath` |
| `edit grade` | ✓ | ✓ | ✓ | ✓ | `success, video, color, outputPath` |
| `edit text-overlay` | ✓ | ✓ | ✓ | ✓ | `success, video, text, outputPath` |
| `edit speed-ramp` | ✓ | ✓ | ✓ | ✓ | `success, video, ramps[], outputPath` |
| `edit reframe` | ✓ | ✓ | ✓ | ✓ | `success, video, aspectRatio, outputPath` |
| `edit image` | ✓ | ✓ | ✓ | ✓ | `success, images[], provider, outputPath` |
| `edit interpolate` | ✓ | ✓ | ✓ | ✓ | `success, video, frames, outputPath` |
| `edit upscale` | ✓ | ✓ | ✓ | ✓ | `success, video, resolution, outputPath` |
| `edit animated-caption` | ✓ | ✓ | ✓ | ✓ | `success, video, captions, outputPath` |
| `edit fill-gaps` | ✓ | ✓ | ✓ | ✓ | `success, video, gaps[], outputPath` |

**Verdict**: also reference quality. Minor cosmetic finding: `edit reframe`
(`edit-cmd.ts:648`) prints a redundant `console.error("Reframe failed")`
just *before* a correct `exitWithError(generalError(...))` call. Not a
bypass — the structured exit still happens — but the extra red line
appears in human mode. Cleanup-only.

### Audio (5 leaves)

| Path | --json | --dry-run | outputResult | exitWithError | envelope |
|---|---|---|---|---|---|
| `audio transcribe` | ✓ | n/a (cheap) | ✓ | ✓ | `success, fullText, segments[], language` |
| `audio isolate` | ✓ | ✓ | ✓ | ✓ | `success, audio, outputPath` |
| `audio voice-clone` | ✓ | ✓ | ✓ | ✓ | `success, voiceId, audio, outputPath` |
| `audio dub` | ✓ | ✓ | ✓ | ✓ | `success, audio, language, outputPath` |
| `audio duck` | ✓ | ✓ | ✓ | ✓ | `success, audio, outputPath` |

Plus CLI-only: `audio voices` (ElevenLabs voice list dump — not in
manifest by design; see cli-sync.test.ts).

**Verdict**: clean.

### Detect (3 leaves)

| Path | --json | --dry-run | outputResult | exitWithError | envelope |
|---|---|---|---|---|---|
| `detect scenes` | ✓ | ✓ | ✓ | ✓ | `success, scenes[], totalDuration` |
| `detect silence` | ✓ | ✓ | ✓ | ✓ | `success, silences[]` |
| `detect beats` | ✓ | ✓ | ✓ | ✓ | `success, beats[], beatCount` |

**Verdict**: clean. Free local operations; dryRun returns
`{ dryRun, command, params }` (consistent with detect/edit pattern).

### Analyze (4 leaves)

| Path | --json | --dry-run | outputResult | exitWithError | envelope |
|---|---|---|---|---|---|
| `analyze media` | ✓ | n/a | ✓ + `--fields` filter | ✓ | `success, response, sourceType, model, totalTokens?` |
| `analyze video` | ✓ | n/a | ✓ + `--fields` filter | ✓ | `success, response, model, totalTokens?` |
| `analyze review` | ✓ | ✓ | ✓ | ✓ | `success, review, suggestions` |
| `analyze suggest` | ✓ | n/a | ✓ | ✓ | `success, suggestions[]` |

**Verdict**: well-formed. Three commands skip `--dry-run` because the
operation *is* the dry-run (token-cheap inspection). Acceptable. Three
missing from `COST_ESTIMATES` (media, video, suggest).

### Timeline (10 leaves) — **BLOCKER**

| Path | --json (real) | --dry-run | outputResult | exitWithError | envelope (real) |
|---|---|---|---|---|---|
| `timeline add-source` | ✗ | ✓ | dry-run only | ✓ | none (spinner+console.log) |
| `timeline add-clip` | ✗ | ✓ | dry-run only | ✓ | none |
| `timeline split-clip` | ✗ | ✓ | dry-run only | ✓ | none |
| `timeline trim-clip` | ✗ | ✓ | dry-run only | ✓ | none |
| `timeline move-clip` | ✗ | ✓ | dry-run only | ✓ | none |
| `timeline duplicate-clip` | ✗ | ✓ | dry-run only | ✓ | none |
| `timeline delete-clip` | ✗ | ✓ | dry-run only | ✓ | none |
| `timeline add-track` | ✗ | ✓ | dry-run only | ✓ | none |
| `timeline add-effect` | ✗ | ✓ | dry-run only | ✓ | none |
| `timeline list` | ✗ | ✗ | ✗ | ✓ | none (table render) |

**Pattern** (verified `timeline.ts:38-78` for `add-source`):

```ts
if (options.dryRun) {
  outputResult({ dryRun: true, command: "timeline add-source", params: {...} });
  return;
}
// ... real work ...
spinner.succeed(chalk.green(`Source added: ${source.id}`));
console.log();
console.log(chalk.dim("  Name:"), mediaName);
// ← no outputResult() call → --json mode emits NOTHING on success
```

**Impact**: An agent calling `vibe timeline add-clip ... --json` gets
an empty stdout on success. Has to inspect exit code and assume.

**Fix shape (2c scope)**: append a sibling `outputResult({ success: true,
clipId, ... })` call before the human-mode `console.log()` block. Both
modes emit appropriate output via the existing `isJsonMode()` gates
inside `outputResult()`.

### Pipeline (4 leaves) — **BLOCKER**

| Path | --json | --dry-run | outputResult | exitWithError | success-path exit |
|---|---|---|---|---|---|
| `pipeline highlights` | ✓ | ✓ | ✓ | partial | `process.exit(0)` (ai-highlights.ts:929,937) |
| `pipeline auto-shorts` | ✓ | ✓ | ✓ | partial | similar pattern |
| `pipeline regenerate-scene` | ✓ | ✓ | ✓ | partial | similar pattern |
| `pipeline run` | ✓ | ✓ | ✓ | partial | similar pattern |

**Verified** (`ai-highlights.ts:929,937`): pipeline action handlers call
`process.exit(0)` on the happy path instead of returning. This:

- bypasses any `finally` blocks the caller registered;
- prevents tests from running multiple actions in a single process;
- inconsistent with all other commands that just `return`;
- and means real exit code is 0 even if downstream cleanup throws.

**Fix shape (2b scope)**: replace `process.exit(0)` with `return`. Let
Commander's normal completion path run.

### Scene (8 leaves) — **BLOCKER**

| Path | --json | --dry-run | outputResult | exitWithError | envelope |
|---|---|---|---|---|---|
| `scene init` | ✓ (dry-run only) | ✓ | dry-run only | ✓ | `command, projectDir, agent, targetHosts, actions` |
| `scene styles` | ✗ | ✗ | ✗ | ✓ | none |
| `scene add` | ✗ | ✗ | ✗ | ✓ | none (interactive) |
| `scene install-skill` | ✓ | ✓ | ✓ | ✓ | `command, skills, installed` |
| `scene lint` | ✓ | ✓ | ✓ | ✓ | `success, violations, fixed` |
| `scene render` | ✗ | ✗ | ✗ | partial | none — opaque MP4 path |
| `scene compose-prompts` | ✗ | ✗ | ✗ | ✓ | none |
| `scene build` | ✗ | ✗ | ✗ | partial | none |

**5 `process.exit(1)` sites** (`scene.ts:361, 1034, 1072, 1173, 1302`).
Should route through `exitWithError(generalError(...))` for stderr-JSON
consistency.

**Impact**:
- `scene render` returns no JSON, so an agent that just rendered an MP4
  can't programmatically discover the output path, duration, or any
  metadata without parsing human text.
- `scene build` is the same — it's the v0.60 one-shot build pipeline
  with multi-stage state, but emits human text only.
- `scene styles` (list-the-vendored-styles) is a textbook list-output
  command that should emit a JSON array.

### Project & Export (3 leaves)

| Path | --json | --dry-run | outputResult | exitWithError | envelope |
|---|---|---|---|---|---|
| `project create` | ✓ | ✓ | ✓ | ✓ | `success, projectPath, dimensions` |
| `project info` | ✓ | n/a | ✓ | ✓ | `success, clips[], sources[], tracks[]` |
| `export video` | ✗ | ✗ | ✗ | ✓ | none (FFmpeg human output) |

Plus CLI-only: `project set` (vibe.project.yaml writer; agents use
`fs_write` instead — see cli-sync.test.ts).

`export` should grow `--json` for symmetry with `generate video`.

### One-offs (10)

| Path | --json | --dry-run | outputResult | exitWithError | notes |
|---|---|---|---|---|---|
| `init` | partial (dry-run only) | ✓ | dry-run only | ✓ | scaffold; idempotent |
| `setup` | n/a | n/a | ✗ | ✓ | interactive wizard — JSON mode meaningless |
| `doctor` | ✗ | n/a | ✗ | ✓ | health check — should grow `--json` (#33 explicit) |
| `walkthrough` | ✗ | n/a | ✗ | ✓ | interactive guide |
| `agent` | ✓ | n/a | ✓ | ✓ | natural-language REPL → CLI |
| `schema` | ✓ (pure JSON) | n/a | ✓ | ✓ | meta-command; emits schema |
| `run` | ✓ | ✓ | varies | ✓ | YAML pipeline runner |
| `demo` | ✗ | n/a | ✗ | partial | tutorial mode |
| `context` | ✗ | n/a | ✗ | ✓ | agent context r/w |

`doctor --json` is an explicit Issue #33 ask and the cheapest win — add
a single `outputResult({ ... checks ... })` at the end of the existing
human render.

---

## Cross-cutting findings

### F1. Success envelope is not standardized

The `success` boolean is the only key reliably present. Beyond that,
each command picks its own shape. Two competing future proposals:

- **Issue #33**: `{ ok, command, result, elapsedMs, costUsd? }` — flat
  generic; `ok` instead of `success`; nested `result`.
- **Implicit current**: `{ success, <domain-keys>... }` — flat
  domain-specific.

**Recommendation for 2c**: Adopt a hybrid that's backwards-compatible
with the implicit current shape:

```json
{
  "success": true,
  "command": "edit silence-cut",
  "elapsedMs": 1234,
  "costUsd": 0.00,
  "data": { "video": "...", "outputPath": "...", "segments": [...] }
}
```

Keeps `success` (no breaking rename to `ok`), adds `command` /
`elapsedMs` / `costUsd` at the top level, nests existing
domain-specific keys inside `data`. Old shape (flat domain keys) can be
preserved during a one-version transition by emitting both top-level
and nested copies, then removing the flat keys at v1.0.

### F2. Exit codes — Issue #33 differs from implementation

Issue #33 wrote `0/1/2/3/64+`. Code already has `0/1/2/3/4/5/6` (no
64+). The code's scheme is more granular and has been stable since at
least v0.50. **Recommendation for 2b**: keep the existing `ExitCode`
enum, document it in `CONTEXT.md` (or here), and update Issue #33's
acceptance criteria to match. The 64+ "unrecoverable" tier from sysexits
is unused and can stay unused.

### F3. `COST_ESTIMATES` map has 29 missing entries

`output.ts:132-175` lists ~30 commands. Total CLI surface is 80+. Free
operations (timeline, project, detect — already mostly there) and
inspection ops (analyze.media, analyze.video) are the biggest gaps.
For free ops, an entry like `{ min: 0, max: 0, unit: "free" }` is enough
to make `--dry-run --json` emit `estimatedCost: "Free"`.

Specifically missing (verified against `output.ts:132-175`):

- `analyze media`, `analyze video`, `analyze suggest` (low cost)
- `audio voices` (free), `audio isolate`, `audio voice-clone`,
  `audio dub`, `audio duck` (low/medium cost)
- All 10 `timeline.*` (free)
- All 5 `batch.*` (mostly free, varies)
- `project create`, `project info`, `project set` (free)
- `export video` (free)
- One-offs: `init`, `setup`, `doctor`, `agent`, `walkthrough`,
  `schema`, `run`, `context`, `demo` (free)

### F4. `--describe` works but option descriptions vary in quality

`buildSchema()` walks Commander metadata. Coverage is 100% by
construction. Quality varies:

- Best: `generate/image.ts` lists provider-specific enum values inline
  in `.option()` description (e.g. `"openai: 1024x1024, 1536x1024,
  1024x1536"`). `buildSchema` extracts these via
  `extractEnumFromDescription()` (`schema.ts`) and surfaces them in
  the JSON Schema `enum`.
- Worst: a few options have empty or extremely terse descriptions; no
  format hints on file paths (e.g. "input file" vs "MP4 file").

**Recommendation for 2d**: a sweep-style PR adding enum hints to all
fixed-value options and format hints to all file-path arguments. Mostly
mechanical; ~50–100 small edits.

### F5. `--json` should imply machine-readable on stderr too

Already true: `exitWithError()` writes JSON to stderr in JSON mode
(`output.ts:106`). Verify in 2e snapshot tests that no command writes
stray human text to stdout *between* `--json` activation and the final
`outputResult()` call. (Spot check: `timeline.ts:73-78` writes
`spinner.succeed()` + `console.log()` lines outside JSON guards — but
ora is `isSilent: true` in JSON mode via `output.ts:222-227`, so spinner
output is suppressed; raw `console.log()` calls below it are not.)

### F6. Pipeline commands hide success behind `process.exit(0)`

See "Pipeline" section above. Real fix is one-line per site (`return`
instead of `process.exit(0)`). Test: write an integration test that
registers two pipeline commands and runs them sequentially in the same
process; today the second never runs.

---

## What 2b–2e should do, derived from this audit

### 2b — Exit code convention enforcement
- Document the existing `ExitCode` enum (`output.ts:11-19`) in
  `CONTEXT.md` as the canonical scheme; deprecate Issue #33's 0/1/2/3/64+.
- Replace 5 `process.exit(1)` sites in `scene.ts` with `exitWithError(generalError(...))`.
- Replace 2 `process.exit(0)` sites in `ai-highlights.ts` (lines 929, 937) with `return`.
- Sweep `init.ts` for any remaining raw exits.
- Audit `setup.ts` raw exits (likely intentional — interactive
  completion); leave with a comment.

### 2c — `--json` envelope standardization
- Pick the F1 hybrid shape as canonical.
- Add `outputResult({ success: true, ... })` to all 10 `timeline.*`
  success paths.
- Add `--json` support to `scene render`, `scene build`, `scene styles`,
  `scene compose-prompts`, `scene install-skill` (for the 4 that lack
  it; install-skill already has it for dry-run).
- Add `--json` to `doctor` (single `outputResult` at end).
- Add `--json` to `export video`.
- (Defer `setup`, `walkthrough`, `demo` — interactive by design.)

### 2d — `--describe` coverage
- Sweep `.option()` descriptions: add enum hints, file-format hints,
  unit hints (s, ms, %).
- Sweep `.argument()` descriptions for file-format hints.
- Mechanical; one PR.

### 2e — CI snapshot tests
- One snapshot per command of `vibe <cmd> --describe` JSON output.
- Plus a smaller set of `vibe <cmd> --dry-run --json` snapshots for
  representative leaves per group.
- Snapshot file lives next to the command source.
- Failure mode: any envelope-shape regression fails CI; intentional
  changes are reviewed in the snapshot diff.

---

## Methodology and verification notes

This audit was assembled by:
1. Reading `commands/output.ts` and `commands/schema.ts` to confirm the
   centralized utilities and what they enforce.
2. Reading `index.ts:240-263` to confirm `--describe` is a global hook.
3. Dispatching an Explore subagent to inventory ~64 leaf commands and
   produce the per-group tables.
4. **Spot-verifying every "BLOCKER" / "CRITICAL" claim** by direct grep
   before publishing:
   - `process.exit` count in `ai-highlights.ts` and `scene.ts` (verified
     line numbers, corrected from agent's initial guess).
   - `outputResult` / `spinner.succeed` interleaving in `timeline.ts`
     (verified the `dry-run-only` claim by reading lines 38-78).
   - `console.error` "bypass" claim at `edit-cmd.ts:648` — reading the
     surrounding 15 lines showed it's followed immediately by a
     correct `exitWithError(generalError(...))`. The agent had
     classified this as a bypass; it's actually a cosmetic redundancy
     and was demoted from "should fix" to "cleanup-only" in F1/F2.

Per the project's "verify agent file-state claims" rule, no finding
above is asserted on agent-only evidence — every line number and code
shape was re-grepped.

---

## Decisions (resolved 2026-04-28)

The four open questions from the original 2a baseline are now decided.
Issue #33 body (https://github.com/vericontext/vibeframe/issues/33) was
updated to match.

1. **Envelope** → modern shape, no `success` / `ok` key, nested `data`,
   first-class `warnings`, breaking pre-1.0 change:
   ```json
   {
     "command": "generate image",
     "elapsedMs": 1234,
     "costUsd": 0.04,
     "warnings": [],
     "data": { "provider": "openai", "images": [...], "outputPath": "..." }
   }
   ```
   Reasoning: exit code 0 is the UNIX success signal — duplicating it
   on stdout invites buggy agents that check both. `data` namespace
   isolates new meta fields (e.g. future `traceId`) from domain keys.
   `warnings` gives non-fatal signals (provider fallback, deprecated
   flag, partial cache miss) a structured channel. Matches the
   `gh` / `kubectl` / `aws` cli patterns.
2. **Issue #33 body** → updated. Existing `ExitCode` enum (0-6) is the
   canonical scheme; the original 0/1/2/3/64+ proposal is dropped.
3. **Sequencing** → 2b first (mechanical, no design decisions), then a
   2c-canary on `generate image` to validate envelope ergonomics, then
   2c-sweep for everything else. Adds one PR but de-risks the envelope.
4. **`scene build --json`** → single end-of-run envelope for 2c. NDJSON
   streaming is a separate `--json --stream` opt-in flag, scoped to
   v0.72+ for the four long-running commands (`scene build`, `pipeline
   highlights`, `pipeline auto-shorts`, `generate video`).

---

## Appendix A — Exit code reference (2b)

The canonical scheme. Adopt these via `exitWithError(StructuredError)`,
never `process.exit(N)` directly. Defined in `packages/cli/src/commands/output.ts`.

| Code | Symbol | When |
|---|---|---|
| 0 | `SUCCESS` | command completed |
| 1 | `GENERAL` | uncategorized error |
| 2 | `USAGE` | bad args / unknown option / missing required arg (Commander) |
| 3 | `NOT_FOUND` | input file or resource not found |
| 4 | `AUTH` | API key missing or invalid |
| 5 | `API_ERROR` | provider returned an error response |
| 6 | `NETWORK` | connection / timeout / DNS |

### Approved `process.exit` sites (do not replace)

- `output.ts:114` — inside `exitWithError()`. The canonical exit hook.
- `index.ts:258, 261, 279` — top-level hooks for `--describe` and
  Commander `CommanderError` mapping. Outside any action handler.
- `setup.ts:68` — `process.exit(0)` after interactive wizard. The TTY
  stream can keep the event loop alive; explicit exit is documented in
  a comment above the call.
- `agent.ts:135` — `process.exit(0)` after one-shot agent run. Same
  rationale (long-lived clients can pin the event loop).

### Replaced sites (this PR — 2b)

| File:Line (pre-2b) | Was | Now | Why |
|---|---|---|---|
| `ai-highlights.ts:929` | `process.exit(0)` (no highlights found) | `return;` | Inside action handler — let Commander finish |
| `ai-highlights.ts:937` | `process.exit(0)` (outer no-highlights guard) | `return;` | Same |
| `scene.ts:361` | `process.exit(1)` after `outputResult` (compose-prompts error in JSON mode) | `process.exitCode = 1; return;` | Preserves the result-shape JSON on stdout while signalling exit code 1 |
| `scene.ts:1034` | `if (!result.ok) process.exit(1);` (lint error in JSON mode) | `if (!result.ok) process.exitCode = 1;` | Falls through to existing `return;` on next line |
| `scene.ts:1072` | `if (!result.ok) process.exit(1);` (lint end-of-action) | `if (!result.ok) process.exitCode = 1;` | End of action — handler returns naturally |
| `scene.ts:1173` | `process.exit(1)` after `outputResult` (render error in JSON mode) | `process.exitCode = 1; return;` | Same pattern as compose-prompts |
| `scene.ts:1302` | `process.exit(1)` after `outputResult` (build error in JSON mode) | `process.exitCode = 1; return;` | Same |

`process.exitCode = N; return;` is the standard Node pattern for
"deferred exit code" — used by ESLint, Prettier, and others. The
process exits when the event loop drains, so any pending I/O completes.

### Why not just `exitWithError()` for everything?

`exitWithError()` writes a `StructuredError` to **stderr**:
```json
{ "success": false, "error": "...", "code": "...", "exitCode": 1, ... }
```

The 5 `scene.ts` sites that emit a *result-shape* JSON to **stdout**
(`{ command, success: false, error, ...result }`) would lose that
data if routed through `exitWithError()`. Render/build/lint failures
carry useful structured metadata (which beat failed, which violation,
etc.) that agents want to consume. Keeping the result envelope on
stdout *and* setting the exit code is the right behavior.

This split (data → stdout, error envelope → stderr) is intentional and
will be revisited in 2c when the new envelope shape is rolled out.
