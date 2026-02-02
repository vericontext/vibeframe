---
name: stability-image
description: Generate and edit images using Stability AI. Use for image generation, upscaling, inpainting, outpainting, and background removal.
allowed-tools: Bash(curl *), Bash(python *), Read, Write
---

# Stability AI Image Generation & Editing

Generate and edit images using Stability AI's Stable Diffusion models.

## Capabilities

| Feature | Endpoint | Description |
|---------|----------|-------------|
| Text-to-Image | `/v2beta/stable-image/generate/{model}` | Generate images from text |
| Image-to-Image | `/v2beta/stable-image/generate/sd3` | Transform existing images |
| Upscale | `/v2beta/stable-image/upscale/fast` | Increase image resolution |
| Remove Background | `/v2beta/stable-image/edit/remove-background` | Remove image background |
| Search & Replace | `/v2beta/stable-image/edit/search-and-replace` | Replace objects in images |
| Outpaint | `/v2beta/stable-image/edit/outpaint` | Extend image boundaries |
| Inpaint | `/v2beta/stable-image/edit/inpaint` | Edit specific regions |

## Authentication

```bash
export STABILITY_API_KEY="sk-..."
```

Header: `Authorization: Bearer $STABILITY_API_KEY`

## Available Models

| Model | ID | Description |
|-------|-----|-------------|
| SD3.5 Large | `sd3.5-large` | Highest quality |
| SD3.5 Large Turbo | `sd3.5-large-turbo` | Fast, high quality |
| SD3.5 Medium | `sd3.5-medium` | Balanced |
| Stable Image Core | `stable-image-core` | General purpose |
| Stable Image Ultra | `stable-image-ultra` | Maximum quality |

## Text-to-Image

### Endpoint
```
POST https://api.stability.ai/v2beta/stable-image/generate/{model}
```

### Request (multipart/form-data)
```bash
curl -X POST "https://api.stability.ai/v2beta/stable-image/generate/sd3.5-large" \
  -H "Authorization: Bearer $STABILITY_API_KEY" \
  -H "Accept: image/*" \
  -F "prompt=A beautiful mountain landscape" \
  -F "aspect_ratio=16:9" \
  -F "output_format=png" \
  -o output.png
```

### Parameters
| Parameter | Values | Description |
|-----------|--------|-------------|
| `prompt` | string | Image description |
| `negative_prompt` | string | What to avoid |
| `aspect_ratio` | 16:9, 1:1, 21:9, 2:3, 3:2, 4:5, 5:4, 9:16, 9:21 | Image ratio |
| `output_format` | jpeg, png, webp | Output format |
| `seed` | 0-4294967295 | Random seed |
| `style_preset` | See below | Style presets |

### Style Presets
- `3d-model`, `analog-film`, `anime`, `cinematic`, `comic-book`
- `digital-art`, `enhance`, `fantasy-art`, `isometric`, `line-art`
- `low-poly`, `modeling-compound`, `neon-punk`, `origami`
- `photographic`, `pixel-art`, `tile-texture`

## Image-to-Image

```bash
curl -X POST "https://api.stability.ai/v2beta/stable-image/generate/sd3" \
  -H "Authorization: Bearer $STABILITY_API_KEY" \
  -H "Accept: image/*" \
  -F "prompt=transform to watercolor painting" \
  -F "image=@input.png" \
  -F "strength=0.7" \
  -F "mode=image-to-image" \
  -o output.png
```

## Upscale

### Fast Upscale (4x)
```bash
curl -X POST "https://api.stability.ai/v2beta/stable-image/upscale/fast" \
  -H "Authorization: Bearer $STABILITY_API_KEY" \
  -H "Accept: image/*" \
  -F "image=@input.png" \
  -F "output_format=png" \
  -o upscaled.png
```

### Creative Upscale
```bash
curl -X POST "https://api.stability.ai/v2beta/stable-image/upscale/creative" \
  -H "Authorization: Bearer $STABILITY_API_KEY" \
  -H "Accept: image/*" \
  -F "image=@input.png" \
  -F "prompt=enhance details" \
  -F "creativity=0.3" \
  -o upscaled.png
```

## Remove Background

```bash
curl -X POST "https://api.stability.ai/v2beta/stable-image/edit/remove-background" \
  -H "Authorization: Bearer $STABILITY_API_KEY" \
  -H "Accept: image/*" \
  -F "image=@input.png" \
  -o no-background.png
```

## Search & Replace

```bash
curl -X POST "https://api.stability.ai/v2beta/stable-image/edit/search-and-replace" \
  -H "Authorization: Bearer $STABILITY_API_KEY" \
  -H "Accept: image/*" \
  -F "image=@input.png" \
  -F "prompt=red sports car" \
  -F "search_prompt=blue car" \
  -o replaced.png
```

## Outpaint (Extend Image)

```bash
curl -X POST "https://api.stability.ai/v2beta/stable-image/edit/outpaint" \
  -H "Authorization: Bearer $STABILITY_API_KEY" \
  -H "Accept: image/*" \
  -F "image=@input.png" \
  -F "left=200" \
  -F "right=200" \
  -F "prompt=continue the landscape" \
  -o extended.png
```

### Outpaint Parameters
- `left`, `right`, `up`, `down`: Pixels to extend (0-2000)
- `prompt`: Description for extended area
- `creativity`: 0-1 (default: 0.5)

## Usage with Helper Script

```bash
# Text-to-image
python .claude/skills/stability-image/scripts/generate.py "mountain landscape" -o mountain.png

# With style preset
python .claude/skills/stability-image/scripts/generate.py "robot" -o robot.png --style anime

# Remove background
python .claude/skills/stability-image/scripts/edit.py remove-bg input.png -o output.png

# Upscale
python .claude/skills/stability-image/scripts/edit.py upscale input.png -o upscaled.png
```

## Integration with VibeFrame

```bash
# Generate image (use stability provider)
vibe ai image "mountain landscape" -o mountain.png -p stability

# Image editing commands
vibe ai sd-img2img input.png "make it vintage" -o output.png
vibe ai sd-replace input.png "cat" "dog" -o output.png
vibe ai sd-outpaint input.png --left 200 --right 200 -o wider.png
vibe ai sd-remove-bg input.png -o no-bg.png
vibe ai sd-upscale input.png -o upscaled.png
```

## Pricing

- SD3.5 Large: $0.065/image
- SD3.5 Large Turbo: $0.04/image
- Upscale Fast: $0.005/megapixel
- Remove Background: $0.02/image
- Outpaint: $0.025/megapixel

## References

- [Stability AI API Docs](https://platform.stability.ai/docs/api-reference)
- [Stable Diffusion 3.5](https://stability.ai/stable-diffusion-3)
