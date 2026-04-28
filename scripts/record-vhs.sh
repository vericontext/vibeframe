#!/usr/bin/env bash
#
# scripts/record-vhs.sh — Re-render the VHS demos in assets/demos/.
#
# Prerequisites (all macOS / Linux):
#   - vhs       — `brew install vhs` (macOS) or download from
#                 https://github.com/charmbracelet/vhs/releases (Linux)
#   - vibe      — `npm install -g @vibeframe/cli@latest`
#   - claude    — `claude` on PATH for host-agent.tape / host-agent-i2v.tape
#                 (Anthropic Claude Code drives those recordings)
#   - ANTHROPIC_API_KEY, OPENAI_API_KEY, ELEVENLABS_API_KEY, FAL_KEY in env
#     (compose-scenes-with-skills + gpt-image-2 backdrops + TTS narration
#     + Seedance 2.0 i2v for the host-agent-i2v primitive chain)
#
# What it produces (all .mp4 since v0.72):
#   ── Quick-aid family (cheap, fast, deterministic) ───────────────
#   assets/demos/setup.mp4    — `vibe doctor` + `vibe setup --claude-code` + `vibe setup --show`
#   assets/demos/init.mp4     — `vibe init . --agent all` in a fresh tempdir
#   assets/demos/build.mp4    — `vibe scene build examples/vibeframe-promo --skip-render`
#
#   ── Surface family (real API calls, real videos) ────────────────
#   assets/demos/cli.mp4              — Surface 1: vibe CLI directly, hand-authored STORYBOARD
#   assets/demos/agent.mp4            — Surface 2: vibe agent REPL, natural-language driven
#   assets/demos/host-agent.mp4       — Surface 3: host agent → scene-build (story, multi-beat)
#   assets/demos/host-agent-i2v.mp4   — Surface 4: host agent → t2i + i2v + narration (primitive chain)
#
# Each surface MP4 ends with a real cinematic output, not just terminal text.
# Tape index + per-tape settings: see assets/demos/README.md.
#
# Total wall-clock for the surface MP4s: ~25–30 min, ~$0.80–$1.70 in API
# spend. Use SKIP_SURFACES=1 to record only the three quick-aid demos.

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

QUICK_AID_TAPES=(
  "assets/demos/setup.tape"
  "assets/demos/init.tape"
  "assets/demos/build.tape"
)

# Long-running, real-API-spend, end-with-MP4 surface demos. Skip with
# SKIP_SURFACES=1 to only re-record the cheap quick-aid demos.
SURFACE_TAPES=(
  "assets/demos/cli.tape"
  "assets/demos/agent.tape"
  "assets/demos/host-agent.tape"
  # Host agent + primitive chain (t2i → i2v → narration → mux). Showcases
  # the non-scene-build path through gpt-image-2 + Seedance 2.0 + TTS.
  "assets/demos/host-agent-i2v.tape"
)

ALL_TAPES=("${QUICK_AID_TAPES[@]}")
if [ "${SKIP_SURFACES:-0}" != "1" ]; then
  ALL_TAPES+=("${SURFACE_TAPES[@]}")
  if ! command -v claude >/dev/null 2>&1; then
    echo "⚠  claude not on PATH — host-agent*.tape will fail. Install Claude Code or set SKIP_SURFACES=1." >&2
  fi
fi

for tape in "${ALL_TAPES[@]}"; do
  echo "→ Recording $tape ..."
  vhs "$tape"
  echo
done

echo "✓ Done. Demos written under assets/demos/."
echo "  Review:"
ls -la assets/demos/*.mp4 2>/dev/null || echo "  (no demos produced — check the vhs output above)"
