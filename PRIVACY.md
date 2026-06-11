# VibeFrame Privacy Policy

_Last updated: June 11, 2026_

This policy covers the VibeFrame CLI (`@vibeframe/cli`), the VibeFrame MCP
server (`@vibeframe/mcp-server`), and the VibeFrame Claude Desktop extension.
It is published at <https://vibeframe.ai/privacy> and in the repository as
`PRIVACY.md`.

## Summary

VibeFrame is a local-first tool. It collects no telemetry, runs on your
machine, and only sends data to AI providers **you** configure and invoke.

## Data we collect

**None.** VibeFrame has no analytics, crash reporting, or usage tracking. No
data is sent to VibeFrame's maintainers or any VibeFrame-operated server.

## Where your content lives

- Projects, storyboards, generated audio/images/video, and render outputs are
  written only to the workspace folder you choose on your own machine.
- Job records, caches, and configuration live inside that workspace (or in
  standard local cache directories, e.g. the Hugging Face cache for the
  optional local Kokoro TTS model).
- Retention is entirely under your control: deleting the workspace deletes
  the data.

## Third-party AI providers

When you explicitly run a generation or AI-assisted operation, the relevant
content (e.g. narration text, image prompts, media to transcribe or review)
is sent to the provider you configured for that operation. VibeFrame supports,
depending on the keys you supply: Anthropic, OpenAI, Google (Gemini),
ElevenLabs, Replicate, fal, Runway, Kling, and xAI. Each provider processes
that data under its own privacy policy:

- Anthropic: <https://www.anthropic.com/legal/privacy>
- OpenAI: <https://openai.com/policies/privacy-policy>
- Google: <https://policies.google.com/privacy>
- ElevenLabs: <https://elevenlabs.io/privacy>

Operations that do not name a provider (timeline editing, ffmpeg-based edits,
scene linting, rendering, local Kokoro TTS) run fully locally and send
nothing anywhere. Tool annotations in the MCP manifest mark which tools reach
external services (`openWorldHint`).

## API keys

API keys are supplied by you — via the Desktop extension's settings, a local
`.env` file in your workspace, or environment variables. They are stored only
on your machine, sent only to the corresponding provider to authenticate your
own requests, and never transmitted to VibeFrame's maintainers.

## Data sharing and selling

VibeFrame does not share, sell, or transfer your data to anyone. There are no
VibeFrame servers in the data path.

## About the vibeframe.ai website

The marketing website at vibeframe.ai (not the CLI, MCP server, or extension)
uses Google Analytics for aggregate page-view statistics, subject to
[Google's privacy policy](https://policies.google.com/privacy). The tools
themselves contain no analytics.

## Children's privacy

VibeFrame is a developer tool and is not directed at children under 13.

## Changes

Material changes to this policy are recorded in this file's git history and
noted in the project changelog.

## Contact

- Issues and questions: <https://github.com/vericontext/vibeframe/issues>
- Security reports: security@vibeframe.dev (see `SECURITY.md`)
