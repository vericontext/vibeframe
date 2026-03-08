#!/bin/bash
# Claude Code PreToolUse hook — blocks git push if SSOT checks fail

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
    ERRORS+=("Version mismatch: $pkg has $PKG_VERSION, root has $ROOT_VERSION")
  fi
done

# 2. MODELS.md SSOT — no stale model IDs in skills (exclude sync-check docs)
STALE=$(grep -rn --exclude-dir=sync-check "claude-opus-4-5\|claude-sonnet-4-20\|claude-3-5-haiku\|kling-v1-5" \
  "$PROJECT_DIR/.claude/skills/" 2>/dev/null || true)
if [ -n "$STALE" ]; then
  ERRORS+=("Stale model IDs in .claude/skills/: $STALE")
fi

# 3. Build check
if ! (cd "$PROJECT_DIR" && pnpm build > /dev/null 2>&1); then
  ERRORS+=("Build failed — run 'pnpm build' to see errors")
fi

# Report
if [ ${#ERRORS[@]} -gt 0 ]; then
  echo "Pre-push SSOT validation failed:" >&2
  for err in "${ERRORS[@]}"; do
    echo "  - $err" >&2
  done
  echo "" >&2
  echo "Fix these issues before pushing. Run 'version-checker' agent for full report." >&2
  exit 2  # Block the push
fi

exit 0
