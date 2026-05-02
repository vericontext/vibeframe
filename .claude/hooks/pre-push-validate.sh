#!/bin/bash
# Claude Code PreToolUse hook — blocks git push if SSOT checks fail
set -uo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only intercept git push commands. The pattern accepts any args between
# `git` and `push` (e.g. `git -C /path push`, `git --git-dir=… push`,
# `git push --force`) — pre-fix this required a literal whitespace
# between the two words and silently passed through `git -C <dir> push`.
#
# `\b` (word boundary) is intentionally avoided here: BSD grep's ERE on
# macOS doesn't support it inside grouped alternations. Instead the
# pattern requires `push` followed by EOL or whitespace, which gives the
# same trailing-boundary effect on every platform.
if ! echo "$COMMAND" | grep -qE "(^|[[:space:]|;&])git[[:space:]][^|;&]*(push\$|push[[:space:]])"; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
ERRORS=()

# 1. Version sync — all package.json must have same version
ROOT_VERSION=$(jq -r '.version' "$PROJECT_DIR/package.json")
for pkg in packages/cli packages/core packages/ai-providers packages/mcp-server packages/ui apps/web; do
  PKG_VERSION=$(jq -r '.version' "$PROJECT_DIR/$pkg/package.json" 2>/dev/null)
  if [ -n "$PKG_VERSION" ] && [ "$PKG_VERSION" != "$ROOT_VERSION" ]; then
    ERRORS+=("Version mismatch: $pkg has $PKG_VERSION, root has $ROOT_VERSION. Fix: /release patch")
  fi
done

# 2. Version bump check — feat:/fix: commits since last tag should have a bump commit
LATEST_TAG=$(cd "$PROJECT_DIR" && git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -n "$LATEST_TAG" ]; then
  TAG_VERSION="${LATEST_TAG#v}"
  # -E enables extended regex so scoped commits (`feat(cli):`, `fix(hooks):`)
  # match alongside the bare `feat:` / `fix:` form. Pre-fix this used two
  # `--grep` flags without -E, which silently skipped every scoped commit.
  FEAT_FIX=$(cd "$PROJECT_DIR" && git log "$LATEST_TAG"..HEAD --oneline -E --grep="^(feat|fix)(\(.+\))?:" --format="%s" 2>/dev/null || true)
  if [ -n "$FEAT_FIX" ] && [ "$ROOT_VERSION" = "$TAG_VERSION" ]; then
    ERRORS+=("feat:/fix: commits found since $LATEST_TAG but version is still $ROOT_VERSION. Fix: /release patch (for fix) or /release minor (for feat)")
  fi
fi

# 3. No hardcoded version fallbacks in web app
HARDCODED=$(grep -rn '|| "0\.[0-9]*\.[0-9]*"' "$PROJECT_DIR/apps/web/app/" 2>/dev/null || true)
if [ -n "$HARDCODED" ]; then
  ERRORS+=("Hardcoded version fallback in web app: $HARDCODED")
fi

# 4. MODELS.md SSOT — no stale model IDs in skills (exclude sync-check docs)
STALE=$(grep -rn --exclude-dir=sync-check "claude-opus-4-5\|claude-sonnet-4-20\|claude-3-5-haiku\|kling-v1-5" \
  "$PROJECT_DIR/.claude/skills/" 2>/dev/null || true)
if [ -n "$STALE" ]; then
  ERRORS+=("Stale model IDs in .claude/skills/. Update to match MODELS.md: $STALE")
fi

# 5. SSOT count sync — tool/provider counts in docs must match source
if ! (cd "$PROJECT_DIR" && bash scripts/sync-counts.sh --check > /dev/null 2>&1); then
  SYNC_MSG=$(cd "$PROJECT_DIR" && bash scripts/sync-counts.sh --check 2>&1 || true)
  ERRORS+=("SSOT count mismatch. Run 'bash scripts/sync-counts.sh' for actual values. $SYNC_MSG")
fi

# 6. CHANGELOG sync — if version changed since last tag, CHANGELOG must contain it
if [ -n "$LATEST_TAG" ] && [ "$ROOT_VERSION" != "$TAG_VERSION" ]; then
  if ! grep -q "\[$ROOT_VERSION\]" "$PROJECT_DIR/CHANGELOG.md" 2>/dev/null; then
    ERRORS+=("CHANGELOG.md missing entry for v$ROOT_VERSION. Fix: git-cliff --tag v$ROOT_VERSION -o CHANGELOG.md")
  fi
fi

# Run a checked command, capturing combined output. On failure, attach
# the last 5 lines to the error so the user can fix it without manually
# re-running. Pre-fix this used `> /dev/null 2>&1`, which left users
# guessing what actually failed.
TMP_LOG=$(mktemp -t vibe-prepush.XXXXXX)
trap 'rm -f "$TMP_LOG"' EXIT
gated_check() {
  local label="$1"
  local fix="$2"
  shift 2
  if ! (cd "$PROJECT_DIR" && "$@" > "$TMP_LOG" 2>&1); then
    local tail_lines
    tail_lines=$(tail -5 "$TMP_LOG" | sed 's/^/      /')
    ERRORS+=("$label failed. Fix: $fix
$tail_lines")
  fi
}

# 7. Lint check
gated_check "Lint" "pnpm lint" pnpm lint

# 8. Build check
gated_check "Build" "pnpm build" pnpm build

# 9. Type check — `pnpm build` uses esbuild (no type validation), so strict
# TS errors slip past locally and get caught only by CI's typecheck job.
# Mirror that gate here so local pushes catch the same class of failures.
gated_check "Type check" "pnpm typecheck" pnpm typecheck

# 10. CLI reference sync — `gen:reference` reads the dist binary, so a stale
# dist (bumped version not rebuilt) produces a file that fails CI's check.
# This gate caught the 0.96.{1,2,3} CI failures only after the fact —
# moving it pre-push closes the loop. Cheap (<1s).
gated_check "docs/cli-reference.md is stale" \
  "pnpm -F @vibeframe/cli build && pnpm gen:reference" \
  pnpm gen:reference:check

# Report
if [ ${#ERRORS[@]} -gt 0 ]; then
  echo "Pre-push validation failed:" >&2
  for err in "${ERRORS[@]}"; do
    echo "  - $err" >&2
  done
  echo "" >&2
  echo "Fix these issues before pushing. Run 'version-checker' agent for full report." >&2
  exit 2  # Block the push
fi

exit 0
