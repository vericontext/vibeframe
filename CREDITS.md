# Credits

VibeFrame builds on a generation of open-source video, AI, and agent tooling.
This file is the canonical place where we acknowledge the projects whose
work shapes ours, and where the relationship is documented for anyone
auditing the supply chain.

## Built upon

### Hyperframes — composition runtime + agent skill ecosystem

[Hyperframes](https://github.com/heygen-com/hyperframes) (Apache 2.0) is the
HTML-native, deterministic, agent-first video rendering framework that
VibeFrame uses as its scene rendering backend. Two distinct dependencies:

- **`@hyperframes/producer`** — VibeFrame imports this npm package to render
  scene projects (Chrome BeginFrame deterministic capture + FFmpeg encode).
  Documented since v0.47 as the "experimental Hyperframes backend"; the
  default backend for `vibe scene render` since v0.53.
- **Hyperframes' agent skill ecosystem** — VibeFrame's
  `compose-scenes-with-skills` YAML pipeline action (v0.59+) loads
  Hyperframes' published skill content as the system prompt for
  Claude-driven scene HTML generation. Vendored snapshot lives at
  [`packages/cli/src/commands/_shared/hf-skill-bundle/`](packages/cli/src/commands/_shared/hf-skill-bundle/),
  with the upstream sha + date in
  [its NOTICE](packages/cli/src/commands/_shared/hf-skill-bundle/NOTICE).
  When the user has installed the skill via
  `npx skills add heygen-com/hyperframes` (Hyperframes' documented agent
  install path), VibeFrame uses the installed copy and the vendored
  snapshot is the offline / CI fallback.

The vendored skill content is byte-identical to upstream — no semantic
edits. We mirror Hyperframes' own treatment of prior art (see their
[CREDITS.md](https://github.com/heygen-com/hyperframes/blob/main/CREDITS.md)
"Prior art" section about Remotion).

**VibeFrame is not affiliated with HeyGen or the Hyperframes project.**
We use Hyperframes under its public Apache 2.0 license; any feedback
about how this layering is presented or used should reach the VibeFrame
maintainers, not HeyGen.

### AI providers

13 third-party AI services power the generation, transcription, and
analysis steps. Each is used under its own terms; VibeFrame handles
provider routing and key management but does not redistribute provider
SDK source. See [MODELS.md](MODELS.md) for the full list and per-provider
notes.

- Anthropic Claude (Opus / Sonnet / Haiku families)
- OpenAI (GPT, gpt-image-2, Whisper)
- Google Gemini
- xAI Grok / Grok Imagine
- OpenRouter (300+ models via unified API)
- Ollama (local LLM runtime)
- ElevenLabs (TTS, sound effects, voice clone, audio isolation)
- Kokoro-82M via [`kokoro-js`](https://www.npmjs.com/package/kokoro-js)
  (Apache 2.0; local TTS fallback)
- fal.ai (Seedance video models)
- Runway (Gen-4.5 video)
- Kling (v2.5/v3 video)
- Veo (3.1 video)
- Replicate (MusicGen and other models)

### Tooling

- **FFmpeg** — every traditional editing operation (silence-cut,
  noise-reduce, fade, …) shells out to the system's FFmpeg binary.
- **Puppeteer / Chrome** — drives the Hyperframes producer's BeginFrame
  capture loop.
- **GSAP** — the animation runtime inside scene compositions
  (loaded from CDN at scene-render time; bundled by Hyperframes' producer).
- **Remotion** — `vibe generate motion` shells out to `npx remotion`
  for the React-component motion-graphics path. Optional dependency; only
  invoked when the user explicitly runs that command.
- **Turborepo + pnpm + esbuild + vitest + Anthropic SDK** — build /
  test / packaging stack.

## VibeFrame's own contributions

What VibeFrame implements independently (not borrowed from any of the
above):

- The agent surface — `vibe agent` REPL with BYO LLM, MCP server with
  61 tools, Claude Code skills (`/vibe-pipeline`, `/vibe-scene`).
- The YAML pipeline DSL (`vibe run pipeline.yaml`) — `--dry-run` cost
  preview, `--resume` checkpoints, `$step.output` references, budget
  ceilings.
- Provider routing + auto-fallback (Kokoro local fallback for TTS, gpt-image-2
  for image, fal.ai Seedance for video).
- 84+ CLI commands across generate / edit / analyze / audio / detect /
  pipeline groups.
- The `compose-scenes-with-skills` orchestration layer (v0.59+) — sources
  the skill bundle from Hyperframes, but the per-beat fanout / cache /
  retry-on-lint architecture is independent.
- `vibe scene` 5-preset emit fallback path — generated wholly within
  VibeFrame; no Hyperframes skill content involved on this path.

VibeFrame is licensed under [MIT](LICENSE). The MIT / Apache 2.0
combination is widely deployed and OSI-compatible.

---

If something here is inaccurate or attribution feels light, please open
an issue or PR. We'd rather over-credit than under-credit.
