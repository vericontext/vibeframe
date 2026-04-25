# VibeFrame inside Claude Code

Two routes from a Claude Code session into VibeFrame, in order of decreasing
setup. The README's animated cast covers Route A; this doc has both, plus
the recording recipe.

## Route A — natural-language → `vibe` CLI (no setup)

The default route. If the `vibe` binary is on your PATH (`npm i -g
@vibeframe/cli` or `curl -fsSL https://vibeframe.ai/install.sh | bash`),
Claude Code can drive it from the Bash tool. No MCP config needed.

This is what the [`vibeframe-claude-code.svg`](vibeframe-claude-code.svg)
cast in the README captures — Claude runs `vibe --help`, drills into
`vibe scene --help`, then calls `vibe scene init/add/lint` to satisfy
the prompt. About 12 turns, no manual scaffolding, all the discovery
visible.

The cast is generated from
[`claude-code-demo.sh`](claude-code-demo.sh): the script drives
`claude --print --output-format stream-json --allowed-tools Bash` and
pipes the JSON event stream through a small inline python that renders
it as a Claude-Code-style chat (`⏺` for assistant text, `▸` for Bash
calls, dim grey for stdout previews).

> **Why route A is the default we demo**: it works for any user who has
> the CLI installed, with zero extra config. The MCP route below is
> faster and more typed but adds a setup step.

## Route B — typed MCP tools via `@vibeframe/mcp-server`

Same 62 tools as the standalone `vibe agent`, exposed through MCP. Use
this when you want Claude Code to call vibe operations as first-class
typed tool invocations (not Bash spawns) — better cost surfaces, no
shell-quoting friction, MCP resource access for project state.

### Setup (~1 minute)

Add the VibeFrame MCP server to Claude Code's config. The CLI install is
*not* required for this route — `npx -y @vibeframe/mcp-server` pulls the
bundle on demand.

`~/.config/claude-code/mcp.json` (or whichever config path your install
uses):

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

Reload Claude Code. The 62 vibe tools register automatically — visible via
`/mcp` if your build supports it.

### Same prompt, different surface

Whatever you typed under Route A still works. Claude now calls
`mcp__vibeframe__scene_init`, `…__scene_add`, `…__scene_lint` directly
instead of shelling out. Each call returns structured JSON Claude can
reason about (versus parsing CLI text output), and paid operations
surface a `costEstimateUsd` field for confirmation prompts.

## Tighter loops with Route B

Beyond the basic three-step flow:

1. **Stateful editing** — Claude Code reads the scene HTML files via its
   built-in `Read`, edits them with `Edit`, then calls back into vibe MCP
   for `scene_lint` / `scene_render`. The agent loop composes across
   the MCP server and the IDE's own tools.
2. **Cost transparency** — `pipeline_*` tools surface `costEstimateUsd`
   in the response so Claude Code can ask before spending.
3. **Project resources** — `vibe.project.yaml` is exposed as an MCP
   resource; the host can subscribe to changes.

## Recording recipe (Route A cast)

The committed cast is reproducible from the script — run from repo root:

```bash
# 1. Pre-warm Kokoro so any later narration step doesn't pause for download
vibe scene init /tmp/warm -d 4 --json >/dev/null
vibe scene add x --project /tmp/warm --narration "warm." --tts kokoro \
  --no-transcribe --no-image --json >/dev/null

# 2. Record
asciinema rec assets/demos/vibeframe-claude-code.cast \
  --idle-time-limit=2 \
  --title="VibeFrame inside Claude Code" \
  --command="bash assets/demos/claude-code-demo.sh" \
  --overwrite

# 3. Convert to SVG (svg-term-cli only accepts asciicast v1/v2)
asciinema convert -f asciicast-v2 \
  assets/demos/vibeframe-claude-code.cast /tmp/cc-v2.cast
svg-term --in /tmp/cc-v2.cast \
         --out assets/demos/vibeframe-claude-code.svg \
         --window --width 100 --height 38
```
