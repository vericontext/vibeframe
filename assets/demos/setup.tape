# setup.tape — `vibe setup` user-scope wizard (read-only beats)
#
# Output:     assets/demos/setup.mp4
# Family:     quick-aid
# Prereqs:    `vibe` on PATH, a writable lab dir at ~/dev/personal/lab/vibeframe-lab
# Env:        none (read-only — no API key prompts to fake-type)
# Wall-clock: ~15s
#
# Captures the three read-only setup surfaces back to back:
#   1. `vibe doctor`          — scope-aware status
#   2. `vibe setup --claude-code` — integration guide for one host
#   3. `vibe setup --show`    — config dump

Output assets/demos/setup.mp4

Set FontSize 14
Set Width 1280
Set Height 800
Set Padding 24
Set TypingSpeed 50ms
Set Theme "Catppuccin Mocha"
Set Shell "bash"

Type "cd ~/dev/personal/lab/vibeframe-lab && mkdir -p setup-demo && cd setup-demo"
Enter
Sleep 500ms

# Beat 1 — vibe doctor (scope-aware status)
Type "vibe doctor"
Enter
Sleep 4s

Type "clear"
Enter
Sleep 500ms

# Beat 2 — host-specific integration guide
Type "vibe setup --claude-code"
Enter
Sleep 3s

Type "clear"
Enter
Sleep 500ms

# Beat 3 — config dump
Type "vibe setup --show"
Enter
Sleep 4s
