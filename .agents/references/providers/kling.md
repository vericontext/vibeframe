---
provider: kling
checked: 2026-10-31
env: [KLING_API_KEY]
models_endpoint: none
models_in_use:
  - kling-v3                    # default, legacy API
  - kling-4.0                   # `--kling-model 4.0`, new API (API key only)
  - kling-3.0-turbo             # `--kling-model 3.0-turbo`, new API (API key only)
  - kling-v2-6                  # `--kling-model v2.6`, legacy API
  - kling-v2-5-turbo            # `--kling-model v2.5-turbo`, legacy API
models_recommended: []
---

# Kling

VibeFrame uses the official Kling API for text-to-video, image-to-video, and video extension (`vibe generate video -p kling`, `vibe edit fill-gaps`, `vibe generate video-extend`).
Kling runs two API generations side by side, and the catalog's `api` field picks one per model.
`kling-v3` (the default), `kling-v2-6`, `kling-v2-5-turbo`, and video extension use the legacy `/v1/videos/*` API, authenticated with either a single console API key (Bearer) or the legacy AK/SK pair (JWT).
`kling-4.0` and `kling-3.0-turbo` exist only on the new API (model in the path, polled through `/tasks`), which takes an API key only.

## Models

Prices are list price at 1 Unit = $0.14, per second of output (docs).
`std` is 720p, `pro` is 1080p, `4k` is 4K (docs).

| ID | Kind | Status | Price | Notes |
|---|---|---|---|---|
| `kling-4.0` | t2v, i2v, omni (reference, editing, voice) | GA (API update of 2026-10-28, "Kling 4.0 API Is Now Fully Available") | No input video: $0.157/s 720p, $0.235/s 1080p. With input video: $0.094/s 720p, $0.141/s 1080p, billed on output x 2 (input <= output) or input + output (input > output). No 4K yet ("10-bit 4K coming soon") (docs) | **New API only, no `model_name`:** the model is in the path: `POST /text-to-video/kling-4.0`, `/image-to-video/kling-4.0`, `/omni-video/kling-4.0`; API Key (Bearer) auth only. Text-to-video body is flat: `prompt` (string) plus `settings` (`resolution` 720p/1080p, default 1080p; `aspect_ratio` 21:9, 16:9, 9:16, 1:1, default 16:9; `duration` 3-30 s integer, default 10) and `options` (`callback_url`, `external_task_id`, `watermark_info`). Image-to-video takes `contents` (`prompt`, `first_frame`, `middle_frame`, `last_frame`, each image `url` as URL or Base64, optional `id` for `@id` references; up to 10 images, jpg/png, 30 MB, 300 px, aspect 2:5 to 5:2) plus `settings` (`resolution`, `duration`; no `aspect_ratio`, it follows the frames). Omni takes `contents` with `refer_image`, `feature_video`, `base_video`, `element`, `voice` and `aspect_ratio` `adaptive` (default there). No negative prompt field ("the prompt can include positive and negative descriptions"), no seed, no audio switch: native audio is always on and steered by the prompt. Prompt up to 26,000 English characters. Results come from the shared `GET /tasks?task_ids=` (with `billing`), kept 30 days (docs). |
| `kling-3.0-turbo` | t2v, i2v | GA 2026-06-17 | $0.112/s 720p, $0.14/s 1080p, audio included | New API only (`/text-to-video/kling-3.0-turbo`, `/image-to-video/kling-3.0-turbo`), API Key auth only. Text-to-video: flat `prompt` (2,500 characters) plus `settings` (`resolution` default 720p, `aspect_ratio` 16:9/9:16/1:1, `duration` 3-15 s, default 5). Image-to-video: `contents` with `prompt` and `first_frame` only (no last frame), image URL or Base64, 50 MB, aspect 1:2.5 to 2.5:1, no `aspect_ratio` (docs). |
| `kling-v3` | t2v, i2v | GA 2026-02-25 | $0.084/s std, $0.112/s pro, $0.126-0.168/s with audio, $0.42/s 4k | 3-15 s, multi-shot (up to 6), native audio, 4k mode (docs). |
| `kling-v3-omni` | omni video | GA 2026-02-25 | $0.084-0.168/s, $0.42/s 4k | Only on `/v1/videos/omni-video` (legacy) or the new omni path, not on `text2video`/`image2video` (docs). |
| `kling-video-o1` | omni video | GA 2025-12 | $0.084-0.168/s | Default `model_name` of `/v1/videos/omni-video`; 3-10 s; no audio (docs). |
| `kling-v2-6` | t2v, i2v | GA 2025-12 | $0.042/s 720p, $0.07/s 1080p, $0.14-0.168/s with audio | 5 or 10 s (capability map); native audio only at 1080p/pro (docs). |
| `kling-v2-5-turbo` | t2v, i2v | GA 2025-09 | $0.042/s std, $0.07/s pro | Durations 5 or 10 only, no native audio (docs). |

