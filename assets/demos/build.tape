# assets/demos/build.tape — VHS recording for `vibe scene build` (one-shot
# storyboard → MP4 flow that produces the cinematic v0.60 demo).
#
# Renders → assets/demos/build.gif
#
# Recipe:
#   brew install vhs                       # macOS
#   vhs assets/demos/build.tape            # produces build.gif
#
# Captures the v0.60+ storyboard-driven flow:
#   1. `cat STORYBOARD.md` — show the per-beat YAML cues users author
#   2. `vibe scene build --skip-render` — dispatch primitives + compose
#      (skip render to keep the GIF short and avoid Chrome dependency)
#   3. Final `tree compositions assets` — show what landed
#
# Prerequisites for a clean recording:
#   - cwd = repo root
#   - examples/vibeframe-promo/ has cached compose results
#     (~/.vibeframe/cache/compose-scenes/*.html — automatic on second run)
#   - ANTHROPIC_API_KEY set (compose still validates env even on cache hit)
#   - For the full render, drop --skip-render and depend on Chrome being
#     installed; render typically takes ~15s for a 9s composition.

Output assets/demos/build.gif

Set FontSize 13
Set Width 1280
Set Height 900
Set Padding 24
Set Theme "Catppuccin Mocha"
Set Shell "bash"

Type "clear"
Enter
Sleep 500ms

# 1. show the storyboard with cues
Type "# the storyboard — per-beat YAML cues drive primitive dispatch"
Enter
Type "head -30 examples/vibeframe-promo/STORYBOARD.md"
Enter
Sleep 5s

# 2. run scene build
Type "clear"
Enter
Sleep 500ms
Type "# vibe scene build — dispatches narration + backdrops, composes scenes"
Enter
Type "vibe scene build examples/vibeframe-promo --skip-render"
Enter
Sleep 12s

# 3. inspect the result
Type "clear"
Enter
Sleep 500ms
Type "# what landed"
Enter
Type "ls examples/vibeframe-promo/compositions/ examples/vibeframe-promo/assets/"
Enter
Sleep 4s
