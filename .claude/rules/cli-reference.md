# VibeFrame CLI Reference

> Use these commands directly — no need to run `--help` first.

## Top-Level Commands

```bash
vibe project create <name> -o project.vibe.json    # Create project
vibe project info <file>                            # Show project info
vibe timeline add-source <project> <media>          # Add media source (returns source ID)
vibe timeline add-clip <project> <source-id>        # Add clip to timeline
vibe timeline list <project>                        # List timeline contents
vibe timeline trim <project> <clip-id> --start 5 --end 30
vibe timeline split <project> <clip-id> --time 10
vibe timeline delete <project> <clip-id>
vibe export <project> -o output.mp4 -y              # Export to video (-y = overwrite)
vibe batch import <project> <directory>              # Import all media from dir
vibe detect scenes <video>                          # Detect scene changes
vibe detect silence <media>                         # Detect silent segments
vibe detect beats <audio>                           # Detect beats
vibe setup --show                                   # Show API key status
vibe agent -p claude                                # Interactive agent mode
```

## Image Generation & Editing

```bash
# Generate image (default: Gemini)
vibe ai image "<prompt>" -o out.png
vibe ai image "<prompt>" -o out.png -p openai       # Use DALL-E
vibe ai image "<prompt>" -o out.png -p stability    # Use Stability
vibe ai image "<prompt>" -o out.png -r 16:9         # Aspect ratio

# Gemini image editing (up to 3 input images with flash, 14 with pro)
vibe ai gemini-edit <image> "<instruction>" -o out.png
vibe ai gemini-edit <img1> <img2> "<instruction>" -o out.png -m pro

# Stability AI image tools
vibe ai sd-upscale <image> -o out.png
vibe ai sd-remove-bg <image> -o out.png
vibe ai sd-img2img <image> "<prompt>" -o out.png
vibe ai sd-replace <image> "<search>" "<replace>" -o out.png
vibe ai sd-outpaint <image> -o out.png
```

## Video Generation

```bash
# Text-to-video (default: Kling)
vibe ai video "<prompt>" -o out.mp4 -d 5            # Kling (default)
vibe ai video "<prompt>" -o out.mp4 -p runway       # Runway Gen-4
vibe ai video "<prompt>" -o out.mp4 -p veo          # Google Veo

# Image-to-video
vibe ai video "<prompt>" -i image.png -o out.mp4 -p runway

# Kling specific
vibe ai kling "<prompt>" -o out.mp4 -d 5 -m pro     # Pro mode
vibe ai kling "<prompt>" -o out.mp4 -r 9:16          # Vertical
vibe ai video-extend <video-id>                      # Extend Kling video
```

## Audio

```bash
# Text-to-speech (ElevenLabs)
vibe ai tts "<text>" -o out.mp3
vibe ai tts "<text>" -o out.mp3 -v <voice-id>       # Custom voice
vibe ai voices                                       # List available voices

# Sound effects
vibe ai sfx "<description>" -o out.mp3 -d 5

# Music generation (Replicate MusicGen)
vibe ai music "<description>" -o out.mp3 -d 15

# Transcription (Whisper)
vibe ai transcribe <audio> -o out.srt -f srt
vibe ai transcribe <audio> -l ko                     # Specify language

# Voice clone
vibe ai voice-clone <sample.mp3>

# Dubbing (transcribe + translate + TTS)
vibe ai dub <media> -l ko -o dubbed.mp4

# Audio ducking (lower music when voice plays)
vibe ai duck <music.mp3> --voice voice.mp3 -o out.mp3
```

## Video Editing (FFmpeg-based, most need no API key)

```bash
# Remove silence
vibe ai silence-cut <video> -o out.mp4
vibe ai silence-cut <video> -o out.mp4 --use-gemini  # Smart detection

# Remove filler words (um, uh, like...)
vibe ai jump-cut <video> -o out.mp4

# Add captions (Whisper + FFmpeg)
vibe ai caption <video> -o out.mp4 -s bold            # bold, minimal, outline, karaoke
vibe ai caption <video> -o out.mp4 --position top

# Noise reduction (no API key)
vibe ai noise-reduce <input> -o out.mp4 -s high       # low, medium, high

# Fade effects (no API key)
vibe ai fade <video> -o out.mp4 --fade-in 1 --fade-out 1

# Color grading (Claude + FFmpeg)
vibe ai grade <video> -o out.mp4 -p cinematic-warm    # preset
vibe ai grade <video> -o out.mp4 -s "film noir look"  # custom style

# Text overlay (FFmpeg)
vibe ai text-overlay <video> -t "Title" -s center-bold -o out.mp4
vibe ai text-overlay <video> -t "Line 1" -t "Line 2" --start 0 --end 5 -o out.mp4

# Speed ramping (Whisper + Claude + FFmpeg)
vibe ai speed-ramp <video> -o out.mp4 -s dramatic

# Reframe aspect ratio (Claude Vision + FFmpeg)
vibe ai reframe <video> -o out.mp4 -a 9:16            # Landscape → vertical

# Translate subtitles
vibe ai translate-srt <file.srt> -t ko -o out.srt
```

