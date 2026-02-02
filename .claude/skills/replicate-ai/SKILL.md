---
name: replicate-ai
description: Run AI models on Replicate for video upscaling, music generation, audio restoration, image generation, and more. Use for accessing diverse open-source AI models.
allowed-tools: Bash(curl *), Bash(python *), Read, Write
---

# Replicate AI

Run open-source AI models in the cloud via Replicate's API.

## Authentication

```bash
export REPLICATE_API_TOKEN="r8_..."
```

Header: `Authorization: Bearer $REPLICATE_API_TOKEN`

## API Overview

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/predictions` | POST | Create prediction |
| `/v1/predictions/{id}` | GET | Get prediction status |
| `/v1/predictions/{id}/cancel` | POST | Cancel prediction |
| `/v1/models` | GET | List models |

## Create Prediction

### Endpoint
```
POST https://api.replicate.com/v1/predictions
```

### Request Format
```json
{
  "version": "model_version_id",
  "input": {
    "param1": "value1",
    "param2": "value2"
  }
}
```

### cURL Example
```bash
curl -X POST "https://api.replicate.com/v1/predictions" \
  -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
    "input": {
      "prompt": "a beautiful sunset over mountains"
    }
  }'
```

### Response
```json
{
  "id": "abc123",
  "status": "starting",
  "urls": {
    "get": "https://api.replicate.com/v1/predictions/abc123",
    "cancel": "https://api.replicate.com/v1/predictions/abc123/cancel"
  }
}
```

## Popular Models for Video

### Video Upscaling (Real-ESRGAN)
```bash
# Model: nightmareai/real-esrgan
curl -X POST "https://api.replicate.com/v1/predictions" \
  -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "42fed1c4974146d4d2414e2be2c5277c7fcf05fcc3a73abf41610695738c1d7b",
    "input": {
      "image": "https://example.com/frame.png",
      "scale": 4,
      "face_enhance": true
    }
  }'
```

### Video Frame Interpolation (RIFE)
```bash
# Model: pollinations/rife-video-interpolation
curl -X POST "https://api.replicate.com/v1/predictions" \
  -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "...",
    "input": {
      "video": "https://example.com/video.mp4",
      "multiplier": 2
    }
  }'
```

### Background Removal (Rembg)
```bash
# Model: cjwbw/rembg
curl -X POST "https://api.replicate.com/v1/predictions" \
  -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003",
    "input": {
      "image": "https://example.com/photo.png"
    }
  }'
```

## Audio Models

### Music Generation (MusicGen)
```bash
# Model: meta/musicgen
curl -X POST "https://api.replicate.com/v1/predictions" \
  -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "671ac645ce5e552cc63a54a2bbff63fcf798043ac68f86b6f8d6e7df5c6a5a57",
    "input": {
      "prompt": "upbeat electronic music for video intro",
      "duration": 10,
      "model_version": "stereo-melody-large"
    }
  }'
```

### Audio Restoration (Demucs)
```bash
# Model: cjwbw/demucs
curl -X POST "https://api.replicate.com/v1/predictions" \
  -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "...",
    "input": {
      "audio": "https://example.com/audio.mp3",
      "stem": "vocals"
    }
  }'
```

### Speech Enhancement
```bash
# Model: lucataco/resemble-enhance
curl -X POST "https://api.replicate.com/v1/predictions" \
  -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "...",
    "input": {
      "audio": "https://example.com/speech.mp3",
      "denoise": true
    }
  }'
```

## Image Models

### Stable Diffusion XL
```bash
# Model: stability-ai/sdxl
curl -X POST "https://api.replicate.com/v1/predictions" \
  -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc",
    "input": {
      "prompt": "cinematic thumbnail for tech video",
      "negative_prompt": "blurry, low quality",
      "width": 1344,
      "height": 768,
      "num_outputs": 1
    }
  }'
```

### Flux (High Quality)
```bash
# Model: black-forest-labs/flux-schnell
curl -X POST "https://api.replicate.com/v1/predictions" \
  -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "...",
    "input": {
      "prompt": "professional photo, product shot",
      "aspect_ratio": "16:9"
    }
  }'
