# assets/demos/setup.tape — `vibe setup` user-scope wizard (read-only beats)
#
# Renders → assets/demos/setup.gif
#
# Captures: vibe doctor (scope-aware status) → vibe setup --claude-code
# (integration guide) → vibe setup --show (config dump). Read-only
# commands only — no API key prompts to fake-type, no mutating state.

Output assets/demos/setup.gif

Set FontSize 14
Set Width 1280
Set Height 720
Set Padding 24
Set Theme "Catppuccin Mocha"
Set Shell "bash"

Type "cd ~/dev/personal/lab/vibeframe-lab && mkdir -p setup-demo && cd setup-demo"
Enter
Sleep 500ms

Type "vibe doctor"
Enter
Sleep 4s

Type "clear"
Enter
Sleep 500ms

Type "vibe setup --claude-code"
Enter
Sleep 3s

Type "clear"
Enter
Sleep 500ms

Type "vibe setup --show"
Enter
Sleep 4s
