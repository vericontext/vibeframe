---
provider: google
checked: 2026-10-04
env: [GOOGLE_API_KEY]
models_endpoint: gemini
models_in_use:
  - gemini-3.8-flash            # text default: agent, analysis, review, storyboard, motion `gemini`
  - gemini-3.1-pro-preview      # `pro` alias, motion `gemini-3.1-pro`
  - gemini-3.5-flash            # `flash-3.5` alias
  - gemini-2.5-flash            # `flash-2.5` alias; restricted for new projects since 2026-09-18
  - gemini-2.5-pro              # `pro-2.5` alias, motion `gemini-2.5-pro`
  - gemini-3-flash-preview      # `flash-3` alias
  - gemini-3.1-flash-image      # image default (`flash`, `latest`, `3.1-flash`)
  - gemini-3.1-flash-lite-image # image `lite`
  - gemini-3-pro-image          # image `pro`
  - gemini-2.5-flash-image      # explicit pass-through only; past its 2026-10-02 shutdown date
  - gemini-3.1-flash-image-preview  # explicit pass-through only; past its 2026-06-25 shutdown date
  - gemini-3-pro-image-preview  # explicit pass-through only; past its 2026-06-25 shutdown date
  - gemini-omni-1.1-flash       # Google video default (`-p omni`, auto-resolved)
  - veo-3.1-fast-generate-preview  # explicit `-p veo` only; shuts down 2026-10-22
  - veo-3.1-generate-preview    # explicit `-p veo --veo-model 3.1`; shuts down 2026-10-22
models_recommended: []
---

# Google (Gemini API)

VibeFrame uses one `GOOGLE_API_KEY` on the Gemini Developer API for text and vision (storyboards, motion code, video review), Nano Banana image generation and editing, Veo 3.1 video generation and extension, and experimental Gemini Omni video.
We do not call Lyria, Gemini TTS, or Gemini Transcribe yet; they are listed below because they share the key and are the obvious next integrations.

## Models

Status is as of 2026-10-04.
Prices are paid tier, Standard, USD.

### Text and vision

| ID | Status | Price in / out per 1M | Notes |
|---|---|---|---|
| `gemini-3.8-flash` | GA 2026-09-02 (docs) | $0.75 / $3.75 intro until 2026-12-31, then $1.50 / $7.50 (docs) | Default thinking `medium`; levels `low` `medium` `high`; `minimal` returns an error (docs). Agentic video supported (docs). |
| `gemini-3.7-flash` | GA 2026-08-13 (docs) | same intro pricing as 3.8 (docs) | Same thinking levels as 3.8, `minimal` errors (docs). Agentic video supported (docs). |
| `gemini-3.6-flash` | GA 2026-07-21 (docs) | same intro pricing as 3.8 (docs) | Levels `minimal` to `high`, default `medium` (docs). Named replacement for `gemini-3-flash-preview` (docs). |
| `gemini-3.5-flash` | GA 2026-05-19, our default (docs) | $1.50 / $9.00 (docs) | Now the most expensive Flash; pricing page calls it "earlier" (docs). No agentic video (docs). Backs `gemini-flash-latest` since 2026-05-19 (docs). |
| `gemini-3.5-flash-lite` | GA 2026-07-21 (docs) | $0.30 / $2.50 (docs) | Default thinking `minimal` (docs). Agentic video supported (docs). |
| `gemini-3.1-flash-lite` | GA, shutdown 2027-05-07 (docs) | $0.25 / $1.50 (docs) | Replace with 3.5 Flash-Lite (docs). |
| `gemini-3.1-pro-preview` | preview, no shutdown date (docs) | $2.00 / $12.00 up to 200k prompt (docs) | Levels `low` `medium` `high`, default `high`; no free API tier (docs). |
| `gemini-3-flash-preview` | preview, no shutdown date, replacement 3.6 Flash (docs) | $0.50 / $3.00 (docs) | Pricing page labels it "legacy" (docs). |
| `gemini-3-pro-preview` | shut down 2026-03-09, now points to 3.1 Pro preview (docs) | - | `GET /models/gemini-3-pro-preview` still returns 200 (probe). |
| `gemini-2.5-flash`, `gemini-2.5-pro` | not deprecated, access limited since 2026-09-18 (docs) | 2.5 Flash $0.30 / $2.50; 2.5 Pro $1.25 / $10.00 (docs) | Only projects that used 2.5 before keep access; new projects are told to use 3.5 Flash-Lite or 3.8 Flash (docs). Still listed (probe). |

