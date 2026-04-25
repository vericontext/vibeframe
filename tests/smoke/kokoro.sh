#!/usr/bin/env bash
#
# v0.54 smoke test — exercises the full local-TTS + word-sync pipeline
# end-to-end against a real Kokoro model and a real Whisper API. Lives
# outside CI because:
#
#   1. The first run downloads ~330MB to ~/.cache/huggingface/hub.
#   2. Whisper transcribe needs OPENAI_API_KEY (~$0.001/scene).
#
# Run manually after a v0.54.x release:
#
#   bash tests/smoke/kokoro.sh
#
# The script:
#   1. Builds the CLI.
#   2. Scaffolds a throwaway scene project under /tmp.
#   3. Adds a scene with --tts kokoro --no-image and asserts the
#      narration .wav and (if OPENAI_API_KEY set) transcript .json land.
#   4. Runs `vibe scene lint --json` and asserts ok=true.
#   5. Optionally renders to MP4 if Chrome is available.
#
# Exits non-zero on the first failed assertion.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
VIBE="node $ROOT_DIR/packages/cli/dist/index.js"
TMPDIR="${TMPDIR:-/tmp}"
SMOKE_DIR="$(mktemp -d "$TMPDIR/vibe-smoke-kokoro-XXXXXX")"
trap 'rm -rf "$SMOKE_DIR"' EXIT

# Load .env from repo root so OPENAI_API_KEY / ELEVENLABS_API_KEY visible
# to the shell. The CLI itself loads .env via dotenv, but our shell
# conditionals (`if [ -n "$OPENAI_API_KEY" ]`) need it pre-exported.
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*" >&2; }
step()  { printf "\033[36m▶ %s\033[0m\n" "$*"; }

step "Building CLI"
( cd "$ROOT_DIR" && pnpm -F @vibeframe/cli build >/dev/null )

step "Scaffolding scene project at $SMOKE_DIR"
$VIBE scene init "$SMOKE_DIR/promo" -r 16:9 -d 6 --json >/dev/null

step "Adding narrated scene via Kokoro (first call may download ~330MB)"
SCENE_RESULT="$($VIBE scene add hook \
  --project "$SMOKE_DIR/promo" \
  --style simple \
  --narration "Ship videos, not clicks." \
  --tts kokoro \
  --duration 4 \
  --no-image \
  --json)"

NARRATION_PATH="$(echo "$SCENE_RESULT" | python3 -c "import sys,json;print(json.load(sys.stdin).get('audioPath',''))")"
TRANSCRIPT_PATH="$(echo "$SCENE_RESULT" | python3 -c "import sys,json;print(json.load(sys.stdin).get('transcriptPath',''))")"

if [ -z "$NARRATION_PATH" ] || [ ! -f "$NARRATION_PATH" ]; then
  red "Expected narration .wav file but found: $NARRATION_PATH"
  exit 1
fi
green "✓ Narration audio at $NARRATION_PATH ($(stat -f%z "$NARRATION_PATH" 2>/dev/null || stat -c%s "$NARRATION_PATH") bytes)"

if [ -n "${OPENAI_API_KEY:-}" ]; then
  if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
    red "OPENAI_API_KEY set but transcript not produced: $TRANSCRIPT_PATH"
    exit 1
  fi
  WORDS="$(python3 -c "import json;print(len(json.load(open('$TRANSCRIPT_PATH'))))")"
  green "✓ Whisper transcript at $TRANSCRIPT_PATH ($WORDS word entries)"

  SCENE_HTML="$SMOKE_DIR/promo/compositions/scene-hook.html"
  if ! grep -q 'class="word"' "$SCENE_HTML"; then
    red "Scene HTML did not include word-sync spans — emitSceneHtml lost the transcript"
    exit 1
  fi
  green "✓ Scene HTML contains <span class=\"word\"> entries"
else
  green "○ OPENAI_API_KEY not set — skipping transcript + word-sync assertions"
fi

step "Running scene lint (in-process Hyperframes)"
LINT="$($VIBE scene lint --project "$SMOKE_DIR/promo" --json)"
LINT_OK="$(echo "$LINT" | python3 -c "import sys,json;print(json.load(sys.stdin)['ok'])")"
if [ "$LINT_OK" != "True" ]; then
  red "Lint reported ok=false:"
  echo "$LINT"
  exit 1
fi
green "✓ Lint clean"

if [ "${SMOKE_RENDER:-0}" = "1" ]; then
  step "Rendering to MP4 (requires Chrome + ffmpeg)"
  # Producer (`@hyperframes/producer`) writes [WARN]/[INFO] lines to stdout
  # alongside our --json output. Strip everything before the first `{` so
  # python json.loads sees only the result envelope.
  RENDER_RESULT="$($VIBE scene render --project "$SMOKE_DIR/promo" \
    --out "$SMOKE_DIR/promo/renders/smoke.mp4" \
    --quality draft --fps 24 --json | awk '/^\{/{found=1} found')"
  MP4="$SMOKE_DIR/promo/renders/smoke.mp4"
  if [ ! -s "$MP4" ]; then
    red "Render did not produce a non-empty MP4"
    exit 1
  fi
  AUDIO_MUX="$(echo "$RENDER_RESULT" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('audioMuxApplied',False))")"
  green "✓ Render produced MP4 ($(stat -f%z "$MP4" 2>/dev/null || stat -c%s "$MP4") bytes)"

  # v0.55+: verify the post-producer ffmpeg mux pass actually embedded audio.
  # Catches regressions where the producer skips audio capture and our mux
  # also falls through (e.g. ffmpeg missing, filter graph bug).
  if [ "$AUDIO_MUX" = "True" ]; then
    AUDIO_STREAM_COUNT="$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$MP4" | wc -l | tr -d ' ')"
    if [ "$AUDIO_STREAM_COUNT" -lt "1" ]; then
      red "audioMuxApplied=true but rendered MP4 has no audio stream — mux pass regressed"
      exit 1
    fi
    AUDIO_DURATION="$(ffprobe -v error -select_streams a:0 -show_entries stream=duration -of csv=p=0 "$MP4")"
    green "✓ MP4 has $AUDIO_STREAM_COUNT audio stream(s), narration ${AUDIO_DURATION}s"
  else
    red "audioMuxApplied was not true. JSON: $RENDER_RESULT"
    exit 1
  fi
fi

green "All smoke assertions passed."
