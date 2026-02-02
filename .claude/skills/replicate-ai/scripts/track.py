#!/usr/bin/env python3
"""
Replicate Object Tracking Script

Track objects across video frames using AI models.

Usage:
    python track.py video.mp4 -o tracked.json
    python track.py video.mp4 -o tracked.json --prompt "person in red shirt"
    python track.py video.mp4 -o output.mp4 --visualize

Requirements:
    - REPLICATE_API_TOKEN environment variable
    - Python 3.8+
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path


def track_objects(
    video_url: str,
    output_path: str,
    prompt: str | None = None,
    visualize: bool = False,
    api_key: str | None = None,
) -> dict:
    """Track objects in video using SAM2 on Replicate."""

    api_key = api_key or os.environ.get("REPLICATE_API_TOKEN")
    if not api_key:
        return {"success": False, "error": "REPLICATE_API_TOKEN environment variable not set"}

    url = "https://api.replicate.com/v1/predictions"

    # Using meta/sam-2-video for video object tracking
    # https://replicate.com/meta/sam-2-video
    payload = {
        "version": "33432afdfc06a10da6b4018932893d39b0159f838b6d11dd1236dff85cc5ec1d",
        "input": {
            "video": video_url,
        }
    }

    # Add text prompt for guided tracking if provided
    if prompt:
        payload["input"]["prompt"] = prompt

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    data = json.dumps(payload).encode()

    try:
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))

        prediction_id = result.get("id")
        if not prediction_id:
            return {"success": False, "error": "No prediction ID returned"}

        print(f"Prediction ID: {prediction_id}")
        print("Tracking objects...")

        # Poll for completion
        status_url = f"https://api.replicate.com/v1/predictions/{prediction_id}"
        headers_get = {"Authorization": f"Bearer {api_key}"}
        start_time = time.time()
        timeout = 600

        while time.time() - start_time < timeout:
            req = urllib.request.Request(status_url, headers=headers_get, method="GET")
            with urllib.request.urlopen(req, timeout=30) as response:
                status_result = json.loads(response.read().decode("utf-8"))

            status = status_result.get("status")
            print(f"Status: {status}")

            if status == "succeeded":
                output = status_result.get("output")

                if output:
                    # Output could be tracking data or visualized video
                    if isinstance(output, str) and output.startswith("http"):
                        # It's a video URL
                        urllib.request.urlretrieve(output, output_path)
                        return {
                            "success": True,
                            "output": output_path,
                            "type": "video",
                            "prediction_id": prediction_id,
                        }
                    elif isinstance(output, dict) or isinstance(output, list):
                        # It's tracking data
                        with open(output_path, "w") as f:
                            json.dump(output, f, indent=2)
                        return {
                            "success": True,
                            "output": output_path,
                            "type": "json",
                            "prediction_id": prediction_id,
                        }
                    else:
                        # Try to download as file
                        urllib.request.urlretrieve(output, output_path)
                        return {
                            "success": True,
                            "output": output_path,
                            "prediction_id": prediction_id,
                        }

                return {"success": False, "error": "No output in result"}

            elif status == "failed":
                error = status_result.get("error", "Unknown error")
                return {"success": False, "error": f"Tracking failed: {error}"}

            time.sleep(5)

        return {"success": False, "error": "Timeout"}

    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        return {"success": False, "error": f"API error ({e.code}): {error_body}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def main():
    parser = argparse.ArgumentParser(
        description="Track objects in videos using AI on Replicate",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Track all objects in video
    %(prog)s --url https://example.com/video.mp4 -o tracked.json

    # Track specific object with prompt
    %(prog)s --url https://example.com/video.mp4 -o tracked.json --prompt "the red car"

    # Get visualized output
    %(prog)s --url https://example.com/video.mp4 -o tracked.mp4 --visualize

Output formats:
    - JSON: Contains frame-by-frame bounding boxes and masks
    - Video: Visualized tracking with bounding boxes overlaid

Note:
    Video must be accessible via URL. Upload to cloud storage first.
        """
    )

    parser.add_argument("video", nargs="?", help="Local video file (not yet supported)")
    parser.add_argument("-u", "--url", help="Video URL (required)")
    parser.add_argument("-o", "--output", required=True, help="Output file path (.json or .mp4)")
    parser.add_argument("-p", "--prompt", help="Text prompt to identify object to track")
    parser.add_argument("--visualize", action="store_true", help="Output visualized video with tracking")
    parser.add_argument("-k", "--api-key", help="Replicate API token")
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose output")

    args = parser.parse_args()

    if not args.url:
        print("Error: --url required. Video must be accessible via URL.", file=sys.stderr)
        sys.exit(1)

    result = track_objects(
        video_url=args.url,
        output_path=args.output,
        prompt=args.prompt,
        visualize=args.visualize,
        api_key=args.api_key,
    )

    if result["success"]:
        print(f"Saved: {result['output']}")
        if args.verbose:
            print(f"Prediction ID: {result['prediction_id']}")
            if result.get("type"):
                print(f"Output type: {result['type']}")
        sys.exit(0)
    else:
        print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