All 3.x text models: 1,048,576 input and 65,536 output tokens (docs).

### Image (Nano Banana)

| ID | Status | Price | Notes |
|---|---|---|---|
| `gemini-3.1-flash-image` (Nano Banana 2) | GA 2026-05-28 (docs) | $0.045 at 512px, $0.067 1K, $0.101 2K, $0.151 4K (docs) | Sizes `512px` `1K` `2K` `4K`; 14 aspect ratios including `1:4` `4:1` `1:8` `8:1`; thinking `minimal` (default) or `high`; Image Search grounding; accepts video input (docs). |
| `gemini-3.1-flash-lite-image` (Nano Banana 2 Lite) | GA 2026-06-30 (docs) | $0.0336 per 1K image (docs) | 1K only, 2K/4K unsupported; no Search grounding; thinking `minimal` or `high` (docs). |
| `gemini-3-pro-image` (Nano Banana Pro) | GA 2026-05-28 (docs) | $0.134 per 1K/2K, $0.24 per 4K (docs) | 10 aspect ratios, sizes `1K` `2K` `4K`; thinking always on; Search grounding; up to 14 reference images (docs). |
| `gemini-2.5-flash-image` (Nano Banana) | deprecated, shutdown 2026-10-02 (docs) | $0.039 per image (docs) | 1024px class only, 10 aspect ratios, best with 3 or fewer input images (docs). Our default `flash`. Still listed on 2026-10-04 (probe). |
| `gemini-3.1-flash-image-preview` | shutdown 2026-06-25 (docs) | - | Still listed and GET returns 200 (probe). Not called. |
| `gemini-3-pro-image-preview` | shutdown 2026-06-25 (docs) | - | Still listed (probe). Not called. |
| `imagen-4.0-*` | shut down 2026-08-17 (docs) | - | GET returns 404 (probe). |

Conflict: the deprecations page says the two image previews and `gemini-2.5-flash-image` are past shutdown, but `/v1beta/models` still lists all three (probe).
Treat listing as "not yet removed", not as "supported"; generation was not tested.
Image sizes must use an uppercase `K`; lowercase such as `1k` is rejected (docs).

### Video generation

| ID | Status | Price | Notes |
|---|---|---|---|
| `gemini-omni-1.1-flash` | GA 2026-08-27, no shutdown date (docs) | $1.50 in, $17.50 per 1M video out, about $0.10/s at 720p (docs) | Interactions API only. 3-10 s clips, 24 fps, `360p` `720p` (default) `1080p` `4k`; 1080p and 4K are upscaled (docs). Paid tier only (docs). |
| `gemini-omni-flash-preview` | changelog says deprecated 2026-09-30 (docs) | same as GA (docs) | Not in the deprecations table, still listed (probe). Our `-p omni` uses it. |
| `veo-3.1-generate-preview` | preview, shutdown 2026-10-22, replacement Omni 1.1 Flash (docs) | $0.40/s 720p and 1080p, $0.60/s 4K (docs) | `predictLongRunning`. |
| `veo-3.1-fast-generate-preview` | preview, shutdown 2026-10-22 (docs) | $0.10/s 720p, $0.12/s 1080p, $0.30/s 4K (docs) | Our default Veo model. |
| `veo-3.1-lite-generate-preview` | preview, shutdown 2026-10-22 (docs) | $0.05/s 720p, $0.08/s 1080p, no 4K (docs) | No extension, no reference images (docs). |
| `veo-3.0-*`, `veo-2.0-*` | shut down (previews 2025-11-12, GA 2026-06-30) (docs) | - | `veo-3.0-generate-preview` returns 404 (probe). |

