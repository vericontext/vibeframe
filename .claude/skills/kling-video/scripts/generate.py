#!/usr/bin/env python3
"""
Kling AI Video Generation Script

Usage:
    python generate.py "sunset over ocean" -o sunset.mp4
    python generate.py "animate" -i photo.png -o animated.mp4
"""

import argparse
import base64
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.request
import urllib.error

BASE_URL = "https://api.klingai.com/v1"
POLL_INTERVAL = 3  # seconds (faster for v2.x)
MAX_WAIT = 600  # 10 minutes

# Available models
MODELS = {
    "v1": "kling-v1",
    "v1.5": "kling-v1-5",
    "v1.6": "kling-v1-6",
    "v2": "kling-v2-master",
    "v2.1": "kling-v2-1-master",
    "v2.5": "kling-v2-5-turbo",
    "turbo": "kling-v2-5-turbo",
}

# Models that support std mode (faster, cheaper)
STD_MODE_MODELS = ["kling-v1-6", "kling-v2-master", "kling-v2-1-master", "kling-v2-5-turbo"]
DEFAULT_MODEL = "kling-v2-5-turbo"


def generate_jwt(access_key: str, secret_key: str) -> str:
    """Generate JWT token for Kling API."""
    now = int(time.time())

    header = {"alg": "HS256", "typ": "JWT"}
    payload = {"iss": access_key, "exp": now + 1800, "nbf": now - 5}

    def b64url_encode(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b'=').decode('utf-8')

    header_b64 = b64url_encode(json.dumps(header).encode('utf-8'))
    payload_b64 = b64url_encode(json.dumps(payload).encode('utf-8'))

    signature = hmac.new(
        secret_key.encode('utf-8'),
        f"{header_b64}.{payload_b64}".encode('utf-8'),
        hashlib.sha256
    ).digest()
    signature_b64 = b64url_encode(signature)

    return f"{header_b64}.{payload_b64}.{signature_b64}"


