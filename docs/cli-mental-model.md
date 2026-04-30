# vibe CLI mental model

The CLI groups every command into one of six top-level verbs. Most operations
fit cleanly into exactly one — but a handful of boundary cases exist where
two paths can do the same thing. This document is the single source of truth
for the boundaries, plus the catalog of every subcommand as of v0.82.

> **Single principle**: the verb tells you the *intent*; the subcommand tells you the *thing*. If you ever feel torn between two verbs, the audit below probably already documented why.

## Boundary statements

| Verb | Mission | Anti-mission |
|---|---|---|
| **`generate`** | 0 → 1 new media (text → image / video / audio / motion). | Anything that takes existing media as the primary input. |
| **`edit`** | Deterministic post-processing of existing media (FFmpeg-driven; AI is optional or a planning aid). | Calling AI to *create* something new. |
| **`remix`** | AI-driven *transformation* of existing media (highlights, regenerate, animated caption). | Cheap deterministic ops; one-shot generation. |
| **`inspect`** | Read-only AI understanding (Q&A, summarization, suggestions). | Anything that writes back to the file system or calls a generation endpoint. |
| **`audio`** | Audio-specialist ops where the input is sound (transcribe / TTS preview / voice clone / duck). | Editing video tracks holistically (use `edit`). |
| **`detect`** | Deterministic feature detection (scenes / silence / beats). FFmpeg only, free. | Anything that needs an LLM to "understand" — that's `inspect`. |

Cost tiers signal the AI exposure: **free** = FFmpeg only, **low** = Whisper / single LLM call (≈$0.01–$0.10), **high** = image gen or multimodal LLM (≈$1–$5), **very-high** = video gen or whole-pipeline orchestration (≈$5–$50+).

## Catalog (v0.82)

### `vibe generate` — 0 → 1 new media (Gemini / OpenAI / Grok / Seedance / ElevenLabs / Claude / …)

| Subcommand | Description | Tier |
|---|---|---|
| `image` | Generate image (Gemini, OpenAI, Grok, Runway) | high |
| `video` | Generate video (Seedance, Grok, Kling, Runway, Veo) | very-high |
| `speech` | Text-to-speech (ElevenLabs) | low |
| `sound-effect` | Sound effects (ElevenLabs) | low |
| `music` | Music generation (ElevenLabs default, Replicate MusicGen) | low |
| `music-status` | Check music generation status | free |
| `storyboard` | Script → storyboard (Claude) | high |
| `motion` | Motion graphics (Claude + Remotion) | high |
| `thumbnail` | Thumbnail extraction / generation | free–low |
| `background` | AI background generation (OpenAI) | high |
| `video-status` | Async video job status | free |
| `video-cancel` | Cancel video generation | free |
| `video-extend` | Extend an existing video (Kling/Veo) | very-high |

### `vibe edit` — deterministic post-processing (FFmpeg-driven)

| Subcommand | Description | Tier |
|---|---|---|
| `silence-cut` | Remove silent segments (FFmpeg default; `--use-gemini` for smart detection) | free–low |
| `caption` | Burn static styled captions (Whisper + FFmpeg) | low |
| `noise-reduce` | Background noise removal (FFmpeg `afftdn`) | free |
| `fade` | Fade in/out (FFmpeg) | free |
| `translate-srt` | Translate SRT subtitles (Claude / OpenAI) | low |
| `jump-cut` | Remove filler words (Whisper word-level) | low |
| `grade` | AI-generated color grade (Claude + FFmpeg; presets are free) | low |
| `text-overlay` | Burn text overlay (FFmpeg `drawtext`) | free |
| `speed-ramp` | Content-aware speed ramping (Whisper + Claude + FFmpeg) | low |
| `reframe` | Auto-reframe to a new aspect ratio (Claude Vision + FFmpeg) | high |
| `image` | Edit image with AI as context (Gemini / OpenAI / Grok) | high |
| `interpolate` | Frame interpolation (FFmpeg) | free |
| `upscale` | Upscale resolution (FFmpeg or AI) | free–high |
| `fill-gaps` | Fill timeline gaps with AI video (Kling i2v) | very-high |

### `vibe inspect` — read-only AI understanding

| Subcommand | Description | Tier |
|---|---|---|
| `media` | Q&A or summarize images / videos / YouTube URLs (Gemini) | low |
| `video` | Same on video specifically | low |
| `review` | Review video quality (Gemini), optionally auto-fix | low |
| `suggest` | AI edit suggestions (Gemini) | low |

