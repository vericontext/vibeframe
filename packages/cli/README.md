# @vibeframe/cli

**Let your coding agent generate real video, on your own provider keys, under a spend ceiling it cannot cross.**

This is the `vibe` CLI of [VibeFrame](https://github.com/vericontext/vibeframe), for Claude Code, Codex, Cursor, or any bash-capable agent.
It turns a written brief into a plan, generates the assets from frontier models (Seedance, Runway, Kling, Gemini Omni), and renders a finished MP4.
Every paid step sits behind a dry run and a hard `--max-cost` ceiling, and every failure comes back as machine-readable recovery actions instead of a stack trace.

## Install

```bash
npm install -g @vibeframe/cli
vibe doctor
```

Or use the installer: `curl -fsSL https://vibeframe.ai/install.sh | bash`.

Needs **Node.js 20+, FFmpeg, and Chrome** (or Chromium).
`vibe doctor` checks all three and lists which commands each provider key unlocks.

Generation is the only thing that needs a key.
FFmpeg edits, Kokoro narration, scene composition, and rendering run locally.
Add `OPENAI_API_KEY`, `FAL_API_KEY`, `GOOGLE_API_KEY`, `RUNWAY_API_SECRET`, or `KLING_API_KEY` for the providers you use, with `vibe setup` or the environment.

## Build a video from a brief

```bash
vibe init launch --from brief.md            # or --from "30-second launch video"
vibe build launch --dry-run --max-cost 5    # price it, no key needed
vibe build launch --max-cost 5              # generate
vibe render launch -o renders/final.mp4     # render
vibe inspect render launch --cheap          # check the result
```

When the estimate is over `--max-cost`, the build refuses to start and returns `COST_CAP_EXCEEDED` with cheaper `retryWith` commands and the priced plan.

## One-off assets

```bash
vibe generate image "cinematic product demo frame" -p openai -o frame.png
vibe generate video "slow push-in on a paper boat" --dry-run
```

Add `--json` to any command for structured output, and run `vibe schema --list` for every command with its cost tier.

## MCP

The same operations are available as MCP tools in [`@vibeframe/mcp-server`](https://www.npmjs.com/package/@vibeframe/mcp-server).

## Links

- [Project README](https://github.com/vericontext/vibeframe#readme)
- [CLI reference](https://github.com/vericontext/vibeframe/blob/main/docs/cli-reference.md)
- [Models and providers](https://github.com/vericontext/vibeframe/blob/main/MODELS.md)
- [Changelog](https://github.com/vericontext/vibeframe/blob/main/CHANGELOG.md)

MIT licensed.
