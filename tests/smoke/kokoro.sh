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
  step "Rendering to MP4 (requires Chrome)"
  $VIBE scene render --project "$SMOKE_DIR/promo" \
    --out "$SMOKE_DIR/promo/renders/smoke.mp4" \
    --quality draft --fps 24 --json >/dev/null
  if [ -s "$SMOKE_DIR/promo/renders/smoke.mp4" ]; then
    green "✓ Render produced MP4 ($(stat -f%z "$SMOKE_DIR/promo/renders/smoke.mp4" 2>/dev/null || stat -c%s "$SMOKE_DIR/promo/renders/smoke.mp4") bytes)"
  else
    red "Render did not produce a non-empty MP4"
    exit 1
  fi
fi

green "All smoke assertions passed."
