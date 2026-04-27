# assets/demos/build.tape — `vibe scene build` cached-path demo
#
# Renders → assets/demos/build.gif
#
# Copies the repo's vibeframe-promo fixture into the lab dir, shows
# the storyboard, runs `vibe scene build .` against it. Compose hits
# the sha256 cache (~/.vibeframe/cache/compose-scenes/) so the
# recording stays under a minute and produces no API spend.
#
# Prereqs: the cache should already contain the 3 vibeframe-promo
# beats. If not, run `vibe scene build examples/vibeframe-promo` once
# from the repo root before recording.

Output assets/demos/build.gif

Set FontSize 13
Set Width 1280
Set Height 900
Set Padding 24
Set Theme "Catppuccin Mocha"
Set Shell "bash"

Type "cd ~/dev/personal/lab/vibeframe-lab && rm -rf build-demo && cp -r ~/dev/vericontext/vibeframe/examples/vibeframe-promo build-demo && cd build-demo && pwd"
Enter
Sleep 1s

Type "head -30 STORYBOARD.md"
Enter
Sleep 5s

Type "clear"
Enter
Sleep 500ms

Type "vibe scene build . --skip-render"
Enter
Sleep 12s

Type "clear"
Enter
Sleep 500ms

Type "ls compositions/ assets/"
Enter
Sleep 4s
