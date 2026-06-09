# VibeFrame Docs

This directory is intentionally small. Exact CLI behavior should come from the
live schema, not handwritten docs:

```bash
vibe schema --list --surface public --json
vibe schema --list --json
vibe schema <command.path> --json
```

For Codex, Claude, and Cursor app setup, use:

```bash
vibe host setup all
vibe host doctor all --json
```

For Claude Desktop, provide the workspace directory when writing config so
relative project names resolve under that directory. VibeFrame writes a shell
wrapper because Claude Desktop may not preserve a raw `cwd` field:

```bash
vibe host setup claude-desktop ~/dev/videos --write
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
