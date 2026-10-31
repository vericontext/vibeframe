---
provider: elevenlabs
checked: 2026-10-31
env: [ELEVENLABS_API_KEY]
models_endpoint: none
models_in_use:
  - eleven_v3                   # TTS default
  - music_v2_5                  # music
  - scribe_v2                   # transcription, `--stt auto` first choice
models_recommended: []          # eleven_v4 is documented for Text to Dialogue; probe /text-to-speech before switching
---

# ElevenLabs

VibeFrame uses ElevenLabs for narration TTS, sound effects, music, voice isolation, instant voice cloning, and Scribe transcription.
It is the first choice of `--tts auto` and `--stt auto` whenever `ELEVENLABS_API_KEY` is set, and the default provider of `vibe generate music`.

## Models

`GET /v1/models` is free and lists TTS and speech-to-speech models only (probe).
Sound effect, music, and Scribe models are not in that listing.

| ID | Kind | Status | Price (API, per unit) | Notes |
|---|---|---|---|---|
| `eleven_v4` | TTS | GA 2026-09-28 | $0.08 / 1K chars, $0.022 promo until Oct 12 | 90+ languages, 10,000 chars per request; no Style or Speed setting, no SSML (docs). Listed with `can_do_text_to_speech: true` (probe). |
| `eleven_v4_turbo` | TTS realtime | GA 2026-09-28 | $0.04 / 1K chars, $0.011 promo | Docs point it at the Text to Dialogue WebSocket (docs). |
| `eleven_v3` | TTS | GA, now "previous generation" | $0.08 / 1K chars | **Our default.** 70+ languages, 5,000 char limit (docs, probe). |
| `eleven_v3_conversational` | TTS realtime | GA | 0.5x credit multiplier (probe) | About 280 ms latency (docs). |
| `eleven_multilingual_v2` | TTS | GA | $0.08 / 1K chars | 29 languages, 10,000 chars, most stable on long form; API default `model_id` for `/v1/text-to-speech` (docs). |
| `eleven_flash_v2_5` | TTS | GA | $0.04 / 1K chars | 32 languages, 40,000 chars; numbers not normalized by default (docs). |
| `eleven_turbo_v2_5`, `eleven_turbo_v2` | TTS | deprecated, no shutdown date given | 0.5x multiplier | Docs say use Flash instead (docs); still listed (probe). |
| `eleven_monolingual_v1`, `eleven_multilingual_v1` | TTS | removed 2026-07-09 | - | Absent from `/v1/models` (docs, probe). |
| `eleven_text_to_sound_v2` | SFX | GA | $0.12 / minute | The only allowed `model_id` and the default on `/v1/sound-generation` (docs). |
| `music_v2_5` | music | GA in API 2026-09-14 | $0.15 / minute | Highest quality; composition plans, inpainting (docs). |
| `music_v2` | music | GA in API 2026-06-15 | $0.15 / minute | Uses a different composition plan schema from v1 (docs). |
| `music_v1` | music | GA, "outclassed" | $0.15 / minute | **Our model**, and still the API default `model_id` (docs). |
| `scribe_v2` | STT | GA | $0.22 / hour | **In use** (`--stt`). 90+ languages, word-level timestamps (`timestamps_granularity: word`), diarization up to 32 speakers, keyterms (docs). |
| `scribe_v2_realtime` | STT realtime | GA | $0.39 / hour | WebSocket, about 150 ms latency (docs); not used. |
| `scribe_v1` | STT | removed 2026-07-09 | - | Migrate to `scribe_v2` (docs). |

Pricing is the pay-as-you-go API page; subscription plans convert to credits differently (docs).

## API shape

