# assets/demos/agent.tape — Surface 2: vibe agent REPL (natural language)
#
# Renders → assets/demos/agent.mp4
#
# The "BYO LLM, no IDE" path. `vibe agent` opens a REPL that discovers
# every CLI tool from `vibe schema --list`, picks the right one based
# on the user's English prompt, and chains calls with structured
# tool-use under a `--max-turns` cap.
#
# Replaces `assets/demos/vibeframe-agent.svg` (v0.57-era asciinema).
# Same value prop — "BYO LLM, natural language → tool calls" — now
# producing a real video instead of editing an existing clip.
#
# Recipe:
#   brew install vhs
#   export ANTHROPIC_API_KEY=...    # vibe agent default provider
#   export OPENAI_API_KEY=...       # gpt-image-2 backdrops (when agent picks scene-build)
#   export ELEVENLABS_API_KEY=...   # narration TTS
#   vhs assets/demos/agent.tape     # ~5–8 min, ~$0.30–$0.70 (multi-turn LLM + scene build)

Output assets/demos/agent.mp4

Set FontSize 12
Set Width 1400
Set Height 900
Set Padding 20
Set Theme "Catppuccin Mocha"
Set Shell "bash"
Set TypingSpeed 30ms

Type "cd $(mktemp -d -t vibe-agent-demo-XXX) && pwd"
Enter
Sleep 2s

Type "# Start the vibe agent REPL — defaults to Claude as the LLM"
Enter
Type "vibe agent --max-turns 8"
Enter
Sleep 10s

# Tight, directive prompt — the agent has full CLI access and is more
# reliable when told exactly which path to take. The point of this demo
# is the natural-language → CLI-call mapping, not the LLM picking a
# strategy. Keeping it concrete keeps the demo deterministic-ish.
Type 'Use vibe scene build to make a 9-second 16:9 promo about VibeFrame in the Swiss Pulse visual identity. Project name: agent-promo. Three beats of 3 seconds each — hook says Type a YAML., claim says Get a video., close says VibeFrame. Open source.. Each beat needs a narration cue and a backdrop cue in STORYBOARD.md. Show me the rendered MP4 path when done.'
Enter

# Agent multi-turn:
#   t1: read AGENTS.md / vibe doctor
#   t2: vibe scene init agent-promo --visual-style "Swiss Pulse"
#   t3-4: write STORYBOARD.md with cues
#   t5: vibe scene build agent-promo
#   t6: report renders/*.mp4 path
#
# 480s = 8 min slack. Trim trailing dead time post-record with ffmpeg
# if it finishes faster.
Sleep 480s

Type ":exit"
Enter
Sleep 3s

Type "ls agent-promo/renders/ 2>/dev/null || find . -name '*.mp4' 2>/dev/null"
Enter
Sleep 5s
