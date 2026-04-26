#!/usr/bin/env bash
#
# scripts/record-vhs.sh — Re-render the three VHS demo GIFs in assets/demos/.
#
# Prerequisites (all macOS / Linux):
#   - vhs       — `brew install vhs` (macOS) or download from
#                 https://github.com/charmbracelet/vhs/releases (Linux)
#   - vibe      — built locally; `pnpm -F @vibeframe/cli build`
#   - ANTHROPIC_API_KEY in environment (compose-scenes-with-skills cache
#                                        hits still validate the env var)
#
# What it produces:
#   assets/demos/setup.gif    — `vibe setup --claude-code` + `vibe doctor` + `vibe setup --show`
#   assets/demos/init.gif     — `vibe init . --agent all` in a fresh tempdir
#   assets/demos/build.gif    — `vibe scene build examples/vibeframe-promo --skip-render`
#
# The GIFs replace the v0.57-era asciinema SVGs that lived alongside them
# (vibeframe-quickstart.svg, vibeframe-agent.svg, vibeframe-claude-code.svg).
# Those captured the "three surfaces" framing; v0.61's wizard re-frames the
# same flow as a four-step on-ramp (install → setup → init → build).

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

TAPES=(
  "assets/demos/setup.tape"
  "assets/demos/init.tape"
  "assets/demos/build.tape"
)

for tape in "${TAPES[@]}"; do
  echo "→ Recording $tape ..."
  vhs "$tape"
  echo
done

echo "✓ Done. GIFs written under assets/demos/."
echo "  Review:"
ls -la assets/demos/*.gif 2>/dev/null || echo "  (no .gif files were produced — check the vhs output above)"
