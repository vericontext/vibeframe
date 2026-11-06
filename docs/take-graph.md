---
type: Reference
title: "Takes And The Spend Ledger"
description: "The record VibeFrame keeps of every paid generation: the take format, where takes live, how cost is attributed, promoting a take into a beat slot, and the vibe take commands."
tags: [takes, cost, governance]
---

# Takes And The Spend Ledger

Every paid generation VibeFrame runs leaves a **take**: a record of what was asked, what came back, and what it cost.
A take is written once and never changed.
Takes let you, or the agent working for you, answer three questions after the fact: what did we make, how was it made, and what did it cost.

These commands record takes:

- `vibe generate video` and `vibe generate video-extend`
- `vibe generate image`, `vibe generate thumbnail`, and `vibe edit image`
- `vibe generate narration`, `vibe generate music`, and `vibe generate sound-effect`
- `vibe build`, for every beat asset it generates: narration, backdrop, keyframe, video, and music, plus character sheets

The record is the same whichever surface ran the command: the CLI, an MCP tool, a `vibe run` pipeline step, or a `vibe build` beat.
A slot the build reuses from its cache makes no new take.

## Where takes live

| Where the command ran | Takes directory | Paths in the take |
| --- | --- | --- |
| Inside a VibeFrame project (a directory with `vibe.config.json` or `STORYBOARD.md`) | `<project>/.vibeframe/takes/` | Relative to the project |
| Anywhere else | `~/.vibeframe/takes/` | Absolute |

Each take is one file, `<take id>.json`.
Take ids look like `take_mh2k1x0a_1f2e3d4c`: a base-36 timestamp and 8 random hex digits, so they sort by time.

Every take, in either place, also appends one line to the global ledger, `~/.vibeframe/ledger.jsonl`.
The ledger covers every project on the machine, so you can total spend without searching the disk.
Set `VIBEFRAME_CONFIG_HOME` to move `~/.vibeframe`.

New projects from `vibe init` keep `.vibeframe/takes/` out of their `.gitignore`, so the takes can be committed with the project.
A project take names no absolute path for files inside the project.
Inputs from outside the project (a frame in `~/Downloads`) keep their absolute path.

A project take also keeps a copy of its output bytes in `<project>/.vibeframe/media/<sha256><ext>`.
A build overwrites a slot file every time it regenerates the slot, so this copy is what lets an earlier take be promoted back.
The copy is a copy-on-write clone where the filesystem supports it (APFS, Btrfs), so it costs no space until the slot file changes.
Takes with the same bytes share one copy.
`.vibeframe/media/` is not committed; the take files are.
A global take keeps no copy: its output is the file you asked for.

Set `VIBE_TAKES=off` to stop recording.

## When a take is written

A take is written once the provider was reached:

- a finished generation: `status: "completed"`;
- a job that is still running when the command returns (`--no-wait`, or the wait timed out): `status: "submitted"`, with the provider session so it can be polled;
- a provider failure after the provider accepted the job or billed for it: `status: "failed"`, with the error.

A call refused before any request leaves no take: bad input, a missing key, or a model the catalog has retired.
Image providers report no usage, so a failed image call leaves no take.
A Replicate music job returned without waiting is a `submitted` take with no output.

## Cost and its basis

Every take records a dollar figure and the basis for it.
The basis says how far to trust the figure.

| Basis | Meaning | Example |
| --- | --- | --- |
| `reported` | The provider said what it charged | xAI `cost_in_usd_ticks`, Runway `cost.credits` |
| `metered` | Units we measured, times the catalog list price | Kling seconds at the billed resolution, ElevenLabs characters, Gemini TTS audio seconds; Kokoro narration is metered at its list price of $0 |
| `estimate` | A formula over the request | Seedance token formula, image list price per image |
| `upper-bound` | The command's cost tier ceiling, when nothing better exists | Omni video today |

`reported` and `metered` figures are billing.
`estimate` and `upper-bound` figures are not, and `vibe take log` keeps them separate.
The usage records behind a `reported` or `metered` figure are stored with the take.

## The take format

