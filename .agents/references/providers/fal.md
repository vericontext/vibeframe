---
provider: fal
checked: 2026-10-04
env: [FAL_API_KEY, IMGBB_API_KEY]   # IMGBB only for uploading local i2v images
models_endpoint: none
models_in_use:
  - seedance-2.0                # our variant name, default video provider
  - seedance-2.0-fast           # our variant name, `--seedance-model fast`
  - bytedance/seedance-2.0/image-to-video
  - bytedance/seedance-2.0/text-to-video
  - bytedance/seedance-2.0/reference-to-video
  - bytedance/seedance-2.0/fast/image-to-video
  - bytedance/seedance-2.0/fast/text-to-video
  - bytedance/seedance-2.0/fast/reference-to-video
models_recommended:
  - bytedance/seedance-2.5/image-to-video      # opt-in: up to 30s, draft then complete
  - bytedance/seedance-2.5/text-to-video
  - bytedance/seedance-2.5/reference-to-video
---

# fal.ai

VibeFrame uses fal.ai as the gateway to ByteDance Seedance, the default video provider (`-p seedance`, alias `-p fal`) when `FAL_API_KEY` is set.
We call Seedance 2.0 text-to-video, image-to-video, and reference-to-video through the `@fal-ai/client` SDK.

## Models

Seedance bills per token: `tokens = height * width * duration * 24 / 1024` (input video seconds are added for reference video) (docs).
Per-second figures below are fal's own 16:9 approximations.

| ID | Kind | Status | Price | Notes |
|---|---|---|---|---|
| `bytedance/seedance-2.5/{text,image,reference}-to-video` | video | GA | $0.0214 / 1k tokens at 480p/720p, $0.0234 at 1080p; ~$0.2205/s 480p, ~$0.4730/s 720p, ~$1.164/s 1080p | 4-30s or `auto`; `draft` mode; `end_image_url` on i2v; up to 50 references; `task` reference / editing / extension on r2v (docs) |
| `bytedance/seedance-2.5/draft/complete` | video | GA | ~$1.164/s (1080p) | Completes a `draft_id` at 1080p; valid 7 days, same account only (docs) |
| `bytedance/seedance-2.0/{text,image,reference}-to-video` | video | GA | $0.014 / 1k tokens (480p-1080p), $0.008 / 1k at 4k; ~$0.3034/s 720p, ~$0.682/s 1080p | 4-15s or `auto`; 480p / 720p / 1080p / 4k; we use these (docs) |
| `bytedance/seedance-2.0/fast/...` | video | GA | $0.0112 / 1k tokens; ~$0.2419/s 720p | 480p / 720p only (docs) |
| `bytedance/seedance-2.0/mini/...` | video | GA | $0.007 / 1k tokens; ~$0.0721/s 480p, ~$0.1547/s 720p | Cheapest Seedance tier (docs) |
| `bytedance/seedance-2.{0,5}/us/...` | video | GA | not checked | US-hosted variants exist in the listing (probe) |
| `bytedance/seedance-2.5/fast/...` | - | does not exist | - | Not in the platform model search; the model page is an empty shell (probe) |
| `fal-ai/bytedance/seedance/v1*/...` | video | v1 lite deprecated, v1 pro / v1.5 pro active | not checked | Older generation (probe) |
| `bytedance/seedream/v5/{pro,lite,flash}/...`, `fal-ai/bytedance/seedream/v4.5/...` | image | active (v3 deprecated) | not checked | Text-to-image, edit, layerize (probe) |
| `fal-ai/flux-2`, `fal-ai/flux-2/klein/...` | image | active | not checked | FLUX.2 base plus klein 4b / 9b LoRA variants (probe) |

## API shape