So one default 5 s std clip costs about $0.42 on v3, and the cheapest Kling 4.0 clip (3 s, 720p) costs $0.471 (docs).

## API shape

- Base URL: `https://api-singapore.klingai.com` for servers outside China; the docs say the old `https://api.klingai.com` was changed to it, and list only the Singapore host (docs, 2026-10-31).
  Both API generations live on it: our AK/SK JWT worked on legacy list endpoints on both hosts on 2026-10-04 (probe).
  The old host still answered a list call with 200 on 2026-10-04 (probe).
- Two API generations exist side by side (docs, update of 2026-07-15):
  - **Legacy:** `POST /v1/videos/text2video`, `/v1/videos/image2video`, `/v1/videos/omni-video`, flat body with `model_name`, `prompt`, `negative_prompt`, `mode` (`std`/`pro`/`4k`), `duration` (string), `aspect_ratio`, `sound` (`on`/`off`), `image`, `image_tail`, `multi_shot`, `multi_prompt`, `callback_url`.
    Poll with `GET /v1/videos/{text2video|image2video}/{task_id}`; status values `submitted`, `processing`, `succeed`, `failed`; result at `data.task_result.videos[0].url`.
  - **New:** model in the path (`POST /text-to-video/kling-4.0`, `/image-to-video/kling-3.0`, `/omni-video/kling-o1`).
    Text-to-video bodies are a flat `prompt` plus `settings`; image-to-video and omni bodies are typed `contents` items plus `settings`; both take `options` (`callback_url`, `external_task_id`, `watermark_info`).
    Create returns `{code, message, request_id, data: {id, status, create_time, update_time, external_id}}`.
    Poll with `GET /tasks?task_ids=a,b` (or `external_task_ids=`, not both); the reply is `data: [{id, status, message, outputs: [{type: "video", id, url, watermark_url, duration}], billing: [{charge_type, cash_type, amount, currency, package_type, list_price}]}]`.
    Status values are `submitted`, `processing`, `succeeded` (not `succeed`), `failed`; `message` carries the failure reason (for example content risk control).
    `POST /tasks` lists tasks by time range and cursor.
    Kling says the legacy API stays with no deprecation plan (docs).
- Auth (docs):
  - API Key: `Authorization: Bearer <api key>`, "for all models", both API generations.
  - AK/SK: HS256 JWT with `iss` = access key, signed with the secret key, sent as `Bearer <jwt>`; legacy API only ("the model version in the path is the new version, `model_name` is the legacy version").
  - Our AK/SK JWT works on legacy list endpoints on both hosts (probe).
  - `GET /tasks` (new API) with the same JWT returns 401 code 1002 "The current API does not support AK/SK" (probe).
- Async only: submit returns a task ID, then poll.
  Generated URLs are cleared after 30 days (docs).
- Errors: HTTP status plus JSON `{code, message, request_id}`; `code` 0 means success (docs).
  1000-1004 auth (401), 1100-1102 account/credits (429: abnormal account, arrears, resource pack exhausted), 1103 no access to the API or model (403), 1200-1201 invalid parameters (400), 1202-1203 wrong method or missing resource such as a model (404), 1300-1301 platform or content-security policy (400), 1302-1303 rate or concurrency limit (429), 1304 IP whitelist (429), 5000-5002 internal error, maintenance, backlog timeout (docs, error-codes page).
- The Markdown versions of the docs are served at the page URL plus `.md` (index: `https://kling.ai/document-api/llms.txt`); the HTML pages render client-side.

## Gotchas

- **Single API keys work on the legacy endpoints.**
  A key without a colon is sent as `Bearer <key>`; a `kling-v3` text2video job on `api.klingai.com` succeeded with one on 2026-10-04 (probe).
  New Kling 3.0 Turbo, Kling 4.0, and every new-style endpoint reject AK/SK, so single keys are the path forward (docs, probe).
