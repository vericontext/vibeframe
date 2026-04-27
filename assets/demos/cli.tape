# assets/demos/cli.tape — Surface 1: vibe CLI directly (no agent)
#
# Renders → assets/demos/cli.mp4
#
# Hand-authored STORYBOARD with rich per-beat YAML cues, then
# `vibe scene build` → narrated, captioned 12-second cinematic MP4.

Output assets/demos/cli.mp4

Set FontSize 12
Set Width 1400
Set Height 900
Set Padding 20
Set Theme "Catppuccin Mocha"
Set Shell "bash"
Set TypingSpeed 30ms

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

Type "cat > my-promo/STORYBOARD.md <<'STORY'"
Enter
Type "# VibeFrame promo storyboard"
Enter
Type ""
Enter
Type "## Beat hook — Hook"
Enter
Type ""
Enter
Type '```yaml'
Enter
Type 'narration: "Stop fighting timelines. Author scenes the way you write code — every edit a command, every workflow scriptable."'
Enter
Type 'backdrop: "Abstract minimalist tech aesthetic, electric blue volumetric light glow on near-black, faint grain texture, cinematic Apple keynote mood, no text"'
Enter
Type "duration: 4"
Enter
Type '```'
Enter
Type ""
Enter
Type "## Beat claim — Claim"
Enter
Type ""
Enter
Type '```yaml'
Enter
Type 'narration: "VibeFrame composes videos from your storyboard. Thirteen AI providers. Skills-driven scene authoring. One command from text to MP4."'
Enter
Type 'backdrop: "Cinematic close-up of a glowing code editor on a dark monitor, electric blue YAML syntax visible, shallow depth of field bokeh, premium developer aesthetic"'
Enter
Type "duration: 4"
Enter
Type '```'
Enter
Type ""
Enter
Type "## Beat close — Close"
Enter
Type ""
Enter
Type '```yaml'
Enter
Type 'narration: "VibeFrame is open source under MIT. Install with one curl line, ship cinematic video as code."'
Enter
Type 'backdrop: "Premium dark hardware surface with subtle electric blue LED dot pattern grid, soft rim lighting, deep blacks, abstract geometric tech aesthetic"'
Enter
Type "duration: 4"
Enter
Type '```'
Enter
Type "STORY"
Enter
Sleep 2s

Type "head -25 my-promo/STORYBOARD.md"
Enter
Sleep 4s

Type "clear"
Enter
Sleep 500ms

Type "vibe scene build my-promo"
Enter
# Real fresh build for 3 beats × 4s with HD backdrops. Generous slack
# because OpenAI gpt-image-2 occasionally serves 503s and the SDK
# retries internally — a single transient can push the whole phase to
# 5+ minutes. Trailing dead time gets trimmed post-record with ffmpeg.
Sleep 360s

Type "clear"
Enter
Sleep 500ms

Type "ls my-promo/renders/"
Enter
Sleep 5s
