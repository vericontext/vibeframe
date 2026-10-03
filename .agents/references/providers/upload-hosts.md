---
provider: upload-hosts
checked: 2026-10-04
env: [IMGBB_API_KEY, VIBE_UPLOAD_PROVIDER, VIBE_UPLOAD_TTL_SECONDS, VIBE_UPLOAD_S3_BUCKET, VIBE_UPLOAD_S3_PREFIX, VIBE_UPLOAD_PUBLIC_BASE_URL, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN, AWS_REGION, AWS_DEFAULT_REGION]
models_endpoint: none
models_in_use: []
---

# Upload hosts (ImgBB and S3)

Some video providers take image inputs only as HTTPS URLs, so VibeFrame uploads local images to a temporary host first.
ImgBB is the default host; S3 is the opt-in alternative (`VIBE_UPLOAD_PROVIDER=s3` or `upload.provider: s3` in config).

## Hosts

| Host | Kind | Status | Price | Notes |
|---|---|---|---|---|
| ImgBB | third-party image host | GA, API v1 | free key | Up to 32 MB per image; optional auto-delete via `expiration` of 60 to 15,552,000 seconds (docs) |
| Amazon S3 | user's own bucket | GA | user's AWS bill | We presign a PUT with SigV4 and return an unsigned object URL (code) |
| fal CDN | fal's own storage | GA | included with fal | Not used by us; fal recommends uploading inputs to its CDN, and some fal models accept data URIs directly (docs) |

Which callers need a URL:

- Kling image-to-video: our provider refuses anything that is not `http(s)` for v2.5 and later (code), but Kling's docs say image input "can be provided via URL or Base64" (docs), so the upload is optional for Kling. See `kling.md`.
- Seedance via fal image-to-video: `image_url` and `end_image_url` take JPEG, PNG or WebP up to 30 MB (docs).
  fal says URLs work with every model and some models also accept data URIs (docs); our code comment says Seedance 2.0 rejects data URIs, which was not re-verified.
- Seedance reference-to-video already sends local images, videos and audio to fal as data URIs with no upload host (code), so the two Seedance paths disagree.
- `vibe edit fill-gaps` uploads extracted frames for Kling continuation (code).

## API shape

ImgBB:

- `POST https://api.imgbb.com/1/upload` with `key`, `image` (binary, base64 or URL), optional `name` and `expiration` (docs).
- Response fields include `data.url`, `data.display_url`, `data.delete_url` and `data.expiration`, plus `success` and `status` (docs).
- We read only `data.url`, and `error.message` on failure.

S3 as implemented in `upload-host.ts`:

- Settings: `VIBE_UPLOAD_PROVIDER`, `VIBE_UPLOAD_TTL_SECONDS` (default 3600), `VIBE_UPLOAD_S3_BUCKET`, `AWS_REGION` or `AWS_DEFAULT_REGION`, `VIBE_UPLOAD_S3_PREFIX` (default `vibeframe/tmp`), `VIBE_UPLOAD_PUBLIC_BASE_URL`, each falling back to the `upload` block in config.
- Credentials come only from `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and optional `AWS_SESSION_TOKEN`; AWS profiles and SSO are not read.
- Key is `<prefix>/<epoch-ms>-<uuid>.<ext>` on the virtual-hosted endpoint `https://<bucket>.s3.<region>.amazonaws.com`.
- Upload is a `PUT` to a SigV4 presigned URL valid for the TTL, with `UNSIGNED-PAYLOAD` and only `host` signed.
- The returned URL is the plain object URL (or `VIBE_UPLOAD_PUBLIC_BASE_URL/<key>`), not a presigned GET.
- Errors surface as `S3 upload failed (<status>)`; the S3 XML error body is not read.

## Gotchas

- ImgBB uploads are permanent: we never send `expiration`, so `upload.ttlSeconds` has no effect on the ImgBB path (code, docs).
- ImgBB URLs carry no auth token, so anyone holding the link can fetch the image (docs, from the response shape).
  User reference images, including faces used for likeness, end up on a third-party host indefinitely; ImgBB's terms reserve the right to remove content and say nothing about link privacy (docs).
- We discard `delete_url`, so we cannot clean up after a job finishes.
- The S3 path returns an unsigned URL, so the object must be publicly readable through a bucket policy or a CDN at `VIBE_UPLOAD_PUBLIC_BASE_URL`.
  New buckets block public access by default (docs), so a fresh bucket uploads fine and then the provider gets 403 on fetch.
