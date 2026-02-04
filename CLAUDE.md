# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VibeFrame is an AI-native video editing tool. CLI-first, MCP-ready. It uses natural language to control video editing via a headless CLI, MCP server for Claude Desktop/Cursor integration, and a pluggable AI provider system.

## Build & Development Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (220 passing)
pnpm lint             # Lint all packages
pnpm format           # Format code with Prettier

# Run CLI directly
pnpm vibe             # Start Agent mode (default)
pnpm vibe --help      # Show CLI commands

# Run MCP server
pnpm mcp

# Single package commands
pnpm -F @vibeframe/cli test       # Test CLI package only
pnpm -F @vibeframe/core build     # Build core package only
```

## Architecture

```
CLI (Commander.js + Agent)
    ↓
Engine (Project state management)
    ↓
Core (Zustand + Immer store, timeline operations, FFmpeg export)
    ↓
AI Providers (pluggable: OpenAI, Claude, Gemini, ElevenLabs, Runway, Kling, etc.)
```

### Skills → CLI → Agent Workflow

```
.claude/skills/           Development-time API reference + Python helpers
       ↓
packages/cli/             CLI implementation (TypeScript/Commander.js)
       ↓
scripts/install.sh        User installation via curl | bash
       ↓
Agent (vibe)              Natural language → LLM tool calling → autonomous execution
```

**Claude Code Skills** (`.claude/skills/`):
- Each skill contains `SKILL.md` (API documentation) and `scripts/` (Python helpers)
- Used during development to understand API capabilities and test integrations
- Python scripts serve as working reference implementations

**CLI** (`packages/cli/`):
- Production commands built in TypeScript using Commander.js
- Calls Python helper scripts or implements providers directly
- Supports `--provider` option for multi-provider commands (image, video, etc.)

**Agent** (`packages/cli/src/agent/`) - **Default entry point**:
- Users install via `curl -fsSL .../install.sh | bash`
- `vibe` starts Agent mode by default
- Claude Code-like agentic loop architecture
- Multi-turn: LLM reasoning → tool call → result → repeat until complete
- 4 LLM providers: OpenAI, Claude, Gemini, Ollama
- 39 tools across 6 categories (project, timeline, filesystem, media, AI, export)
- `--confirm` flag: prompts before each tool execution
- Example: "create project and add video" → multiple tool calls autonomously

**REPL** (deprecated):
- Legacy single-command mode, replaced by Agent mode
- Code kept in `src/repl/` for library usage (marked `@deprecated`)

### Agent Architecture

```
packages/cli/src/agent/
├── index.ts                 # AgentExecutor - main agentic loop
├── types.ts                 # ToolDefinition, ToolCall, AgentMessage, etc.
├── adapters/
│   ├── index.ts             # LLMAdapter interface + factory
│   ├── openai.ts            # OpenAI Function Calling
│   ├── claude.ts            # Claude tool_use
│   ├── gemini.ts            # Gemini Function Calling
│   └── ollama.ts            # Ollama JSON parsing
├── tools/
│   ├── index.ts             # ToolRegistry
│   ├── project.ts           # 5 project tools
│   ├── timeline.ts          # 10 timeline tools
│   ├── filesystem.ts        # 4 filesystem tools
│   ├── media.ts             # 5 media tools
│   ├── ai.ts                # 12 AI generation tools (basic + pipeline)
│   └── export.ts            # 3 export tools
├── memory/
│   └── index.ts             # ConversationMemory
└── prompts/
    └── system.ts            # System prompt generation
