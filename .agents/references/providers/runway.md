---
provider: runway
checked: 2026-10-04
env: [RUNWAY_API_SECRET]
models_endpoint: none
models_in_use:
  - gen4.5
  - gen4_turbo
  - gemini_2.5_flash   # only in a spinner label for the missing Runway image script
---

# Runway

VibeFrame uses the Runway API for video generation (`-p runway`), defaulting to Gen-4.5 for text-to-video and image-to-video.
`vibe build` also falls back to Runway automatically when Seedance rejects a face-visible keyframe.

## Models

1 credit = $0.01 (docs).
Credit rates are per second of output unless noted (docs).

| ID | Kind | Status | Price | Notes |
|---|---|---|---|---|
| `gen4.5` | video (T2V, I2V) | GA | 12 cr/s | 2-10s integer; T2V ratios `1280:720`, `720:1280` only; I2V adds `1104:832`, `960:960`, `832:1104`, `1584:672`; HDR / ProRes `outputFormat` with surcharge (docs) |
| `gen4_turbo` | video (I2V only) | GA | 5 cr/s | `promptImage` required; duration 2-10 (docs) |
| `aleph2` | video-to-video | GA | 28 cr/s, 56 cr minimum | `videoUri` up to 30s, up to 5 timed `keyframes`, `targetAspectRatio` outpaint (docs) |
| `act_two` | character performance | GA | 5 cr/s | `POST /v1/character_performance`; character image or video must show a visible face; reference video 3-30s (docs) |
| `seedance2_5` | video (T2V, I2V, V2V) | GA | 20 / 30 / 68 cr/s at 480p / 720p / 1080p, plus 10 / 15 / 34 cr/s of input video; 80 cr minimum | 4-30s; V2V `mode: reference` or `extend` (docs) |
| `seedance2` | video | GA | 36 cr/s (480p/720p), 40 (1080p), 150 (4K) | 4-15s, 24 ratios, `audio`, references (docs) |
| `seedance2_fast` / `seedance2_mini` | video | GA | 29 cr/s / 16 cr/s (64 cr minimum) | 480p / 720p (docs) |
| `veo3.1` / `veo3.1_fast` | video | GA | 40 / 15 cr/s with audio, 20 / 10 without | Optional `negativePrompt` (docs) |
| `gemini_omni_flash` / `gemini_omni_flash_1.1` | video | GA | 10 cr/s (+1 per image) / 3.4-30 cr/s by resolution | Omni Flash: 3-10s at 720p, V2V input up to 10s (docs) |
| `grok_imagine_1_5` | video | GA | 10 / 16 / 29 cr/s at 480p / 720p / 1080p, +1 cr per reference | 1-15s; references cap output at 720p (docs) |
| `wan3` / `wan3_prime` | video | GA | 5 / 10 / 20 cr/s; prime 6.8 / 14 / 28 | Up to 30s with native audio (docs) |
| `hailuo3` / `h3_max` | video | GA | 10 / 15 cr/s (768P / 2K) + refs; h3_max 5 / 8 cr/s | 5-15s (docs) |
| `happyhorse_1_0` | video | GA | 15 / 30 cr/s (720p / 1080p) | (docs) |
| `gen3a_turbo`, `gen4_aleph` | video | sunset 2026-07-30 | - | Requests fail; use `gen4.5` / `gen4_turbo` and `aleph2` (docs) |
| `gemini_2.5_flash` | image | GA | 5 cr / image | Also `gen4_image`, `gen4_image_turbo`, `gpt_image_2`, `seedream5_*`, `grok_imagine_image_2` on `/v1/text_to_image` (docs) |

## API shape

