# CLI redesign — v0.74

VibeFrame's top-level CLI surface was reshaped in v0.74.0 around three
principles drawn from established CLI design guides:

- **Implicit area pattern** — the project is the implicit subject; commands
  that don't carry an area act on the current/implicit project.
  ([Microsoft `System.CommandLine` design guidance][ms])
- **Verb leaves, noun groups** — group commands are nouns; their action
  leaves are verbs. ([Microsoft][ms], [clig.dev][clig])
- **Avoid catch-all subcommand** — top-level commands that duplicate
  legacy `<group> <action>` flows (e.g. `scene build`) get hidden from
  help once the canonical entry point is at the top level.
  ([clig.dev][clig])

Every legacy name is preserved as a Commander alias so external scripts
keep working through the v0.74.x line. Aliases will be removed in v1.0.

## Top-level renames

| Before | After | Aliases (deprecated, removed in v1.0) |
|---|---|---|
| `vibe pipeline` | `vibe remix` | `pipeline`, `pipe` |
| `vibe analyze` | `vibe inspect` | `analyze`, `az` |

Both old names still parse identically. Invoking via the deprecated alias
emits a single-line warning to stderr — suppressed under `--json`,
`--quiet`, or when stderr is not a TTY (CI, piped logs).

The canonical name is what shows up in the JSON envelope's `command:`
field, in `vibe schema --list`, and in `--describe` output.

## Audio leaf renames (verb-first)

| Before | After | Aliases |
|---|---|---|
| `vibe audio voices` | `vibe audio list-voices` | `voices` |
| `vibe audio voice-clone` | `vibe audio clone-voice` | `voice-clone` |

## Hidden from `--help` (still callable)

The following commands work but no longer appear in `--help`. They will
be removed in v1.0.

- `vibe scene init` → use `vibe init`
- `vibe scene build` → use `vibe build`
- `vibe scene render` → use `vibe render`
- `vibe export` → use `vibe render`

## Help reorganization

Top-level `--help` is now grouped into four tiers:

```
Get started        — init / build / render / doctor / setup / demo
One-shot tools     — generate / edit / inspect / remix / audio
Advanced authoring — project / scene / timeline
Automation         — run / agent / batch + schema / context / walkthrough
```

## What did not change

- **MCP tool names stay the same** (`pipeline_*`, `analyze_*`, etc.) so
  external MCP hosts and `@vibeframe/mcp-server` users see no break.
  The CLI ↔ manifest mapping handles the rename internally.
- **`vibe schema <path>`, `vibe context`, `vibe walkthrough <topic>`**
  remain top-level commands. We considered consolidating them under
  `vibe agent`, but the cost (parent-chain refactor + deprecation noise
  on widely-used `vibe schema X` invocations) outweighed the visual win
  from Phase 1's help reorg.
- **Walkthrough topic name `pipeline`** still routes to the same content.
  Topic-name rename is deferred to v0.75.
- **Provider flag `-p`** — Microsoft guidance reserves `-p` for
  `--property`, but the VibeFrame domain meaning of "provider" is well
  established; we keep it.

## What we deliberately did not do (and why)

- **Reclaim `-i` / `-v` short flags** — Microsoft guidance reserves these
  for `--interactive` / `--verbosity`. Many existing per-command uses
  conflict (e.g. `-i` for image input on several commands). Reclaiming
  would break too many invocation patterns. Long-form `--input` /
  `--verbose` already work everywhere; the short-flag normalization is
  deferred indefinitely.
- **Add new short aliases** like `vw` (view), `rmx` (remix). clig.dev
  warns against arbitrary abbreviations because they lock out future
  command names. Existing established aliases (`gen`, `ed`, `au`, `az`)
  stay.

## Migration checklist for external scripts

1. Replace `vibe pipeline X` with `vibe remix X`.
2. Replace `vibe analyze X` with `vibe inspect X`.
3. Replace `vibe audio voices` / `voice-clone` with `audio list-voices` /
   `clone-voice`.
4. Replace `vibe scene {init,build,render}` and `vibe export` with the
   top-level equivalents.
5. If you parse the JSON envelope's `command:` field, update string
   matchers — the field reflects the canonical name now.

[clig]: https://clig.dev/
[ms]: https://learn.microsoft.com/en-us/dotnet/standard/commandline/design-guidance
