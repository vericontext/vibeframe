# VibeFrame Cookbook

10 practical recipes combining multiple CLI commands. Each recipe shows the complete workflow.

---

## 1. Interview Cleanup

Clean up a raw interview recording: remove silence, reduce noise, add captions.

**Cost:** Free (FFmpeg only) + $0.01 (Whisper for captions)

```bash
# Step 1: Remove silent gaps (free)
vibe edit silence-cut interview.mp4 -o step1-trimmed.mp4

# Step 2: Reduce background noise (free)
vibe edit noise-reduce step1-trimmed.mp4 -o step2-clean.mp4

# Step 3: Add auto-captions (needs OPENAI_API_KEY)
vibe edit caption step2-clean.mp4 -o final-interview.mp4
```

---

## 2. TikTok from Long Video

Extract the best moments from a long video and reformat for TikTok (9:16).

**Cost:** ~$0.10 (Whisper + Claude analysis)

```bash
# Step 1: Extract top 3 highlights
vibe pipeline highlights long-video.mp4 -c 3 -o highlights.json -p project.vibe.json

# Step 2: Generate vertical shorts with captions
vibe pipeline auto-shorts long-video.mp4 -a 9:16 -d 60 -o ./shorts/

# Or manually: reframe + animated captions
vibe edit reframe highlight-clip.mp4 -a 9:16 -o vertical.mp4
vibe pipeline animated-caption vertical.mp4 -s bounce -o final-tiktok.mp4
```

---

## 3. Podcast Highlights

Turn a 1-hour podcast into shareable clips.

**Cost:** ~$0.10

```bash
# Step 1: Detect beats and energy peaks
vibe detect beats podcast.mp3

# Step 2: Extract highlights based on emotional content
vibe pipeline highlights podcast.mp4 -d 90 --criteria emotional -o highlights.json

# Step 3: Auto-generate shorts
vibe pipeline auto-shorts podcast.mp4 -c 5 -o ./podcast-clips/
```

---

## 4. Script-to-Video Pipeline

Create a complete video from a text script.

**Cost:** $5-$50 (AI image + video + TTS generation)

```bash
# Step 1: Scaffold project + author STORYBOARD.md (per-beat YAML cues)
vibe scene init startup-video --visual-style "Swiss Pulse" -d 60 -r 16:9
# (edit STORYBOARD.md with beats describing the morning routine)

# Step 2: Build end-to-end (TTS + backdrops + compose + render)
vibe scene build startup-video

# Step 3: To re-render a single scene, edit its composition HTML directly
#         and re-run scene render — no need to regenerate the whole project.
vibe scene render startup-video

# Step 3: Add background music
vibe generate music "upbeat lo-fi morning vibes" -d 60 -o bgm.mp3
```

---

## 5. Multi-Language Content

Translate and dub a video for international audiences.

**Cost:** ~$1-$5 (Whisper + Claude + ElevenLabs)

```bash
# Step 1: Transcribe and generate subtitles
vibe audio transcribe video.mp4 -o subtitles.srt

# Step 2: Translate subtitles
vibe edit translate-srt subtitles.srt -l ko -o subtitles-ko.srt
vibe edit translate-srt subtitles.srt -l es -o subtitles-es.srt

# Step 3: Generate dubbed audio
vibe audio dub video.mp4 -l ko -o video-korean.mp3
vibe audio dub video.mp4 -l es -o video-spanish.mp3
```

---

## 6. Music Video Edit

Sync edits to music beats with effects.

**Cost:** Free (FFmpeg only)

```bash
# Step 1: Detect beats in the music track
vibe detect beats music.mp3

# Step 2: Apply speed ramping synced to energy
vibe edit speed-ramp video.mp4 -o speed-ramped.mp4

# Step 3: Add color grading
vibe edit grade speed-ramped.mp4 --style cinematic -o graded.mp4

# Step 4: Add text overlay and fades
vibe edit text-overlay graded.mp4 -t "MY VIDEO" --style center-bold -o titled.mp4
vibe edit fade titled.mp4 -o final-music-video.mp4 --fade-in 2 --fade-out 2
```

---

## 7. AI Thumbnail Generation

Create the perfect thumbnail for your video.

**Cost:** ~$0.05

```bash
# Option A: Extract the best frame using Gemini AI
vibe generate thumbnail --best-frame video.mp4 -o thumbnail.png

# Option B: Generate a custom thumbnail with AI
vibe generate image "Professional YouTube thumbnail: person coding with neon lights" \
  -p gemini -r 16:9 -o thumbnail.png
```

---

## 8. Motion Graphics Overlay

Add animated graphics on top of existing video.

**Cost:** ~$0.05 (Claude/Gemini for code generation)

```bash
# Step 1: Generate motion graphic component
vibe generate motion "Animated subscribe button with particle effects" \
  --style "neon, modern" -d 5 -o subscribe.tsx

# Step 2: Render and composite onto video
vibe generate motion "Animated subscribe button" \
  --render --video base-video.mp4 -o final-with-overlay.mp4
```

---

## 9. Voice-Over Production

Create narrated content with AI voices.

**Cost:** ~$0.50 (ElevenLabs TTS + music generation)

```bash
# Step 1: Generate speech from script
vibe generate speech "Welcome to VibeFrame, the AI-native video editor." -o narration.mp3

# Step 2: Generate background music
vibe generate music "calm corporate background, no vocals" \
  --instrumental -d 30 -o bgm.mp3

# Step 3: Auto-duck music under voice
vibe audio duck bgm.mp3 -v narration.mp3 -o mixed-audio.mp3
```

---

## 10. Scene Detection and Analysis

Analyze a video's structure for editing decisions.

**Cost:** Free (FFmpeg) to ~$0.05 (Gemini analysis)

```bash
# Step 1: Detect scene changes (free)
vibe detect scenes video.mp4

# Step 2: Detect silence gaps (free)
vibe detect silence video.mp4

# Step 3: AI-powered video analysis (needs GOOGLE_API_KEY)
vibe analyze video video.mp4 "Summarize the key moments and suggest edit points"

# Step 4: AI quality review with auto-fix suggestions
vibe analyze review video.mp4 -o review.json
```

---

## Tips

- **Cost control:** Use `--dry-run` on any command to preview what will happen without spending API credits
- **JSON output:** Add `--json` to any command for machine-readable output
- **Batch processing:** Use `vibe batch` to apply effects to multiple files
- **Schema introspection:** Run `vibe schema <command>` to see all available options
- **System check:** Run `vibe doctor` to verify your setup and see which commands are available
