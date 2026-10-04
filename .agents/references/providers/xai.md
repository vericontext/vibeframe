---
provider: xai
checked: 2026-10-04
env: [XAI_API_KEY]
models_endpoint: xai
models_in_use:
  - grok-4.3                    # agent default
  - grok-imagine-video-1.5      # video default, 720p
  - grok-imagine-video-1.5-lite # video `--grok-model lite`
  - grok-imagine-video          # video `--grok-model classic`
  - grok-imagine-image          # image default
  - grok-imagine-image-2.0      # image `pro`, quality medium
models_recommended:
  - grok-4.7                    # quality option for the agent
---

# xAI

VibeFrame uses xAI for three things: the `vibe agent -p xai` LLM loop, Grok Imagine image generation and editing, and Grok Imagine video (text-to-video and image-to-video).
Grok video is the fallback default video provider when `FAL_API_KEY` is not set.

## Models

Prices are per 1M tokens (input / cached input / output) below the 200k-prompt long-context threshold; above it every rate doubles (probe, docs).

| ID | Kind | Status | Price | Notes |
|---|---|---|---|---|
| `grok-4.7` | LLM | GA | $2.00 / $0.50 / $6.00 | 500k context; `reasoning_effort` low / medium / high (default) / xhigh; recommended model (docs, probe) |
| `grok-4.6` | LLM | GA | $2.00 / $0.50 / $6.00 | 500k context; same effort levels as 4.7 (probe) |
| `grok-4.5` | LLM | GA | $2.00 / $0.30 / $6.00 | 500k context; efforts low..high, `xhigh` treated as `high`; alias `grok-build-latest` points here (probe, docs) |
| `grok-4.3` | LLM | GA | $1.25 / $0.20 / $2.50 | 1M context; efforts none..xhigh, default `low` (probe, docs) |
| `grok-4.20-0309-reasoning` / `-non-reasoning` / `grok-4.20-multi-agent-0309` | LLM | GA | $1.25 / $0.20 / $2.50 | 1M context; many `grok-4.20-*` aliases (probe) |
| `grok-build-0.1` | LLM (code) | GA | $1.00 / $0.20 / $2.00 | 256k context; aliases include `grok-code-fast-1` (probe) |
| `grok-4-1-fast-reasoning` | LLM | retired 2026-05-15 | billed as grok-4.3 | Still resolves; `GET /v1/models/grok-4-1-fast-reasoning` returns `id: grok-4.3` (probe); served at `low` effort (docs) |
| `grok-imagine-image-2.0` | image | GA | $0.04-$0.08 / image | low 1k $0.04, low 1.5k $0.05, low 2k $0.06, medium 1k $0.06, 1.5k $0.07, 2k $0.08 (probe); `quality` low / medium / auto; up to 5 edit sources (docs) |
| `grok-imagine-image-quality` | image | retiring 2026-11-02 | $0.05 / image | After retirement, served by `grok-imagine-image-2.0` at `quality: low` (docs) |
| `grok-imagine-image-pro` | image | retired 2026-05-15 | as `-quality` | Listed only as an alias of `grok-imagine-image-quality` (probe); follows it to 2.0 low on 2026-11-02 (docs) |
| `grok-imagine-image` | image | GA | $0.02 / image | Not affected by the Nov 2 retirement (docs, probe) |
| `grok-imagine-video-1.5` | video | GA | $0.08 / s | Inputs text, image, audio (probe); native 1080p for T2V and I2V, reference-to-video capped at 720p, `last_frame`, `keyframes`, preset voices (docs) |
| `grok-imagine-video-1.5-lite` | video | GA | $0.02 / s | Inputs text, image only (probe); capability limits not documented beyond the model page |
| `grok-imagine-video` | video | GA | $0.05 / s | Inputs text, image, video (probe); the only model shown for `/v1/videos/edits` examples (docs) |

## API shape

