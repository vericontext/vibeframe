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
│   └── feature-tester.md      # Single-feature testing (haiku)
└── skills/                    # Workflow skills (user-invocable)
    ├── test/SKILL.md          # /test — run tests
    ├── release/SKILL.md       # /release — version bump workflow
    ├── sync-check/SKILL.md    # /sync-check — SSOT consistency
    ├── vibe-pipeline/SKILL.md # /vibe-pipeline — Video as Code authoring guide
    └── vibe-scene/SKILL.md    # /vibe-scene — scene composition authoring guide
```

## Rules vs Skills — When to Use Which

|                 | Rules                                                   | Skills                                                                   |
| --------------- | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Location**    | `.claude/rules/*.md`                                    | `.claude/skills/<name>/SKILL.md`                                         |
| **Purpose**     | Reference instructions (coding standards, architecture) | Repeatable tasks & domain knowledge                                      |
| **Frontmatter** | `description`, `paths` only (2 fields)                  | `name`, `description`, `argument-hint`, `disable-model-invocation`, etc. |
| **Loading**     | Injected into context when `paths` match                | Description always visible; full content on `/invoke` or auto-trigger    |
| **User invoke** | No — always passive                                     | Yes — `/skill-name`                                                      |

**Rule of thumb**: If Claude should always know it when working on those files → **Rule**. If it's a task or reference Claude calls when needed → **Skill**.

## How It Works

### Rules

- All 4 rules have `paths:` frontmatter — **none load at session start**
- Rules load on-demand when Claude reads files matching the path patterns
- Rules frontmatter should stay minimal: `paths` plus an optional `description`
- This keeps initial context lean (~50 lines from CLAUDE.md only)

### Skills

- 5 workflow skills: `/test`, `/release`, `/sync-check`, `/vibe-pipeline`, `/vibe-scene`
- Skill descriptions are always visible; full content loads on invocation
- `/vibe-pipeline` and `/vibe-scene` mirror the public `vibe guide` topics — Claude Code users get slash-menu shortcuts, every other host can call `vibe guide <topic>`
- Provider API references were removed (CLI source code is the SSOT)

### Agents

- Invoked via natural language ("run code review") or @-mention
- Each has specific tools, model, and max turns
- No PostToolUse hook auto-invokes any agent. Use `/code-review` (plugin)
  or @-mention `code-reviewer` manually after substantial changes.

### Hooks

- **PreToolUse (Bash)**: `pre-push-validate.sh` — only fires on `git push`,
  exits early on every other Bash. 10 gates (in order):
  1. Version sync across `package.json` files
  2. Version bump required when `feat:`/`fix:` commits exist since last tag
  3. No hardcoded version fallbacks in `apps/web`
  4. No stale model IDs in `.claude/skills/` (per `MODELS.md`)
  5. `scripts/sync-counts.sh --check` passes
  6. `CHANGELOG.md` has entry for current root version
  7. `pnpm lint` passes
  8. `pnpm build` passes
  9. `pnpm typecheck` passes
  10. `pnpm gen:reference:check` passes (catches stale `docs/cli-reference.md`)

  On failure, the last 5 lines of the failing command's output are
  attached to the error.

- **PostToolUse (Edit|Write)**: `post-edit-lint.sh` — runs ESLint on
  edited `.ts` files in `packages/*/src`. Reports issues, never blocks.

### Plugins

Enabled in `settings.json` under `enabledPlugins`:

| Plugin                | Provides                                                  |
| --------------------- | --------------------------------------------------------- |
| `claude-code-setup`   | `claude-automation-recommender` skill                     |
| `code-review`         | `/code-review` skill for PR review                        |
| `code-simplifier`     | `simplify` skill for review-and-fix                       |
| `security-guidance`   | `/security-review` skill for branch security audit        |

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
