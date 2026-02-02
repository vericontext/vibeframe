#!/usr/bin/env python3
"""
Stability AI Image Generation Script

Usage:
    python generate.py "mountain landscape" -o mountain.png
    python generate.py "robot" -o robot.png --style anime -r 1:1
"""

import argparse
import os
import sys
import urllib.request
import urllib.error

MODELS = {
    "sd35-large": ("sd3", "sd3.5-large"),
    "sd35-turbo": ("sd3", "sd3.5-large-turbo"),
    "sd35-medium": ("sd3", "sd3.5-medium"),
    "sd3-large": ("sd3", "sd3-large"),
    "sd3-medium": ("sd3", "sd3-medium"),
    "core": ("core", None),
    "ultra": ("ultra", None),
}

ASPECT_RATIOS = ["16:9", "1:1", "21:9", "2:3", "3:2", "4:5", "5:4", "9:16", "9:21"]

STYLE_PRESETS = [
    "3d-model", "analog-film", "anime", "cinematic", "comic-book",
    "digital-art", "enhance", "fantasy-art", "isometric", "line-art",
    "low-poly", "modeling-compound", "neon-punk", "origami",
    "photographic", "pixel-art", "tile-texture"
]


def generate_image(
    prompt: str,
    output_path: str,
    model: str = "sd3.5-large",
    negative_prompt: str | None = None,
    aspect_ratio: str = "1:1",
    style_preset: str | None = None,
    seed: int | None = None,
    output_format: str = "png",
    api_key: str | None = None,
) -> dict:
    """Generate image using Stability AI."""

    api_key = api_key or os.environ.get("STABILITY_API_KEY")
    if not api_key:
        return {"success": False, "error": "STABILITY_API_KEY not set"}

    # Resolve model alias
    endpoint = model
    model_param = None
    if model in MODELS:
        endpoint, model_param = MODELS[model]

    url = f"https://api.stability.ai/v2beta/stable-image/generate/{endpoint}"

    # Build multipart form data
    boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
    body_parts = []

    def add_field(name: str, value: str):
        body_parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n')

    add_field("prompt", prompt)
    add_field("output_format", output_format)

    if model_param:
        add_field("model", model_param)

    if aspect_ratio in ASPECT_RATIOS:
        add_field("aspect_ratio", aspect_ratio)

    if negative_prompt:
        add_field("negative_prompt", negative_prompt)

    if style_preset and style_preset in STYLE_PRESETS:
        add_field("style_preset", style_preset)

    if seed is not None:
        add_field("seed", str(seed))

    body_parts.append(f'--{boundary}--\r\n')
    body = "".join(body_parts).encode("utf-8")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Accept": "image/*",
        "User-Agent": "VibeFrame/1.0",
    }

    try:
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=120) as response:
            image_data = response.read()
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        return {"success": False, "error": f"API error ({e.code}): {error_body}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

    try:
        with open(output_path, "wb") as f:
            f.write(image_data)
    except Exception as e:
        return {"success": False, "error": f"Failed to save: {e}"}

    return {
        "success": True,
        "output_path": output_path,
        "size_bytes": len(image_data),
    }


def main():
    parser = argparse.ArgumentParser(description="Stability AI Image Generation")
    parser.add_argument("prompt", help="Image description")
    parser.add_argument("-o", "--output", required=True, help="Output file path")
    parser.add_argument("-m", "--model", default="sd35-large",
                        help=f"Model: {', '.join(MODELS.keys())} (default: sd35-large)")
    parser.add_argument("-n", "--negative", help="Negative prompt")
    parser.add_argument("-r", "--ratio", default="1:1", choices=ASPECT_RATIOS, help="Aspect ratio")
    parser.add_argument("-s", "--style", choices=STYLE_PRESETS, help="Style preset")
    parser.add_argument("--seed", type=int, help="Random seed")
    parser.add_argument("-f", "--format", choices=["png", "jpeg", "webp"], default="png", help="Output format")
    parser.add_argument("-k", "--api-key", help="API key (or set STABILITY_API_KEY)")

    args = parser.parse_args()

    print(f"Generating: {args.prompt}")

    result = generate_image(
        prompt=args.prompt,
        output_path=args.output,
        model=args.model,
        negative_prompt=args.negative,
        aspect_ratio=args.ratio,
        style_preset=args.style,
        seed=args.seed,
        output_format=args.format,
        api_key=args.api_key,
    )

    if result["success"]:
        print(f"Saved to: {result['output_path']}")
        print(f"Size: {result['size_bytes']:,} bytes")
    else:
        print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