```

**Usage:**
```bash
vibe                           # Start Agent mode (default: OpenAI)
vibe -p claude                 # Use Claude
vibe -p gemini                 # Use Gemini
vibe -p ollama                 # Use local Ollama
vibe --confirm                 # Confirm before each tool execution
vibe -i "query" -v             # Non-interactive mode with verbose output
vibe agent                     # Explicit agent command (same as `vibe`)
```

### Package Structure

- **.claude/skills/** - Claude Code Skills. Each skill has `SKILL.md` (API docs) + `scripts/` (Python helpers). Providers: openai-api, claude-api, gemini-image, elevenlabs-tts, stability-image, replicate-ai, runway-video, kling-video, remotion-motion.
- **packages/cli** - Main CLI interface. Entry: `src/index.ts`. Commands in `src/commands/`. Agent in `src/agent/`. REPL in `src/repl/` (deprecated). Config schema in `src/config/schema.ts`.
- **packages/core** - Timeline data structures (`src/timeline/`), effects (`src/effects/`), FFmpeg export (`src/export/`). State managed with Zustand + Immer.
- **packages/ai-providers** - Pluggable AI providers. Abstract interface in `src/interface/`. Registry for capability matching. Each provider in its own directory.
- **packages/mcp-server** - MCP server for Claude Desktop/Cursor. Tools, resources, and prompts in respective directories.
- **packages/ui** - Shared React components (Radix UI + Tailwind).
- **apps/web** - Next.js 14 preview UI.

### Key Conventions

- **Monorepo**: Turborepo + pnpm workspaces. Use `workspace:*` for internal deps.
- **ESM**: All packages use ES modules.
- **TypeScript**: Strict mode. Run `pnpm build` to compile.
- **Project files**: `.vibe.json` format stores project state (sources, tracks, clips, effects).
- **Time units**: All times in seconds (floats allowed).
- **IDs**: `source-{id}`, `clip-{id}`, `track-{id}`, `effect-{id}`.

### Commit Format

Conventional commits: `feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `test:`, `chore:`

## Documentation Updates

After completing any feature, fix, or significant change, **always update**:

1. **docs/progress.md** - Add a dated entry with:
   - Feature/fix name and description
   - Problem solved (if applicable)
   - Files modified/created
   - Usage examples with CLI commands
   - Verification steps

2. **docs/roadmap.md** - Mark completed items with `[x]` and update CLI status section if new commands were added.

## Documentation Consistency Rules

When writing or updating documentation (especially `docs/cli-guide.md`):

1. **Filename Consistency**: If an example generates a file, subsequent examples must use the SAME filename
   - Bad: `generate image` → `sunset.png`, then `add a-sunset-landscape.png`
   - Good: `generate image` → `sunset.png`, then `add sunset.png`

2. **Version Numbers**: Use `0.2.x` format instead of exact versions to reduce maintenance

3. **ID Examples**: When showing IDs like `source-1`, `clip-1`:
   - Add a note that these are simplified examples
   - Real IDs are timestamp-based: `1770107336723-xxxxxxxx`

4. **Test Examples**: Before documenting a workflow, actually run it to verify:
   - Commands work as shown
   - Output messages match
   - File names are consistent throughout

5. **Cross-Reference**: When updating CLI commands, also update:
   - `docs/cli-guide.md` - User-facing documentation
   - `docs/roadmap.md` - Feature status
   - Command `--help` text

## CLI ↔ Agent Tool Synchronization

When adding or modifying CLI AI commands, **consider whether they should be exposed as Agent tools**.

### When to Add Agent Tools

Add an Agent tool wrapper when CLI command:
- Is frequently used in workflows (e.g., `script-to-video`, `highlights`)
- Benefits from natural language invocation
- Can operate autonomously without interactive prompts
- Has complex parameters that LLM can help construct

### How to Add Agent Tools for CLI Commands

1. **Extract core logic** from CLI command into an exported function:
   ```typescript
   // In packages/cli/src/commands/ai.ts
   export interface MyCommandOptions { ... }
   export interface MyCommandResult { ... }
   export async function executeMyCommand(options: MyCommandOptions): Promise<MyCommandResult>
   ```

