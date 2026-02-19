#!/bin/bash
#
# VibeFrame Demo Script
# "AI-native video editing in the terminal"
#
# Usage:
#   ./scripts/demo.sh              # dry-run (safe, no API keys needed)
#   ./scripts/demo.sh --live       # live mode (needs API keys + FFmpeg)
#   ./scripts/demo.sh --dry-run    # explicit dry-run
#

set -e

# ─── Config ──────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEMO_DIR="$PROJECT_ROOT/demo-output"
VIBE="pnpm vibe"
MODE="dry-run"

# Parse args
for arg in "$@"; do
  case $arg in
    --live)  MODE="live" ;;
    --dry-run) MODE="dry-run" ;;
    -h|--help)
      echo "Usage: $0 [--dry-run|--live]"
      echo "  --dry-run  Print commands with commentary (default)"
      echo "  --live     Actually run commands (needs API keys)"
      exit 0
      ;;
  esac
done

cd "$PROJECT_ROOT"

# ─── Colors ──────────────────────────────────────────────────────────────────

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

# ─── Helpers ─────────────────────────────────────────────────────────────────

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

section() {
  echo ""
  printf "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
  printf "${BOLD}%s${NC}\n" "$1"
  printf "${DIM}%s${NC}\n" "$2"
  printf "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
  echo ""
}

comment() {
  printf "${DIM}# %s${NC}\n" "$1"
}

show_cmd() {
  printf "${GREEN}\$ %s${NC}\n" "$1"
}

run_cmd() {
  show_cmd "$1"
  if [ "$MODE" = "live" ]; then
    sleep 0.5
    eval "$1"
  else
    printf "${DIM}  (dry-run: skipped)${NC}\n"
  fi
  echo ""
}

fake_output() {
  # Print simulated output in dry-run mode
  if [ "$MODE" = "dry-run" ]; then
    printf "${DIM}%s${NC}\n" "$1"
  fi
}

pause() {
  sleep "${1:-1.5}"
}

result() {
  printf "${GREEN}%s${NC}\n" "$1"
}

# ─── Preflight ───────────────────────────────────────────────────────────────

