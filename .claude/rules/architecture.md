---
paths:
  - "packages/cli/src/agent/**"
  - "packages/cli/src/commands/**"
  - "packages/cli/src/index.ts"
  - "packages/core/src/**"
  - "packages/ai-providers/src/**"
  - "packages/mcp-server/src/**"
---

# Architecture & Agent Rules

## Package Structure

- **packages/cli** — CLI + Agent mode. Entry: `src/index.ts`. Commands: `src/commands/`. Agent: `src/agent/`.
- **packages/core** — Timeline, effects, FFmpeg export. Zustand + Immer.
- **packages/ai-providers** — Pluggable AI providers. Each in its own directory.
- **packages/mcp-server** — MCP server for Claude Desktop/Cursor. Bundled with esbuild.
- **packages/ui** — Shared React components. **apps/web** — Next.js landing page.

## CLI ↔ Agent Tool Sync

When adding CLI commands, expose as Agent tools if useful for natural language invocation.

**Naming:** `vibe <group> <action>` → `<group>_<action>` (snake_case)

**Pattern:**
1. Extract `execute*()` function in `src/commands/ai-<module>.ts`
2. Create tool in `src/agent/tools/ai-generation.ts` (or `ai-editing.ts`, `ai-pipeline.ts`)
3. Register via `registry.register(def, handler)`

## Agent Invariants

When invoking CLI commands from agent context:

1. Always `--json` for structured output
2. Always `--dry-run` before mutating operations (84 commands support it)
3. Use `vibe schema <command>` to discover parameters — never guess
4. Confirm with user before `pipeline` commands (high cost: $5-$50+)
5. Use `--stdin` for complex options: `echo '{...}' | vibe <cmd> --stdin --json`

## API Cost Tiers

| Tier | Commands | Est. Cost |
|------|----------|-----------|
| Free | `detect *`, `edit silence-cut/noise-reduce/fade`, `schema`, `project`, `timeline` | $0 |
| Low | `analyze *`, `audio transcribe`, `generate image` | $0.01-$0.10 |
| High | `generate video`, `edit image` | $1-$5 |
| Very High | `pipeline *` | $5-$50+ |

## Error Handling

- Use `exitWithError()` from `commands/output.ts` — not `console.error` + `process.exit(1)`
- Use `requireApiKey()` from `utils/api-key.ts` — not manual checks
- Exit codes: 0=success, 2=usage, 3=not-found, 4=auth, 5=api-error, 6=network
- JSON errors go to **stderr**: `{ success, error, code, exitCode, suggestion, retryable }`
