# host-agent.tape — Surface 3: end-to-end via a host agent
#
# Output:     assets/demos/host-agent.mp4
# Family:     surface
# Prereqs:    lab dir at ~/dev/personal/lab/vibeframe-lab,
#             `claude` CLI on PATH (recorded with Claude Code)
# Env:        ANTHROPIC_API_KEY (Claude Code),
#             OPENAI_API_KEY (gpt-image-2 backdrops),
#             ELEVENLABS_API_KEY (TTS)
# Wall-clock: ~12 min (host-agent multi-turn + curl install + scene build)
#
# Captures the full out-of-the-box flow: curl install → vibe init →
# host agent (Claude Code in this recording) reads AGENTS.md → user
# describes the video in natural language → agent drives the full
# scene-build flow → cinematic 12-second MP4.
#
# The same flow works on any host that reads AGENTS.md
# (Codex / Cursor / Aider / Gemini CLI / OpenCode) — re-record on
# your favourite host with `vhs <tape>` after exporting that host's
# API key.

Output assets/demos/host-agent.mp4

Set FontSize 12
Set Width 1400
Set Height 900
Set Padding 20
Set TypingSpeed 30ms
Set Theme "Catppuccin Mocha"
Set Shell "bash"

Type "cd ~/dev/personal/lab/vibeframe-lab && mkdir -p claude-demo && cd claude-demo && pwd"
Enter
Sleep 2s

# Beat 1 — curl install (decline the post-install setup wizard prompt)
Type "curl -fsSL https://vibeframe.ai/install.sh | bash"
Enter
# install.sh prompts "Run setup wizard now? (Y/n)" at the end. Decline
# (n) so the recording stays focused on the project flow — setup is
# already covered on setup.tape.
Sleep 25s
Type "n"
Sleep 4s

Type "clear"
Enter
Sleep 500ms

# Beat 2 — sanity check
Type "vibe doctor"
Enter
Sleep 6s

Type "clear"
Enter
Sleep 500ms

# Beat 3 — project-scope scaffold (writes AGENTS.md + CLAUDE.md)
Type "vibe init . --agent claude-code"
Enter
Sleep 5s

Type "clear"
Enter
Sleep 500ms

# Beat 4 — host agent takes over (Claude Code in this recording)
Type "claude --dangerously-skip-permissions"
Enter
Sleep 8s

# Trust dialog: "Quick safety check ... 1. Yes, I trust this folder"
# Accept with 1, then a tight pause for Claude to finish initialising.
Type "1"
Enter
Sleep 4s

# Beat 5 — natural-language directive. Claude reads AGENTS.md, picks
# scene init / scene build, dispatches narration TTS + HD backdrops +
# compose + render. 12-min slack for the full flow.
Type 'Create a 12-second 16:9 promo about VibeFrame in the Swiss Pulse visual identity (electric blue + Inter Bold on near-black). Three beats of 4 seconds each. Hook narration: Stop fighting timelines. Author scenes the way you write code — every edit a command, every workflow scriptable. Claim narration: VibeFrame composes videos from your storyboard. Thirteen AI providers. Skills-driven authoring. One command from text to MP4. Close narration: VibeFrame is open source under MIT. Install with one curl line, ship cinematic video as code. Use vibe scene build with per-beat YAML cues for narration and backdrop. Use HD image quality for backdrops. Show me the rendered MP4 path when done.'
Enter
Sleep 720s

Ctrl+D
Sleep 3s

Type "find . -name '*.mp4' -path '*/renders/*' 2>/dev/null"
Enter
Sleep 5s
