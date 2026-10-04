---
provider: openai
checked: 2026-10-04
env: [OPENAI_API_KEY]
models_endpoint: openai
models_in_use:
  - gpt-5.4-mini                # agent default, storyboard, translate-srt
  - gpt-image-2.5-sunburst      # image default
  - gpt-image-2.5-flare         # image `flare`
  - gpt-image-2                 # image `2`
  - gpt-image-1.5               # image `1.5` alias; shuts down 2026-12-01
  - gpt-4o-mini-tts             # TTS default; shuts down 2027-01-06
  - whisper-1                   # transcription with word timestamps; shuts down 2027-02-26
  - tts-1                       # TTS option; shuts down 2027-01-06
  - tts-1-hd                    # TTS option; shuts down 2027-01-06
models_recommended:
  - gpt-6-luna                  # cheaper agent default once tools send reasoning_effort none or use Responses
---

# OpenAI

VibeFrame uses OpenAI for the built-in agent loop and text tasks (command parsing, storyboard, narration script, SRT translation) on `gpt-5-mini`, image generation and editing on GPT Image, narration TTS, and Whisper transcription with word timestamps for captions and jump cuts.
Several of these model IDs are already shut down or have shutdown dates inside the next six months.

## Models

Prices are USD per 1M input / output tokens on Standard processing unless noted.

| ID | Kind | Status | Price | Notes |
|---|---|---|---|---|
| `gpt-6-astra` | text+image, reasoning | GA, flagship | $10 / $50 | 1.05M context; Chat Completions without tools only; no `none` effort (docs) |
| `gpt-6.1-sol` | text+image, reasoning | GA | $2 / $10 | Chat Completions without tools only; no `none`/`minimal` effort (docs) |
| `gpt-6-sol` | text+image, reasoning | GA | $2 / $10 | Chat Completions tools only with `reasoning_effort: "none"` (docs) |
| `gpt-6-luna` | text+image, reasoning | GA | $0.10 / $0.50 | Same Chat Completions tool rule as 6 Sol (docs) |
| `gpt-5.6-sol` / `-terra` / `-luna` | text+image, reasoning | GA | $4/$20, $2/$12, $0.20/$1.20 | Terra is the "mini" tier and the named replacement for `gpt-5-mini` (docs) |
| `gpt-5.4-mini` | text+image, reasoning | GA, no shutdown listed | $0.75 / $4.50 | 400K context, default effort `none` (docs) |
| `gpt-5-mini` | text+image, reasoning | **Shuts down 2026-12-11** | $0.25 / $2 | **In use.** Alias resolves to `gpt-5-mini-2025-08-07`, which is on the deprecation list (docs) |
| `gpt-image-2.5-sunburst` | image gen/edit | GA, newest | $8 in / $30 out (image tokens) | Quality `low`..`max`, `auto`; best for edit precision (docs) |
| `gpt-image-2.5-flare` | image gen/edit | GA, newest | $8 / $30 (image tokens) | Fastest everyday generation (docs) |
| `gpt-image-2` | image gen/edit | GA | $8 / $30 (image tokens) | **In use, our default.** 1024x1024: $0.006 low, $0.053 medium, $0.211 high (docs) |
| `gpt-image-1.5` | image gen/edit | **Shuts down 2026-12-01** | $8 / $32 (image tokens) | **In use** (`--model 1.5`). 1024x1024: $0.009 / $0.034 / $0.133 (docs) |
| `dall-e-3`, `dall-e-2` | image | **Shut down 2026-05-12** | - | **Still referenced.** Absent from `/v1/models` (probe, docs) |
| `gpt-4o-mini-tts` | TTS | **Snapshots shut down 2027-01-06** | $0.60 text in, $12 audio out | **In use, default.** Max 2000 input tokens (docs) |
| `tts-1` / `tts-1-hd` | TTS | **Shut down 2027-01-06** | $15 / $30 per 1M chars | **In use** (opt-in) (docs) |
| `gpt-transcribe` | STT | GA | $0.0045 / min | Recommended file transcription model; no word timestamps documented (docs) |
| `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` | STT | **Shut down 2027-02-26** | $0.006, $0.003 / min | `json` output only (docs) |
| `whisper-1` | STT | **Shuts down 2027-02-26** | $0.006 / min | **In use.** The only model documented for word/segment timestamps (docs) |

## API shape

- Base URL `https://api.openai.com/v1`, auth `Authorization: Bearer $OPENAI_API_KEY`; all calls we make are synchronous.
- Text: `POST /chat/completions` with `model`, `messages`, `tools`, `tool_choice`, `response_format`, `max_completion_tokens`; we read `choices[0].message.content` and `.tool_calls` (docs).
  OpenAI's own docs now point new work at `POST /responses` (`input`, `text.format`, `reasoning.effort`, `max_output_tokens`) (docs).
