# VibeFrame Functions

This is the practical command-routing reference for VibeFrame. It describes the
current user-facing mental model: choose the right lane, keep the source of
truth clear, and let agents use JSON, schemas, dry runs, and project files
instead of guessing.

For deeper product-surface planning and future command classification, see
`FUNCTIONS-TOBE.md`. That file is a design plan, not the shortest first-run
reference.

## The Three Lanes

| Lane             | Use it when...                                        | Source of truth               | Common commands                                                 |
| ---------------- | ----------------------------------------------------- | ----------------------------- | --------------------------------------------------------------- |
| BUILD            | You want a complete video from a brief or storyboard  | `STORYBOARD.md` + `DESIGN.md` | `vibe init`, `storyboard`, `plan`, `build`, `render`, `inspect` |
| GENERATE / ASSET | You need one standalone image, clip, voice, or music  | The prompt and provider flags | `vibe generate image`, `video`, `narration`, `music`, `motion`  |
| EDIT / REMIX     | You already have media and want to change or reuse it | The existing media file       | `vibe edit`, `vibe remix`, `vibe audio`, `vibe detect`          |

Agents should pick the narrowest lane that satisfies the user request. A direct
request for an image, video clip, narration, music, or SFX asset should not be
promoted into a full storyboard project unless the user asks for a complete
video.

## BUILD

Use BUILD for storyboard-driven videos, explainers, demos, product clips, and
multi-scene motion pieces.

```bash
vibe setup --scope project
vibe init launch --from brief.md

# Edit the source files:
# - launch/STORYBOARD.md
# - launch/DESIGN.md

vibe storyboard validate launch --json
vibe plan launch --json
vibe build launch --dry-run --json
vibe build launch --json
vibe inspect project launch --json
vibe render launch --json
vibe inspect render launch --cheap --json
```

`STORYBOARD.md` controls story intent: beats, narration, duration, and asset
cues. `DESIGN.md` controls visual execution: palette, typography, composition,
motion language, transitions, and anti-patterns.

Use `vibe build --stage assets` when assets need to be regenerated separately.
Use `--skip-backdrop`, `--skip-narration`, `--skip-video`, or `--skip-music`
when a task should avoid provider spend for that stage.

## GENERATE / ASSET

Use GENERATE / ASSET when the user asks for a single generated asset.

```bash
vibe generate image "editorial benchmark dashboard for frontier AI models" -o image.png
vibe generate video "slow camera push through a clean product interface" -o clip.mp4
vibe generate narration "Choose the model for the workload." -o narration.wav
vibe generate music "restrained electronic bed, 40 seconds" -o bgm.mp3
```

This lane is prompt-first. Do not edit `STORYBOARD.md` or `DESIGN.md` just to
create one asset. Use provider flags and explicit output paths when the caller
needs a specific model or file.

## EDIT / REMIX

Use EDIT / REMIX when the input is existing media.

```bash
vibe edit caption input.mp4 -o captioned.mp4
vibe edit silence-cut input.mp4 -o tightened.mp4
vibe remix highlights demo-process.mp4 -o highlight.mp4
vibe audio duck voiceover.wav bgm.mp3 -o bgm-ducked.mp3
```

This lane should preserve the user's media as the source of truth. Use it for
captions, BGM, voiceover mixing, motion overlays, reframing, silence cuts,
highlight reels, shorts, and remix workflows.

## Agent Contract

- Prefer `--json` for machine-readable output.
- Use `vibe build --dry-run` before provider-heavy builds.
- Use `--max-cost` when the user gives a budget or when the operation may spend
  meaningful provider money.
- Use project scope for project-local keys: `vibe setup --scope project`.
- Run commands from the parent project root when the project-scoped config lives
  there and the video directory is a child.
- Use `vibe doctor --json` to verify provider availability before blaming model
  or pipeline behavior.
- Use `vibe schema --list --surface public` and `vibe schema <command> --json`
  instead of inventing command flags.

## Live References

```bash
vibe guide
vibe guide scene
vibe guide motion
vibe schema --list --surface public
vibe schema <command> --json
vibe context
```

`README.md` is the first-run overview. `MODELS.md` tracks providers and model
choices. `CHANGELOG.md` records release changes.