- Base URL `https://api.dev.runwayml.com/v1`; auth `Authorization: Bearer <secret>`; `X-Runway-Version: 2024-11-06` is required on every request (docs).
- A request without `X-Runway-Version` returns HTTP 400 (probe, `GET /v1/organization`).
- Official SDKs read `RUNWAYML_API_SECRET`; our env var is `RUNWAY_API_SECRET` (docs).
- Generation endpoints: `/text_to_video`, `/image_to_video`, `/video_to_video`, `/text_to_image`, `/character_performance`, plus audio and upscale endpoints (docs).
- Each body is a discriminated union on `model`; valid `ratio`, `duration`, prompt length, and optional fields differ per model (docs).
- Common fields: `promptText` (1000 chars for gen4.5), `promptImage` (string or `[{ uri, position }]`), `ratio` as pixel `W:H`, `duration`, `seed` (0-4294967295), `contentModeration.publicFigureThreshold` (`auto` / `low`) (docs).
- Create returns `{ id, estimatedCost: { credits } }` (docs).
- Poll `GET /v1/tasks/{id}` no faster than every 5 seconds (docs).
- Task `status`: `PENDING`, `THROTTLED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED`; `output[]` only on success; `failure` and `failureCode` on failure; `cost.credits` and `progress` (0-1) (docs).
- `DELETE /v1/tasks/{id}` cancels a pending, throttled, or running task and deletes a finished one (docs).
- HTTP errors: 400 with JSON `error`, 401, 404, 405 are not retryable; 429, 502, 503, 504 are retryable with exponential backoff plus jitter (docs).
- `GET /v1/organization` (free) returns `creditBalance`, `usage`, and `tier.models` with per-model `maxConcurrentGenerations` and `maxDailyGenerations` (probe).
- Model Router: save a config in the portal, then `POST /v1/generate/video` (or `/image`, `/audio`) with `configId` and `input`; it picks a model by cost, latency, or quality under optional credit ceilings, supports `dryRun`, reports the model and credits used, and bills at that model's rate (docs).
- Router requests use `aspectRatio` like `16:9`; direct-model requests use pixel `ratio` like `1280:720`; they are not interchangeable (docs).

## Gotchas

- `THROTTLED` is not an error; the task is queued behind the rate limit and continues on its own (docs).
- Our key's tier allows 1 concurrent generation and 50 per day per model (probe), so parallel beats will see `THROTTLED`.
- Moderation shows up as a `FAILED` task, not an HTTP error (docs).
- `SAFETY.INPUT.*` failures are not refunded and must not be retried; moderated generations cost the same as successful ones; repeated moderation can suspend the account (docs).
- `INTERNAL.BAD_OUTPUT.01` often comes from logos, watermarks, or overlaid text in inputs and may succeed after fixing them (docs).
- `ASSET.INVALID` means bad input media; `THIRD_PARTY.UNAVAILABLE` means wait before retrying a resold model; `INTERNAL` and `INPUT_PREPROCESSING.INTERNAL` can be retried with a delay (docs).
- `publicFigureThreshold: low` loosens only the public-figure check (docs).
- Gen-4.5 text-to-video rejects `960:960`; square output is image-to-video only (docs).
- Inputs are auto-cropped to the target ratio, which can silently change composition (docs).
- Input URLs must be HTTPS, return `Content-Type` and `Content-Length`, and not redirect (docs).
- Size limits: images 16 MB by URL, 5 MB as data URI (encoded, about 3.3 MB binary), 200 MB via `POST /v1/uploads` ephemeral upload; video and audio 32 MB / 16 MB / 200 MB (docs).
- Output URLs expire within 24-48 hours; download promptly (docs).
- The organization tier list still includes sunset `gen3a_turbo`, `gen4_aleph`, plus `veo3` and `grok_imagine_1_5_lite`, so it is not a source of truth for availability (probe).
- Do not reuse `ratio` or `duration` across models (docs).
- Whether Runway's resold `seedance2*` applies ByteDance's likeness filter is unknown (unverified).

## In our code

