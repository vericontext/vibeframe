# assets/demos/ — VHS tapes

Reproducible terminal recordings for the VibeFrame docs and landing page,
authored as [VHS](https://github.com/charmbracelet/vhs) `.tape` scripts.

Each tape renders an `.mp4` next to itself when you run `vhs <tape>`.

## Index

### Surface family — full workflows for the four canonical surfaces (1400×900, ~6–12 min)

| Tape | Surface | What it captures | Wall-clock | Cost |
|---|---|---|---|---|
| [`cli.tape`](cli.tape) | 1 — `vibe` directly | Hand-authored STORYBOARD → `vibe scene build` → 12-second cinematic MP4 | ~6 min | ~$0.20 |
| [`agent.tape`](agent.tape) | 2 — `vibe agent` REPL | Single-turn directive → REPL drives the full scene-build flow | ~6 min | ~$0.20 |
| [`host-agent.tape`](host-agent.tape) | 3 — host agent + scene build | curl install → `vibe init` → Claude Code reads `AGENTS.md` → cinematic MP4 | ~12 min | ~$0.20 |
| [`host-agent-i2v.tape`](host-agent-i2v.tape) | 4 — host agent + primitives | Claude Code chains t2i → i2v → narration → mux for a 5-second clip | ~6–8 min | ~$1–$2 |

### Quick-aid family — concept-only snippets for docs (1280×800, ~10–25 s)

| Tape | What it captures | Wall-clock | Cost |
|---|---|---|---|
| [`setup.tape`](setup.tape) | `vibe doctor` → `vibe setup --claude-code` → `vibe setup --show` | ~15s | $0 |
| [`init.tape`](init.tape) | `vibe init . --agent all` → `ls -la` → `head AGENTS.md` | ~10s | $0 |
| [`build.tape`](build.tape) | `vibe scene build . --skip-render` against the cached `vibeframe-promo` fixture | ~25s | $0 (cache hit) |

### Cinematic reference

| File | What it is |
|---|---|
| [`cinematic-v060.mp4`](cinematic-v060.mp4) | The v0.60 hero rendered by `examples/vibeframe-promo/` — embedded in README and landing page |

## How to run

```bash
brew install vhs                       # one-time
vhs assets/demos/<name>.tape           # records to <name>.mp4
```

Example:

```bash
vhs assets/demos/setup.tape            # ~15s, no env vars needed
vhs assets/demos/cli.tape              # ~6 min, needs OPENAI_API_KEY + ELEVENLABS_API_KEY
```

Each tape's header lists its `Prereqs`, required `Env`, and a `Wall-clock` estimate.

## Maintainer notes

- **Hardcoded paths** — tapes assume a writable lab dir at
  `~/dev/personal/lab/vibeframe-lab` (the maintainer's recording sandbox).
  This is intentional: tapes are recorded by the project maintainer to keep
  the repo's MP4s consistent. Contributors don't need to re-record. If you
  want to record locally, change the lab path in the tape header.

- **Trailing dead time** — the surface tapes use generous `Sleep` windows
  to absorb provider transients (gpt-image-2 503s, Seedance i2v queue
  delays). Trim trailing dead frames post-record with:
  ```bash
  ffmpeg -i raw.mp4 -vf "trim=duration=$(printf '%.0f' $(ffprobe ...))" out.mp4
  ```

- **`cli.tape` storyboard** — lives at
  [`fixtures/storyboard-cli.md`](fixtures/storyboard-cli.md). Edit there
  rather than inside the tape, so the recording remains a clean `cp` +
  `vibe scene build` flow.

- **Settings standard** — keep family-level consistency:
  - **Surface family:** FontSize 12 · 1400×900 · Padding 20 · TypingSpeed 30ms · Output `.mp4`
  - **Quick-aid family:** FontSize 14 · 1280×800 · Padding 24 · TypingSpeed 50ms · Output `.mp4`
  - Theme `Catppuccin Mocha` · Shell `bash`
