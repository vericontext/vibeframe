#!/bin/bash
# Extracts actual counts from CLI source code for SSOT validation.
# Usage: bash scripts/sync-counts.sh [--check]
#
# Without --check: prints current values (for reference)
# With --check: validates that docs/landing match actual values

set -uo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$PROJECT_DIR"

# ── Extract actual values ────────────────────────────────────────────────

# CLI commands (from schema --list, excluding deprecated)
CLI_COMMANDS=$(node packages/cli/dist/index.js schema --list 2>/dev/null | node -e "
  const d=require('fs').readFileSync('/dev/stdin','utf8');
  console.log(JSON.parse(d).length);
" 2>/dev/null || echo "?")

# Agent tools (count ToolDefinition definitions in tool files)
AGENT_TOOLS=$(grep -r 'ToolDefinition = {' packages/cli/src/agent/tools/ 2>/dev/null | wc -l | tr -d ' ')

# MCP tools (count tool definitions in mcp-server/src/tools/)
MCP_TOOLS=$(grep -r 'name: "' packages/mcp-server/src/tools/ 2>/dev/null | wc -l | tr -d ' ')

# Tests (from last test run, or run if needed)
TESTS=$(pnpm -F @vibeframe/cli exec vitest run 2>&1 | grep "Tests" | tail -1 | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' || echo "?")

# LLM providers (count from LLMProvider type union)
LLM_PROVIDERS=$(grep 'LLMProvider = ' packages/cli/src/agent/types.ts 2>/dev/null | grep -oE '"[a-z]+"' | wc -l | tr -d ' ')

# Version
VERSION=$(jq -r '.version' package.json)

if [ "${1:-}" != "--check" ]; then
  echo "=== VibeFrame SSOT Counts ==="
  echo "Version:        $VERSION"
  echo "CLI commands:   $CLI_COMMANDS"
  echo "Agent tools:    $AGENT_TOOLS"
  echo "MCP tools:      $MCP_TOOLS"
  echo "Tests passing:  $TESTS"
  echo "LLM providers:  $LLM_PROVIDERS"
  echo ""
  echo "Use these values when updating README.md, landing page, and docs."
  echo "Run with --check to validate current docs."
  exit 0
fi

# ── Check mode: validate docs ────────────────────────────────────────────

ERRORS=()

# Check README.md agent tool count
README_TOOLS=$(grep -oE '[0-9]+ tools' README.md | head -1 | grep -oE '[0-9]+')
if [ -n "$README_TOOLS" ] && [ "$README_TOOLS" != "$AGENT_TOOLS" ]; then
  ERRORS+=("README.md: says '$README_TOOLS tools' but actual agent tools = $AGENT_TOOLS")
fi

# Check landing page agent tool count
LANDING_TOOLS=$(grep -oE 'title="[0-9]+ Tools"' apps/web/app/page.tsx | grep -oE '[0-9]+')
if [ -n "$LANDING_TOOLS" ] && [ "$LANDING_TOOLS" != "$AGENT_TOOLS" ]; then
  ERRORS+=("page.tsx: says '$LANDING_TOOLS Tools' but actual agent tools = $AGENT_TOOLS")
fi

# Check landing page LLM provider count
LANDING_LLM=$(grep -oE '[0-9]+ LLM [Pp]roviders' apps/web/app/page.tsx | head -1 | grep -oE '[0-9]+')
if [ -n "$LANDING_LLM" ] && [ "$LANDING_LLM" != "$LLM_PROVIDERS" ]; then
  ERRORS+=("page.tsx: says '$LANDING_LLM LLM providers' but actual = $LLM_PROVIDERS")
fi

if [ ${#ERRORS[@]} -gt 0 ]; then
  echo "SSOT count mismatch:" >&2
  for err in "${ERRORS[@]}"; do
    echo "  - $err" >&2
  done
  echo "" >&2
  echo "Run 'bash scripts/sync-counts.sh' to see actual values." >&2
  exit 1
fi

echo "All counts in sync."
exit 0