- Auth header is `Authorization: Key <key>` (not `Bearer`); SDKs read `FAL_KEY`, but we pass `FAL_API_KEY` as `credentials` explicitly (docs).
- Sync: `POST https://fal.run/<endpoint_id>` blocks until the result (docs).
- Queue (recommended): `POST https://queue.fal.run/<endpoint_id>` returns `request_id`, `status_url`, `response_url`, `cancel_url` (docs).
- Poll `status_url` (add `?logs=1` for logs): `IN_QUEUE` (with `queue_position`), `IN_PROGRESS`, `COMPLETED` (docs).
- A `COMPLETED` status can still be a failure; check `error` and `error_type` before fetching `response_url` (docs).
- Cancel: `PUT .../requests/{id}/cancel` returns 202 `CANCELLATION_REQUESTED` or 400 `ALREADY_COMPLETED`; in-progress jobs may still finish (docs).
- `X-Fal-Request-Timeout` sets an absolute server-side deadline (docs).
- The JS SDK wraps this as `fal.queue.submit/status/result/cancel`, or `fal.subscribe` which submits and polls (docs).
- Seedance output: `{ video: { url, content_type, file_name, file_size }, seed }`, plus `draft_id` on 2.5 (docs).
- Seedance 2.0 inputs: `prompt`, `image_url` (i2v, required), `end_image_url` (i2v), `image_urls` / `video_urls` / `audio_urls` (r2v), `resolution`, `duration`, `aspect_ratio` (auto, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16), `generate_audio` (default true, same price), `bitrate_mode`, `codec`, `end_user_id` (docs).
- `duration` and `resolution` are string enums in the schema (`"auto"`, `"4"`..`"15"`) (docs).
- Errors: HTTP 422 with `detail: [{ loc, msg, type, url, ctx?, input? }]` and an `X-Fal-Needs-Retry` header; branch on `type`, not `msg` (docs).
- Platform model search: `GET https://api.fal.ai/v1/models?q=<text>` returns `endpoint_id` and `status` (probe, no key needed).

## Gotchas

