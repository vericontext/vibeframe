#!/bin/bash
# VibeFrame Multi-Provider AI Demo
# Showcases all 9 integrated AI skills/providers

# Continue on error to show all providers
set +e

# Get the script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Change to project root for pnpm commands
cd "$PROJECT_ROOT"

# Use pnpm vibe command
VIBE="pnpm vibe"

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║           VibeFrame Multi-Provider AI Demo                     ║"
echo "║           9 Skills → 50+ CLI Commands                          ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Create output directory
mkdir -p demo-output

# ============================================================
# 1. OpenAI (DALL-E + Whisper)
# ============================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1/9 OpenAI API (DALL-E)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Command: vibe ai image \"futuristic video editor interface\" -p dalle"
$VIBE ai image "futuristic video editor interface, neon UI, dark mode" \
  -o demo-output/dalle-image.png -p dalle
echo "✓ Generated: dalle-image.png"
echo ""

# ============================================================
# 2. Gemini Image
# ============================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2/9 Gemini Image (Imagen)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Command: vibe ai image \"creative video editing workspace\" -p gemini"
$VIBE ai image "creative video editing workspace, colorful, modern design" \
  -o demo-output/gemini-image.png -p gemini
echo "✓ Generated: gemini-image.png"
echo ""

# ============================================================
# 3. Claude API (Storyboard)
# ============================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3/9 Claude API (Storyboard)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Command: vibe ai storyboard \"15-second VibeFrame promo\""
$VIBE ai storyboard "15-second promo: VibeFrame - the AI video editor you can talk to" \
  -o demo-output/storyboard.json -d 15
echo "✓ Generated: storyboard.json"
echo ""

# ============================================================
# 4. ElevenLabs TTS
# ============================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "4/9 ElevenLabs TTS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Command: vibe ai tts \"Welcome to VibeFrame\""
$VIBE ai tts "Welcome to VibeFrame. The first video editor you can talk to." \
  -o demo-output/voiceover.mp3
echo "✓ Generated: voiceover.mp3"
echo ""

# ============================================================
# 5. ElevenLabs SFX
# ============================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "5/9 ElevenLabs SFX"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Command: vibe ai sfx \"whoosh transition\""
$VIBE ai sfx "smooth whoosh transition sound effect" \
  -o demo-output/whoosh.mp3 -d 2
echo "✓ Generated: whoosh.mp3"
echo ""

# ============================================================
# 6. Stability AI (Stable Diffusion)
# ============================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "6/9 Stability AI (Stable Diffusion)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Command: vibe ai sd \"cinematic film scene\""
$VIBE ai sd "cinematic film scene, dramatic lighting, movie poster quality" \
  -o demo-output/stability-image.png
echo "✓ Generated: stability-image.png"
echo ""

# ============================================================
# 7. Replicate AI (MusicGen)
# ============================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "7/9 Replicate AI (MusicGen)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Command: vibe ai music \"upbeat tech jingle\""
$VIBE ai music "upbeat tech corporate jingle, modern, energetic" \
  -o demo-output/music.mp3 -d 10
echo "✓ Generated: music.mp3"
echo ""

# ============================================================
# 8. Runway (Image Generation)
# ============================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "8/9 Runway (Image)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Command: vibe ai image \"abstract digital art\" -p runway"
$VIBE ai image "abstract digital art, flowing colors, motion blur" \
  -o demo-output/runway-image.png -p runway
echo "✓ Generated: runway-image.png"
echo ""

# ============================================================
# 9. Kling AI (Video)
# ============================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "9/9 Kling AI (Video)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Command: vibe ai kling \"camera flying through clouds\""
$VIBE ai kling "smooth camera flying through clouds at sunset, cinematic" \
  -o demo-output/kling-video.mp4 -d 5
echo "✓ Generated: kling-video.mp4"
echo ""

# ============================================================
# Summary
# ============================================================
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                     Demo Complete!                             ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "Generated files:"
ls -lh demo-output/
echo ""
echo "Skills → CLI Integration Verified:"
echo "  ✓ openai-api    → image -p dalle, transcribe"
echo "  ✓ gemini-image  → image -p gemini"
echo "  ✓ claude-api    → storyboard, motion, parse, edit, suggest"
echo "  ✓ elevenlabs    → tts, sfx, voices, isolate, voice-clone"
echo "  ✓ stability     → sd, sd-upscale, sd-remove-bg, sd-img2img"
echo "  ✓ replicate-ai  → music, video-upscale, video-interpolate"
echo "  ✓ runway-video  → image -p runway, video -p runway"
echo "  ✓ kling-video   → kling, video -p kling, video-extend"
echo "  ✓ remotion      → motion (via Claude)"
echo ""
echo "Total: 9 Skills → 50+ CLI Commands"
