---
name: gemini-image
description: Generate images using Google Gemini (Nano Banana). Use for creating visual assets, thumbnails, backgrounds, UI mockups, or any image generation task.
allowed-tools: Bash(curl *), Bash(python *), Read, Write
---

# Gemini Image Generation (Nano Banana)

Generate and edit high-quality images using Google's Gemini models with native image generation capabilities.

## Available Models

| Model | ID | Description | Best For |
|-------|-----|-------------|----------|
| Nano Banana | `gemini-2.5-flash-image` | Speed-optimized | High-volume, low-latency tasks |
| Nano Banana Pro | `gemini-3-pro-image-preview` | Professional quality | Complex instructions, 4K output, text rendering |

### Key Differences

| Feature | Flash | Pro |
|---------|-------|-----|
| Max Resolution | 1K | 4K |
| Reference Images | Up to 3 | Up to 14 |
| Thinking Mode | No | Yes (default) |
| Google Search Grounding | No | Yes |
| Text Rendering | Basic | Advanced |

## Authentication

```bash
export GOOGLE_API_KEY="your-api-key"
```

## API Endpoint

```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={API_KEY}
```

## Text-to-Image Generation

### Basic Request

```json
{
  "contents": [{"parts": [{"text": "Your image prompt"}]}],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"],
    "imageConfig": {
      "aspectRatio": "16:9"
    }
  }
}
```

### With Resolution (Pro Only)

```json
{
  "contents": [{"parts": [{"text": "Your image prompt"}]}],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"],
    "imageConfig": {
      "aspectRatio": "16:9",
      "imageSize": "2K"
    }
  }
}
```

## Image Editing (Image-to-Image)

Provide an image with a text prompt to edit:

```json
{
  "contents": [{
    "parts": [
      {"text": "Change the sofa to red leather"},
      {
        "inlineData": {
          "mimeType": "image/png",
          "data": "<base64_encoded_image>"
        }
      }
    ]
  }],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"]
  }
}
```

## Multi-Image Composition (Pro)

Combine up to 14 reference images:

```json
{
  "contents": [{
    "parts": [
      {"text": "Create a group photo of these people in an office"},
      {"inlineData": {"mimeType": "image/png", "data": "<person1_base64>"}},
      {"inlineData": {"mimeType": "image/png", "data": "<person2_base64>"}},
      {"inlineData": {"mimeType": "image/png", "data": "<person3_base64>"}}
    ]
  }],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"],
    "imageConfig": {"aspectRatio": "5:4", "imageSize": "2K"}
  }
}
```

## Google Search Grounding (Pro)

Generate images based on real-time information:

```json
{
  "contents": [{"parts": [{"text": "Visualize the current weather forecast for San Francisco"}]}],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"],
    "imageConfig": {"aspectRatio": "16:9"},
    "tools": [{"googleSearch": {}}]
  }
}
```

## Aspect Ratios & Resolutions

### Flash Model (1K only)

| Aspect Ratio | Resolution | Tokens |
|--------------|------------|--------|
| 1:1 | 1024x1024 | 1290 |
| 16:9 | 1344x768 | 1290 |
| 9:16 | 768x1344 | 1290 |
| 3:2 | 1248x832 | 1290 |
| 2:3 | 832x1248 | 1290 |
| 4:3 | 1184x864 | 1290 |
| 3:4 | 864x1184 | 1290 |
| 21:9 | 1536x672 | 1290 |

### Pro Model (1K/2K/4K)

| Aspect Ratio | 1K | 2K | 4K |
|--------------|-----|-----|-----|
| 1:1 | 1024x1024 | 2048x2048 | 4096x4096 |
| 16:9 | 1376x768 | 2752x1536 | 5504x3072 |
| 9:16 | 768x1376 | 1536x2752 | 3072x5504 |
| 21:9 | 1584x672 | 3168x1344 | 6336x2688 |

## Response Format

