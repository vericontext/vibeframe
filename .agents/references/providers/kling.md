---
provider: kling
checked: 2026-10-04
env: [KLING_API_KEY]
models_endpoint: none
models_in_use:
  - kling-v2-5-turbo            # always sent today: no model is passed
  - kling-v3                    # listed, never sent
  - kling-v2-6                  # listed, never sent
  - kling-v3-omni               # listed, but invalid on text2video and image2video
models_recommended:
  - kling-v3                    # default once `--kling-model` and `sound` are exposed
---

# Kling

VibeFrame uses the official Kling API for text-to-video, image-to-video, and video extension (`vibe generate video -p kling`, `vibe edit fill-gaps`, `vibe generate video-extend`).
Every call goes through the legacy `/v1/videos/*` API with AK/SK JWT auth, and we never pass a model, so every request runs `kling-v2-5-turbo`.

## Models

Prices are list price at 1 Unit = $0.14, per second of output (docs).
`std` is 720p, `pro` is 1080p, `4k` is 4K (docs).

| ID | Kind | Status | Price | Notes |
|---|---|---|---|---|
| Kling 4.0 / 4.0 Flash | video | not in API | - | No API model ID in the official docs or API updates log as of 2026-10-04 (docs). Third-party coverage says 4.0 Flash opened to limited consumer users on 2026-09-28 and full 4.0 lands in October (secondary). |
| `kling-3.0-turbo` | t2v, i2v | GA 2026-06-17 | $0.112/s 720p, $0.14/s 1080p, audio included | New API only (path `/text-to-video/kling-3.0-turbo`), API Key auth only, 3-15 s, first frame only (docs). |
| `kling-v3` | t2v, i2v | GA 2026-02-25 | $0.084/s std, $0.112/s pro, $0.126-0.168/s with audio, $0.42/s 4k | 3-15 s, multi-shot (up to 6), native audio, 4k mode (docs). |
| `kling-v3-omni` | omni video | GA 2026-02-25 | $0.084-0.168/s, $0.42/s 4k | Only on `/v1/videos/omni-video` (legacy) or the new omni path, not on `text2video`/`image2video` (docs). |
| `kling-video-o1` | omni video | GA 2025-12 | $0.084-0.168/s | Default `model_name` of `/v1/videos/omni-video`; 3-10 s; no audio (docs). |
| `kling-v2-6` | t2v, i2v | GA 2025-12 | $0.042/s 720p, $0.07/s 1080p, $0.14-0.168/s with audio | Native audio only at 1080p/pro (docs). |
| `kling-v2-5-turbo` | t2v, i2v | GA 2025-09 | $0.042/s std, $0.07/s pro | **Our default.** Durations 5 or 10 only, no native audio (docs). |

So one default 5 s std clip costs about $0.21 (docs).

## API shape

- Base URL: `https://api-singapore.klingai.com` for servers outside China; the docs say the old `https://api.klingai.com` was changed to it (docs).
  The old host still answered a list call with 200 on 2026-10-04 (probe).
- Two API generations exist side by side (docs, update of 2026-07-15):
  - **Legacy:** `POST /v1/videos/text2video`, `/v1/videos/image2video`, `/v1/videos/omni-video`, flat body with `model_name`, `prompt`, `negative_prompt`, `mode` (`std`/`pro`/`4k`), `duration` (string), `aspect_ratio`, `sound` (`on`/`off`), `image`, `image_tail`, `multi_shot`, `multi_prompt`, `callback_url`.
    Poll with `GET /v1/videos/{text2video|image2video}/{task_id}`; status values `submitted`, `processing`, `succeed`, `failed`; result at `data.task_result.videos[0].url`.
  - **New:** model in the path (`POST /text-to-video/kling-2.5-turbo`, `/image-to-video/kling-3.0`, `/omni-video/kling-o1`), body `{contents:[{type:"prompt"|"first_frame"|"last_frame", ...}], settings:{resolution, duration (int), audio}, options:{callback_url, external_task_id, watermark_info}}`.
    Poll with `GET /tasks?task_ids=...`; status values use `succeeded` (not `succeed`); result at `data[].outputs[].url`.
    Kling says the legacy API stays with no deprecation plan (docs).
- Auth (docs):
  - API Key: `Authorization: Bearer <api key>`, works for all models and both API generations.
  - AK/SK: HS256 JWT with `iss` = access key, signed with the secret key, sent as `Bearer <jwt>`; legacy API only.
  - Our AK/SK JWT works on legacy list endpoints on both hosts (probe).
  - `GET /tasks` (new API) with the same JWT returns 401 code 1002 "The current API does not support AK/SK" (probe).
- Async only: submit returns `data.task_id`, then poll.
  Generated URLs are cleared after 30 days (docs).
- Errors: HTTP status plus JSON `{code, message, request_id}`; `code` 0 means success, 1001 is missing auth (probe).

## Gotchas

- **Single API key will not work with our code.**
  `KLING_API_KEY` must be `ACCESS_KEY:SECRET_KEY`; a new console API key has no colon, so `isConfigured()` returns false and generation fails before any request.
  New Kling 3.0 Turbo and every new-style endpoint reject AK/SK (docs, probe).
