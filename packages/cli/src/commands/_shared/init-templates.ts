/**
 * @module _shared/init-templates
 *
 * Templates the `vibe init` (v0.61 C2) project scaffolder writes. Pure
 * string constants + tiny functions; no I/O. The orchestrator decides
 * which files to render based on detected agent hosts.
 *
 * Template philosophy: keep generated content *short* and point at
 * dynamic sources (`vibe schema --list`, `vibe doctor`) instead of
 * baking exhaustive catalogs that go stale across releases. The user is
 * expected to extend these with project-specific guidance.
 */

/**
 * agents.md spec-compliant cross-tool agent declaration. Recognised by
 * OpenAI Codex, Cursor, Aider, Sourcegraph Cody, OpenCode, and (via
 * the @AGENTS.md import) Claude Code. Gemini CLI users may want to
 * also keep a sibling \`GEMINI.md\` since that's its primary context
 * file. Keep this as the canonical source of truth for agent guidance —
 * \`CLAUDE.md\` and \`GEMINI.md\` just import it.
 */
export const AGENTS_MD = `# AGENTS.md

This project uses [VibeFrame](https://github.com/vericontext/vibeframe) —
a CLI for AI-powered video editing. The \`vibe\` command provides 80+
subcommands for video generation, editing, analysis, and pipeline
orchestration. Cost tiers below — **always confirm with the user before
running High / Very High tier commands**.

## Agent host coverage

VibeFrame's CLI works with any bash-capable AI coding agent. Six host
families have first-class auto-detection and scaffolds today:

- **Claude Code** — \`CLAUDE.md\` (this file's import wrapper) +
  \`AGENTS.md\` + \`/vibe-*\` slash commands.
- **OpenAI Codex** — reads \`AGENTS.md\` natively (agents.md spec).
- **Cursor** — reads \`AGENTS.md\` plus \`.cursor/rules/\` for project
  rules; supports MCP via \`.cursor/mcp.json\`.
- **Aider** — reads \`AGENTS.md\` (binary-only detection by VibeFrame).
- **Gemini CLI** — primary context file is \`GEMINI.md\`; also reads
  \`AGENTS.md\` if present.
- **OpenCode** — reads \`AGENTS.md\` (officially supported per
  \`opencode.ai/docs/rules\`); supports MCP via \`.opencode/mcp.json\`.

Run \`vibe doctor\` to see which host(s) the CLI detects in your
environment. Anyone running another bash-capable agent (Continue,
Sourcegraph Cody, etc.) still gets this \`AGENTS.md\` as the universal
fallback.

## Self-discovery

Don't memorise the command surface — read it from the CLI:

\`\`\`bash
vibe --help                    # command groups overview
vibe schema --list             # full machine-readable catalog (80+)
vibe schema generate.video     # JSON Schema for any single command
vibe doctor                    # available providers + system health
vibe walkthrough scene         # step-by-step authoring guide (scene)
vibe walkthrough pipeline      # step-by-step authoring guide (pipeline)
\`\`\`

## Two flows — pick by intent

VibeFrame splits cleanly into two flows. Routing the user's request
correctly is the most important judgement call you'll make.

**BUILD — create new video from text intent.**
Use \`vibe scene build\` with a STORYBOARD.md + DESIGN.md. The
skills-driven pipeline (v0.60+) dispatches narration TTS + backdrop
image-gen per beat, composes scene HTML via the Hyperframes skill
bundle, then renders to MP4. Idempotent re-runs reuse cached assets.

**PROCESS — transform existing video / audio.**
Use \`vibe pipeline\`, \`vibe edit\`, or \`vibe audio\`. One-shot,
batch-oriented operations on a file the user already has on disk.

Decision rule: if the user is starting from intent (a script, a brand,
an idea), it's BUILD. If the user is starting from a media file, it's
PROCESS.

## Common workflows

### BUILD (new video from text)

| Task | Command |
|---|---|
| One-shot storyboard → MP4 | \`vibe scene build [project-dir]\` |
| Render an existing scene project | \`vibe scene render -o out.mp4\` |
| Lint scene HTML | \`vibe scene lint --json\` |
| Generate a single image | \`vibe generate image "prompt" -o img.png --quality hd\` |
| Generate a single video | \`vibe generate video "prompt" -i image.png -o clip.mp4\` |
| Generate narration | \`vibe generate speech "text" -o voice.mp3\` |

### PROCESS (transform existing media)

| Task | Command |
|---|---|
| Extract highlights from a long video | \`vibe pipeline highlights file.mp4 -d 60\` |
| Long video → vertical shorts | \`vibe pipeline auto-shorts file.mp4 -n 3 --add-captions\` |
| Add animated word-by-word captions | \`vibe pipeline animated-caption file.mp4 -s karaoke-sweep\` |
| Remove silence | \`vibe edit silence-cut in.mp4 -o out.mp4\` |
| Add static captions | \`vibe edit caption in.mp4 -o out.mp4\` |
| Translate audio (transcribe → TTS) | \`vibe audio dub file.mp4 -t ko\` |
| Transcribe (Whisper, word-level) | \`vibe audio transcribe file.mp4 --granularity word\` |
| Analyze a video | \`vibe analyze video file.mp4 "summarise"\` |

### Compose pipelines (Video as Code)

| Task | Command |
|---|---|
| Run a YAML pipeline | \`vibe run pipeline.yaml --dry-run\` |
| Resume from last checkpoint | \`vibe run pipeline.yaml --resume\` |

## Cost tiers

| Tier | Examples | Approx. per call |
|---|---|---|
| **Free** | \`detect *\`, \`edit silence-cut/fade/noise-reduce\`, \`schema\`, \`project\`, \`timeline\` | $0 |
| **Low** | \`analyze *\`, \`audio transcribe\`, \`generate image\` | $0.01–$0.10 |
| **High** | \`generate video\`, \`edit image\` | $1–$5 |
| **Very High** | \`pipeline *\` (highlights, auto-shorts, regenerate-scene), \`scene build\` | $5–$50+ |

## Agent invariants

When you run vibe commands programmatically:

1. **Always \`--json\`** for structured output you can parse without regex
2. **Always \`--dry-run\` first** for any High/Very-High tier command — it returns
   the cost estimate without spending API budget
3. **Use \`vibe schema <command>\`** to discover parameters; do not guess flags
4. **Pass complex options via \`--stdin\`**:
   \`\`\`bash
   echo '{"video":"long.mp4","count":3,"aspect":"9:16"}' | vibe pipeline auto-shorts --stdin --json
   \`\`\`

## Provider keys

API keys live in \`.env\` (gitignored). Copy \`.env.example\` to start. Run
\`vibe doctor\` to see which keys are currently detected and which providers
they unlock.

### Hyperframes skill (scene HTML rules)

\`vibe scene init\` installs the Hyperframes skill into your project. The
universal copy lives at \`SKILL.md\` (with \`references/*.md\`), and
host-specific copies are placed where each agent expects them
(\`.claude/skills/hyperframes/\` for Claude Code, \`.cursor/rules/hyperframes.mdc\`
for Cursor). **Read \`SKILL.md\` before authoring any scene composition HTML
under \`compositions/\`** — it defines the framework rules, motion
principles, type system, and visual-identity hard-gate. The same skill
governs \`vibe scene lint\` so your authored HTML and the linter stay in
agreement.

To retro-install on a project scaffolded before this command existed, run
\`vibe scene install-skill [--host all]\`.

### Scene composer (batch / non-agent fallback)

When you don't want to author HTML yourself, \`vibe scene build\` runs an
LLM internally with the same skill bundle. It auto-picks a provider based
on available keys (\`claude > gemini > openai\`) — pass \`--composer <name>\`
to force one:

| Provider | Env var | Spike notes (v0.70) |
|---|---|---|
| Claude (default) | \`ANTHROPIC_API_KEY\` | ~9 s/beat. Fastest, validated baseline. |
| Gemini | \`GOOGLE_API_KEY\` | ~20 s/beat. ~2.6× cheaper than Claude. |
| OpenAI | \`OPENAI_API_KEY\` | ~70 s/beat. gpt-5 reasoning latency — opt-in only. |

All three pass first-shot lint at every effort tier on the \`vibeframe-promo\`
fixture. Quality on more complex storyboards may differ — fall back to
\`--composer claude\` if a non-default provider repeatedly fails lint.

## Project conventions

<!-- Edit this section with YOUR project's specifics. Examples below. -->

- Default aspect ratio: ${"`16:9`"}
- Default scene duration: ${"`3 seconds`"} (per beat)
- Brand voice: <describe>
- Output naming: \`renders/<name>-<timestamp>.mp4\`
`;

