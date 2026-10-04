# AI Provider Models

Which models VibeFrame calls, how to pick one, and the provider behaviour worth knowing.
The model list itself is generated from the model catalog (`packages/ai-providers/src/catalog/catalog.ts`), which the CLI also reads for aliases, defaults, and cost estimates.

## Model catalog

<!-- BEGIN GENERATED: model catalog (pnpm gen:models) -->

Generated from the model catalog; edit `packages/ai-providers/src/catalog/catalog.ts`, then run `pnpm gen:models`.
Prices are upper-bound list prices for estimates, not metered billing.

### LLMs

| Provider | Model | ID | Aliases | Status | Price | Notes |
|---|---|---|---|---|---|---|
| claude | **Claude Sonnet 5.5** (default) | `claude-sonnet-5-5` | `sonnet` | GA | $2 / 1M input tokens | Agent, storyboard, translate-srt, motion default |
| claude | Claude Opus 5.5 | `claude-opus-5-5` | `opus` | GA | $4 / 1M input tokens |  |
| claude | Claude Opus 4.6 | `claude-opus-4-6` | `opus-4-6` | Legacy | $5 / 1M input tokens |  |
| openai | **GPT-5.4 mini** (default) | `gpt-5.4-mini` |  | GA | $0.75 / 1M input tokens | Agent and storyboard default (tools on Chat Completions) |
| gemini | **Gemini 3.8 Flash** (default) | `gemini-3.8-flash` | `flash`, `latest`, `flash-3.8`, `gemini` | GA | $0.75 / 1M input tokens (until 2026-12-31, then $1.50) |  |
| gemini | Gemini 3.5 Flash | `gemini-3.5-flash` | `flash-3.5` | GA |  |  |
| gemini | Gemini 3 Flash (preview) | `gemini-3-flash-preview` | `flash-3` | Preview |  |  |
| gemini | Gemini 3.1 Pro (preview) | `gemini-3.1-pro-preview` | `pro`, `pro-3.1`, `3.1-pro`, `gemini-3.1-pro` | Preview |  |  |
| gemini | Gemini 2.5 Flash | `gemini-2.5-flash` | `flash-2.5` | Legacy |  | New projects cannot use 2.5 models since 2026-09-18 |
| gemini | Gemini 2.5 Pro | `gemini-2.5-pro` | `pro-2.5`, `2.5-pro` | Legacy |  |  |
| grok | **Grok 4.3** (default) | `grok-4.3` |  | GA | $1.25 / 1M input tokens |  |
| grok | Grok 4.7 | `grok-4.7` |  | GA | $2 / 1M input tokens |  |

### Image

| Provider | Model | ID | Aliases | Status | Price | Notes |
|---|---|---|---|---|---|---|
| openai | **GPT Image 2.5 Sunburst** (default) | `gpt-image-2.5-sunburst` | `2.5`, `sunburst` | GA | $0.211 / image (high, 1024x1024) |  |
| openai | GPT Image 2.5 Flare | `gpt-image-2.5-flare` | `flare`, `2.5-flare` | GA | $0.211 / image (high, 1024x1024) |  |
| openai | GPT Image 2 | `gpt-image-2` | `2` | GA | $0.211 / image (high, 1024x1024) |  |
| openai | GPT Image 1.5 | `gpt-image-1.5` | `1.5` | Deprecated, shuts down 2026-12-01 | $0.133 / image (high, 1024x1024) |  |
| gemini | **Nano Banana 2** (default) | `gemini-3.1-flash-image` | `flash`, `3.1-flash`, `latest` | GA | $0.067 / image (1K) |  |
| gemini | Nano Banana 2 Lite | `gemini-3.1-flash-lite-image` | `lite` | GA | $0.034 / image (1K) |  |
| gemini | Nano Banana Pro | `gemini-3-pro-image` | `pro` | GA | $0.134 / image (1K-2K) |  |
| gemini | Nano Banana (2.5 Flash Image) | `gemini-2.5-flash-image` |  | Deprecated, shuts down 2026-10-02 |  |  |
| gemini | Nano Banana 2 (preview) | `gemini-3.1-flash-image-preview` |  | Deprecated, shuts down 2026-06-25 |  |  |
| gemini | Nano Banana Pro (preview) | `gemini-3-pro-image-preview` |  | Deprecated, shuts down 2026-06-25 |  |  |
| grok | **Grok Imagine Image** (default) | `grok-imagine-image` |  | GA | $0.02 / image |  |
| grok | Grok Imagine Image 2.0 | `grok-imagine-image-2.0` | `pro`, `2.0`, `quality` | GA | $0.08 / image (medium, 2K) |  |

### Video

