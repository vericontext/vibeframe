# init.tape — `vibe init` project-scope scaffold (--agent all)
#
# Output:     assets/demos/init.mp4
# Family:     quick-aid
# Prereqs:    `vibe` on PATH, a writable lab dir at ~/dev/personal/lab/vibeframe-lab
# Env:        none
# Wall-clock: ~10s
#
# Captures the project-scope scaffold flow:
#   1. fresh empty dir
#   2. `vibe init . --agent all` — writes AGENTS.md (and host-specific files)
#   3. `ls -la`                  — show what landed
#   4. `head AGENTS.md`          — preview generated content style

Output assets/demos/init.mp4

Set FontSize 14
Set Width 1280
Set Height 800
Set Padding 24
Set TypingSpeed 50ms
Set Theme "Catppuccin Mocha"
Set Shell "bash"

Type "cd ~/dev/personal/lab/vibeframe-lab && rm -rf init-demo && mkdir init-demo && cd init-demo && pwd"
Enter
Sleep 1s

Type "vibe init . --agent all"
Enter
Sleep 3s

Type "ls -la"
Enter
Sleep 2s

Type "head -20 AGENTS.md"
Enter
Sleep 4s
