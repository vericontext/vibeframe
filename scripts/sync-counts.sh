#!/bin/bash
# scripts/sync-counts.sh
#
# Source-of-truth sync validator for VibeFrame.
#
# Without --check : prints the actual SSOT counts (informational)
# With    --check : validates docs, landing copy, share metadata, and the
#                   provider-enumeration matrix across CLI commands. Exits
#                   non-zero with one error line per drift.
#
# This script is invoked by `.claude/hooks/pre-push-validate.sh`, so any
# drift it catches blocks `git push` until fixed. Drift categories:
#
#   A. Numeric counts (AI_PROVIDERS / MCP_TOOLS / AGENT_TOOLS) referenced
#      verbatim in README / landing / share metadata
#   B. Provider enumeration completeness — every entry that appears in
#      provider-resolver.ts must also exist in schema.ts PROVIDER_ENV_VARS,
#      doctor.ts COMMAND_KEY_MAP, setup.ts allProviders, and .env.example
#   C. Stale default-name strings ("Grok Imagine", "Gemini Nano Banana")
#      that linger in user-facing copy after the default has flipped
#   D. Commander `-p` default in `vibe generate image|video` matches the
#      resolver's priority leader (or is absent so the resolver wins)
#
# Categories A, C, D are textual; B is structural cross-validation.

set -uo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$PROJECT_DIR"

CHECK_MODE=false
if [ "${1:-}" = "--check" ]; then
  CHECK_MODE=true
fi

# ── Source-of-truth values (extracted from code) ─────────────────────────

# AI provider directories (each = one external service we integrate with).
# Match next.config.js: count every dir under ai-providers/src/ except
# `interface` (the type-only folder that defines the AIProvider contract).
AI_PROVIDERS=$(find packages/ai-providers/src -mindepth 1 -maxdepth 1 -type d ! -name interface | wc -l | tr -d ' ')

# MCP + Agent tool counts come from the manifest itself (v0.67 PR3 / C9).
# Pre-v0.67 PR3 the script grepped `defineTool({` and `surfaces: ["mcp"]`
# against packages/cli/src/tools/manifest/*.ts — fragile, and broke twice
# during the v0.66 agent-only migration when the regex didn't match the
# new shape. `scripts/print-counts.mts` does one `manifest.filter(...)`
# instead and emits JSON.
COUNTS_JSON=$(pnpm exec tsx scripts/print-counts.mts 2>/dev/null)
MCP_TOOLS=$(echo "$COUNTS_JSON" | jq -r .mcp 2>/dev/null || echo "?")
AGENT_TOOLS=$(echo "$COUNTS_JSON" | jq -r .agent 2>/dev/null || echo "?")

# LLM providers (LLMProvider type union)
LLM_PROVIDERS=$(grep 'LLMProvider = ' packages/cli/src/agent/types.ts 2>/dev/null \
  | grep -oE '"[a-z]+"' | wc -l | tr -d ' ')

VERSION=$(jq -r '.version' package.json)

# ── Informational mode ──────────────────────────────────────────────────

