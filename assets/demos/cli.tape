# assets/demos/cli.tape — Surface 1: vibe CLI directly (no agent)
#
# Renders → assets/demos/cli.mp4
#
# The "scripted, no-agent" path. User scaffolds a scene project, hand-
# authors the STORYBOARD.md with per-beat YAML cues, runs `vibe scene
# build`, opens the resulting MP4.
#
# This is the surface that replaces `assets/demos/vibeframe-quickstart.svg`
# (the v0.57-era asciinema). Same value prop — "I author scenes, vibe
# renders" — but now ends with a real cinematic MP4 instead of a
# captioned silent clip.
#
# Recipe:
#   brew install vhs
#   export ANTHROPIC_API_KEY=...   # compose-scenes-with-skills
#   export OPENAI_API_KEY=...      # gpt-image-2 backdrops
#   export ELEVENLABS_API_KEY=...  # narration TTS
#   vhs assets/demos/cli.tape      # ~3–5 min, ~$0.20–$0.50

Output assets/demos/cli.mp4

Set FontSize 12
Set Width 1400
Set Height 900
Set Padding 20
Set Theme "Catppuccin Mocha"
Set Shell "bash"
Set TypingSpeed 30ms

# Land in a fresh tempdir so nothing carries over from prior recordings
Type "cd $(mktemp -d -t vibe-cli-demo-XXX) && pwd"
Enter
Sleep 2s

# ── 1. Scaffold ─────────────────────────────────────────────
Type "# 1. Scaffold a scene project — seeds DESIGN.md from the named identity"
Enter
Type 'vibe scene init my-promo --visual-style "Swiss Pulse" -d 9'
Enter
Sleep 5s

Type "ls my-promo/"
Enter
Sleep 3s

# ── 2. Author STORYBOARD.md with per-beat YAML cues ─────────
Type "clear"
Enter
Sleep 500ms
Type "# 2. Author STORYBOARD.md — per-beat YAML cues drive the build"
Enter
Type "cat > my-promo/STORYBOARD.md <<'STORY'"
Enter
Type "# Storyboard"
Enter
Type ""
Enter
Type "## Beat hook — Hook"
Enter
Type ""
Enter
Type '```yaml'
Enter
Type 'narration: "Type a YAML."'
Enter
Type 'backdrop: "Abstract minimalist tech, electric blue glow on near-black"'
Enter
Type "duration: 3"
Enter
Type '```'
Enter
Type ""
Enter
Type "## Beat claim — Claim"
Enter
Type ""
Enter
Type '```yaml'
Enter
Type 'narration: "Get a video."'
Enter
Type 'backdrop: "Code editor with YAML on dark monitor, shallow depth of field"'
Enter
Type "duration: 3"
Enter
Type '```'
Enter
Type ""
Enter
Type "## Beat close — Close"
Enter
Type ""
Enter
Type '```yaml'
Enter
Type 'narration: "VibeFrame. Open source."'
Enter
Type 'backdrop: "Hardware surface, blue LED dot pattern, deep blacks"'
Enter
Type "duration: 3"
Enter
Type '```'
Enter
Type "STORY"
Enter
Sleep 2s

Type "head -20 my-promo/STORYBOARD.md"
Enter
Sleep 4s

# ── 3. Build ────────────────────────────────────────────────
Type "clear"
Enter
Sleep 500ms
Type "# 3. vibe scene build — TTS + image-gen per beat, compose, render"
Enter
Type "vibe scene build my-promo"
Enter
Sleep 120s

# ── 4. Show result ──────────────────────────────────────────
Type "clear"
Enter
Sleep 500ms
Type "# 4. Result"
Enter
Type "ls my-promo/renders/"
Enter
Sleep 4s
