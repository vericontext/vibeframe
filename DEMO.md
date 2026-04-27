# VibeFrame Demo

Four steps from `curl install.sh | bash` to a rendered MP4 — every step is
copy-pasteable and produces a real artifact on disk.

> The screen recordings below are produced by the three [VHS](https://github.com/charmbracelet/vhs)
> tapes in [`assets/demos/`](assets/demos/). To regenerate them after
> changes, install vhs (`brew install vhs`) and run
> [`scripts/record-vhs.sh`](scripts/record-vhs.sh).

| Step | Command | Scope | What happens |
|---|---|---|---|
| 1. Install | `curl -fsSL https://vibeframe.ai/install.sh \| bash` | global | Installs the `@vibeframe/cli` npm package |
| 2. Setup | `vibe setup` | user (~/) | API keys + LLM provider, once per machine |
| 3. Init | `vibe init my-promo` | project | Scaffolds AGENTS.md / CLAUDE.md / .env.example / .gitignore / vibe.project.yaml |
| 4. Build | `vibe scene build my-promo` | project | STORYBOARD.md → narration TTS → backdrop image-gen → compose → MP4 |

Steps 2-4 each have a recording below. Step 1 is just an `npm install`
under the hood and isn't worth a GIF.

---

## 1. Install

```bash
curl -fsSL https://vibeframe.ai/install.sh | bash
# or
npm install -g @vibeframe/cli

vibe doctor                                   # confirm Node 20+, FFmpeg, Chrome
```

`vibe doctor` is the entry point throughout — it's scope-aware (since
v0.61), so it tells you what's missing and which command fixes it
(`vibe setup` for user scope, `vibe init` for project scope).

---

## 2. Setup — user scope (once per machine)

> 📼 [`assets/demos/setup.tape`](assets/demos/setup.tape) — VHS recipe. Run `vhs assets/demos/setup.tape` to capture a fresh GIF locally.

`vibe setup` is interactive — it detects which agent hosts you have
installed (Claude Code / Codex / Cursor / Aider) and offers to install
the matching skill packs. API keys go to `~/.vibeframe/config.yaml`,
gitignored by design.

```bash
vibe setup                  # interactive wizard
vibe setup --full           # all 13 providers, no prompts
vibe setup --show           # show current config (masks API keys)
vibe setup --claude-code    # Claude Code integration cheat-sheet
```

You only need one LLM key to get going (the wizard recommends Anthropic
for Claude Code-driven flows). Local fallbacks work without any keys —
[Kokoro TTS](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX)
and FFmpeg-only edits (`silence-cut`, `fade`, `noise-reduce`).

---

## 3. Init — project scope (once per project)

> 📼 [`assets/demos/init.tape`](assets/demos/init.tape) — VHS recipe. Run `vhs assets/demos/init.tape` to capture a fresh GIF locally.

