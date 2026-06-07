#!/bin/bash
# Shared pre-push validation for Claude Code, Codex, and plain Git.
set -uo pipefail

PROJECT_DIR="${VIBEFRAME_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-}}"
if [ -z "$PROJECT_DIR" ]; then
  PROJECT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
fi

ERRORS=()

# 1. Version sync — all package.json files must have the same version.
ROOT_VERSION=$(jq -r '.version' "$PROJECT_DIR/package.json")
for pkg in packages/cli packages/core packages/ai-providers packages/mcp-server packages/ui apps/web; do
  PKG_VERSION=$(jq -r '.version' "$PROJECT_DIR/$pkg/package.json" 2>/dev/null)
  if [ -n "$PKG_VERSION" ] && [ "$PKG_VERSION" != "$ROOT_VERSION" ]; then
    ERRORS+=("Version mismatch: $pkg has $PKG_VERSION, root has $ROOT_VERSION. Fix: /release patch")
  fi
done

# 2. Version bump check — feat:/fix: commits since last tag should have a bump commit.
# Prefer the newest remote v* tag when available. GitHub Actions creates
# release tags after version commits land on main, so a developer clone can
# otherwise have stale local tags and miss a required bump on the next push.
remote_latest_tag() {
  cd "$PROJECT_DIR" || return 1
  git ls-remote --tags origin 'refs/tags/v*' 2>/dev/null \
    | awk '{print $2}' \
    | sed 's#refs/tags/##; s#\^{}##' \
    | sort -Vu \
    | tail -1
}

local_latest_tag() {
  cd "$PROJECT_DIR" || return 1
  git tag --list 'v*' --sort=v:refname 2>/dev/null | tail -1
}

LATEST_TAG=$(remote_latest_tag)
if [ -z "$LATEST_TAG" ]; then
  LATEST_TAG=$(local_latest_tag)
fi

if [ -n "$LATEST_TAG" ]; then
  if ! (cd "$PROJECT_DIR" && git rev-parse -q --verify "refs/tags/$LATEST_TAG" >/dev/null); then
    (cd "$PROJECT_DIR" && git fetch --quiet origin "refs/tags/$LATEST_TAG:refs/tags/$LATEST_TAG" 2>/dev/null) || true
  fi
  TAG_VERSION="${LATEST_TAG#v}"
  FEAT_FIX=$(cd "$PROJECT_DIR" && git log "$LATEST_TAG"..HEAD --oneline -E --grep="^(feat|fix)(\(.+\))?:" --format="%s" 2>/dev/null || true)
  if [ -n "$FEAT_FIX" ] && [ "$ROOT_VERSION" = "$TAG_VERSION" ]; then
    ERRORS+=("feat:/fix: commits found since $LATEST_TAG but version is still $ROOT_VERSION. Fix: /release patch (for fix) or /release minor (for feat)")
  fi
fi

# 3. No hardcoded version fallbacks in web app.
HARDCODED=$(grep -rn '|| "0\.[0-9]*\.[0-9]*"' "$PROJECT_DIR/apps/web/app/" 2>/dev/null || true)
if [ -n "$HARDCODED" ]; then
  ERRORS+=("Hardcoded version fallback in web app: $HARDCODED")
fi

# 4. MODELS.md SSOT — no stale model IDs in skills.
STALE=$(grep -rn --exclude-dir=sync-check "claude-opus-4-5\|claude-sonnet-4-20\|claude-3-5-haiku\|kling-v1-5" \
  "$PROJECT_DIR/.claude/skills/" 2>/dev/null || true)
if [ -n "$STALE" ]; then
  ERRORS+=("Stale model IDs in .claude/skills/. Update to match MODELS.md: $STALE")
fi

# 5. SSOT count sync — tool/provider counts in docs must match source.
if ! (cd "$PROJECT_DIR" && bash scripts/sync-counts.sh --check > /dev/null 2>&1); then
  SYNC_MSG=$(cd "$PROJECT_DIR" && bash scripts/sync-counts.sh --check 2>&1 || true)
  ERRORS+=("SSOT count mismatch. Run 'bash scripts/sync-counts.sh' for actual values. $SYNC_MSG")
fi

# 6. CHANGELOG sync — if version changed since last tag, CHANGELOG must contain it.
if [ -n "$LATEST_TAG" ] && [ "$ROOT_VERSION" != "$TAG_VERSION" ]; then
  if ! grep -q "\[$ROOT_VERSION\]" "$PROJECT_DIR/CHANGELOG.md" 2>/dev/null; then
    ERRORS+=("CHANGELOG.md missing entry for v$ROOT_VERSION. Fix: git-cliff --tag v$ROOT_VERSION -o CHANGELOG.md")
  fi
fi

# Run a checked command, capturing combined output. On failure, attach the
# last 5 lines so agents and humans can fix it without manually rerunning.
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

# 7. Lint check.
gated_check "Lint" "pnpm lint" pnpm lint

# 8. Build check.
gated_check "Build" "pnpm build" pnpm build

# 9. Type check.
gated_check "Type check" "pnpm typecheck" pnpm typecheck

# 10. CLI reference sync.
gated_check "docs/cli-reference.md is stale" \
  "pnpm -F @vibeframe/cli build && pnpm gen:reference" \
  pnpm gen:reference:check

# 11. Package export/package smoke.
gated_check "Package smoke" "pnpm build && pnpm package:check" pnpm package:check

if [ ${#ERRORS[@]} -gt 0 ]; then
  echo "Pre-push validation failed:" >&2
  for err in "${ERRORS[@]}"; do
    echo "  - $err" >&2
  done
  echo "" >&2
  echo "Fix these issues before pushing. Run 'version-checker' agent for full report." >&2
  exit 2
fi

exit 0
