---
description: Version management and documentation update rules
globs:
  - "package.json"
  - "packages/*/package.json"
  - "apps/*/package.json"
---

# Version Management

All packages share the same version number. Update versions when making significant changes:

**When to bump versions:**
- `patch` (0.1.0 → 0.1.1): Bug fixes, minor improvements
- `minor` (0.1.0 → 0.2.0): New features, new commands
- `major` (0.1.0 → 1.0.0): Breaking changes, major milestones

**Auto-bump rule for Claude Code:**
After committing `feat:` or `fix:` changes, bump the version before pushing:
- `fix:` commits → bump `patch`
- `feat:` commits → bump `minor`
- Multiple commits in one session → bump once based on highest level (feat > fix)

**How to update:**
```bash
# IMPORTANT: pnpm -r exec only updates packages/*, NOT root package.json
# You must run BOTH commands to keep versions in sync:

# Step 1: Update root package.json
npm version patch --no-git-tag-version
# or: minor, major

# Step 2: Update all workspace packages to match
pnpm -r exec -- npm version patch --no-git-tag-version

# Step 3: Verify all versions match
grep '"version"' package.json packages/*/package.json apps/*/package.json

# Step 4: Commit (exclude test/temp files)
git add package.json packages/*/package.json apps/*/package.json
git commit -m "chore: bump version to X.Y.Z"
git tag vX.Y.Z
```

**Common pitfall:** Running only `pnpm -r exec` will update workspace packages but NOT the root `package.json`, causing version mismatch. Always run both commands.

**Files to update (must all have same version):**
- `package.json` (root) — Often forgotten!
- `packages/cli/package.json`
- `packages/core/package.json`
- `packages/ai-providers/package.json`
- `packages/mcp-server/package.json`
- `packages/ui/package.json`
- `apps/web/package.json`

**Current version:** Check with `grep '"version"' package.json | head -1`

**Verify sync:** `grep '"version"' package.json packages/*/package.json apps/*/package.json | cut -d: -f2 | sort -u` should show only ONE version

## SSOT Sync Checklist (before push)

A `PreToolUse` hook (`.claude/hooks/pre-push-validate.sh`) automatically validates before `git push`. Manual checks:

1. **Version**: `grep '"version"' package.json packages/*/package.json apps/*/package.json | cut -d: -f2 | sort -u` → should show only 1 version
2. **Model IDs**: `grep -rn "claude-opus-4-5\|claude-sonnet-4-20\|kling-v1" .claude/skills/` → should return nothing
3. **Landing page**: `apps/web/app/page.tsx` version badge, tool counts match actual
4. **README.md**: test count, provider count, CLI command list are current

> Use `version-checker` agent for comprehensive automated report, or `/sync-check` for quick inline check.

## Documentation

Root-level docs:

| File | Purpose |
|------|---------|
| `README.md` | Public-facing intro, quick start, MCP setup |
| `CLAUDE.md` | Developer guidance for Claude Code |
| `ROADMAP.md` | Feature roadmap with `[x]` completion tracking |
| `MODELS.md` | AI model SSOT (Single Source of Truth) |

## Update Rules

After completing any feature or fix, update:

1. **`ROADMAP.md`** - Mark completed items with `[x]`, add new CLI commands to status section
2. **`MODELS.md`** - Update when adding/changing AI providers or models (SSOT — never duplicate model tables elsewhere)
3. **`README.md`** - Keep tool counts, test counts, feature highlights in sync
4. **`apps/web/app/page.tsx`** - Keep version badge and feature counts in sync
