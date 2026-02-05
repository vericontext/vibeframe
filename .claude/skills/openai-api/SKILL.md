---
name: openai-api
description: Use OpenAI APIs for GPT chat completion, DALL-E image generation, and Whisper transcription. Use for natural language processing, image creation, and audio transcription tasks.
allowed-tools: Bash(curl *), Bash(python *), Read, Write
---

# OpenAI API

Access OpenAI's suite of AI models: GPT for text, DALL-E for images, Whisper for audio.

## Authentication

```bash
export OPENAI_API_KEY="sk-..."
```

Header: `Authorization: Bearer $OPENAI_API_KEY`

## Available APIs

| API | Endpoint | Description |
|-----|----------|-------------|
| Chat Completions | `/v1/chat/completions` | GPT-4o, GPT-4o-mini |
| Images | `/v1/images/generations` | DALL-E 3 |
| Audio Transcription | `/v1/audio/transcriptions` | Whisper |
| Audio Speech | `/v1/audio/speech` | Text-to-Speech |
| Embeddings | `/v1/embeddings` | Text embeddings |

## Chat Completions (GPT)

### Endpoint
```
POST https://api.openai.com/v1/chat/completions
```

### Request
```json
{
  "model": "gpt-4o-mini",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello!"}
  ],
  "temperature": 0.7,
  "max_tokens": 1000
}
```

### cURL Example
```bash
curl -X POST "https://api.openai.com/v1/chat/completions" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Parse this video edit command: trim first 10 seconds"}],
    "temperature": 0
  }'
```

### Response
```json
{
  "id": "chatcmpl-...",
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "..."
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30
  }
}
```

### Models
| Model | Context | Best For |
|-------|---------|----------|
| `gpt-4o` | 128K | Complex reasoning |
| `gpt-4o-mini` | 128K | Fast, cost-effective |
| `gpt-4-turbo` | 128K | Balance of speed/quality |

## DALL-E Image Generation

### Endpoint
```
POST https://api.openai.com/v1/images/generations
```

### Request
```json
{
  "model": "dall-e-3",
  "prompt": "A futuristic video editing interface",
  "n": 1,
  "size": "1024x1024",
  "quality": "standard",
  "response_format": "url"
}
```

### cURL Example
```bash
curl -X POST "https://api.openai.com/v1/images/generations" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "dall-e-3",
    "prompt": "A professional YouTube thumbnail for a coding tutorial",
    "n": 1,
    "size": "1536x1024",
    "quality": "hd"
  }' | jq -r '.data[0].url' | xargs curl -o thumbnail.png
```

### Parameters
| Parameter | Values | Description |
|-----------|--------|-------------|
| `model` | `dall-e-3`, `dall-e-2` | Model version |
| `size` | `1024x1024`, `1536x1024`, `1024x1536` | Image dimensions |
| `quality` | `standard`, `hd` | Quality level |
| `style` | `natural`, `vivid` | Style preset |
| `response_format` | `url`, `b64_json` | Response format |

### Response
```json
{
  "data": [{
    "url": "https://...",
    "revised_prompt": "A detailed futuristic..."
  }]
}
```

## Whisper Transcription

### Endpoint
```
POST https://api.openai.com/v1/audio/transcriptions
```

### cURL Example
```bash
curl -X POST "https://api.openai.com/v1/audio/transcriptions" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F "file=@audio.mp3" \
  -F "model=whisper-1" \
  -F "response_format=verbose_json" \
  -F "timestamp_granularities[]=word" \
  -F "timestamp_granularities[]=segment"
```

### Parameters
| Parameter | Values | Description |
|-----------|--------|-------------|
| `model` | `whisper-1` | Model version |
| `response_format` | `json`, `text`, `srt`, `vtt`, `verbose_json` | Output format |
| `language` | ISO-639-1 code | Source language |
| `timestamp_granularities` | `word`, `segment` | Timestamp level |

### Response (verbose_json)
```json
{
  "text": "Hello, welcome to the tutorial.",
  "segments": [{
    "start": 0.0,
    "end": 2.5,
    "text": "Hello, welcome to the tutorial."
  }],
  "words": [{
    "word": "Hello",
    "start": 0.0,
    "end": 0.5
  }]
}
```

## Text-to-Speech

### Endpoint
```
POST https://api.openai.com/v1/audio/speech
```

### cURL Example
```bash
curl -X POST "https://api.openai.com/v1/audio/speech" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tts-1",
    "input": "Welcome to VibeFrame!",
    "voice": "alloy"
  }' --output speech.mp3
```

### Voices
- `alloy` - Neutral
- `echo` - Male
- `fable` - British accent
- `onyx` - Deep male
- `nova` - Female
- `shimmer` - Soft female

## Usage with Helper Scripts

```bash
# Chat completion
python .claude/skills/openai-api/scripts/chat.py "Parse: trim 5 seconds from start"

# Generate image
python .claude/skills/openai-api/scripts/dalle.py "thumbnail for tech video" -o thumb.png

# Edit image (DALL-E 2 inpainting)
python .claude/skills/openai-api/scripts/edit.py image.png mask.png "add a sunset sky" -o edited.png

# Edit without mask
python .claude/skills/openai-api/scripts/edit.py image.png "add a mountain background" -o edited.png

# Transcribe audio
python .claude/skills/openai-api/scripts/whisper.py audio.mp3 -o transcript.json

# Text-to-speech
python .claude/skills/openai-api/scripts/tts.py "Hello world" -o speech.mp3
```

## Integration with VibeFrame

```bash
# Natural language commands (via GPT)
vibe ai parse "trim first 10 seconds and add fade"

# Generate thumbnail
vibe ai image "YouTube thumbnail" -o thumb.png -p dalle

# Transcribe for subtitles
vibe ai transcribe audio.mp3 -o subs.srt

# Generate voiceover
vibe ai tts "Welcome to my channel" -o intro.mp3
```

## Rate Limits & Pricing

| API | Rate Limit | Price |
|-----|------------|-------|
| GPT-4o | 10K TPM | $2.50/1M input, $10/1M output |
| GPT-4o-mini | 200K TPM | $0.15/1M input, $0.60/1M output |
| DALL-E 3 | 5 img/min | $0.04-0.12/image |
| Whisper | 50 req/min | $0.006/minute |
| TTS | 50 req/min | $0.015/1K chars |

## References

- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [Chat Completions](https://platform.openai.com/docs/guides/text-generation)
- [DALL-E](https://platform.openai.com/docs/guides/images)
- [Whisper](https://platform.openai.com/docs/guides/speech-to-text)
