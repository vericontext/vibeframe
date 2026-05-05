# VibeFrame Docs

This directory is intentionally small. Exact CLI behavior should come from the
live schema, not handwritten docs:

```bash
vibe schema --list --surface public --json
vibe schema --list --json
vibe schema <command.path> --json
```

## Public Docs

- [CLI reference](cli-reference.md) - generated command catalog from the live
  CLI surface.
- [Recipes](recipes.md) - practical copy-paste workflows.
- [Projects](projects.md) - project files, profiles, and backend metadata.
- [Composition engine boundary](hyperframes.md) - how VibeFrame relates to
  Remotion and Hyperframes.

Historical plans, audit notes, and one-off launch drafts are not kept here
because they age quickly and confuse new contributors.
