---
name: sync-check
description: Check VibeFrame SSOT consistency across package versions, generated docs, model metadata, and site counts.
---

# Sync Check

Use this skill when the user asks whether repository metadata, generated docs,
or single-source-of-truth counts are in sync.

Run:

```bash
for f in package.json packages/*/package.json apps/*/package.json; do
  jq -r '.version' "$f"
done | sort -u

bash scripts/sync-counts.sh --check
pnpm gen:reference:check
```

Also check `MODELS.md` against model IDs used in `packages/cli/src/commands/`
and `packages/ai-providers/src/` when the change touched provider metadata.

Report as:

| Check | Status | Details |
| --- | --- | --- |
| Version sync | Pass/Fail | ... |
| Count sync | Pass/Fail | ... |
| CLI reference | Pass/Fail | ... |
| MODELS.md | Pass/Fail/Skipped | ... |
