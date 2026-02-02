#!/usr/bin/env python3
"""
Runway Video Generation Script

Usage:
    python generate.py "sunset over ocean" -o sunset.mp4
    python generate.py "animate" -i photo.png -o animated.mp4

Requires: pip install runwayml
"""

import argparse
import base64
import os
import sys
import urllib.request

try:
    from runwayml import RunwayML, TaskFailedError
except ImportError:
    print("Error: runwayml package not installed. Run: pip install runwayml", file=sys.stderr)
    sys.exit(1)


def generate_video(
    prompt: str,
    output_path: str,
    image_path: str | None = None,
    image_url: str | None = None,
    duration: int = 5,
    ratio: str = "16:9",
    api_key: str | None = None,
) -> dict:
    """Generate video using Runway Gen-4 Turbo."""

    api_key = api_key or os.environ.get("RUNWAY_API_SECRET")
    if not api_key:
        return {"success": False, "error": "RUNWAY_API_SECRET not set"}

    # Convert ratio format (16:9 -> 1280:720)
    ratio_map = {
        "16:9": "1280:720",
        "9:16": "720:1280",
        "1:1": "1080:1080",
    }
    api_ratio = ratio_map.get(ratio, "1280:720")

    # Initialize client
    client = RunwayML(api_key=api_key)

    # Prepare prompt_image
    prompt_image = None
    if image_path:
        try:
            with open(image_path, "rb") as f:
                image_data = base64.b64encode(f.read()).decode("utf-8")
            ext = image_path.lower().split(".")[-1]
            mime_types = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif", "webp": "image/webp"}
            mime_type = mime_types.get(ext, "image/png")
            prompt_image = f"data:{mime_type};base64,{image_data}"
        except Exception as e:
            return {"success": False, "error": f"Failed to read image: {e}"}
    elif image_url:
        prompt_image = image_url

    # Generate video
    try:
        print(f"Starting generation with gen4_turbo...")
        print(f"Prompt: {prompt}")
        print(f"Ratio: {api_ratio}, Duration: {duration}s")

        if prompt_image:
            # Image-to-video
            task = client.image_to_video.create(
                model="gen4_turbo",
                prompt_image=prompt_image,
                prompt_text=prompt,
                ratio=api_ratio,
                duration=duration,
            ).wait_for_task_output()
        else:
            # Text-to-video (still requires image for gen4)
            # Use a placeholder or return error
            return {"success": False, "error": "gen4_turbo requires an input image. Use -i option."}

        print(f"Task complete: {task.id}")

        # Get video URL from task output
        if task.output and len(task.output) > 0:
            video_url = task.output[0]

            # Download video
            print(f"Downloading video...")
            req = urllib.request.Request(video_url)
            with urllib.request.urlopen(req, timeout=120) as response:
                video_data = response.read()

            with open(output_path, "wb") as f:
                f.write(video_data)

            return {
                "success": True,
                "output_path": output_path,
                "size_bytes": len(video_data),
                "task_id": task.id,
            }
        else:
            return {"success": False, "error": "No output URL in task result"}

    except TaskFailedError as e:
        return {"success": False, "error": f"Task failed: {e.task_details}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def main():
    parser = argparse.ArgumentParser(description="Runway Video Generation")
    parser.add_argument("prompt", help="Text description of the video")
    parser.add_argument("-o", "--output", required=True, help="Output video path")
    parser.add_argument("-i", "--image", help="Reference image path for image-to-video")
    parser.add_argument("-u", "--image-url", help="Reference image URL for image-to-video")
    parser.add_argument("-d", "--duration", type=int, choices=[5, 10], default=5, help="Duration (5 or 10 seconds)")
    parser.add_argument("-r", "--ratio", choices=["16:9", "9:16", "1:1"], default="16:9", help="Aspect ratio")
    parser.add_argument("-k", "--api-key", help="API key (or set RUNWAY_API_SECRET)")

    args = parser.parse_args()

    if not args.image and not args.image_url:
        print("Error: gen4_turbo requires an input image. Use -i or -u option.", file=sys.stderr)
        sys.exit(1)

    result = generate_video(
        prompt=args.prompt,
        output_path=args.output,
        image_path=args.image,
        image_url=args.image_url,
        duration=args.duration,
        ratio=args.ratio,
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
