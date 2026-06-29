# AGENTS.md

VibeFrame is an AI-native video editing toolkit: CLI-first, MCP-ready, and
designed for agentic video workflows.

## Repository Shape

Monorepo: Turborepo + pnpm workspaces. ESM. TypeScript strict mode.

Packages:

- `packages/cli` - CLI, built-in agent mode, command implementations.
- `packages/core` - Timeline/project primitives and FFmpeg-oriented editing model.
- `packages/ai-providers` - Provider registry and provider implementations.
- `packages/mcp-server` - MCP wrapper around the CLI, bundled with esbuild.
- `packages/ui` - Shared React components.
- `apps/web` - Next.js public site.

Architecture:

```text
CLI (Commander.js + Agent) -> Engine (Project state) -> Core (Zustand + FFmpeg) -> AI Providers
```

## Commands

```bash
pnpm install && pnpm build    # Setup
pnpm test                     # Run all tests
pnpm lint                     # Lint (0 errors policy)
pnpm -F @vibeframe/cli test   # Single package
```

Use `vibe schema --list` and `vibe schema <command>` as the source of truth for
CLI command availability and parameters.

## CLI Shape

Canonical user-facing workflows:

- Project video flow: `init`, `plan`, `build`, `render` (edit beats with
  `storyboard`, poll async work with `status`)
- One-shot media: `generate`, `edit`, `inspect`, `audio`, `remix`
- Automation: `run`, `agent`, `schema`, `context`, `guide`
- Setup & hosts: `setup`, `doctor`, `host`
- Lower-level operations: `scene`, `timeline`, `detect`, `batch`, `media`

Do not introduce docs, examples, or agent instructions that use removed
namespaces such as `vibe ai`, `vibe project`, `vibe export`, or `vibe pipeline`.

## Agent Workflow Rules

When invoking VibeFrame commands from an agent context:

- Treat your host's agent loop (Claude Code, Codex, Cursor, or another
  coding-agent host) as the outer loop for long-running video work.
  VibeFrame should provide video-specific commands, JSON reports, cost gates,
  deterministic repair, render inspection, and `nextActions`/`fixOwner`
  recovery contracts, not a competing primary agent loop.
- Prefer `--json` for structured output.
- Run `--dry-run` before paid or mutating operations when the command supports it.
- When a review report includes `nextActions`, prefer it over inventing
  commands: run only `safeToAutoRun:true` actions automatically, ask before
  `requiresConfirmation:true`, and treat `retryWith` as the compatibility
  fallback.
- Use `vibe schema <command>` before constructing non-trivial arguments.
- Confirm with the user before high/very-high cost operations such as
  `generate video`, `edit fill-gaps`, and provider-backed `remix` workflows.
- Use `--stdin` for complex option payloads instead of fragile shell quoting.

Provider assets are inputs, not always the final product. For factual,
data-heavy, or typography-heavy videos, prefer deterministic HTML/CSS/JS
composition for text, layout, motion, timing, and reviewability.

## CLI And Tool Sync

When adding CLI commands, expose them as agent tools only when natural-language
invocation is useful.

Naming: `vibe <group> <action>` maps to `<group>_<action>` in snake_case.

Pattern:

1. Extract a testable `execute*()` function from the command module.
2. Reuse the same executor from CLI, YAML pipeline, and agent/MCP wrappers where practical.
3. Register an agent tool with a schema that matches the CLI behavior.
4. Add focused tests for the executor and wrapper.

## Cost Awareness

Do not maintain a separate hardcoded cost table in docs or prompts. The CLI
stamps cost tiers on commands; use:

```bash
vibe schema --list
vibe schema --list --filter free
vibe schema generate.video
```

General expectation:

- Free/local: schema, setup/doctor, timeline/batch/detect/media, many FFmpeg edits.
- Low: speech, transcription, inspection, simple AI-assisted edits.
- High: image generation, storyboard/motion generation.
- Very high: video generation and expensive provider-backed transforms.

## Code Quality

