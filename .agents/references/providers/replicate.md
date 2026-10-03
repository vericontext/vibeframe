---
provider: replicate
checked: 2026-10-04
env: [REPLICATE_API_TOKEN]
models_endpoint: none
models_in_use:
  - 7be0f12c54a8d033a0fbd14418c9af98962da9a86f5ff7811f9b3423a1f0b7d7  # meta/musicgen version, bare hash in code
  - nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa
  - sczhou/propainter:1d0b4c1d7296db4db6bf92dd43d2d38cf2e855a5e5e04e0c7f4e83f5ce59f6e9
  - lucataco/resemble-enhance
  - cd0a3bf6b7ee1ff12cfb6e1f16e3c4c1a2dc57b8d8b8c4b7a7e9f8b5c7a9d8e1  # bare hash, style transfer
  - facebookresearch/co-tracker
  - meta/sam-2:fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83
---

# Replicate

VibeFrame uses Replicate as the secondary music provider (`vibe generate music -p replicate`, Meta MusicGen, max 30 s).
`ReplicateProvider` also carries upscale, inpaint, audio restore, style transfer, and tracking helpers, but most of them point at models that no longer resolve or use a request shape the API does not define.

## Models

Replicate has no model listing that `providers:check` supports; each model is checked with the free `GET /v1/models/{owner}/{name}` and `.../versions/{id}` calls (probe).

| ID | Kind | Status | Price | Notes |
|---|---|---|---|---|
| `meta/musicgen` | music | community model, last version 2024-03-28 | about $0.034 per run on A100 80GB, "typically within 25 s" | **Our music model.** Not an official model, so a version is required. Weights CC-BY-NC 4.0 (docs). |
| `stability-ai/stable-audio-2.5` | music + SFX | official | $0.20 per output file | Official, no version pin needed (docs). |
| `google/lyria-2` | music | official, updated 2025-11-25 | not read | 48 kHz stereo (probe listing description). |
| `minimax/music-2.5` | songs with vocals | official, updated 2026-04-09 | not read | Full-length songs with lyrics (probe listing description). |
| `elevenlabs/music` | music | official | not read | Same model family we already call directly (probe listing). |
| `lucataco/ace-step` | music | community, 2025-05-14 | about $0.022 per run | Open weights (docs). |
| `nightmareai/real-esrgan` | image upscale | community, latest version 2025-10-27 | not read | Our pinned version still resolves (probe). |
| `meta/sam-2` | segmentation | community | not read | Our pinned version is the latest (probe). |
| `lucataco/resemble-enhance` | speech enhance | community | not read | Exists, latest `93266a7e...` (probe). |
| `sczhou/propainter` | video inpaint | **404** | - | Model not found (probe). |
| `facebookresearch/co-tracker` | point tracking | **404** | - | Model not found (probe). |

Official-model prices on Replicate are rendered by JavaScript; only Stable Audio 2.5 was read in a browser.

## API shape

- Base URL `https://api.replicate.com/v1`, header `Authorization: Bearer <token>` (docs).
- Create: `POST /v1/predictions` with `{version, input, webhook?, webhook_events_filter?, stream?}` (docs, OpenAPI).
  `version` may be `owner/name` (official models only), `owner/name:version_id`, or a bare 64-character version ID (docs).
  There is no `model` field on this endpoint; model-scoped creation is `POST /v1/models/{owner}/{name}/predictions` (docs, OpenAPI).
- Async by default: the response has `id` and `status` (`starting`, `processing`, `succeeded`, `failed`, `canceled`); poll `GET /v1/predictions/{id}` and read `output` (docs).
  `Prefer: wait` holds the request up to 60 s and returns the finished prediction when it fits (docs).
- Cancel: `POST /v1/predictions/{id}/cancel` (docs).
- MusicGen input (from the version schema, probe): `prompt`, `duration` (int, default 8, no max in schema), `model_version` (`stereo-melody-large` default, `stereo-large`, `melody-large`, `large`), `output_format` (`wav` default or `mp3`), `input_audio`, `continuation`, `classifier_free_guidance` (default 3), `top_k` (250), `top_p` (0), `temperature` (1), `normalization_strategy`, `multi_band_diffusion`, `seed`.
- Errors: non-2xx with a JSON body; our code reads `detail`, then `error` (not re-verified); a missing model is a 404 (probe).

## Gotchas

- **MusicGen weights are CC-BY-NC 4.0** (code is MIT/Apache) per the model README and `license_url` (docs, probe).
  Music from `-p replicate` is not cleared for commercial use; this matters for any user publishing videos.