`vibe init` writes the agent-aware project files. The default
`--agent auto` reads which agent host you have configured and picks the
right files; `--agent all` writes both `AGENTS.md` (cross-tool, follows
the [agents.md spec](https://agents.md)) and `CLAUDE.md` (Claude Code,
imports `@AGENTS.md` so guidance stays single-sourced).

```bash
vibe init my-promo                  # auto-detect host
vibe init my-promo --agent all      # write CLAUDE.md + AGENTS.md
vibe init my-promo --agent codex    # cross-tool only
vibe init my-promo --dry-run        # preview file list, no writes
```

Idempotent by default — re-running won't overwrite your edits.
`--force` opts in to overwrite.

After init, hand the directory to **any agent host**:

```bash
cd my-promo
claude                              # Claude Code reads CLAUDE.md
codex                               # Codex reads AGENTS.md
cursor .                            # Cursor reads AGENTS.md
```

---

## 4. Build — STORYBOARD.md → MP4

> 📼 [`assets/demos/build.tape`](assets/demos/build.tape) — VHS recipe. Run `vhs assets/demos/build.tape` to capture a fresh GIF locally.

`vibe scene build` is the v0.60 one-shot driver. Author your storyboard
once, then this command:

1. Reads frontmatter + per-beat YAML cues
2. Dispatches narration TTS + backdrop image-gen per beat (parallel fanout)
3. Composes scene HTML via the v0.59 `compose-scenes-with-skills` pipeline
4. Renders to MP4 through the Hyperframes producer

````markdown
<!-- STORYBOARD.md -->
## Beat hook — Hook

```yaml
narration: "Type a YAML."
backdrop: "Abstract minimalist tech aesthetic, electric blue glow"
duration: 3
```
````

```bash
vibe scene build my-promo                 # storyboard → MP4
vibe scene build my-promo --skip-render   # compose only (review HTML first)
vibe scene build my-promo --dry-run       # preview cost
vibe scene build my-promo --force         # re-dispatch even cached primitives
```

Idempotent: existing `assets/narration-*` / `assets/backdrop-*` are
reused, so iteration is cheap. The cinematic
[v0.60 demo MP4](assets/demos/cinematic-v060.mp4) is the output of this
exact flow against [`examples/vibeframe-promo/`](examples/vibeframe-promo/) —
~$0.18 fresh, $0 cached.

For YAML-pipeline form (multi-step orchestration, budget guards, resume):

```yaml
# scene-promo.yaml
name: my-promo
budget: { costUsd: 2.00 }
steps:
  - id: build
    action: scene-build
    project: my-promo
    quality: hd
```

```bash
vibe run scene-promo.yaml --dry-run       # preview cost
vibe run scene-promo.yaml                 # execute
vibe run scene-promo.yaml --resume        # retry from last checkpoint
```

See [`examples/scene-promo-pipeline.yaml`](examples/scene-promo-pipeline.yaml)
for the reference fixture.

---

## Three agent hosts, one project

Once `vibe init` has scaffolded the project, every supported agent host
sees the same guidance:

| Host | File read | How it integrates |
|---|---|---|
| Claude Code | `CLAUDE.md` (imports `@AGENTS.md`) | Slash commands `/vibe-pipeline`, `/vibe-scene` (install via [`scripts/install-skills.sh`](scripts/install-skills.sh)) |
| Codex | `AGENTS.md` | CLI shell access; agent reads `vibe schema --list` for tool catalog |
| Cursor | `AGENTS.md` | Same; pairs with `.cursor/mcp.json` if you also want MCP |

For Claude Desktop / any MCP-only host, drop the `vibe` package in via:

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

Config locations:

| Host | Path |
|---|---|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Cursor | `.cursor/mcp.json` in the workspace |

---

## Standalone agent REPL (`vibe agent`)

If you want natural-language editing without spinning up Claude Code or
any MCP host, the standalone REPL discovers the same tools the MCP
server exposes:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
vibe agent                             # default: Claude
vibe agent -p ollama --model llama3.1  # offline, no key
vibe agent --max-turns 6 --json        # CI/cron mode
```

Once the REPL is open, ask in plain English. The agent picks tools from
their JSON Schema, runs them via the same code path as the CLI, and
shows the trace inline so you can replay any step verbatim in your shell.

---

## Cleanup

```bash
rm -rf my-promo                         # whatever you named the project
# user scope removal (rare)
rm ~/.vibeframe/config.yaml
```

---

## Where to next

| You want to… | Read |
|---|---|
| See every CLI command at a glance | `vibe --help` or [README › CLI Reference](README.md#cli-reference) |
| Author a multi-step pipeline as code | [`examples/`](examples/), [`docs/cookbook.md`](docs/cookbook.md) |
| Compare scene render vs. raw Hyperframes | [`docs/comparison.md`](docs/comparison.md) |
| Track what's coming next | [`ROADMAP.md`](ROADMAP.md) |
