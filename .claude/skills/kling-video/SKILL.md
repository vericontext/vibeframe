---
name: kling-video
description: Generate videos using Kling AI. Use for text-to-video and image-to-video generation with high quality results.
allowed-tools: Bash(curl *), Bash(python *), Read, Write
---

# Kling AI Video Generation

Generate high-quality videos using Kling AI v1.5 model.

## Capabilities

| Feature | Description |
|---------|-------------|
| Text-to-Video | Generate video from text description |
| Image-to-Video | Animate a reference image |
| Video Extension | Extend existing videos |
| Camera Control | Control camera movements |

## Authentication

Kling AI uses JWT authentication with access key and secret key.

```bash
export KLING_API_KEY="access_key:secret_key"
```

The API key format is `ACCESS_KEY:SECRET_KEY`.

## API Endpoints

Base URL: `https://api.klingai.com/v1`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/videos/text2video` | POST | Text-to-video generation |
| `/videos/image2video` | POST | Image-to-video generation |
| `/videos/text2video/{task_id}` | GET | Get text2video status |
| `/videos/image2video/{task_id}` | GET | Get image2video status |
| `/videos/video-extend` | POST | Extend a video |

## Request Format

### Text-to-Video
```json
{
  "prompt": "A serene mountain landscape with flowing clouds",
  "model_name": "kling-v1-5",
  "mode": "std",
  "aspect_ratio": "16:9",
  "duration": "5",
  "negative_prompt": "blurry, low quality"
}
```

### Image-to-Video
```json
{
  "image": "data:image/png;base64,...",
  "prompt": "Camera slowly zooms into the scene",
  "model_name": "kling-v1-5",
  "mode": "std",
  "aspect_ratio": "16:9",
  "duration": "5"
}
```

## Parameters

| Parameter | Type | Values | Description |
|-----------|------|--------|-------------|
| `prompt` | string | - | Text description |
| `model_name` | string | `kling-v1`, `kling-v1-5` | Model version |
| `mode` | string | `std`, `pro` | Quality mode |
| `aspect_ratio` | string | `16:9`, `9:16`, `1:1` | Aspect ratio |
| `duration` | string | `5`, `10` | Duration in seconds |
| `negative_prompt` | string | - | What to avoid |
| `cfg_scale` | number | 1-10 | Prompt adherence |

### Camera Control (Optional)
```json
{
  "camera_control": {
    "type": "simple",
    "horizontal": 5,
    "vertical": 0,
    "zoom": 1.2
  }
}
```

Camera types: `simple`, `down_back`, `forward_up`, `right_turn_forward`, `left_turn_forward`

## JWT Authentication

Kling uses JWT tokens signed with HMAC-SHA256:

```python
import hmac
import hashlib
import base64
import time

def generate_token(access_key: str, secret_key: str) -> str:
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {"iss": access_key, "exp": now + 1800, "nbf": now - 5}

    header_b64 = base64.urlsafe_b64encode(json.dumps(header).encode()).rstrip(b'=')
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b'=')

    signature = hmac.new(
        secret_key.encode(),
        f"{header_b64.decode()}.{payload_b64.decode()}".encode(),
        hashlib.sha256
    ).digest()
    signature_b64 = base64.urlsafe_b64encode(signature).rstrip(b'=')

    return f"{header_b64.decode()}.{payload_b64.decode()}.{signature_b64.decode()}"
```

## Response Format

### Initial Response
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "task_id": "abc123"
  }
}
```

### Status Response
```json
{
  "code": 0,
  "data": {
    "task_id": "abc123",
    "task_status": "succeed",
    "task_result": {
      "videos": [{
        "id": "video123",
        "url": "https://...",
        "duration": "5.0"
      }]
    }
  }
}
```

### Status Values
- `submitted` - Task submitted
- `processing` - Generation in progress
- `succeed` - Complete
- `failed` - Error occurred

## cURL Examples

### Generate JWT Token (using jq)
```bash
# This is simplified - use the Python script for proper JWT
ACCESS_KEY="your_access_key"
SECRET_KEY="your_secret_key"
```

### Text-to-Video
```bash
TOKEN=$(python .claude/skills/kling-video/scripts/token.py)

curl -X POST "https://api.klingai.com/v1/videos/text2video" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A beautiful sunset over the ocean",
    "model_name": "kling-v1-5",
    "mode": "std",
    "aspect_ratio": "16:9",
    "duration": "5"
  }'
```

### Check Status
```bash
curl "https://api.klingai.com/v1/videos/text2video/{task_id}" \
  -H "Authorization: Bearer $TOKEN"
```

## Usage with Helper Script

```bash
# Text-to-video
python .claude/skills/kling-video/scripts/generate.py "sunset over ocean" -o sunset.mp4

# Image-to-video
python .claude/skills/kling-video/scripts/generate.py "animate scene" -i photo.png -o animated.mp4

# With options
python .claude/skills/kling-video/scripts/generate.py "prompt" -o out.mp4 -d 10 -r 9:16 -m pro
```

## Integration with VibeFrame

```bash
# Generate video with Kling
vibe ai video "sunset timelapse" -o sunset.mp4 -p kling

# Image-to-video
vibe ai video "animate this" -i photo.png -o animated.mp4 -p kling

# With options
vibe ai video "prompt" -o out.mp4 -p kling -d 10 --ratio 9:16
```

## Modes Comparison

| Mode | Quality | Speed | Cost |
|------|---------|-------|------|
| `std` (Standard) | Good | Fast | Lower |
| `pro` (Professional) | Best | Slower | Higher |

## Tips

1. **Detailed prompts**: More descriptive prompts yield better results
2. **Camera motion**: Use camera_control for cinematic effects
3. **Negative prompts**: Specify what to avoid for cleaner output
4. **Image-to-video**: Works best with high-quality reference images

## References

- [Kling AI API Docs](https://app.klingai.com/global/dev/document-api)
- [Kling AI Models](https://klingai.com)
