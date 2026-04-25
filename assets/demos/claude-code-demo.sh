#!/usr/bin/env bash
# Drives assets/demos/vibeframe-claude-code.cast.
# Shows the most common Claude Code path: a developer types a natural-
# language request, Claude discovers `vibe` via --help, then drives it
# from the Bash tool. No MCP setup required — the MCP route is shown as
# a follow-up in claude-code-walkthrough.md.
#
# Run (from repo root):
#   asciinema rec assets/demos/vibeframe-claude-code.cast \
#     --idle-time-limit=2 \
#     --title="VibeFrame inside Claude Code (CLI discovery)" \
#     --command="bash $(pwd)/assets/demos/claude-code-demo.sh" \
#     --overwrite
#
# Conversion to SVG:
#   asciinema convert -f asciicast-v2 \
#     assets/demos/vibeframe-claude-code.cast /tmp/cc-v2.cast
#   svg-term --in /tmp/cc-v2.cast \
#            --out assets/demos/vibeframe-claude-code.svg \
#            --window --width 100 --height 38
#
# Requires: claude CLI (Claude Code), ANTHROPIC_API_KEY, vibe on PATH.
#
# What this script does: drives `claude --print --output-format
# stream-json --allowed-tools Bash` non-interactively, then parses the
# JSON event stream into a Claude-Code-style chat transcript:
#
#   ❯ <user prompt>
#   ⏺ <assistant text>
#   ▸ Bash · vibe --help
#   <truncated stdout>
#   ⏺ <assistant continues>
#   ▸ Bash · vibe scene init my-promo -d 6
#   …
#
# Asciinema can't drive a true Claude Code TTY REPL, but this transcript
# matches the on-screen UX cues (⏺/▸/⌃) the live UI uses.

set -e

export VIBE_HUMAN_OUTPUT=1
export FORCE_COLOR=1

GREEN=$'\033[1;32m'
DIM=$'\033[2m'
CYAN=$'\033[1;36m'
YELLOW=$'\033[1;33m'
WHITE=$'\033[1;37m'
MAGENTA=$'\033[1;35m'
RESET=$'\033[0m'

# Load API keys for any vibe command that needs them.
if [ -f "$(cd "$(dirname "$0")/../.." && pwd)/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$(cd "$(dirname "$0")/../.." && pwd)/.env"
  set +a
fi

cd "$(mktemp -d /tmp/vibe-cc-demo-XXXXXX)"

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------

printf "${WHITE}VibeFrame inside Claude Code — natural-language → vibe CLI${RESET}\n"
printf "${DIM}No setup. Claude discovers vibe via --help and drives it from Bash.${RESET}\n"
sleep 2

# ---------------------------------------------------------------------------
# The chat session
# ---------------------------------------------------------------------------

USER_PROMPT="I have the 'vibe' CLI installed (vibeframe video editor). Use it to scaffold a small 16:9 scene project named 'cc-demo' (6s duration), then add an announcement scene named 'hello' with the headline 'Hello from Claude Code' (skip audio and image). Then lint it. Use --help when needed to discover flags. Brief summary at the end."

printf "\n${CYAN}── live Claude Code session ──${RESET}\n"
sleep 0.5
printf "\n${GREEN}❯${RESET} ${WHITE}%s${RESET}\n\n" "$USER_PROMPT"
sleep 1.2

echo "$USER_PROMPT" | claude --print --bare \
  --permission-mode bypassPermissions \
  --allowed-tools "Bash" \
  --output-format stream-json --verbose 2>&1 \
| python3 -c '
import json, sys, time

GREEN = "\033[1;32m"; DIM = "\033[2m"; CYAN = "\033[1;36m"
YELLOW = "\033[1;33m"; WHITE = "\033[1;37m"; MAGENTA = "\033[1;35m"
RESET = "\033[0m"

def slow(text, delay=0.003):
    for ch in text:
        sys.stdout.write(ch); sys.stdout.flush()
        time.sleep(delay)

def truncate_lines(text, max_lines=6, line_width=92):
    lines = text.rstrip().splitlines()
    out = []
    for line in lines[:max_lines]:
        if len(line) > line_width:
            line = line[:line_width-1] + "…"
        out.append(line)
    if len(lines) > max_lines:
        out.append(f"… +{len(lines) - max_lines} lines")
    return "\n".join(out)

for raw in sys.stdin:
    raw = raw.strip()
    if not raw or not raw.startswith("{"):
        continue
    try:
        evt = json.loads(raw)
    except Exception:
        continue
    t = evt.get("type")
    if t == "system" and evt.get("subtype") == "init":
        time.sleep(0.4)
        print(f"{DIM}claude code · session start · Bash tool only · ANTHROPIC_API_KEY set{RESET}")
        time.sleep(0.6)
        continue
    if t == "assistant":
        for block in evt.get("message", {}).get("content", []):
            bt = block.get("type")
            if bt == "text":
                txt = block.get("text", "").strip()
                if not txt: continue
                print()
                slow(f"{MAGENTA}⏺{RESET} {txt}\n")
                time.sleep(0.4)
            elif bt == "tool_use" and block.get("name") == "Bash":
                cmd = block.get("input", {}).get("command", "").strip()
                if len(cmd) > 92: cmd = cmd[:91] + "…"
                print(f"  {CYAN}▸{RESET} {WHITE}Bash{RESET} {DIM}·{RESET} {cmd}")
                time.sleep(0.5)
        continue
    if t == "user":
        for block in evt.get("message", {}).get("content", []):
            if block.get("type") != "tool_result": continue
            payload = block.get("content")
            if isinstance(payload, list):
                payload = " ".join(p.get("text","") for p in payload if p.get("type")=="text")
            if not payload: continue
            print(f"{DIM}{truncate_lines(str(payload), max_lines=4)}{RESET}")
            time.sleep(0.4)
        continue
'

sleep 2
printf "\n${WHITE}vibe scene init/add/lint discovered + executed from a single prompt.${RESET}\n"
printf "${DIM}For tighter integration (typed tool calls, no Bash spawn), use the MCP route — see assets/demos/claude-code-walkthrough.md.${RESET}\n"
sleep 3