| Provider | Model | ID | Aliases | Status | Price | Notes |
|---|---|---|---|---|---|---|
| seedance | **Seedance 2.0** (default) | `seedance-2.0` | `quality`, `2.0` | GA | $0.3024 / second (720p 16:9) | 4-15 s, native audio |
| seedance | Seedance 2.0 Fast | `seedance-2.0-fast` | `fast` | GA | $0.2419 / second (720p 16:9) | 4-15 s, up to 720p, native audio |
| seedance | Seedance 2.5 | `seedance-2.5` | `2.5` | GA | $0.473 / second (720p 16:9) | Opt-in; 4-30 s, native audio |
| omni | **Gemini Omni 1.1 Flash** (default) | `gemini-omni-1.1-flash` |  | GA | $0.1 / second (720p) | Google video default; the model picks 3-10 s; native audio |
| veo | Veo 3.1 | `veo-3.1-generate-preview` | `3.1` | Deprecated, shuts down 2026-10-22 | $0.4 / second (720p/1080p) | 4-8 s, native audio; explicit `-p veo` only |
| veo | **Veo 3.1 Fast** (default) | `veo-3.1-fast-generate-preview` | `3.1-fast` | Deprecated, shuts down 2026-10-22 | $0.1 / second (720p) | 4-8 s, native audio; explicit `-p veo` only |
| grok | **Grok Imagine Video 1.5** (default) | `grok-imagine-video-1.5` | `1.5` | GA | $0.14 / second (720p) | 1-15 s, native audio; 720p unless `--resolution` says otherwise |
| grok | Grok Imagine Video 1.5 Lite | `grok-imagine-video-1.5-lite` | `lite`, `1.5-lite` | GA | $0.03 / second (720p) | 1-15 s, native audio |
| grok | Grok Imagine Video | `grok-imagine-video` | `classic` | Legacy | $0.05 / second (480p) | Previous generation |
| kling | **Kling v3** (default) | `kling-v3` | `v3` | GA | $0.084 / second (std, silent) | 3-15 s, multi-shot; `std` 720p, `pro` 1080p |
| kling | Kling v2.6 | `kling-v2-6` | `v2.6` | GA | $0.042 / second (std 720p) | 5 or 10 s |
| kling | Kling v2.5 Turbo | `kling-v2-5-turbo` | `v2.5-turbo`, `v2.5` | GA | $0.042 / second (std) | 5 or 10 s, no audio |
| runway | **Runway Gen-4.5** (default) | `gen4.5` |  | GA | $0.12 / second | 2-10 s, no audio |
| runway | Runway Gen-4 Turbo | `gen4_turbo` |  | GA | $0.05 / second | Image-to-video only, no audio |

### Speech

| Provider | Model | ID | Aliases | Status | Price | Notes |
|---|---|---|---|---|---|---|
| elevenlabs | **ElevenLabs v3** (default) | `eleven_v3` |  | GA | $0.08 / 1K characters |  |
| openai | **GPT-4o mini TTS** (default) | `gpt-4o-mini-tts` |  | Deprecated, shuts down 2027-01-06 |  |  |

### Music

| Provider | Model | ID | Aliases | Status | Price | Notes |
|---|---|---|---|---|---|---|
| elevenlabs | **ElevenLabs Music v2.5** (default) | `music_v2_5` |  | GA | $0.15 / minute |  |

### Sound effects

| Provider | Model | ID | Aliases | Status | Price | Notes |
|---|---|---|---|---|---|---|
| elevenlabs | **ElevenLabs Sound Effects v2** (default) | `eleven_text_to_sound_v2` |  | GA | $0.12 / minute | 0.5-30 s |

### Transcription

| Provider | Model | ID | Aliases | Status | Price | Notes |
|---|---|---|---|---|---|---|
| openai | **Whisper** (default) | `whisper-1` |  | Deprecated, shuts down 2027-02-26 |  | Only OpenAI model with word timestamps |

<!-- END GENERATED: model catalog -->

### Choosing a model

| Command | Flag | Values |
|---|---|---|
| `vibe agent -p claude\|openai\|gemini\|xai` | `--model` | Any model ID; default is the provider's catalog default |
| `vibe generate motion` | `-m` | Claude aliases (`sonnet` default, `opus`, `opus-4-6`) or Gemini aliases (`gemini`, `gemini-3.1-pro`, `gemini-2.5-pro`) |
| `vibe generate image -p openai\|gemini\|grok`, `vibe edit image` | `-m` | The image aliases above |
| `vibe generate video -p seedance` | `--seedance-model` | `quality` (default), `fast`, `2.5` |
| `vibe generate video -p grok` | `--grok-model` | `1.5` (default), `lite`, `classic` |
| `vibe generate video -p kling` | `--kling-model` | `v3` (default), `v2.6`, `v2.5-turbo` |
| `vibe generate video -p veo` | `--veo-model` | `3.1-fast` (default), `3.1` |
| `vibe generate video -p runway` | `--runway-model` | `gen4.5` (default), `gen4_turbo` |

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

Claude Opus 4.7 and every 5.x model reject `temperature`, `top_p`, and `top_k`, and Gemini 3.x deprecates them; VibeFrame never sends them.
GPT-6 Astra and 6.1 Sol reject tool calls on Chat Completions (Responses API only), so they cannot drive Agent mode yet.
`grok-4-1-fast-reasoning` was retired on 2026-05-15; xAI silently serves `grok-4.3` for it.

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

---

## Motion Graphics LLM (vibe generate motion)

Remotion component code generation takes a Claude or Gemini alias with `-m` (see "Choosing a model").
Claude motion replies use structured outputs, so the generated component code always arrives as valid JSON.

---

## Text-to-Image (3 providers)

Models, aliases, and prices are in the catalog above; `-p openai|gemini|grok` picks the provider.

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

Models, durations, and prices are in the catalog above.
Provider keys: Seedance `FAL_API_KEY`, Grok `XAI_API_KEY`, Kling `KLING_API_KEY`, Omni and Veo `GOOGLE_API_KEY`, Runway `RUNWAY_API_SECRET`.

> `-p fal` is a deprecated v0.x alias for `-p seedance` and will be removed at the 1.0 cut. Use `-p seedance` in new scripts.

> ⚠️ **Seedance rejects image-to-video inputs showing a recognizable face.**
> This is ByteDance's platform-wide likeness policy, not a fal.ai quirk: the
> API returns a deterministic HTTP 422 ("The images or videos provided may
> contain likenesses of real people") for keyframes where a person's face is
> clearly visible - including AI-generated photoreal faces. Hands-only or
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