- Base URL `https://api.x.ai/v1`, auth `Authorization: Bearer $XAI_API_KEY` (docs).
- LLM: OpenAI-compatible `POST /chat/completions` still works but is labelled legacy; new features land on `POST /v1/responses` first (docs).
- `GET /v1/models` lists LLM, image, and video models in one list; `/v1/image-generation-models` and `/v1/video-generation-models` add modalities and per-quality image pricing (probe).
- Listing prices are in USD ticks, where 1 USD = 10,000,000,000 ticks (docs, from `cost_in_usd_ticks`).
- So `prompt_text_token_price: 12500` is $1.25 per 1M tokens and `image_price: 200000000` is $0.02 per image (probe).
- Images: `POST /images/generations` and `POST /images/edits` with `model`, `prompt`, `n` (1-10), `aspect_ratio`, `resolution` (`1k` / `1.5k` / `2k`), `response_format` (`url` default or `b64_json`) (docs).
- Image responses carry `data[].url` or `data[].b64_json`; URLs are temporary (docs).
- Video is async: `POST /videos/generations` returns `{ request_id }`, then poll `GET /videos/{request_id}` (docs).
- Video request fields: `model`, `prompt`, `duration` (integer 1-15, default 8), `aspect_ratio` (1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3), `resolution` (480p default, 720p, 1080p), `image: { url | file_id }`, `reference_images`, `reference_audios`, `last_frame`, `keyframes`, `generate_audio` (default true) (docs).
- Poll response: `status` is `pending`, `done`, `expired`, or `failed`; `video.url`, `video.duration`, `progress` (0-100), `usage.cost_in_usd_ticks`, and on failure `error: { code, message }` (docs).
- Edit: `POST /videos/edits` with `video: { url }` (.mp4); output keeps the input duration (capped 8.7s) and is capped at 720p (docs).
- Extend: `POST /videos/extensions` with `video` and `duration` 2-10 (default 6) for the added segment only (docs).
- Images and video accept public URLs, base64 data URIs, or Files API `file_id`s (docs).

## Gotchas

- Retired LLM and image slugs do not fail; they silently redirect and bill at the target's price (probe, docs).
- `grok-4-1-fast-reasoning` is now `grok-4.3` at `low` effort; a listing check by `id` alone misses this, so compare the `id` of `GET /v1/models/{id}` (probe).
- Reasoning models reject `presencePenalty`, `frequencyPenalty`, and `stop` with an error; `logprobs` is silently ignored on `grok-4.20` and newer (docs).
- Reasoning cannot be disabled on 4.5 / 4.6 / 4.7; only `grok-4.3` accepts `none` (docs, probe).
- Video status `failed` exists alongside `expired`; a client that only knows `pending` / `done` / `expired` will poll a failed job until its timeout (docs).
- Video `resolution` defaults to 480p, so omitting it silently produces 480p output (docs).
- Audio is generated by default; pass `generate_audio: false` for silent clips (docs).
- On image-to-video, setting `aspect_ratio` stretches the input image instead of using its native ratio (docs).
- Classic `grok-imagine-video` rejects `last_frame`, `keyframes`, and `image` combined with reference inputs; those need `-1.5` (docs).
- Reference-to-video caps at 720p even on `-1.5`; 1080p is T2V and I2V only (docs).
- `-1.5` text-to-video runs text-to-image then image-to-video internally (docs).
- No cancel endpoint is documented for videos; `DELETE /videos/{id}` is not in the REST reference (docs, not probed).
- `grok-imagine-image-2.0` doc headline says $0.04 but the default (`auto`) serves `medium` for edits, which bills $0.06+ (docs, probe).
- `21:9` and `5:2` image ratios are accepted by `grok-imagine-image-2.0` (docs).
- Our code comment says float `duration` fails with a 422; docs now say numbers and strings are accepted, but send integers anyway.

## In our code

