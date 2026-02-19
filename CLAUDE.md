# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VibeFrame is an AI-native video editing tool. CLI-first, MCP-ready. It uses natural language to control video editing via a headless CLI, MCP server for Claude Desktop/Cursor integration, and a pluggable AI provider system.

## Build & Development Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (264 passing)
pnpm lint             # Lint all packages
pnpm format           # Format code with Prettier

# Run CLI directly
pnpm vibe             # Start Agent mode (default, no-args only)
pnpm vibe agent       # Start Agent mode with options (e.g., -p gemini)
pnpm vibe --help      # Show CLI commands

# Run MCP server (development)
pnpm mcp

# Single package commands
pnpm -F @vibeframe/cli test       # Test CLI package only
pnpm -F @vibeframe/core build     # Build core package only
```

## MCP Server (npm package)

Published as [`@vibeframe/mcp-server`](https://www.npmjs.com/package/@vibeframe/mcp-server) on npm.

**End-user setup** (no clone/build needed):
```json
{
  "mcpServers": {
    "vibeframe": {
      "command": "npx",
      "args": ["-y", "@vibeframe/mcp-server"]
    }
  }
}
```

Config file locations:
- **Claude Desktop (macOS):** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Desktop (Windows):** `%APPDATA%\Claude\claude_desktop_config.json`
- **Cursor:** `.cursor/mcp.json` in workspace

**Bundling:** esbuild bundles workspace deps (`@vibeframe/cli`, `@vibeframe/core`) into a single `dist/index.js` (37KB). External deps: `@modelcontextprotocol/sdk`, `zod`.

**Publishing:**
```bash
cd packages/mcp-server
node build.js                    # Bundle
npm publish --access public      # Publish to npm
```

## Architecture

```
CLI (Commander.js + Agent)
    ↓
Engine (Project state management)
    ↓
Core (Zustand + Immer store, timeline operations, FFmpeg export)
    ↓
AI Providers (pluggable: OpenAI, Claude, Gemini, ElevenLabs, Runway, Kling, xAI Grok, etc.)
```

### Skills → CLI → Agent Workflow

```
.claude/skills/           Development-time API reference + Python helpers
       ↓
packages/cli/             CLI implementation (TypeScript/Commander.js)
       ↓
scripts/install.sh        User installation via curl | bash (copied to apps/web/public/ on build)
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
- 5 LLM providers: OpenAI, Claude, Gemini, Ollama, xAI Grok
- 50 tools across 7 categories (project, timeline, filesystem, media, AI, export, batch)
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
│   ├── ollama.ts            # Ollama JSON parsing
│   └── xai.ts               # xAI Grok (OpenAI-compatible)
├── tools/
│   ├── index.ts             # ToolRegistry
│   ├── project.ts           # 5 project tools
│   ├── timeline.ts          # 11 timeline tools
│   ├── filesystem.ts        # 4 filesystem tools
│   ├── media.ts             # 8 media tools
│   ├── ai.ts                # 16 AI generation tools (basic + pipeline)
│   ├── export.ts            # 3 export tools
│   └── batch.ts             # 3 batch tools
├── memory/
│   └── index.ts             # ConversationMemory
└── prompts/
    └── system.ts            # System prompt generation
```

**Usage:**
```bash
vibe agent                     # Start Agent mode (default: OpenAI)
vibe agent -p claude           # Use Claude
vibe agent -p gemini           # Use Gemini
vibe agent -p ollama           # Use local Ollama
vibe agent -p xai              # Use xAI Grok
vibe agent --confirm           # Confirm before each tool execution
vibe agent -i "query" -v       # Non-interactive mode with verbose output
```

### Package Structure

- **.claude/skills/** - Claude Code Skills. Each skill has `SKILL.md` (API docs) + `scripts/` (Python helpers). Providers: openai-api, claude-api, gemini-image, gemini-video, elevenlabs-tts, stability-image, replicate-ai, runway-video, kling-video, remotion-motion.
- **packages/cli** - Main CLI interface. Entry: `src/index.ts`. Commands in `src/commands/`. Agent in `src/agent/`. REPL in `src/repl/` (deprecated). Config schema in `src/config/schema.ts`.
- **packages/core** - Timeline data structures (`src/timeline/`), effects (`src/effects/`), FFmpeg export (`src/export/`). State managed with Zustand + Immer.
- **packages/ai-providers** - Pluggable AI providers. Abstract interface in `src/interface/`. Registry for capability matching. Each provider in its own directory.
- **packages/mcp-server** - MCP server for Claude Desktop/Cursor. Published as `@vibeframe/mcp-server` on npm. Bundled with esbuild (single file, workspace deps inlined). Tools, resources, and prompts in respective directories.
- **packages/ui** - Shared React components (Radix UI + Tailwind).
- **apps/web** - Next.js 14 preview UI.

### Key Conventions

- **Monorepo**: Turborepo + pnpm workspaces. Use `workspace:*` for internal deps.
- **ESM**: All packages use ES modules (`packages/ui` and `apps/web` rely on bundler/framework ESM handling).
- **TypeScript**: Strict mode. Run `pnpm build` to compile.
- **Project files**: `.vibe.json` format stores project state (sources, tracks, clips, effects).
- **Time units**: All times in seconds (floats allowed).
- **IDs**: `source-{id}`, `clip-{id}`, `track-{id}`, `effect-{id}`.

### Commit Format

Conventional commits: `feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `test:`, `chore:`