## AI Analysis

```bash
# Analyze any media (image, video, YouTube URL)
vibe ai analyze <source> "<prompt>"
vibe ai analyze image.png "Describe this image"
vibe ai analyze video.mp4 "Summarize this video"
vibe ai analyze "https://youtube.com/watch?v=..." "Key takeaways"

# Video-specific analysis (Gemini)
vibe ai gemini-video <video> "<prompt>"
vibe ai gemini-video <video> "<prompt>" --low-res     # For longer videos

# AI video review + auto-fix
vibe ai review <video> --auto-apply -o fixed.mp4
```

## AI Pipelines

```bash
# Script-to-video (full pipeline: storyboard → images → video → TTS → assembly)
vibe ai script-to-video "<script>" -o output-dir/ -g runway
vibe ai script-to-video "<script>" -o output-dir/ -g kling --images-only
vibe ai script-to-video "<script>" -o output-dir/ -a 9:16 --review

# Regenerate specific scene
vibe ai regenerate-scene <project-dir> --scene 2

# Extract highlights from long video
vibe ai highlights <video> -o highlights.json -d 60 --use-gemini
vibe ai highlights <video> -p project.vibe.json      # Create project with clips

# Auto-generate shorts
vibe ai auto-shorts <video> -o shorts/ -n 3 -d 60 --add-captions

# Viral optimization (multi-platform export)
vibe ai viral <project> -p youtube,tiktok,instagram-reels -o viral/

# Storyboard generation
vibe ai storyboard "<content>" -o storyboard.json -d 30

# AI narration for video
vibe ai narrate <video> -o narration/ -v rachel -s energetic

# Motion graphics (Claude + Remotion)
vibe ai motion "<description>" -o motion.mp4 --render -s cinematic
vibe ai motion "<description>" --image bg.png --video base.mp4
```

## Common Workflows

### Generate image → edit → make video
```bash
vibe ai image "a cat on a rooftop" -o cat.png
vibe ai gemini-edit cat.png "add a sunset background" -o cat-sunset.png
vibe ai video "the cat watches the sunset" -i cat-sunset.png -o cat.mp4 -p runway
```

### Create video with narration
```bash
vibe ai kling "ocean waves at sunset" -o waves.mp4 -d 5
vibe ai tts "The sun sets over the peaceful ocean." -o narration.mp3
vibe project create my-video -o project.vibe.json
vibe timeline add-source project.vibe.json waves.mp4    # → source ID
vibe timeline add-source project.vibe.json narration.mp3 # → source ID
vibe timeline add-clip project.vibe.json <video-source-id>
vibe timeline add-clip project.vibe.json <audio-source-id>
vibe export project.vibe.json -o final.mp4 -y
```

### Edit existing video
```bash
vibe ai silence-cut interview.mp4 -o clean.mp4
vibe ai caption clean.mp4 -o captioned.mp4 -s bold
vibe ai grade captioned.mp4 -o final.mp4 -p cinematic-warm
```

## API Keys

| Command | Required Key |
|---------|-------------|
| `ai image` (default) | `GOOGLE_API_KEY` |
| `ai image -p openai` | `OPENAI_API_KEY` |
| `ai gemini-edit` | `GOOGLE_API_KEY` |
| `ai video` / `ai kling` | `KLING_API_KEY` |
| `ai video -p runway` | `RUNWAY_API_SECRET` |
| `ai video -p veo` | `GOOGLE_API_KEY` |
| `ai tts` / `ai sfx` | `ELEVENLABS_API_KEY` |
| `ai transcribe` / `ai caption` / `ai jump-cut` | `OPENAI_API_KEY` |
| `ai grade` / `ai reframe` / `ai speed-ramp` | `ANTHROPIC_API_KEY` |
| `ai gemini-video` / `ai analyze` / `ai review` | `GOOGLE_API_KEY` |
| `ai silence-cut` / `ai noise-reduce` / `ai fade` | None (FFmpeg only) |
| `ai script-to-video -g runway` | `ANTHROPIC_API_KEY` + `GOOGLE_API_KEY` + `ELEVENLABS_API_KEY` + `RUNWAY_API_SECRET` |