if ! $CHECK_MODE; then
  CLI_COMMANDS=$(node packages/cli/dist/index.js schema --list 2>/dev/null | node -e "
    const d=require('fs').readFileSync('/dev/stdin','utf8');
    console.log(JSON.parse(d).length);
  " 2>/dev/null || echo "?")
  TESTS=$(pnpm -F @vibeframe/cli exec vitest run 2>&1 | grep "Tests" | tail -1 \
    | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' || echo "?")

  echo "=== VibeFrame SSOT Counts ==="
  echo "Version:          $VERSION"
  echo "CLI commands:     $CLI_COMMANDS"
  echo "Agent tools:      $AGENT_TOOLS"
  echo "MCP tools:        $MCP_TOOLS"
  echo "AI providers:     $AI_PROVIDERS"
  echo "LLM providers:    $LLM_PROVIDERS"
  echo "Tests passing:    $TESTS"
  echo ""
  echo "Run with --check to validate docs, landing copy, and CLI surfaces."
  exit 0
fi

# ── Check mode ──────────────────────────────────────────────────────────

ERRORS=()
err() { ERRORS+=("$1"); }

# Helper — extract the first integer captured from the first regex match
first_num() {
  grep -oE "$1" "$2" 2>/dev/null | head -1 | grep -oE '[0-9]+' | head -1
}

# ── A1. README.md numeric counts ────────────────────────────────────────

R_TAGLINE_AI=$(first_num '\*\*The video CLI for AI agents\.\*\* YAML pipelines\. [0-9]+ AI providers' README.md)
[ -n "$R_TAGLINE_AI" ] && [ "$R_TAGLINE_AI" != "$AI_PROVIDERS" ] && \
  err "README.md tagline says '${R_TAGLINE_AI} AI providers' but ai-providers/src/* has ${AI_PROVIDERS} dirs"

R_TAGLINE_MCP=$(grep -oE 'AI providers\. [0-9]+ MCP tools' README.md | head -1 | grep -oE '[0-9]+')
[ -n "$R_TAGLINE_MCP" ] && [ "$R_TAGLINE_MCP" != "$MCP_TOOLS" ] && \
  err "README.md tagline says '${R_TAGLINE_MCP} MCP tools' but mcp-server/src/tools/ has ${MCP_TOOLS} entries"

R_COMP_AI=$(first_num 'AI providers \| \*\*[0-9]+\*\*' README.md)
[ -n "$R_COMP_AI" ] && [ "$R_COMP_AI" != "$AI_PROVIDERS" ] && \
  err "README.md comparison row says '${R_COMP_AI}' AI providers but actual = ${AI_PROVIDERS}"

R_AGENT=$(first_num '\*\*Same [0-9]+ tools' README.md)
[ -n "$R_AGENT" ] && [ "$R_AGENT" != "$AGENT_TOOLS" ] && \
  err "README.md says 'Same ${R_AGENT} tools' but agent tools = ${AGENT_TOOLS}"

R_MCP_BUNDLED=$(first_num '\*\*[0-9]+ MCP tools\*\*' README.md)
[ -n "$R_MCP_BUNDLED" ] && [ "$R_MCP_BUNDLED" != "$MCP_TOOLS" ] && \
  err "README.md MCP cell shows '${R_MCP_BUNDLED} MCP tools' but actual = ${MCP_TOOLS}"

# Comparison table — "MCP server (N tools, ..." and "✅ N tools" cells.
# These were missed before #108 cleanup landed; check each occurrence.
while IFS= read -r line; do
  N=$(echo "$line" | grep -oE 'MCP server \([0-9]+ tools' | grep -oE '[0-9]+' | head -1)
  [ -n "$N" ] && [ "$N" != "$MCP_TOOLS" ] && \
    err "README.md comparison row says 'MCP server (${N} tools' but actual = ${MCP_TOOLS}"
done < <(grep -E 'MCP server \([0-9]+ tools' README.md)

while IFS= read -r line; do
  N=$(echo "$line" | grep -oE '✅ [0-9]+ tools' | grep -oE '[0-9]+' | head -1)
  [ -n "$N" ] && [ "$N" != "$MCP_TOOLS" ] && \
    err "README.md MCP-server row says '✅ ${N} tools' but actual = ${MCP_TOOLS}"
done < <(grep -E '✅ [0-9]+ tools' README.md)

# ── A2. apps/web/app/page.tsx hero copy ─────────────────────────────────
# Hero copy may interpolate ${process.env.NEXT_PUBLIC_AI_PROVIDERS} (preferred)
# or hardcode. If hardcoded, must match.

if grep -qE '\b[0-9]+ AI providers' apps/web/app/page.tsx; then
  P_HERO_AI=$(first_num '[0-9]+ AI providers' apps/web/app/page.tsx)
  [ "$P_HERO_AI" != "$AI_PROVIDERS" ] && \
    err "apps/web/app/page.tsx hero: hardcoded '${P_HERO_AI} AI providers' but actual = ${AI_PROVIDERS}. Prefer \${process.env.NEXT_PUBLIC_AI_PROVIDERS}"
fi

if grep -qE '\b[0-9]+ MCP tools' apps/web/app/page.tsx; then
  P_HERO_MCP=$(first_num '[0-9]+ MCP tools' apps/web/app/page.tsx)
  [ "$P_HERO_MCP" != "$MCP_TOOLS" ] && \
    err "apps/web/app/page.tsx hero: hardcoded '${P_HERO_MCP} MCP tools' but actual = ${MCP_TOOLS}. Prefer \${process.env.NEXT_PUBLIC_MCP_TOOLS}"
fi

# ── A3. apps/web/app/layout.tsx share metadata (OG / Twitter) ───────────
# This is the most-public surface (every share card on Twitter/LinkedIn).
# Skip if the file uses ${...} interpolation; otherwise require numbers
# match the auto-counts.

# Catches three patterns:
#   description: "... 5 AI providers, 53 MCP tools ..."  (literal string)
#   const AI_PROVIDERS = "5" ?? ...                       (extracted constant)
#   const SHARE_DESC = `... ${X} AI providers, ${Y} ...`  (interpolation — only checked via the constants above)
if grep -qE '"[0-9]+ AI providers' apps/web/app/layout.tsx; then
  L_AI=$(grep -oE '"([0-9]+) AI providers' apps/web/app/layout.tsx | head -1 | grep -oE '[0-9]+')
  [ "$L_AI" != "$AI_PROVIDERS" ] && \
    err "apps/web/app/layout.tsx share metadata: hardcoded '${L_AI} AI providers' but actual = ${AI_PROVIDERS}"
fi

if grep -qE '"[0-9]+ MCP tools' apps/web/app/layout.tsx; then
  L_MCP=$(grep -oE '"([0-9]+) MCP tools' apps/web/app/layout.tsx | head -1 | grep -oE '[0-9]+')
  [ "$L_MCP" != "$MCP_TOOLS" ] && \
    err "apps/web/app/layout.tsx share metadata: hardcoded '${L_MCP} MCP tools' but actual = ${MCP_TOOLS}"
fi

# Also catch the AI_PROVIDERS / MCP_TOOLS constants if they have numeric
# fallbacks (the `"13" ?? ...` pattern). The fallback exists *because* the
# env var might be missing at build time, so it must match the actual count.
LAYOUT_AI_CONST=$(grep -oE 'const AI_PROVIDERS = [^;]+' apps/web/app/layout.tsx \
  | grep -oE '"[0-9]+"' | head -1 | tr -d '"')
if [ -n "$LAYOUT_AI_CONST" ] && [ "$LAYOUT_AI_CONST" != "$AI_PROVIDERS" ]; then
  err "apps/web/app/layout.tsx const AI_PROVIDERS fallback = '${LAYOUT_AI_CONST}' but actual = ${AI_PROVIDERS}"
fi

LAYOUT_MCP_CONST=$(grep -oE 'const MCP_TOOLS = [^;]+' apps/web/app/layout.tsx \
  | grep -oE '"[0-9]+"' | head -1 | tr -d '"')
if [ -n "$LAYOUT_MCP_CONST" ] && [ "$LAYOUT_MCP_CONST" != "$MCP_TOOLS" ]; then
  err "apps/web/app/layout.tsx const MCP_TOOLS fallback = '${LAYOUT_MCP_CONST}' but actual = ${MCP_TOOLS}"
fi

# ── A4. apps/web/app/demo/page.tsx tool count ───────────────────────────

if grep -qE 'same [0-9]+ tools' apps/web/app/demo/page.tsx; then
  D_TOOLS=$(first_num 'same ([0-9]+) tools' apps/web/app/demo/page.tsx)
  [ "$D_TOOLS" != "$AGENT_TOOLS" ] && \
    err "apps/web/app/demo/page.tsx: 'same ${D_TOOLS} tools' but agent tools = ${AGENT_TOOLS}"
fi

# ── B1. .env.example completeness vs PROVIDER_ENV_VARS ──────────────────
# Every env var referenced in schema PROVIDER_ENV_VARS must have a
# `KEY=` line in .env.example, with a `# ...` comment block above it.

SCHEMA_VARS=$(awk '/PROVIDER_ENV_VARS.*=.*\{/,/^\};/' packages/cli/src/config/schema.ts \
  | grep -oE '"[A-Z_]+"' | tr -d '"' | grep -E '^[A-Z_]+_(KEY|SECRET|TOKEN)$|^FAL_KEY$' | sort -u)

for var in $SCHEMA_VARS; do
  LINE=$(grep -nE "^${var}=" .env.example | head -1 | cut -d: -f1)
  if [ -z "$LINE" ]; then
    err ".env.example missing '${var}=' line (defined in schema PROVIDER_ENV_VARS)"
    continue
  fi
  # Walk upward until we hit a non-blank line; that line should be a # comment.
  PREV=$((LINE - 1))
  PREV_LINE=""
  while [ "$PREV" -gt 0 ]; do
    PREV_LINE=$(sed -n "${PREV}p" .env.example)
    if [ -n "$PREV_LINE" ]; then
      break
    fi
    PREV=$((PREV - 1))
  done
  if ! echo "$PREV_LINE" | grep -qE '^#.+'; then
    err ".env.example: ${var} has no '# ...' comment block above it (other keys all have descriptive headers)"
  fi
done

# ── B2. provider-resolver.ts envVars ⊂ schema PROVIDER_ENV_VARS ─────────

RESOLVER_VARS=$(grep -oE 'envVar: "[A-Z_]+"' packages/cli/src/utils/provider-resolver.ts \
  | grep -oE '"[A-Z_]+"' | tr -d '"' | sort -u)

for var in $RESOLVER_VARS; do
  if ! echo "$SCHEMA_VARS" | grep -qx "$var"; then
    err "provider-resolver.ts uses ${var} but schema PROVIDER_ENV_VARS doesn't include it. Add it to packages/cli/src/config/schema.ts"
  fi
done

# ── B3. doctor.ts COMMAND_KEY_MAP ⊇ provider-resolver envVars ───────────

DOCTOR_VARS=$(awk '/^const COMMAND_KEY_MAP/,/^};/' packages/cli/src/commands/doctor.ts \
  | grep -oE '^\s*[A-Z_]+:' | grep -oE '[A-Z_]+' | sort -u)

for var in $RESOLVER_VARS; do
  if ! echo "$DOCTOR_VARS" | grep -qx "$var"; then
    err "doctor.ts COMMAND_KEY_MAP missing ${var} (used in provider-resolver.ts). 'vibe doctor' won't list any commands for this provider."
  fi
done

# ── B4. setup.ts allProviders envVars ⊂ schema PROVIDER_ENV_VARS ────────

SETUP_VARS=$(awk '/const allProviders/,/^\s*\];/' packages/cli/src/commands/setup.ts \
  | grep -oE 'env: "[A-Z_]+"' | grep -oE '"[A-Z_]+"' | tr -d '"' | sort -u)

for var in $SETUP_VARS; do
  if ! echo "$SCHEMA_VARS" | grep -qx "$var"; then
    err "setup.ts allProviders uses ${var} but schema PROVIDER_ENV_VARS doesn't include it"
  fi
done

# ── D. Commander `-p` defaults vs resolver leaders ──────────────────────
# Commander default *should* be empty so the resolver picks the priority
# leader. If a default IS set, it MUST equal IMAGE_PROVIDERS[0].name /
# VIDEO_PROVIDERS[0].name — otherwise users with multiple keys silently
# get the wrong provider (the v0.57.1/v0.57.2 bug).

# The description string in some -p options contains its own '(...)'
# (e.g. "Provider: grok (default), kling..."), so [^)]* would stop too
# early. Match the whole line and take the last '"X")' which is always
# the Commander default value.
IMG_DEFAULT=$(awk '/\.command\("image"/,/\.action\(/' packages/cli/src/commands/generate.ts \
  | grep -E '\.option\("-p, --provider <provider>"' \
  | grep -oE '"[a-z]+"\)' | tail -1 | grep -oE '"[a-z]+"' | tr -d '"')

if [ -n "$IMG_DEFAULT" ]; then
  IMG_LEADER=$(awk '/IMAGE_PROVIDERS:/,/\];/' packages/cli/src/utils/provider-resolver.ts \
    | grep -oE 'name: "[a-z]+"' | head -1 | grep -oE '"[a-z]+"' | tr -d '"')
  if [ "$IMG_DEFAULT" != "$IMG_LEADER" ]; then
    err "generate.ts \`vibe gen image\` Commander default '-p ${IMG_DEFAULT}' does not match IMAGE_PROVIDERS leader '${IMG_LEADER}'. Either drop the default (preferred — let resolver pick) or align."
  fi
fi

VID_DEFAULT=$(awk '/\.command\("video"/,/\.action\(/' packages/cli/src/commands/generate.ts \
  | grep -E '\.option\("-p, --provider <provider>"' \
  | grep -oE '"[a-z]+"\)' | tail -1 | grep -oE '"[a-z]+"' | tr -d '"')

if [ -n "$VID_DEFAULT" ]; then
  VID_LEADER=$(awk '/VIDEO_PROVIDERS:/,/\];/' packages/cli/src/utils/provider-resolver.ts \
    | grep -oE 'name: "[a-z]+"' | head -1 | grep -oE '"[a-z]+"' | tr -d '"')
  if [ "$VID_DEFAULT" != "$VID_LEADER" ]; then
    err "generate.ts \`vibe gen video\` Commander default '-p ${VID_DEFAULT}' does not match VIDEO_PROVIDERS leader '${VID_LEADER}'. Either drop the default (preferred) or align."
  fi
fi

# ── C. Stale default-name strings (banned phrases) ──────────────────────
# When we promote a new default in a release, the previous default's
# marketing string shouldn't linger in user-facing copy unless explicitly
# marked. To intentionally keep a phrase, add `previous default` somewhere
# in the same file and the check skips it. Add new entries here whenever
# a default flips. Format: `phrase|files|hint`.

declare -a BANNED=(
  "Generated with Gemini (Nano Banana)|apps/web/app/page.tsx|Replace with 'OpenAI gpt-image-2 (default since v0.56)'"
  "Generated 5s video with Grok (native audio)|apps/web/app/page.tsx|Replace with 'fal.ai Seedance 2.0 (default since v0.57)'"
)

for tuple in "${BANNED[@]}"; do
  IFS='|' read -r phrase files hint <<< "$tuple"
  for path in $files; do
    [ -e "$path" ] || continue
    if grep -qF -- "$phrase" "$path"; then
      # Allow if the file marks it as a previous default
      if ! grep -q "previous default" "$path"; then
        err "Stale default reference '${phrase}' in ${path}. ${hint}"
      fi
    fi
  done
done

# ── Report ──────────────────────────────────────────────────────────────

if [ ${#ERRORS[@]} -gt 0 ]; then
  echo "SSOT sync drift detected:" >&2
  for e in "${ERRORS[@]}"; do
    echo "  - $e" >&2
  done
  echo "" >&2
  echo "Counts: AI=${AI_PROVIDERS} MCP=${MCP_TOOLS} agent=${AGENT_TOOLS} LLM=${LLM_PROVIDERS}" >&2
  exit 1
fi

echo "All SSOT counts and provider enumeration in sync."
exit 0
