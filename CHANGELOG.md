# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.19.3] - 2026-02-24

### Changed
- Refactored `ai.ts` (9000+ lines) into 10 focused modules
- Removed deprecated REPL mode (-2,198 lines)
- Updated default OpenAI Agent model from GPT-4.5 to GPT-4o
- Documented GPT-5.2 model options in MODELS.md

### Fixed
- LICENSE now correctly references "VibeFrame Contributors"
- Removed stray test artifacts from repository root

### Added
- `ai-analyze.ts` - unified media analysis (image/video/YouTube)
- `ai-highlights.ts` - highlight extraction and auto-shorts
- `ai-review.ts` - AI video review and auto-fix
- `ai-script-pipeline.ts` - full script-to-video pipeline
- `ai-video.ts` - video generation (Runway, Kling, Grok)
- `ai-edit.ts` - post-production editing commands
- `ai-image.ts` - image generation commands
- `ai-audio.ts` - audio generation commands
- `ai-motion.ts` - motion graphics commands

## [0.19.0] - 2026-02-20

### Added
- OSS quality improvements and diverse motion styles
- Test guides for contributors
- GitHub Actions CI with Node 20/22 matrix
- `ai translate-srt` command for subtitle translation
- `ai thumbnail` command for thumbnail generation/extraction

## [0.18.0] - 2026-02-15

### Added
- MCP server published as `@vibeframe/mcp-server` on npm
- Agent mode with 5 LLM providers (OpenAI, Claude, Gemini, Ollama, xAI)
- 58 agent tools across 7 categories
- `ai motion` command for Remotion-based motion graphics
- `ai caption` command for Whisper + FFmpeg caption burning
- `ai noise-reduce` command for audio/video noise removal
- `ai fade` command for fade in/out effects

## [0.17.0] - 2026-02-10

### Added
- `ai script-to-video` pipeline (storyboard -> TTS -> images -> video)
- `ai highlights` command for extracting video highlights
- `ai auto-shorts` command for generating short-form content
- `ai review` command with Gemini video analysis
- Kling v2.5/v2.6 video generation support
- xAI Grok video generation via Grok Imagine

## [0.16.0] - 2026-02-05

### Added
- `ai silence-cut` command (FFmpeg + Gemini smart detection)
- `ai jump-cut` command (Whisper filler word detection)
- `ai text-overlay` command (FFmpeg drawtext)
- Gemini multi-image editing (`ai gemini-edit`)
- Video analysis with Gemini (`ai gemini-video`, `ai analyze`)

## [0.15.0] - 2026-01-28

### Added
- Initial CLI with project, timeline, and export commands
- Core timeline data structures with Zustand + Immer
- FFmpeg-based video export
- OpenAI, Claude, Gemini AI provider integrations
- ElevenLabs TTS and SFX support
- Stability AI image editing
- Remotion motion graphics foundation