- Base URL `https://api.elevenlabs.io/v1`; regional hosts `api.us`, `api.eu.residency`, `api.in.residency`, `api.sg.residency` exist (docs).
- Auth header `xi-api-key: <key>` (docs, probe).
- All the endpoints we use are synchronous and return audio bytes (`audio/mpeg` by default); TTS also has streaming and WebSocket variants (docs).
- TTS: `POST /v1/text-to-speech/{voice_id}` with `text`, `model_id`, `voice_settings {stability, similarity_boost, style, use_speaker_boost, speed}`, optional `language_code`, `seed`, `previous_text`/`next_text`, `apply_text_normalization`; `output_format` is a query parameter (docs).
- Dialogue: `POST /v1/text-to-dialogue` with `inputs: [{text, voice_id}]` (at most 10 unique voices), `model_id` defaulting to `eleven_v3`, and `settings` (docs).
- SFX: `POST /v1/sound-generation` with `text`, `duration_seconds` (0.5-30, null lets the model choose), `prompt_influence` (0-1, default 0.3), `loop` (v2 only), `model_id` (docs).
- Music: `POST /v1/music` with `prompt` or `composition_plan` (not both), `music_length_ms` (3,000-600,000), `model_id`, `force_instrumental`, `seed`; `output_format` defaults to `auto`, which is mp3 44.1 kHz/128 kbps for v1 and 48 kHz/192 kbps for v2 models (docs).
- Instant voice clone: `POST /v1/voices/add`, multipart `name`, `files[]`, optional `description`, `labels`, `remove_background_noise`; returns `voice_id` (docs).
- STT: `POST /v1/speech-to-text`, multipart (docs):
  - `model_id` (required), and exactly one of `file`, `source_url` (HTTPS, YouTube/TikTok allowed, under 2 GB), or the deprecated `cloud_storage_url`.
  - Optional: `language_code` (ISO-639-1 or -3; auto-detected when omitted), `timestamps_granularity` (`none`, `word`, `character`), `tag_audio_events` (bool), `diarize` (bool), `num_speakers` (1-32), `diarization_threshold`, `keyterms` (up to 1,000, +20% cost), `file_format` (`pcm_s16le_16` or `other`), `use_multi_channel` (up to 5 channels, each billed in full), `no_verbatim` (scribe_v2 only, drops fillers and false starts), `temperature`, `seed`, `webhook`, `entity_detection`/`entity_redaction`, `transcript_edit` (+30%), `detect_speaker_roles` (+10%).
  - Synchronous 200 body: `{language_code, language_probability, text, words[], transcription_id, audio_duration_secs}`; each `words[]` entry is `{text, type: word|spacing|audio_event, start, end, speaker_id, logprob, characters?}`, with `start`/`end` in seconds and nullable.
  - Multichannel returns `{transcripts: [...]}`; `webhook: true` returns 202 instead of a transcript.
  - Limits: upload under 5.0 GB in the API reference, 3 GB in the capability overview; at least 100 ms of audio; up to 10 hours. Billed by audio duration (docs).
- Errors: JSON body; validation failures are 422 with `detail[]` of `{loc, msg, type}` (docs).
  Concurrency overflow returns 429 `too_many_concurrent_requests` (our code comment, not re-verified).

## Gotchas

- **Eleven v4 is documented for Text to Dialogue, not Text to Speech.**
  The models page and the 2026-09-28 changelog say to use `eleven_v4` through the Text to Dialogue API and `eleven_v4_turbo` through the Dialogue WebSocket (docs).
  `/v1/models` still marks both as `can_do_text_to_speech: true` (probe), and the TTS reference accepts any such model, so `/v1/text-to-speech` with `eleven_v4` probably works, but this was not called (unverified, would spend credits).
- **v4 drops Style and Speed** (docs); we always send `style` (default 0) and may send `speed`, which may be ignored or rejected on v4.
- **`speed` belongs inside `voice_settings`.**
  We send it at the top level of the TTS body, where the reference does not define it, so the `--speed` passed through `tts-resolve` is likely ignored (docs; behavior not probed).
- v4 deliberately renders a cloned voice without its native accent when generating another language (docs); this matters for dubbing.
- `eleven_v3` caps a request at 5,000 characters; `eleven_v4` and `eleven_multilingual_v2` at 10,000; Flash v2.5 at 40,000 (docs, probe).
- SFX max is 30 s, but we clamp to 22 s and the CLI help still says 0.5-22 (docs vs code).
- `music_v1` is still the API default, so omitting `model_id` does not upgrade you (docs).
  The API allows 10 minutes of music while the pricing page advertises a 5 minute limit; trust the API reference but expect product limits to vary (docs).
- `music_v2`/`v2_5` composition plans use a different schema from v1, and `respect_sections_durations` is ignored on v2 models (docs).
- MP3 at 192 kbps needs Creator tier or above; PCM/WAV at 44.1 kHz needs Pro (docs).
- Flash v2.5 does not normalize numbers by default; Multilingual v2 does better on phone numbers and dates (docs).
- `GET /v1/usage/character-stats` is deprecated in favor of the workspace analytics endpoint (docs); we do not call it.
- **Probe 2026-10-31 (live, under $0.001):** `vibe audio transcribe speech.wav -p elevenlabs` on 4 s of macOS `say` speech ("Um, so the paper boat drifts. It floats away, okay?") returned `language_code: "eng"` and word timings that became three SRT cues ("Um, so the paper boat drifts." / "It floats away." / "Okay?"): Scribe itself ends a sentence at "away". Words keep their punctuation (`"Um,"`), and `edit jump-cut --analyze-only --stt elevenlabs` found the fillers `Um,`, `so`, and `Okay?`.
- **Scribe sends no segments.** `words[]` is one flat token list; we build caption segments from it (sentence punctuation, pauses of 0.8 s, speaker changes, 6 s soft / 12 s hard length).
  Word tokens keep their punctuation (`"Um,"`, `"drifts."`), unlike Whisper's words; jump-cut strips punctuation before matching fillers.
- `tag_audio_events` is on unless sent as `false`, which would put `(laughter)` tokens into transcripts; we send `false` and also skip `audio_event` tokens.
- `language_code` in the reply is ISO-639-3 (`eng`), while Whisper reports a language name (`english`); the hint we send may be ISO-639-1.
- `no_verbatim` would drop the filler words `edit jump-cut` looks for; we never send it.
- The two size limits in the docs disagree (5.0 GB reference, 3 GB overview); we refuse over 3 GB before uploading.
- ElevenLabs reports exhausted credits as 401 with `detail.status: quota_exceeded`; the message ("exceeds your quota") classifies it as `quota`, not `auth` (our code; not probed live).

