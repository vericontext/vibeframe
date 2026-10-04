# AI Provider Models

> Single source of truth for AI model information used across VibeFrame.

---

## Agent LLM Providers (7)

Used for natural language processing in Agent mode (`vibe agent`).

| Provider | Model | API Model ID | Env Key | CLI Option |
|----------|-------|-------------|---------|------------|
| OpenAI | GPT-5.4 mini | `gpt-5.4-mini` | `OPENAI_API_KEY` | `-p openai` |
| Claude | Sonnet 5.5 | `claude-sonnet-5-5` | `ANTHROPIC_API_KEY` | `-p claude` |
| Gemini | 3.8 Flash | `gemini-3.8-flash` | `GOOGLE_API_KEY` | `-p gemini` |
| xAI | Grok 4.3 | `grok-4.3` | `XAI_API_KEY` | `-p xai` |
| OpenRouter | Auto (300+ models) | `openrouter/auto` | `OPENROUTER_API_KEY` | `-p openrouter` |
| Evolink | GPT-5.2 (via unified API) | `gpt-5.2` | `EVOLINK_API_KEY` | `-p evolink` |
| Ollama | Local models | user-configured | - | `-p ollama` |

Override the model per session with `vibe agent -p <provider> --model <id>`.
Claude and Gemini replay their own assistant content (thinking blocks, thought signatures) between tool turns, which current models require.

**OpenAI model options:**

| Model ID | Variant | Notes |
|----------|---------|-------|
| `gpt-5.4-mini` | GPT-5.4 mini | **Default**. Function calling on Chat Completions. $0.75/M input, $4.50/M output |
| `gpt-6-luna` | GPT-6 Luna | Cheapest GPT-6. On Chat Completions it calls tools only with `reasoning_effort: "none"`; not yet supported by the agent adapter |
| `gpt-5-mini` | GPT-5 mini (legacy) | Shuts down 2026-12-11 |

> `gpt-6-astra` and `gpt-6.1-sol` reject tool calls on Chat Completions (Responses API only), so they cannot drive Agent mode.

**Claude model options:**

| Model ID | Variant | Notes |
|----------|---------|-------|
| `claude-sonnet-5-5` | Sonnet 5.5 | **Default**. $2/M input, $10/M output, 1M context |
| `claude-opus-5-5` | Opus 5.5 | Highest capability in the 5.5 tier. $4/M input, $20/M output |
| `claude-fable-5-1` | Fable 5.1 | Long-horizon agentic work. $10/M input, $50/M output |
| `claude-sonnet-4-6` | Sonnet 4.6 (legacy) | $3/M input, $15/M output. Still supported |

Claude Opus 4.7 and every 5.x model reject `temperature`, `top_p`, and `top_k`; VibeFrame never sends them.

**xAI model options:**

| Model ID | Variant | Notes |
|----------|---------|-------|
| `grok-4.3` | Grok 4.3 | **Default**. 1M context. $1.25/M input, $2.50/M output |
| `grok-4.7` | Grok 4.7 | Flagship. $2/M input, $6/M output |

> `grok-4-1-fast-reasoning` was retired on 2026-05-15; xAI now silently serves `grok-4.3` for it.

**OpenRouter model options:**

`openrouter/auto` is the default and routes to a model per request. OpenRouter slugs use dots in version numbers:

| Model ID | Provider | Notes |
|----------|----------|-------|
| `openrouter/auto` | Auto | **Default**. Cost and tool support vary per pick |
| `anthropic/claude-sonnet-5.5` | Anthropic | Claude Sonnet 5.5 |
| `openai/gpt-6-luna` | OpenAI | GPT-6 Luna |
| `google/gemini-3.8-flash` | Google | Gemini 3.8 Flash |
| `qwen/qwen3.8-flash` | Qwen | Inexpensive, tool-capable |
| `deepseek/deepseek-v4.1-flash` | DeepSeek | Inexpensive, tool-capable |

To use a specific model: `vibe agent -p openrouter --model anthropic/claude-sonnet-5.5`

