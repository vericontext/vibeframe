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
pnpm -F @vibeframe/cli exec vitest run       # CLI tests (~256 tests, ~58s)
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

## Adding a New AI Command

VibeFrame has a specific pattern for adding AI commands. Follow these steps:

### 1. Create or extend a command module

Commands live in `packages/cli/src/commands/`. Each module group has its own file:

| File | Commands |
|------|----------|
| `ai-image.ts` | Image generation |
| `ai-video.ts` | Video generation |
| `ai-audio.ts` | Audio (TTS, SFX, music) |
| `ai-edit.ts` | Post-production editing |
| `ai-highlights.ts` | Highlights and auto-shorts |
| `ai-script-pipeline.ts` | Script-to-video pipeline |
| `ai-review.ts` | AI review and auto-fix |
| `ai-analyze.ts` | Media analysis |
| `ai-motion.ts` | Motion graphics |

### 2. Export an execute function

```typescript
// packages/cli/src/commands/ai-example.ts
export interface MyCommandOptions {
  input: string;
  // ...
}

export interface MyCommandResult {
  success: boolean;
  outputPath: string;
}

export async function executeMyCommand(options: MyCommandOptions): Promise<MyCommandResult> {
  // Implementation
}

export function registerMyCommands(ai: Command): void {
  ai.command("my-command")
    .description("Description here")
    .argument("<input>", "Input file")
    .action(async (input, options) => {
      const result = await executeMyCommand({ input, ...options });
    });
}
```

### 3. Register in `ai.ts`

```typescript
// packages/cli/src/commands/ai.ts
import { registerMyCommands } from "./ai-example.js";
registerMyCommands(ai);
```

### 4. Add Agent tool (if applicable)

If the command benefits from natural language invocation, add an Agent tool wrapper:

```typescript
// packages/cli/src/agent/tools/ai.ts
import { executeMyCommand } from "../../commands/ai-example.js";

const myCommandTool: ToolDefinition = {
  name: "ai_my_command",
  description: "...",
  parameters: { /* ... */ }
};
```

### 5. Update documentation

- `CLAUDE.md` - Update tool counts and tables
- `ROADMAP.md` - Mark completed items
- `GUIDE.md` - Add usage examples
- `MODELS.md` - If adding a new AI model/provider

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
