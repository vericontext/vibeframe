# CLI redesign — v0.74 → v0.78

VibeFrame's top-level CLI surface was reshaped in v0.74.0 around three
principles drawn from established CLI design guides. **v0.75.0 dropped all
the deprecation aliases** that v0.74 carried for one cycle — the
canonical names below are now the only way to invoke each command.

The principles:

- **Implicit area pattern** — the project is the implicit subject; commands
  that don't carry an area act on the current/implicit project.
  ([Microsoft `System.CommandLine` design guidance][ms])
- **Verb leaves, noun groups** — group commands are nouns; their action
  leaves are verbs. ([Microsoft][ms], [clig.dev][clig])
- **Avoid catch-all subcommand** — top-level commands that duplicate
  legacy `<group> <action>` flows (e.g. `scene build`) get hidden from
  help once the canonical entry point is at the top level.
  ([clig.dev][clig])

v0.74 kept every legacy name as a Commander alias (with a one-line
deprecation warning to stderr). v0.75 removed those aliases — invoking an
old name now produces a Commander `unknown command` error. Pre-v0.74
scripts must migrate to the canonical names below.

## Top-level renames (v0.74)

| Before | After | Aliases status |
|---|---|---|
| `vibe pipeline` | `vibe remix` | removed in v0.75 |
| `vibe analyze` | `vibe inspect` | removed in v0.75 |

The canonical name is what shows up in the JSON envelope's `command:`
field, in `vibe schema --list`, and in `--describe` output.

## Audio leaf renames (verb-first; v0.74)

| Before | After | Aliases status |
|---|---|---|
| `vibe audio voices` | `vibe audio list-voices` | removed in v0.75 |
| `vibe audio voice-clone` | `vibe audio clone-voice` | removed in v0.75 |

## Removed entirely (v0.75)

The following commands existed as hidden Commander entries in v0.74 and
were deleted from `packages/cli/src/commands/scene.ts` in v0.75. The
underlying execute functions remain in `_shared/` and back the canonical
top-level commands plus the manifest MCP tools.

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

## MCP tool name alignment (v0.75)

v0.74 deliberately kept the MCP tool names (`pipeline_*`, `analyze_*`,
`scene_init/build/render`, `audio_voice_clone`) under their old labels
so that `@vibeframe/mcp-server` clients wouldn't break during the CLI
rename window. v0.75 finishes the alignment — every MCP tool now matches
its CLI counterpart's group/leaf naming:

| Before (v0.74) | After (v0.75) |
|---|---|
| `pipeline_highlights` | `remix_highlights` |
| `pipeline_auto_shorts` | `remix_auto_shorts` |
| `pipeline_regenerate_scene` | `remix_regenerate_scene` |
| `pipeline_run` | `run` (groupless — matches `vibe run`) |
| `analyze_media` / `_video` / `_review` / `_suggest` | `inspect_media` / `_video` / `_review` / `_suggest` |
| `audio_voice_clone` | `audio_clone_voice` |
| `scene_init` / `_build` / `_render` | `init` / `build` / `render` (project-flow tools, top-level) |

This is a hard break for MCP hosts: the previous tool names no longer
appear in `tools/list` after upgrading to v0.75. Pin to v0.74 if you
have hardcoded the old names and can't migrate yet.

## What did not change

- **`vibe schema <path>`, `vibe context`, `vibe walkthrough <topic>`**
  remain top-level commands. We considered consolidating them under
  `vibe agent`, but the cost (parent-chain refactor + deprecation noise
  on widely-used `vibe schema X` invocations) outweighed the visual win
  from Phase 1's help reorg.
- **Walkthrough topic name `pipeline`** still routes to the same content
  (topic-name rename deferred — low value, breaks any saved bookmarks).
- **Provider flag `-p`** — Microsoft guidance reserves `-p` for
  `--property`, but the VibeFrame domain meaning of "provider" is well
  established; we keep it.
- **`emitDeprecationWarning` helper** stays in `output.ts` even though
  v0.75 has no callers — it's the canonical place to wire future
  deprecations and the unit tests pin its semantics.

## v0.77 polish (HIGH + MEDIUM diagnosis follow-up)

After v0.74-v0.76 shipped, a re-diagnosis surfaced five remaining
inconsistencies. v0.77 fixes them all (still hard breaks per the 0.x
policy).

| Category | Before | After |
|---|---|---|
| Verb-first leaf | `vibe scene styles` | `vibe scene list-styles` |
| Verb-first leaf | `vibe edit upscale-video` | `vibe edit upscale` (the `-video` was redundant in the `edit` group) |
| Timeline verb-noun symmetry with `add-*` | `vibe timeline {trim,split,delete,duplicate,move}` | `vibe timeline {trim-clip,split-clip,delete-clip,duplicate-clip,move-clip}` (`list` stays bare — multi-type contents) |
| Group description length | `remix` had a 27-word description with a `vibe build` cross-ref | trimmed to 8 words ("Transform existing media (highlights, auto-shorts, animated captions, regenerate-scene)") to match other groups |
| Help bottom "Global flags" section | only listed `--json/--fields/--quiet/--stdin/--dry-run` | added `-V/--version`, `-h/--help`, `-q` short form on `--quiet`, and `--describe` |