preflight() {
  if [ "$MODE" = "live" ]; then
    mkdir -p "$DEMO_DIR"

    # Check FFmpeg
    if ! command -v ffmpeg &>/dev/null; then
      printf "${RED}FFmpeg not found. Install with: brew install ffmpeg${NC}\n"
      exit 1
    fi

    # Check Node
    if ! command -v node &>/dev/null; then
      printf "${RED}Node.js not found. Install Node.js 18+${NC}\n"
      exit 1
    fi

    # Check for sample video (Act 2)
    if [ ! -f "$DEMO_DIR/sample.mp4" ]; then
      printf "${YELLOW}Note: Place a sample video at demo-output/sample.mp4 for Act 2${NC}\n"
      printf "${DIM}  You can use any short video clip (30-60s recommended)${NC}\n"
      echo ""
    fi
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
# ACT 1: One Command Video Production
# ═════════════════════════════════════════════════════════════════════════════

act1() {
  banner "ACT 1: One Command Video Production"

  comment "한 줄로 영상 제작 — 스크립트 하나로 완성된 영상을 만듭니다"
  echo ""
  pause

  comment "AI가 스토리보드 → 나레이션 → 이미지 → 영상 → 프로젝트 파일을 자동 생성합니다"
  echo ""

  local script_text="A 30-second product launch video for an AI video editor. Scene 1: A developer types a single command in a dark terminal. Scene 2: AI generates stunning visuals in real-time. Scene 3: The finished video plays — professional quality, zero manual editing. Tone: futuristic, empowering."

  printf "${GREEN}\$ vibe ai script-to-video \\\\${NC}\n"
  printf "${GREEN}    --script \"%.60s...\" \\\\${NC}\n" "$script_text"
  printf "${GREEN}    --voice \"rachel\" \\\\${NC}\n"
  printf "${GREEN}    --image-provider gemini \\\\${NC}\n"
  printf "${GREEN}    --video-provider kling${NC}\n"
  echo ""

  if [ "$MODE" = "live" ]; then
    sleep 0.5
    $VIBE ai script-to-video \
      --script "$script_text" \
      --voice "rachel" \
      --image-provider gemini \
      --video-provider kling
  else
    comment "Pipeline 실행 중..."
    echo ""
    printf "${DIM}  [1/5] Generating storyboard with Claude...${NC}\n"
    sleep 0.8
    printf "${DIM}        3 scenes, 30s total duration${NC}\n"
    sleep 0.3
    printf "${DIM}  [2/5] Generating narration with ElevenLabs (voice: rachel)...${NC}\n"
    sleep 0.8
    printf "${DIM}        scene-1.mp3 (10.2s) scene-2.mp3 (9.8s) scene-3.mp3 (10.0s)${NC}\n"
    sleep 0.3
    printf "${DIM}  [3/5] Generating images with Gemini...${NC}\n"
    sleep 0.8
    printf "${DIM}        scene-1.png scene-2.png scene-3.png${NC}\n"
    sleep 0.3
    printf "${DIM}  [4/5] Generating videos with Kling v2.5...${NC}\n"
    sleep 0.8
    printf "${DIM}        scene-1.mp4 (10s) scene-2.mp4 (10s) scene-3.mp4 (10s)${NC}\n"
    sleep 0.3
    printf "${DIM}  [5/5] Assembling project...${NC}\n"
    sleep 0.5
    echo ""
    result "  Done! Project: my-project.vibe.json"
    result "  Output:  script-to-video-output/final.mp4 (30s, 1080p)"
  fi

  echo ""
  comment "텍스트 하나로 완성된 영상. 스토리보드, 나레이션, 이미지, 비디오 전부 AI가 생성."
  pause 2
}

# ═════════════════════════════════════════════════════════════════════════════
# ACT 2: Post-Production Combo
# ═════════════════════════════════════════════════════════════════════════════

act2() {
  banner "ACT 2: Post-Production Combo"

  comment "후반작업 4연타 — 노이즈 제거 → 무음 제거 → 자막 → 페이드"
  echo ""
  pause

  local input="demo-output/sample.mp4"
  local step1="demo-output/step1-clean.mp4"
  local step2="demo-output/step2-cut.mp4"
  local step3="demo-output/step3-captioned.mp4"
  local step4="demo-output/step4-final.mp4"

  # Step 1: Noise Reduce
  comment "Step 1: 오디오 노이즈 제거"
  run_cmd "vibe ai noise-reduce $input -o $step1"
  if [ "$MODE" = "dry-run" ]; then
    fake_output "  Noise profile: -30dB detected"
    fake_output "  Applied: highpass=200, lowpass=3000, afftdn=nr=20"
    result "  Cleaned: step1-clean.mp4"
    echo ""
  fi
  pause 0.5

  # Step 2: Silence Cut
  comment "Step 2: 무음 구간 자동 제거"
  run_cmd "vibe ai silence-cut $step1 -o $step2 --threshold -35dB --min-duration 0.5"
  if [ "$MODE" = "dry-run" ]; then
    fake_output "  Detected 12 silent segments (total: 18.4s)"
    fake_output "  Removed 12 segments, saved 18.4s"
    fake_output "  Duration: 62.0s -> 43.6s (-29.7%)"
    result "  Trimmed: step2-cut.mp4"
    echo ""
  fi
  pause 0.5

  # Step 3: Caption
  comment "Step 3: 음성 인식 + 자막 생성"
  run_cmd "vibe ai caption $step2 -o $step3 --style bold"
  if [ "$MODE" = "dry-run" ]; then
    fake_output "  Transcribing with Whisper..."
    fake_output "  Found 34 segments (43.6s)"
    fake_output "  Burning captions with style: bold (white, black outline)"
    result "  Captioned: step3-captioned.mp4"
    echo ""
  fi
  pause 0.5

  # Step 4: Fade
  comment "Step 4: 페이드 인/아웃 효과 추가"
  run_cmd "vibe ai fade $step3 -o $step4 --fade-in 1.0 --fade-out 1.5"
  if [ "$MODE" = "dry-run" ]; then
    fake_output "  Applied: fade-in 1.0s (video+audio), fade-out 1.5s (video+audio)"
    result "  Final: step4-final.mp4"
    echo ""
  fi

  echo ""
  comment "4개 명령어로 완성: 노이즈 제거 → 무음 컷 → 자막 → 페이드"
  comment "62초 원본 → 43.6초 완성본 (수작업 0초)"
  pause 2
}

# ═════════════════════════════════════════════════════════════════════════════
# ACT 3: Let the Agent Handle It
# ═════════════════════════════════════════════════════════════════════════════

act3() {
  banner "ACT 3: Let the Agent Handle It"

  comment "에이전트에게 맡기기 — 자연어로 복잡한 작업을 지시합니다"
  echo ""
  pause

  local agent_query="Analyze demo-output/sample.mp4, find the best frame for a thumbnail, extract it, and generate Korean captions for the video."

  show_cmd "vibe agent -i \"$agent_query\" -v"
  echo ""

  if [ "$MODE" = "live" ]; then
    sleep 0.5
    $VIBE agent -i "$agent_query" -v
  else
    comment "Agent 자율 실행 중..."
    echo ""

    printf "${MAGENTA}  [Agent] Planning: 3 tasks identified${NC}\n"
    sleep 0.6

    printf "${MAGENTA}  [Agent] Step 1: Calling ai_analyze...${NC}\n"
    sleep 0.8
    printf "${DIM}          Video: 43.6s, 1080p, 30fps${NC}\n"
    printf "${DIM}          Content: tech product demo, speaker with screen recording${NC}\n"
    printf "${DIM}          Audio: clear speech, minimal background noise${NC}\n"
    sleep 0.5

    printf "${MAGENTA}  [Agent] Step 2: Calling ai_thumbnail --best-frame...${NC}\n"
    sleep 0.8
    printf "${DIM}          Analyzed 15 candidate frames${NC}\n"
    printf "${DIM}          Best frame: 00:00:12.4 (score: 0.94)${NC}\n"
    printf "${DIM}          Saved: demo-output/thumbnail.png (1920x1080)${NC}\n"
    sleep 0.5

    printf "${MAGENTA}  [Agent] Step 3: Calling ai_caption --lang ko...${NC}\n"
    sleep 0.8
    printf "${DIM}          Transcribed 34 segments${NC}\n"
    printf "${DIM}          Burned Korean captions with style: bold${NC}\n"
    printf "${DIM}          Output: demo-output/captioned-ko.mp4${NC}\n"
    sleep 0.5

    echo ""
    printf "${MAGENTA}  [Agent] Done! Completed 3 tool calls autonomously.${NC}\n"
  fi

  echo ""
  comment "자연어 한 문장 → AI가 분석, 썸네일 추출, 자막 생성까지 자율 수행"
  pause 2
}

# ═════════════════════════════════════════════════════════════════════════════
# Epilog
# ═════════════════════════════════════════════════════════════════════════════

epilog() {
  echo ""
  echo ""
  printf "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
  echo ""
  printf "${BOLD}${WHITE}  VibeFrame${NC}  ${DIM}v0.16.1${NC}\n"
  printf "${DIM}  AI-native video editing in the terminal${NC}\n"
  echo ""
  printf "  ${CYAN}58${NC} agent tools  ${DIM}|${NC}  ${CYAN}24${NC} AI commands  ${DIM}|${NC}  ${CYAN}10${NC} providers\n"
  echo ""
  printf "  ${DIM}Install:${NC}  curl -fsSL https://vibeframe.ai/install.sh | bash\n"
  printf "  ${DIM}GitHub:${NC}   https://github.com/vibeframe/vibeframe\n"
  echo ""
  printf "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
  echo ""
  printf "  ${YELLOW}If this is useful, give us a star!${NC}\n"
  echo ""
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
  printf "${DIM}  Mode: %s${NC}\n" "$MODE"
  echo ""

  pause 2

  preflight

  act1
  act2
  act3
  epilog
}

main
