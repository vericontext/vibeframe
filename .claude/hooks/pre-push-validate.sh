#!/bin/bash
# Claude Code PreToolUse wrapper — delegates git push validation to the
# shared repository script used by Codex and plain Git hooks.
set -uo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only intercept git push commands. The pattern accepts any args between
# `git` and `push` (e.g. `git -C /path push`, `git --git-dir=... push`,
# `git push --force`).
if ! echo "$COMMAND" | grep -qE "(^|[[:space:]|;&])git[[:space:]][^|;&]*(push$|push[[:space:]])"; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
export VIBEFRAME_PROJECT_DIR="$PROJECT_DIR"

exec bash "$PROJECT_DIR/scripts/pre-push-validate.sh"
