#!/usr/bin/env python3
"""
DALL-E Image Generation Script

Usage:
    python dalle.py "mountain landscape" -o mountain.png
    python dalle.py "YouTube thumbnail" -o thumb.png -s 1792x1024 -q hd
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error


def generate_image(
    prompt: str,
    output_path: str,
    model: str = "dall-e-3",
    size: str = "1024x1024",
    quality: str = "standard",
    style: str = "natural",
    api_key: str | None = None,
) -> dict:
    """Generate image using DALL-E."""

    api_key = api_key or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return {"success": False, "error": "OPENAI_API_KEY not set"}

    body = {
        "model": model,
        "prompt": prompt,
        "n": 1,
        "size": size,
        "quality": quality,
        "style": style,
        "response_format": "url",
    }

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
    }


def main():
    parser = argparse.ArgumentParser(description="DALL-E Image Generation")
    parser.add_argument("prompt", help="Image description")
    parser.add_argument("-o", "--output", required=True, help="Output file path")
    parser.add_argument("-m", "--model", default="dall-e-3", choices=["dall-e-3", "dall-e-2"])
    parser.add_argument("-s", "--size", default="1024x1024",
                        choices=["1024x1024", "1792x1024", "1024x1792", "512x512", "256x256"])
    parser.add_argument("-q", "--quality", default="standard", choices=["standard", "hd"])
    parser.add_argument("--style", default="natural", choices=["natural", "vivid"])
    parser.add_argument("-k", "--api-key", help="API key (or set OPENAI_API_KEY)")

    args = parser.parse_args()

    print(f"Generating: {args.prompt}")

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
