#!/bin/bash
#
# VibeFrame Demo Recording Script
# Designed for screen recording (OBS, QuickTime, etc.)
#
# Features:
#   - Simulated typing effect (looks natural on video)
#   - Pauses between acts for viewer readability
#   - Installation → Act 1 → Act 2 → Act 3 → Act 4 → Epilog
#
# Usage:
#   ./scripts/demo-record.sh              # full demo (dry-run)
#   ./scripts/demo-record.sh --live       # full demo (real API calls)
#   ./scripts/demo-record.sh --act 4      # single act only
#   ./scripts/demo-record.sh --skip-install  # skip installation scene
#   ./scripts/demo-record.sh --fast       # faster typing (for testing)
#
# Recording tips:
#   1. Set terminal to 102 cols x 29 rows, font 15pt+
#   2. Start screen recording FIRST, then run this script
#   3. Use a dark terminal theme for best contrast

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
MODE="dry-run"
ACT=""
SKIP_INSTALL=false
TYPING_SPEED=0.04  # seconds per character

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --live) MODE="live"; shift ;;
    --dry-run) MODE="dry-run"; shift ;;
    --act) ACT="$2"; shift 2 ;;
    --skip-install) SKIP_INSTALL=true; shift ;;
    --fast) TYPING_SPEED=0.01; shift ;;
    -h|--help)
      echo "Usage: $0 [--dry-run|--live] [--act N] [--skip-install] [--fast]"
      echo ""
      echo "Options:"
      echo "  --dry-run        Simulated output, no API keys needed (default)"
      echo "  --live           Real API calls (needs keys + FFmpeg)"
      echo "  --act N          Run only Act N (0=install, 1-4)"
      echo "  --skip-install   Skip the installation scene"
      echo "  --fast           Fast typing speed (for testing)"
      echo ""
      echo "Acts:"
      echo "  0  Installation"
      echo "  1  One Command Video Production"
      echo "  2  Post-Production Combo"
      echo "  3  Agent Mode"
      echo "  4  Motion Graphics Pipeline"
      exit 0
      ;;
    *) shift ;;
  esac
done

cd "$PROJECT_ROOT"

# ─── Colors ───────────────────────────────────────────────────────────────

BOLD='\033[1m'
DIM='\033[2m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
MAGENTA='\033[0;35m'
RED='\033[0;31m'
WHITE='\033[1;37m'
BG_BLUE='\033[44m'
NC='\033[0m'

# ─── Typing Helpers ───────────────────────────────────────────────────────

