#!/usr/bin/env python3
"""
ElevenLabs Sound Effects Script

Usage:
    python sfx.py "thunder crash" -o thunder.mp3
    python sfx.py "whoosh" -o whoosh.mp3 -d 2
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error


def generate_sfx(
    prompt: str,
    output_path: str,
    duration: float | None = None,
    prompt_influence: float = 0.3,
    api_key: str | None = None,
) -> dict:
    """Generate sound effect from text prompt."""

    api_key = api_key or os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        return {"success": False, "error": "ELEVENLABS_API_KEY not set"}

    url = "https://api.elevenlabs.io/v1/sound-generation"

    payload = {
        "text": prompt,
        "prompt_influence": prompt_influence,
    }

    if duration is not None:
        # Clamp to valid range
        duration = max(0.5, min(22, duration))
        payload["duration_seconds"] = duration

    data = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "xi-api-key": api_key,
        "Accept": "audio/mpeg",
    }

    try:
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=120) as response:
            audio_data = response.read()
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        return {"success": False, "error": f"API error ({e.code}): {error_body}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

    try:
        with open(output_path, "wb") as f:
            f.write(audio_data)
    except Exception as e:
        return {"success": False, "error": f"Failed to save: {e}"}

    return {
        "success": True,
        "output_path": output_path,
        "size_bytes": len(audio_data),
    }


def main():
    parser = argparse.ArgumentParser(description="ElevenLabs Sound Effects")
    parser.add_argument("prompt", help="Sound effect description")
    parser.add_argument("-o", "--output", required=True, help="Output file path")
    parser.add_argument("-d", "--duration", type=float, help="Duration in seconds (0.5-22)")
    parser.add_argument("-i", "--influence", type=float, default=0.3, help="Prompt influence (0-1)")
    parser.add_argument("-k", "--api-key", help="API key (or set ELEVENLABS_API_KEY)")

    args = parser.parse_args()

    print(f"Generating sound effect: {args.prompt}")

    result = generate_sfx(
        prompt=args.prompt,
        output_path=args.output,
        duration=args.duration,
        prompt_influence=args.influence,
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
