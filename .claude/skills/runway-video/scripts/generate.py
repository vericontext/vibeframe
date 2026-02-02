#!/usr/bin/env python3
"""
Runway Video Generation Script

Usage:
    python generate.py "sunset over ocean" -o sunset.mp4
    python generate.py "animate" -i photo.png -o animated.mp4
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.request
import urllib.error

BASE_URL = "https://api.dev.runwayml.com/v1"
POLL_INTERVAL = 5  # seconds
MAX_WAIT = 300  # 5 minutes


def generate_video(
    prompt: str,
    output_path: str,
    image_path: str | None = None,
    duration: int = 5,
    ratio: str = "16:9",
    seed: int | None = None,
    api_key: str | None = None,
) -> dict:
    """Generate video using Runway Gen-3."""

    api_key = api_key or os.environ.get("RUNWAY_API_SECRET")
    if not api_key:
        return {"success": False, "error": "RUNWAY_API_SECRET not set"}

    # Build request body
    body = {
        "promptText": prompt,
        "model": "gen3a_turbo",
        "duration": duration,
        "ratio": ratio,
        "watermark": False,
    }

    if seed is not None:
        body["seed"] = seed

    # Add reference image if provided
    if image_path:
        try:
            with open(image_path, "rb") as f:
                image_data = base64.b64encode(f.read()).decode("utf-8")
            ext = image_path.lower().split(".")[-1]
            mime_types = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif", "webp": "image/webp"}
            mime_type = mime_types.get(ext, "image/png")
            body["promptImage"] = f"data:{mime_type};base64,{image_data}"
        except Exception as e:
            return {"success": False, "error": f"Failed to read image: {e}"}

    # Start generation
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "X-Runway-Version": "2024-11-06",
    }

    try:
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(f"{BASE_URL}/image_to_video", data=data, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        return {"success": False, "error": f"API error ({e.code}): {error_body}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

    task_id = result.get("id")
    if not task_id:
        return {"success": False, "error": "No task ID returned"}

    print(f"Task started: {task_id}")

    # Poll for completion
    start_time = time.time()
    while time.time() - start_time < MAX_WAIT:
        try:
            req = urllib.request.Request(f"{BASE_URL}/tasks/{task_id}", headers=headers)
            with urllib.request.urlopen(req, timeout=30) as response:
                status = json.loads(response.read().decode("utf-8"))
        except Exception as e:
            print(f"Status check failed: {e}")
            time.sleep(POLL_INTERVAL)
            continue

        task_status = status.get("status", "PENDING")
        progress = status.get("progress", 0)
        print(f"Status: {task_status} ({progress}%)")

        if task_status == "SUCCEEDED":
            output_urls = status.get("output", [])
            if output_urls:
                # Download video
                try:
                    video_url = output_urls[0]
                    req = urllib.request.Request(video_url)
                    with urllib.request.urlopen(req, timeout=120) as response:
                        video_data = response.read()
                    with open(output_path, "wb") as f:
                        f.write(video_data)
                    return {
                        "success": True,
                        "output_path": output_path,
                        "size_bytes": len(video_data),
                        "task_id": task_id,
                    }
                except Exception as e:
                    return {"success": False, "error": f"Failed to download: {e}"}
            return {"success": False, "error": "No output URL"}

        elif task_status == "FAILED":
            failure = status.get("failure", "Unknown error")
            return {"success": False, "error": failure}

        elif task_status == "CANCELLED":
            return {"success": False, "error": "Task was cancelled"}

        time.sleep(POLL_INTERVAL)

    return {"success": False, "error": "Timeout waiting for completion"}


def main():
    parser = argparse.ArgumentParser(description="Runway Video Generation")
    parser.add_argument("prompt", help="Text description of the video")
    parser.add_argument("-o", "--output", required=True, help="Output video path")
    parser.add_argument("-i", "--image", help="Reference image for image-to-video")
    parser.add_argument("-d", "--duration", type=int, choices=[5, 10], default=5, help="Duration (5 or 10 seconds)")
    parser.add_argument("-r", "--ratio", choices=["16:9", "9:16"], default="16:9", help="Aspect ratio")
    parser.add_argument("-s", "--seed", type=int, help="Random seed for reproducibility")
    parser.add_argument("-k", "--api-key", help="API key (or set RUNWAY_API_SECRET)")

    args = parser.parse_args()

    print(f"Generating video: {args.prompt}")
    if args.image:
        print(f"Reference image: {args.image}")

    result = generate_video(
        prompt=args.prompt,
        output_path=args.output,
        image_path=args.image,
        duration=args.duration,
        ratio=args.ratio,
        seed=args.seed,
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
