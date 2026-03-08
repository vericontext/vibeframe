---
name: sync-check
description: Quick SSOT consistency check across versions, model IDs, docs, and landing page.
allowed-tools: Bash, Read, Grep, Glob
user-invocable: true
disable-model-invocation: true
---

# SSOT Sync Check

Run these checks and report results:

## 1. Version Sync

```bash
grep '"version"' package.json packages/*/package.json apps/*/package.json
```

All versions must match. Report any mismatches.

## 2. Model ID SSOT (MODELS.md vs skills)

Compare model IDs in MODELS.md against `.claude/skills/*/SKILL.md` and `scripts/*.py`.
Flag any stale or mismatched model IDs that have been superseded by newer versions.

Use the stale model ID patterns from `.claude/hooks/pre-push-validate.sh` to scan skills directories (excluding this file).

## 3. Landing Page Sync (apps/web/app/page.tsx)

- Version badge matches package.json
- Agent tool count matches actual (`grep -c "registry.register" packages/cli/src/agent/tools/*.ts`)
- MCP tool count matches actual (`grep -c "server.tool" packages/mcp-server/src/tools/*.ts`)

## 4. README.md Sync

- Test count matches (`CI=true pnpm -F @vibeframe/cli exec vitest run 2>&1 | tail -5`)
- Provider count and feature tables are up to date

## Output Format

Report as table:

| Check | Status | Details |
|-------|--------|---------|
| Version sync | Pass/Fail | ... |
| Model ID SSOT | Pass/Fail | ... |
| Landing page | Pass/Fail | ... |
| README.md | Pass/Fail | ... |