/**
 * Claude Code project file. Imports AGENTS.md so guidance stays
 * single-sourced; adds Claude-specific overrides (slash commands, etc.).
 */
export const CLAUDE_MD = `@AGENTS.md

# Claude Code overrides

This file imports \`AGENTS.md\` (above) — that's the canonical source.
Add anything Claude-Code-specific *below*; everything generic should
stay in AGENTS.md so other agent hosts (Codex, Cursor, Aider, Gemini CLI, OpenCode) see it
too.

## Skills

If you ran \`vibe init\` with Claude Code detected, the VibeFrame skill
pack is available as slash commands (consolidated to 2 in v0.62 — the
overview content moved into AGENTS.md above):

- \`/vibe-pipeline\` — YAML pipeline authoring helper (Video as Code)
- \`/vibe-scene\` — per-scene HTML authoring + \`vibe scene build\`

To install / update them later:

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/vericontext/vibeframe/main/scripts/install-skills.sh | bash
\`\`\`

## Project-specific guidance

<!-- Add Claude-specific notes here: which sub-agents to prefer, custom
     slash commands you've added, conversational style preferences, etc. -->
`;

/** Shape the init renderer can fill in for the .env.example body. */
export interface EnvExampleOptions {
  /** When true, surfaces a "tier: free local fallbacks" section at the top. */
  withLocalFallbackHeader?: boolean;
}

