#!/usr/bin/env bash
# Refresh the vendored Hyperframes skill bundle from a sibling clone.
#
# Expects: $HOME/dev/oss/hyperframes (override with HF_REPO env var).
# Updates: packages/cli/src/commands/_shared/hf-skill-bundle/{SKILL.md, …}
#          NOTICE provenance line (sha + date)
#          bundle.ts BUNDLE_VERSION constant
#
# After running, review the diff and bump tests if the SKILL content
# changed in ways that invalidate the existing prompt strategy.

set -euo pipefail

HF_REPO=${HF_REPO:-$HOME/dev/oss/hyperframes}
DEST=$(cd "$(dirname "$0")/.." && pwd)/packages/cli/src/commands/_shared/hf-skill-bundle

if [ ! -d "$HF_REPO/skills/hyperframes" ]; then
  echo "Hyperframes repo not found at $HF_REPO" >&2
  echo "Set HF_REPO=/path/to/clone or clone https://github.com/heygen-com/hyperframes" >&2
  exit 1
fi

cd "$HF_REPO"
git fetch --quiet origin
HEAD_SHA=$(git rev-parse --short HEAD)
HEAD_DATE=$(git log -1 --format="%cd" --date=short)
echo "Refreshing from $HF_REPO @ $HEAD_SHA ($HEAD_DATE)"

SRC=$HF_REPO/skills/hyperframes
cp "$SRC/SKILL.md"                          "$DEST/SKILL.md"
cp "$SRC/house-style.md"                    "$DEST/house-style.md"
cp "$SRC/references/motion-principles.md"   "$DEST/motion-principles.md"
cp "$SRC/references/typography.md"          "$DEST/typography.md"
cp "$SRC/references/transitions.md"         "$DEST/transitions.md"

NEW_VERSION="$HEAD_SHA-$HEAD_DATE"
sed -i.bak -E "s/^export const BUNDLE_VERSION = \".*\";/export const BUNDLE_VERSION = \"$NEW_VERSION\";/" "$DEST/bundle.ts"
rm -f "$DEST/bundle.ts.bak"

sed -i.bak -E "s/^  Snapshot of:.*/  Snapshot of:   $HEAD_SHA/" "$DEST/NOTICE"
sed -i.bak -E "s/^  Snapshot date:.*/  Snapshot date: $HEAD_DATE/" "$DEST/NOTICE"
rm -f "$DEST/NOTICE.bak"

echo
echo "Bundle refreshed to $NEW_VERSION"
echo "  Review the diff: git diff packages/cli/src/commands/_shared/hf-skill-bundle"
echo "  Re-run tests:    pnpm -F @vibeframe/cli exec vitest run hf-skill-bundle"
