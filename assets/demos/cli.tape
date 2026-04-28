# cli.tape — Surface 1: vibe CLI directly (no agent)
#
# Output:     assets/demos/cli.mp4
# Family:     surface
# Prereqs:    - assets/demos/fixtures/storyboard-cli.md (the 3-beat fixture)
#             - lab dir at ~/dev/personal/lab/vibeframe-lab
# Env:        OPENAI_API_KEY (gpt-image-2), ELEVENLABS_API_KEY (TTS)
# Wall-clock: ~6 min (3 beats × HD backdrop + TTS + render)
#
# Hand-authored STORYBOARD with rich per-beat YAML cues, then
# `vibe scene build` → narrated, captioned 12-second cinematic MP4.
# The fixture lives at assets/demos/fixtures/storyboard-cli.md so the
# recording stays focused on the user-facing flow (init → cp → build).

Output assets/demos/cli.mp4

Set FontSize 12
Set Width 1400
Set Height 900
Set Padding 20
Set TypingSpeed 30ms
Set Theme "Catppuccin Mocha"
Set Shell "bash"

Type "cd ~/dev/personal/lab/vibeframe-lab && mkdir -p cli-demo && cd cli-demo && pwd"
Enter
Sleep 2s

Type 'vibe scene init my-promo --visual-style "Swiss Pulse" -d 12'
Enter
Sleep 5s

Type "ls my-promo/"
Enter
Sleep 3s

Type "clear"
Enter
Sleep 500ms

# Drop the prepared storyboard fixture into the project (replaces the
# 32-line heredoc the previous tape revision typed line by line).
Type "cp ~/dev/vericontext/vibeframe/assets/demos/fixtures/storyboard-cli.md my-promo/STORYBOARD.md"
Enter
Sleep 1s

Type "head -25 my-promo/STORYBOARD.md"
Enter
Sleep 4s

Type "clear"
Enter
Sleep 500ms

Type "vibe scene build my-promo"
Enter
# Real fresh build: 3 beats × 4s with HD backdrops. Generous slack
# because OpenAI gpt-image-2 occasionally serves 503s and the SDK
# retries internally — a single transient can push the whole phase
# past 5 min. Trailing dead time gets trimmed post-record with ffmpeg.
Sleep 360s

Type "clear"
Enter
Sleep 500ms

Type "ls my-promo/renders/"
Enter
Sleep 5s
