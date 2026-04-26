# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.60.0] - 2026-04-26

### Added

- vibe scene build — one-shot storyboard → MP4 (v0.60 C3) (#135) *(scene)*
- YAML frontmatter + per-beat cues (v0.60 C2) (#133) *(storyboard)*

### Fixed

- bake timeline-duration rule into compose-scenes prompt (v0.60 demo black-hold fix) (#131) *(scene)*
- drop -q shorthand from quality flags (collides with --quiet) (#130) *(cli)*

### Maintenance

- commit v0.60 cinematic MP4 + restore MP4 hero on /demo (#132) *(demo)*

## [0.59.0] - 2026-04-26

### Added

- vibeframe-promo end-to-end pipeline (v0.59 C7) (#128) *(examples)*
- per-beat fanout + onProgress callback (v0.59 C6) (#127) *(scene)*
- register compose-scenes-with-skills action (v0.59 C5) (#126) *(pipeline)*
- lint retry loop wraps composeBeatHtml (v0.59 C4) (#125) *(scene)*
- single-beat Claude composer + input-hash cache (v0.59 C3) (#124) *(scene)*
- parse STORYBOARD.md into beats (v0.59 C2) (#123) *(scene)*
- vendor Hyperframes skill bundle for compose-scenes-with-skills (v0.59 C1) (#122) *(skills)*

### Changed

- remove deprecated 'narrations' field — use narrationEntries throughout (#118) *(pipeline)*
- drop 3 deprecated composite helpers (-96 lines) (#116) *(remotion)*
- strip continuous body-motion helpers (Pass 2 simplification) (#113) *(scene-emit)*
- extract shared OpenAI image helper (closes #58) (#112) *(image)*

### Documentation

- commit-by-commit plan for compose-scenes-with-skills (#121) *(v0.59)*
- slim 312→103 lines, point to ROADMAP-v0.58.md as canonical (#120) *(roadmap)*
- add catalog README, link from main README (#119) *(examples)*
- restore asciinema embeds + add v0.58 callout (R1 stopgap) (#114) *(demo)*

### Fixed

- cast commander strings to ImageOptions unions in shared helper (#115) *(image)*

### Maintenance

- drop vestigial entries for tracked dev docs (#117) *(gitignore)*

### Testing

- end-to-end smoke harness for compose-scenes-with-skills (C8) (#129) *(v0.59)*
- pre-flight experiment validates compose-scenes-with-skills hypothesis (#111) *(v0.59)*

## [0.58.0] - 2026-04-26

### Added

- DESIGN.md hard-gate + 8 visual styles (v0.58.0) (#107) *(scene)*
- comprehensive 5-scene dogfood with gpt-image-2 backdrops (#103) *(demo)*
- idle hero pulse + tighter durations (kill the dead body) (#102) *(scene)*
- crossfade transitions + bumped Ken-Burns (kill the pause) (#100) *(scene)*
- robust emit defaults — Ken-Burns motion + auto-fit text (#98) *(scene)*

### Documentation

- mark surface recordings 'coming soon' + rebuild DEMO.md follow-along (#108) *(demo)*
- honest positioning vs Hyperframes (build-on, not compete) (#96) *(readme)*
- refresh landing copy + share metadata for v0.57 defaults (#93) *(web)*

### Fixed

- treat --duration as minimum so narration never gets clipped (#109) *(scene)*
- z-index inversion eliminates mid-overlap luma dip (#101) *(scene)*
- restore narration on the v0.55 self-promo MP4 (audio was missing) (#99) *(demo)*
- MCP tool count is 58, not 59 (test fixtures over-count) (#97) *(counts)*

### Maintenance

- standardise README comparison table on 58 MCP tools + harden sync hook (#110) *(counts)*
- drop orphan binaries + components after hero pivot (#106) *(demo)*
- drop synthesised hero MP4, lead with asciinema, set v0.58 roadmap (#105) *(demo)*
- broaden sync drift detection (catches today's 7 missed cases) (#95) *(hooks)*

## [0.57.3] - 2026-04-25

### Documentation

- refresh AI provider list for v0.56 / v0.57 (#91) *(readme,web)*

### Fixed

- refresh onboarding for fal + Kokoro defaults (v0.57.3) (#92) *(cli)*

## [0.57.2] - 2026-04-25

### Fixed

- provider priority resolves correctly when multiple keys are set (v0.57.2) (#90) *(cli)*

## [0.57.1] - 2026-04-25

### Fixed

- allow -p fal in vibe generate video (v0.57.1) (#89) *(cli)*

## [0.57.0] - 2026-04-25

### Added

- add fal.ai provider hosting Seedance 2.0 (v0.57.0) (#88) *(fal)*

## [0.56.0] - 2026-04-25

### Added

- default text-to-image to OpenAI gpt-image-2 (v0.56.0) (#86) *(image)*

### Documentation

- polish v0.55 self-promo — unified visuals, BGM, no black tail (#84) *(web)*
- refresh /demo page with v0.55 self-promo + 3-surface section (#83) *(web)*
- clearer quickstart + agent-mode + Claude Code walkthrough (#82) *(demos)*
- vibe scene render vs npx hyperframes render (#81) *(comparison)*

### Fixed

- drop tail fade-out from announcement + simple presets (#85) *(scene)*

## [0.55.2] - 2026-04-25

### Documentation

- asciinema quickstart embed in README (#79) *(demo)*

### Fixed

- auto TTS fallback to Kokoro + actionable FFmpeg message (v0.55.2) (#80) *(cli)*

## [0.55.1] - 2026-04-25

### Fixed

- bundle CLI with esbuild so npm install actually works (v0.55.1) (#78) *(cli)*

## [0.55.0] - 2026-04-25

### Added

- post-render ffmpeg audio mux (v0.55 c2/3) (#76) *(scene)*
- scene-audio-scan helper for post-render mux (v0.55 c1/3) (#75) *(scene)*

### Maintenance

- release v0.55.0 — audio in rendered MP4 (v0.55 c3/3) (#77)

## [0.54.0] - 2026-04-25

### Added

- word-by-word GSAP timing in emitSceneHtml (v0.54 c5/6) (#72) *(scene)*
- auto Whisper transcribe + --narration-file (v0.54 c4/6) (#71) *(scene)*
- TTS router with Kokoro fallback + --tts flag (v0.54 c3/6) (#70) *(scene)*
- local Kokoro-82M TTS provider (v0.54 c2/6) (#69) *(kokoro)*
- word-level timestamps via granularity option (v0.54 c1/6) (#68) *(whisper)*

### Documentation

- TTS + word-sync examples, skill, smoke (v0.54 c6/6) (#73) *(scene)*

## [0.53.0] - 2026-04-25

### Added

- scene_init/add/lint/render tools + MCP mirror (MVP 1 c6/8) (#65) *(agent)*
- script-to-video --format scenes (MVP 1 c5/8) (#64) *(pipeline)*
- vibe scene render via Hyperframes producer (MVP 1 c4/8) (#63) *(scene)*
- vibe scene lint via runHyperframeLint (MVP 1 c3/8) (#62) *(scene)*
- add template-based vibe scene add (MVP 1 c2/8) (#61) *(scene)*
- scaffold vibe scene init + bilingual project layout (MVP 1 c1/8) (#60) *(scene)*
- auto-tag main on version bump (closes #51) (#59) *(ci)*

### Documentation

- /vibe-scene skill + scene-promo example + README (MVP 1 c7/8) (#66) *(scene)*

## [0.52.1] - 2026-04-24

### Fixed

- wire gpt-image-2 alias in "vibe generate image" (#57) *(generate)*

## [0.52.0] - 2026-04-24

### Added

- add GPT-Image-2 opt-in support (#56) *(openai-image)*

## [0.51.0] - 2026-04-24

### Added

- bump opus alias to Claude Opus 4.7 (#55) *(motion)*

## [0.50.0] - 2026-04-24

### Added

- Lottie overlay via Hyperframes backend (closes #41) (#54)

### Fixed

- bump @hyperframes/producer 0.4.4 → 0.4.6 (+ webgpu types) (#53) *(deps)*

## [0.49.1] - 2026-04-19

### Changed

- dedup CLI over executeScriptToVideo / executeRegenerateScene (#48)

### Fixed

- surface provider errors + correct billing hint for 429 balance (#50) *(pipeline)*

## [0.48.6] - 2026-04-19

### Fixed

- regenerate-scene reads YAML or JSON storyboard (#47) *(pipeline)*

## [0.48.5] - 2026-04-19

### Added

- support grok + veo in regenerate-scene *(pipeline)*

## [0.48.4] - 2026-04-19

### Fixed

- enforce integer/discrete duration for Grok and Veo *(providers)*

## [0.48.3] - 2026-04-19

### Added

- restore grok + veo for script-to-video CLI *(pipeline)*

## [0.48.2] - 2026-04-19

### Documentation

- correct Node version scope in upstream issue tracker
- track Hyperframes upstream issue heygen-com/hyperframes#334

### Fixed

- validate required tool args before dispatch *(mcp-server)*

### Maintenance

- gitignore *.tsbuildinfo

## [0.48.1] - 2026-04-19

### Fixed

- default Hyperframes to sequential capture *(pipeline)*

### Maintenance

- remove MCP beta label *(web)*

## [0.48.0] - 2026-04-18

### Added

- add pipeline_run for declarative YAML pipelines *(mcp-server)*

## [0.47.1] - 2026-04-18

### Added

- custom bitrate, fps, resolution, codec options *(export)*

### Fixed

- bundle runtime deps to prevent ERR_MODULE_NOT_FOUND *(mcp-server)*

### Testing

- cover HTTP/network/timeout provider error hints
- cover provider error hints (#42)

## [0.47.0] - 2026-04-18

### Added

- Hyperframes render backend v0.47.0 *(pipeline)*
- Hyperframes render backend scaffold *(pipeline)*

### Documentation

- Phase 1 Part B master plan for Hyperframes adapter
- Phase 0 discovery — Lottie + Hyperframes probe results

### Fixed

- add DOM lib to tsconfig for transitive @hyperframes types *(mcp-server)*
- add DOM lib to CLI tsconfig for @hyperframes/engine compatibility *(build)*
- skip Hyperframes render test in CI environment *(test)*

## [0.46.2] - 2026-04-18

### Fixed

- fail fast when script-to-video generator is unsupported *(cli)*
- surface error, seed budget, preserve action on resume *(pipeline)*

## [0.46.1] - 2026-04-18

### Fixed

- match "Incorrect API key" in provider error hints *(cli)*
- load .env before executing steps *(pipeline)*

## [0.46.0] - 2026-04-18

### Added

- add budget + effort (Opus 4.7 Task Budgets) *(pipeline)*
- add Claude Code Skills for CLI discovery
- add light/dark mode toggle *(web)*

### Documentation

- reposition as "The video CLI for AI agents"

### Fixed

- standardize demo/doctor JSON output + expand error hints *(cli)*
- include pnpm-lock.yaml for next-themes dependency

## [0.45.0] - 2026-04-11

### Added

- add Video as Code section to landing page

### Documentation

- update README and ROADMAP with Video as Code, MCP 53 tools, new features

## [0.44.0] - 2026-04-11

### Added

- add `vibe run` — Video as Code with declarative YAML pipelines

## [0.43.0] - 2026-04-11

### Added

- cost estimation in dry-run, setup wizard improvements, smart error hints

## [0.42.0] - 2026-04-11

### Added

- storyboard YAML format, GIF export, default provider settings

## [0.41.0] - 2026-04-11

### Added

- add generate_storyboard MCP tool (53 tools total)
- expand MCP server from 47 to 52 tools — grade, speed-ramp, reframe, interpolate, upscale

## [0.40.0] - 2026-04-11

### Added

- add --describe flag, schema drift tests, provider unit tests

## [0.39.0] - 2026-04-11

### Added

- add `vibe context` command + improve help text for agents

## [0.38.0] - 2026-04-11

### Added

- add `vibe demo` command — instant showcase without API keys

### Documentation

- add cookbook with 10 practical recipes + link from README
- add zero API key getting started section to README

## [0.37.0] - 2026-04-11

### Added

- expand MCP server from 36 to 47 tools — image, video, audio

## [0.36.0] - 2026-04-08

### Added

- add speech/sound-effect/music MCP tools + execute functions (33→36)
- add detection MCP tools + extract execute functions (30→33)
- add 3 MCP tools — motion, animated caption, regenerate scene (27→30)

### Maintenance

- add workflow_dispatch trigger to publish workflow

## [0.35.0] - 2026-04-08

### Added

- improve onboarding UX — single banner, key links, step progress

## [0.34.1] - 2026-04-08

### Fixed

- add Remotion fallback for text-overlay and improve Runway/Remotion reliability

## [0.34.0] - 2026-04-08

### Added

- improve CLI UX for agentic use — discoverability, safety, context

### Fixed

- improve narration-video sync and add FFmpeg filter checks to doctor

## [0.33.1] - 2026-04-06

### Fixed

- use ffprobe actual duration for freeze-frame detection
- freeze last frame when video is shorter than clip duration

## [0.33.0] - 2026-04-06

### Added

- add Grok as default video generator for pipeline script-to-video
- arrow key navigation for setup wizard select prompts
- rich context in setup wizard key collection
- redesign setup wizard with mix-and-match AI feature selection
- use-case-based setup wizard for API key onboarding
- auto-generate CHANGELOG from conventional commits via git-cliff
- expand --dry-run to all 84 mutating commands and enhance AGENTS.md
- add --stdin global flag for JSON input and fix path validation

### Changed

- de-emphasize agent mode, make CLI-first the default
- consolidate 7 rules into 4, remove 534 lines
- add output path validation to all commands with -o option
- standardize error handling for agentic CLI compliance
- derive landing page counts from source code at build time

### Documentation

- add AI agent integration section to DEMO.md
- update DEMO.md setup section to match arrow-key wizard
- rewrite DEMO.md as a story from install to wow moment
- rewrite DEMO.md to match use-case-based setup flow
- slim CLAUDE.md from 62 to 33 lines
- fix outdated references in .claude agents and README
- fix Audio provider count in MODELS.md (2 → 3)
- replace hardcoded counts with build-time extraction
- remove all hardcoded counts from README
- replace hardcoded test count with dynamic CI badge

### Fixed

- multi-track audio mixing in export engine
- remove all hardcoded Runway fallback in pipeline CLI wrapper
- add XAI_API_KEY and OPENROUTER_API_KEY to config lookup map
- revert symlink to copy for install.sh (CI prebuild needs real file)
- improve setup wizard accuracy and .env key detection
- rename "Smart editing" to "AI editing + motion" in setup wizard
- clarify AI feature labels in setup wizard
- polish onboarding flow
- update setup --claude-code and improve onboarding UX
- structured JSON errors and proper exit codes for all Commander.js errors

### Maintenance

- symlink apps/web/public/install.sh to scripts/install.sh
- add CHANGELOG sync check to pre-push hook

## [0.31.1] - 2026-04-05

### Fixed

- add SSOT count validation and sync tool/test counts

## [0.31.0] - 2026-04-05

### Added

- make CLI fully self-discoverable for AI agents without CLAUDE.md

### Fixed

- add dry-run validation before npm publish

## [0.30.0] - 2026-04-05

### Added

- improve schema introspection and subcommand help for AI agents

### Documentation

- add OpenRouter to landing page and ROADMAP

## [0.29.0] - 2026-04-05

### Added

- add automated npm publish workflow on tag push

## [0.28.1] - 2026-04-05

### Documentation

- add star/contributor badges and contributors section to README

### Fixed

- improve pre-push hooks and remove hardcoded version fallback

## [0.28.0] - 2026-03-31

### Added

- add dynamic OG image and bump version to 0.28.0
- add OpenRouter as 6th Agent LLM provider (#8)
- add /demo showcase page with self-made demo video

### Documentation

- add real-time subject tracking to ROADMAP

### Fixed

- show Demo nav link on mobile devices
- mark @vibeframe/cli as public for npm publishing

### Maintenance

- trigger Vercel redeploy
- improve GitHub templates and contributor experience

## [0.27.0] - 2026-03-28

### Added

- CLI UX improvements, structured errors, command aliases, and harness engineering

## [0.26.1] - 2026-03-16

### Fixed

- OpenAI image edit MIME type and Veo/Runway 1:1 aspect ratio fallback
- use atempo instead of hard-trimming audio in export pipeline

## [0.26.0] - 2026-03-13

### Added

- auto-detect image aspect ratio for image-to-video generation

### Documentation

- add contextual help text to CLI command groups

### Fixed

- use object format for Grok image-to-video API

## [0.25.0] - 2026-03-08

### Added

- add animated-caption pipeline + deprecate b-roll/narrate/viral

### Fixed

- derive landing page version from package.json at build time
- update landing page version badge to v0.24.0

## [0.24.0] - 2026-03-08

### Added

- update AI providers, skills docs, and agent tools
- add pre-push SSOT validation hook and /sync-check skill

### Changed

- consolidate docs — reduce SSOT duplication across files

## [0.23.4] - 2026-03-08

### Fixed

- correct image-to-video provider docs, Runway error messages, and Kling agent ImgBB upload

## [0.23.3] - 2026-03-08

### Maintenance

- require Node.js >=20 (drop EOL Node 18)

## [0.23.2] - 2026-03-08

### Fixed

- correct deprecated models, broken hashes, and stale display names across providers

## [0.23.1] - 2026-03-08

### Fixed

- align GrokProvider with xAI API spec (endpoints and response fields)

## [0.23.0] - 2026-03-07

### Added

- Grok Imagine as default video provider, Audio column in MODELS.md, fix landing page

## [0.22.1] - 2026-03-07

### Added

- apply input validation and response sanitization across CLI

## [0.22.0] - 2026-03-07

### Added

- add --json output, --dry-run, input validation, and AGENTS.md
- restructure CLI into 5 semantic command groups
- add 'latest' model alias for Gemini image generation
- add Gemini 3.1 Flash image model and Veo video API enhancements
- add vibe setup --claude-code and CLI reference for Claude Code integration
- show project .env keys in vibe setup --show
- support project-scoped .env for API keys

### Changed

- enforce strict TypeScript, clean up imports, and update configs

### Documentation

- add -m latest examples to CLI reference for Claude Code discovery
- restructure CLAUDE.md into modular rules, add OSS docs
- update README with demo links and accurate stats
- translate FUNC_TEST.md and CLAUDE_CODE_TEST.md to English, use vibe instead of pnpm vibe
- translate QUICK_TEST.md to English and use vibe instead of pnpm vibe
- restructure README and landing page to CLI → Claude Code → MCP → Agent order

### Fixed

- auto-upload images to ImgBB for Kling image-to-video
- add auth headers when downloading Veo videos from Google API
- add auto-fallback and better error messages for Gemini image generation
- improve vibe setup --claude-code UX for overwrites
- add build step before typecheck to resolve cross-package imports *(ci)*
- use H.264 codec (avc1) instead of AV1 for yt-dlp in FUNC_TEST
- add vibe setup --show to install script Quick Start
- auto-create output directories for image commands
- add setup --show hint after setup wizard completes
- suppress dotenv debug log and improve setup --show source display
- improve landing page mobile responsiveness
- commit pending package.json changes to match lockfile
- sync pnpm-lock.yaml with mcp-server package.json

### Maintenance

- add .mcp.json and demo/ to .gitignore to prevent secret leaks

## [0.20.0] - 2026-02-24

### Added

- expand MCP server from 12 to 28 tools with AI editing, analysis, and pipeline capabilities

## [0.19.4] - 2026-02-24

### Added

- add --storyboard-provider option to script-to-video
- OSS quality improvements, diverse motion styles, and test guides

### CI/CD

- enforce test failures and update Node matrix to 20/22

### Changed

- split ClaudeProvider, GeminiProvider, and ai-edit into modules
- split agent/tools/ai.ts into 3+1 modules (2,558 -> 21 lines)
- split ai-script-pipeline.ts into logic + CLI modules
- split ai.ts into 7 modules (3,549 -> 307 lines)
- extract analyze, highlights, review, script-pipeline, video modules from ai.ts
- extract edit commands + execute functions into ai-edit.ts (-1,790 lines)
- extract image commands into ai-image.ts (-1,050 lines)
- extract audio commands into ai-audio.ts (-891 lines)
- extract motion command into ai-motion.ts
- remove deprecated repl/ directory (-2,198 lines)

### Documentation

- add JSDoc module headers and interface documentation
- add package metadata, CHANGELOG, SECURITY, and enhance CONTRIBUTING
- add missing AI editing commands to GUIDE.md
- update version references to 0.19.3

### Fixed

- eliminate command injection across 95+ exec call sites
- add missing logo assets to web public directory

### Maintenance

- cleanup for OSS release

## [0.19.3] - 2026-02-20

### Documentation

- update version references to 0.19.2

### Fixed

- Gemini silence detection clamps timestamps before validation
- silence-cut uses trim+concat instead of broken aselect filter

## [0.19.2] - 2026-02-20

### Fixed

- use valid Remotion composition ID for video-wrapped components
- motion composite uses video-embedded rendering instead of broken alpha overlay
- add fps requirement to motion graphics system prompt

## [0.19.1] - 2026-02-20

### Documentation

- fix filming script — version, export syntax, .env note, mp4 output

### Fixed

- Remotion caption renders video+captions in single composition
- remotion CLI detection uses --help instead of --version

### Maintenance

- update landing page version badge to 0.19.1

## [0.19.0] - 2026-02-20

### Added

- add --use-gemini flag to silence-cut for context-aware detection

### Documentation

- update ROADMAP and README for Remotion caption fallback

## [0.18.0] - 2026-02-20

### Added

- caption via Remotion fallback when FFmpeg lacks libass/freetype
- upgrade demo script with Act 4 (Motion Graphics) and recording guide

### Documentation

- add filming script, English-only demo, and recording tools

### Fixed

- detect missing FFmpeg subtitle support in caption command
- caption subtitle filter quoting for FFmpeg 8.x, update demo to Tim Urban TED
- silence-cut re-encode for clean cuts, update demo sample to TED Talk

### Maintenance

- update landing page version badge to v0.17.1

## [0.17.1] - 2026-02-20

### Documentation

- sync feature counts, add missing commands, deprecate URL-only commands

### Maintenance

- update landing page version badge to v0.17.0

## [0.17.0] - 2026-02-19

### Added

- add Remotion motion graphics render & composite pipeline
- add wow demo script for screen recording

## [0.16.0] - 2026-02-19

### Added

- add noise-reduce, fade, thumbnail best-frame, and translate-srt commands

### Testing

- add unit tests for jump-cut detectFillerRanges and CLI validation

## [0.15.0] - 2026-02-19

### Added

- add jump-cut command to remove filler words from video

### Documentation

- add analyze command to CLI guide
- add analyze command to roadmap

### Maintenance

- remove progress.md, use ROADMAP.md as single progress tracker
- update landing page version badge to v0.14.0

## [0.14.0] - 2026-02-19

### Added

- add unified `vibe ai analyze` command for image/video/YouTube analysis
- comprehensive e2e-tester covering all 52 AI commands
- add pipeline-tester agent with Gemini quality gate
- add text overlay auto-composition and Gemini video review feedback loop
- add version-checker subagent for release sync validation
- publish MCP server to npm and restructure docs
- add Google Analytics 4 (G-FMDTLFTKXM)
- add sitemap.xml and robots.txt for Google Search Console

### Documentation

- sync README CLI reference with actual commands and fix counts
- sync README Kling version to v2.5/v2.6
- move cloud roadmap to internal-only file
- update landing page with latest project state

### Fixed

- auto-shorts output path missing .mp4 extension
- add drawtext filter check in text-overlay and clean up README
- prefer ~/.local/bin over /usr/local/bin in install script
- update landing page version badge to v0.13.6
- sync landing page info with README/MODELS.md
- sync pnpm-lock.yaml with mcp-server package.json
- update MODELS.md video default to Kling
- change default video provider to Kling (faster, cheaper)
- correct README inaccuracies found via E2E testing

### Maintenance

- clean up generated files and update .gitignore

## [0.13.5] - 2026-02-19

### Documentation

- update roadmap.md with E2E-verified status and missing commands
- update progress.md with full E2E test results and 7 bug fixes

### Fixed

- resolve 7 bugs found during full E2E testing (85 tests)

### Maintenance

- add tiktok/ to gitignore

## [0.13.4] - 2026-02-06

### Fixed

- enforce JSON-only response and add error logging *(storyboard)*

## [0.13.3] - 2026-02-06

### Documentation

- sync landing page version to 0.13.2 and add sync rule to CLAUDE.md

## [0.13.2] - 2026-02-06

### Documentation

- add demo GIF for README

### Fixed

- improve narration-video sync with 5 targeted fixes *(script-to-video)*
- sync video duration with narration *(script-to-video)*

## [0.13.0] - 2026-02-05

### Added

- improve file reading and add storyboard creativity option *(agent)*
- add character consistency with reference images *(regenerate-scene)*
- add ai_regenerate_scene tool *(agent)*
- improve regenerate-scene command *(ai)*
- add --sequential option to script-to-video *(ai)*
- add ImgBB API key to config *(setup)*
- add --show option for config diagnostics *(setup)*
- add auto-narrate for videos without voiceover *(ai)*
- add fill-gaps command for AI video generation *(ai)*
- improve character consistency in script-to-video *(cli)*
- add ImgBB upload for Kling image-to-video *(cli)*
- enable Kling image-to-video and add scene continuity *(cli)*

### Documentation

- add README.md sync rule and fix tool count
- improve system prompt with filesystem guidance *(agent)*
- add viral optimizer fix to progress log
- improve version management instructions to prevent sync issues

### Fixed

- use ~/.local/bin to avoid sudo requirement *(install)*
- fix sudo password prompt when running via curl pipe *(install)*
- change default providers to kling and gemini *(ai)*
- use relative path for auto-generated narration source *(viral)*
- include audio clips in platform variants *(viral)*
- prioritize audio sources over video for transcription *(viral)*
- fill timeline gaps with black frames *(export)*
- include narration audio in project output *(b-roll)*
- handle videos without audio streams *(export)*
- accept both 'project' and 'path' parameter names *(agent)*
- include video audio in export when no separate audio clips *(cli)*

## [0.8.5] - 2026-02-05

### Changed

- rename DalleProvider to OpenAIImageProvider *(ai-providers)*

## [0.8.4] - 2026-02-05

### Fixed

- handle GPT Image 1.5 base64 response in script-to-video *(cli)*

## [0.8.3] - 2026-02-05

### Changed

- rename dalle → openai as default image provider *(cli)*

### Fixed

- parse OpenAI error JSON for detailed error messages *(ai-providers)*
- show image generation error details in script-to-video *(cli)*

## [0.8.1] - 2026-02-05

### Added

- add SSOT docs, gemini-edit tool, and openai provider naming *(cli)*

### Changed

- rename cli-guide.md to guide.md *(docs)*

### Documentation

- add demo GIF to README
- update landing page stats to v0.8 *(web)*
- clarify vibe vs vibe agent usage *(roadmap)*
- update CLI status to reflect Agent mode as default *(roadmap)*
- add test addition entry for v0.8.0 *(progress)*
- update test counts to 281
- update with v0.8.0 changes *(readme)*
- update v0.8.0 changelog with all today's changes *(progress)*
- enforce models.md as SSOT with clear rules and code comments

### Fixed

- update OpenAI DALL-E image sizes for API changes *(ai-providers)*
- update ASCII banner to VIBEFRAME and fix ai_video tool *(cli)*
- sync version and counts across all docs

### Maintenance

- update code comments from REPL to Agent *(web)*

### Testing

- add smoke tests for core, ai-providers, and mcp-server packages

## [0.7.0] - 2026-02-05

### Added

- add Veo provider and fix Kling base64 support *(video)*
- add xAI Grok as LLM provider *(agent)*
- add xAI Grok Imagine and Google Veo 3, remove gen3a_turbo *(video)*
- upgrade to Runway Gen-4.5 and add Google Veo 3.1 *(video)*
- upgrade to GPT Image 1.5 and update Gemini models *(image)*
- upgrade to v2.5 turbo with text2video support *(kling)*

### Changed

- limit to v2.5 and v2.6 models only *(kling)*

### Documentation

- add v0.6.2 changes - xAI Grok, DALL-E fix, Runway update *(progress)*
- update Agent LLM model names to actual versions
- update supported models and capabilities documentation
- add XAI_API_KEY to .env.example
- update AI provider models in CLAUDE.md and cli-guide.md

### Fixed

- update model name to gen4_turbo *(runway)*
- support GPT Image 1.5 API changes *(dalle)*
- update Runway model name Gen-3 → Gen-4.5 *(test)*
- load .env file for API keys *(agent)*

## [0.4.2] - 2026-02-04

### Added

- update landing page for v0.4 *(web)*

### Documentation

- add v0.4.1 changes *(progress)*

## [0.4.1] - 2026-02-04

### Documentation

- add VibeFrame Cloud business direction
- update v0.4.0 and translate to English *(cli-guide)*
- add v0.4.0 changes *(progress)*

## [0.4.0] - 2026-02-04

### Added

- improve media pipeline and add 7 new tools *(agent)*
- add export reminder in system prompt *(agent)*
- add clarification prompts for vague requests *(agent)*
- improve welcome banner with ASCII art and status *(agent)*
- implement Claude Code-like agentic mode as default entry point *(agent)*
- add 4 AI pipeline tools and integration tests *(agent)*
- add natural language support for regenerate-scene command *(repl)*
- add retry logic and regenerate-scene command for script-to-video *(cli)*
- improve scene continuity and narration alignment for script-to-video *(ai)*
- implement per-scene TTS for script-to-video *(cli)*

### Changed

- convert Korean text to English in system prompt *(agent)*

### Documentation

- add v0.3.0 changes *(progress)*
- update for Agent mode and improve workflow examples *(cli-guide)*
- add regenerate-scene command to CLI guide
- add progress entry for narration field fix
- add progress entries for export fixes
- clarify script-to-video output in cli-guide.md
- add progress entry for Runway ratio fix
- reorganize cli-guide.md to reduce duplication
- add progress entry for TTS/SFX filename fix
- add progress entries for detect docs and trim fix
- add detect command documentation to cli-guide
- fix trim command option in cli-guide
- add progress entry for version and track fixes
- add progress entry for cli-guide fixes
- fix cli-guide inconsistencies and add documentation guidelines
- add natural language export examples to roadmap
- add progress entry for export natural language routing fix

### Fixed

- disable ora discardStdin to preserve readline input *(agent)*
- add rl.resume() before prompt after async operations *(agent)*
- add keepalive timer and stdin.ref() to prevent premature exit *(agent)*
- keep event loop alive until readline closes *(agent)*
- use null instead of undefined for projectPath in e2e tests *(agent)*
- use 10s video when narration exceeds 5s in script-to-video *(cli)*
- add narration field to storyboard for proper voiceover *(ai)*
- export mixed resolution videos with scale filter *(cli)*
- support directory paths in project info/set/export commands *(cli)*
- export FFmpeg error with mixed media + script-to-video output path *(cli)*
- create output directory for script-to-video if it doesn't exist *(cli)*
- map aspect ratio to API format *(runway)*
- route "ai voices" to list voices and enable video generation *(repl)*
- generate unique filenames for TTS and SFX *(repl)*
- read version from package.json and fix image track matching *(cli)*
- handle image files correctly in video export *(export)*
- route "export the video" natural language to export handler *(repl)*
- improve natural language routing to prevent greedy builtin matching *(repl)*

### Maintenance

- update music.mp3

## [0.2.1] - 2026-02-02

### Added

- add natural language "add X to project" support *(repl)*

## [0.2.0] - 2026-02-02

### Added

- LLM-unified natural language command routing *(repl)*

## [0.1.1] - 2026-02-02

### Added

- add AI generation command support *(repl)*
- change default image provider from DALL-E to Gemini *(cli)*
- add Docker test environment for workflow testing *(docker)*
- add multi-provider support to script-to-video and Gemini Video to highlights/auto-shorts *(cli)*
- add 4 missing scripts for complete CLI coverage *(skills)*
- add 15 helper scripts for complete CLI coverage *(skills)*
- add video understanding capabilities *(gemini)*
- add Nano Banana Pro support and image editing *(gemini)*
- add multi-provider demo script and fix Kling mode *(cli)*
- add Runway image generation and CLI support *(skills)*
- add Claude Code skills and multi-provider CLI support
- improve user experience with better onboarding and docs *(cli)*
- add Ollama provider for local LLM support *(ai-providers)*
- use configured LLM provider for natural language commands *(cli)*
- add install.sh to public for CLI installation *(web)*
- enhance landing page with interactive REPL demo *(web)*
- add interactive REPL mode and install script *(cli)*
- add smart editing commands *(ai)*
- add voice and audio processing commands *(ai)*
- add video understanding and generation commands *(ai)*
- add landing page for open source launch *(web)*
- add Viral Optimizer command for Phase 4 *(ai)*
- add B-Roll Matcher command for Phase 4 *(ai)*
- add Auto Highlights command for Phase 4 *(ai)*
- add Script-to-Video command for Phase 4 *(ai)*
- add DALL-E, Runway, Kling providers and MCP server
- add Phase 2 AI provider extensions *(ai)*
- add Claude integration with Remotion motion graphics *(ai)*
- add OpenAI GPT, ElevenLabs TTS, and scene detection *(ai)*
- add batch operations command *(cli)*
- add timeline operations (split, duplicate, delete, move) *(cli)*
- add export command with FFmpeg.wasm *(cli)*
- add media info command *(cli)*
- add CLI package for headless video editing

### Changed

- remove Korean text from source code
- update terminal ASCII art to full VIBE FRAME logo *(web)*

### Documentation

- add "When Do You Need a Project?" section *(cli-guide)*
- add supported REPL patterns section *(cli-guide)*
- show realistic REPL output format *(cli-guide)*
- add Core Concepts section explaining projects *(cli-guide)*
- fix REPL example to generate media first *(cli-guide)*
- add setup vs setup --full comparison *(cli-guide)*
- convert Korean text to English in documentation
- add comprehensive CLI Mode + REPL Mode examples *(cli-guide)*
- enhance CLI guide with step-by-step tutorial and workflow examples
- update progress.md with Gemini and Stability changes
- add CLAUDE.md with Skills → CLI → REPL architecture
- add advanced multi-provider workflow to CLI guide
- add export command fix to progress.md
- update roadmap.md with llama3.2 as default Ollama model
- update progress.md with llama3.2 as default Ollama model
- mark Ollama provider complete in roadmap
- add Ollama provider feature to progress log
- add LLM provider feature to progress log
- rename mcp-guide.md to mcp.md
- update test count to 157
- enhance MCP integration guide and documentation
- revamp README for open source launch
- sync README with docs/roadmap.md
- sync README with docs/roadmap.md
- address roadmap feedback on technical constraints
- expand roadmap with AI-native vision
- update roadmap with CLI progress
- translate Korean text to English in README
- reorganize documentation structure

### Fixed

- prevent exit after AI generation commands *(repl)*
- use AI providers directly instead of subprocess *(repl)*
- add default voice (Rachel) to TTS command *(cli)*
- update model versions to latest *(replicate)*
- correct API endpoint format for SD3.5 models *(stability)*
- rewrite Runway with SDK, complete video gen tests *(skills)*
- add text_to_video endpoint for Runway *(skills)*
- update Stability and Replicate API integrations *(skills)*
- fix JSON parsing in Claude API scripts *(skills)*
- use system FFmpeg instead of FFmpeg.wasm for export *(cli)*
- change Ollama default model to llama3.2 *(ai-providers)*
- resolve ESLint errors across all packages
- add OpenAI to optional providers in setup --full *(cli)*
- ensure setup exits cleanly and fix ASCII logo *(cli)*
- resolve REPL hang and API key masking issues *(cli)*
- redirect stdin from /dev/tty for vibe setup *(install)*
- actually open /dev/tty to verify accessibility *(tty)*
- improve TTY input handling and simplify setup UX *(cli)*
- use /dev/tty for input when stdin is piped *(setup)*
- use NodeNext module resolution for production CLI *(esm)*
- remove .js extension from ESM imports *(ai-providers)*
- use explicit ESM imports for interface directory *(ai-providers)*
- fix curl pipe execution and update branding *(install)*
- correct LICENSE copyright year to 2026
- resolve ESLint errors in web package

### Maintenance

- add generated output directories to gitignore
- sync install.sh to web public directory
- rebrand vibe-edit to vibeframe
- replace editor links with CLI/MCP docs *(web)*
- add REPLICATE_API_TOKEN to .env.example
- add vitest coverage support to CLI

### Testing

- add integration tests for CLI commands
- add unit tests for CLI Project engine

### Debug

- add REPL startup logging