2. **Create Agent tool** that calls the exported function:
   ```typescript
   // In packages/cli/src/agent/tools/ai.ts
   import { executeMyCommand } from "../../commands/ai.js";

   const myCommandDef: ToolDefinition = { name: "ai_my_command", ... };
   const myCommandHandler: ToolHandler = async (args, context) => {
     const result = await executeMyCommand({ ... });
     return { success: result.success, output: ... };
   };
   ```

3. **Register the tool** in `registerAITools()`:
   ```typescript
   registry.register(myCommandDef, myCommandHandler);
   ```

### Files to Update

When adding new AI CLI commands:
- `packages/cli/src/commands/ai.ts` - CLI command + exported function
- `packages/cli/src/agent/tools/ai.ts` - Agent tool wrapper (if applicable)
- `CLAUDE.md` - Update tool counts
- `docs/roadmap.md` - Update Agent tools section
- `docs/progress.md` - Document the change

### Current Agent AI Tools (12)

| Tool | CLI Command | Description |
|------|-------------|-------------|
| `ai_image` | `vibe ai image` | Generate images (DALL-E/Stability/Gemini) |
| `ai_video` | `vibe ai video` | Generate video (Runway) |
| `ai_kling` | `vibe ai kling` | Generate video (Kling) |
| `ai_tts` | `vibe ai tts` | Text-to-speech (ElevenLabs) |
| `ai_sfx` | `vibe ai sfx` | Sound effects (ElevenLabs) |
| `ai_music` | `vibe ai music` | Music generation (Replicate) |
| `ai_storyboard` | `vibe ai storyboard` | Script → storyboard (Claude) |
| `ai_motion` | `vibe ai motion` | Motion graphics (Remotion) |
| `ai_script_to_video` | `vibe ai script-to-video` | Full video pipeline |
| `ai_highlights` | `vibe ai highlights` | Extract highlights |
| `ai_auto_shorts` | `vibe ai auto-shorts` | Generate shorts |
| `ai_gemini_video` | `vibe ai gemini-video` | Video analysis (Gemini) |

Format for progress.md entries:
```markdown
## YYYY-MM-DD

### Feature/Fix: Title
Description of what was done.

**Problem:** (if fix)
**Solution:** (if fix)

**Files Modified:**
- `path/to/file.ts` - What changed

**Usage:**
```bash
vibe command example
```
```

## Version Management

All packages share the same version number. Update versions when making significant changes:

**When to bump versions:**
- `patch` (0.1.0 → 0.1.1): Bug fixes, minor improvements
- `minor` (0.1.0 → 0.2.0): New features, new commands
- `major` (0.1.0 → 1.0.0): Breaking changes, major milestones

**Auto-bump rule for Claude Code:**
After committing `feat:` or `fix:` changes, bump the version before pushing:
- `fix:` commits → bump `patch`
- `feat:` commits → bump `minor`
- Multiple commits in one session → bump once based on highest level (feat > fix)

**How to update:**
```bash
# Update all package.json files at once
pnpm -r exec -- npm version patch --no-git-tag-version
# or: minor, major

# Then commit with version tag
git add -A && git commit -m "chore: bump version to X.Y.Z"
git tag vX.Y.Z
```

**Files to update:**
- `package.json` (root)
- `packages/cli/package.json`
- `packages/core/package.json`
- `packages/ai-providers/package.json`
- `packages/mcp-server/package.json`
- `packages/ui/package.json`
- `apps/web/package.json`

**Current version:** Check with `cat package.json | grep version`

## Environment Variables

Copy `.env.example` to `.env`. Each AI provider has its own API key:
- `OPENAI_API_KEY` - GPT, Whisper, DALL-E
- `ANTHROPIC_API_KEY` - Claude
- `GOOGLE_API_KEY` - Gemini
- `ELEVENLABS_API_KEY` - TTS, SFX
- `RUNWAY_API_SECRET`, `KLING_API_KEY`, `STABILITY_API_KEY` - Video/image generation
