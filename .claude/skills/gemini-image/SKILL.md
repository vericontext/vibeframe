---
name: gemini-image
description: Generate images using Google Gemini (Nano Banana). Use for creating visual assets, thumbnails, backgrounds, UI mockups, or any image generation task.
allowed-tools: Bash(curl *), Read, Write
---

# Gemini Image Generation (Nano Banana)

Generate high-quality images using Google's Gemini models with native image generation.

## Available Models

| Model | Description | Best For |
|-------|-------------|----------|
| `gemini-2.5-flash-image` | Speed-optimized (Nano Banana) | Quick iterations, drafts |
| `gemini-2.5-pro-image` | Professional quality | Final assets, high-quality images |

## API Endpoint

```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
```

## Required Environment Variable

- `GOOGLE_API_KEY` - Google AI Studio API key

## Request Format

```json
{
  "contents": [{
    "parts": [{"text": "Your image prompt"}]
  }],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"],
    "imageConfig": {
      "aspectRatio": "16:9"
    }
  }
}
```

## Supported Aspect Ratios

- `1:1` - Square (social media, icons)
- `16:9` - Landscape (YouTube, presentations)
- `9:16` - Portrait (Stories, TikTok)
- `4:3`, `3:4` - Standard
- `21:9` - Ultra-wide (cinematic)

## Response Parsing

Images are returned as base64-encoded data in the response:

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

## Usage

### Generate Image with cURL

```bash
curl -s -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=$GOOGLE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"parts": [{"text": "A futuristic video editing interface with purple neon glow"}]}],
    "generationConfig": {
      "responseModalities": ["TEXT", "IMAGE"],
      "imageConfig": {"aspectRatio": "16:9"}
    }
  }' | jq -r '.candidates[0].content.parts[] | select(.inlineData) | .inlineData.data' | base64 -d > output.png
```

### Generate and Save Image (Script)

Use the helper script for easier generation:

```bash
python .claude/skills/gemini-image/scripts/generate.py "your prompt" -o output.png -r 16:9 -m gemini-2.5-flash-image
```

## Prompting Best Practices

1. **Describe scenes, don't list keywords**
   - Good: "A cozy coffee shop interior with warm lighting, wooden tables, and steaming cups"
   - Bad: "coffee shop, cozy, warm, wooden, steam"

2. **Use photography terminology for realism**
   - "Shot with a 35mm lens, soft bokeh, golden hour lighting"

3. **Specify style for illustrations**
   - "In the style of minimalist vector art with flat colors"
   - "Pixel art style, 16-bit aesthetic"

4. **Include text rendering instructions**
   - "With the text 'VibeFrame' in bold modern sans-serif font"

## Integration with VibeFrame

After generating images, add them to your project:

```bash
# Generate thumbnail
python .claude/skills/gemini-image/scripts/generate.py "YouTube thumbnail for video editing tutorial" -o thumbnail.png -r 16:9

# Add to VibeFrame project
vibe timeline add-source project.vibe.json thumbnail.png -d 5
```

## Limitations

- All generated images include SynthID watermark (invisible)
- Person generation may be restricted based on safety settings
- Maximum 4 images per request (for batch generation)

## References

- [Gemini Image Generation Docs](https://ai.google.dev/gemini-api/docs/image-generation)
- [Google AI Studio](https://aistudio.google.com/)
