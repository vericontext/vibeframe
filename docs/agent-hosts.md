# Agent Hosts & Sync

VibeFrame ships agent configuration for three hosts — Claude Code, OpenAI
Codex, and Cursor — from a single canonical source. This document is the
authoritative map of what is canonical, what is generated, and how to change
each piece without breaking sync.

## The one rule

**Never edit a generated file. Edit the canonical source, then run
`pnpm agent-sync`.** Drift is enforced by `pnpm agent-sync:check` in the shared
pre-push gate (`scripts/pre-push-validate.sh`, check #6) and in CI.

A second rule decides *where* new guidance goes:

- **Shared guidance** that every host must follow → `AGENTS.md` (read natively
  by Codex and Cursor; imported by Claude via `CLAUDE.md` = `@AGENTS.md`) or a
  cross-host skill in `.agents/skills/`.
- **Claude-only ergonomics** (path-scoped rules, subagents, hooks, settings) →
  `.claude/`. **These do NOT reach Codex or Cursor.**

## Classification

| Path | Class | Notes |
| --- | --- | --- |
| `AGENTS.md` | **Canonical** | Cross-host baseline. Codex/Cursor read it natively; Claude imports it via `CLAUDE.md`. Not copied anywhere. |
| `CLAUDE.md` | **Canonical** | One line: `@AGENTS.md`. Keep it that way. |
| `.agents/skills/<name>/SKILL.md` | **Canonical** | Source for the 5 cross-host workflow skills. |
| `.claude/skills/<name>/SKILL.md` | **Generated** | From `.agents/skills/<name>/SKILL.md` + Claude-only frontmatter extras. Marked `DO NOT EDIT`. |
| `.codex/config.toml` → `# >>> VibeFrame MCP server >>>` block | **Generated (partial)** | Only the marked block is managed; the rest of the file is hand-maintained Codex runtime config. |
| `.cursor/mcp.json` → `mcpServers.vibeframe` | **Generated (partial)** | Only that key is managed; other `mcpServers` entries are preserved. No inline marker (JSON has no comments). |
| `.claude/rules/*.md` | **Claude-only** | Path-scoped rules (`paths:` frontmatter, native Claude feature). Load on demand when matching files are read. Not propagated. |
| `.claude/agents/*.md` | **Claude-only** | Subagents. Not propagated. |
| `.claude/hooks/*.sh` | **Claude-only** | PreToolUse/PostToolUse hooks (wired in `.claude/settings.json`). Not propagated. |
| `.claude/settings.json` | **Claude-only** | Hooks + permissions. Not propagated. |

The sync engine is `scripts/sync-agent-hosts.mts` (`--write` regenerates,
`--check` validates). It reads `.agents/skills/` and writes the generated
targets above; it does **not** read or copy `AGENTS.md`, nor touch
`.claude/rules`, `.claude/agents`, `.claude/hooks`, or `.claude/settings.json`.

## Workflows

**Add a cross-host skill** (available in Claude, and discoverable to all hosts):
1. Create `.agents/skills/<name>/SKILL.md` (frontmatter `name` + `description`,
   then the body).
2. If Claude needs extra frontmatter (e.g. `argument-hint`,
   `disable-model-invocation`), add it to `CLAUDE_FRONTMATTER_EXTRAS` in
   `scripts/sync-agent-hosts.mts`.
3. `pnpm agent-sync` → generates `.claude/skills/<name>/SKILL.md`.
4. Commit both the canonical source and the generated copy.

**Add a Claude-only path-scoped rule** (Claude ergonomics, not shared):
1. Create `.claude/rules/<name>.md` with `paths:` frontmatter (plus an optional
   `description`). Keep frontmatter minimal so startup context stays lean.
2. No sync needed — it is Claude-local. If the guidance must apply to Codex and
   Cursor too, put it in `AGENTS.md` instead.

**Add a hook:** create `.claude/hooks/<name>.sh` and wire it in
`.claude/settings.json`. For checks that must run on every host's `git push`,
add them to `scripts/pre-push-validate.sh` (the shared gate that
`.claude/hooks/pre-push-validate.sh` and `.githooks/pre-push` both delegate to).

## Enforcement flow

```
edit canonical (.agents/skills, AGENTS.md, or the sync script)
      → pnpm agent-sync            (regenerate .claude/.codex/.cursor)
      → git push
          → pre-push gate: pnpm agent-sync:check   (blocks on drift)
      → CI: pnpm agent-sync:check                  (blocks merge on drift)
```

If `agent-sync:check` fails, run `pnpm agent-sync` and commit the result.
