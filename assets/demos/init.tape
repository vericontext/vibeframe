# assets/demos/init.tape — VHS recording for `vibe init` (project-scope scaffold)
#
# Renders → assets/demos/init.gif
#
# Recipe:
#   brew install vhs                       # macOS
#   vhs assets/demos/init.tape             # produces init.gif
#
# Captures the project-scope scaffolder end-to-end:
#   1. mktemp + cd into a fresh dir
#   2. `vibe init . --agent all`           — write AGENTS.md / CLAUDE.md / .env.example / .gitignore / vibe.project.yaml
#   3. `ls -la`                            — show what landed
#   4. `head -20 AGENTS.md`                — show the generated content style
#
# `--agent all` writes both the cross-tool AGENTS.md and the Claude Code
# CLAUDE.md so the recording demonstrates both files. Drop to `--agent
# claude-code` or `--agent codex` for a single-host scaffold.

Output assets/demos/init.gif

Set FontSize 14
Set Width 1280
Set Height 800
Set Padding 24
Set Theme "Catppuccin Mocha"
Set Shell "bash"

Type "clear"
Enter
Sleep 500ms

# 1. fresh project dir
Type "# fresh project dir, then `vibe init`"
Enter
Type "cd $(mktemp -d -t vibe-init-demo-XXX)"
Enter
Sleep 500ms
Type "pwd"
Enter
Sleep 1s

# 2. init
Type "vibe init . --agent all"
Enter
Sleep 3s

# 3. inspect what landed
Type "ls -la"
Enter
Sleep 2s

# 4. peek at AGENTS.md
Type "head -20 AGENTS.md"
Enter
Sleep 4s
