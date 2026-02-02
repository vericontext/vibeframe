#!/usr/bin/env python3
"""
Background Removal using Replicate (Rembg)

Usage:
    python rembg.py photo.png -o no-bg.png
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
MODEL_VERSION = "fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003"  # Rembg
POLL_INTERVAL = 2
MAX_WAIT = 120


def remove_background(
    image_path: str,
    output_path: str,
    api_key: str | None = None,
) -> dict:
    """Remove background from image using Rembg on Replicate."""

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
                    with urllib.request.urlopen(req, timeout=60) as response:
                        img_data = response.read()
                    with open(output_path, "wb") as f:
                        f.write(img_data)
                    return {
                        "success": True,
                        "output_path": output_path,
                        "size_bytes": len(img_data),
                    }
                except Exception as e:
                    return {"success": False, "error": f"Download failed: {e}"}
            return {"success": False, "error": "No output URL"}

        elif task_status == "failed":
            return {"success": False, "error": status.get("error", "Unknown error")}

        time.sleep(POLL_INTERVAL)

    return {"success": False, "error": "Timeout"}


def main():
    parser = argparse.ArgumentParser(description="Remove image background")
    parser.add_argument("image", help="Input image path")
    parser.add_argument("-o", "--output", required=True, help="Output image path (PNG recommended)")
    parser.add_argument("-k", "--api-key", help="API key (or set REPLICATE_API_TOKEN)")

    args = parser.parse_args()

    print(f"Removing background: {args.image}")

    result = remove_background(
        image_path=args.image,
        output_path=args.output,
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
