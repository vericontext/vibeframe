#!/bin/bash
# Single source of truth for VibeFrame release state.
#
# Callers:
#   - scripts/pre-push-validate.sh          non-blocking warning about unreleased work
#   - .github/workflows/release-tag.yml     blocks tagging a version that does not cover HEAD
#   - .github/workflows/release-drift.yml   daily tag-vs-npm backstop
#
# Keeping the computation here - rather than reimplementing it in the bash gate
# and again in workflow YAML - is deliberate. Two copies of this logic drifting
# apart is the exact bug class this script exists to prevent.
#
# The question that matters is NOT "has anyone bumped since the last tag?" but
# "does the current version cover every feat/fix on HEAD?". A bump that landed
# before further feat/fix commits leaves those commits unreleased and
# undocumented, which is invisible to a naive version-vs-tag comparison.
#
# Usage:
#   bash scripts/release-status.sh           human-readable summary
#   bash scripts/release-status.sh --json    machine-readable
#
# Exit codes:
#   0  clean - the current version covers HEAD
#   1  uncovered feat/fix commits exist after the last version bump
#   2  release metadata drift (CHANGELOG has no entry for the current version)

set -uo pipefail

PROJECT_DIR="${VIBEFRAME_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-}}"
if [ -z "$PROJECT_DIR" ]; then
  PROJECT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
fi
cd "$PROJECT_DIR" || exit 2

JSON=0
if [ "${1:-}" = "--json" ]; then
  JSON=1
fi

# Prefer the newest remote v* tag. Release tags are created by CI after version
# commits land on main, so a developer clone can otherwise hold a stale local
# tag and misjudge the range.
remote_latest_tag() {
  git ls-remote --tags origin 'refs/tags/v*' 2>/dev/null \
    | awk '{print $2}' \
    | sed 's#refs/tags/##; s#\^{}##' \
    | sort -Vu \
    | tail -1
}

local_latest_tag() {
  git tag --list 'v*' --sort=v:refname 2>/dev/null | tail -1
}

ROOT_VERSION=$(jq -r '.version' package.json)

LATEST_TAG=$(remote_latest_tag)
if [ -z "$LATEST_TAG" ]; then
  LATEST_TAG=$(local_latest_tag)
fi

# The range computations below need the tag object present locally.
if [ -n "$LATEST_TAG" ] && ! git rev-parse -q --verify "refs/tags/$LATEST_TAG" >/dev/null; then
  git fetch --quiet origin "refs/tags/$LATEST_TAG:refs/tags/$LATEST_TAG" 2>/dev/null || true
fi

TAG_VERSION="${LATEST_TAG#v}"

# Subject-only matching. `git log --grep` searches the whole commit message,
# so a merge commit whose body quotes the PR title double-counts the commit it
# merged. Formatting the subject and grepping it keeps each commit counted once.
subjects_since() {
  git log "$1..HEAD" --no-merges --format='%h %s' 2>/dev/null
}

# The most recent version bump reachable from HEAD. Everything after it is work
# the current version does not describe.
LAST_BUMP=""
if [ -n "$LATEST_TAG" ]; then
  LAST_BUMP=$(subjects_since "$LATEST_TAG" \
    | grep -E '^[0-9a-f]+ chore: bump version' \
    | head -1 \
    | awk '{print $1}')
fi

RANGE_START="${LAST_BUMP:-$LATEST_TAG}"

UNCOVERED=""
if [ -n "$RANGE_START" ]; then
  UNCOVERED=$(subjects_since "$RANGE_START" \
    | grep -E '^[0-9a-f]+ (feat|fix)(\(.+\))?:' || true)
fi

UNCOVERED_COUNT=0
if [ -n "$UNCOVERED" ]; then
  UNCOVERED_COUNT=$(printf '%s\n' "$UNCOVERED" | wc -l | tr -d ' ')
fi

TAG_EXISTS=false
if git rev-parse -q --verify "refs/tags/v$ROOT_VERSION" >/dev/null 2>&1; then
  TAG_EXISTS=true
elif [ -n "$(git ls-remote --tags origin "refs/tags/v$ROOT_VERSION" 2>/dev/null)" ]; then
  TAG_EXISTS=true
fi

# publish.yml extracts release notes by matching `## [VERSION]` at line start.
# Anchor identically here so a passing check guarantees a non-empty release body.
CHANGELOG_HAS_VERSION=false
if grep -q "^## \[$ROOT_VERSION\]" CHANGELOG.md 2>/dev/null; then
  CHANGELOG_HAS_VERSION=true
fi

STATUS=0
if [ "$UNCOVERED_COUNT" -gt 0 ]; then
  STATUS=1
elif [ "$CHANGELOG_HAS_VERSION" = false ]; then
  STATUS=2
fi

if [ "$JSON" -eq 1 ]; then
  jq -n \
    --arg rootVersion "$ROOT_VERSION" \
    --arg latestTag "$LATEST_TAG" \
    --arg tagVersion "$TAG_VERSION" \
    --arg lastBump "$LAST_BUMP" \
    --arg uncoveredList "$UNCOVERED" \
    --argjson uncoveredCount "$UNCOVERED_COUNT" \
    --argjson tagExists "$TAG_EXISTS" \
    --argjson changelogHasVersion "$CHANGELOG_HAS_VERSION" \
    --argjson status "$STATUS" \
    '{
      rootVersion: $rootVersion,
      latestTag: $latestTag,
      tagVersion: $tagVersion,
      lastBump: $lastBump,
      uncoveredCount: $uncoveredCount,
      uncovered: ($uncoveredList | if length > 0 then split("\n") else [] end),
      tagExists: $tagExists,
      changelogHasVersion: $changelogHasVersion,
      status: $status
    }'
else
  echo "Release status"
  echo "  root version:  $ROOT_VERSION"
  echo "  latest tag:    ${LATEST_TAG:-<none>}"
  echo "  last bump:     ${LAST_BUMP:-<none since tag>}"
  echo "  v$ROOT_VERSION tagged: $TAG_EXISTS"
  echo "  CHANGELOG has [$ROOT_VERSION]: $CHANGELOG_HAS_VERSION"
  echo "  uncovered feat/fix: $UNCOVERED_COUNT"
  if [ -n "$UNCOVERED" ]; then
    printf '%s\n' "$UNCOVERED" | sed 's/^/    /'
  fi
fi

exit "$STATUS"
