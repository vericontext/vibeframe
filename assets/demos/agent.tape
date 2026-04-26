# assets/demos/agent.tape — Surface 2: vibe agent REPL (natural language)
#
# Renders → assets/demos/agent.mp4

Output assets/demos/agent.mp4

Set FontSize 12
Set Width 1400
Set Height 900
Set Padding 20
Set Theme "Catppuccin Mocha"
Set Shell "bash"
Set TypingSpeed 30ms

Type "cd ~/dev/personal/lab/vibeframe-lab && mkdir -p agent-demo && cd agent-demo && pwd"
Enter
Sleep 2s

Type "vibe agent --max-turns 8"
Enter
Sleep 10s

Type 'Use vibe scene build to make a 12-second 16:9 promo about VibeFrame in the Swiss Pulse visual identity. Project name: agent-promo. Three beats of 4 seconds each. Hook narration: Stop fighting timelines. Author scenes the way you write code. Claim narration: VibeFrame composes videos from your storyboard. Thirteen AI providers. Skills-driven authoring. Close narration: VibeFrame is open source under MIT. Ship cinematic video as code. Each beat needs a narration cue and a backdrop cue. Use HD image quality. Show me the rendered MP4 path when done.'
Enter

# Agent multi-turn:
#   t1: read AGENTS.md / vibe doctor
#   t2: vibe scene init agent-promo --visual-style "Swiss Pulse"
#   t3-4: write STORYBOARD.md with cues
#   t5: vibe scene build agent-promo (~3-4 min)
#   t6: report renders/*.mp4 path
Sleep 540s

Type ":exit"
Enter
Sleep 3s

Type "ls agent-promo/renders/ 2>/dev/null || find . -name '*.mp4' 2>/dev/null"
Enter
Sleep 5s
