---
name: runway-video
description: Generate videos using Runway Gen-3 API. Use for text-to-video and image-to-video generation.
allowed-tools: Bash(curl *), Bash(python *), Read, Write
---

# Runway Video Generation

Generate high-quality videos using Runway Gen-3 Alpha Turbo.

## Capabilities

| Feature | Description |
|---------|-------------|
| Text-to-Video | Generate video from text description |
| Image-to-Video | Animate a reference image |
| Gen-3 Alpha Turbo | Fast, high-quality generation |

## Authentication

```bash
export RUNWAY_API_SECRET="your-api-key"
```

Header: `Authorization: Bearer $RUNWAY_API_SECRET`

Required Header: `X-Runway-Version: 2024-11-06`

## API Endpoints

### Image-to-Video / Text-to-Video
```
POST https://api.dev.runwayml.com/v1/image_to_video
```

### Get Task Status
```
GET https://api.dev.runwayml.com/v1/tasks/{task_id}
```

### Cancel Task
```
POST https://api.dev.runwayml.com/v1/tasks/{task_id}/cancel
```

## Request Format

### Text-to-Video
```json
{
  "promptText": "A serene mountain landscape with clouds",
  "model": "gen3a_turbo",
  "duration": 5,
  "ratio": "16:9",
  "watermark": false
}
```

### Image-to-Video
```json
{
  "promptImage": "data:image/png;base64,...",
  "promptText": "Camera slowly zooms in",
  "model": "gen3a_turbo",
  "duration": 5,
  "ratio": "16:9"
}
```

## Parameters

| Parameter | Type | Values | Description |
|-----------|------|--------|-------------|
| `promptText` | string | - | Text description of the video |
| `promptImage` | string | URL or base64 | Reference image (optional) |
| `model` | string | `gen3a_turbo` | Model to use |
| `duration` | int | 5, 10 | Video duration in seconds |
| `ratio` | string | `16:9`, `9:16` | Aspect ratio |
| `seed` | int | 0-4294967295 | Random seed for reproducibility |
| `watermark` | bool | true/false | Enable Runway watermark |

## Response Format

### Initial Response
```json
{
  "id": "task_abc123"
}
```

### Task Status Response
```json
{
  "id": "task_abc123",
  "status": "SUCCEEDED",
  "progress": 100,
  "output": ["https://runway-output.s3.amazonaws.com/video.mp4"]
}
```

### Status Values
- `PENDING` - Task queued
- `RUNNING` - Generation in progress
- `SUCCEEDED` - Complete, video URL in `output`
- `FAILED` - Error, check `failure` field
- `CANCELLED` - Task was cancelled

## cURL Examples

### Start Generation
```bash
curl -X POST "https://api.dev.runwayml.com/v1/image_to_video" \
  -H "Authorization: Bearer $RUNWAY_API_SECRET" \
  -H "Content-Type: application/json" \
  -H "X-Runway-Version: 2024-11-06" \
  -d '{
    "promptText": "A beautiful sunset over the ocean",
    "model": "gen3a_turbo",
    "duration": 5,
    "ratio": "16:9"
  }'
```

### Check Status
```bash
curl "https://api.dev.runwayml.com/v1/tasks/task_abc123" \
  -H "Authorization: Bearer $RUNWAY_API_SECRET" \
  -H "X-Runway-Version: 2024-11-06"
```

### Download Video
```bash
curl -o video.mp4 "https://runway-output.s3.amazonaws.com/video.mp4"
```

## Usage with Helper Script

```bash
# Text-to-video
python .claude/skills/runway-video/scripts/generate.py "sunset over ocean" -o sunset.mp4

# Image-to-video
python .claude/skills/runway-video/scripts/generate.py "camera zoom" -i photo.png -o animated.mp4

# With options
python .claude/skills/runway-video/scripts/generate.py "prompt" -o out.mp4 -d 10 -r 9:16
```

## Integration with VibeFrame

```bash
# Generate video (default: Runway)
vibe ai video "sunset timelapse" -o sunset.mp4

# Specify Runway explicitly
vibe ai video "sunset timelapse" -o sunset.mp4 -p runway

# Image-to-video
vibe ai video "animate this scene" -i reference.png -o animated.mp4 -p runway
```

## Pricing & Limits

- Gen-3 Alpha Turbo: ~$0.05/second
- 5-second video: ~$0.25
- 10-second video: ~$0.50
- Max concurrent tasks vary by plan

## Tips

1. **Be descriptive**: "A serene mountain lake at golden hour with mist rising" works better than "lake"
2. **Camera motion**: Include camera directions like "slowly pan left" or "zoom in"
3. **Image-to-video**: Best results with high-quality reference images
4. **Seed**: Use same seed for consistent style across multiple generations

## References

- [Runway API Docs](https://docs.dev.runwayml.com)
- [Gen-3 Alpha](https://runwayml.com/research/gen-3-alpha)
