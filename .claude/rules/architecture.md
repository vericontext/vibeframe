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

- **packages/cli** - CLI, built-in agent mode, command implementations.
  Entry: `src/index.ts`.
- **packages/core** - Timeline/project primitives and FFmpeg-oriented editing
  model.
- **packages/ai-providers** - Provider registry and provider implementations.
- **packages/mcp-server** - MCP wrapper around the CLI, bundled with esbuild.
- **packages/ui** - Shared React components.
- **apps/web** - Next.js public site.

## Current CLI Shape

The canonical user-facing workflow commands are:

- Project video flow: `init`, `plan`, `build`, `render` (edit beats with
  `storyboard`, poll async work with `status`)
- One-shot media: `generate`, `edit`, `inspect`, `audio`, `remix`
- Automation: `run`, `agent`, `schema`, `context`, `guide`
- Setup & hosts: `setup`, `doctor`, `host`
- Lower-level operations: `scene`, `timeline`, `detect`, `batch`, `media`

Do not introduce new docs or agent instructions that use removed namespaces such
as `vibe ai`, `vibe project`, `vibe export`, or `vibe pipeline`.

Use `vibe schema --list` and `vibe schema <command>` as the source of truth for
command availability and parameters.

## CLI <-> Agent Tool Sync

When adding CLI commands, expose them as agent tools only when natural-language
invocation is useful.

Naming: `vibe <group> <action>` -> `<group>_<action>` in snake_case.

Pattern:

1. Extract a testable `execute*()` function from the command module.
2. Reuse the same executor from CLI, YAML pipeline, and agent/MCP wrappers where
   practical.
3. Register an agent tool with a schema that matches the CLI command's behavior.
4. Add focused tests for the executor and wrapper.

## Agent Invariants

When invoking CLI commands from agent context:

1. Prefer `--json` for structured output.
2. Run `--dry-run` before paid or mutating operations when the command supports
   it.
3. Use `vibe schema <command>` before constructing non-trivial arguments.
4. Confirm with the user before high/very-high cost operations such as
   `generate video`, `edit fill-gaps`, and provider-backed `remix` workflows.
5. Use `--stdin` for complex option payloads instead of fragile shell quoting.

## Cost Awareness

Do not maintain a separate hardcoded cost table in docs or agent prompts. The
CLI stamps cost tiers on commands; use:

```bash
vibe schema --list
vibe schema --list --filter free
vibe schema generate.video
```

General expectation:

- Free/local: schema, setup/doctor, timeline/batch/detect/media, many FFmpeg
  edits.
- Low: speech, transcription, inspection, simple AI-assisted edits.
- High: image generation, storyboard/motion generation.
- Very high: video generation and expensive provider-backed transforms.

## Error Handling

- Use `exitWithError()` from `commands/output.ts`; do not pair
  `console.error` with `process.exit(1)`.
- Use `requireApiKey()` for required API keys and `hasApiKey()` for
  side-effect-free detection.
- Use `resolveProvider()` / provider registry helpers instead of duplicating
  provider fallback logic.
- JSON errors go to stderr in the structured error envelope.
