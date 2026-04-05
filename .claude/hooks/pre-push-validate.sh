#!/bin/bash
# Claude Code PreToolUse hook — blocks git push if SSOT checks fail
set -uo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only intercept git push commands
if ! echo "$COMMAND" | grep -qE "git\s+push"; then
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
  FEAT_FIX=$(cd "$PROJECT_DIR" && git log "$LATEST_TAG"..HEAD --oneline --grep="^feat:" --grep="^fix:" --format="%s" 2>/dev/null || true)
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

# 6. Lint check
if ! (cd "$PROJECT_DIR" && pnpm lint > /dev/null 2>&1); then
  ERRORS+=("Lint failed. Fix: pnpm lint")
fi

# 7. Build check
if ! (cd "$PROJECT_DIR" && pnpm build > /dev/null 2>&1); then
  ERRORS+=("Build failed. Fix: pnpm build")
fi

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