- **The pinned MusicGen version is stale.**
  Our hash `7be0f12c...` is a 2023-11-24 version; `GET .../versions/7be0f12c...` returned 200 but the body's `id` was the latest `671ac645...` (2024-03-28) (probe).
  It is unclear whether a prediction with the old hash runs the old or the latest version; this was not tested because it costs money.
- MusicGen is slow and short: realistic use is under 30 s per clip; the model itself has not been updated since March 2024 (probe).
- **Outputs expire.** For API predictions, inputs, outputs, files, and logs are deleted after one hour by default (docs).
  `vibe generate music-status` run more than an hour later will find no audio.
- **`{model: "owner/name"}` is not a valid body for `/v1/predictions`** (docs).
  `restoreAudio` (resemble-enhance) and the co-tracker branch of `trackObject` send it, so those calls fail or run nothing.
  `lucataco/resemble-enhance` is a community model, so it also needs an explicit version.
- `sczhou/propainter` and `facebookresearch/co-tracker` return 404 (probe), so `inpaintVideo` and co-tracker tracking cannot work.
- The style transfer hash `cd0a3bf6b7ee1ff12cfb6e1f16e3c4c1a2dc57b8d8b8c4b7a7e9f8b5c7a9d8e1` looks like a placeholder (repeating pattern) and is used for both styles; not verifiable without a model slug (unverified).
- `upscaleVideo` points at `nightmareai/real-esrgan`, an image model, and the CLI upscale path exits before calling it.
- Our `MusicGenerationOptions.model` is never sent as `model_version`, so every call uses `stereo-melody-large`.
- MusicGen's page quotes an approximate per-run cost that "varies depending on your inputs" (GPU time), while Stable Audio 2.5 is a flat price per output file (docs).

## In our code

- `packages/ai-providers/src/replicate/ReplicateProvider.ts`
  - L122 base URL; all calls use `Authorization: Bearer`.
  - L139-170 `upscaleVideo`, versions at L156-158.
  - L213-262 `inpaintVideo`, ProPainter at L235 (404).
  - L302-346 `getPredictionStatus` (reads `output[0]` into `videoUrl`); L367 wait loop; L398 cancel.
  - L427-470 `generateMusic`: L439 clamps duration 1-30, L443 `output_format: "mp3"`, L470 bare MusicGen version hash; L48 `model` option is unused.
  - L507-530 `getMusicStatus`.
  - L559-597 `restoreAudio` with `model: "lucataco/resemble-enhance"` at L597.
  - L686-737 `styleTransferVideo`, placeholder hash at L716 and L721.
  - L777-833 `trackObject`: L807 co-tracker, L811/L815 SAM 2, L831-833 `model` vs `version` branch.
- `packages/cli/src/commands/generate/music.ts` L83-96 and L242-270: Replicate music path, duration clamp 1-30.
- `packages/cli/src/commands/generate/music-status.ts` L29-33: polls a stored prediction ID.
- `packages/cli/src/commands/edit-cmd.ts` L1057-1068: upscale path that always exits with "Replicate requires a video URL".
- `packages/cli/src/tools/manifest/generate.ts` L146: describes Replicate MusicGen as max 30 s.
- `packages/cli/src/utils/key-live-test.ts` L96: key check via `GET /v1/account`.

## Recommended changes

1. Tell users that `-p replicate` music is non-commercial (CC-BY-NC weights), in the CLI help and the agent tool description.
2. Replace MusicGen with an official model such as `stability-ai/stable-audio-2.5` (flat $0.20 per file, no version pin) or drop Replicate music, since ElevenLabs music already covers the use case.
3. If MusicGen stays, pin `meta/musicgen:671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedcfb` with the slug, and wire `model` to `model_version`.
4. Download music output immediately, or warn in `music-status` that Replicate deletes outputs after an hour.
5. Remove or fix the dead helpers: ProPainter and co-tracker (404), the placeholder style transfer hash, and the `model` field bodies (use `/v1/models/{owner}/{name}/predictions` or a pinned version).
6. Consider `Prefer: wait` for short jobs to save a poll round trip.

## Sources

All opened 2026-10-04.

- https://replicate.com/meta/musicgen (README, license, run cost)
- https://replicate.com/stability-ai/stable-audio-2.5 (pricing, via browser)
- https://replicate.com/lucataco/ace-step
- https://api.replicate.com/openapi.json (`POST /predictions` schema)
- https://replicate.com/docs/topics/predictions/create-a-prediction
- https://replicate.com/docs/topics/predictions/data-retention
- `GET /v1/models/...`, `/versions/...`, `/v1/collections/ai-music-generation` (probe, free)
