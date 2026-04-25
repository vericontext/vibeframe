# VibeFrame inside Claude Code (MCP)

A walkthrough of using VibeFrame from a Claude Code session via the MCP
server. Same 62 tools as the standalone agent — different surface.

> **Recording status**: text walkthrough below; a screen-capture
> [`claude-code-walkthrough.mp4`](claude-code-walkthrough.mp4) replaces this
> placeholder once the maintainer records it
> (macOS Cmd+Shift+5 → record selection → drop the file alongside this
> markdown). The text steps below match the on-screen flow exactly.

## One-time setup (~1 minute)

Add the VibeFrame MCP server to Claude Code's config. The CLI install is
*not* required — `npx -y @vibeframe/mcp-server` pulls the bundle on demand.

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

## The walkthrough (≈90 seconds, 5 prompts)

### 1. Scaffold a scene project

> **You:** "Use vibeframe to scaffold a 16:9 scene project named
> `claude-demo` with 12 seconds of root duration."

Claude calls `scene_init` exactly once, prints the file list it created, and
asks if you want to add scenes.

### 2. Add a narrated scene

> **You:** "Add an explainer scene with the headline 'AI-native video
> editing' and the narration 'Each word lights up the moment it is
> spoken.' Use Kokoro for TTS so it stays free, no images, 6 seconds."

Claude calls `scene_add` with `--tts kokoro --no-image`. The first call
downloads the ~330 MB Kokoro model (Claude shows a warning); subsequent
calls are instant. The MCP response includes the wav path, transcript JSON
path, and the scene HTML path.

### 3. Verify

> **You:** "Lint the project — show me a summary, not the raw JSON."

Claude calls `scene_lint`, parses the result, and surfaces the headline
("0 errors, 4 informational notices about CDN script hoisting — safe to
ignore"). This is the moment to notice that the agent isn't just relaying
output; it's grading it.

### 4. Render

> **You:** "Render to MP4. Use draft quality, 24 fps, 6 capture workers."

Claude calls `scene_render` with the right flags. Streams the producer's
progress lines back into the chat. About 10 seconds later it reports the
output path with `audioMuxApplied: true` — the v0.55 audio-mux pass added
the AAC track on top of the producer's silent video.

### 5. Iterate

> **You:** "Change the headline to 'Edit text, not pixels' and re-render
> just that scene."

Claude rewrites the scene HTML directly (no re-prompting an LLM, no
regenerating opaque MP4s — that's the editable-HTML payoff) and calls
`scene_render` again.

## Why the MCP surface matters

- **Same tools as `vibe agent`** — VibeFrame's 62 agent tools are the same
  set the MCP server exposes. Claude Code, Cursor, or any MCP host gets
  parity with the standalone REPL.
- **Stateful editing** — Claude Code can read the scene HTML files
  directly via its built-in `Read` tool, edit them with `Edit`, then call
  back into vibe MCP for `scene_lint` / `scene_render`. The agent loop is
  composable across MCP servers.
- **Cost transparency** — every paid tool surfaces `costEstimateUsd` in
  the MCP response so the host can show the user before spending.

## Recording recipe (for the maintainer)

When you're ready to drop a screen capture in here:

```bash
# 1. Pre-warm Kokoro so the demo doesn't pause for the model download
vibe scene init /tmp/warm -d 4 --json >/dev/null
vibe scene add x --project /tmp/warm --narration "warm." --tts kokoro \
  --no-transcribe --no-image --json >/dev/null

# 2. Open Claude Code, confirm /mcp shows vibeframe tools

# 3. Cmd+Shift+5 → "Record Selected Portion" — drag around the chat area

# 4. Run through the 5 prompts above

# 5. Stop recording → trim with QuickTime → export .mp4 (1080p)

# 6. Drop the file as assets/demos/claude-code-walkthrough.mp4
#    Update README's "Use with Claude Code" section to link it.
```

GIF alternative for README inline embed (smaller, plays automatically on
GitHub):

```bash
# Convert .mp4 → .gif (~3 MB for 90s, lossy but enough)
ffmpeg -i claude-code-walkthrough.mp4 \
  -vf "fps=10,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  claude-code-walkthrough.gif
```
