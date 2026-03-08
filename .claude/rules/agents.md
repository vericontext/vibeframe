---
description: Invariant rules for AI agents invoking VibeFrame CLI commands
globs:
  - "packages/cli/src/agent/**"
  - "packages/mcp-server/src/**"
---

# Agent Invariants for VibeFrame CLI

> Rules that AI agents (Claude Code, Cursor, MCP clients) **must** follow when invoking VibeFrame CLI commands.

## Core Invariants

1. **Always use `--json` for structured output.** Parse JSON results instead of scraping human-readable text. All commands support `--json` as a global flag.

2. **Always use `--dry-run` before mutating operations.** Preview what will happen (API calls, FFmpeg commands, files written) before committing. Available on `generate`, `edit`, and `pipeline` commands.

3. **Use `vibe schema <command>` to discover parameters.** Never guess option names or types — introspect the schema first.
   ```bash
   vibe schema generate.image    # Show JSON Schema for generate image
   vibe schema edit.caption      # Show JSON Schema for edit caption
   ```

4. **Confirm with user before `pipeline` commands.** Pipeline commands (`script-to-video`, `highlights`, `auto-shorts`, `viral`, `narrate`) involve multiple API calls and may incur significant costs.

5. **Validate file paths.** All file arguments must be within the working directory. Never pass absolute paths outside the project root.

6. **Use `--fields` to limit response size** (when available on `analyze` commands). Reduces token usage when only specific fields are needed.

## Command Patterns

### Safe (read-only, no cost)
```bash
vibe schema <command>              # Introspect command schema
vibe detect scenes <video>         # Local FFmpeg analysis
vibe detect silence <media>        # Local FFmpeg analysis
vibe timeline list <project>       # Read project state
vibe project info <project>        # Read project state
vibe setup --show                  # Show API key status
```

### Moderate (API cost, reversible)
```bash
vibe analyze media <source> "<prompt>" --json
vibe analyze video <video> "<prompt>" --json
vibe audio transcribe <audio> --json
```

### Expensive (API cost, generates assets)
```bash
vibe generate image "<prompt>" --dry-run --json     # Preview first
vibe generate video "<prompt>" --dry-run --json     # Preview first
vibe generate speech "<text>" --dry-run --json      # Preview first
vibe pipeline script-to-video "<script>" --dry-run  # Always preview first
```

## Error Handling

- **Exit code 0**: Success. Parse `--json` output for result.
- **Exit code 1**: Failure. Error message in stderr.
- **Missing API key**: Commands fail fast with clear error messages indicating which env var to set.

## Environment

Required API keys are documented in `MODELS.md` and can be checked with:
```bash
vibe setup --show
```