- **`kling-v3-omni` is not a valid `model_name` for `text2video`/`image2video`.**
  The legacy enums list only `kling-v2-5-turbo`, `kling-v2-6`, `kling-v3` (docs); omni models need `/v1/videos/omni-video`.
  Our `KlingModel` type and `STD_MODE_MODELS` include `kling-v3-omni` as if it worked on the same endpoints.
- **Image input does not have to be a URL.**
  Legacy `image`/`image_tail` accept a URL or raw Base64 without the `data:image/...;base64,` prefix (docs); new endpoints also take Base64 in `url`.
  Our provider rejects anything but http(s) and forces an ImgBB upload, which is an extra key and leaks frames to a third-party host.
  Images: jpg/jpeg/png, at most 10 MB (legacy) or 50 MB (new), at least 300 px, aspect 1:2.5 to 2.5:1 (docs).
- `kling-v2-5-turbo` accepts only durations 5 and 10; v3/v3-omni accept 3-15; O1 and v2.6 accept 3-10 (docs).
- Native audio is opt-in (`sound: "on"`, default `off`) and not available on v2.5 Turbo or O1 (docs).
  We never send `sound`, so Kling output from VibeFrame is always silent.
- `cfg_scale` and `camera_control` do not appear in the v2.5+ legacy parameter docs (docs); we send `cfg_scale` when callers pass `cfg`.
- `mode` default differs per endpoint: `std` on text2video/image2video, `pro` on omni-video (docs).
- First+last frame on the new 2.5 Turbo endpoint is 1080p only; 3.0 Turbo supports first frame only (docs).
- No cancel endpoint; `cancelGeneration()` correctly returns false.
- `video-extend` support per model was not verified; the capability map does not list it for v2.5+ models.

## In our code

- `packages/ai-providers/src/kling/KlingProvider.ts`
  - L17 `KlingModel` union, L101 `DEFAULT_MODEL = "kling-v2-5-turbo"`, L104 `STD_MODE_MODELS`.
  - L116 base URL `https://api.klingai.com/v1` (old host).
  - L119-137 parses `KLING_API_KEY` as `access:secret`; L135 `isConfigured()` requires both halves.
  - L142-162 HS256 JWT, 30 minute expiry.
  - L199-214 legacy body (`model_name`, `mode`, `aspect_ratio`, `duration`, `negative_prompt`, `cfg_scale`).
  - L216-241 rejects base64 and Blob images; L243 `image2video`, L256 `text2video`, L348 status poll, L472 `video-extend`, L599 cancel stub.
- `packages/cli/src/commands/generate/video.ts` L388-428: Kling branch, uploads `data:` images via `resolveUploadHost()` (ImgBB default), never passes `model`.
- `packages/cli/src/commands/_shared/execute-fill-gaps.ts` L352-390, L437-443, L534: fill-gaps uses Kling image-to-video with frames uploaded to ImgBB.
- `packages/cli/src/commands/_shared/video-providers.ts` L73-105: storyboard retry wrapper, always `mode: "std"`; the L92 comment about a "v1.5 fallback for base64" is stale.
- `packages/cli/src/commands/generate/video-extend.ts` L72-76; `packages/cli/src/commands/ai-video.ts` L219, L537, L684-687.
- `packages/ai-providers/src/api-keys.ts` L109-119: key format hint `ACCESS_KEY:SECRET_KEY`, URL `platform.klingai.com`.

## Recommended changes

1. Accept a single API key (no colon) as `Bearer <key>` and keep AK/SK as a fallback; update `isConfigured()`, the key format check, and setup copy.
2. Move the base URL to `https://api-singapore.klingai.com`.
3. Send raw Base64 (strip the `data:` prefix) instead of requiring an ImgBB upload; keep upload only as an option.
4. Drop `kling-v3-omni` from the text2video/image2video model list, or route omni models to `/v1/videos/omni-video`.
5. Expose `--kling-model` (at least `kling-v3` and `kling-v2-6`) and `sound`, and validate duration per model (5/10 for v2.5 Turbo, 3-15 for v3).
6. Plan a migration to the new API (`/tasks`, `contents`/`settings`) once API-key auth lands, which also unlocks `kling-3.0-turbo`.
7. Stop sending `cfg_scale`; remove the unused `cameraControl` option or wire it to a model that documents it.
8. Re-check for a Kling 4.0 API model ID after the October launch.

## Sources

All opened 2026-10-04.

- https://kling.ai/llms.txt
- https://kling.ai/dev (saved as k4.html; video and image pricing tables)
- https://kling.ai/document-api/guides/get-started/overview
- https://kling.ai/document-api/updates/api
- https://kling.ai/document-api/api/get-started/authentication
- https://kling.ai/document-api/guides/capability-map/video
- https://kling.ai/document-api/pricing/base/video
- https://kling.ai/document-api/api/video/3-0-turbo/image-to-video
- https://kling.ai/document-api/api/video/3-0-omni/image-to-video
- https://kling.ai/document-api/api/video/2-5-turbo/image-to-video
- https://kling.ai/document-api/api/video/2-5-turbo/image-to-video/legacy
- https://kling.ai/document-api/api/video/2-5-turbo/text-to-video/legacy
- https://kling.ai/document-api/api/video/o1/video-omni/legacy
- https://www.atlascloud.ai/blog/tips/kling-4-flash-vs-full (secondary, Kling 4.0 status)
- https://muapi.ai/kling-4 (secondary, Kling 4.0 API not live)
