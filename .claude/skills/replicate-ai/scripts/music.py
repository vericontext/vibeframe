#!/usr/bin/env python3
"""
Music Generation using Replicate (MusicGen)

Usage:
    python music.py "upbeat electronic intro" -o music.mp3
    python music.py "cinematic orchestral" -o bgm.mp3 -d 30
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error


BASE_URL = "https://api.replicate.com/v1"
MODEL_VERSION = "671ac645ce5e552cc63a54a2bbff63fcf798043ac68f86b6f8d6e7df5c6a5a57"  # MusicGen
POLL_INTERVAL = 3
MAX_WAIT = 300


def generate_music(
    prompt: str,
    output_path: str,
    duration: int = 10,
    model_version: str = "stereo-melody-large",
    api_key: str | None = None,
) -> dict:
    """Generate music using MusicGen on Replicate."""

    api_key = api_key or os.environ.get("REPLICATE_API_TOKEN")
    if not api_key:
        return {"success": False, "error": "REPLICATE_API_TOKEN not set"}

    input_data = {
        "prompt": prompt,
        "duration": duration,
        "model_version": model_version,
        "output_format": "mp3",
        "normalization_strategy": "peak",
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
                        audio_data = response.read()
                    with open(output_path, "wb") as f:
                        f.write(audio_data)
                    return {
                        "success": True,
                        "output_path": output_path,
                        "size_bytes": len(audio_data),
                        "duration": duration,
                    }
                except Exception as e:
                    return {"success": False, "error": f"Download failed: {e}"}
            return {"success": False, "error": "No output URL"}

        elif task_status == "failed":
            return {"success": False, "error": status.get("error", "Unknown error")}

        time.sleep(POLL_INTERVAL)

    return {"success": False, "error": "Timeout"}


def main():
    parser = argparse.ArgumentParser(description="Generate music with MusicGen")
    parser.add_argument("prompt", help="Music description")
    parser.add_argument("-o", "--output", required=True, help="Output audio path")
    parser.add_argument("-d", "--duration", type=int, default=10, help="Duration in seconds (max 30)")
    parser.add_argument("-m", "--model", default="stereo-melody-large",
                        choices=["stereo-melody-large", "stereo-large", "melody-large", "large"],
                        help="Model variant")
    parser.add_argument("-k", "--api-key", help="API key (or set REPLICATE_API_TOKEN)")

    args = parser.parse_args()

    print(f"Generating: {args.prompt}")
    print(f"Duration: {args.duration}s, Model: {args.model}")

    result = generate_music(
        prompt=args.prompt,
        output_path=args.output,
        duration=args.duration,
        model_version=args.model,
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