```json
{
  "candidates": [{
    "content": {
      "parts": [
        {"text": "Description of generated image"},
        {
          "inlineData": {
            "mimeType": "image/png",
            "data": "<base64_encoded_image>"
          }
        }
      ]
    }
  }]
}
```

## Usage with Helper Scripts

### Text-to-Image

```bash
# Basic generation (Flash)
python .claude/skills/gemini-image/scripts/generate.py "mountain landscape" -o mountain.png

# With aspect ratio
python .claude/skills/gemini-image/scripts/generate.py "YouTube thumbnail" -o thumb.png -r 16:9

# Pro model with 2K resolution
python .claude/skills/gemini-image/scripts/generate.py "product photo" -o product.png -m pro -s 2K
```

### Image Editing

```bash
# Edit existing image
python .claude/skills/gemini-image/scripts/edit.py input.png "change background to sunset" -o output.png

# Style transfer
python .claude/skills/gemini-image/scripts/edit.py photo.png "convert to watercolor painting style" -o watercolor.png
```

## Integration with VibeFrame CLI

```bash
# Generate image (use gemini provider)
vibe ai image "futuristic city" -o city.png -p gemini -r 16:9

# Generate with Pro model and 2K resolution
vibe ai gemini "professional product photo" -o product.png -m pro -s 2K

# Edit image
vibe ai gemini-edit input.png "add dramatic lighting" -o output.png

# Multi-image composition (Pro)
vibe ai gemini-compose person1.png person2.png "group photo in office" -o group.png
```

## Prompting Best Practices

### 1. Describe Scenes, Don't List Keywords

**Good:**
> A cozy coffee shop interior with warm lighting, wooden tables, and steaming cups of coffee. Morning sunlight streams through large windows.

**Bad:**
> coffee shop, cozy, warm, wooden, steam

### 2. Use Photography Terms for Realism

```
A photorealistic close-up portrait shot with a 85mm lens,
soft bokeh background, studio lighting from the left,
capturing fine skin texture details.
```

### 3. Specify Style for Illustrations

```
A kawaii-style sticker of a happy red panda with big eyes,
pastel pink and white color palette, thick black outlines,
transparent background.
```

### 4. Include Text Rendering Instructions

```
Create a modern logo for 'The Daily Grind' coffee shop
in a bold sans-serif font, minimalist design with
coffee bean accent.
```

### 5. Product Photography

```
A high-resolution, studio-lit product photograph of
a minimalist ceramic coffee mug on a marble surface.
Three-point softbox lighting setup, 45-degree camera angle,
ultra-realistic with sharp focus.
```

### 6. Sequential Art / Storyboards (Pro)

```
Make a 3 panel comic in a noir art style.
Panel 1: Detective enters dark office.
Panel 2: Finds mysterious letter on desk.
Panel 3: Close-up of his surprised face.
```

## Thinking Mode (Pro)

The Pro model uses a "Thinking" process for complex prompts:

- Generates up to 2 interim images to test composition
- Final image is the last within Thinking
- Cannot be disabled via API
- Thought signatures must be passed back in multi-turn conversations

## Limitations

- All images include SynthID watermark (invisible)
- Supported languages: EN, ar-EG, de-DE, es-MX, fr-FR, hi-IN, id-ID, it-IT, ja-JP, ko-KR, pt-BR, ru-RU, ua-UA, vi-VN, zh-CN
- No audio or video input support
- Flash: max 3 reference images; Pro: max 14 (5 humans, 6 objects)
- Person generation may be restricted by safety settings

## Pricing

| Model | Cost |
|-------|------|
| Flash (1K) | See Google AI pricing |
| Pro (1K) | 1120 tokens/image |
| Pro (2K) | 1120 tokens/image |
| Pro (4K) | 2000 tokens/image |

## References

- [Gemini Image Generation Docs](https://ai.google.dev/gemini-api/docs/image-generation)
- [Google AI Studio](https://aistudio.google.com/)
- [Nano Banana Guide](https://ai.google.dev/gemini-api/docs/nano-banana)