Veo 3.1: durations `4` `6` `8`, but `8` is required with extension, reference images, 1080p, or 4K (docs).
Aspect ratios are `16:9` and `9:16` only (docs).
`personGeneration` is `allow_all` only for text-to-video and extension, and `allow_adult` only for image-to-video, interpolation, and reference images; EU, UK, CH, and MENA allow only `allow_adult` (docs).
Extension: Veo 3.1 and Fast only, 720p input, adds 7 s per call, up to 20 times, output up to 148 s (docs).
Generated videos are kept on the server for 2 days (docs).
Latency is 11 s to 6 min (docs).

Omni editing and extension: multi-turn edits chain with `previous_interaction_id` (docs).
Extension appends 3-10 s per turn, up to 40 s total, using the last 10 s as context (docs).
Uploaded videos for edit or extend must be 10 s or less; uploaded-video edit and extend are blocked in the EEA, CH, and UK (docs).
`video_config.task` values are `text_to_video`, `image_to_video` (1 or 2 images for first and last frame), `reference_to_video`, `edit`, `extend`; docs advise prompting first because `task` adds constraints (docs).
Likeness policy: uploading or editing images of certain recognizable people is not supported, and images of minors cannot be uploaded or edited in the EEA, CH, and UK (docs).
Video references: at most 3 clips of 3 s each, their audio is ignored, and audio references are unsupported (docs).
System instructions, `temperature`, `top_p`, stop sequences, and negative prompts are not supported on Omni (docs).

### Video understanding

| Mode | Models | Tokens | Notes |
|---|---|---|---|
| Static (default) | all Gemini models (docs) | about 100 tokens/s at low media resolution, about 300/s otherwise; frames 66 or 258 tokens, audio 32 tokens/s (docs) | 1 fps sampling. 1M-context models take about 3 h of video at low resolution or 1 h at high (docs). |
| Agentic (`processing: "agentic"`) | 3.8 Flash, 3.7 Flash, 3.6 Flash, 3.5 Flash-Lite (docs) | up to 88% fewer tokens on long video, billed as thought and tool-use tokens (docs) | Not on 3.5 Flash, our default (docs). Use streaming or `background` for long runs (docs). |

Input limits: inline data under 100 MB per the guide's table, but the same page says to switch to the File API above 20 MB total request size (docs).
File API: 2 GB per file, 20 GB per project, files deleted after 48 h (docs); the video guide's table says 20 GB paid / 2 GB free instead (docs).
Public YouTube URLs work, with an 8 h/day cap on the free tier (docs).

### Music, speech, transcription

| ID | Status | Price | Notes |
|---|---|---|---|
| `lyria-3.5` | GA 2026-09-03 (docs) | $0.08 per song (docs) | Full songs, 44.1 kHz stereo MP3 (WAV via `response_format`), text and image input, Interactions API (docs). |
| `lyria-3-clip-preview` | preview, no shutdown date (docs) | $0.04 per 30 s clip (docs) | `lyria-3-pro-preview` is replaced by `lyria-3.5` (docs). |
| `gemini-3.8-flash-tts` | GA 2026-09-22 (docs) | $0.50 in / $9.00 audio out per 1M intro, about $0.00225 per 10 s (docs) | WAV output by default; voices via `speech_config`, Voices endpoint `/v1beta/voices` (docs). Flash-Lite TTS replaces `gemini-3.1-flash-tts-preview` (docs). |
| `gemini-3.5-transcribe` | GA 2026-08-26 (docs) | about $0.005/min blended (docs) | Up to 1 h per request, 30 min with diarization or word timestamps; 85+ languages (docs). |

## API shape