- `packages/cli/src/agent/adapters/xai.ts:18` - default LLM `grok-4-1-fast-reasoning` (retired).
- `packages/cli/src/agent/adapters/xai.ts:21-24` - OpenAI SDK pointed at `https://api.x.ai/v1`.
- `packages/cli/src/agent/adapters/xai.ts:85-90` - `chat.completions.create` with tools; no `reasoning_effort`.
- `packages/ai-providers/src/grok/GrokProvider.ts:12-19` - model type and stale price comments ($4.20/min video, $0.07 pro image).
- `packages/ai-providers/src/grok/GrokProvider.ts:112-187` - `generateImage` against `/images/generations`.
- `packages/ai-providers/src/grok/GrokProvider.ts:193-273` - `editImage` against `/images/edits` with a data URI.
- `packages/ai-providers/src/grok/GrokProvider.ts:292-305` - video body; hardcodes `grok-imagine-video`, never sends `resolution` or `generate_audio`.
- `packages/ai-providers/src/grok/GrokProvider.ts:370-374` - status map lacks `failed`.
- `packages/ai-providers/src/grok/GrokProvider.ts:425-439` - `cancelGeneration` uses an undocumented `DELETE /videos/{id}`.
- `packages/cli/src/commands/ai-image.ts:148-158` - MCP/agent Grok image path reuses `OpenAIImageProvider` with no `model`, so it sends `gpt-image-2` (`OpenAIImageProvider.ts:78`) to xAI.
- `packages/cli/src/commands/generate/image.ts:421-455` - CLI Grok image path and its aspect-ratio allowlist.
- `packages/cli/src/commands/edit-cmd.ts:771-773` - Grok image edit.
- `packages/cli/src/commands/ai-video.ts:308-345` and `:480-488` - Grok video generate and status.
- `packages/cli/src/commands/generate/video.ts:558-610` - CLI Grok video path.
- `packages/cli/src/commands/generate/video-cancel.ts:35-41` - Grok cancel.
- `packages/cli/src/utils/key-live-test.ts:82` - key check via `GET /v1/models`.
- `packages/cli/src/commands/_shared/scene-build.ts:2166` - build env mapping for `grok`.

## Recommended changes

1. Fix the Grok video status map: treat `failed` as terminal and surface `error.message`, so failed jobs stop polling.
2. Replace `grok-4-1-fast-reasoning` in the agent adapter with an explicit current model (`grok-4.3` for cost, `grok-4.7` for quality) and pass `reasoning_effort` explicitly.
3. Fix `ai-image.ts` Grok path to call `GrokProvider.generateImage` (or pass a Grok model) instead of sending `gpt-image-2` to xAI.
4. Drop `grok-imagine-image-pro` from `GrokModel`; offer `grok-imagine-image-2.0` with an explicit `quality` before the 2026-11-02 retirement.
5. Send `resolution` (at least 720p) and forward `generate_audio`, and let callers pick `grok-imagine-video-1.5` / `-1.5-lite`.
6. Update price comments and MODELS.md (video is $0.05/s, not $0.07/s); read `usage.cost_in_usd_ticks` for real cost.
7. Remove or verify `cancelGeneration`; no cancel endpoint is documented.

## Sources

- Live probe, 2026-10-04: `GET /v1/models`, `/v1/models/{grok-4-1-fast-reasoning, grok-imagine-image-pro, grok-imagine-image-quality}`, `/v1/image-generation-models`, `/v1/video-generation-models`.
- https://docs.x.ai/docs/models.md (2026-10-04)
- https://docs.x.ai/developers/pricing.md (2026-10-04)
- https://docs.x.ai/developers/release-notes.md (2026-10-04)
- https://docs.x.ai/developers/migration/may-15-retirement.md (2026-10-04)
- https://docs.x.ai/developers/migration/imagine-image-quality-nov-2.md (2026-10-04)
- https://docs.x.ai/developers/model-capabilities/text/reasoning.md (2026-10-04)
- https://docs.x.ai/developers/model-capabilities/legacy/chat-completions.md (2026-10-04)
- https://docs.x.ai/developers/model-capabilities/images/generation.md (2026-10-04)
- https://docs.x.ai/developers/rest-api-reference/inference/images.md (2026-10-04)
- https://docs.x.ai/developers/rest-api-reference/inference/videos.md (2026-10-04)
- https://docs.x.ai/developers/model-capabilities/video/generation.md, image-to-video.md, reference-to-video.md, editing.md, extension.md (2026-10-04)
- https://docs.x.ai/developers/models/grok-imagine-video-1.5.md, grok-imagine-video-1.5-lite.md, grok-imagine-video.md, grok-imagine-image-2.0.md, grok-4.3.md (2026-10-04)
