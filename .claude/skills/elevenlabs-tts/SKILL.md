---
name: elevenlabs-tts
description: Generate speech, sound effects, and clone voices using ElevenLabs API. Use for narration, voiceovers, SFX, and voice cloning.
allowed-tools: Bash(curl *), Bash(python *), Read, Write
---

# ElevenLabs Audio Generation

Generate high-quality speech, sound effects, and clone voices using ElevenLabs API.

## Capabilities

| Feature | Endpoint | Description |
|---------|----------|-------------|
| Text-to-Speech | `/v1/text-to-speech/{voice_id}` | Convert text to natural speech |
| Sound Effects | `/v1/sound-generation` | Generate SFX from text prompts |
| Voice Clone | `/v1/voices/add` | Clone voices from audio samples |
| Voice List | `/v1/voices` | List available voices |
| Audio Isolation | `/v1/audio-isolation` | Separate vocals from background |

## Authentication

```bash
export ELEVENLABS_API_KEY="your-api-key"
```

Header: `xi-api-key: $ELEVENLABS_API_KEY`

## Text-to-Speech

### Endpoint
```
POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
```

### Popular Voice IDs
| Voice | ID | Description |
|-------|-----|-------------|
| Rachel | `21m00Tcm4TlvDq8ikWAM` | American female, calm |
| Adam | `pNInz6obpgDQGcFmaJgB` | American male, deep |
| Bella | `EXAVITQu4vr4xnSDxMaL` | American female, soft |
| Antoni | `ErXwobaYiN019PkySvjV` | American male, well-rounded |
| Elli | `MF3mGyEYCl7XYWbV9V6O` | American female, young |
| Josh | `TxGEqnHWrfWFTfGW9XjX` | American male, young |

### Request Format
```json
{
  "text": "Your text here",
  "model_id": "eleven_multilingual_v2",
  "voice_settings": {
    "stability": 0.5,
    "similarity_boost": 0.75,
    "style": 0.0
  }
}
```

### cURL Example
```bash
curl -X POST "https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world", "model_id": "eleven_multilingual_v2"}' \
  --output speech.mp3
```

## Sound Effects Generation

### Endpoint
```
POST https://api.elevenlabs.io/v1/sound-generation
```

### Request Format
```json
{
  "text": "description of sound effect",
  "duration_seconds": 5.0,
  "prompt_influence": 0.3
}
```

### Parameters
- `text`: Description of the sound (e.g., "thunder crash", "door creaking")
- `duration_seconds`: 0.5 to 22 seconds (optional, auto if omitted)
- `prompt_influence`: 0.0 to 1.0 (default: 0.3)

### cURL Example
```bash
curl -X POST "https://api.elevenlabs.io/v1/sound-generation" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text": "whoosh transition sound", "duration_seconds": 2}' \
  --output effect.mp3
```

## Voice Cloning

### Endpoint
```
POST https://api.elevenlabs.io/v1/voices/add
```

### Requirements
- 1-25 audio samples (MP3/WAV)
- Clear speech, minimal background noise
- Each sample 30s-3min recommended

### cURL Example
```bash
curl -X POST "https://api.elevenlabs.io/v1/voices/add" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" \
  -F "name=My Voice" \
  -F "files=@sample1.mp3" \
  -F "files=@sample2.mp3"
```

## Usage with Helper Script

```bash
# Text-to-Speech
python .claude/skills/elevenlabs-tts/scripts/tts.py "Hello world" -o output.mp3

# With specific voice
python .claude/skills/elevenlabs-tts/scripts/tts.py "Hello world" -o output.mp3 -v EXAVITQu4vr4xnSDxMaL

# Sound Effect
python .claude/skills/elevenlabs-tts/scripts/sfx.py "thunder crash" -o thunder.mp3 -d 3

# List Voices
python .claude/skills/elevenlabs-tts/scripts/voices.py
```

## Integration with VibeFrame

```bash
# Generate narration
vibe ai tts "Your narration text" -o narration.mp3 -v EXAVITQu4vr4xnSDxMaL

# Generate sound effect
vibe ai sfx "whoosh transition" -o whoosh.mp3 --duration 2

# List available voices
vibe ai voices
```

## Models

| Model | ID | Languages | Best For |
|-------|-----|-----------|----------|
| Multilingual v2 | `eleven_multilingual_v2` | 29 languages | General use |
| Turbo v2.5 | `eleven_turbo_v2_5` | 32 languages | Low latency |
| English v1 | `eleven_monolingual_v1` | English only | English content |

## Voice Settings Guide

| Setting | Range | Effect |
|---------|-------|--------|
| `stability` | 0-1 | Higher = more consistent, lower = more expressive |
| `similarity_boost` | 0-1 | Higher = closer to original voice |
| `style` | 0-1 | Only for v2 models, adds expressiveness |

## References

- [ElevenLabs API Docs](https://elevenlabs.io/docs/api-reference)
- [Voice Library](https://elevenlabs.io/voice-library)