def generate_video(
    prompt: str,
    output_path: str,
    image_path: str | None = None,
    duration: str = "5",
    aspect_ratio: str = "16:9",
    mode: str = "std",
    negative_prompt: str | None = None,
    api_key: str | None = None,
    model: str | None = None,
) -> dict:
    """Generate video using Kling AI."""

    api_key = api_key or os.environ.get("KLING_API_KEY")
    if not api_key:
        return {"success": False, "error": "KLING_API_KEY not set"}

    # Parse access_key:secret_key
    parts = api_key.split(":")
    if len(parts) != 2:
        return {"success": False, "error": "Invalid API key format. Use ACCESS_KEY:SECRET_KEY"}

    access_key, secret_key = parts
    token = generate_jwt(access_key, secret_key)

    # Resolve model name
    model_name = MODELS.get(model, model) if model else DEFAULT_MODEL

    # Auto-select mode based on model capability
    effective_mode = mode
    if model_name not in STD_MODE_MODELS and mode == "std":
        effective_mode = "pro"
        print(f"Note: {model_name} doesn't support std mode, using pro")

    # Build request body
    body = {
        "prompt": prompt,
        "model_name": model_name,
        "mode": effective_mode,
        "aspect_ratio": aspect_ratio,
        "duration": duration,
    }

    if negative_prompt:
        body["negative_prompt"] = negative_prompt

    # Determine endpoint
    endpoint = "/videos/text2video"
    task_type = "text2video"

    # Add reference image if provided
    if image_path:
        try:
            with open(image_path, "rb") as f:
                image_data = base64.b64encode(f.read()).decode("utf-8")
            ext = image_path.lower().split(".")[-1]
            mime_types = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png"}
            mime_type = mime_types.get(ext, "image/png")
            body["image"] = f"data:{mime_type};base64,{image_data}"
            endpoint = "/videos/image2video"
            task_type = "image2video"
        except Exception as e:
            return {"success": False, "error": f"Failed to read image: {e}"}

    # Start generation
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    try:
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(f"{BASE_URL}{endpoint}", data=data, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        return {"success": False, "error": f"API error ({e.code}): {error_body}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

    if result.get("code") != 0:
        return {"success": False, "error": result.get("message", "Unknown error")}

    task_id = result.get("data", {}).get("task_id")
    if not task_id:
        return {"success": False, "error": "No task ID returned"}

    print(f"Task started: {task_id}")

    # Poll for completion
    start_time = time.time()
    while time.time() - start_time < MAX_WAIT:
        # Regenerate token for each request (it has short expiry)
        token = generate_jwt(access_key, secret_key)
        headers["Authorization"] = f"Bearer {token}"

        try:
            req = urllib.request.Request(f"{BASE_URL}/videos/{task_type}/{task_id}", headers=headers)
            with urllib.request.urlopen(req, timeout=30) as response:
                status = json.loads(response.read().decode("utf-8"))
        except Exception as e:
            print(f"Status check failed: {e}")
            time.sleep(POLL_INTERVAL)
            continue

        if status.get("code") != 0:
            print(f"Status error: {status.get('message')}")
            time.sleep(POLL_INTERVAL)
            continue

        task_data = status.get("data", {})
        task_status = task_data.get("task_status", "submitted")
        print(f"Status: {task_status}")

        if task_status == "succeed":
            videos = task_data.get("task_result", {}).get("videos", [])
            if videos:
                video_url = videos[0].get("url")
                if video_url:
                    # Download video
                    try:
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
                            "duration": videos[0].get("duration"),
                        }
                    except Exception as e:
                        return {"success": False, "error": f"Failed to download: {e}"}
            return {"success": False, "error": "No video URL in response"}

        elif task_status == "failed":
            error_msg = task_data.get("task_status_msg", "Unknown error")
            return {"success": False, "error": error_msg}

        time.sleep(POLL_INTERVAL)

    return {"success": False, "error": "Timeout waiting for completion"}


def main():
    parser = argparse.ArgumentParser(description="Kling AI Video Generation")
    parser.add_argument("prompt", help="Text description of the video")
    parser.add_argument("-o", "--output", required=True, help="Output video path")
    parser.add_argument("-i", "--image", help="Reference image for image-to-video")
    parser.add_argument("-d", "--duration", choices=["5", "10"], default="5", help="Duration (5 or 10 seconds)")
    parser.add_argument("-r", "--ratio", choices=["16:9", "9:16", "1:1"], default="16:9", help="Aspect ratio")
    parser.add_argument("-m", "--mode", choices=["std", "pro"], default="std", help="Quality mode (std=faster, pro=better)")
    parser.add_argument("-M", "--model", choices=list(MODELS.keys()) + list(MODELS.values()),
                        default="v2.5", help="Model version (v1, v1.5, v1.6, v2, v2.1, v2.5/turbo)")
    parser.add_argument("-n", "--negative", help="Negative prompt")
    parser.add_argument("-k", "--api-key", help="API key (ACCESS_KEY:SECRET_KEY or set KLING_API_KEY)")

    args = parser.parse_args()

    print(f"Generating video: {args.prompt}")
    print(f"Model: {MODELS.get(args.model, args.model)}, Mode: {args.mode}")
    if args.image:
        print(f"Reference image: {args.image}")

    result = generate_video(
        prompt=args.prompt,
        output_path=args.output,
        image_path=args.image,
        duration=args.duration,
        aspect_ratio=args.ratio,
        mode=args.mode,
        negative_prompt=args.negative,
        api_key=args.api_key,
        model=args.model,
    )

    if result["success"]:
        print(f"Saved to: {result['output_path']}")
        print(f"Size: {result['size_bytes']:,} bytes")
        if result.get("duration"):
            print(f"Duration: {result['duration']}s")
    else:
        print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
