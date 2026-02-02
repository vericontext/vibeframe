#!/usr/bin/env python3
"""
Image Upscaling using Replicate (Real-ESRGAN)

Usage:
    python upscale.py input.png -o upscaled.png
    python upscale.py input.png -o upscaled.png -s 4 --face-enhance
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.request
import urllib.error


BASE_URL = "https://api.replicate.com/v1"
MODEL_VERSION = "42fed1c4974146d4d2414e2be2c5277c7fcf05fcc3a73abf41610695738c1d7b"  # Real-ESRGAN
POLL_INTERVAL = 2
MAX_WAIT = 300


def upscale_image(
    image_path: str,
    output_path: str,
    scale: int = 4,
    face_enhance: bool = False,
    api_key: str | None = None,
) -> dict:
    """Upscale image using Real-ESRGAN on Replicate."""

    api_key = api_key or os.environ.get("REPLICATE_API_TOKEN")
    if not api_key:
        return {"success": False, "error": "REPLICATE_API_TOKEN not set"}

    if not os.path.exists(image_path):
        return {"success": False, "error": f"File not found: {image_path}"}

    # Read and encode image
    with open(image_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode("utf-8")

    ext = image_path.lower().split(".")[-1]
    mime_types = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}
    mime_type = mime_types.get(ext, "image/png")

    input_data = {
        "image": f"data:{mime_type};base64,{image_data}",
        "scale": scale,
        "face_enhance": face_enhance,
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    # Create prediction
    try:
        body = json.dumps({"version": MODEL_VERSION, "input": input_data}).encode("utf-8")
        req = urllib.request.Request(f"{BASE_URL}/predictions", data=body, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        return {"success": False, "error": f"API error ({e.code}): {error_body}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

    prediction_id = result.get("id")
    print(f"Prediction started: {prediction_id}")

    # Poll for completion
    start_time = time.time()
    while time.time() - start_time < MAX_WAIT:
        try:
            req = urllib.request.Request(f"{BASE_URL}/predictions/{prediction_id}", headers=headers)
            with urllib.request.urlopen(req, timeout=30) as response:
                status = json.loads(response.read().decode("utf-8"))
        except Exception as e:
            print(f"Status check failed: {e}")
            time.sleep(POLL_INTERVAL)
            continue

        task_status = status.get("status")
        print(f"Status: {task_status}")

        if task_status == "succeeded":
            output_url = status.get("output")
            if output_url:
                # Download result
                try:
                    req = urllib.request.Request(output_url)
                    with urllib.request.urlopen(req, timeout=120) as response:
                        img_data = response.read()
                    with open(output_path, "wb") as f:
                        f.write(img_data)
                    return {
                        "success": True,
                        "output_path": output_path,
                        "size_bytes": len(img_data),
                        "scale": scale,
                    }
                except Exception as e:
                    return {"success": False, "error": f"Download failed: {e}"}
            return {"success": False, "error": "No output URL"}

        elif task_status == "failed":
            return {"success": False, "error": status.get("error", "Unknown error")}

        time.sleep(POLL_INTERVAL)

    return {"success": False, "error": "Timeout"}


def main():
    parser = argparse.ArgumentParser(description="Upscale image with Real-ESRGAN")
    parser.add_argument("image", help="Input image path")
    parser.add_argument("-o", "--output", required=True, help="Output image path")
    parser.add_argument("-s", "--scale", type=int, default=4, choices=[2, 4], help="Upscale factor")
    parser.add_argument("--face-enhance", action="store_true", help="Enhance faces")
    parser.add_argument("-k", "--api-key", help="API key (or set REPLICATE_API_TOKEN)")

    args = parser.parse_args()

    print(f"Upscaling: {args.image}")
    print(f"Scale: {args.scale}x, Face enhance: {args.face_enhance}")

    result = upscale_image(
        image_path=args.image,
        output_path=args.output,
        scale=args.scale,
        face_enhance=args.face_enhance,
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
