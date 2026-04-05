# VibeFrame Claude Code Harness

This directory configures Claude Code for the VibeFrame project.

## Structure

```
.claude/
├── settings.json          # Hooks configuration
├── README.md              # This file
├── hooks/
│   ├── pre-push-validate.sh   # Blocks git push on SSOT violations
│   └── post-edit-lint.sh      # Auto-lints TypeScript files after edits
├── rules/                     # ALL path-scoped (load on-demand, not at startup)
│   ├── architecture.md        # Architecture, agent rules, error handling (cli/core/ai-providers/**)
│   ├── versioning.md          # Version management (package.json files)
│   ├── code-quality.md        # Code standards (cli/core src)
│   └── mcp-server.md          # MCP setup (packages/mcp-server/**)
├── agents/                    # Specialized sub-agents
│   ├── code-reviewer.md       # Post-change code review (haiku, memory:project)
│   ├── version-checker.md     # SSOT sync validation (haiku)
│   ├── lint-fixer.md          # Fix ESLint errors (haiku)
│   ├── e2e-tester.md          # Full E2E testing (sonnet, 60 turns)
│   ├── feature-tester.md      # Single-feature testing (haiku)
│   └── pipeline-tester.md     # AI pipeline testing (sonnet, 40 turns)
└── skills/                    # Workflow skills (user-invocable)
    ├── test/SKILL.md          # /test — run tests
    ├── release/SKILL.md       # /release — version bump workflow
    └── sync-check/SKILL.md    # /sync-check — SSOT consistency
```

## Rules vs Skills — When to Use Which

| | Rules | Skills |
|---|---|---|
| **Location** | `.claude/rules/*.md` | `.claude/skills/<name>/SKILL.md` |
| **Purpose** | Reference instructions (coding standards, architecture) | Repeatable tasks & domain knowledge |
| **Frontmatter** | `description`, `paths` only (2 fields) | `name`, `description`, `argument-hint`, `disable-model-invocation`, etc. |
| **Loading** | Injected into context when `paths` match | Description always visible; full content on `/invoke` or auto-trigger |
| **User invoke** | No — always passive | Yes — `/skill-name` |

**Rule of thumb**: If Claude should always know it when working on those files → **Rule**. If it's a task or reference Claude calls when needed → **Skill**.

## How It Works

### Rules
- All 4 rules have `paths:` frontmatter — **none load at session start**
- Rules load on-demand when Claude reads files matching the path patterns
- Rules frontmatter supports only `paths` (no other fields)
- This keeps initial context lean (~50 lines from CLAUDE.md only)

### Skills
- 3 workflow skills: `/test`, `/release`, `/sync-check`
- Skill descriptions are always visible; full content loads on invocation
- Provider API references were removed (CLI source code is the SSOT)

### Agents
- Invoked via natural language ("run code review") or @-mention
- Each has specific tools, model, and max turns
- `code-reviewer` runs proactively after code changes

### Hooks
- **PreToolUse (Bash)**: Validates SSOT before `git push`
- **PostToolUse (Edit|Write)**: Auto-lints TypeScript files after edits

## Adding New Components

### New Rule
Create `.claude/rules/my-rule.md`. Always add `paths` frontmatter to keep context lean:
```yaml
---
description: What this rule covers
paths:
  - "src/my-area/**"
---
```

### New Agent
Create `.claude/agents/my-agent.md` with YAML frontmatter: `name`, `description`, `tools`, `model`, `maxTurns`.

### New Skill
Create `.claude/skills/my-skill/SKILL.md` with YAML frontmatter: `name`, `description`.