/**
 * .env.example covering all 13 providers VibeFrame integrates, grouped
 * by tier so a new user can skip "premium / paid" without losing sight
 * of the free path.
 */
export function renderEnvExample(opts: EnvExampleOptions = {}): string {
  const fallback = opts.withLocalFallbackHeader === false
    ? ""
    : `# ── Local fallbacks (no key needed) ─────────────────────────────────────
# Kokoro TTS (local, ~330MB on first call)  →  works without ELEVENLABS_API_KEY
# FFmpeg silence-cut / fade / noise-reduce  →  works with no AI keys at all
# Run \`vibe doctor\` to see what's currently detected.

`;
  return `# VibeFrame API keys — copy this file to \`.env\` and fill in what you need.
# Free local fallbacks work without any keys. See README for the full list.

${fallback}# ── LLM provider for \`vibe agent\` (pick one) ────────────────────────────
ANTHROPIC_API_KEY=                    # Claude — recommended default
OPENAI_API_KEY=                       # GPT-5-mini · Whisper · gpt-image-2
GOOGLE_API_KEY=                       # Gemini · Veo
XAI_API_KEY=                          # Grok image+video
OPENROUTER_API_KEY=                   # multiplexes any provider above
# OLLAMA_HOST=http://localhost:11434  # offline, no key needed

# ── Media providers ─────────────────────────────────────────────────────
ELEVENLABS_API_KEY=                   # paid TTS / SFX / music (Kokoro is the free fallback)
FAL_KEY=                              # Seedance 2.0 — default video provider since v0.57
RUNWAY_API_SECRET=                    # Runway Gen-4.5 video
KLING_API_KEY=                        # Kling video
REPLICATE_API_TOKEN=                  # MusicGen, real-esrgan, etc.
IMGBB_API_KEY=                        # public image hosting (rare — some Replicate flows need it)
`;
}

/** Lines vibe init merges into the project's .gitignore (idempotent). */
export const GITIGNORE_ADDITIONS = `
# VibeFrame
.env
.env.local
renders/
.pipeline-state.yaml
*.vibe.json
.vibeframe/
`;

/**
 * vibe.project.yaml minimal scaffold. Only written when no project
 * config exists — `vibe init` never overwrites an existing file unless
 * --force.
 */
export function renderProjectYaml(opts: { name: string }): string {
  return `# VibeFrame project config. Used by \`vibe scene render\` to name
# outputs and by \`vibe scene build\` for default providers / budget.
name: ${opts.name}
aspect: "16:9"
defaults:
  exportQuality: standard

# Optional — uncomment to set per-primitive provider preferences.
# providers:
#   tts: elevenlabs       # auto | elevenlabs | kokoro
#   image: openai         # openai | gemini
#   music: elevenlabs

# Optional — cap total spend per pipeline run.
# budget:
#   maxUsd: 5.00
`;
}
