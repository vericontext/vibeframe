#!/usr/bin/env python3
"""
Gemini Image Editing Script (Nano Banana)

Edit images using Google Gemini's native image generation with input images.

Usage:
    python edit.py input.png "change the background to sunset" -o output.png
    python edit.py photo.png "convert to watercolor painting" -o watercolor.png -m pro

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
from pathlib import Path

MODELS = {
    "flash": "gemini-2.5-flash-image",
    "pro": "gemini-3-pro-image-preview",
}

ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]

RESOLUTIONS = ["1K", "2K", "4K"]


def get_mime_type(file_path: str) -> str:
    """Get MIME type from file extension."""
    ext = Path(file_path).suffix.lower()
    mime_types = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }
    return mime_types.get(ext, "image/png")


def load_image_as_base64(file_path: str) -> tuple[str, str]:
    """Load image file and return (base64_data, mime_type)."""
    with open(file_path, "rb") as f:
        data = f.read()
    return base64.b64encode(data).decode("utf-8"), get_mime_type(file_path)


def edit_image(
    input_paths: list[str],
    prompt: str,
    output_path: str,
    model: str = "flash",
    aspect_ratio: str | None = None,
    resolution: str | None = None,
    api_key: str | None = None,
) -> dict:
    """Edit image(s) using Gemini API."""

    api_key = api_key or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return {"success": False, "error": "GOOGLE_API_KEY environment variable not set"}

    # Validate input files
    for path in input_paths:
        if not os.path.exists(path):
            return {"success": False, "error": f"Input file not found: {path}"}

    # Resolve model alias
    model_id = MODELS.get(model, model)
    is_pro = "pro" in model_id.lower()

    # Validate number of reference images
    max_images = 14 if is_pro else 3
    if len(input_paths) > max_images:
        return {"success": False, "error": f"Too many input images. {model_id} supports up to {max_images} images."}

    # Validate resolution (Pro only)
    if resolution and not is_pro:
        print(f"Warning: Resolution is only supported on Pro model. Ignoring -s {resolution}")
        resolution = None

    if resolution and resolution not in RESOLUTIONS:
        return {"success": False, "error": f"Invalid resolution. Choose from: {', '.join(RESOLUTIONS)}"}

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent?key={api_key}"

    # Build parts: text prompt first, then images
    parts = [{"text": prompt}]

    for input_path in input_paths:
        image_b64, mime_type = load_image_as_base64(input_path)
        parts.append({
            "inlineData": {
                "mimeType": mime_type,
                "data": image_b64
            }
        })

    # Build image config
    image_config = {}
    if aspect_ratio and aspect_ratio in ASPECT_RATIOS:
        image_config["aspectRatio"] = aspect_ratio
    if resolution:
        image_config["imageSize"] = resolution

    # Build generation config
    generation_config = {
        "responseModalities": ["TEXT", "IMAGE"],
    }
    if image_config:
        generation_config["imageConfig"] = image_config

    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": generation_config
    }

    data = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}

    try:
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=180) as response:
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
        # Skip thought images (Pro model thinking process)
        if part.get("thought"):
            continue
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
        "model": model_id,
        "input_images": len(input_paths),
    }


def main():
    parser = argparse.ArgumentParser(
        description="Edit images using Gemini (Nano Banana)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Single image editing
    %(prog)s photo.png "change the background to a beach" -o beach.png

    # Style transfer
    %(prog)s portrait.jpg "convert to oil painting style" -o painting.png -m pro

    # Multi-image composition (Pro)
    %(prog)s person1.png person2.png "group photo in an office" -o group.png -m pro

    # With resolution (Pro)
    %(prog)s product.png "add dramatic lighting" -o product_lit.png -m pro -s 2K
        """
    )

    parser.add_argument("inputs", nargs="+", help="Input image file(s) followed by the edit prompt")
    parser.add_argument("-o", "--output", required=True, help="Output file path")
    parser.add_argument(
        "-m", "--model",
        default="flash",
        help="Model: flash (fast, max 3 images), pro (professional, max 14 images)"
    )
    parser.add_argument(
        "-r", "--ratio",
        choices=ASPECT_RATIOS,
        help="Output aspect ratio (optional, defaults to input ratio)"
    )
    parser.add_argument(
        "-s", "--size",
        choices=RESOLUTIONS,
        help="Image resolution: 1K, 2K, 4K (Pro model only)"
    )
    parser.add_argument("-k", "--api-key", help="Google API key (or set GOOGLE_API_KEY env)")
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose output")

    args = parser.parse_args()

    # Parse inputs: last argument is prompt, rest are image files
    if len(args.inputs) < 2:
        parser.error("Need at least one image and a prompt")

    prompt = args.inputs[-1]
    input_paths = args.inputs[:-1]

    # Validate input files exist
    for path in input_paths:
        if not os.path.exists(path):
            print(f"Error: File not found: {path}", file=sys.stderr)
            sys.exit(1)

    model_name = MODELS.get(args.model, args.model)
    if args.verbose:
        print(f"Model: {model_name}")
        print(f"Input images: {', '.join(input_paths)}")
        print(f"Prompt: {prompt}")
        if args.ratio:
            print(f"Aspect ratio: {args.ratio}")
        if args.size:
            print(f"Resolution: {args.size}")

    print(f"Editing {len(input_paths)} image(s) with {model_name}...")

    result = edit_image(
        input_paths=input_paths,
        prompt=prompt,
        output_path=args.output,
        model=args.model,
        aspect_ratio=args.ratio,
        resolution=args.size,
        api_key=args.api_key,
    )

    if result["success"]:
        print(f"Saved to: {result['output_path']}")
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