## Documentation

Root-level docs:

| File | Purpose |
|------|---------|
| `README.md` | Public-facing intro, quick start, MCP setup |
| `CLAUDE.md` | Developer guidance for Claude Code |
| `ROADMAP.md` | Feature roadmap with `[x]` completion tracking |
| `GUIDE.md` | CLI usage guide with examples |
| `MODELS.md` | AI model SSOT (Single Source of Truth) |

### Update Rules

After completing any feature or fix, update:

1. **`ROADMAP.md`** - Mark completed items with `[x]`, add new CLI commands to status section
2. **`MODELS.md`** - Update when adding/changing AI providers or models (SSOT — never duplicate model tables elsewhere)
3. **`README.md`** - Keep tool counts, test counts, feature highlights in sync
4. **`apps/web/app/page.tsx`** - Keep version badge and feature counts in sync

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
- `ROADMAP.md` - Mark `[x]` and update CLI status section

### Current Agent AI Tools (16)

| Tool | CLI Command | Description |
|------|-------------|-------------|
| `ai_image` | `vibe ai image` | Generate images (OpenAI/Gemini/Stability) |
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
| `ai_gemini_edit` | `vibe ai gemini-edit` | Multi-image editing (Gemini) |
| `ai_regenerate_scene` | `vibe ai regenerate-scene` | Regenerate specific scene(s) |
| `ai_text_overlay` | `vibe ai text-overlay` | Apply text overlays (FFmpeg drawtext) |
| `ai_review` | `vibe ai review` | AI video review & auto-fix (Gemini) |

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
# IMPORTANT: pnpm -r exec only updates packages/*, NOT root package.json
# You must run BOTH commands to keep versions in sync:

# Step 1: Update root package.json
npm version patch --no-git-tag-version
# or: minor, major

# Step 2: Update all workspace packages to match
pnpm -r exec -- npm version patch --no-git-tag-version

# Step 3: Verify all versions match
grep '"version"' package.json packages/*/package.json apps/*/package.json

# Step 4: Commit (exclude test/temp files)
git add package.json packages/*/package.json apps/*/package.json
git commit -m "chore: bump version to X.Y.Z"
git tag vX.Y.Z
```

**⚠️ Common pitfall:** Running only `pnpm -r exec` will update workspace packages but NOT the root `package.json`, causing version mismatch. Always run both commands.

**Files to update (must all have same version):**
- `package.json` (root) ← Often forgotten!
- `packages/cli/package.json`
- `packages/core/package.json`
- `packages/ai-providers/package.json`
- `packages/mcp-server/package.json`
- `packages/ui/package.json`
- `apps/web/package.json`

**Current version:** Check with `grep '"version"' package.json | head -1`

**Verify sync:** `grep '"version"' package.json packages/*/package.json apps/*/package.json | cut -d: -f2 | sort -u` should show only ONE version

## Environment Variables

Copy `.env.example` to `.env`. Each AI provider has its own API key:
- `OPENAI_API_KEY` - GPT, Whisper, GPT Image 1.5
- `ANTHROPIC_API_KEY` - Claude
- `GOOGLE_API_KEY` - Gemini (image, Veo video)
- `ELEVENLABS_API_KEY` - TTS, SFX
- `RUNWAY_API_SECRET` - Runway Gen-4.5 video
- `KLING_API_KEY` - Kling v2.5/v2.6 video
- `XAI_API_KEY` - xAI Grok (Agent LLM + Grok Imagine video)
- `STABILITY_API_KEY` - Stability AI image editing

## AI Provider Models

See **[MODELS.md](MODELS.md)** for the complete SSOT (Single Source of Truth) on all AI models.

Quick summary:
- **Agent LLM**: OpenAI GPT-4o, Claude Sonnet 4.6, Gemini 2.0 Flash, xAI Grok-3, Ollama
- **Text-to-Image**: OpenAI GPT Image 1.5, Gemini Nano Banana (Flash/Pro), Stability SDXL
- **Text-to-Video**: Kling v2.5/v2.6, Veo 3.0/3.1, Runway Gen-4, xAI Grok Imagine
- **Audio**: ElevenLabs (TTS, SFX), Whisper (transcription), Replicate (music)
