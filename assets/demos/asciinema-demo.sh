#!/usr/bin/env bash
# Drives the asciinema recording at assets/demos/vibeframe-quickstart.cast.
# The recording shows the v0.55 quickstart: install → init → add narrated
# scene → render → MP4 with synced audio + captions, in under 90 seconds.
#
# Run (from repo root):
#   asciinema rec assets/demos/vibeframe-quickstart.cast \
#     --idle-time-limit=2 \
#     --title="VibeFrame v0.55 quickstart" \
#     --command="bash $(pwd)/assets/demos/asciinema-demo.sh" \
#     --overwrite
#
# Conversion to SVG (animated, embeddable in README) — svg-term-cli only
# accepts asciicast v1/v2, so first downgrade with `asciinema convert`:
#   asciinema convert -f asciicast-v2 \
#     assets/demos/vibeframe-quickstart.cast /tmp/quickstart-v2.cast
#   svg-term --in /tmp/quickstart-v2.cast \
#            --out assets/demos/vibeframe-quickstart.svg \
#            --window --width 100 --height 30
#
# Pre-warm Kokoro before recording so the narration step doesn't pause for
# the ~330MB first-run model download:
#   vibe scene init /tmp/warm -d 4 --json >/dev/null
#   vibe scene add x --project /tmp/warm --narration "warm." --tts kokoro \
#     --no-transcribe --no-image --json >/dev/null
#
# The script types each command character-by-character so playback feels
# like a real terminal session, then pauses briefly before executing.

set -e

# Force text-mode CLI output even when stdout isn't a TTY (asciinema's
# headless capture, piped runs, CI). The CLI's preAction hook flips
# itself to --json when stdout is not a TTY unless this env is set.
export VIBE_HUMAN_OUTPUT=1
export FORCE_COLOR=1

# ANSI helpers — keep colour output minimal so the SVG stays readable.
GREEN=$'\033[1;32m'
DIM=$'\033[2m'
CYAN=$'\033[1;36m'
RESET=$'\033[0m'

PROMPT="${GREEN}❯${RESET} "
TYPE_DELAY="${TYPE_DELAY:-0.025}"   # per-keystroke pause
PAUSE_AFTER="${PAUSE_AFTER:-0.6}"   # pause before running each command
PAUSE_OUTPUT="${PAUSE_OUTPUT:-1.0}" # pause to read output

type_line() {
  local line="$1"
  printf "%s" "$PROMPT"
  for (( i=0; i<${#line}; i++ )); do
    printf "%s" "${line:$i:1}"
    sleep "$TYPE_DELAY"
  done
  printf "\n"
  sleep "$PAUSE_AFTER"
}

note() {
  printf "%s# %s%s\n" "$DIM" "$1" "$RESET"
  sleep 0.5
}

# Move into a fresh project root for the recording. Caller has already
# warmed the Kokoro model so the `vibe scene add` step doesn't pause for
# the ~330 MB download.
cd "$(mktemp -d /tmp/vibe-demo-XXXXXX)"

note "VibeFrame v0.55 — script to narrated MP4 in 60 seconds."
sleep 1
type_line "vibe --version"
vibe --version
sleep "$PAUSE_OUTPUT"

note "Scaffold a 12-second 16:9 scene project."
type_line "vibe scene init my-promo -r 16:9 -d 12"
vibe scene init my-promo -r 16:9 -d 12
sleep "$PAUSE_OUTPUT"

note "Drop in a headline scene — no API keys, no network."
type_line 'vibe scene add intro --project my-promo --style announcement \\'
type_line '  --headline "Ship videos, not clicks." \\'
type_line '  --duration 4 --no-audio --no-image'
vibe scene add intro --project my-promo --style announcement \
  --headline "Ship videos, not clicks." \
  --duration 4 --no-audio --no-image
sleep "$PAUSE_OUTPUT"

note "Add a narrated scene — Kokoro local TTS, free + offline."
note "Whisper transcribes word-level so captions sync to the audio."
type_line 'vibe scene add core --project my-promo --style explainer \\'
type_line '  --kicker "WHY VIBEFRAME" --headline "Edit text, not pixels." \\'
type_line '  --narration "Each word lights up the moment it is spoken." \\'
type_line '  --tts kokoro --duration 6 --no-image'
vibe scene add core --project my-promo --style explainer \
  --kicker "WHY VIBEFRAME" --headline "Edit text, not pixels." \
  --narration "Each word lights up the moment it is spoken." \
  --tts kokoro --duration 6 --no-image
sleep "$PAUSE_OUTPUT"

note "Lint the project — same in-process checks Hyperframes runs."
type_line "vibe scene lint --project my-promo"
vibe scene lint --project my-promo
sleep "$PAUSE_OUTPUT"

note "Render — Chrome captures frames, ffmpeg muxes the audio."
type_line "vibe scene render --project my-promo --quality draft -o promo.mp4"
vibe scene render --project my-promo --quality draft -o promo.mp4 2>&1 | grep -vE "^\[Compiler\]|^\[INFO\]|^\[WARN\]"
sleep "$PAUSE_OUTPUT"

note "Both streams in the MP4 — v0.55 audio-mux pass at work."
type_line "ffprobe -v error -show_streams my-promo/promo.mp4 | grep codec_"
ffprobe -v error -show_streams my-promo/promo.mp4 | grep "codec_type\|codec_name" | head -4
sleep 1.5

printf "\n${CYAN}❯${RESET} ${DIM}# Edit a scene HTML, re-render — done. No re-prompting an LLM.${RESET}\n"
sleep 2.5
