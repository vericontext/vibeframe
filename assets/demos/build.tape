# build.tape — `vibe scene build` cached-path demo (no API spend)
#
# Output:     assets/demos/build.mp4
# Family:     quick-aid
# Prereqs:    - cached compose for `examples/vibeframe-promo` in
#               ~/.vibeframe/cache/compose-scenes/. If absent, run
#               `vibe scene build examples/vibeframe-promo` once from
#               the repo root before recording.
#             - lab dir at ~/dev/personal/lab/vibeframe-lab
# Env:        none (cache hit path — no provider calls)
# Wall-clock: ~25s
#
# Copies the repo's `vibeframe-promo` fixture into the lab dir, shows
# the storyboard, runs `vibe scene build . --skip-render`. Compose hits
# the sha256 cache so the recording stays under a minute.

Output assets/demos/build.mp4

Set FontSize 14
Set Width 1280
Set Height 800
Set Padding 24
Set TypingSpeed 50ms
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
