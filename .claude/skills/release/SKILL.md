---
name: release
description: Bump version across all packages, verify build/lint/tests, and prepare the version commit
argument-hint: "<patch|minor|major>"
disable-model-invocation: true
---

Perform a version bump for VibeFrame. The argument MUST be one of: `patch`, `minor`, `major`.

Steps:
1. **Read current version**: `jq -r '.version' package.json`
2. **Bump root**: `npm version $ARGUMENTS --no-git-tag-version`
3. **Read new version**: `NEW_VERSION=$(jq -r '.version' package.json)`
4. **Set all packages to the exact new version**: `for dir in packages/cli packages/core packages/ai-providers packages/mcp-server packages/ui apps/web; do (cd "$dir" && npm version "$NEW_VERSION" --no-git-tag-version); done`
5. **Verify sync**: `for f in package.json packages/*/package.json apps/*/package.json; do jq -r '.version' "$f"; done | sort -u` — must show exactly 1 version
6. **Build**: `pnpm build` — must pass
7. **Regenerate CLI reference**: `pnpm gen:reference` — auto-syncs `docs/cli-reference.md` to the built CLI surface so the published version always ships up-to-date docs. (Generator has no timestamp; only diffs when actual flags/commands changed.)
8. **Lint**: `pnpm lint` — must pass (0 errors)
9. **Test**: `pnpm -F @vibeframe/cli exec vitest run --bail 1` — must pass; `--bail 1` stops at the first failure so a broken test surfaces fast during a release
10. **Generate CHANGELOG**: `git-cliff --tag vX.Y.Z -o CHANGELOG.md` — auto-generate from conventional commits
11. **Stage**: `git add package.json packages/*/package.json apps/*/package.json CHANGELOG.md docs/cli-reference.md`
12. **Commit**: `git commit -m "chore: bump version to X.Y.Z"`

Report the new version number. Do NOT create a local tag. Do NOT push unless
the user explicitly asks.

When the version commit lands on `main`, `.github/workflows/auto-tag.yml`
creates `vX.Y.Z` and dispatches `.github/workflows/publish.yml`. The publish
workflow republishes both packages to npm and creates the GitHub Release with
the matching CHANGELOG section as the body. No manual Release-page edit needed
unless the publish workflow fails.
