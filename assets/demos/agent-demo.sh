#!/usr/bin/env bash
# Drives assets/demos/vibeframe-agent.cast.
# Shows VibeFrame's standalone agent mode — natural language in, multi-tool
# orchestration out. ~50 seconds total.
#
# Run (from repo root):
#   asciinema rec assets/demos/vibeframe-agent.cast \
#     --idle-time-limit=2 \
#     --title="VibeFrame agent mode" \
#     --command="bash $(pwd)/assets/demos/agent-demo.sh" \
#     --overwrite
#
# Conversion to SVG:
#   asciinema convert -f asciicast-v2 \
#     assets/demos/vibeframe-agent.cast /tmp/agent-v2.cast
#   svg-term --in /tmp/agent-v2.cast \
#            --out assets/demos/vibeframe-agent.svg \
#            --window --width 100 --height 32
#
# Requires ANTHROPIC_API_KEY (Claude is the agent LLM in this script). Source
# it from the repo `.env` before recording.

set -e

export VIBE_HUMAN_OUTPUT=1
export FORCE_COLOR=1

GREEN=$'\033[1;32m'
DIM=$'\033[2m'
CYAN=$'\033[1;36m'
YELLOW=$'\033[1;33m'
WHITE=$'\033[1;37m'
RESET=$'\033[0m'

PROMPT="${GREEN}❯${RESET} "
TYPE_DELAY="${TYPE_DELAY:-0.04}"
PAUSE_AFTER="${PAUSE_AFTER:-0.7}"
PAUSE_OUTPUT="${PAUSE_OUTPUT:-1.4}"

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

header() {
  printf "\n${CYAN}── %s ──${RESET}\n" "$1"
  sleep 0.6
}

takeaway() {
  printf "${YELLOW}→ %s${RESET}\n" "$1"
  sleep "$PAUSE_OUTPUT"
}

# Load API keys from repo `.env` if present (agent needs ANTHROPIC_API_KEY
# for the Claude provider used in this demo).
if [ -f "$(cd "$(dirname "$0")/../.." && pwd)/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$(cd "$(dirname "$0")/../.." && pwd)/.env"
  set +a
fi

cd "$(mktemp -d /tmp/vibe-agent-demo-XXXXXX)"

printf "${WHITE}VibeFrame agent mode — stand-alone REPL, no IDE host, no MCP setup${RESET}\n"
printf "${DIM}Pick any LLM provider (BYOK), get 62 vibe tools attached automatically.${RESET}\n"
sleep 2

header "1 · pick a provider"
type_line "vibe agent --help | head -10"
vibe agent --help | head -10
takeaway "Claude · OpenAI · Gemini · Grok · OpenRouter · local Ollama — same 62 tools either way."

header "2 · ask in plain English (xAI Grok, single-shot via -i)"
type_line 'vibe agent -p xai -v -i \\'
type_line '  "Make me a 16:9 scene project named demo with a single 5-second \\'
type_line '   announcement scene saying Hello vibe agent. Skip audio and image. \\'
type_line '   Then lint."'
vibe agent -p xai -v --max-turns 6 -i "Make me a 16:9 scene project named 'demo' with a single 5-second announcement scene saying 'Hello vibe agent'. Skip audio and image. Then lint." 2>&1 | head -50

takeaway "scene_init → scene_add → scene_lint, planned and executed by Grok in 2 turns."

header "3 · the agent surface"
type_line "ls demo/"
ls demo/
takeaway "Same 62 tools also exposed through MCP — see the Claude Code demo for that surface."

printf "\n${WHITE}vibe agent = single binary REPL.${RESET} ${DIM}No IDE, no MCP host, no config.${RESET}\n"
printf "${DIM}Swap '-p xai' for any other provider — your key, your model, your terminal.${RESET}\n"
sleep 3
