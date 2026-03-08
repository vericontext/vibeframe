# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VibeFrame is an AI-native video editing tool. CLI-first, MCP-ready. It uses natural language to control video editing via a headless CLI, MCP server for Claude Desktop/Cursor integration, and a pluggable AI provider system.

## Build & Development Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (248+ passing)
pnpm lint             # Lint all packages
pnpm format           # Format code with Prettier

# Run CLI directly
pnpm vibe             # Start Agent mode (default, no-args only)
pnpm vibe agent       # Start Agent mode with options (e.g., -p gemini)
pnpm vibe --help      # Show CLI commands

# Run MCP server (development)
pnpm mcp

# Single package commands
pnpm -F @vibeframe/cli test       # Test CLI package only
pnpm -F @vibeframe/core build     # Build core package only
```

## Architecture

```
CLI (Commander.js + Agent)
    ↓
Engine (Project state management)
    ↓
Core (Zustand + Immer store, timeline operations, FFmpeg export)
    ↓
AI Providers (pluggable: OpenAI, Claude, Gemini, ElevenLabs, Runway, Kling, xAI Grok, etc.)
```

### Commit Format

Conventional commits: `feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `test:`, `chore:`

## Environment Variables

Copy `.env.example` to `.env`. Each AI provider has its own API key:
- `OPENAI_API_KEY` - GPT, Whisper, GPT Image 1.5
- `ANTHROPIC_API_KEY` - Claude
- `GOOGLE_API_KEY` - Gemini (image, Veo video)
- `ELEVENLABS_API_KEY` - TTS, SFX
- `RUNWAY_API_SECRET` - Runway Gen-4.5 video
- `KLING_API_KEY` - Kling v2.5/v2.6/3.0 video
- `XAI_API_KEY` - xAI Grok (Agent LLM + Grok Imagine video)

## AI Provider Models

See **[MODELS.md](MODELS.md)** for the complete SSOT (Single Source of Truth) on all AI models. Do not duplicate model lists here.

@.claude/rules/architecture.md
@.claude/rules/agent-tools.md
@.claude/rules/agents.md
@.claude/rules/versioning.md
@.claude/rules/mcp-server.md
@MODELS.md
