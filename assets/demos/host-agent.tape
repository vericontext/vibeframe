# assets/demos/host-agent.tape — Surface 3: end-to-end via a host agent
# (recorded with Claude Code; the same flow works on any host that
# reads AGENTS.md — Codex / Cursor / Aider / Gemini CLI / OpenCode).
#
# Renders → assets/demos/host-agent.mp4
#
# Captures: curl install → vibe init → host agent (Claude Code in the
# recording) reads AGENTS.md → user describes the video in natural
# language → agent drives the full scene build flow → cinematic
# 12-second MP4.

Output assets/demos/host-agent.mp4

Set FontSize 12
Set Width 1400
Set Height 900
Set Padding 20
Set Theme "Catppuccin Mocha"
Set Shell "bash"
Set TypingSpeed 30ms

Type "cd ~/dev/personal/lab/vibeframe-lab && mkdir -p claude-demo && cd claude-demo && pwd"
Enter
Sleep 2s

Type "curl -fsSL https://vibeframe.ai/install.sh | bash"
Enter
# install.sh prompts "Run setup wizard now? (Y/n)" at the end. Decline
# (n) so the recording stays focused on the project flow — setup is
# already on the wizard tape.
Sleep 25s
Type "n"
Sleep 4s

Type "clear"
Enter
Sleep 500ms

Type "vibe doctor"
Enter
Sleep 6s

Type "clear"
Enter
Sleep 500ms

Type "vibe init . --agent claude-code"
Enter
Sleep 5s

Type "clear"
Enter
Sleep 500ms

Type "claude --dangerously-skip-permissions"
Enter
Sleep 8s

# Trust dialog: "Quick safety check ... 1. Yes, I trust this folder"
# Accept with 1, then a tight pause for Claude to finish initialising.
Type "1"
Enter
Sleep 4s

Type 'Create a 12-second 16:9 promo about VibeFrame in the Swiss Pulse visual identity (electric blue + Inter Bold on near-black). Three beats of 4 seconds each. Hook narration: Stop fighting timelines. Author scenes the way you write code — every edit a command, every workflow scriptable. Claim narration: VibeFrame composes videos from your storyboard. Thirteen AI providers. Skills-driven authoring. One command from text to MP4. Close narration: VibeFrame is open source under MIT. Install with one curl line, ship cinematic video as code. Use vibe scene build with per-beat YAML cues for narration and backdrop. Use HD image quality for backdrops. Show me the rendered MP4 path when done.'
Enter

# Claude on a fresh project reads AGENTS.md, picks scene init / scene
# build, dispatches narration TTS + HD backdrops + compose + render.
# 12-min slack for the full flow.
Sleep 720s

Ctrl+D
Sleep 3s

Type "find . -name '*.mp4' -path '*/renders/*' 2>/dev/null"
Enter
Sleep 5s