## In our code

- `packages/ai-providers/src/elevenlabs/ElevenLabsProvider.ts`
  - L103 doc comment still names `eleven_monolingual_v1` (removed) and `eleven_multilingual_v2`.
  - L213 base URL; L229-235 `GET /voices`.
  - `speak` (behind the `synthesize` speech contract): L277 default `eleven_v3`, L290 `xi-api-key`, L296 `model_id`, L297-302 `voice_settings`, L303 top-level `speed`; L198-199 one retry on 429.
  - L343-351 `GET /user/subscription`.
  - L378-405 `generateSoundEffect`: no `model_id`, L397-399 clamps `duration_seconds` to 0.5-22.
  - L438-472 `generateMusic`: L452 hardcodes `model_id: "music_v1"`, L456-458 clamps to 3-600 s.
  - L506-522 `isolateVocals` (`/audio-isolation`); L558-605 `cloneVoice` (`/voices/add`); L638 `deleteVoice`.
- `packages/cli/src/commands/_shared/tts-resolve.ts` L82-93 auto order ElevenLabs, then OpenAI, then Kokoro; L101-113 passes `voiceId` and `speed`, never a model.
- `packages/cli/src/commands/generate/speech.ts` L41-45 default voice `21m00Tcm4TlvDq8ikWAM`.
- `packages/cli/src/commands/generate/music.ts` L57-73 and L199-205: ElevenLabs is the default music provider, duration default 8 s.
- `packages/cli/src/commands/generate/sound-effect.ts` L82 help text "0.5-22".
- `packages/cli/src/commands/audio.ts` L165, L241, L353, L605 and `packages/cli/src/commands/ai-audio.ts` L117-304: voices, isolation, clone, dub.
- `packages/cli/src/utils/key-live-test.ts` L90 key check via `GET /v1/user`.
- `packages/ai-providers/src/elevenlabs/ScribeTranscriber.ts`: `ScribeTranscriber` behind the transcription contract; `model_id` from the catalog (`scribe_v2`), always `timestamps_granularity=word` and `tag_audio_events=false`, `language_code` when a hint is given, `xi-api-key` header, 30 minute timeout; `scribeSegments` / `scribeWords` map tokens to the contract.
- `packages/cli/src/commands/_shared/transcription.ts`: `--stt auto|elevenlabs|openai` (`-p` on `audio transcribe`); `auto` follows `getProvidersFor("transcription")` (ElevenLabs priority 1, OpenAI 2).
- Cost metering (code): TTS records the characters sent; music records the requested `music_length_ms`; sound effects record `duration_seconds`, or the returned MP3's length at its frame bitrate (marked estimated) when the model picks the length; Scribe records `audio_duration_secs`, which is what it bills. Audio isolation is recorded, but this file lists no price for it (not checked on the pricing page), so the catalog cannot price it and it reports the tier upper bound with `costEstimated: true`. Instant voice cloning records nothing and reports 0: this file lists no per-call price for it either; check the pricing page before relying on that.

## Recommended changes

1. Move `speed` into `voice_settings`, and drop `style`/`speed` when the model is `eleven_v4*`.
2. Decide on v4: either probe `/v1/text-to-speech` with `eleven_v4` once (small credit cost, needs approval) and switch the default, or add a Text to Dialogue path for v4.
3. Make the TTS model configurable from the CLI and the TTS resolver instead of always using the provider default.
4. Raise the SFX clamp and help text to 30 s, and pass `model_id: "eleven_text_to_sound_v2"` explicitly.
5. Switch music to `music_v2_5` (or make it selectable) and send `model_id` explicitly; check the `output_format` change if anything depends on 44.1 kHz.
6. Remove `eleven_monolingual_v1` from the L103 comment.
7. Consider sending `diarize: true` for multi-speaker sources (dubbing, highlights); segments already split on `speaker_id` when present.
8. Large sources could use `source_url` instead of uploading; we always upload the extracted audio today.

## Sources

Opened 2026-10-04, except where marked 2026-10-28.

- https://elevenlabs.io/docs/overview/models.md
- https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4.md
- https://elevenlabs.io/docs/changelog/llms.txt and entries 2026/6/8, 2026/6/15, 2026/9/14, 2026/9/28
- https://elevenlabs.io/docs/api-reference/text-to-speech/convert.md
- https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert.md
- https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert.md
- https://elevenlabs.io/docs/api-reference/music/compose.md
- https://elevenlabs.io/docs/api-reference/speech-to-text/convert.md (2026-10-28)
- https://elevenlabs.io/docs/overview/capabilities/speech-to-text.md (2026-10-28)
- https://elevenlabs.io/docs/api-reference/voices/ivc/create.md
- https://elevenlabs.io/pricing/api (2026-10-28: Scribe v2 $0.22 / hour, Scribe v2 Realtime $0.39 / hour)
- `GET https://api.elevenlabs.io/v1/models` (probe)