MCP tools follow the CLI rename per the v0.76 alignment rule:
`scene_styles` → `scene_list_styles`. `edit_upscale` was already named
correctly. Timeline manifest tools were already `timeline_trim_clip` /
`_split_clip` / etc., so v0.77 makes the CLI side 1:1 with the manifest
(no rename needed on the manifest side).

## v0.78 deep-audit cleanup (CRITICAL bugs + short flag chaos)

A second audit after v0.77 surfaced four genuine bugs and a fundamental
short-flag consistency problem. v0.78 closes both fronts.

### Critical bug fixes (no breaking surface change)

| Bug | Fix |
|---|---|
| `vibe generate motion -h` errored with "argument missing" — `-h, --height` shadowed the standard help flag (Microsoft + clig.dev inviolable rule) | Drop `-h` (and `-w` for symmetry) → `--height` / `--width` long-only |
| `vibe scene` group description listed `(add, lint, styles)` after v0.77 renamed `styles` → `list-styles` | Updated to `(add, lint, list-styles)` |
| `vibe detect {scenes,silence,beats} --json --dry-run` emitted a leading spinner line to stdout, breaking JSON parsers (MCP / agents) | Replaced direct `ora()` with the silent-aware `spinner()` helper from `output.ts` (per-mode auto-silence) |
| `vibe inspect {media,video,suggest} --dry-run` errored "unknown option" although the global help advertises `--dry-run` as global; only `inspect review` had it wired | Added `--dry-run` to all three (param echo + outputSuccess + early return), matching the existing pattern |

Also fixed during the same pass: the JSON envelope's `command:` field
in three inspect leaves still emitted `analyze media/video/suggest` (the
v0.74 rename did not propagate into outputSuccess). And `inspect review`
emitted `ai review` (a stale name from a much earlier reshuffle). All
four are now their canonical names.

### Short flag dedup (breaking)

Empirical audit of every `.option(...)` declaration found seven letters
overloaded across multiple meanings — clig.dev's "Be consistent across
subcommands" hard rule. Policy: a one-letter form is kept only when one
meaning dominates the letter ≥60% across the surface; everywhere else
the option becomes long-only.

| Letter | Kept short for | Now long-only |
|---|---|---|
| `-p` | `--provider` (10/13) | `--project`, `--preset`, `--params` |
| `-m` | `--model` (11/14) | `--mode`, `--melody` |
| `-v` | `--verbose` (5/9) | `--voice` |
| `-c` | `--confirm` (1/2) | `--creativity` |
| `-s` | (no dominant — 7-way split) | all → `--style`, `--start`, `--size`, `--seed`, `--scale`, `--strength`, `--storyboard`, `--source` |
| `-n` | (5-way split) | all → `--name`, `--count`, `--noise`, `--noise-floor`, `--negative` |
| `-t` | (6-way split) | all → `--time`, `--threshold`, `--type`, `--track`, `--text`, `--target` |
| `-f` | (5-way split) | all → `--fps`, `--format`, `--focus`, `--file`, `--factor` |
| `-w`, `-y`, `-g` | (singletons) | `--wait`, `--overwrite`, `--generator`, `--gap-fill` |

Final stable shorts (single dominant meaning):

```
-o, --output      -k, --api-key    -d, --duration
-m, --model       -p, --provider   -r, --ratio
-l, --language    -a, --aspect     -v, --verbose
-c, --confirm     -i, --image/--input  (per-command, all "input"-y)
```

### `edit interpolate --quality` → `--mode`

`--quality` previously meant three different things across the surface
(`generate image standard|hd`, `render draft|standard|high`, `edit
interpolate fast|quality`). The interpolate one is a speed-vs-quality
tradeoff; renamed to `--mode` so `--quality` is unambiguous output-quality
elsewhere.

### `inspect` group argument standardization

`inspect review <video>` was the only leaf in the group not using the
shared `<source>` argument name. Renamed to `<source>` so all four
inspect leaves take `<source>` as the input position.

### `vibe project` description

`"Project management commands"` was generic. Replaced with `"Manage
VibeFrame .vibe.json project files (create, info, set)"`.

### Provider list separator

`(Claude/OpenAI)` and `(Gemini/OpenAI/Grok)` style descriptions
normalized to `(Claude or OpenAI)` and `(Gemini, OpenAI, or Grok)` to
match the dominant comma-style elsewhere.

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

These are hard breaks — no aliases. Pin to v0.73 or earlier if you can't
migrate yet.

### CLI scripts

1. Replace `vibe pipeline X` with `vibe remix X`.
2. Replace `vibe analyze X` with `vibe inspect X`.
3. Replace `vibe audio voices` / `voice-clone` with `audio list-voices` /
   `clone-voice`.
4. Replace `vibe scene {init,build,render}` and `vibe export` with the
   top-level equivalents.
5. If you parse the JSON envelope's `command:` field, update string
   matchers — the field reflects the canonical name now.

### MCP hosts (`@vibeframe/mcp-server`)

6. Rename calls per the v0.75 MCP table above. Hosts that hardcode tool
   names (e.g. Claude Desktop config snippets, agent prompt allowlists)
   need to swap `pipeline_*`, `analyze_*`, `audio_voice_clone`, and
   `scene_init/build/render` for the new names.

[clig]: https://clig.dev/
[ms]: https://learn.microsoft.com/en-us/dotnet/standard/commandline/design-guidance