- Images: `POST /images/generations` (JSON) and `POST /images/edits` (multipart with repeated `image[]` parts plus optional `mask`, or JSON with `images: [{image_url | file_id}]`); the response is `data[].b64_json` for GPT Image models (docs).
  Up to 16 input images per edit for GPT Image models; mask and image must share format and size and be under 50 MB (docs).
- TTS: `POST /audio/speech` with `model`, `input`, `voice`, optional `instructions`, `response_format` (default mp3), `speed`; body is raw audio (docs).
- STT: `POST /audio/transcriptions` multipart with `file`, `model`, `response_format`, `timestamp_granularities[]`; 25 MB file limit; formats flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm (docs).
- Errors: JSON with an `error` object carrying a human-readable `message`; our image provider reads `error.message`, and the probe 400s below quote that message.

## Gotchas

- **`max_tokens` is rejected on reasoning models.** `gpt-5-mini` returned 400 "Unsupported parameter: 'max_tokens' ... Use 'max_completion_tokens' instead." (probe).
  The reference marks `max_tokens` deprecated and says `max_completion_tokens` includes reasoning tokens (docs).
- **Only the default `temperature` works on reasoning models.** `gpt-5-mini` with `temperature: 0.2` returned 400 "Only the default (1) value is supported." (probe).
  On GPT-6, remove `temperature`, `top_p`, `top_logprobs`, and `logprobs` whenever effort is not `none` (docs).
- **Reasoning eats the output budget.** A `gpt-5-mini` call spent 3584 of 4096 completion tokens on reasoning (probe); OpenAI suggests reserving at least 25,000 tokens while experimenting (docs).
- **GPT-6 tool calling on Chat Completions:** `gpt-6-astra` and `gpt-6.1-sol` accept Chat Completions only without tools; `gpt-6-sol` and `gpt-6-luna` allow function calling there only with `reasoning_effort: "none"`; use the Responses API for reasoning with tools (docs).
- **`json_object` (JSON mode) only guarantees valid JSON, not a schema**, and the word "JSON" must appear in the context or the API errors (docs).
  Asked for a bare array under `json_object`, `gpt-5-mini` returned an object `{"0": {"error": "Invalid response format..."}}` (probe).
  Structured Outputs (`json_schema`, `strict: true`) enforce the schema, but the root must be an object, not `anyOf` (docs).
- **`/v1/models` is not a reliable liveness check.** It still lists `sora-2`, `gpt-5-codex`, `gpt-5.1-codex`, and `gpt-4o-search-preview-2025-03-11`, all past their documented shutdown dates (probe, docs).
  It does correctly omit `dall-e-2` and `dall-e-3` (probe).
- **GPT Image models ignore `response_format`**; they always return base64 (docs).
  `size` accepts custom `WxH` on `gpt-image-2` and 2.5: edges multiples of 16, max edge 3840, ratio within 3:1, 655,360 to 8,294,400 total pixels; above 2560x1440 is experimental (docs).
  `xhigh` and `max` quality exist only on the 2.5 models; earlier models stop at `high` (docs).
  `input_fidelity` must be omitted for `gpt-image-2` (docs).
  Transparent backgrounds need `background: "transparent"` with `png` or `webp` output (docs).
- **Image pricing is token based**, so per-image cost varies by size and quality; Responses-only cached input rates do not apply to `/images/edits` (docs).
- **TTS voices:** 13 voices on `gpt-4o-mini-tts` (`marin` and `cedar` recommended), but `tts-1`/`tts-1-hd` support only `alloy`, `ash`, `coral`, `echo`, `fable`, `onyx`, `nova`, `sage`, `shimmer` (docs).
- **TTS has no `/audio/speech` successor.** The named replacement for every TTS model, `gpt-realtime-2.1-mini`, lists `v1/audio/speech` as not supported (docs).
- **Word timestamps are Whisper-only.** The transcription guide says to use `whisper-1` for word or segment timestamps, `timestamp_granularities` requires `verbose_json`, and `gpt-4o-transcribe`/`-mini` accept only `json` (docs).
  `whisper-1` shuts down 2027-02-26 and its named replacements (`gpt-transcribe`, `gpt-live-transcribe`) document no word timestamps (docs).
- **`gpt-transcribe` uses `languages` (array)**, not `language`; sending both is an error (docs).

## In our code

