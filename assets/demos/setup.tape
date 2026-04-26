# assets/demos/setup.tape — VHS recording for `vibe setup` (user-scope wizard)
#
# Renders → assets/demos/setup.gif
#
# Recipe:
#   brew install vhs                       # macOS
#   vhs assets/demos/setup.tape            # produces setup.gif
#
# This tape captures the user-scope wizard's main beats:
#   1. `vibe doctor` — scope-aware status (User / Project / Agents)
#   2. `vibe setup --claude-code` — integration guide (non-interactive)
#   3. `vibe setup --show` — current config (masked API keys)
#
# We avoid recording the interactive prompt flow because it would either
# require real API keys (rotated and unsafe to ship) or a long fake-typing
# sequence that would dwarf the actual UX point. Doctor + show + guide
# capture the same information in 30 seconds.

Output assets/demos/setup.gif

Set FontSize 14
Set Width 1280
Set Height 720
Set Padding 24
Set Theme "Catppuccin Mocha"
Set Shell "bash"

# Clear shell + show prompt
Type "clear"
Enter
Sleep 500ms

# 1. vibe doctor — show v0.61 scope diagnostics
Type "# 1. vibe doctor — scope-aware status (v0.61)"
Enter
Type "vibe doctor"
Enter
Sleep 4s

# 2. integration guide
Type "clear"
Enter
Sleep 500ms
Type "# 2. vibe setup --claude-code — integration guide"
Enter
Type "vibe setup --claude-code"
Enter
Sleep 3s

# 3. show current configuration
Type "clear"
Enter
Sleep 500ms
Type "# 3. vibe setup --show — current user-scope config"
Enter
Type "vibe setup --show"
Enter
Sleep 4s
