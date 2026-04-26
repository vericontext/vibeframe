#!/usr/bin/env bash
# tests/v059/smoke.sh
#
# End-to-end smoke for v0.59 `compose-scenes-with-skills`. Runs the
# canonical example (`examples/vibeframe-promo/`) through the pipeline
# twice — fresh + cached — and asserts:
#
#   1. Pipeline succeeds with exit 0 + ok status
#   2. All 3 expected composition HTMLs are written
#   3. `vibe scene lint --project <project>` passes (errorCount: 0)
#   4. Second run hits cache: cacheHits == 3 and totalCostUsd == 0
#
# Cost: ≈ $0.18 on the fresh run, $0 on the cached run.
#
# Gating: skipped (exit 0) when `ANTHROPIC_API_KEY` is unset, so contributors
# without the key don't trip CI. CI is configured to run this smoke as an
# OPTIONAL job; failures here block release branches but don't block PRs
# from contributors lacking the key.
#
# Isolation: a temp HOME is set so the input-hash cache lives in
# $TMP/.vibeframe/cache/compose-scenes/ instead of the user's real cache.
# This guarantees the "fresh" run is actually fresh and the "cached" run
# verifies cache write-then-read.

set -euo pipefail

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "[skip] ANTHROPIC_API_KEY not set — v0.59 smoke skipped"
  exit 0
fi

REPO=$(cd "$(dirname "$0")/../.." && pwd)
EXAMPLE="$REPO/examples/vibeframe-promo"

if [ ! -d "$EXAMPLE" ]; then
  echo "FAIL: $EXAMPLE missing — run on a tree that has v0.59 C7 landed"
  exit 2
fi

CLI="$REPO/packages/cli/dist/index.js"
if [ ! -f "$CLI" ]; then
  echo "[setup] building CLI bundle …"
  (cd "$REPO" && pnpm -F @vibeframe/cli build) > /dev/null
fi

command -v jq > /dev/null || (echo "FAIL: jq is required (brew install jq / apt install jq)"; exit 3)

TMP=$(mktemp -d)
trap "rm -rf $TMP" EXIT

cp -R "$EXAMPLE/." "$TMP/project/"

export HOME="$TMP/home"
mkdir -p "$HOME"

cd "$TMP/project"

# `-o .` aligns the executor's `outputDir` with the project root (default
# is `<cwd>/<pipeline-name>-output/`, which would shift `params.project: .`
# off the actual DESIGN.md location). Same pattern documented in the
# example README.

# ── 1. Dry-run plan + budget ────────────────────────────────────────────
echo "[1/4] dry-run plan + cost"
DRY=$(node "$CLI" run vibeframe-promo.yaml -o . --dry-run 2>&1)
echo "$DRY" | jq -e '.totalSteps == 1' > /dev/null \
  || (echo "FAIL: dry-run missing 1 step in plan"; echo "$DRY"; exit 4)
echo "$DRY" | jq -e '.steps[0].action == "compose-scenes-with-skills"' > /dev/null \
  || (echo "FAIL: dry-run plan didn't surface compose-scenes-with-skills"; exit 4)

# ── 2. First execution — fresh ──────────────────────────────────────────
echo "[2/4] first execution (fresh, ≈8 s, ≈\$0.18)"
T0=$(date +%s)
RUN1=$(node "$CLI" run vibeframe-promo.yaml -o . --json 2>&1)
T1=$(($(date +%s) - T0))

echo "$RUN1" | jq -e '.success == true' > /dev/null \
  || (echo "FAIL: pipeline did not succeed"; echo "$RUN1"; exit 5)

WRITTEN=$(echo "$RUN1" | jq -r '.steps[0].data.written | length')
[ "$WRITTEN" = "3" ] || (echo "FAIL: expected 3 compositions written, got $WRITTEN"; exit 5)

CACHE_HITS_1=$(echo "$RUN1" | jq -r '.steps[0].data.cacheHits')
COST_1=$(echo "$RUN1" | jq -r '.steps[0].data.totalCostUsd')
[ "$CACHE_HITS_1" = "0" ] || (echo "FAIL: fresh run had $CACHE_HITS_1 cache hits, expected 0"; exit 5)

echo "  -> ${T1}s wall-clock | \$$COST_1 cost | 3 fresh"

for beat in hook claim close; do
  if [ ! -f "compositions/scene-${beat}.html" ]; then
    echo "FAIL: compositions/scene-${beat}.html missing"
    exit 5
  fi
done

# ── 3. Lint pass ────────────────────────────────────────────────────────
echo "[3/4] vibe scene lint --project ."
LINT=$(node "$CLI" scene lint --project . --json 2>&1)
echo "$LINT" | jq -e '.ok == true' > /dev/null \
  || (echo "FAIL: lint not clean"; echo "$LINT" | jq '.files[].findings'; exit 6)

# ── 4. Second execution — cached ───────────────────────────────────────
echo "[4/4] second execution (cached, ≈\$0)"
T0=$(date +%s)
RUN2=$(node "$CLI" run vibeframe-promo.yaml -o . --json 2>&1)
T2=$(($(date +%s) - T0))

CACHE_HITS_2=$(echo "$RUN2" | jq -r '.steps[0].data.cacheHits')
COST_2=$(echo "$RUN2" | jq -r '.steps[0].data.totalCostUsd')
[ "$CACHE_HITS_2" = "3" ] || (echo "FAIL: cached run had $CACHE_HITS_2 cache hits, expected 3"; exit 7)
[ "$COST_2" = "0" ] || (echo "FAIL: cached run cost \$$COST_2, expected \$0"; exit 7)

echo "  -> ${T2}s wall-clock | \$$COST_2 cost | 3 cached"

# ── Summary ─────────────────────────────────────────────────────────────
echo ""
echo "v0.59 smoke passed"
echo "  Fresh:  ${T1}s | \$$COST_1 | 3 compositions written + lint-clean"
echo "  Cached: ${T2}s | \$$COST_2 | 3 cache hits"
