#!/usr/bin/env bash
# Reproduces docs/comparison.md numbers — same scene project rendered through
# both `vibe scene render` (with audio mux) and `npx hyperframes render`
# (silent baseline).
#
# Run from repo root:
#   bash tests/comparison/render-bench.sh
#
# Requires: Chrome installed (vibe doctor), ffmpeg, ffprobe, npx, and a
# v0.55.2+ vibe binary on PATH.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TMPDIR="${TMPDIR:-/tmp}"
WORK="$(mktemp -d "$TMPDIR/vibe-bench-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

cyan()  { printf "\033[1;36m▶ %s\033[0m\n" "$*"; }
green() { printf "\033[32m✓ %s\033[0m\n" "$*"; }

cyan "Cloning examples/scene-promo into $WORK"
cp -r "$ROOT_DIR/examples/scene-promo" "$WORK/project-A"
cp -r "$ROOT_DIR/examples/scene-promo" "$WORK/project-B"

cyan "Adding a narrated scene to both copies (Kokoro local TTS)"
for proj in "$WORK/project-A" "$WORK/project-B"; do
  vibe scene add narrated --project "$proj" --style explainer \
    --kicker "WHY VIBEFRAME" --headline "Edit text, not pixels." \
    --narration "Each word lights up the moment it is spoken." \
    --tts kokoro --duration 6 --no-image --json >/dev/null
done

cyan "A: vibe scene render (audio muxed, --workers 6)"
TIMEFORMAT='   wall=%R s'
{ time vibe scene render --project "$WORK/project-A" --quality draft --fps 24 \
    --workers 6 -o "$WORK/A.mp4" >/dev/null; } 2>&1

cyan "B: npx hyperframes render (silent)"
{ time ( cd "$WORK/project-B" && npx hyperframes render --quality draft --fps 24 \
    -o "$WORK/B.mp4" ) >/dev/null 2>&1; } 2>&1

cyan "ffprobe summary"
printf "%-20s %12s %14s %14s\n" "Metric" "A (vibe)" "B (hyperframes)" "Δ"
printf "%-20s %12s %14s %14s\n" "size (bytes)" \
  "$(stat -f%z "$WORK/A.mp4" 2>/dev/null || stat -c%s "$WORK/A.mp4")" \
  "$(stat -f%z "$WORK/B.mp4" 2>/dev/null || stat -c%s "$WORK/B.mp4")" "—"

a_video_dur=$(ffprobe -v error -select_streams v:0 -show_entries stream=duration -of csv=p=0 "$WORK/A.mp4")
b_video_dur=$(ffprobe -v error -select_streams v:0 -show_entries stream=duration -of csv=p=0 "$WORK/B.mp4")
printf "%-20s %12s %14s %14s\n" "video duration (s)" "$a_video_dur" "$b_video_dur" "—"

a_audio_count=$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$WORK/A.mp4" | wc -l | tr -d ' ')
b_audio_count=$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$WORK/B.mp4" | wc -l | tr -d ' ')
printf "%-20s %12s %14s %14s\n" "audio streams" "$a_audio_count" "$b_audio_count" "—"

if [ "$a_audio_count" -ge 1 ]; then
  a_audio_dur=$(ffprobe -v error -select_streams a:0 -show_entries stream=duration -of csv=p=0 "$WORK/A.mp4")
  printf "%-20s %12s %14s %14s\n" "audio duration (s)" "$a_audio_dur" "—" "—"
fi

green "Outputs kept at $WORK/A.mp4 and $WORK/B.mp4 (cleaned on exit)."
green "See docs/comparison.md for the narrative."
