#!/usr/bin/env bash
# Drives the asciinema recording at assets/demos/vibeframe-quickstart.cast.
# 90-ish-second walkthrough of v0.55: install → init → add narrated scene
# (free local Kokoro TTS) → render to MP4 with synced audio.
#
# Run (from repo root):
#   asciinema rec assets/demos/vibeframe-quickstart.cast \
#     --idle-time-limit=2 \
#     --title="VibeFrame v0.55 quickstart" \
#     --command="bash $(pwd)/assets/demos/asciinema-demo.sh" \
#     --overwrite
#
# Conversion to SVG (animated, embeddable in README) — svg-term-cli only
# accepts asciicast v1/v2, so first downgrade:
#   asciinema convert -f asciicast-v2 \
#     assets/demos/vibeframe-quickstart.cast /tmp/quickstart-v2.cast
#   svg-term --in /tmp/quickstart-v2.cast \
#            --out assets/demos/vibeframe-quickstart.svg \
#            --window --width 100 --height 30
#
# Pre-warm Kokoro before recording so the narration step doesn't pause for
# the ~330 MB first-run model download:
#   vibe scene init /tmp/warm -d 4 --json >/dev/null
#   vibe scene add x --project /tmp/warm --narration "warm." --tts kokoro \
#     --no-transcribe --no-image --json >/dev/null

set -e

# Force text-mode CLI output even when stdout isn't a TTY (asciinema's
# headless capture, piped runs, CI). The CLI's preAction hook flips
# itself to --json when stdout is not a TTY unless this env is set.
export VIBE_HUMAN_OUTPUT=1
export FORCE_COLOR=1

# ANSI helpers — kept minimal so the SVG stays readable.
GREEN=$'\033[1;32m'
DIM=$'\033[2m'
CYAN=$'\033[1;36m'
YELLOW=$'\033[1;33m'
WHITE=$'\033[1;37m'
RESET=$'\033[0m'

PROMPT="${GREEN}❯${RESET} "
TYPE_DELAY="${TYPE_DELAY:-0.04}"     # per-keystroke pause — readable typing
PAUSE_AFTER="${PAUSE_AFTER:-0.7}"    # pause before running each command
PAUSE_OUTPUT="${PAUSE_OUTPUT:-1.6}"  # pause to read output
PAUSE_HEADER="${PAUSE_HEADER:-0.8}"  # pause after each section header

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

# Section header — short, all-caps, bright cyan. Slows the eye between
# discrete steps so the viewer notices the transition.
header() {
  printf "\n${CYAN}── %s ──${RESET}\n" "$1"
  sleep "$PAUSE_HEADER"
}

# Inline takeaway — a single highlighted summary line after each command's
# raw output. The reader doesn't have to parse the full output to see what
# just happened.
takeaway() {
  printf "${YELLOW}→ %s${RESET}\n" "$1"
  sleep "$PAUSE_OUTPUT"
}

# Move into a fresh project root for the recording.
cd "$(mktemp -d /tmp/vibe-demo-XXXXXX)"

printf "${WHITE}VibeFrame v0.55 — script to narrated MP4 in 90 seconds.${RESET}\n"
printf "${DIM}No API keys required. All output stays local.${RESET}\n"
sleep 2

header "1 · install check"
type_line "vibe --version"
vibe --version
takeaway "v0.55.x bundle. Single binary on PATH (npm i -g @vibeframe/cli)."

header "2 · scaffold a 12-second 16:9 scene project"
type_line "vibe scene init my-promo -r 16:9 -d 12"
vibe scene init my-promo -r 16:9 -d 12
takeaway "6 files written. Bilingual project — works with both vibe and npx hyperframes."

header "3 · drop in a headline scene (offline, no network)"
type_line 'vibe scene add intro --project my-promo --style announcement \\'
type_line '  --headline "Ship videos, not clicks." \\'
type_line '  --duration 4 --no-audio --no-image'
vibe scene add intro --project my-promo --style announcement \
  --headline "Ship videos, not clicks." \
  --duration 4 --no-audio --no-image
takeaway "compositions/scene-intro.html written; root timeline updated."

header "4 · narrate via local Kokoro-82M (Apache 2.0, free, offline)"
type_line 'vibe scene add core --project my-promo --style explainer \\'
type_line '  --kicker "WHY VIBEFRAME" --headline "Edit text, not pixels." \\'
type_line '  --narration "Each word lights up the moment it is spoken." \\'
type_line '  --tts kokoro --duration 6 --no-image'
vibe scene add core --project my-promo --style explainer \
  --kicker "WHY VIBEFRAME" --headline "Edit text, not pixels." \
  --narration "Each word lights up the moment it is spoken." \
  --tts kokoro --duration 6 --no-image
takeaway "Kokoro wav + Whisper transcript JSON + scene HTML with <span class=\"word\"> per word."

header "5 · validate (in-process Hyperframes lint)"
type_line "vibe scene lint --project my-promo"
vibe scene lint --project my-promo
takeaway "Same checks Hyperframes runs — no extra build step."

header "6 · render to MP4"
type_line "vibe scene render --project my-promo --quality draft -o promo.mp4"
vibe scene render --project my-promo --quality draft -o promo.mp4 2>&1 \
  | grep -vE '^\[Compiler\]|^\[INFO\]|^\[WARN\]'
takeaway "Chrome captures frames; ffmpeg muxes audio with -c:v copy (no re-encode)."

header "7 · verify the output has both streams"
type_line "ffprobe -v error -show_streams my-promo/promo.mp4 | grep codec_"
ffprobe -v error -show_streams my-promo/promo.mp4 | grep "codec_type\|codec_name" | head -4
takeaway "video + audio. Captions appear when each word is spoken."

printf "\n${WHITE}Edit a scene HTML, re-render — done.${RESET}\n"
printf "${DIM}No re-prompting an LLM. No regenerating opaque MP4s.${RESET}\n"
sleep 3
