---
paths:
  - "packages/cli/src/agent/**"
  - "packages/mcp-server/src/**"
---

# Agent Invariants for VibeFrame CLI

> Rules that AI agents (Claude Code, Cursor, MCP clients) **must** follow when invoking VibeFrame CLI commands.

## Core Invariants

1. **Always use `--json` for structured output.** Parse JSON results instead of scraping human-readable text. All commands support `--json` as a global flag.

2. **Always use `--dry-run` before mutating operations.** Preview what will happen (API calls, FFmpeg commands, files written) before committing. Available on `generate`, `edit`, `pipeline`, `audio`, `export`, `batch`, `timeline`, `project`, and `detect` commands.

3. **Use `vibe schema <command>` to discover parameters.** Never guess option names or types — introspect the schema first.
   ```bash
   vibe schema generate.image    # Show JSON Schema for generate image
   vibe schema edit.caption      # Show JSON Schema for edit caption
   vibe schema --list            # List all available commands
   ```

4. **Confirm with user before `pipeline` commands.** Pipeline commands (`script-to-video`, `highlights`, `auto-shorts`) involve multiple API calls and may incur significant costs.

5. **Validate file paths.** Relative paths must stay within the working directory. Absolute paths are allowed for explicit user intent.

6. **Use `--fields` to limit response size.** Reduces token usage when only specific fields are needed.

7. **Use `--stdin` for complex options.** Pipe JSON instead of constructing 15+ CLI flags:
   ```bash
   echo '{"provider":"kling","duration":5,"ratio":"9:16"}' | vibe generate video "prompt" --stdin --json
   ```

## Resource Limits

### API Cost Awareness

| Tier | Commands | Est. Cost/Call |
|------|----------|----------------|
| Free | `detect *`, `edit silence-cut/noise-reduce/fade`, `schema`, `project`, `timeline` | $0 (local FFmpeg) |
| Low | `analyze media/video`, `audio transcribe`, `generate image` | $0.01-$0.10 |
| Medium | `generate speech/music/sound-effect`, `edit caption/grade/reframe` | $0.10-$1.00 |
| High | `generate video`, `edit image` | $1.00-$5.00 |
| Very High | `pipeline script-to-video`, `pipeline highlights`, `pipeline auto-shorts` | $5.00-$50.00+ |

**Rules:**
- Always `--dry-run` before High/Very High tier commands
- Confirm with user before any pipeline command
- Prefer `--low-res` on `analyze video` for longer videos (fewer tokens)

### Batch Operations

- `batch import`: No file count limit, but scan large directories with caution. Preview with `--dry-run`.
- `batch apply-effect`: Applies to all clips in project. Always `--dry-run` first.
- `pipeline auto-shorts -n <count>`: Each short generates multiple API calls. Keep `-n` under 5 unless user specifies.

### Timeouts

| Command | Typical Duration | Max Duration |
|---------|-----------------|--------------|
| `generate image` | 5-15s | 60s |
| `generate video` | 30s-5min | 10min |
| `pipeline script-to-video` | 2-15min | 30min |
| `export` | 10s-5min | 30min (depends on video length) |
| `audio dub` | 1-5min | 15min |

### Concurrency

- Do not run multiple `generate video` or `pipeline` commands concurrently — providers may rate-limit.
- `generate image` and `audio transcribe` are safe to run concurrently.
- FFmpeg-only commands (`edit silence-cut`, `detect *`, `export`) can run in parallel.

## Command Patterns

### Safe (read-only, no cost)
```bash
vibe schema <command>              # Introspect command schema
vibe detect scenes <video>         # Local FFmpeg analysis
vibe detect silence <media>        # Local FFmpeg analysis
vibe timeline list <project>       # Read project state
vibe project info <project>        # Read project state
vibe setup --show                  # Show API key status
vibe doctor --json                 # Check system health
```

### Moderate (API cost, reversible)
```bash
vibe analyze media <source> "<prompt>" --json
vibe analyze video <video> "<prompt>" --json --low-res
vibe audio transcribe <audio> --json
```

### Expensive (API cost, generates assets)
```bash
vibe generate image "<prompt>" --dry-run --json     # Preview first
vibe generate video "<prompt>" --dry-run --json     # Preview first
vibe generate speech "<text>" --dry-run --json      # Preview first
vibe pipeline script-to-video "<script>" --dry-run  # Always preview first
```

## Allowed Operations

### Read
- Any project file (`.vibe.json`)
- Any media file for analysis
- CLI schema and help text
- API key status (`vibe setup --show`)

### Write
- Project files within working directory
- Generated media files (images, videos, audio) to specified output paths
- Transcription/subtitle files (`.srt`, `.vtt`, `.json`)
- Exported video files

### Not Allowed (without explicit user confirmation)
- Overwriting existing files without `-y` flag
- Running pipeline commands (multi-step, high cost)
- Deleting project clips/tracks (`timeline delete`)
- Batch operations on large projects

## Error Handling

Structured exit codes (see `ExitCode` enum in `commands/output.ts`):
- **0**: Success. Parse `--json` output for result.
- **2**: Usage error (bad args, missing required params).
- **3**: Not found (file or resource missing).
- **4**: Auth error (missing API key). Includes `suggestion` field with fix command.
- **5**: API error (provider returned error). Check `retryable` field.
- **6**: Network error (connection failure, timeout).

In `--json` mode, errors output structured JSON to **stderr**: `{ success, error, code, exitCode, suggestion, retryable }`.

## Environment

Required API keys are documented in `MODELS.md` and can be checked with:
```bash
vibe setup --show    # Show all configured API keys
vibe doctor --json   # Check system health and available providers
```