- Base URL `https://generativelanguage.googleapis.com/v1beta`, auth header `x-goog-api-key` (docs); `?key=` also works (probe).
- Three request shapes share the key:
  - `POST /models/{id}:generateContent` for text, vision, and Nano Banana (docs). Google now calls this API legacy and recommends the Interactions API for new work (docs).
  - `POST /models/{veo-id}:predictLongRunning` with `instances[]` and `parameters`, then poll `GET /v1beta/{operation.name}` until `done: true` (docs).
  - `POST /v1beta/interactions` with `model`, `input`, `generation_config`, `response_format`, and optional `previous_interaction_id`, `store`, `background`, `stream` (docs). Omni, Lyria, TTS, and Transcribe document only this endpoint (docs).
- Thinking on 3.x: `thinking_level` string enum; sending both `thinking_level` and legacy `thinking_budget` returns 400 (docs).
- `temperature`, `top_p`, `top_k` were marked deprecated on 2026-07-21 and the migration guides say to remove them (docs). The docs do not say whether they are rejected or ignored on text models; `GET /models/{id}` still reports `temperature: 1` defaults for 3.x (probe). Values below 1.0 can cause looping on 3.x (docs).
- `candidate_count` is not supported on 3.x (docs).
- Response fields we read:
  - generateContent: `candidates[0].content.parts[].text` and `.inlineData`, `parts[].thought`, `candidates[0].finishReason`, `promptFeedback.blockReason`, `usageMetadata.{promptTokenCount,candidatesTokenCount,totalTokenCount}` (code).
  - Veo operation: `name`, `done`, `error`, `response.generateVideoResponse.generatedSamples[0].video.uri` (docs).
  - Interactions REST: output lives in `steps[]` where `type: "model_output"` holds `content[]` items with `type`, `mime_type`, and either base64 `data` or `uri`; `output_video` and `output_text` are SDK-only conveniences (docs). Top level has `id` and `status` (docs).
- Errors are `{"error": {"code", "message", "status"}}`, for example 404 `NOT_FOUND` for a removed model (probe).

## Gotchas

- `gemini-2.5-flash-image`, our default image model, passed its announced 2026-10-02 shutdown; the two image previews passed 2026-06-25; all still appear in `/models` (docs, probe). Expect them to vanish without further notice.
- All Veo 3.1 IDs shut down 2026-10-22, and Google points to `gemini-omni-1.1-flash`, which uses a different endpoint and request shape (docs).
- New projects cannot use Gemini 2.5 models since 2026-09-18 (docs). The exact error a new key gets was not observed.
- `minimal` thinking errors on 3.8 Flash, 3.7 Flash, and 3.1 Pro preview but is the default on 3.5 Flash-Lite and the image models (docs).
- Omni returns the video as base64 `data` inside `steps[]` by default; a URL comes back only with `response_format.delivery: "uri"`, and only in the create response or SSE stream, not on later `GET /interactions/{id}` (docs). Use `uri` above 4 MB (docs).
- Omni requests are synchronous unless `background: true`; `store: false` disables `previous_interaction_id` editing (docs). Interactions are retained 55 days on paid tier, 1 day on free (docs).
- Veo extension takes a video object from a previous generation (`instances[].video` as `uri` or `inlineData`), must be 720p, and requires `durationSeconds: 8` (docs).
- Veo REST examples wrap reference images as `{ image: { inlineData }, referenceType: "asset" }` and frames as `{ inlineData }` (docs). `gcsUri` is not documented for the Gemini API.
- Gemini 3.x function calling over generateContent needs thought signatures round-tripped and `FunctionResponse` `id` plus `name` matching the call; mismatches return empty responses with `STOP` rather than an error (docs).
- The JS SDK `@google/generative-ai` has been legacy and unmaintained since 2025-11-30; use `@google/genai` (docs).
- Model metadata `GET` succeeding (for example `gemini-3-pro-preview`, `gemini-3.1-flash-image-preview`) does not prove generation still works (probe).
- Omni model card lists a 1,048,576-token context, but `/models` reports `inputTokenLimit: 131072` for both Omni IDs (docs, probe).

## In our code