### `vibe audio` — audio-specialist ops

| Subcommand | Description | Tier |
|---|---|---|
| `transcribe` | Whisper transcription | low |
| `list-voices` | List available ElevenLabs voices | low |
| `isolate` | Isolate vocals (ElevenLabs) | low |
| `clone-voice` | Clone a voice from samples (ElevenLabs) | low |
| `dub` | Dub to another language (transcribe → translate → TTS) | high |
| `duck` | Auto-duck music under voice (FFmpeg) | free |

### `vibe remix` — AI transformation of existing media

| Subcommand | Description | Tier |
|---|---|---|
| `regenerate-scene` | Regenerate one scene of a storyboard project | very-high |
| `highlights` | Extract highlights from long-form content (Whisper + Claude *or* Gemini) | high |
| `auto-shorts` | Auto-cut shorts from long-form video | high |
| `animated-caption` | Word-by-word animated captions (Whisper + Remotion / ASS) | low |

### `vibe detect` — deterministic feature detection (free)

| Subcommand | Description | Tier |
|---|---|---|
| `scenes` | Scene-change detection (FFmpeg) | free |
| `silence` | Silence detection (FFmpeg `silencedetect`) | free |
| `beats` | Beat detection for music sync | free |

## Known boundary cases

The audit at `docs/cli-mental-model.md`'s git history surfaced these. They're **intentional** today — moving them is on the table for a future major (1.0) but not v0.x.

1. **`edit caption` vs `remix animated-caption`** — Both transcribe with Whisper and add captions, but the former *burns static styled* captions into video (deterministic post-processing) while the latter *animates word-by-word* (AI-augmented motion). Different intents → different verbs.

2. **`edit silence-cut --analyze-only` vs `detect silence`** — `silence-cut` detects silence as a means to its end (cutting); `detect silence` exposes detection as the product. The `--analyze-only` flag on `silence-cut` shadow-implements `detect silence` — prefer `vibe detect silence` for read-only checks.

3. **`remix highlights` vs `inspect video`** — Both can read a long video and reason about it. `inspect` answers an ad-hoc question (Q&A); `remix highlights` produces a clip set as output. Different output shapes → different verbs.

4. **`edit image` is mostly generative** — Despite the verb, this calls Gemini / OpenAI / Grok image-edit endpoints. Naming reflects "edit *this* image" (input is required) rather than "post-process". Future major may relocate to `generate image --from <existing>`.

5. **`generate regenerate-scene` doesn't exist; it's under `remix`** — The semantic is "regenerate" (transform an existing scene) rather than "generate" (create new). Consistent with the remix verb's mission of AI transformation of existing media.

6. **`--use-gemini` proliferation** — `edit silence-cut`, `remix highlights`, `remix auto-shorts` each have a `--use-gemini` flag (toggle Whisper+Claude → Gemini multimodal). Per-subcommand by design — provider choice has different cost / latency / quality trade-offs per task. A global flag would hide that.

7. **Cost-tier signaling** — `--help` shows tier in `vibe --help`'s "Cost tiers" footer but not in individual subcommand `--help`. Tracked as a future polish item; for now `vibe --help` is the canonical reference.

8. **Untiered utility commands** — `setup`, `doctor`, `init`, `build`, `render`, `agent`, `run`, `demo`, `walkthrough`, `context` carry no cost tier. They're orchestrators or meta-info, not media producers — `build` and `run` orchestrate other tagged commands (their cost depends on what's inside the storyboard / pipeline), and the rest are setup / inspection. `vibe schema --list --filter free` excludes them by design; `vibe schema --list` (no filter) shows them. The doctor's "Cost-tagged: N" line counts only commands that opted in via `applyTier()`.

## When in doubt

- **"I want to make a thing from text"** → `generate`
- **"I want to clean up / tweak this video"** (no AI required) → `edit`
- **"I want AI to remix my existing video"** → `remix`
- **"I want to ask AI about this media"** → `inspect`
- **"I'm working with audio specifically"** → `audio`
- **"I want a feature list (scenes / beats / silences)"** → `detect`

If two verbs both seem to apply, see "Known boundary cases" above — the answer is probably documented.

## Removed legacy aliases (history)

- `analyze` / `az` → `inspect` (removed in v0.74 / v0.80)
- `pipeline` / `pipe` → `remix` (removed in v0.74)
- `voices` → `audio list-voices` (removed)
- `voice-clone` → `audio clone-voice` (removed)
- `project` → `timeline` (renamed in v0.79.x; alias still works as deprecated)
