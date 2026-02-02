#!/usr/bin/env python3
"""
Gemini Image Generation Script (Nano Banana)

Generate images using Google Gemini's native image generation.

Usage:
    python generate.py "your prompt" -o output.png
    python generate.py "your prompt" -o output.png -r 16:9 -m gemini-2.5-flash-image

Requirements:
    - GOOGLE_API_KEY environment variable
    - Python 3.8+
"""

import argparse
import base64
import json
import os
import sys
import urllib.request
import urllib.error

MODELS = {
    "flash": "gemini-2.5-flash-image",
    "pro": "gemini-2.5-pro-image",
}

ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]

def generate_image(
    prompt: str,
    output_path: str,
    model: str = "gemini-2.5-flash-image",
    aspect_ratio: str = "1:1",
    api_key: str | None = None,
) -> dict:
    """Generate an image using Gemini API."""

    api_key = api_key or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return {"success": False, "error": "GOOGLE_API_KEY environment variable not set"}

    # Resolve model alias
    if model in MODELS:
        model = MODELS[model]

    # Validate aspect ratio
    if aspect_ratio not in ASPECT_RATIOS:
        return {"success": False, "error": f"Invalid aspect ratio. Choose from: {', '.join(ASPECT_RATIOS)}"}

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": {
                "aspectRatio": aspect_ratio
            }
        }
    }

    data = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}

    try:
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=120) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        try:
            error_json = json.loads(error_body)
            error_msg = error_json.get("error", {}).get("message", error_body)
        except json.JSONDecodeError:
            error_msg = error_body
        return {"success": False, "error": f"API error ({e.code}): {error_msg}"}
    except urllib.error.URLError as e:
        return {"success": False, "error": f"Network error: {e.reason}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

    # Parse response
    candidates = result.get("candidates", [])
    if not candidates:
        return {"success": False, "error": "No candidates in response"}

    parts = candidates[0].get("content", {}).get("parts", [])

    image_data = None
    text_description = None
    mime_type = "image/png"

    for part in parts:
        if "inlineData" in part:
            image_data = part["inlineData"].get("data")
            mime_type = part["inlineData"].get("mimeType", "image/png")
        elif "text" in part:
            text_description = part["text"]

    if not image_data:
        return {"success": False, "error": "No image data in response", "text": text_description}

    # Decode and save image
    try:
        image_bytes = base64.b64decode(image_data)
        with open(output_path, "wb") as f:
            f.write(image_bytes)
    except Exception as e:
        return {"success": False, "error": f"Failed to save image: {e}"}

    return {
        "success": True,
        "output_path": output_path,
        "mime_type": mime_type,
        "size_bytes": len(image_bytes),
        "description": text_description,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Generate images using Gemini (Nano Banana)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    %(prog)s "A sunset over mountains" -o sunset.png
    %(prog)s "Product photo of headphones" -o product.png -r 1:1
    %(prog)s "YouTube thumbnail for coding tutorial" -o thumb.png -r 16:9 -m pro
        """
    )

    parser.add_argument("prompt", help="Image generation prompt")
    parser.add_argument("-o", "--output", required=True, help="Output file path (e.g., output.png)")
    parser.add_argument(
        "-r", "--ratio",
        default="1:1",
        choices=ASPECT_RATIOS,
        help="Aspect ratio (default: 1:1)"
    )
    parser.add_argument(
        "-m", "--model",
        default="flash",
        help="Model: flash, pro, or full model name (default: flash)"
    )
    parser.add_argument("-k", "--api-key", help="Google API key (or set GOOGLE_API_KEY env)")
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose output")

    args = parser.parse_args()

    if args.verbose:
        print(f"Generating image with {args.model}...")
        print(f"Prompt: {args.prompt}")
        print(f"Aspect ratio: {args.ratio}")

    result = generate_image(
        prompt=args.prompt,
        output_path=args.output,
        model=args.model,
        aspect_ratio=args.ratio,
        api_key=args.api_key,
    )

    if result["success"]:
        print(f"Image saved to: {result['output_path']}")
        print(f"Size: {result['size_bytes']:,} bytes")
        if result.get("description") and args.verbose:
            print(f"Description: {result['description']}")
        sys.exit(0)
    else:
        print(f"Error: {result['error']}", file=sys.stderr)
        if result.get("text"):
            print(f"Response text: {result['text']}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