- `packages/ai-providers/src/gemini/gemini-models.ts:9-20` - text defaults: `gemini-3.5-flash` default, `gemini-2.5-flash` agent default, aliases `flash-3` -> `gemini-3-flash-preview`, `pro` -> `gemini-2.5-pro`, `pro-3.1` -> `gemini-3.1-pro-preview`.
- `packages/ai-providers/src/gemini/gemini-motion.ts:55-66` - motion alias table; `:289` and `:408` call generateContent with `temperature` 0.8 and 0.5.
- `packages/ai-providers/src/gemini/gemini-storyboard.ts:35-52` - storyboard call with `temperature` 0.7 or 1.0.
- `packages/ai-providers/src/gemini/GeminiProvider.ts`:
  - `:26`, `:189-197` - image model map; `flash` (default) -> `gemini-2.5-flash-image`, `3.1-flash`/`latest` -> `gemini-3.1-flash-image-preview`, `pro` -> `gemini-3-pro-image-preview`.
  - `:86-108` - Veo aliases `3.1` and `3.1-fast`.
  - `:230-376` - `generateVideo` (Veo, default `veo-3.1-fast-generate-preview` at `:247`), image as `bytesBase64Encoded` or `gcsUri`, flat `referenceImages`.
  - `:383-500` - operation polling every 5 s, 5 min cap.
  - `:507-573` - `extendVideo` sends `video: { previousOperationName }` with 4-8 s duration, default model `veo-3.1-generate-preview`.
  - `:599-750` - `generateImage`; 2K/4K only sent for Pro, Image Search only for the preview ID (`:647`), `thinkingLevel: "High"` type at `:46`.
  - `:756-910` - `editImage`.
  - `:914-1058` - `analyzeVideo`, inline base64 video, `temperature: 0.4`.
  - `:1060-1168` - `analyzeImage`, `temperature: 0.4`.
  - `:1170-1270` - `autoEdit`, `temperature: 0.3`.
- `packages/ai-providers/src/gemini/gemini-omni.ts:24-131` - Omni client on `/v1beta/interactions` with `gemini-omni-flash-preview`, body `inputs` + `generation_config.video_config.{task,aspect_ratio}`, looks for an http URL in the response.
- `packages/cli/src/agent/adapters/gemini.ts:5`, `:18`, `:58-115` - agent loop on legacy `@google/generative-ai` with `gemini-2.5-flash`; rebuilds history without thought signatures or call ids.
- `packages/cli/src/commands/ai-video.ts:268-306` (Veo generate, duration snapped to 6 or 8), `:344-368` (Omni), `:567-579` (Veo status), `:720-740` (Veo extend).
- `packages/cli/src/commands/generate/video.ts:88`, `:247-248`, `:473-551` (Veo), `:688-700` (Omni).
- `packages/cli/src/commands/generate/video-extend.ts:41`, `:174-238` - Veo extend by operation name.
- `packages/cli/src/commands/_shared/video-providers.ts:188-194` - storyboard clips hardcode `veo-3.1-fast-generate-preview`.
- `packages/cli/src/commands/generate/image.ts:301-345` and `packages/cli/src/commands/ai-image.ts:108-121` - image generation with fallback from `latest`/`3.1-flash` to `flash`.
- `packages/cli/src/commands/edit-cmd.ts:699`, `:777-800` - image edit model names and the same fallback.
- `packages/cli/src/commands/ai-motion.ts:63-71` - `gemini-2.5-pro` and `gemini-3.1-pro` -> `gemini-3.1-pro-preview`.
- Video review and analysis via `analyzeVideo`: `packages/cli/src/commands/ai-review.ts:125-228`, `packages/cli/src/commands/ai-analyze.ts:94-262`, `packages/cli/src/commands/ai-highlights.ts:209`, `:501`, `:799`, `:1150`, `packages/cli/src/commands/inspect.ts:359`, `packages/cli/src/commands/_shared/render-inspect.ts:715`, `:910`.
- `packages/cli/src/tools/manifest/generate.ts:60`, `packages/cli/src/tools/manifest/edit.ts:234`, `packages/cli/src/pipeline/executor.ts:290` - `gemini-2.5-pro` / `gemini-3.1-pro` alias enums.