Schema version `"1"`.
Fields marked optional are left out when they do not apply.

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | `"1"` | Format version |
| `id` | string | Take id |
| `createdAt` | ISO time | When the call started |
| `kind` | `video` \| `image` \| `audio` | What was made |
| `operation` | `generate` \| `edit` \| `extend` | How it was made |
| `parent` | take id, optional | The take this one continues or branches from |
| `status` | `completed` \| `submitted` \| `failed` | See above |
| `provider`, `model` | string | Who made it; `model` is the model the provider served, when known |
| `prompt` | string | The prompt as sent |
| `params` | object | The request as asked: duration, ratio, resolution, seed, quality, and so on |
| `inputs[]` | `{ role, path, sha256?, bytes? }` | Files and URLs the call used; roles `image`, `end-image`, `reference-image`, `reference-video`, `reference-audio`, `source`; a URL input has no hash |
| `outputs[]` | `{ path, sha256, bytes }` | Files the call wrote |
| `session` | object, optional | The provider job handle (`provider`, `id`, `model`, `submittedAt`, `meta`); an Omni job handle is also its multi-turn session |
| `cost` | `{ usd, basis, usage? }` | See above |
| `origin` | `{ via, command, cwd, beatId?, asset? }` | `via` is `cli`, `mcp`, `pipeline`, or `build`; `command` is the command or tool name; `beatId` and `asset` name the beat slot a build made it for |
| `error` | `{ message, kind? }`, optional | Why a failed take failed; `kind` is the provider error kind |

A ledger line holds `takeId`, `createdAt`, `store` (the takes directory), `projectDir` (for a project take), `kind`, `operation`, `status`, `provider`, `model`, `usd`, and `basis`.

## Beat slots and promotion

A build fills up to five slots per storyboard beat:

| Slot | Take kind | Slot file |
| --- | --- | --- |
| `narration` | `audio` | `assets/narration-<beat>.mp3` or `.wav` |
| `backdrop` | `image` | `assets/backdrop-<beat>.png` |
| `keyframe` | `image` | `assets/keyframe-<beat>.png` |
| `video` | `video` | `assets/video-<beat>.mp4` |
| `music` | `audio` | `assets/music-<beat>.mp3` |

The slot's metadata, `.vibeframe/assets/<slot>-<beat>.json`, names the take that filled it (`takeId`).
`vibe take list` marks that take with `inSlot`.

`vibe take promote <take id>` puts an earlier take's output back into its slot.
It copies the preserved bytes into the slot file and records the take and the beat's current cue in the slot metadata (`takeId`, `promotedCue`).
Later builds keep a promoted slot as it is, and the dry-run plan reports it as `promoted-take` at no cost.
Two things regenerate a promoted slot: editing the beat's cue for that slot (for `video`, its `video:` cue, else its `keyframe:` cue), or `vibe build --force`.
The earlier take is never lost; promote it again.

A take made outside a build, such as a `vibe generate narration` run inside the project, fills a slot when you name it: `--beat <id> --asset <slot>`.
The take kind must match the slot, and the beat must have a cue for that slot.
A beat whose cue names a file (`backdrop: assets/photo.png`) uses that file, not a take, and cannot be promoted into.

## Commands

All of these are free and make no provider calls.

```bash
vibe take list --json                       # takes here (project, else global), newest first
vibe take list --kind video --limit 10
vibe take list --beat 3                     # takes a build made for beat 3
vibe take show take_mh2k1x0a_1f2e3d4c --json
vibe take log --since 2026-11-01 --json     # spend here, split by basis
vibe take log --global                      # spend across every project on this machine
vibe take promote take_mh2k1x0a_1f2e3d4c --dry-run --json
vibe take promote take_mh2k1x0a_1f2e3d4c    # put it back into its beat slot
```

MCP hosts get the same as `take_list`, `take_show`, `take_log`, and `take_promote`.
Commands that record a take return its `takeId` in `data`.

## What comes next

Takes are the base of the take graph: branching, comparing, and promoting generations.
Planned on top of this format:

- `vibe take extend` and `vibe take edit` continue a take through its provider session, recording the new take with its parent;
- review findings point at the take that needs work;
- a video job a build leaves running is finished by `vibe status job`, which does not yet record the finished output on a take.
