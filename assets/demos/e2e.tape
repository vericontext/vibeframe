# assets/demos/e2e.tape — End-to-end VibeFrame demo
#
# Renders → assets/demos/e2e.mp4
#
# Captures the full "fresh machine → cinematic MP4" flow:
#   1. curl install (real install.sh from vibeframe.ai)
#   2. vibe doctor — fresh state, scope NOT SET
#   3. vibe init . --agent claude-code — scaffold AGENTS.md / CLAUDE.md
#   4. claude --dangerously-skip-permissions — open Claude Code
#   5. Natural-language prompt asking for a 9-second 16:9 promo
#   6. Claude reads AGENTS.md, discovers BUILD path, calls
#      `vibe scene init` + writes STORYBOARD.md + runs `vibe scene build`
#   7. Show the rendered MP4
#
# Recipe:
#   brew install vhs                                  # one-time
#   export ANTHROPIC_API_KEY=...                      # required (compose + Claude Code)
#   export OPENAI_API_KEY=...                         # required (gpt-image-2 backdrops)
#   export ELEVENLABS_API_KEY=...                     # required (narration TTS)
#   vhs assets/demos/e2e.tape                         # ~5–10 min real-time
#
# Costs: ~$0.20–$0.50 (Sonnet compose + 3 backdrops + 3 narrations).
#
# Output is MP4 (not GIF) because GIFs at this length blow past 50 MB.
# Embed in markdown via `<video src="..." controls></video>`.

Output assets/demos/e2e.mp4

Set FontSize 12
Set Width 1400
Set Height 900
Set Padding 20
Set Theme "Catppuccin Mocha"
Set Shell "bash"
Set TypingSpeed 30ms

# Land in a fresh tempdir so the recording has zero pre-state
Type "cd $(mktemp -d -t vibe-e2e-XXX) && pwd"
Enter
Sleep 2s

# ── 1. Install ──────────────────────────────────────────────
Type "# 1. Install VibeFrame from vibeframe.ai"
Enter
Type "curl -fsSL https://vibeframe.ai/install.sh | bash"
Enter
Sleep 30s

# ── 2. Doctor — fresh-machine state ─────────────────────────
Type "clear"
Enter
Sleep 500ms
Type "# 2. Check the install"
Enter
Type "vibe doctor"
Enter
Sleep 6s

# ── 3. Init — scaffold agent files ──────────────────────────
Type "clear"
Enter
Sleep 500ms
Type "# 3. Scaffold the project — AGENTS.md, CLAUDE.md, .env.example"
Enter
Type "vibe init . --agent claude-code"
Enter
Sleep 5s

# ── 4. Hand off to Claude Code ──────────────────────────────
Type "clear"
Enter
Sleep 500ms
Type "# 4. Open Claude Code (will read CLAUDE.md → AGENTS.md automatically)"
Enter
Type "claude --dangerously-skip-permissions"
Enter
Sleep 12s

# ── 5. Natural-language prompt ──────────────────────────────
Type "Create a 9-second 16:9 promo about VibeFrame in the Swiss Pulse visual identity (electric blue + Inter Bold on near-black). Three beats: hook (Type a YAML.), claim (Get a video.), close (VibeFrame · Open source · MIT). Each beat 3 seconds. Use vibe scene build with per-beat YAML cues for narration and backdrop. Show me the rendered MP4 path when done."
Enter

# Claude needs:
#   - read AGENTS.md (scaffolded by vibe init)
#   - run `vibe scene init my-promo --visual-style "Swiss Pulse"`
#   - write STORYBOARD.md with 3 beats + cues
#   - run `vibe scene build my-promo`
#   - report the renders/*.mp4 path
#
# Sonnet on a clean directory reading AGENTS.md typically lands the right
# chain in 3–7 minutes. The 12-minute sleep gives plenty of slack and
# we'll trim trailing dead time post-record with ffmpeg if needed.
Sleep 720s

# ── 6. Wrap up ──────────────────────────────────────────────
Ctrl+D
Sleep 3s
Type "ls my-promo/renders/ 2>/dev/null || echo 'no renders/ — Claude may have used a different project name'"
Enter
Sleep 4s