type_text() {
  # Simulate typing one character at a time
  local text="$1"
  local speed="${2:-$TYPING_SPEED}"
  for (( i=0; i<${#text}; i++ )); do
    printf '%s' "${text:$i:1}"
    sleep "$speed"
  done
}

type_cmd() {
  # Type a command with green prompt, then execute or simulate
  local cmd="$1"
  printf "${GREEN}\$ ${NC}"
  type_text "$cmd"
  sleep 0.3
  printf "\n"
}

type_cmd_run() {
  # Type a command, then actually run it
  local cmd="$1"
  type_cmd "$cmd"
  sleep 0.3
  if [ "$MODE" = "live" ]; then
    eval "$cmd"
  fi
}

type_multiline() {
  # Type a multi-line command with backslash continuations
  # Args: line1 line2 line3 ...
  local first=true
  for line in "$@"; do
    if $first; then
      printf "${GREEN}\$ ${NC}"
      first=false
    else
      printf "${GREEN}  ${NC}"
    fi
    type_text "$line"
    sleep 0.2
    printf "\n"
  done
}

pause() {
  sleep "${1:-2}"
}

banner() {
  local text="$1"
  local width=64
  local pad=$(( (width - ${#text}) / 2 ))
  echo ""
  printf "${BG_BLUE}${WHITE}"
  printf "%-${width}s" ""
  printf "\n"
  printf "%*s%s%*s" $pad "" "$text" $((width - pad - ${#text})) ""
  printf "\n"
  printf "%-${width}s" ""
  printf "${NC}\n"
  echo ""
}

comment() {
  printf "${DIM}# %s${NC}\n" "$1"
}

result() {
  printf "${GREEN}%s${NC}\n" "$1"
}

fake_output() {
  if [ "$MODE" = "dry-run" ]; then
    printf "${DIM}%s${NC}\n" "$1"
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
# ACT 0: Installation
# ═════════════════════════════════════════════════════════════════════════════

act0() {
  banner "Installation"

  comment "Install VibeFrame with one command"
  echo ""
  pause 1

  type_cmd "curl -fsSL https://vibeframe.ai/install.sh | bash"
  echo ""
  sleep 0.5

  # Simulated install output
  printf "${DIM}"
  echo "  Detecting system... macOS arm64"
  sleep 0.4
  echo "  Installing Node.js dependencies..."
  sleep 0.6
  echo "  Installing VibeFrame CLI..."
  sleep 0.8
  echo ""
  printf "${NC}"
  result "  VibeFrame v0.17.1 installed successfully!"
  echo ""
  sleep 0.5
  fake_output "  Run 'vibe' to start the AI agent"
  fake_output "  Run 'vibe --help' to see all commands"
  echo ""
  pause 1.5

  # Show version
  comment "Verify installation"
  echo ""
  type_cmd "vibe --version"
  sleep 0.3
  echo "0.17.1"
  echo ""
  pause 1

  # Show help (brief)
  type_cmd "vibe --help"
  sleep 0.3
  echo ""
  printf "${DIM}"
  echo "  Usage: vibe [command] [options]"
  echo ""
  echo "  Commands:"
  echo "    agent           Start the AI agent (default)"
  echo "    ai image        Generate images (OpenAI/Gemini/Stability)"
  echo "    ai video        Generate video (Runway)"
  echo "    ai kling        Generate video (Kling)"
  echo "    ai tts          Text-to-speech (ElevenLabs)"
  echo "    ai motion       Motion graphics (Claude + Remotion)"
  echo "    ai caption      Transcribe + burn captions"
  echo "    ai script-to-video  Full video pipeline"
  echo "    ...and 16 more AI commands"
  printf "${NC}"
  echo ""

  pause 2
}

# ═════════════════════════════════════════════════════════════════════════════
# ACT 1: One Command Video Production
# ═════════════════════════════════════════════════════════════════════════════

act1() {
  banner "ACT 1: One Command Video Production"

  comment "One script in, full video out — 5 AI APIs chained automatically"
  echo ""
  pause 1.5

  local script="A developer types one command. AI generates visuals. A finished video plays back."

  type_multiline \
    "vibe ai script-to-video \\" \
    "  \"$script\" \\" \
    "  --voice rachel \\" \
    "  --image-provider gemini \\" \
    "  --generator kling"
  echo ""

  if [ "$MODE" = "live" ]; then
    sleep 0.5
    pnpm vibe ai script-to-video \
      "$script" \
      --voice "rachel" \
      --image-provider gemini \
      --generator kling
  else
    sleep 0.5
    printf "${DIM}  [1/5] Generating storyboard with Claude...${NC}\n"
    sleep 1.0
    printf "${DIM}        3 scenes, 30s total duration${NC}\n"
    sleep 0.5
    printf "${DIM}  [2/5] Generating narration with ElevenLabs (voice: rachel)...${NC}\n"
    sleep 1.0
    printf "${DIM}        scene-1.mp3 (10.2s) scene-2.mp3 (9.8s) scene-3.mp3 (10.0s)${NC}\n"
    sleep 0.5
    printf "${DIM}  [3/5] Generating images with Gemini...${NC}\n"
    sleep 1.0
    printf "${DIM}        scene-1.png scene-2.png scene-3.png${NC}\n"
    sleep 0.5
    printf "${DIM}  [4/5] Generating videos with Kling v2.5...${NC}\n"
    sleep 1.0
    printf "${DIM}        scene-1.mp4 (10s) scene-2.mp4 (10s) scene-3.mp4 (10s)${NC}\n"
    sleep 0.5
    printf "${DIM}  [5/5] Assembling project...${NC}\n"
    sleep 0.8
    echo ""
    result "  Done! Project: my-project.vibe.json"
    result "  Output:  script-to-video-output/final.mp4 (30s, 1080p)"
  fi

  echo ""
  comment "One text in, finished video out. Storyboard, narration, images, video — all AI-generated."
  pause 3
}

# ═════════════════════════════════════════════════════════════════════════════
# ACT 2: Post-Production Combo
# ═════════════════════════════════════════════════════════════════════════════

act2() {
  banner "ACT 2: Post-Production Combo"

  comment "4-hit combo — denoise → silence cut → captions → fade"
  echo ""
  pause 1.5

  local input="demo-output/sample.mp4"
  local s1="demo-output/step1-clean.mp4"
  local s2="demo-output/step2-cut.mp4"
  local s3="demo-output/step3-captioned.mp4"
  local s4="demo-output/step4-final.mp4"

  # Step 1
  comment "Step 1: Remove audio noise"
  type_cmd_run "vibe ai noise-reduce $input -o $s1"
  if [ "$MODE" = "dry-run" ]; then
    fake_output "  Noise profile: -30dB detected"
    fake_output "  Applied: highpass=200, lowpass=3000, afftdn=nr=20"
    result "  Cleaned: step1-clean.mp4"
  fi
  echo ""
  pause 1

  # Step 2
  comment "Step 2: Auto-cut silent segments"
  type_cmd_run "vibe ai silence-cut $s1 -o $s2 --noise -35 --min-duration 0.5"
  if [ "$MODE" = "dry-run" ]; then
    fake_output "  Detected 12 silent segments (total: 18.4s)"
    fake_output "  Removed 12 segments, saved 18.4s"
    fake_output "  Duration: 62.0s -> 43.6s (-29.7%)"
    result "  Trimmed: step2-cut.mp4"
  fi
  echo ""
  pause 1

  # Step 3
  comment "Step 3: Transcribe + burn captions"
  type_cmd_run "vibe ai caption $s2 -o $s3 --style bold"
  if [ "$MODE" = "dry-run" ]; then
    fake_output "  Transcribing with Whisper..."
    fake_output "  Found 34 segments (43.6s)"
    fake_output "  Burning captions with style: bold (white, black outline)"
    result "  Captioned: step3-captioned.mp4"
  fi
  echo ""
  pause 1

  # Step 4
  comment "Step 4: Add fade in/out effects"
  type_cmd_run "vibe ai fade $s3 -o $s4 --fade-in 1.0 --fade-out 1.5"
  if [ "$MODE" = "dry-run" ]; then
    fake_output "  Applied: fade-in 1.0s (video+audio), fade-out 1.5s (video+audio)"
    result "  Final: step4-final.mp4"
  fi

  echo ""
  comment "4 commands, done: denoise → silence cut → captions → fade"
  comment "62s raw → 43.6s polished (zero manual editing)"
  pause 3
}

# ═════════════════════════════════════════════════════════════════════════════
# ACT 3: Let the Agent Handle It
# ═════════════════════════════════════════════════════════════════════════════

act3() {
  banner "ACT 3: Let the Agent Handle It"

  comment "Let the agent handle it — give complex tasks in plain English"
  echo ""
  pause 1.5

  local query="Analyze demo-output/sample.mp4, find the best frame for a thumbnail, extract it, and generate captions for the video."

  type_multiline \
    "vibe agent -i \\" \
    "  \"$query\" \\" \
    "  -v"
  echo ""

  if [ "$MODE" = "live" ]; then
    sleep 0.5
    pnpm vibe agent -i "$query" -v
  else
    sleep 0.5
    printf "${MAGENTA}  [Agent] Planning: 3 tasks identified${NC}\n"
    sleep 0.8

    printf "${MAGENTA}  [Agent] Step 1: Calling ai_analyze...${NC}\n"
    sleep 1.0
    printf "${DIM}          Video: 43.6s, 1080p, 30fps${NC}\n"
    printf "${DIM}          Content: tech product demo, speaker with screen recording${NC}\n"
    printf "${DIM}          Audio: clear speech, minimal background noise${NC}\n"
    sleep 0.8

    printf "${MAGENTA}  [Agent] Step 2: Calling ai_thumbnail --best-frame...${NC}\n"
    sleep 1.0
    printf "${DIM}          Analyzed 15 candidate frames${NC}\n"
    printf "${DIM}          Best frame: 00:00:12.4 (score: 0.94)${NC}\n"
    printf "${DIM}          Saved: demo-output/thumbnail.png (1920x1080)${NC}\n"
    sleep 0.8

    printf "${MAGENTA}  [Agent] Step 3: Calling ai_caption...${NC}\n"
    sleep 1.0
    printf "${DIM}          Transcribed 34 segments${NC}\n"
    printf "${DIM}          Burned captions with style: bold${NC}\n"
    printf "${DIM}          Output: demo-output/captioned.mp4${NC}\n"
    sleep 0.8

    echo ""
    printf "${MAGENTA}  [Agent] Done! Completed 3 tool calls autonomously.${NC}\n"
  fi

  echo ""
  comment "One sentence in → Agent analyzes, extracts thumbnail, generates captions autonomously"
  pause 3
}

# ═════════════════════════════════════════════════════════════════════════════
# ACT 4: Motion Graphics Pipeline
# ═════════════════════════════════════════════════════════════════════════════

act4() {
  banner "ACT 4: Motion Graphics Pipeline"

  comment "Natural language to motion graphics — Claude writes Remotion TSX and renders it"
  echo ""
  pause 1.5

  # Step 1
  comment "Step 1: Generate a title card from plain English"
  echo ""

  local motion="cinematic title card with 'VIBEFRAME' text, spring bounce from zero to full size, gold gradient color, particle effects in background"

  type_multiline \
    "vibe ai motion \\" \
    "  \"$motion\" \\" \
    "  --render -o demo-output/title.webm"
  echo ""

  if [ "$MODE" = "live" ]; then
    sleep 0.5
    pnpm vibe ai motion "$motion" --render -o demo-output/title.webm
  else
    sleep 0.5
    printf "${DIM}  [Claude] Generating Remotion TSX component...${NC}\n"
    sleep 1.0
    printf "${DIM}          import { spring, useCurrentFrame } from 'remotion';${NC}\n"
    printf "${DIM}          // 47 lines of React motion graphics code${NC}\n"
    sleep 0.8
    printf "${DIM}  [Render] Scaffolding temp project...${NC}\n"
    sleep 0.8
    printf "${DIM}  [Render] npx remotion render → title.webm (1920x1080, 5s, 30fps)${NC}\n"
    sleep 1.0
    echo ""
    result "  Motion graphic rendered: demo-output/title.webm"
  fi

  echo ""
  pause 2

  # Step 2
  comment "Step 2: Composite a lower-third overlay onto video"
  echo ""

  local overlay="lower-third title: 'Kiyeon, CEO' with smooth slide-in from left, semi-transparent dark background bar"

  type_multiline \
    "vibe ai motion \\" \
    "  \"$overlay\" \\" \
    "  --video demo-output/sample.mp4 -o demo-output/with-title.mp4"
  echo ""

  if [ "$MODE" = "live" ]; then
    sleep 0.5
    pnpm vibe ai motion "$overlay" --video demo-output/sample.mp4 -o demo-output/with-title.mp4
  else
    sleep 0.5
    printf "${DIM}  [Claude] Generating Remotion TSX component...${NC}\n"
    sleep 1.0
    printf "${DIM}          // Lower-third with slide-in animation${NC}\n"
    sleep 0.8
    printf "${DIM}  [Render] Rendering transparent overlay (1920x1080, 3s)...${NC}\n"
    sleep 0.8
    printf "${DIM}  [Composite] Overlaying on sample.mp4 via FFmpeg...${NC}\n"
    sleep 1.0
    printf "${DIM}          ffmpeg -i sample.mp4 -i overlay.webm -filter_complex overlay${NC}\n"
    sleep 0.8
    echo ""
    result "  Composited: demo-output/with-title.mp4"
  fi

  echo ""
  comment "Plain English → Claude generates code → Remotion renders → FFmpeg composites"
  comment "Motion graphics in the terminal — no After Effects needed"
  pause 3
}

# ═════════════════════════════════════════════════════════════════════════════
# Epilog
# ═════════════════════════════════════════════════════════════════════════════

epilog() {
  echo ""
  echo ""
  printf "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
  echo ""
  printf "${BOLD}${WHITE}  VibeFrame${NC}  ${DIM}v0.17.1${NC}\n"
  printf "${DIM}  AI-native video editing in the terminal${NC}\n"
  echo ""
  printf "  ${CYAN}58${NC} agent tools  ${DIM}|${NC}  ${CYAN}24${NC} AI commands  ${DIM}|${NC}  ${CYAN}10${NC} providers\n"
  echo ""
  printf "  ${DIM}GitHub:${NC}   https://github.com/kiyeonj51/vibeframe\n"
  printf "  ${DIM}Install:${NC}  curl -fsSL https://vibeframe.ai/install.sh | bash\n"
  echo ""
  printf "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
  echo ""
  printf "  ${YELLOW}If this is useful, give us a star!${NC}\n"
  echo ""
  pause 5
}

# ═════════════════════════════════════════════════════════════════════════════
# Main
# ═════════════════════════════════════════════════════════════════════════════

main() {
  clear

  printf "${BOLD}${WHITE}"
  cat << 'LOGO'

  ██╗   ██╗██╗██████╗ ███████╗███████╗██████╗  █████╗ ███╗   ███╗███████╗
  ██║   ██║██║██╔══██╗██╔════╝██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝
  ██║   ██║██║██████╔╝█████╗  █████╗  ██████╔╝███████║██╔████╔██║█████╗
  ╚██╗ ██╔╝██║██╔══██╗██╔══╝  ██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝
   ╚████╔╝ ██║██████╔╝███████╗██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗
    ╚═══╝  ╚═╝╚═════╝ ╚══════╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝

LOGO
  printf "${NC}"
  printf "${DIM}  AI-native video editing in the terminal${NC}\n"
  echo ""

  pause 3

  if [ -n "$ACT" ]; then
    case $ACT in
      0) act0 ;;
      1) act1 ;;
      2) act2 ;;
      3) act3 ;;
      4) act4 ;;
      *)
        printf "${RED}Invalid act: $ACT (valid: 0-4)${NC}\n"
        exit 1
        ;;
    esac
  else
    if ! $SKIP_INSTALL; then
      act0
    fi
    act1
    act2
    act3
    act4
  fi

  epilog
}

main