```

## Polling for Results

```bash
# Create prediction
PREDICTION_ID=$(curl -s -X POST "https://api.replicate.com/v1/predictions" \
  -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"version": "...", "input": {...}}' | jq -r '.id')

# Poll until complete
while true; do
  STATUS=$(curl -s "https://api.replicate.com/v1/predictions/$PREDICTION_ID" \
    -H "Authorization: Bearer $REPLICATE_API_TOKEN" | jq -r '.status')

  if [ "$STATUS" = "succeeded" ]; then
    curl -s "https://api.replicate.com/v1/predictions/$PREDICTION_ID" \
      -H "Authorization: Bearer $REPLICATE_API_TOKEN" | jq -r '.output'
    break
  elif [ "$STATUS" = "failed" ]; then
    echo "Failed"
    break
  fi

  sleep 2
done
```

## Webhooks

Instead of polling, use webhooks:

```json
{
  "version": "...",
  "input": {...},
  "webhook": "https://your-server.com/webhook",
  "webhook_events_filter": ["completed"]
}
```

## Usage with Helper Scripts

```bash
# Image upscaling
python .claude/skills/replicate-ai/scripts/upscale.py input.png -o upscaled.png -s 4

# Video upscaling (requires URL)
python .claude/skills/replicate-ai/scripts/video-upscale.py --url https://example.com/video.mp4 -o upscaled.mp4

# Music generation
python .claude/skills/replicate-ai/scripts/music.py "upbeat intro music" -o music.mp3 -d 10

# Background removal
python .claude/skills/replicate-ai/scripts/rembg.py photo.png -o no-bg.png

# Audio separation (Demucs)
python .claude/skills/replicate-ai/scripts/demucs.py song.mp3 -o vocals.mp3 --stem vocals

# All audio stems
python .claude/skills/replicate-ai/scripts/demucs.py song.mp3 -o stems/ --all

# Frame interpolation (smoother video)
python .claude/skills/replicate-ai/scripts/interpolate.py --url https://example.com/video.mp4 -o smooth.mp4 -m 2

# Style transfer
python .claude/skills/replicate-ai/scripts/style-transfer.py content.png style.png -o stylized.png

# Speech enhancement / audio restoration
python .claude/skills/replicate-ai/scripts/speech-enhance.py noisy.mp3 -o clean.mp3

# Object tracking in video
python .claude/skills/replicate-ai/scripts/track.py --url https://example.com/video.mp4 -o tracked.json
python .claude/skills/replicate-ai/scripts/track.py --url https://example.com/video.mp4 -o tracked.json --prompt "red car"

# Generic model prediction
python .claude/skills/replicate-ai/scripts/predict.py MODEL_VERSION '{"input": "param"}'
```

## Integration with VibeFrame

```bash
# Upscale video frames
vibe ai upscale input.mp4 -o upscaled.mp4 -s 4 -p replicate

# Generate background music
vibe ai music "cinematic orchestral" -o bgm.mp3 -d 30 -p replicate

# Remove background from video
vibe ai rembg input.mp4 -o no-bg.mp4 -p replicate

# Extract vocals
vibe ai separate song.mp3 -o vocals.mp3 --stem vocals -p replicate
```

## Model Discovery

Find models at [replicate.com/explore](https://replicate.com/explore):

```bash
# List models
curl "https://api.replicate.com/v1/models" \
  -H "Authorization: Bearer $REPLICATE_API_TOKEN"

# Get model versions
curl "https://api.replicate.com/v1/models/stability-ai/sdxl/versions" \
  -H "Authorization: Bearer $REPLICATE_API_TOKEN"
```

## Pricing

- Pay per second of compute time
- Pricing varies by model/hardware
- Typically $0.0001 - $0.01 per second
- First predictions may have cold start delay

## References

- [Replicate API Docs](https://replicate.com/docs/reference/http)
- [Model Explorer](https://replicate.com/explore)
- [Python Client](https://github.com/replicate/replicate-python)
- [Webhooks](https://replicate.com/docs/webhooks)
