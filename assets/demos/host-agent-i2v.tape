# assets/demos/host-agent-i2v.tape — Surface 4: a host agent drives
# the primitive pipeline (t2i → i2v → narration → mux), no scene
# authoring. Recorded with Claude Code; the same flow works on any
# host that reads AGENTS.md.
#
# Renders → assets/demos/host-agent-i2v.mp4
#
# Where host-agent.tape demonstrates skills + scene build (a STORYBOARD
# becomes a multi-beat cinematic), this one demonstrates the OTHER
# canonical VibeFrame flow: chain individual generation primitives to
# produce a single short clip. Same surface (any host agent),
# different CLI subcommands.
#
# Primitive chain:
#   1. gpt-image-2 (text-to-image, HD)              — $0.04
#   2. fal.ai Seedance 2.0 (image-to-video, 5s)     — $0.50–$1.50
#   3. ElevenLabs (TTS narration)                    — $0.01
#   4. ffmpeg / vibe audio mux (overlay narration)
#
# Total cost: ~$1–$2 per recording. Wall-clock: ~5–8 min. The Seedance
# call dominates (i2v rendering can take 60–180s) and is non-cacheable.
#
# Recipe:
#   brew install vhs
#   export ANTHROPIC_API_KEY=...    # Claude Code
#   export OPENAI_API_KEY=...       # gpt-image-2
#   export FAL_KEY=...              # Seedance 2.0
#   export ELEVENLABS_API_KEY=...   # TTS
#   vhs assets/demos/host-agent-i2v.tape

Output assets/demos/host-agent-i2v.mp4

Set FontSize 12
Set Width 1400
Set Height 900
Set Padding 20
Set Theme "Catppuccin Mocha"
Set Shell "bash"
Set TypingSpeed 30ms

Type "cd ~/dev/personal/lab/vibeframe-lab && mkdir -p claude-i2v-demo && cd claude-i2v-demo && pwd"
Enter
Sleep 2s

Type "vibe init . --agent claude-code"
Enter
Sleep 5s

Type "clear"
Enter
Sleep 500ms

Type "claude --dangerously-skip-permissions"
Enter
Sleep 8s

# Trust dialog — accept this folder.
Type "1"
Enter
Sleep 4s

# Tight directive prompt — chain three generation primitives, end
# with a 5-second narrated clip. Naming the providers explicitly so
# Claude doesn't pick alternatives (e.g. Gemini for image, Kling for
# video). The prompt mirrors what an actual user would write.
Type 'Make a 5-second 16:9 cinematic clip about VibeFrame using these primitives. (1) Generate a backdrop image with vibe generate image -p openai -m 2 --quality hd --size 1536x1024. Prompt: cinematic minimalist tech aesthetic, deep navy black with electric blue volumetric light, faint grain, premium Apple keynote mood, no text. Save it as backdrop.png. (2) Animate that backdrop into a 5-second video with vibe generate video -p fal -i backdrop.png -d 5. Prompt: slow camera push-in toward the centre, subtle blue glow pulsing, smooth motion. Save it as motion.mp4. (3) Generate narration with vibe generate speech "Stop fighting timelines. VibeFrame ships cinematic video as code." -o narration.mp3. (4) Mux the narration over the video using ffmpeg -i motion.mp4 -i narration.mp3 -c:v copy -shortest final.mp4. Show me the final MP4 path when done.'
Enter

# Generous slack: t2i ~30s + i2v 60–180s + TTS ~5s + mux ~5s + Claude
# multi-turn overhead. Total ~5–7 min worst-case.
Sleep 540s

Ctrl+D
Sleep 3s

Type "ls *.mp4 *.png *.mp3 2>/dev/null"
Enter
Sleep 5s
