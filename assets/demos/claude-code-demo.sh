#!/usr/bin/env bash
# Drives assets/demos/vibeframe-claude-code.cast.
# Shows VibeFrame's MCP tools running inside Claude Code.
#
# Run (from repo root):
#   asciinema rec assets/demos/vibeframe-claude-code.cast \
#     --idle-time-limit=2 \
#     --title="VibeFrame inside Claude Code (MCP)" \
#     --command="bash $(pwd)/assets/demos/claude-code-demo.sh" \
#     --overwrite
#
# Conversion to SVG:
#   asciinema convert -f asciicast-v2 \
#     assets/demos/vibeframe-claude-code.cast /tmp/cc-v2.cast
#   svg-term --in /tmp/cc-v2.cast \
#            --out assets/demos/vibeframe-claude-code.svg \
#            --window --width 100 --height 36
#
# Requires:
#   - claude CLI on PATH (Claude Code), authenticated (or ANTHROPIC_API_KEY)
#   - python3 + jq (we use python for json parsing)
#
# What this script does: drives `claude --print --output-format stream-json`
# under the hood with the vibeframe MCP server attached, then parses the
# JSON event stream into a human-readable transcript that mirrors the
# Claude Code interactive UI:
#
#   ❯ <user prompt>
#   ⏺ <assistant text>
#   ▸ scene_init {dir, aspect, ...}
#   ✓ {success:true, ...}
#   ⏺ <assistant continues>
#   ✓ <final summary>
#
# That way the cast looks like the live Claude Code session even though
# we run it non-interactively (asciinema can't drive a TTY REPL automatically).

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

# Load API keys for the vibeframe MCP server (Whisper, Gemini, etc. — not
# needed for this scene-init/add/lint demo but kept so the same script can
# drive richer prompts).
if [ -f "$(cd "$(dirname "$0")/../.." && pwd)/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$(cd "$(dirname "$0")/../.." && pwd)/.env"
  set +a
fi

cd "$(mktemp -d /tmp/vibe-cc-demo-XXXXXX)"

# ---------------------------------------------------------------------------
# Setup banner — mirrors the one-time MCP config users do in Claude Code
# ---------------------------------------------------------------------------

printf "${WHITE}VibeFrame inside Claude Code — MCP integration${RESET}\n"
printf "${DIM}One config block, 62 vibe tools attached to your Claude Code session.${RESET}\n"
sleep 2

printf "\n${CYAN}── one-time setup ──${RESET}\n"
sleep 0.6
cat <<'EOF'
~/.config/claude-code/mcp.json
{
  "mcpServers": {
    "vibeframe": {
      "command": "npx",
      "args": ["-y", "@vibeframe/mcp-server"]
    }
  }
}
EOF
sleep 2.5

# ---------------------------------------------------------------------------
# Write a temp mcp.json (same shape as the user's, just inline)
# ---------------------------------------------------------------------------

cat > mcp.json <<'EOF'
{
  "mcpServers": {
    "vibeframe": {
      "command": "npx",
      "args": ["-y", "@vibeframe/mcp-server"]
    }
  }
}
EOF

# ---------------------------------------------------------------------------
# The chat session
# ---------------------------------------------------------------------------

USER_PROMPT="Use the vibeframe MCP tools to scaffold a 16:9 scene project named 'cc-demo' with 6 second duration, then add an 'announcement' scene named 'hello' with the headline 'Hello from Claude Code' (skip audio and image), then lint it. Brief summary at the end."

printf "\n${CYAN}── live Claude Code session ──${RESET}\n"
sleep 0.5
printf "\n${GREEN}❯${RESET} ${WHITE}%s${RESET}\n\n" "$USER_PROMPT"
sleep 1.5

# Run claude in stream-json mode so we can render tool calls inline. The
# python below transforms the event stream into a Claude-Code-style chat.
echo "$USER_PROMPT" | claude --print --bare \
  --mcp-config ./mcp.json --permission-mode bypassPermissions \
  --output-format stream-json --verbose 2>&1 \
| python3 -c '
import json, sys, time, os

GREEN = "\033[1;32m"; DIM = "\033[2m"; CYAN = "\033[1;36m"
YELLOW = "\033[1;33m"; WHITE = "\033[1;37m"; MAGENTA = "\033[1;35m"
RESET = "\033[0m"

def slow_print(text, delay=0.005):
    for ch in text:
        sys.stdout.write(ch); sys.stdout.flush()
        time.sleep(delay)

def truncate(s, n=180):
    s = s.replace("\n", " ").strip()
    return s if len(s) <= n else s[:n-1] + "…"

def fmt_args(args):
    # one-line JSON, dropping the noisier paths
    parts = []
    for k, v in args.items():
        if isinstance(v, str) and len(v) > 70:
            v = v[:67] + "…"
        parts.append(f"{k}={json.dumps(v) if not isinstance(v, str) else v!r}")
    return ", ".join(parts)

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
        n = len(evt.get("tools", []))
        time.sleep(0.5)
        print(f"{DIM}claude code · session start · {n} tools available · vibeframe MCP server connected{RESET}")
        time.sleep(0.6)
        continue
    if t == "assistant":
        for block in evt.get("message", {}).get("content", []):
            bt = block.get("type")
            if bt == "text":
                txt = block.get("text", "").strip()
                if not txt: continue
                print()
                slow_print(f"{MAGENTA}⏺{RESET} {txt}\n", delay=0.003)
                time.sleep(0.4)
            elif bt == "tool_use":
                name = block.get("name", "")
                short = name.replace("mcp__vibeframe__", "")
                args = block.get("input", {}) or {}
                print(f"  {CYAN}▸{RESET} {WHITE}{short}{RESET}({DIM}{truncate(fmt_args(args), 140)}{RESET})")
                time.sleep(0.5)
        continue
    if t == "user":
        for block in evt.get("message", {}).get("content", []):
            if block.get("type") != "tool_result": continue
            payload = block.get("content")
            if isinstance(payload, list):
                payload = " ".join(p.get("text","") for p in payload if p.get("type")=="text")
            try:
                obj = json.loads(payload)
                if obj.get("success") is True or obj.get("ok") is True:
                    summary = []
                    for k in ("dir","scenePath","ok","errorCount","warningCount","infoCount","duration"):
                        if k in obj: summary.append(f"{k}={obj[k]}")
                    line = ", ".join(summary) or json.dumps(obj)[:120]
                    print(f"  {GREEN}✓{RESET} {DIM}{line}{RESET}")
                else:
                    print(f"  {DIM}{truncate(payload, 120)}{RESET}")
            except Exception:
                print(f"  {DIM}{truncate(str(payload), 120)}{RESET}")
            time.sleep(0.4)
        continue
    if t == "result":
        time.sleep(0.4)
        continue
'

sleep 2
printf "\n${WHITE}Same 62 tools as 'vibe agent', surfaced through MCP for any compatible host.${RESET}\n"
printf "${DIM}Cursor, Zed, OpenCode — the config block is the same JSON.${RESET}\n"
sleep 3
