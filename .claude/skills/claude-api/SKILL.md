---
name: claude-api
description: Use Claude API for natural language processing, video command parsing, motion graphics generation, and storyboarding. Use for complex reasoning and creative tasks.
allowed-tools: Bash(curl *), Bash(python *), Read, Write
---

# Claude API (Anthropic)

Use Claude for natural language understanding, video editing commands, motion graphics, and storyboarding.

## Authentication

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

Header: `x-api-key: $ANTHROPIC_API_KEY`

## API Endpoint

```
POST https://api.anthropic.com/v1/messages
```

## Available Models

| Model | ID | Best For |
|-------|-----|----------|
| Claude Opus 4.5 | `claude-opus-4-5-20251101` | Complex creative tasks |
| Claude Sonnet 4 | `claude-sonnet-4-20250514` | Balanced performance |
| Claude Haiku 3.5 | `claude-3-5-haiku-20241022` | Fast, cost-effective |

## Basic Request

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1024,
  "messages": [
    {"role": "user", "content": "Hello, Claude!"}
  ]
}
```

## cURL Example

```bash
curl -X POST "https://api.anthropic.com/v1/messages" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Parse this video edit command: trim first 10 seconds and add fade in"}
    ]
  }'
```

## Response Format

```json
{
  "id": "msg_...",
  "type": "message",
  "role": "assistant",
  "content": [{
    "type": "text",
    "text": "..."
  }],
  "model": "claude-sonnet-4-20250514",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 25,
    "output_tokens": 150
  }
}
```

## System Prompts

### Video Command Parser
```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1024,
  "system": "You are a video editing command parser. Convert natural language into structured JSON commands for VibeFrame. Output only valid JSON.",
  "messages": [
    {"role": "user", "content": "trim first 10 seconds and add fade"}
  ]
}
```

### Motion Graphics Generator
```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 4096,
  "system": "You are a Remotion motion graphics expert. Generate React/TypeScript code for animated video components. Use @remotion/core for animations.",
  "messages": [
    {"role": "user", "content": "Create an animated lower third with name and title"}
  ]
}
```

### Storyboard Creator
```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 4096,
  "system": "You are a video storyboard expert. Create detailed shot lists with timing, camera angles, and visual descriptions.",
  "messages": [
    {"role": "user", "content": "Create a 30-second product demo storyboard for a mobile app"}
  ]
}
```

## Extended Thinking (Claude Opus 4.5)

For complex tasks, use extended thinking:

```json
{
  "model": "claude-opus-4-5-20251101",
  "max_tokens": 16000,
  "thinking": {
    "type": "enabled",
    "budget_tokens": 10000
  },
  "messages": [
    {"role": "user", "content": "Design a complete motion graphics system for a YouTube channel"}
  ]
}
```

## Vision (Image Analysis)

Claude can analyze images for video editing context:

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1024,
  "messages": [{
    "role": "user",
    "content": [
      {
        "type": "image",
        "source": {
          "type": "base64",
          "media_type": "image/png",
          "data": "<base64_image_data>"
        }
      },
      {
        "type": "text",
        "text": "Analyze this video frame and suggest color grading"
      }
    ]
  }]
}
```

## Streaming

For long responses, use streaming:

```bash
curl -X POST "https://api.anthropic.com/v1/messages" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  --no-buffer \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 4096,
    "stream": true,
    "messages": [{"role": "user", "content": "Generate a complex animation sequence"}]
  }'
```

## Tool Use

Claude can use tools for structured output:

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1024,
  "tools": [{
    "name": "parse_video_command",
    "description": "Parse a natural language video editing command",
    "input_schema": {
      "type": "object",
      "properties": {
        "action": {"type": "string", "enum": ["trim", "cut", "fade", "filter", "speed"]},
        "parameters": {"type": "object"},
        "target": {"type": "string"}
      },
      "required": ["action"]
    }
  }],
  "messages": [
    {"role": "user", "content": "trim the first 5 seconds"}
  ]
}
```

## Usage with Helper Scripts

```bash
# Parse video command
python .claude/skills/claude-api/scripts/parse.py "trim first 10 seconds"

# Generate motion graphics code
python .claude/skills/claude-api/scripts/motion.py "animated subscribe button"

# Create storyboard
python .claude/skills/claude-api/scripts/storyboard.py "30-second app demo"

# Analyze frame
python .claude/skills/claude-api/scripts/analyze.py frame.png "suggest color grading"
```

## Integration with VibeFrame

```bash
# Natural language editing (via Claude)
vibe ai parse "add cinematic letterbox and color grade" -p claude

# Generate motion graphics
vibe ai motion "animated intro sequence" -o intro.tsx

# Create storyboard
vibe ai storyboard "product launch video" -o storyboard.json

# Analyze video frame
vibe ai analyze frame.png "what effects would improve this"
```

## Rate Limits & Pricing

| Model | Rate Limit | Input Price | Output Price |
|-------|------------|-------------|--------------|
| Claude Opus 4.5 | 4K TPM | $15/1M | $75/1M |
| Claude Sonnet 4 | 80K TPM | $3/1M | $15/1M |
| Claude Haiku 3.5 | 100K TPM | $0.80/1M | $4/1M |

## References

- [Anthropic API Reference](https://docs.anthropic.com/en/api/getting-started)
- [Messages API](https://docs.anthropic.com/en/api/messages)
- [Tool Use](https://docs.anthropic.com/en/docs/tool-use)
- [Vision](https://docs.anthropic.com/en/docs/vision)