- Run `pnpm build` after TypeScript changes.
- Run `pnpm lint` after changes and fix errors before committing.
- Do not leave unused imports.
- Do not suppress lint with `// eslint-disable` or `@ts-ignore`; fix the root cause.
- Use `exitWithError()` from `commands/output.ts` for structured errors.
- Use `requireApiKey()` from `utils/api-key.ts` for required API keys.
- Use `hasApiKey()` for side-effect-free key detection.
- Use `resolveProvider()` / provider registry helpers instead of duplicating fallback logic.

## Conventions

- Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`.
- Git & PR workflow: branch off `main` as `feat/<topic>`, `fix/<topic>`, or
  `chore/<topic>`. **One PR = one coherent scope** — do not stack unrelated
  commits onto an open PR branch. Rebase/split when scope drifts.
- **Every commit reaches `main` via a PR — including `chore: bump version`
  release commits.** Branch → PR → CI green → merge. Do **not** push directly to
  `main`, even as a maintainer with admin bypass (`main` allows it, but the
  policy does not). Release bumps go on a `chore/release-<version>` (or the
  feature) branch and merge through the same gate as any other change.
- Version bumps default to `patch` during `0.x`, including most ordinary
  `feat:` and `fix:` commits. **`patch` is the default; `minor` is rare.** Use
  `minor` only for new public CLI command namespaces, new MCP tool families,
  public API contract additions, or large product milestones; reserve `major`
  for breaking changes or the 1.0 milestone. The shared push gate
  (`scripts/pre-push-validate.sh`) **blocks** a `minor`/`major` bump unless the
  `chore: bump version` commit carries a `Release-Type: minor: <reason>` (or
  `major`) trailer, or `VIBE_ALLOW_MINOR=1` is set.
- API keys belong in local config or `.env`-style files, never committed.
- See `MODELS.md` for provider details.
- `CHANGELOG.md` is generated with `git-cliff --tag vX.Y.Z -o CHANGELOG.md`.
- CI never publishes npm packages. After a version commit lands on `main` and
  CI passes, manually create the release tag and manually run the publish
  workflow for that tag.

## Verification

Match verification to the change:

- TypeScript or command behavior: run `pnpm build`, `pnpm lint`, and focused tests.
- CLI schema/reference changes: run `pnpm gen:reference:check` when relevant.
- Scene/video work: run `vibe scene lint`, `vibe render`, and `vibe inspect render --cheap`.

Before pushing from any host, run the shared pre-push gate or enable the repo
Git hook:

```bash
pnpm hooks:install
bash scripts/pre-push-validate.sh
```

Claude Code's `.claude/hooks/pre-push-validate.sh` and Git's
`.githooks/pre-push` both delegate to `scripts/pre-push-validate.sh`, so Codex,
Claude Code, and direct terminal pushes use the same version/SSOT checks.

## Agent Hosts & Sync

VibeFrame configures three hosts (Claude Code, Codex, Cursor) from one canonical
source. Full map + workflows: `docs/agent-hosts.md`.

- **Canonical (edit these):** `AGENTS.md` (this file — Codex/Cursor read it
  natively; Claude imports it via `CLAUDE.md` = `@AGENTS.md`) and cross-host
  skills in `.agents/skills/<name>/SKILL.md`.
- **Generated by `pnpm agent-sync` (never edit; marked DO NOT EDIT):**
  `.claude/skills/*`, the MCP block in `.codex/config.toml`, and
  `mcpServers.vibeframe` in `.cursor/mcp.json`.
- **Claude-only, NOT propagated to Codex/Cursor:** `.claude/rules/*`
  (path-scoped), `.claude/agents/*`, `.claude/hooks/*`, `.claude/settings.json`.
- **Where new guidance goes:** shared rules → `AGENTS.md` or `.agents/skills/`;
  Claude-only ergonomics → `.claude/`. Keep this file lean (it loads into every
  session and is read by every host).
- **Enforced:** `pnpm agent-sync:check` runs in the pre-push gate and CI. After
  editing a canonical source, run `pnpm agent-sync` and commit the result.