- **New-API text-to-video does not use `contents`.**
  `/text-to-video/kling-4.0` and `/text-to-video/kling-3.0-turbo` take a top-level `prompt` string; only image-to-video and omni take `contents` (docs, 2026-10-31).
- **New-API image-to-video has no `aspect_ratio`.**
  The output follows the first frame, so a `--ratio` passed with `-i` has no effect on 4.0 and 3.0 Turbo (docs).
- **`kling-v3-omni` is not a valid `model_name` for `text2video`/`image2video`.**
  The legacy enums list only `kling-v2-5-turbo`, `kling-v2-6`, `kling-v3` (docs); omni models need `/v1/videos/omni-video`.
- **Image input does not have to be a URL.**
  Legacy `image`/`image_tail` accept a URL or raw Base64 without the `data:image/...;base64,` prefix (docs); new endpoints also take Base64 in `url` (whether a `data:` prefix is accepted there is not stated).
  Our provider rejects anything but http(s) and the CLI forces an ImgBB upload, which is an extra key and leaks frames to a third-party host.
- `kling-v2-5-turbo` and `kling-v2-6` accept only durations 5 and 10 (capability map, 2026-10-31); v3/v3-omni accept 3-15; O1 accepts 3-10 (docs).
- Native audio is opt-in on the legacy API (`sound: "on"`, default `off`) and not available on v2.5 Turbo or O1 (docs).
  We never send `sound`, so legacy Kling output from VibeFrame is silent; 4.0 and 3.0 Turbo always have audio.
- Kling 4.0 billing doubles with an input video (output x 2 when the input is shorter, input + output when longer); VibeFrame sends no input video, so it bills output seconds only (docs).
- `cfg_scale` and `camera_control` do not appear in the v2.5+ legacy parameter docs (docs); we send `cfg_scale` when callers pass `cfg`.
- `mode` default differs per endpoint: `std` on text2video/image2video, `pro` on omni-video (docs).
  New-API `resolution` defaults to 1080p on 4.0 and 720p on 3.0 Turbo; VibeFrame always sends it (720p unless `--resolution 1080p` or `--mode pro`).
- First+last frame on the new 2.5 Turbo endpoint is 1080p only; 3.0 Turbo supports first frame only (docs).
- No cancel endpoint; `KlingProvider` has no `cancelVideoJob`.
- `video-extend` support per model was not verified; the capability map does not list it for v2.5+ models.
  VibeFrame refuses to extend a 4.0 or 3.0 Turbo job (`unsupported`).
- Probe 2026-10-31 (live, approved, no charge): `vibe generate video -p kling --kling-model 4.0 -d 3 --resolution 720p` with our single API key reached `POST /text-to-video/kling-4.0` on `api-singapore.klingai.com`, passed auth, and was refused with HTTP 429 "Account balance not enough", which we classify as `quota` (exit 5, not retryable). So the path, host, and Bearer auth are right; a successful 4.0 generation is still unverified because the account has no balance. The docs banner says 4.0 needs the Flagship Resource Pack or a topped-up balance. The dry run prices the same request at $0.471.
- Not verified: whether `/v1/videos/*` answers on `api-singapore.klingai.com` for a paid generation (only list endpoints were probed there), and whether the new API accepts a `data:` URI prefix.

## In our code

- `packages/ai-providers/src/catalog/catalog.ts`: the five Kling entries carry `api` (`legacy` or `model-path`), `durationSec`, `resolutions`, and per-resolution prices in `price.bySize` (`720p`, `1080p`).
- `packages/ai-providers/src/kling/KlingProvider.ts`
  - Base URL `https://api-singapore.klingai.com` for both generations; `config.baseUrl` overrides the host.
  - `plan()` resolves the catalog model and builds the body for its generation: `planLegacy()` (`/v1/videos/{text2video|image2video}`, `model_name`, `mode` from the resolution, duration string via `klingDuration()`), `planModelPath()` (`/{text|image}-to-video/{model}`, flat `prompt` or typed `contents`, integer duration checked against the catalog range, refuses negative prompt, seed, references, `generateAudio: false`, and a last frame on 3.0 Turbo).
  - `resolution()`: `--resolution` (must be in the catalog list), else `mode` (`std` 720p, `pro` 1080p), else 720p.
  - `submitVideo()` records the billed usage (requested seconds at the requested resolution) once Kling accepts the job; `usageFor()` returns the same record for dry runs.
  - `getTask()` polls `GET /tasks?task_ids=`, maps `succeeded`, and reads the `video` output; a bare task ID falls back to `/tasks` after both legacy endpoints answer not found.
  - `apiKeyToken()` refuses new-API models with only an AK/SK pair (`auth`, before any request); `token()` signs the HS256 JWT for the legacy API.
  - `klingErrorKind()` maps the service codes above; `submitExtend()` serves legacy jobs only.
