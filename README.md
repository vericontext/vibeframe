# VibeFrame

**Let your coding agent generate real video, on your own provider keys, under a spend ceiling it cannot cross.**

VibeFrame is a CLI and MCP server for Claude Code, Codex, Cursor, or any bash-capable agent.
It turns a written brief into a plan, generates the assets from frontier models (Seedance, Runway, Veo, Kling), and renders a finished MP4.
Every paid step sits behind a dry run and a hard `--max-cost` ceiling, and every failure comes back as machine-readable recovery actions instead of a stack trace.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/vericontext/vibeframe/actions/workflows/ci.yml/badge.svg)](https://github.com/vericontext/vibeframe/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/vericontext/vibeframe)](https://github.com/vericontext/vibeframe/stargazers)

![One consistent character across a directed arctic night: a trek under the stars, the first aurora, the whole sky ablaze, and the walk home at dawn](docs/media/showcase-aurora.gif)

One photographer across a single arctic night, 1080p, generated end to end.
▶ **[Watch the full render](https://github.com/vericontext/vibeframe/releases/download/v0.113.11/vibeframe-showcase.mp4)**

## Know the price before anything is spent

`--dry-run` prices the whole build without calling a provider or needing a single key.
Pair it with `--max-cost` and the build refuses to start when the estimate is over your ceiling:

```bash
vibe build film --dry-run --max-cost 3 --json
```

```json
{
  "success": false,
  "error": "Estimated cost $10.93 exceeds --max-cost $3.00.",
  "code": "COST_CAP_EXCEEDED",
  "retryWith": [
    "vibe build . --stage all --skip-backdrop --json",
    "vibe build . --stage all --max-cost 10.93 --json"
  ],
  "data": { "plan": { "estimatedCostUsd": 10.93, "...": "the full priced plan" } }
}
```

The envelope goes to stderr and the command exits 1, so an agent loop stops instead of guessing.
`retryWith` gives it the two cheaper ways forward it can take without asking you, and `data.plan` carries the priced plan the refusal was based on, so it never has to re-run just to learn the estimate.

The same dry run names the keys each stage would need, so you find out what a video costs before you own an account:

```text
Keyframe generation will need openai (OPENAI_API_KEY), but no key/config is available.
Video generation will need seedance (FAL_API_KEY), but no key/config is available.
```

Your keys, your bill, your ceiling.

## Where VibeFrame fits

It wraps lower-level composition engines rather than replacing them:

| Layer                                                    | Owns                                                                             |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [Remotion](https://github.com/remotion-dev/remotion)     | React-based programmatic video and component-driven motion graphics.              |
| [Hyperframes](https://github.com/heygen-com/hyperframes) | HTML/CSS/JS scene composition and deterministic browser capture.                  |
| VibeFrame                                                | Frontier-model generation on your own keys, dry runs and the hard `--max-cost` ceiling, storyboard/design files, build reports, render inspection, edit/remix commands, and host-agent guidance. |

Read that table as one sentence: scene composition is delegated, generation is not.
If the job is only HTML scene authoring and rendering, use Hyperframes directly - it is the better tool for that, and `vibe scene install-skill` installs its skill for you either way.
Reach for VibeFrame when the job involves paid generation: frontier image and video models, character continuity across scenes, narration, cost ceilings, build reports, or editing steps around the composition layer.

One consequence worth knowing before you install: the whole pipeline runs locally for $0 without a provider key, because that free half is the delegated half - Kokoro narration, agent-authored HTML/CSS scenes, headless Chrome plus FFmpeg.
It is the cheapest way to see whether the workflow fits you, and the full walkthrough is in [docs/hyperframes.md](docs/hyperframes.md#the-zero-key-render-start-to-finish).
It is not the point of the tool: the paid generation path below is.

VibeFrame is not affiliated with HeyGen.
See [CREDITS.md](CREDITS.md) for dependency and provenance notes.

## Install

```bash
curl -fsSL https://vibeframe.ai/install.sh | bash
vibe doctor
```

Needs **Node.js 20+, FFmpeg, and Chrome** (or Chromium).
`vibe doctor` verifies all three and lists which commands each provider key unlocks.

Generation is the only thing that needs a key.
FFmpeg edits, Kokoro narration, scene composition, detection, timeline work, and rendering are all local.
Add `OPENAI_API_KEY`, `FAL_API_KEY`, `GOOGLE_API_KEY`, `RUNWAY_API_SECRET`, or `KLING_API_KEY` for the providers you actually use, via `vibe setup` or the environment.

<details>
<summary>Package names, config locations, and building from source</summary>

The CLI is published as [`@vibeframe/cli`](https://www.npmjs.com/package/@vibeframe/cli) (binary `vibe`) and the MCP server as [`@vibeframe/mcp-server`](https://www.npmjs.com/package/@vibeframe/mcp-server).
There is no bare `vibeframe` npm package from this project - that name belongs to an unrelated package, so `npx vibeframe` will not run this tool.

The installer places the CLI under the XDG data directory (`~/.local/share/vibeframe` by default).
User-scope keys live in `~/.vibeframe/config.yaml`; `vibe setup --scope project` writes `./.vibeframe/config.yaml`.
When a project config exists at or above your current directory, VibeFrame uses it in isolation and does not merge user-scope keys.

```bash
git clone https://github.com/vericontext/vibeframe.git
cd vibeframe && pnpm install && pnpm build
pnpm vibe --help
```

</details>

## Build a video from a brief

```bash
vibe init launch --from brief.md            # or --from "30-second launch video for VibeFrame"
vibe build launch --dry-run --max-cost 5    # price it
vibe build launch --max-cost 5              # generate
vibe render launch -o renders/final.mp4     # render
vibe inspect render launch --cheap          # check the result
```

`brief.md` can be messy notes, links, or a single line.
What `init` produces is a project you then own:

```text
launch/
  STORYBOARD.md     title, duration, aspect, providers, cast - and the direction prose
  DESIGN.md         palette, typography, layout, motion, transitions
  scenes/
    01-hook.md      one scene per file, in play order
    02-proof.md
    03-close.md
```

Each scene is a markdown file. Its frontmatter carries the cues, its body carries the direction:

```markdown
---
type: Scene
duration: 5
narration: "Start with a storyboard. VibeFrame turns each beat into a render plan."
backdrop: "Clean developer terminal beside structured storyboard cues"
video: "media/broll.mp4"
voice: "alloy"
---

Open on the terminal. Let the storyboard cues land before the camera moves.
```

A cue's value is either a prompt to generate from, or a project-relative path to a file you already have - `video: "media/broll.mp4"` above reuses your footage instead of generating any.

Scenes play in filename order, so `vibe storyboard move` reorders by renumbering. Edit the files directly, or ask a coding agent to research and revise them.
The rest is convention: `media/` for footage you supply, `assets/` for generated ones, `renders/` for output, and `vibe.config.json` for the provider, model, and quality contract.

Add `--json` to any command for structured output.
`plan`, `build`, `preview`, `render`, and both `inspect` commands take `--beat <id>` to work one beat at a time instead of rebuilding everything.
`storyboard`, `status`, and `scene repair` cover editing beats, polling async work, and deterministic fixes.

Those five are the common cues; there are fifteen in all, and `vibe storyboard validate` warns on anything outside them.
Profiles (`--profile minimal | agent | full`), [the full cue vocabulary](docs/projects.md#the-cue-vocabulary), and the whole project flow are in [docs/projects.md](docs/projects.md).

## What the spend buys: one character, many scenes

Generating four shots that look like the same film is the hard part, and it is what the paid path is for.
Declare a character pool in `STORYBOARD.md` and reference it from individual scenes.
VibeFrame generates the character sheet once and reuses it as the reference image for Seedance image-to-video, so the character stays consistent across scenes.

`STORYBOARD.md` declares who exists:

```markdown
---
characters:
  mira: "arctic aurora photographer, deep-red fur-lined parka, dark hair under a charcoal beanie, vintage 35mm camera"
  rival: { image: "media/rival-ref.png" }
---
```

`scenes/01-hook.md` says who is in this shot:

```markdown
---
type: Scene
duration: 5
characters: [mira]
keyframe: "MIRA stands on the frozen ice, camera lowered, looking up as the aurora fills the sky"
video: "slow tilt up as the aurora ripples and pulses overhead"
---
```

Each scene pairs a `keyframe` still with a `video` motion prompt.
Generate the cheap image storyboard first, review it, then animate only the stills you approve.
That is also the cheapest way to keep a run under its ceiling, since stills cost a fraction of the video.

```bash
vibe build my-film --skip-video   # keyframe stills only (cheap) - review them first
vibe build my-film --beat wonder --stage assets --force --skip-video  # redo one beat
vibe build my-film --max-cost 12  # animate the approved stills (image-to-video)
```

Prompt craft for both models lives in the [AI video prompting playbook](docs/ai-video-prompting.md).

## One-off assets and edits

These need no project and no storyboard:

```bash
vibe generate image "cinematic product demo frame" -p openai -o frame.png
vibe generate video "interface animates into a polished demo" -p seedance -i frame.png -o motion.mp4
vibe generate narration "Start with a storyboard." -o narration.mp3

vibe edit silence-cut interview.mp4 -o clean.mp4
vibe edit caption video.mp4 -o captioned.mp4
vibe detect scenes video.mp4

vibe remix highlights demo-process.mp4 -d 60 -o highlight.mp4
vibe audio duck bgm.mp3 --voice highlight.mp4 -o bgm-ducked.mp3
```

For reproducible multi-step workflows, `vibe run pipeline.yaml` executes a budgeted YAML pipeline with `--dry-run` and `--resume`.
Worked examples of all of the above are in [docs/recipes.md](docs/recipes.md).

## Drive it from an agent

Use your host's agent loop as the outer loop, drive the CLI with `--json`, and use `build-report.json` and `review-report.json` as loop state.
The forward pass is the build flow above; what makes it a loop is the recovery pass:

```text
"fix quality issues from the render review"
-> read review-report.json
-> vibe scene repair launch --json
-> edit STORYBOARD.md or composition artifacts only where needed
-> vibe render launch --json
-> vibe inspect render launch --cheap --json
```

`inspect` returns pre-classified `nextActions`: run `safeToAutoRun:true` automatically, ask before `requiresConfirmation:true`, and use `retryWith` only as a fallback.
`fixOwner` says who acts - `"vibe"` means the CLI repairs it deterministically, `"host-agent"` means the outer loop or a human edits the source files.

You do not have to write any of that into your prompt.
`vibe context` prints it, so "read `vibe context`, then build `launch/` from `brief.md` under `--max-cost 5`" is enough to start a host agent.
The full contract with a worked report is in [docs/projects.md](docs/projects.md#host-agent-loop).

To explore the surface:

```bash
vibe schema --list                  # full command catalog, the source of truth
vibe schema --list --surface public # first-run product path only
vibe schema --list --filter free    # narrow to a cost tier
vibe guide                          # workflow guides (motion | scene | pipeline)
```

## Connect your host

`vibe init` writes one `AGENTS.md` (plus a `CLAUDE.md` that imports it).
That is the whole contract: Codex, Cursor, Aider, Gemini CLI, OpenCode, and any other bash-capable agent read the same file, and there is no per-host scaffold.

The CLI is the primary runtime; MCP is for hosts that prefer typed tool calls.
`vibe host` prints config by default, and `--write` applies it:

```bash
vibe host setup all                                   # print snippets for every host
vibe host setup cursor --write                        # write .cursor/mcp.json
vibe host setup claude-desktop ~/dev/videos --write   # pass the workspace dir
vibe host doctor all --json                           # verify what landed
```

**Claude Desktop users:** install the prebuilt extension instead of editing JSON.
Download [vibeframe.mcpb](https://github.com/vericontext/vibeframe/releases/latest/download/vibeframe.mcpb), drop it into **Settings → Extensions**, then pick a workspace folder.

To wire `@vibeframe/mcp-server` (binary `vibeframe-mcp`) by hand, add:

```json
{
  "mcpServers": {
    "vibeframe": {
      "command": "npx",
      "args": ["-y", "@vibeframe/mcp-server"]
    }
  }
}
```

Tool, resource, and prompt details are in [packages/mcp-server/README.md](packages/mcp-server/README.md).

## Reference

- [docs/projects.md](docs/projects.md): project files, profiles, characters, keyframes, and the host agent loop.
- [docs/recipes.md](docs/recipes.md): worked end-to-end examples.
- [docs/hyperframes.md](docs/hyperframes.md): where VibeFrame ends and the composition engine begins, plus the zero-key render.
- [docs/ai-video-prompting.md](docs/ai-video-prompting.md): prompt craft for image and video models.
- [MODELS.md](MODELS.md): provider and model reference.
- [CONTRIBUTING.md](CONTRIBUTING.md): package map, dev setup, tests, and the `pnpm scaffold:*` generators.
- [ROADMAP.md](ROADMAP.md) and [CHANGELOG.md](CHANGELOG.md).

Contributions are welcome: bug fixes, provider integrations, CLI UX improvements, docs, and tests.

## License

MIT. See [LICENSE](LICENSE).