- `packages/ai-providers/src/openai/OpenAIProvider.ts:24-25` base URL and `gpt-5-mini`; `:117-130` `parseCommand` (Chat Completions, `json_object`, no token cap); `:397-407` narration script (`max_completion_tokens: 16384`, `json_object`).
- `packages/ai-providers/src/openai/openai-storyboard.ts:27-48` storyboard with `json_object` and a `{"segments": [...]}` wrapper.
- `packages/cli/src/agent/adapters/openai.ts:18` default `gpt-5-mini`; `:82-87` `chat.completions.create` with `tools` and `tool_choice: "auto"`.
- `packages/cli/src/commands/_shared/edit/translate-srt.ts:96-104` direct Chat Completions call on `gpt-5-mini`.
- `packages/ai-providers/src/openai-image/OpenAIImageProvider.ts:16` `GPTImageModel` (includes `dall-e-3`); `:20-24` and `:13` stale per-image price comments; `:75-78` default `gpt-image-2`; `:121-146` request body (DALL-E branch sends `response_format`); `:151` generations; `:263-299` multipart edits with `image[]`; `:353-372` `createVariation` on `dall-e-2` via `/images/variations`.
- `packages/cli/src/commands/_shared/openai-image.ts:34-50` maps `1.5` / `gpt-image-1.5` to `gpt-image-1.5`, anything else to `gpt-image-2`.
- `packages/cli/src/commands/_shared/scene-build.ts:281`, `:1967` scene backdrops default to `gpt-image-2`.
- `packages/ai-providers/src/openai-tts/OpenAiTtsProvider.ts:12` model union; `:18-32` voice list; `:37-38` defaults `marin` and `gpt-4o-mini-tts`; `:108-118` `/audio/speech` call.
- `packages/ai-providers/src/whisper/WhisperProvider.ts:58-74` `whisper-1`, `verbose_json`, `timestamp_granularities[]`.
- `packages/cli/src/commands/_shared/edit/jump-cut.ts:82-90` `whisper-1` word timestamps for filler detection.
- `packages/cli/src/agent/adapters/evolink.ts:19` uses `gpt-5.2` through EvoLink's OpenAI-compatible endpoint, not api.openai.com, so it is not listed in `models_in_use`.

## Recommended changes

1. Remove `dall-e-3` from `GPTImageModel` and the DALL-E request branch, and remove or reimplement `createVariation` (`dall-e-2`); both models have been shut down since 2026-05-12.
2. Replace `gpt-5-mini` before 2026-12-11 in the provider, storyboard, translate-srt, and agent adapter.
   `gpt-5.6-terra` is the named replacement but costs about 8x more on input; `gpt-5.4-mini` has no shutdown date and keeps Chat Completions tools; `gpt-6-luna` is cheapest but needs `reasoning_effort: "none"` for tools on Chat Completions.
3. Move the `1.5` image alias to `gpt-image-2.5-flare` or `gpt-image-2.5-sunburst` before 2026-12-01, and evaluate 2.5 as the default; widen `size` and quality types to cover custom sizes and `xhigh`/`max`.
4. Fix the stale price comments in `OpenAIImageProvider.ts` (GPT Image 1.5 high is $0.133 at 1024x1024, GPT Image 2 high is $0.211, not "~$0.04 vs ~$0.08").
5. Plan the TTS exit before 2027-01-06: no documented model will serve `/audio/speech`, so either port to the Realtime API with `gpt-realtime-2.1-mini` or drop OpenAI TTS in favor of Kokoro/ElevenLabs. Meanwhile, reject `ballad`, `verse`, `marin`, `cedar` when the model is `tts-1`/`tts-1-hd`.
6. Plan a word-timing source before 2027-02-26, since `whisper-1` is the only documented word-timestamp model; check `gpt-transcribe` live for `verbose_json` support before assuming either way.
7. Switch storyboard and narration from `json_object` to `json_schema` with `strict: true` to drop the wrapper prompt hack.
8. Guard `OpenAIAdapter.setModel()` against GPT-6 models on Chat Completions with tools, or move the adapter to the Responses API.

## Sources

All opened 2026-10-04.

- https://developers.openai.com/api/docs/models (and `.md`)
- https://developers.openai.com/api/docs/deprecations (and `.md`)
- https://developers.openai.com/api/docs/pricing (and `.md`)
- https://developers.openai.com/api/docs/models/gpt-6-astra, gpt-6-sol, gpt-6-luna, gpt-6.1-sol, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5-mini, gpt-5.4, gpt-5.4-mini
- https://developers.openai.com/api/docs/models/gpt-image-2, gpt-image-2.5-flare, gpt-image-2.5-sunburst, gpt-image-1.5
- https://developers.openai.com/api/docs/models/gpt-4o-mini-tts, gpt-realtime-2.1-mini, gpt-transcribe, gpt-4o-transcribe, whisper-1, gpt-live-transcribe
- https://developers.openai.com/api/docs/guides/latest-model
- https://developers.openai.com/api/docs/guides/reasoning
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/guides/image-generation
- https://developers.openai.com/api/docs/guides/text-to-speech
- https://developers.openai.com/api/docs/guides/speech-to-text
- https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- https://developers.openai.com/api/reference/resources/images/methods/edit
- https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create
- Live probe from this repo's key: `GET /v1/models` and `POST /v1/chat/completions` on `gpt-5-mini` with `max_tokens`, `temperature`, and `json_object`.
