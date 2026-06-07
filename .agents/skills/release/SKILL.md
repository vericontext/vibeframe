---
name: release
description: Bump VibeFrame versions, regenerate release artifacts, run verification, and prepare a version commit.
---

# Release

Use this skill when the user asks Codex to run a VibeFrame release bump or fix a
missing version bump after `feat:` / `fix:` commits.

The requested bump must be one of: `patch`, `minor`, or `major`.

## Steps

1. Read the current root version:

   ```bash
   jq -r '.version' package.json
   ```

2. Bump the root package:

   ```bash
   npm version <patch|minor|major> --no-git-tag-version
   ```

3. Read the exact new version:

   ```bash
   NEW_VERSION=$(jq -r '.version' package.json)
   ```

4. Set every workspace package to that exact version. Do not use `pnpm -r exec
   npm version` for this step because recursive pnpm includes the root package.

   ```bash
   for dir in packages/cli packages/core packages/ai-providers packages/mcp-server packages/ui apps/web; do
     (cd "$dir" && npm version "$NEW_VERSION" --no-git-tag-version)
   done
   ```

5. Verify all package versions match:

   ```bash
   for f in package.json packages/*/package.json apps/*/package.json; do
     jq -r '.version' "$f"
   done | sort -u
   ```

   The output must contain exactly one version.

6. Build, regenerate references, lint, and test:

   ```bash
   pnpm build
   pnpm gen:reference
   pnpm lint
   pnpm -F @vibeframe/cli exec vitest run --bail 1
   ```

7. Generate the changelog for the new version:

   ```bash
   git-cliff --tag v$NEW_VERSION -o CHANGELOG.md
   ```

8. Run the shared push gate:

   ```bash
   bash scripts/pre-push-validate.sh
   ```

9. Stage the release files:

   ```bash
   git add package.json packages/*/package.json apps/*/package.json CHANGELOG.md docs/cli-reference.md scripts/pre-push-validate.sh
   ```

10. Commit:

   ```bash
   git commit -m "chore: bump version to $NEW_VERSION"
   ```

Do not create a local tag. Do not push unless the user explicitly asks.

When the version commit lands on `main`, `.github/workflows/auto-tag.yml`
creates the matching `vX.Y.Z` tag and dispatches `.github/workflows/publish.yml`.