> See [openrouter.ai/models](https://openrouter.ai/models) for the full list.

**Evolink model options:**

| Model ID | Provider | Notes |
|----------|----------|-------|
| `gpt-5.2` | OpenAI | **Default**. GPT-5.2 via Evolink |
| `evolink/auto` | Auto | Auto-routing |
| `gemini-3.8-flash` | Google | Tool calls work on Chat Completions |
| `claude-sonnet-5-5` | Anthropic | Claude Sonnet 5.5 via Evolink |
| `doubao-seed-2.0-pro` | ByteDance | Doubao Seed 2.0 Pro via Evolink |

> See [docs.evolink.ai](https://docs.evolink.ai/llms.txt) for the full model catalog.

**Gemini model options:**

`flash` / `latest` and Agent mode both resolve to `gemini-3.8-flash`.
One-shot calls (media analysis, render review, storyboard, silence-cut analysis, composition) use the same default.

| Model ID | Alias | Notes |
|----------|-------|-------|
| `gemini-3.8-flash` | `flash`, `latest`, `flash-3.8` | **Default**. $0.75/M input, $3.75/M output until 2026-12-31, then $1.50/$7.50 |
| `gemini-3.5-flash` | `flash-3.5` | Previous default |
| `gemini-3.1-pro-preview` | `pro`, `pro-3.1` | Preview; strongest reasoning |
| `gemini-2.5-flash` | `flash-2.5` | Legacy; new projects cannot use 2.5 models since 2026-09-18 |
| `gemini-2.5-pro` | `pro-2.5` | Legacy; same restriction |

Gemini 3.x deprecates `temperature`, `top_p`, and `top_k`; VibeFrame no longer sends them.

---

## Motion Graphics LLM (vibe generate motion)

Used for Remotion component code generation (`vibe generate motion`).

| Alias | Model | Provider | Env Key | CLI Option | Notes |
|-------|-------|----------|---------|------------|-------|
| `sonnet` | `claude-sonnet-5-5` | Claude | `ANTHROPIC_API_KEY` | `-m sonnet` | **Default** |
| `opus` | `claude-opus-5-5` | Claude | `ANTHROPIC_API_KEY` | `-m opus` | Best quality |
| `opus-4-6` | `claude-opus-4-6` | Claude | `ANTHROPIC_API_KEY` | `-m opus-4-6` | Previous Opus tier (legacy) |
| `gemini` | `gemini-3.8-flash` | Gemini | `GOOGLE_API_KEY` | `-m gemini` | Gemini default |
| `gemini-2.5-pro` | `gemini-2.5-pro` | Gemini | `GOOGLE_API_KEY` | `-m gemini-2.5-pro` | Legacy; restricted for new projects |
| `gemini-3.1-pro` | `gemini-3.1-pro-preview` | Gemini | `GOOGLE_API_KEY` | `-m gemini-3.1-pro` | Gemini 3.1 Pro |

Claude motion replies use structured outputs, so the generated component code always arrives as valid JSON.

---

## Text-to-Image (3 providers, 9 models)

| Provider | Model | Env Key | CLI Option | Notes |
|----------|-------|---------|------------|-------|
| OpenAI | `gpt-image-2.5-sunburst` | `OPENAI_API_KEY` | `-p openai` | **Default**. OpenAI's most capable image model (2026-09-08); high quality about $0.21 per 1024x1024 image |
| OpenAI | `gpt-image-2.5-flare` | `OPENAI_API_KEY` | `-p openai -m flare` | Fast, high-quality everyday tier |
| OpenAI | `gpt-image-2` | `OPENAI_API_KEY` | `-p openai -m 2` | Previous default |
| OpenAI | `gpt-image-1.5` | `OPENAI_API_KEY` | `-p openai -m 1.5` | Shuts down 2026-12-01 |
| Gemini | `gemini-3.1-flash-image` | `GOOGLE_API_KEY` | `-p gemini` | Nano Banana 2 (GA). `flash`, `latest`, and `3.1-flash` all resolve here. About $0.067 at 1K |
| Gemini | `gemini-3.1-flash-lite-image` | `GOOGLE_API_KEY` | `-p gemini -m lite` | Nano Banana 2 Lite, about $0.034 at 1K |
| Gemini | `gemini-3-pro-image` | `GOOGLE_API_KEY` | `-p gemini -m pro` | Nano Banana Pro (GA), up to 4K |
| xAI Grok | `grok-imagine-image` | `XAI_API_KEY` | `-p grok` | $0.02/image |
| xAI Grok | `grok-imagine-image-2.0` | `XAI_API_KEY` | `-p grok -m pro` | Medium quality, $0.06-0.08/image |

Images are saved in the format the output file name asks for: when a provider returns JPEG for a `.png` path, VibeFrame converts it with FFmpeg.
`gemini-2.5-flash-image` and the `-preview` Nano Banana IDs are past their shutdown dates; pass them explicitly only if you must.

### Image Aspect Ratios (Gemini)

All Gemini image models support 14 aspect ratios: `1:1`, `1:4`, `1:8`, `2:3`, `3:2`, `3:4`, `4:1`, `4:3`, `4:5`, `5:4`, `8:1`, `9:16`, `16:9`, `21:9`

### Image Aspect Ratios (Grok)

Grok Imagine supports 14 aspect ratios: `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `3:2`, `2:3`, `2:1`, `1:2`, `19.5:9`, `9:19.5`, `20:9`, `9:20`, `auto`

### Image Editing (3 providers)

| Provider | Model | Max Input Images | CLI Option | Features |
|----------|-------|------------------|------------|----------|
| Gemini | `gemini-3.1-flash-image` | 3 | `-p gemini` (default) | Fast editing |
| Gemini | `gemini-3-pro-image` | 14 | `-p gemini -m pro` | Multi-image composition, up to 4K output |
| OpenAI | `gpt-image-2.5-sunburst` | 16 | `-p openai` | Instruction-based editing, multipart upload |
| xAI Grok | `grok-imagine-image` | 1 | `-p grok` | Single image editing, $0.02/edit; `-m pro` uses `grok-imagine-image-2.0` |

---

## Text-to-Video (6 providers)

> Models marked **Audio: Yes** generate synchronized sound (dialogue, SFX, ambient). Silent models need separate `vibe generate speech` / `vibe generate sound-effect`.

| Provider | Model | Duration | Audio | Env Key | CLI Option | Notes |
|----------|-------|----------|-------|---------|------------|-------|
| Seedance via fal.ai | `seedance-2.0` (ByteDance) | 4-15 sec | Yes | `FAL_API_KEY` | `-p seedance` | ByteDance Seedance through fal.ai |
| Seedance via fal.ai | `seedance-2.0-fast` | 4-15 sec | Yes | `FAL_API_KEY` | `-p seedance --seedance-model fast` | Lower-latency / lower-cost variant of Seedance 2.0 |
| Seedance via fal.ai | `seedance-2.5` | 4-30 sec | Yes | `FAL_API_KEY` | `-p seedance --seedance-model 2.5` | Opt-in. Longer clips; about 1.5x the 2.0 price at 720p ($0.47/s) |
| xAI Grok | `grok-imagine-video-1.5` | 1-15 sec | Yes | `XAI_API_KEY` | `-p grok` | Default Grok model, rendered at 720p unless `--resolution` says otherwise. About $0.14/s at 720p |
| xAI Grok | `grok-imagine-video-1.5-lite` | 1-15 sec | Yes | `XAI_API_KEY` | `-p grok --grok-model lite` | Budget tier, about $0.03/s at 720p |
| xAI Grok | `grok-imagine-video` | 1-15 sec | Yes | `XAI_API_KEY` | `-p grok --grok-model classic` | Previous generation |
| Kling | `kling-v3` | 3-15 sec | Optional | `KLING_API_KEY` | `-p kling` | Default. Multi-shot; `std` 720p, `pro` 1080p |
| Kling | `kling-v2-6` | 5 or 10 sec | Optional (pro) | `KLING_API_KEY` | `-p kling --kling-model v2.6` | |
| Kling | `kling-v2-5-turbo` | 5 or 10 sec | No | `KLING_API_KEY` | `-p kling --kling-model v2.5-turbo` | Cheapest Kling |
| Gemini Omni | `gemini-omni-1.1-flash` | 3-10 sec (model picks) | Yes | `GOOGLE_API_KEY` | `-p omni` | Google default (GA 2026-08-27). 360p/720p native, 1080p/4K upscaled; about $0.10/s at 720p |
| Veo | `veo-3.1-fast-generate-preview` | 4-8 sec | Yes | `GOOGLE_API_KEY` | `-p veo` | **Shuts down 2026-10-22**; explicit only |
| Veo | `veo-3.1-generate-preview` | 4-8 sec | Yes | `GOOGLE_API_KEY` | `-p veo --veo-model 3.1` | **Shuts down 2026-10-22**; explicit only |
| Runway | `gen4.5` | 2-10 sec | No | `RUNWAY_API_SECRET` | `-p runway` | Flagship, text+image-to-video (12 credits/sec) |
| Runway | `gen4_turbo` | 5-10 sec | No | `RUNWAY_API_SECRET` | `-p runway --runway-model gen4_turbo` | Legacy, **image-to-video only** |

> `-p fal` is a deprecated v0.x alias for `-p seedance` and will be removed at the 1.0 cut. Use `-p seedance` in new scripts.

> ⚠️ **Seedance rejects image-to-video inputs showing a recognizable face.**
> This is ByteDance's platform-wide likeness policy, not a fal.ai quirk: the
> API returns a deterministic HTTP 422 ("The images or videos provided may
> contain likenesses of real people") for keyframes where a person's face is
> clearly visible — including AI-generated photoreal faces. Hands-only or
> back-of-head shots pass. Retrying does not help. `vibe build` falls back to
> Runway automatically for such beats when `RUNWAY_API_SECRET` is configured;
> you can also pin a beat with a `provider: runway` cue, or run
> `vibe generate video "<motion>" -p runway -i keyframe.png` directly.
> Observed 2026-07-26 on `seedance-2.0`.

> **Veo 3.1 previews shut down on 2026-10-22.** Google names Gemini Omni 1.1 Flash as the replacement, so Omni is now the Google video default (`-p omni`, or auto-selected when `GOOGLE_API_KEY` is the only video key) and `vibe build --video-provider omni` works. `-p veo` still works until the shutdown and prints a warning.

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
| xAI Grok | `grok-imagine-video-1.5` | Yes | URL or data URI | Same pricing as T2V, plus $0.01 per input image |
| Kling | all v2.5+ models | Yes | **URL only** | Auto-uploads via ImgBB (`IMGBB_API_KEY`) |
| Veo | all models | Yes | base64 (first frame) | Supports `--last-frame` for frame interpolation |
| Runway | `gen4.5` | Yes | URL or data URI | Text+image-to-video |
| Runway | `gen4_turbo` | **I2V only** | URL or data URI | Cannot do text-only generation |
| Gemini Omni | `gemini-omni-1.1-flash` | Yes | base64 (first frame; `--last-frame` adds an end frame) | Sent as typed `image` inputs before the text prompt |

### Gemini Omni

Gemini Omni 1.1 Flash (`gemini-omni-1.1-flash`) is Google's GA video model on the Generative Language API and the replacement for the Veo 3.1 previews.

Reference: <https://ai.google.dev/gemini-api/docs/omni>

| Property | Value |
|----------|-------|
| Model ID | `gemini-omni-1.1-flash` |
| Endpoint | `POST /v1beta/interactions` (not Veo's `:predictLongRunning`) |
| Auth | `GOOGLE_API_KEY` (same key as Gemini) |
| Input | text, or typed `image` items (first and last frame) followed by the text |
| Output | `response_format: {type: "video", aspect_ratio, resolution, delivery: "uri"}`; VibeFrame waits for the Files API entry to become ACTIVE, then downloads it with the key in a header |
| Aspect ratios | `16:9`, `9:16` |
| Resolution | `360p`, `720p` (default); `1080p` and `4k` are upscaled |
| Duration | 3-10 s, chosen by the model (no duration parameter) |
| Watermark | SynthID |

Not yet wired: multi-turn editing with `previous_interaction_id`, extension up to 40 s, and video references.
Recognizable real people in uploaded images are not supported, so it is no fallback for Seedance's likeness filter.

---

## Audio (5)

| Provider | Capability | Env Key | Notes |
|----------|------------|---------|-------|
| ElevenLabs | TTS, SFX, Music, Voice Clone | `ELEVENLABS_API_KEY` | TTS: eleven_v3. SFX: 0.5-30s. Music: 3s-10min, model music_v2_5 (48 kHz / 192 kbps MP3) |
| OpenAI TTS | TTS | `OPENAI_API_KEY` | gpt-4o-mini-tts (~$0.015/min of audio); voices incl. marin, alloy, nova |
| Kokoro | TTS (local, free) | - | Kokoro-82M (Apache 2.0); ~90MB model on first use; bundled in the Desktop extension. English voices only. Long narration is synthesised in sentence chunks |
| Whisper | Transcription | `OPENAI_API_KEY` | OpenAI API |
| Replicate | Music generation | `REPLICATE_API_TOKEN` | MusicGen, max 30s. Weights are CC-BY-NC: not for commercial use |

---

## Quick Reference

### Environment Variables

```bash
# LLM Providers
export OPENAI_API_KEY="sk-..."        # GPT, Whisper, GPT Image 2.5
export ANTHROPIC_API_KEY="sk-ant-..." # Claude
export GOOGLE_API_KEY="AIza..."       # Gemini (image, Veo video)
export XAI_API_KEY="xai-..."          # xAI Grok
export OPENROUTER_API_KEY="sk-or-..." # OpenRouter (300+ models)
export EVOLINK_API_KEY="el-..."          # Evolink (GPT-5, Claude, Gemini, DeepSeek & more)

# Media Providers
export ELEVENLABS_API_KEY="..."       # TTS, SFX
export RUNWAY_API_SECRET="..."        # Runway Gen-4 Turbo
export KLING_API_KEY="..."            # Kling v2.x/v3
export REPLICATE_API_TOKEN="..."      # Replicate (music)
```

### API Keys by Command

| Command | Required API Key | Model |
|---------|-----------------|-------|
| `vibe agent` (default) | `OPENAI_API_KEY` | GPT-5.4 mini (Agent LLM) |
| `vibe agent -p claude` | `ANTHROPIC_API_KEY` | Claude Sonnet 5.5 (Agent LLM) |
| `vibe agent -p gemini` | `GOOGLE_API_KEY` | Gemini 3.8 Flash (Agent LLM) |
| `vibe agent -p xai` | `XAI_API_KEY` | Grok 4.3 (Agent LLM) |
| `vibe agent -p openrouter` | `OPENROUTER_API_KEY` | OpenRouter Auto (Agent LLM) |
| `vibe agent -p evolink` | `EVOLINK_API_KEY` | GPT-5.2 via Evolink (Agent LLM) |
| `vibe generate image -p openai` | `OPENAI_API_KEY` | OpenAI image generation |
| `vibe generate image -p gemini` | `GOOGLE_API_KEY` | Gemini image generation |
| `vibe edit image` | `GOOGLE_API_KEY` | Gemini Nano Banana |
| `vibe generate speech` | `ELEVENLABS_API_KEY` | ElevenLabs |
| `vibe generate music` | `ELEVENLABS_API_KEY` | ElevenLabs Music (default) |
| `vibe generate music -p replicate` | `REPLICATE_API_TOKEN` | Replicate MusicGen |
| `vibe generate video -p seedance` | `FAL_API_KEY` | Seedance via fal.ai |
| `vibe generate video -p grok` | `XAI_API_KEY` | Grok Imagine Video 1.5 |
| `vibe generate video -p kling` | `KLING_API_KEY` | Kling v3 |
| `vibe generate image -p grok` | `XAI_API_KEY` | Grok Imagine |
| `vibe generate video -p omni` | `GOOGLE_API_KEY` | Gemini Omni 1.1 Flash |
| `vibe generate video -p veo` | `GOOGLE_API_KEY` | Veo 3.1 (shuts down 2026-10-22) |

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
