# Scripts

These scripts are kept because they are wired into install, docs generation,
demos, packaging, or contributor maintenance.

## Public / Build

- `install.sh` - public installer; copied into `apps/web/public/install.sh`.
- `install-skills.sh` - project-local Claude Code skill installer linked from
  generated agent guidance.
- `vercel-ignore-build.sh` - Vercel preview-build gate.

## Generated Docs And Counts

- `gen-cli-reference.mts` - regenerates `docs/cli-reference.md`.
- `print-counts.mts` - emits manifest/tool counts for checks and web build
  metadata.
- `print-env-example.mts` - regenerates `.env.example` from provider metadata.
- `sync-counts.sh` - drift checker for provider/count-related metadata.

## Release

- `release-status.sh` - single source of truth for release state: whether the
  current version covers every `feat:`/`fix:` commit on `HEAD`, whether it is
  tagged, and whether `CHANGELOG.md` documents it. Called by
  `pre-push-validate.sh`, `.github/workflows/release-tag.yml`, and
  `.github/workflows/release-drift.yml`. **Do not reimplement version/tag
  comparisons elsewhere** - divergent copies of this logic are what let
  v0.113.25 ship untagged.
- `pre-push-validate.sh` - shared push gate for Claude Code, Codex, and plain
  Git (`.claude/hooks/` and `.githooks/` both delegate here).

## Contributor Helpers

- `dev-setup-wizard.mts` - runs setup against an isolated debug home.
- `scaffold-command.mts` - creates a new CLI command skeleton.
- `scaffold-provider.mts` - creates a new provider skeleton.

## Demos

- `paid-dogfood.mts` - runs the opt-in paid provider acceptance pass.
- `record-vhs.sh` - records the public VHS demos.
- `claude-stream-pretty.mjs` - formats Claude Code stream output for those
  recordings.

Do not add one-off local notes or launch drafts here.
