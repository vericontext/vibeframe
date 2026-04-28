# agent.tape — Surface 2: vibe agent REPL (built-in BYO-LLM)
#
# Output:     assets/demos/agent.mp4
# Family:     surface
# Prereqs:    lab dir at ~/dev/personal/lab/vibeframe-lab
# Env:        OPENAI_API_KEY (default agent LLM + gpt-image-2),
#             ELEVENLABS_API_KEY (TTS)
# Wall-clock: ~6 min (agent multi-turn + 3 HD backdrops + TTS + render)
#
# Captures the standalone REPL surface: a single -i prompt drives the
# whole scene-build flow without any external host agent. Same end
# product as cli.tape, different surface — proves the REPL is
# self-sufficient for users without Claude Code / Codex / Cursor.

Output assets/demos/agent.mp4

Set FontSize 12
Set Width 1400
Set Height 900
Set Padding 20
Set TypingSpeed 30ms
Set Theme "Catppuccin Mocha"
Set Shell "bash"

Type "cd ~/dev/personal/lab/vibeframe-lab && rm -rf agent-demo && mkdir -p agent-demo && cd agent-demo && pwd"
Enter
Sleep 2s

# Single-turn directive: REPL reads the -i prompt, plans the
# scene-build flow, dispatches narration TTS + HD backdrops + compose
# + render, then exits when --max-turns is hit or the goal is met.
# Long single line because VHS `Type` doesn't support multi-line
# string literals — keep the prompt structurally close to what a real
# user would paste.
Type 'vibe agent --max-turns 10 -i "Use vibe scene build to make a 12-second 16:9 promo about VibeFrame in the Swiss Pulse visual identity. Project name: agent-promo. Three beats of 4 seconds each. Hook narration: Stop fighting timelines. Author scenes the way you write code. Claim narration: VibeFrame composes videos from your storyboard. Thirteen AI providers. Skills-driven authoring. Close narration: VibeFrame is open source under MIT. Ship cinematic video as code. Each beat needs a narration cue and a backdrop cue. Use HD image quality. Show me the rendered MP4 path when done."'
Enter
Sleep 360s

Type "find agent-promo -name '*.mp4' 2>/dev/null"
Enter
Sleep 5s