- `packages/ai-providers/src/runway/RunwayProvider.ts:14-17` - `gen4_turbo | gen4.5`, default `gen4.5`.
- `packages/ai-providers/src/runway/RunwayProvider.ts:69-72` - API version `2024-11-06` and base URL.
- `packages/ai-providers/src/runway/RunwayProvider.ts:104-109` - ratio map; `1:1` becomes `960:960` even for text-to-video.
- `packages/ai-providers/src/runway/RunwayProvider.ts:114-139` - gen4_turbo image guard and request body.
- `packages/ai-providers/src/runway/RunwayProvider.ts:241-262` - status map turns `THROTTLED` into `failed`.
- `packages/ai-providers/src/runway/RunwayProvider.ts:277-295` - `cancelGeneration` calls `POST /tasks/{id}/cancel`, which is not in the API reference.
- `packages/ai-providers/src/runway/RunwayProvider.ts:300-318` - `deleteTask` uses `DELETE /tasks/{id}`, the documented cancel.
- `packages/ai-providers/src/runway/RunwayProvider.ts:354-368` - retries only 429 and 503, without jitter.
- `packages/ai-providers/src/runway/RunwayProvider.ts:373-381` - gen4_turbo duration forced to 5 or 10.
- `packages/cli/src/commands/ai-video.ts:181-215` - MCP/agent Runway path; does not forward `runwayModel`.
- `packages/cli/src/commands/ai-video.ts:507` - Runway status polling; `:627-633` cancel.
- `packages/cli/src/commands/generate/video.ts:89-93`, `:315-345` - `--runway-model` option, guard, and call.
- `packages/cli/src/commands/generate/video-cancel.ts:57-66` - Runway cancel command.
- `packages/cli/src/commands/generate/image.ts:530-551` - Runway image spawns `.claude/skills/runway-video/scripts/image.py`, which does not exist in the repo.
- `packages/cli/src/utils/key-live-test.ts:122-130` - key check via `GET /v1/organization`.
- `packages/cli/src/commands/_shared/scene-build.ts:2334-2360` - likeness fallback from Seedance to Runway (default `gen4.5`).

## Recommended changes

1. Map `THROTTLED` to a pending state and keep polling; today any throttled build beat is reported as failed.
2. Make `cancelGeneration` use `DELETE /v1/tasks/{id}` and drop the undocumented `POST .../cancel`.
3. Reject or remap `1:1` for gen4.5 text-to-video instead of sending `960:960`.
4. Branch on `failureCode`: never retry `SAFETY.INPUT.*`, retry `INTERNAL*` and `THIRD_PARTY.UNAVAILABLE` with delay, and surface the code in JSON reports.
5. Forward `runwayModel` in `executeVideoGenerate`, and allow gen4_turbo durations 2-10.
6. Retry 502 and 504 too, with jitter.
7. Remove or restore the Runway image path; the Python script it spawns is missing.
8. Record `estimatedCost.credits` and `cost.credits` from the task for real cost reporting.
9. Consider a Model Router `configId` option for users who do not want to pin a model.

## Sources

- Live probe, 2026-10-04: `GET https://api.dev.runwayml.com/v1/organization` with and without `X-Runway-Version`.
- https://docs.dev.runwayml.com/guides/pricing/ (saved HTML, 2026-10-04)
- https://docs.dev.runwayml.com/api-details/api_changelog/ (saved HTML, 2026-10-04)
- https://docs.dev.runwayml.com/llms.txt (2026-10-04)
- https://docs.dev.runwayml.com/ai-context.md (2026-10-04)
- https://docs.dev.runwayml.com/api.md (2026-10-04)
- https://docs.dev.runwayml.com/guides/models.md (2026-10-04)
- https://docs.dev.runwayml.com/api-details/moderation.md (2026-10-04)
- https://docs.dev.runwayml.com/errors/task-failures.md (2026-10-04)
- https://docs.dev.runwayml.com/errors/errors.md (2026-10-04)
- https://docs.dev.runwayml.com/api-details/versions/2024-11-06.md (2026-10-04)
- https://docs.dev.runwayml.com/assets/inputs.md (2026-10-04)
- https://docs.dev.runwayml.com/model-routers.md (2026-10-04)