- The S3 `expiresAt` we return is the lifetime of the PUT URL, not of the object; nothing deletes uploads unless the user adds a lifecycle expiration rule on the prefix (docs).
- SigV4 presigned URLs top out at 7 days, and URLs signed with temporary credentials die when those credentials expire (docs); a `VIBE_UPLOAD_TTL_SECONDS` above 604800 yields an invalid URL.
- `upload.s3.endpoint` exists in the config schema but the uploader ignores it, so R2, MinIO and other S3-compatible stores do not work.
- Base64 in a form body inflates the upload by about a third; large images approach ImgBB's 32 MB and fal's 30 MB limits sooner than the file size suggests.
- Two separate ImgBB implementations exist:
  `uploadToImgbb` (URL-encoded body, checks HTTP status) is used by `resolveUploadHost`, while `execute-fill-gaps.ts` has its own `uploadFrameToImgbb` (multipart body, no status check) and always uses ImgBB even when S3 is configured.
- `prepareSeedanceReferences` is duplicated in `ai-video.ts` and `generate/video.ts`.

## In our code

- `packages/cli/src/utils/upload-host.ts:60-113` - SigV4 PUT presigner.
- `packages/cli/src/utils/upload-host.ts:115-131` - public object URL builder.
- `packages/cli/src/utils/upload-host.ts:133-157` - settings resolution from env and config.
- `packages/cli/src/utils/upload-host.ts:162-205` - S3 host: credential check, key layout, PUT, returned URL and `expiresAt`.
- `packages/cli/src/utils/upload-host.ts:207-219` - ImgBB host via `uploadToImgbb`.
- `packages/cli/src/commands/_shared/video-utils.ts:57-94` - `uploadToImgbb`, no `expiration`.
- `packages/cli/src/commands/_shared/execute-fill-gaps.ts:167-196` - duplicate `uploadFrameToImgbb`.
- `packages/cli/src/commands/_shared/execute-fill-gaps.ts:384-392`, `:437-447`, `:534-542` - ImgBB key lookup and frame uploads for Kling.
- `packages/cli/src/commands/generate/video.ts:397-418` - Kling upload through `resolveUploadHost`.
- `packages/cli/src/commands/generate/video.ts:620-667` - Seedance start and end image uploads.
- `packages/cli/src/commands/ai-video.ts:136-145`, `:222-231` - the same for the pipeline path; `:381-417` sends references as data URIs.
- `packages/ai-providers/src/kling/KlingProvider.ts:219-240` - URL-only check for Kling image input.
- `packages/cli/src/config/schema.ts:48-58`, `:103-108` - `upload` config and defaults, including the unused `endpoint`.
- `packages/cli/src/commands/setup.ts:468-545` - interactive upload host setup.
- `packages/ai-providers/src/api-keys.ts:155-169`, `packages/cli/src/utils/api-key.ts:20`, `:216` - ImgBB key registry.

## Recommended changes

1. Send `expiration` on every ImgBB upload, derived from `upload.ttlSeconds` and clamped to 60 to 15,552,000 seconds.
2. Route `execute-fill-gaps.ts` through `resolveUploadHost()` and delete `uploadFrameToImgbb`, so S3 users never fall back to ImgBB silently.
3. For S3, return a presigned GET URL (bounded by the TTL and 7 days) unless `VIBE_UPLOAD_PUBLIC_BASE_URL` is set, so private buckets work without a public policy.
4. Document that S3 objects persist and suggest a lifecycle rule on the prefix; make `expiresAt` describe the URL it actually returns.
5. Either honor `upload.s3.endpoint` (path-style for S3-compatible stores) or drop it from the schema.
6. Test whether fal Seedance image-to-video accepts data URIs or a fal CDN upload; if so, skip third-party hosting for Seedance entirely.
7. Tell users in setup and `--dry-run` output that ImgBB links are public and unauthenticated.

## Sources

- https://api.imgbb.com/ (2026-10-04)
- https://imgbb.com/tos (2026-10-04)
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html (2026-10-04)
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html (2026-10-04)
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html (2026-10-04)
- https://fal.ai/docs/documentation/model-apis/fal-cdn (saved earlier as `fal_fal-cdn.md`) (2026-10-04)
- https://fal.ai/models/bytedance/seedance-2.0/image-to-video (saved earlier as HTML) (2026-10-04)
- No probe: an ImgBB or S3 upload is a write that publishes data, so none was made.

- https://kling.ai/document-api/api/video/3-0-omni/image-to-video (read in a browser; the old `apiReference/model/imageToVideo` URL redirects here) (2026-10-04)
