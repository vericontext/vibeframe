#!/usr/bin/env bash
#
# scripts/record-vhs.sh — Re-render the VHS demos in assets/demos/.
#
# Prerequisites (all macOS / Linux):
#   - vhs       — `brew install vhs` (macOS) or download from
#                 https://github.com/charmbracelet/vhs/releases (Linux)
#   - vibe      — `npm install -g @vibeframe/cli@latest`
#   - claude    — `claude` on PATH for e2e.tape (Anthropic Claude Code)
#   - ANTHROPIC_API_KEY, OPENAI_API_KEY, ELEVENLABS_API_KEY in env
#     (compose-scenes-with-skills + gpt-image-2 backdrops + TTS narration)
#
# What it produces:
#   ── Wizard scope (cheap, fast, deterministic) ───────────────────
#   assets/demos/setup.gif    — `vibe doctor` + `vibe setup --claude-code` + `vibe setup --show`
#   assets/demos/init.gif     — `vibe init . --agent all` in a fresh tempdir
#   assets/demos/build.gif    — `vibe scene build examples/vibeframe-promo --skip-render`
#
#   ── User-facing surfaces (real API calls, real videos) ──────────
#   assets/demos/cli.mp4      — Surface 1: vibe CLI directly, hand-authored STORYBOARD
#   assets/demos/agent.mp4    — Surface 2: vibe agent REPL, natural-language driven
#   assets/demos/e2e.mp4      — Surface 3: claude --dangerously-skip-permissions, end-to-end
#
# The MP4s replace the v0.57-era asciinema SVGs in README + landing
# (vibeframe-quickstart.svg, vibeframe-agent.svg, vibeframe-claude-code.svg).
# Each new MP4 ends with a real cinematic output, not just terminal text.
#
# Total wall-clock for the surface MP4s: ~25–30 min, ~$0.80–$1.70 in API
# spend. Use SKIP_SURFACES=1 to record only the three wizard GIFs.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v vhs >/dev/null 2>&1; then
  echo "✗ vhs not found on PATH." >&2
  echo "  Install: brew install vhs   (or https://github.com/charmbracelet/vhs/releases)" >&2
  exit 1
fi

if ! command -v vibe >/dev/null 2>&1; then
  echo "✗ vibe not found on PATH." >&2
  echo "  Build locally: pnpm -F @vibeframe/cli build && export PATH=\$REPO_ROOT/packages/cli/dist:\$PATH" >&2
  echo "  Or install:    npm install -g @vibeframe/cli" >&2
  exit 1
fi

WIZARD_TAPES=(
  "assets/demos/setup.tape"
  "assets/demos/init.tape"
  "assets/demos/build.tape"
)

# Long-running, real-API-spend, end-with-MP4 surface demos. Skip with
# SKIP_SURFACES=1 to only re-record the cheap wizard GIFs.
SURFACE_TAPES=(
  "assets/demos/cli.tape"
  "assets/demos/agent.tape"
  "assets/demos/e2e.tape"
)

ALL_TAPES=("${WIZARD_TAPES[@]}")
if [ "${SKIP_SURFACES:-0}" != "1" ]; then
  ALL_TAPES+=("${SURFACE_TAPES[@]}")
  if ! command -v claude >/dev/null 2>&1; then
    echo "⚠  claude not on PATH — e2e.tape will fail. Install Claude Code or set SKIP_SURFACES=1." >&2
  fi
fi

for tape in "${ALL_TAPES[@]}"; do
  echo "→ Recording $tape ..."
  vhs "$tape"
  echo
done

echo "✓ Done. Demos written under assets/demos/."
echo "  Review:"
ls -la assets/demos/*.gif assets/demos/*.mp4 2>/dev/null || echo "  (no demos produced — check the vhs output above)"