- `packages/cli/src/commands/generate/video.ts`: `--kling-model` choices and per-model `--duration` help come from the catalog; `videoRequestProblem()` rejects out-of-range durations and resolutions before the dry run; the dry run prices `usageFor()`; real runs report the metered cost.
- `packages/cli/src/commands/_shared/execute-fill-gaps.ts`: fill-gaps uses Kling image-to-video (default model) with frames uploaded to ImgBB.
- `packages/cli/src/commands/_shared/video-providers.ts`: storyboard retry wrapper, always `mode: "std"`; its comment about a "v1.5 fallback for base64" is stale.
- `packages/cli/src/testing/fake-provider-network.ts`: default routes for both generations on `KLING_HOST`.
- `packages/ai-providers/src/api-keys.ts`: env example says single API key or legacy pair, URL `platform.klingai.com`.

## Recommended changes

1. Done: the base URL moved to `https://api-singapore.klingai.com`.
2. Send raw Base64 (strip the `data:` prefix) instead of requiring an ImgBB upload; keep upload only as an option.
3. Done for 4.0 and 3.0 Turbo: the new API (`/tasks`, `contents`/`settings`) runs beside the legacy one.
   Moving v3, v2.6, and v2.5 Turbo to their new paths (`/text-to-video/kling-3.0`, ...) is optional; the legacy API has no deprecation plan, and the move would drop AK/SK support for them.
4. Stop sending `cfg_scale`; remove the unused `cameraControl` option or wire it to a model that documents it.
5. Done: Kling 4.0 is in the catalog as an opt-in model (`--kling-model 4.0`).
   Consider making it the default once a live probe passes: it is the newest GA model, 3-30 s, native audio, but costs about 1.9x v3 at 720p.
6. Wire the remaining 4.0 inputs (omni references, 21:9 and `adaptive` aspect, middle frames) when a command needs them.

## Sources

All opened 2026-10-04 unless dated.

- https://kling.ai/llms.txt
- https://kling.ai/document-api/llms.txt (2026-10-31; index of the `.md` pages)
- https://kling.ai/dev (saved as k4.html; video and image pricing tables)
- https://kling.ai/document-api/guides/get-started/overview
- https://kling.ai/document-api/updates/api (reopened 2026-10-31 as `.md`: 4.0 GA on 2026-10-28)
- https://kling.ai/document-api/api/get-started/authentication (reopened 2026-10-31: API Key is "for all models", AK/SK only for the legacy design, domain `api-singapore.klingai.com`)
- https://kling.ai/document-api/api/get-started/error-codes.md (2026-10-31)
- https://kling.ai/document-api/guides/capability-map/video (reopened 2026-10-31 as `.md`)
- https://kling.ai/document-api/pricing/base/video (reopened 2026-10-31 as `.md`, Balance view for USD)
- https://kling.ai/document-api/api/video/4-0/text-to-video.md (2026-10-31)
- https://kling.ai/document-api/api/video/4-0/image-to-video.md (2026-10-31)
- https://kling.ai/document-api/api/video/4-0/video-omni (2026-10-31, read in Chrome)
- https://kling.ai/document-api/api/usage-guide/kling-4-0.md (2026-10-31)
- https://kling.ai/document-api/api/video/3-0-turbo/text-to-video.md (2026-10-31)
- https://kling.ai/document-api/api/video/3-0-turbo/image-to-video.md (2026-10-31)
- https://kling.ai/document-api/api/video/3-0-omni/image-to-video
- https://kling.ai/document-api/api/video/2-5-turbo/image-to-video
- https://kling.ai/document-api/api/video/2-5-turbo/image-to-video/legacy
- https://kling.ai/document-api/api/video/2-5-turbo/text-to-video/legacy
- https://kling.ai/document-api/api/video/o1/video-omni/legacy
