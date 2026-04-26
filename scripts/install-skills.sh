#!/usr/bin/env bash
set -euo pipefail

# Install VibeFrame Claude Code skills into the current project (.claude/skills/).
# Usage: curl -fsSL https://raw.githubusercontent.com/vericontext/vibeframe/main/scripts/install-skills.sh | bash

REPO_RAW="https://raw.githubusercontent.com/vericontext/vibeframe/main"
# v0.62: consolidated to 2 skills. The earlier `/vibeframe` (overview) was
# replaced by AGENTS.md (scaffolded by `vibe init`); `/vibe-script-to-video`
# was merged into `/vibe-scene` since v0.60's `vibe scene build` is now the
# recommended path for storyboard → MP4 workflows.
SKILLS=(vibe-pipeline vibe-scene)
TARGET_DIR="${CLAUDE_SKILLS_DIR:-.claude/skills}"

if [ ! -d ".claude" ] && [ -z "${FORCE_INSTALL:-}" ]; then
  echo "ℹ  No .claude/ directory in $(pwd). Creating one."
fi

mkdir -p "$TARGET_DIR"

for skill in "${SKILLS[@]}"; do
  mkdir -p "$TARGET_DIR/$skill"
  if curl -fsSL "$REPO_RAW/.claude/skills/$skill/SKILL.md" -o "$TARGET_DIR/$skill/SKILL.md"; then
    echo "✓ Installed /$skill → $TARGET_DIR/$skill/SKILL.md"
  else
    echo "✗ Failed to fetch $skill" >&2
    exit 1
  fi
done

echo ""
echo "Done. Restart Claude Code to pick up new skills."
echo "Slash commands now available: /vibe-pipeline, /vibe-scene"
echo "(For overview / quick reference, run \`vibe init\` to scaffold AGENTS.md.)"
