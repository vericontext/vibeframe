# Contributing to VibeFrame

Thank you for your interest in contributing to VibeFrame! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please be respectful and considerate of others. We want to foster an inclusive and welcoming community.

## Prerequisites

- **Node.js** >= 18
- **pnpm** >= 9 (`corepack enable && corepack prepare pnpm@9.0.0 --activate`)
- **FFmpeg** (required for video/audio commands): `brew install ffmpeg` (macOS) or see [ffmpeg.org](https://ffmpeg.org/download.html)
- **API keys** (optional, only for AI features you're working on): Copy `.env.example` to `.env` and fill in relevant keys. See [MODELS.md](MODELS.md) for which commands need which keys.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/vibeframe.git`
3. Install dependencies: `pnpm install`
4. Build all packages: `pnpm build`
5. Run tests to verify: `pnpm -F @vibeframe/cli exec vitest run`
6. Create a new branch: `git checkout -b feature/your-feature-name`

## Package Structure

| Package | Path | Description |
|---------|------|-------------|
| `@vibeframe/cli` | `packages/cli` | Main CLI interface (Commander.js + Agent) |
| `@vibeframe/core` | `packages/core` | Timeline data structures, effects, FFmpeg export |
| `@vibeframe/ai-providers` | `packages/ai-providers` | Pluggable AI provider integrations |
| `@vibeframe/mcp-server` | `packages/mcp-server` | MCP server for Claude Desktop/Cursor |
| `@vibeframe/ui` | `packages/ui` | Shared React components (Radix UI + Tailwind) |
| `@vibeframe/web` | `apps/web` | Next.js preview UI |

## Running Tests

```bash
# All tests (note: default vitest runs in watch mode)
pnpm -F @vibeframe/cli exec vitest run       # CLI tests (~232 tests, ~58s)
pnpm -F @vibeframe/core exec vitest run       # Core tests (~8 tests, <1s)

# With coverage
pnpm -F @vibeframe/cli exec vitest run --coverage

# Specific test file
pnpm -F @vibeframe/cli exec vitest run src/commands/__tests__/ai.test.ts

# All packages via turbo (runs in watch mode - press q to exit)
pnpm test
```

## Development Workflow

1. Make your changes in a feature branch
2. Write tests for new functionality
3. Ensure all tests pass: `pnpm -F @vibeframe/cli exec vitest run`
4. Ensure code is properly formatted: `pnpm format`
5. Ensure linting passes: `pnpm lint`
6. Build to check TypeScript: `pnpm build`
7. Commit your changes with a conventional commit message
8. Push to your fork and submit a Pull Request

## Adding a New AI Provider

Post-v0.68 (Plan G Phase 1) the provider plugin pattern collapses what used to be **8 file edits** into **1–2 declarations**. The CLI's provider-resolver, config schema, doctor, setup wizard, and `.env.example` all derive from a single registry, so adding a provider auto-propagates.

### Quickest path: scaffold

```bash
pnpm scaffold:provider <name>      # e.g. pnpm scaffold:provider stability
```

This creates `packages/ai-providers/src/<name>/` with a stub `<Name>Provider.ts` (implements `AIProvider` interface) + `index.ts` (calls `defineProvider({...})`), and adds the re-export line to `packages/ai-providers/src/index.ts`.

### Then fill in the metadata

1. **`packages/ai-providers/src/<name>/<Name>Provider.ts`** — implement the methods you need from the `AIProvider` interface. The base contract is in `packages/ai-providers/src/interface/types.ts`. Common methods: `initialize`, `isConfigured`, `generateImage`, `generateVideo`, `transcribe`.

2. **`packages/ai-providers/src/<name>/index.ts`** — fill in the `defineProvider({...})` block:
   - `apiKey`: reference an existing configKey from `api-keys.ts` (e.g. `"openai"`, `"google"`), or set to `null` if your provider runs locally.
   - `kinds`: array of `"image" | "video" | "speech" | "llm" | "transcription" | "music"`.
   - `commandsUnlocked`: list of CLI command strings shown in `vibe doctor`.
   - `resolverPriority` (optional): `{ image: 4 }` — lower = higher priority.

3. **(If new credential)** Add a `defineApiKey({...})` block to `packages/ai-providers/src/api-keys.ts` with the configKey, envVar, label, setup wizard description, and `.env.example` comment/URL. Skip this step if your provider shares an existing apiKey (e.g. another OpenAI service uses the existing `"openai"` configKey).

### Verify

```bash
pnpm -F @vibeframe/ai-providers build   # compile the new provider class
pnpm -r exec tsc --noEmit               # 0 errors
pnpm -F @vibeframe/cli test             # snapshot tests catch resolver drift
bash scripts/sync-counts.sh --check     # verifies .env.example regen
```

`vibe doctor --json` should show your new provider under `result.providers`. The setup wizard (`vibe setup --full`) prompts for the apiKey if `showInSetup: true`.

That's it. No need to edit `provider-resolver.ts`, `schema.ts`, `doctor.ts`, `setup.ts`, or `.env.example` — the registry derives them all.

## Adding a New CLI Subcommand

Each `vibe <group> <name>` command is a self-contained file. Post-v0.69 (Plan G Phase 2/3), `generate.ts` and `ai-edit.ts` are barrels that call register functions from per-subcommand files.

### Quickest path: scaffold

```bash
pnpm scaffold:command <group> <name>        # e.g. pnpm scaffold:command generate my-feature
```

Supported groups: `generate`, `edit`.

For `generate`: creates `packages/cli/src/commands/generate/<name>.ts` and adds the `register*Command(generateCommand)` call to `commands/generate.ts`.

For `edit`: creates `packages/cli/src/commands/_shared/edit/<name>.ts` and adds re-exports to the `ai-edit.ts` barrel.

### Then fill in the logic

Each scaffolded file contains:
- `XxxOptions` and `XxxResult` interfaces — define the shape of inputs/outputs.
- `executeXxx(options)` — pure function returning `{ success, ... }`. Used by the manifest layer (MCP/Agent) and the CLI handler.
- `registerXxxCommand(parent)` — wraps `executeXxx` in a Commander chain with options, action handler, JSON-mode output, etc.

The split makes new contributions a single file edit. The CLI surface auto-updates because the parent group file already registers the new command.

### Optional: expose to MCP/Agent

If the command should be available as an MCP tool or agent tool, add a `defineTool({...})` entry to the appropriate `packages/cli/src/tools/manifest/<group>.ts`. The manifest is the single source of truth for both surfaces — see `packages/cli/src/tools/define-tool.ts` for the schema.

### Verify

```bash
pnpm -F @vibeframe/cli build
node packages/cli/dist/index.js <group> <name> --help
pnpm -F @vibeframe/cli test
```

### 5. Update documentation (when changing user-visible surface)

- `CLAUDE.md` — tool counts and tables
- `ROADMAP.md` — mark completed items
- `MODELS.md` — if adding a new AI model/provider

## Commit Message Guidelines

We follow [conventional commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc.)
- `refactor:` Code refactoring
- `test:` Adding or updating tests
- `chore:` Maintenance tasks

Example: `feat: add fade in effect to timeline clips`

## Pull Request Guidelines

- Provide a clear description of the changes
- Reference any related issues
- Include screenshots for UI changes
- Ensure CI passes
- Request review from maintainers

## Architecture Notes

- **Monorepo**: Turborepo + pnpm workspaces. Use `workspace:*` for internal deps.
- **ESM**: All packages use ES modules.
- **TypeScript**: Strict mode. Run `pnpm build` to compile.
- **Time units**: All times in seconds (floats allowed).
- **IDs**: `source-{id}`, `clip-{id}`, `track-{id}`, `effect-{id}`.
- **Project files**: `.vibe.json` stores project state.

## Questions?

Feel free to open an issue for any questions or discussions.
