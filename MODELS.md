# AI Provider Models

> Single source of truth for AI model information used across VibeFrame.

---

## Agent LLM Providers (5)

Used for natural language processing in Agent mode (`vibe` command).

| Provider | Model | Env Key | CLI Option |
|----------|-------|---------|------------|
| OpenAI | GPT-4o | `OPENAI_API_KEY` | `-p openai` |
| Claude | Sonnet 4 | `ANTHROPIC_API_KEY` | `-p claude` |
| Gemini | 2.0 Flash | `GOOGLE_API_KEY` | `-p gemini` |
| xAI | Grok-3 | `XAI_API_KEY` | `-p xai` |
| Ollama | Local models | - | `-p ollama` |

---

## Text-to-Image (4)

| Provider | Model | Env Key | CLI Option | Notes |
|----------|-------|---------|------------|-------|
| OpenAI | `gpt-image-1.5` | `OPENAI_API_KEY` | `-p openai` | Quality tiers: low ($0.009), medium ($0.035), high ($0.133) |
| Gemini | `gemini-2.5-flash-image` | `GOOGLE_API_KEY` | `-p gemini` | Default. Nano Banana Flash - fast |
| Gemini | `gemini-3-pro-image-preview` | `GOOGLE_API_KEY` | `-p gemini -m pro` | Nano Banana Pro - higher quality, up to 4K |
| Stability | `stable-diffusion-xl` | `STABILITY_API_KEY` | `-p stability` | For image editing (upscale, remove-bg, outpaint) |

### Image Editing (Gemini)

| Model | Max Input Images | Features |
|-------|------------------|----------|
| Flash | 3 | Fast editing, 1K output |
| Pro | 14 | Multi-image composition, up to 4K output |

---

## Text-to-Video (4)

| Provider | Model | Duration | Env Key | CLI Option | Notes |
|----------|-------|----------|---------|------------|-------|
| Kling | `kling-v2-5-turbo` | 5-10 sec | `KLING_API_KEY` | `-p kling` | Default, fast (~36s generation) |
| Kling | `kling-v2-6` | 5-10 sec | `KLING_API_KEY` | `-p kling -m v2.6` | Higher quality |
| Veo | `veo-3.1-fast-generate-preview` | 4-8 sec | `GOOGLE_API_KEY` | `-p veo` | Native audio support |
| Veo | `veo-3.0-generate-preview` | 5-8 sec | `GOOGLE_API_KEY` | `-p veo -m 3.0` | Native audio support |
| Runway | `gen4_turbo` | 5-10 sec | `RUNWAY_API_SECRET` | `-p runway` | Top-ranked quality |
| xAI Grok | `grok-imagine-video` | 1-15 sec | `XAI_API_KEY` | `-p grok` | Native audio, $4.20/min |

### Image-to-Video

Same providers as text-to-video. Note: Kling uses `kling-v1-5` model for base64 images (v2.x requires URL).

---

## Audio (2)

| Provider | Capability | Env Key | Notes |
|----------|------------|---------|-------|
| ElevenLabs | TTS, SFX, Voice Clone | `ELEVENLABS_API_KEY` | Default voice: Rachel |
| Whisper | Transcription | `OPENAI_API_KEY` | OpenAI API |
| Replicate | Music generation | `REPLICATE_API_TOKEN` | MusicGen model |

---

## Quick Reference

### Environment Variables

```bash
# LLM Providers
export OPENAI_API_KEY="sk-..."        # GPT, Whisper, GPT Image 1.5
export ANTHROPIC_API_KEY="sk-ant-..." # Claude
export GOOGLE_API_KEY="AIza..."       # Gemini (image, Veo video)
export XAI_API_KEY="xai-..."          # xAI Grok

# Media Providers
export ELEVENLABS_API_KEY="..."       # TTS, SFX
export STABILITY_API_KEY="sk-..."     # Stability AI
export RUNWAY_API_SECRET="..."        # Runway Gen-4
export KLING_API_KEY="..."            # Kling v2.x
export REPLICATE_API_TOKEN="..."      # Replicate (music)
```

### API Keys by Command

| Command | Required API Key | Model |
|---------|-----------------|-------|
| `vibe` (default) | `OPENAI_API_KEY` | GPT-4o (Agent LLM) |
| `vibe -p claude` | `ANTHROPIC_API_KEY` | Claude Sonnet 4 (Agent LLM) |
| `vibe -p gemini` | `GOOGLE_API_KEY` | Gemini 2.0 Flash (Agent LLM) |
| `vibe -p xai` | `XAI_API_KEY` | Grok-3 (Agent LLM) |
| `vibe ai image` | `GOOGLE_API_KEY` | Gemini Nano Banana |
| `vibe ai image -p openai` | `OPENAI_API_KEY` | GPT Image 1.5 |
| `vibe ai gemini-edit` | `GOOGLE_API_KEY` | Gemini Nano Banana |
| `vibe ai tts` | `ELEVENLABS_API_KEY` | ElevenLabs |
| `vibe ai video` | `KLING_API_KEY` | Kling v2.5-turbo |
| `vibe ai video -p veo` | `GOOGLE_API_KEY` | Veo 3.1 |
| `vibe ai video -p grok` | `XAI_API_KEY` | Grok Imagine |
| `vibe ai kling` | `KLING_API_KEY` | Kling v2.5-turbo |
