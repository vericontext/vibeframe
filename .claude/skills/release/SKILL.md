---
name: release
description: Bump version across all packages, verify build/lint/tests, and prepare release commit
argument-hint: "<patch|minor|major>"
disable-model-invocation: true
---

Perform a version bump for VibeFrame. The argument MUST be one of: `patch`, `minor`, `major`.

Steps:
1. **Read current version**: `grep '"version"' package.json | head -1`
2. **Bump root**: `npm version $ARGUMENTS --no-git-tag-version`
3. **Bump all packages**: `pnpm -r exec -- npm version $ARGUMENTS --no-git-tag-version`
4. **Read new version**: `grep '"version"' package.json | head -1`
5. **Verify sync**: `grep '"version"' package.json packages/*/package.json apps/*/package.json | cut -d: -f2 | sort -u` — must show exactly 1 version
6. **Build**: `pnpm build` — must pass
7. **Regenerate CLI reference**: `pnpm gen:reference` — auto-syncs `docs/cli-reference.md` to the built CLI surface so the published version always ships up-to-date docs. (Generator has no timestamp; only diffs when actual flags/commands changed.)
8. **Lint**: `pnpm lint` — must pass (0 errors)
9. **Test**: `pnpm -F @vibeframe/cli exec vitest run` — must pass
10. **Generate CHANGELOG**: `git-cliff --tag vX.Y.Z -o CHANGELOG.md` — auto-generate from conventional commits
11. **Stage**: `git add package.json packages/*/package.json apps/*/package.json CHANGELOG.md docs/cli-reference.md`
12. **Commit**: `git commit -m "chore: bump version to X.Y.Z"`
13. **Tag**: `git tag vX.Y.Z`

Report the new version number. Do NOT push — the user will push when ready.

When the user pushes the tag, `.github/workflows/publish.yml` runs
automatically: it republishes both packages to npm and (since v0.82)
creates the GitHub Release with the matching CHANGELOG section as the
body. No manual Release-page edit needed.
