# AI Provider Models

> Single source of truth for AI model information used across VibeFrame.

---

## Agent LLM Providers (6)

Used for natural language processing in Agent mode (`vibe` command).

| Provider | Model | API Model ID | Env Key | CLI Option |
|----------|-------|-------------|---------|------------|
| OpenAI | GPT-5-mini | `gpt-5-mini` | `OPENAI_API_KEY` | `-p openai` |
| Claude | Sonnet 4.6 | `claude-sonnet-4-6` | `ANTHROPIC_API_KEY` | `-p claude` |
| Gemini | 2.5 Flash | `gemini-2.5-flash` | `GOOGLE_API_KEY` | `-p gemini` |
| xAI | Grok 4.1 Fast | `grok-4-1-fast-reasoning` | `XAI_API_KEY` | `-p xai` |
| OpenRouter | Auto (300+ models) | `openrouter/auto` | `OPENROUTER_API_KEY` | `-p openrouter` |
| Ollama | Local models | user-configured | - | `-p ollama` |

**OpenAI model options:**

`gpt-5-mini` is the default — 10× cheaper input / 5× cheaper output than GPT-4o, with better performance. Ideal for agentic loops (20+ calls per task). You can override per-session:

| Model ID | Variant | Notes |
|----------|---------|-------|
| `gpt-5-mini` | GPT-5 Mini | **Default**. Best cost-performance ratio. $0.25/M input, $2/M output |
| `gpt-5.4` | GPT-5.4 | Frontier model, 1M context. $2.50/M input, $20/M output |

> `gpt-5.4-pro` is **not** available via Chat Completions (Responses API only) — not usable for Agent mode.

To use GPT-5.4 in agent mode: `vibe agent -p openai --model gpt-5.4`

**Claude model options:**

`claude-sonnet-4-6` is the default — best balance of capability and cost for agentic loops. You can override per-session:

| Model ID | Variant | Notes |
|----------|---------|-------|
| `claude-sonnet-4-6` | Sonnet 4.6 | **Default**. Best cost-performance for agent loops. $3/M input, $15/M output |
| `claude-opus-4-7` | Opus 4.7 | Highest capability, step-change in agentic coding, 1M context. $5/M input, $25/M output |
| `claude-haiku-4-5-20251001` | Haiku 4.5 | Fastest, lowest cost. $1/M input, $5/M output |
| `claude-opus-4-6` | Opus 4.6 (legacy) | Previous Opus tier — same price as 4.7. Still supported. |

To use Opus in agent mode: `vibe agent -p claude --model claude-opus-4-7`

**xAI model options:**

`grok-4-1-fast-reasoning` is the default — optimized for tool calling with 2M context window, 15× cheaper input / 30× cheaper output than Grok 4. You can override per-session:

| Model ID | Variant | Notes |
|----------|---------|-------|
| `grok-4-1-fast-reasoning` | Grok 4.1 Fast (reasoning) | **Default**. Agent-optimized, 2M context. $0.20/M input, $0.50/M output |
| `grok-4` | Grok 4 (flagship) | Highest capability, 256K context. $3/M input, $15/M output |
| `grok-4-1-fast-non-reasoning` | Grok 4.1 Fast (non-reasoning) | Faster responses, no chain-of-thought. $0.20/M input, $0.50/M output |

To use Grok 4 in agent mode: `vibe agent -p xai --model grok-4`

**OpenRouter model options:**

`openrouter/auto` is the default — automatically routes to the best available model. You can specify any model available on OpenRouter:

| Model ID | Provider | Notes |
|----------|----------|-------|
| `openrouter/auto` | Auto | **Default**. Automatically selects best model |
| `anthropic/claude-sonnet-4-6` | Anthropic | Claude Sonnet via OpenRouter |
| `openai/gpt-5-mini` | OpenAI | GPT-5 Mini via OpenRouter |
| `google/gemini-2.5-flash` | Google | Gemini Flash via OpenRouter |
| `meta-llama/llama-4-scout` | Meta | Llama 4 Scout (open-weight) |
| `deepseek/deepseek-r1` | DeepSeek | DeepSeek R1 reasoning model |

To use a specific model: `vibe agent -p openrouter --model anthropic/claude-sonnet-4-6`