## Recommended changes

1. Move image aliases to GA IDs before the listed-but-retired ones disappear: `flash` -> `gemini-3.1-flash-image` (or `gemini-3.1-flash-lite-image` for cheap 1K), `pro` -> `gemini-3-pro-image`; reverse the fallback so it never lands on `gemini-2.5-flash-image`, and key Image Search and 2K/4K/512px handling on the GA IDs.
2. Plan the Veo exit before 2026-10-22: make `gemini-omni-1.1-flash` the Google video path and keep Veo only behind an explicit flag until then.
3. Rewrite `gemini-omni.ts` to the documented shape: `input` (typed `image`/`text` items), `response_format: { type: "video", aspect_ratio, resolution, delivery: "uri" }`, read `steps[].content[]` (decode `data` or download `uri`), use `background: true` plus polling, and expose `previous_interaction_id` for edit and 40 s extension.
4. Fix Veo request details while Veo remains: extension must pass the prior video object at 720p with `durationSeconds: 8`; force 8 s for 1080p, 4K, and reference images; allow 4 s; wrap reference images with `referenceType`; validate `personGeneration` per mode; drop `gcsUri` for http URLs.
5. Drop `temperature` from all 3.x text calls and move the default text model off `gemini-3.5-flash` to `gemini-3.7-flash` (cheaper and agentic-video capable) or `gemini-3.8-flash`; replace `pro` -> `gemini-2.5-pro` with `gemini-3.1-pro-preview`.
6. Move the agent adapter to `@google/genai` and a 3.x default model, preserving thought signatures and function call ids (or use Interactions with `previous_interaction_id`).
7. Upload videos above 20 MB through the File API in `analyzeVideo`, and try `processing: "agentic"` for long-form review.
8. Send the key in `x-goog-api-key` instead of `?key=` so it does not land in error strings or logs, and fix the stale Veo Fast price comment ($0.10/s, not $0.15/s).

## Sources

All opened 2026-10-04.

- https://ai.google.dev/gemini-api/docs/deprecations
- https://ai.google.dev/gemini-api/docs/changelog
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/docs/models
- https://ai.google.dev/gemini-api/docs/latest-model
- https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.5
- https://ai.google.dev/gemini-api/docs/gemini-3
- https://ai.google.dev/gemini-api/docs/thinking
- https://ai.google.dev/gemini-api/docs/interactions
- https://ai.google.dev/gemini-api/docs/omni
- https://ai.google.dev/gemini-api/docs/video
- https://ai.google.dev/gemini-api/docs/veo
- https://ai.google.dev/gemini-api/docs/image-generation
- https://ai.google.dev/gemini-api/docs/video-understanding
- https://ai.google.dev/gemini-api/docs/files
- https://ai.google.dev/gemini-api/docs/music-generation
- https://ai.google.dev/gemini-api/docs/speech-generation
- https://ai.google.dev/gemini-api/docs/transcribe
- https://ai.google.dev/gemini-api/docs/libraries
- Model cards under https://ai.google.dev/gemini-api/docs/models/ for `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-pro-preview`, `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-3.1-flash-image`, `gemini-3-pro-image`, `gemini-3.1-flash-lite-image`, `gemini-2.5-flash-image`, `gemini-omni-flash`, `lyria-3.5`, `gemini-3.8-flash-tts`, `gemini-3.5-transcribe`
- Probe: `GET /v1beta/models` listing and `GET /v1beta/models/{id}` for `veo-3.0-generate-preview`, `imagen-4.0-generate-001`, `gemini-omni-flash-preview`, `gemini-3-pro-preview`, `gemini-3-flash-preview`, `gemini-3.1-flash-image-preview`, `gemini-3.8-flash` (free metadata calls only, no generation)

