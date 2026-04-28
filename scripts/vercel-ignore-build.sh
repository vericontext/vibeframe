#!/usr/bin/env bash
#
# scripts/vercel-ignore-build.sh — Vercel "Ignored Build Step"
#
# Skips Vercel preview builds when the PR doesn't touch anything the
# landing page consumes. Production (main) ALWAYS builds for safety.
#
# Wired up via vercel.json:
#   { "ignoreCommand": "bash scripts/vercel-ignore-build.sh" }
#
# Vercel exit semantics:
#   exit 0 → skip the build
#   exit 1 → proceed with the build
#
# Trade-off: if a CLI-only PR adds a new command, the landing's
# auto-counted NEXT_PUBLIC_CLI_COMMANDS won't update on the preview.
# That's fine — the next merge to main triggers a production build
# (which we always run) and counts catch up there.

set -e

# Run from repo root regardless of where Vercel invokes this from.
cd "$(git rev-parse --show-toplevel)" || exit 1

# 1. Production / main always builds. Removes any risk of a missed
#    landing-page update reaching prod.
if [[ "$VERCEL_GIT_COMMIT_REF" == "main" ]]; then
    echo "🔄 main branch — always build"
    exit 1
fi

# 2. First commit or shallow clone safety net.
if ! git rev-parse HEAD^ >/dev/null 2>&1; then
    echo "⚠  No HEAD^ — building (first commit or shallow clone)"
    exit 1
fi

# 3. Paths that affect the landing build output.
#
# Direct Next.js app + workspace deps it imports:
#   apps/web, packages/ui, packages/core
#
# CLI/MCP/provider source files that next.config.js auto-counts into
# NEXT_PUBLIC_CLI_COMMANDS / _MCP_TOOLS / _AGENT_TOOLS /
# _LLM_PROVIDERS / _AI_PROVIDERS:
#   packages/cli/src/agent/tools
#   packages/cli/src/agent/types.ts
#   packages/cli/src/commands
#   packages/mcp-server/src/tools
#   packages/ai-providers/src
#
# Root manifests + the install.sh that the prebuild script copies into
# apps/web/public/install.sh:
#   package.json, pnpm-lock.yaml, scripts/install.sh, vercel.json
PATHS=(
    apps/web
    packages/ui
    packages/core
    packages/cli/src/agent/tools
    packages/cli/src/agent/types.ts
    packages/cli/src/commands
    packages/mcp-server/src/tools
    packages/ai-providers/src
    scripts/install.sh
    package.json
    pnpm-lock.yaml
    vercel.json
)

if git diff --quiet HEAD^ HEAD -- "${PATHS[@]}"; then
    echo "🤫 No web-relevant changes — skip build"
    echo "   (compared $(git rev-parse --short HEAD^) → $(git rev-parse --short HEAD) against:"
    printf "     %s\n" "${PATHS[@]}"
    echo "   )"
    exit 0
else
    echo "🔄 Web-relevant changes — build"
    echo "   Files touched:"
    git diff --name-only HEAD^ HEAD -- "${PATHS[@]}" | sed 's/^/     /'
    exit 1
fi
