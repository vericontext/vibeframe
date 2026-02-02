---
name: runway-video
description: Generate videos and images using Runway API. Use for text-to-image, image-to-video generation.
allowed-tools: Bash(curl *), Bash(python *), Read, Write
---

# Runway Media Generation

Generate high-quality videos and images using Runway Gen-4 models.

## Capabilities

| Feature | Model | Description |
|---------|-------|-------------|
| Image-to-Video | gen4_turbo | Animate an image with motion |
| Text-to-Image | gen4_image | High-quality image generation |
| Text-to-Image | gen4_image_turbo | Fast image generation (2 credits) |

## Authentication

```bash
export RUNWAY_API_SECRET="your-api-key"
```

## Pricing

### Video Generation
| Model | Pricing |
|-------|---------|
| gen4_turbo | Per generation (5s/10s) |

### Image Generation
| Model | Pricing |
|-------|---------|
| gen4_image | 5 credits/720p, 8 credits/1080p |
| gen4_image_turbo | 2 credits/any resolution |

## Python SDK Usage

Install: `pip install runwayml`

### Image-to-Video
```python
from runwayml import RunwayML

client = RunwayML()

task = client.image_to_video.create(
    model='gen4_turbo',
    prompt_image='https://example.com/image.jpg',  # or base64 data URI
    prompt_text='A timelapse with clouds flying by',
    ratio='1280:720',
    duration=5,
).wait_for_task_output()

print(task.output[0])  # Video URL
```

### Text-to-Image
```python
from runwayml import RunwayML

client = RunwayML()

task = client.text_to_image.create(
    model='gen4_image_turbo',
    prompt_text='A sunset over mountains',
    ratio='1920:1080',
).wait_for_task_output()

print(task.output[0])  # Image URL
```

### Base64 Image Input
```python
import base64

with open('image.png', 'rb') as f:
    image_data = base64.b64encode(f.read()).decode('utf-8')

data_uri = f"data:image/png;base64,{image_data}"

task = client.image_to_video.create(
    model='gen4_turbo',
    prompt_image=data_uri,
    prompt_text='Camera slowly panning',
    ratio='1280:720',
    duration=5,
).wait_for_task_output()
```

## Parameters

### Video Parameters
| Parameter | Type | Values | Description |
|-----------|------|--------|-------------|
| `model` | string | `gen4_turbo` | Model to use |
| `prompt_image` | string | URL or base64 | Input image (required) |
| `prompt_text` | string | - | Motion/animation description |
| `ratio` | string | `1280:720`, `720:1280` | Output resolution |
| `duration` | int | 5, 10 | Video duration in seconds |

### Image Parameters
| Parameter | Type | Values | Description |
|-----------|------|--------|-------------|
| `model` | string | `gen4_image`, `gen4_image_turbo` | Model to use |
| `prompt_text` | string | - | Image description |
| `ratio` | string | `1920:1080`, `1280:720`, etc. | Output resolution |

## Helper Scripts

### Video Generation (Image-to-Video)
```bash
# Basic usage
python .claude/skills/runway-video/scripts/generate.py "animate this scene" \
  -i photo.png -o animated.mp4

# With options
python .claude/skills/runway-video/scripts/generate.py "camera zoom in" \
  -i reference.jpg -o video.mp4 -d 10 -r 16:9
```

### Image Generation (Text-to-Image)
```bash
# Fast generation (turbo)
python .claude/skills/runway-video/scripts/image.py "sunset over mountains" \
  -o sunset.png

# High quality
python .claude/skills/runway-video/scripts/image.py "portrait photo" \
  -o portrait.png -m gen4_image -r 1080p

# Resolution options: 720p, 1080p, square, portrait, portrait_hd
```

### Video Inpainting (Remove/Replace Objects)
```bash
# Remove object (masked area becomes filled)
python .claude/skills/runway-video/scripts/inpaint.py frame.png mask.png -o cleaned.mp4

# Replace with specific content
python .claude/skills/runway-video/scripts/inpaint.py frame.png mask.png "ocean waves" -o replaced.mp4
```

## Integration with VibeFrame CLI

```bash
# Generate video from image
vibe ai video "animate this scene" -i photo.png -o animated.mp4 -p runway

# Generate image (coming soon)
vibe ai image "sunset over mountains" -o sunset.png -p runway
```

## Tips

1. **Video**: gen4_turbo requires an input image (no text-to-video)
2. **Image**: Use `gen4_image_turbo` for quick iterations (2 credits)
3. **Quality**: Use `gen4_image` for final/production images
4. **Prompts**: Be descriptive - include style, lighting, mood

## References

- [Runway API Docs](https://docs.dev.runwayml.com)
- [Runway SDK](https://pypi.org/project/runwayml/)
