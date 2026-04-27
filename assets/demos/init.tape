# assets/demos/init.tape — `vibe init` project-scope scaffold
#
# Renders → assets/demos/init.gif
#
# Captures: cd to a fresh dir under the lab → `vibe init . --agent all`
# → list scaffolded files → head AGENTS.md to show generated content style.

Output assets/demos/init.gif

Set FontSize 14
Set Width 1280
Set Height 800
Set Padding 24
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
