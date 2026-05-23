---
paths:
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

**Quick bump:** Use `/release patch`, `/release minor`, or `/release major` skill to automate the full workflow.

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
for f in package.json packages/*/package.json apps/*/package.json; do jq -r '.version' "$f"; done | sort -u

# Step 4: Rebuild — embeds the new version into packages/cli/dist
pnpm -F @vibeframe/cli build

# Step 5: Regenerate CLI reference AFTER the rebuild
# `gen:reference` runs the dist binary and embeds `vibe --version` in
# the file. If you skip Step 4, the regen reads the OLD version from
# the stale dist and CI's `gen:reference:check` fails on the next
# release because CI's fresh build embeds the NEW version.
pnpm gen:reference
pnpm gen:reference:check  # must pass before commit

# Step 6: Commit (exclude test/temp files)
git add package.json packages/*/package.json apps/*/package.json CHANGELOG.md docs/cli-reference.md
git commit -m "chore: bump version to X.Y.Z"
```

Do not create a local release tag in normal development. After the version
commit lands on `main`, `.github/workflows/auto-tag.yml` creates `vX.Y.Z` and
dispatches `.github/workflows/publish.yml`.

**Common pitfalls:**
- Running only `pnpm -r exec` will update workspace packages but NOT the root `package.json`, causing version mismatch. Always run both commands.
- Regenerating `docs/cli-reference.md` BEFORE rebuilding produces a file pinned to the old version. CI rebuilds before checking, so `gen:reference:check` fails. Always: bump → rebuild → regen → check → commit.
- Prefer the `/release` skill, which performs all version-commit steps in the
  correct order.

**Files to update (must all have same version):**

- `package.json` (root) — Often forgotten!
- `packages/cli/package.json`
- `packages/core/package.json`
- `packages/ai-providers/package.json`
- `packages/mcp-server/package.json`
- `packages/ui/package.json`
- `apps/web/package.json`

**Current version:** Check with `jq -r '.version' package.json`

**Verify sync:** `for f in package.json packages/*/package.json apps/*/package.json; do jq -r '.version' "$f"; done | sort -u` should show only ONE version

## SSOT Sync Checklist (before push)

The shared gate lives at `scripts/pre-push-validate.sh`. Claude Code calls it
through `.claude/hooks/pre-push-validate.sh`; regular Git/Codex pushes call it
through `.githooks/pre-push` after:

```bash
pnpm hooks:install
```

Manual checks:

1. **Version**: `for f in package.json packages/*/package.json apps/*/package.json; do jq -r '.version' "$f"; done | sort -u` → should show only 1 version
2. **Landing page**: `apps/web/app/page.tsx` version badge, tool counts match actual
3. **README.md**: test count, provider count, CLI command list are current

> Use `version-checker` agent for comprehensive automated report, or `/sync-check` for quick inline check.

## Documentation

Root-level docs:

| File         | Purpose                                          |
| ------------ | ------------------------------------------------ |
| `README.md`  | Public-facing intro, quick start, MCP setup      |
| `CLAUDE.md`  | Developer guidance for Claude Code               |
| `ROADMAP.md` | Public roadmap: Now / Next / Later / Not Planned |
| `MODELS.md`  | AI model SSOT (Single Source of Truth)           |

## Update Rules

After completing any feature or fix, update:

1. **`ROADMAP.md`** - Keep public roadmap categories current; avoid internal implementation logs
2. **`MODELS.md`** - Update when adding/changing AI providers or models (SSOT — never duplicate model tables elsewhere)
3. **`README.md`** - Keep tool counts, test counts, feature highlights in sync
4. **`apps/web/app/page.tsx`** - Keep version badge and feature counts in sync