- ByteDance rejects image-to-video inputs that show a recognizable face with a deterministic 422: "The images or videos provided may contain likenesses of real people." (probe, observed 2026-07-26 on `seedance-2.0`, recorded in MODELS.md and #319).
- The likeness filter also fires on AI-generated photoreal faces; hands-only and back-of-head shots pass; retrying never helps (probe, 2026-07-26).
- Runway accepted the same face keyframes (probe, 2026-07-26, #325).
- fal documents `content_policy_violation` as a 422, non-retryable, raised by fal's or a partner's filter with partner-specific sensitivity (docs).
- Whether the likeness 422 carries `type: content_policy_violation` was not captured; our detector matches the message text, which fal says not to parse (unverified).
- Seedance 2.0 schemas list no `seed` and no `negative_prompt` input; we send both when set (docs, effect not probed).
- Seedance 2.0 now accepts `4k`; our code maps `4k` to `1080p` (docs).
- `fast` tops out at 720p (docs).
- fal accepts base64 data URIs for file inputs but warns they bloat requests beyond a few KB; the recommended path is a fal CDN upload (`fal.storage.upload`) or any public URL that needs no cookies or auth (docs).
- Our code comment says Seedance i2v rejects data URIs; that contradicts the general fal docs and was not re-probed (unverified).
- Image inputs: 2.0 i2v takes JPEG / PNG / WebP up to 30 MB; 2.5 i2v also takes gif and avif; r2v images up to 30 MB each, 30 images max (docs).
- 2.5 r2v reference videos must be 1.8-30.2s, at most 200 MB, 300-6000 px per side, 24-60 fps, combined at most 30.2s (docs).
- Reference video inputs multiply the price by 0.6 but you also pay for the input video seconds (docs).
- Seedance 2.5 i2v page says resolution is 480p or 720p, while t2v / r2v schemas and the pricing blurb include 1080p (docs, conflicting).
- `aspect_ratio: auto` makes cost unpredictable because frame area drives tokens (docs).
- `fal.subscribe` blocks; if the process dies mid-run the paid request keeps going and we never learn its `request_id`.

## In our code

- `packages/ai-providers/src/fal/FalProvider.ts:24-44` - variant names and the six Seedance 2.0 endpoint IDs.
- `packages/ai-providers/src/fal/FalProvider.ts:46-52` - resolution and aspect allowlists (no `4k`).
- `packages/ai-providers/src/fal/FalProvider.ts:54-90` - `estimateSeedanceVideoCostUsd` token-based estimate.
- `packages/ai-providers/src/fal/FalProvider.ts:179-197` - request body; sends `negative_prompt` and `seed` (193-194), numeric `duration`.
- `packages/ai-providers/src/fal/FalProvider.ts:200` - `client.subscribe` (blocking).
- `packages/ai-providers/src/fal/FalProvider.ts:226-257` - error formatting from `status`, `requestId`, `fieldErrors`, `body`.
- `packages/ai-providers/src/fal/FalProvider.ts:273-277` - single `referenceImage` must be http(s); data URIs dropped.
- `packages/ai-providers/src/fal/FalProvider.ts:287-310` - references: data URIs uploaded via `client.storage.upload` with 1h lifecycle.
- `packages/ai-providers/src/fal/FalProvider.ts:347-362` - resolution (`4k` to `1080p`) and duration clamps (4-15).
- `packages/ai-providers/src/fal/index.ts:13` - registry `models` list.
- `packages/cli/src/commands/ai-video.ts:127-180` - MCP/agent Seedance path; local images uploaded via ImgBB/S3 upload host (137-145).
- `packages/cli/src/commands/generate/video.ts:608-697` - CLI Seedance path; upload host for start and end images (622-668).
- `packages/cli/src/commands/generate/video.ts:259` and `:782` - dry-run cost via `estimateSeedanceVideoCostUsd`.
- `packages/cli/src/commands/_shared/build-plan.ts:464` - build plan cost estimate.
- `packages/cli/src/commands/_shared/scene-build.ts:2209-2216` - per-beat `provider:` cue to dodge the likeness filter.
- `packages/cli/src/commands/_shared/scene-build.ts:2312-2333` - build clips request `generateAudio: false`.
- `packages/cli/src/commands/_shared/scene-build.ts:2334-2360` - automatic Runway fallback on a likeness 422.
- `packages/cli/src/commands/_shared/scene-build.ts:2938-2945` - `isLikenessRejection` regex on the message text.

## Recommended changes

1. Make `isLikenessRejection` also match `type: content_policy_violation` with `loc` on an image field, and keep the text match as a fallback, after capturing one real 422 body.
2. Replace the ImgBB/S3 upload for Seedance start and end frames with `client.storage.upload` (already used for references), removing the `IMGBB_API_KEY` dependency for fal.
3. Stop sending `negative_prompt` and `seed` to Seedance 2.0, or probe once that they are ignored rather than rejected.
4. Switch from `subscribe` to `queue.submit` and persist `request_id` before polling, so `--no-wait` and crashes do not orphan paid jobs.
5. Send `duration` as the documented string enum.
6. Add Seedance 2.5 as an opt-in variant (30s, draft-then-complete) and `mini` as a budget tier; extend the cost estimator with their token rates.
7. Allow `4k` on 2.0 instead of silently downgrading to 1080p.

## Sources

- Live probe, 2026-10-04: `GET https://api.fal.ai/v1/models?q=seedance`, `?q=seedream`, `?q=flux-2`.
- Likeness 422 observation, 2026-07-26: MODELS.md, commits 068af98 (#319) and 66f383e (#325).
- https://fal.ai/models/bytedance/seedance-2.0/text-to-video/llms.txt (2026-10-04)
- https://fal.ai/models/bytedance/seedance-2.0/image-to-video/llms.txt (2026-10-04)
- https://fal.ai/models/bytedance/seedance-2.0/reference-to-video/llms.txt (2026-10-04)
- https://fal.ai/models/bytedance/seedance-2.0/fast/text-to-video/llms.txt (2026-10-04)
- https://fal.ai/models/bytedance/seedance-2.0/mini/image-to-video/llms.txt (2026-10-04)
- https://fal.ai/models/bytedance/seedance-2.5/text-to-video/llms.txt (2026-10-04)
- https://fal.ai/models/bytedance/seedance-2.5/reference-to-video/llms.txt (2026-10-04)
- https://fal.ai/models/bytedance/seedance-2.5/draft/complete/llms.txt (2026-10-04)
- https://fal.ai/models/bytedance/seedance-2.5/image-to-video (saved HTML, 2026-10-04)
- https://fal.ai/docs/documentation/model-apis/inference/queue.md (2026-10-04)
- https://fal.ai/docs/documentation/model-apis/authentication.md (2026-10-04)
- https://fal.ai/docs/documentation/model-apis/fal-cdn.md (2026-10-04)
- https://fal.ai/docs/documentation/model-apis/errors.md (2026-10-04)