> See [openrouter.ai/models](https://openrouter.ai/models) for the full list of 300+ available models.

**Why Gemini 2.5 Flash, not 3.1 Pro?**

Agent mode runs an agentic loop — the LLM is called repeatedly (potentially dozens of times per task) to reason and call tools. For this use case:

- **Speed matters**: Flash responds ~3–5× faster than Pro, keeping the interactive session snappy
- **Tool calling stability**: `gemini-2.5-flash` has well-tested, stable function calling support; `gemini-3.1-pro-preview` is a preview model with potentially unstable behavior in multi-turn tool calling loops
- **Cost**: Flash is significantly cheaper per token — important when a single agent task may trigger 20+ LLM calls
- **Preview models in production**: Preview models can change response format or have stricter rate limits unsuitable for agentic loops

`gemini-3.1-pro-preview` is available for **motion graphics code generation** (`vibe generate motion -m gemini-3.1-pro`) where its superior creative reasoning matters for a single, expensive generation call.

**Gemini model options:**

`gemini-2.5-flash` is the default — fastest and most cost-effective for agentic loops. You can override per-session:

| Model ID | Variant | Notes |
|----------|---------|-------|
| `gemini-2.5-flash` | 2.5 Flash | **Default**. Fast, stable tool calling. Free tier available |
| `gemini-2.5-pro` | 2.5 Pro | Higher reasoning capability, slower. $1.25/M input, $10/M output |
| `gemini-3.1-pro-preview` | 3.1 Pro (preview) | Latest, preview — may have unstable tool calling |

To use 2.5 Pro in agent mode: `vibe agent -p gemini --model gemini-2.5-pro`

---

## Motion Graphics LLM (vibe generate motion)

Used for Remotion component code generation (`vibe generate motion`).

| Alias | Model | Provider | Env Key | CLI Option | Notes |
|-------|-------|----------|---------|------------|-------|
| `sonnet` | `claude-sonnet-4-6` | Claude | `ANTHROPIC_API_KEY` | `-m sonnet` | **Default** |
| `opus` | `claude-opus-4-7` | Claude | `ANTHROPIC_API_KEY` | `-m opus` | Best quality (step-change agentic coding) |
| `opus-4-6` | `claude-opus-4-6` | Claude | `ANTHROPIC_API_KEY` | `-m opus-4-6` | Previous Opus tier (legacy) |
| `gemini` | `gemini-2.5-pro` | Gemini | `GOOGLE_API_KEY` | `-m gemini` | Fast alternative |
| `gemini-3.1-pro` | `gemini-3.1-pro-preview` | Gemini | `GOOGLE_API_KEY` | `-m gemini-3.1-pro` | Gemini 3.1 Pro |

---

## Text-to-Image (3 providers, 7 models)

| Provider | Model | Env Key | CLI Option | Notes |
|----------|-------|---------|------------|-------|
| OpenAI | `gpt-image-2` | `OPENAI_API_KEY` | `-p openai` | Flagship OpenAI image model |
| OpenAI | `gpt-image-1.5` | `OPENAI_API_KEY` | `-p openai -m 1.5` | Previous default, still strong on editing (#1 editing leaderboard). Quality tiers: low ($0.009), medium ($0.035), high ($0.133) |
| Gemini | `gemini-2.5-flash-image` | `GOOGLE_API_KEY` | `-p gemini` | Nano Banana Flash - **GA**, fast. Auto-selected when only `GOOGLE_API_KEY` is set |
| Gemini | `gemini-3.1-flash-image-preview` | `GOOGLE_API_KEY` | `-p gemini -m 3.1-flash` | Nano Banana 2 - Image Search grounding, 512px |
| Gemini | `gemini-3-pro-image-preview` | `GOOGLE_API_KEY` | `-p gemini -m pro` | Nano Banana Pro - higher quality, up to 4K |
| xAI Grok | `grok-imagine-image` | `XAI_API_KEY` | `-p grok` | $0.02/image, standard quality |
| xAI Grok | `grok-imagine-image-pro` | `XAI_API_KEY` | `-p grok -m pro` | $0.07/image, higher quality |

### Image Aspect Ratios (Gemini)

All Gemini image models support 14 aspect ratios: `1:1`, `1:4`, `1:8`, `2:3`, `3:2`, `3:4`, `4:1`, `4:3`, `4:5`, `5:4`, `8:1`, `9:16`, `16:9`, `21:9`

### Image Aspect Ratios (Grok)

Grok Imagine supports 14 aspect ratios: `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `3:2`, `2:3`, `2:1`, `1:2`, `19.5:9`, `9:19.5`, `20:9`, `9:20`, `auto`

### Image Editing (3 providers)

| Provider | Model | Max Input Images | CLI Option | Features |
|----------|-------|------------------|------------|----------|
| Gemini | Flash | 3 | `-p gemini` (default) | Fast editing, 1K output |
| Gemini | 3.1 Flash | 3 | `-p gemini -m 3.1-flash` | Image Search grounding, 512px-1K output |
| Gemini | Pro | 14 | `-p gemini -m pro` | Multi-image composition, up to 4K output |
| OpenAI | `gpt-image-1.5` | 16 | `-p openai` | Instruction-based editing, multipart upload |
| OpenAI | `gpt-image-2` | 16 | `-p openai -m 2` | Flagship editor, 2026-04-21 GA |
| xAI Grok | `grok-imagine-image` | 1 | `-p grok` | Single image editing, $0.02/edit |

---

## Text-to-Video (5)

> Models marked **Audio: Yes** generate synchronized sound (dialogue, SFX, ambient). Silent models need separate `vibe generate speech` / `vibe generate sound-effect`.

| Provider | Model | Duration | Audio | Env Key | CLI Option | Notes |
|----------|-------|----------|-------|---------|------------|-------|
| Seedance via fal.ai | `seedance-2.0` (ByteDance) | 4-15 sec | Yes | `FAL_KEY` | `-p seedance` | ByteDance Seedance through fal.ai |
| Seedance via fal.ai | `seedance-2.0-fast` | 4-15 sec | Yes | `FAL_KEY` | `-p seedance --seedance-model fast` | Lower-latency / lower-cost variant of Seedance 2.0 |
| xAI Grok | `grok-imagine-video` | 1-15 sec | Yes | `XAI_API_KEY` | `-p grok` | Fallback default when `FAL_KEY` is unset. Best lip-sync/native audio. $0.07/s (720p) |
| Kling | `kling-v2-5-turbo` | 5-10 sec | No | `KLING_API_KEY` | `-p kling` | Fast (~36s generation) |
| Kling | `kling-v2-6` | 5-10 sec | No | `KLING_API_KEY` | `-p kling -m v2.6` | High quality |
| Kling | `kling-v3` | 5-10 sec | No | `KLING_API_KEY` | `-p kling -m v3` | Higher quality, multi-shot, lip-sync |
| Kling | `kling-v3-omni` | 3-15 sec | Yes | `KLING_API_KEY` | `-p kling -m v3-omni` | Native audio (multilingual), character consistency |
| Veo | `veo-3.1-fast-generate-preview` | 4-8 sec | Yes | `GOOGLE_API_KEY` | `-p veo` | Native audio, fast |
| Veo | `veo-3.1-generate-preview` | 4-8 sec | Yes | `GOOGLE_API_KEY` | `-p veo --veo-model 3.1` | Native audio, higher quality |
| Veo | `veo-3.0-generate-preview` | 5-8 sec | Yes | `GOOGLE_API_KEY` | `-p veo --veo-model 3.0` | Native audio |
| Runway | `gen4.5` | 2-10 sec | No | `RUNWAY_API_SECRET` | `-p runway` | Flagship, text+image-to-video (12 credits/sec) |
| Runway | `gen4_turbo` | 5-10 sec | No | `RUNWAY_API_SECRET` | `-p runway --runway-model gen4_turbo` | Legacy, **image-to-video only** |

> `-p fal` is a deprecated v0.x alias for `-p seedance` and will be removed at the 1.0 cut. Use `-p seedance` in new scripts.

### Veo Advanced Options

| Option | Values | Description |
|--------|--------|-------------|
| `--negative-prompt` | text | What to avoid in the generated video |
| `--resolution` | 720p, 1080p, 4k | Video resolution |
| `--last-frame` | image path | Frame interpolation (first→last frame) |
| `--ref-images` | image paths (max 3) | Character consistency (Veo 3.1 only) |
| `--person` | allow_all, allow_adult | Person generation setting |
| `veo-extend` | operation-name | Extend a previously generated Veo video |

### Image-to-Video

All text-to-video providers also support image-to-video. Key differences per provider:

| Provider | Model | I2V Support | Image Input | Notes |
|----------|-------|-------------|-------------|-------|
| Seedance via fal.ai | `seedance-2.0` | Yes | **URL only** | Auto-uploads via ImgBB (`IMGBB_API_KEY`) for local image paths. |
| xAI Grok | `grok-imagine-video` | Yes | URL or data URI | Same pricing as T2V |
| Kling | all v2.5+ models | Yes | **URL only** | Auto-uploads via ImgBB (`IMGBB_API_KEY`) |
| Veo | all models | Yes | base64 (first frame) | Supports `--last-frame` for frame interpolation |
| Runway | `gen4.5` | Yes | URL or data URI | Text+image-to-video |
| Runway | `gen4_turbo` | **I2V only** | URL or data URI | Cannot do text-only generation |

---

## Audio (3)

| Provider | Capability | Env Key | Notes |
|----------|------------|---------|-------|
| ElevenLabs | TTS, SFX, Music, Voice Clone | `ELEVENLABS_API_KEY` | Music: 3s-10min, model music_v1. TTS: eleven_v3 |
| Whisper | Transcription | `OPENAI_API_KEY` | OpenAI API |
| Replicate | Music generation | `REPLICATE_API_TOKEN` | MusicGen, max 30s |

---

## Quick Reference

### Environment Variables

```bash
# LLM Providers
export OPENAI_API_KEY="sk-..."        # GPT, Whisper, GPT Image 1.5
export ANTHROPIC_API_KEY="sk-ant-..." # Claude
export GOOGLE_API_KEY="AIza..."       # Gemini (image, Veo video)
export XAI_API_KEY="xai-..."          # xAI Grok
export OPENROUTER_API_KEY="sk-or-..." # OpenRouter (300+ models)

# Media Providers
export ELEVENLABS_API_KEY="..."       # TTS, SFX
export RUNWAY_API_SECRET="..."        # Runway Gen-4 Turbo
export KLING_API_KEY="..."            # Kling v2.x/v3
export REPLICATE_API_TOKEN="..."      # Replicate (music)
```

### API Keys by Command

| Command | Required API Key | Model |
|---------|-----------------|-------|
| `vibe` (default) | `OPENAI_API_KEY` | GPT-5-mini (Agent LLM) |
| `vibe -p claude` | `ANTHROPIC_API_KEY` | Claude Sonnet 4.6 (Agent LLM) |
| `vibe -p gemini` | `GOOGLE_API_KEY` | Gemini 2.5 Flash (Agent LLM) |
| `vibe -p xai` | `XAI_API_KEY` | Grok 4.1 Fast (Agent LLM) |
| `vibe -p openrouter` | `OPENROUTER_API_KEY` | OpenRouter Auto (Agent LLM) |
| `vibe generate image -p openai` | `OPENAI_API_KEY` | OpenAI image generation |
| `vibe generate image -p gemini` | `GOOGLE_API_KEY` | Gemini image generation |
| `vibe edit image` | `GOOGLE_API_KEY` | Gemini Nano Banana |
| `vibe generate speech` | `ELEVENLABS_API_KEY` | ElevenLabs |
| `vibe generate music` | `ELEVENLABS_API_KEY` | ElevenLabs Music (default) |
| `vibe generate music -p replicate` | `REPLICATE_API_TOKEN` | Replicate MusicGen |
| `vibe generate video -p seedance` | `FAL_KEY` | Seedance via fal.ai |
| `vibe generate video -p grok` | `XAI_API_KEY` | Grok Imagine |
| `vibe generate video -p kling` | `KLING_API_KEY` | Kling v2.5-turbo |
| `vibe generate image -p grok` | `XAI_API_KEY` | Grok Imagine |
| `vibe generate video -p veo` | `GOOGLE_API_KEY` | Veo 3.1 |

---

## Provider Selection Notes

Provider defaults depend on which API keys are configured. For public docs and
demos, prefer explicit provider flags so the required key is obvious:

```bash
vibe generate image "..." -p openai
vibe generate image "..." -p gemini
vibe generate video "..." -p seedance
vibe generate video "..." -p veo
```

Use command help as the runtime source of truth for supported flags:

```bash
vibe generate image --help
vibe generate video --help
vibe edit image --help
```
