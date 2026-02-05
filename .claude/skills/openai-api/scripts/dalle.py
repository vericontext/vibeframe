#!/usr/bin/env python3
"""
OpenAI Image Generation Script (GPT Image 1.5 / DALL-E)

Usage:
    python dalle.py "mountain landscape" -o mountain.png
    python dalle.py "YouTube thumbnail" -o thumb.png -s 1536x1024 -q high
    python dalle.py "cat on windowsill" -o cat.png -m dall-e-3  # Legacy model
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error

# Available models
MODELS = ["gpt-image-1.5", "dall-e-3", "dall-e-2"]
DEFAULT_MODEL = "gpt-image-1.5"

# Quality options for GPT Image 1.5: low ($0.009), medium ($0.035), high ($0.133)
GPT_IMAGE_QUALITIES = ["low", "medium", "high"]
# Quality options for DALL-E 3
DALLE_QUALITIES = ["standard", "hd"]


def generate_image(
    prompt: str,
    output_path: str,
    model: str = DEFAULT_MODEL,
    size: str = "1024x1024",
    quality: str = "high",
    style: str = "natural",
    api_key: str | None = None,
) -> dict:
    """Generate image using OpenAI Image API."""

    api_key = api_key or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return {"success": False, "error": "OPENAI_API_KEY not set"}

    is_gpt_image = model == "gpt-image-1.5"

    body = {
        "model": model,
        "prompt": prompt,
        "n": 1,
        "response_format": "url",
    }

    if is_gpt_image:
        # GPT Image 1.5 options
        body["quality"] = quality if quality in GPT_IMAGE_QUALITIES else "high"
        if size != "auto":
            body["size"] = size
    else:
        # DALL-E options
        body["size"] = size
        body["quality"] = "hd" if quality == "high" else quality
        body["style"] = style

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            "https://api.openai.com/v1/images/generations",
            data=data,
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        return {"success": False, "error": f"API error ({e.code}): {error_body}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

    image_data = result.get("data", [{}])[0]
    image_url = image_data.get("url")
    revised_prompt = image_data.get("revised_prompt")

    if not image_url:
        return {"success": False, "error": "No image URL in response"}

    # Download image
    try:
        req = urllib.request.Request(image_url)
        with urllib.request.urlopen(req, timeout=60) as response:
            img_data = response.read()
        with open(output_path, "wb") as f:
            f.write(img_data)
    except Exception as e:
        return {"success": False, "error": f"Failed to download: {e}"}

    return {
        "success": True,
        "output_path": output_path,
        "size_bytes": len(img_data),
        "revised_prompt": revised_prompt,
        "model": model,
    }


def main():
    parser = argparse.ArgumentParser(description="OpenAI Image Generation (GPT Image 1.5 / DALL-E)")
    parser.add_argument("prompt", help="Image description")
    parser.add_argument("-o", "--output", required=True, help="Output file path")
    parser.add_argument("-m", "--model", default=DEFAULT_MODEL, choices=MODELS,
                        help="Model: gpt-image-1.5 (fastest, best) or dall-e-3/dall-e-2")
    parser.add_argument("-s", "--size", default="1024x1024",
                        choices=["1024x1024", "1536x1024", "1024x1536", "512x512", "256x256", "auto"])
    parser.add_argument("-q", "--quality", default="high",
                        help="Quality: low/medium/high (gpt-image-1.5) or standard/hd (dall-e)")
    parser.add_argument("--style", default="natural", choices=["natural", "vivid"],
                        help="Style (DALL-E only)")
    parser.add_argument("-k", "--api-key", help="API key (or set OPENAI_API_KEY)")

    args = parser.parse_args()

    print(f"Generating: {args.prompt}")
    print(f"Model: {args.model}, Quality: {args.quality}")

    result = generate_image(
        prompt=args.prompt,
        output_path=args.output,
        model=args.model,
        size=args.size,
        quality=args.quality,
        style=args.style,
        api_key=args.api_key,
    )

    if result["success"]:
        print(f"Saved to: {result['output_path']}")
        print(f"Size: {result['size_bytes']:,} bytes")
        if result.get("revised_prompt"):
            print(f"Revised prompt: {result['revised_prompt']}")
    else:
        print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
