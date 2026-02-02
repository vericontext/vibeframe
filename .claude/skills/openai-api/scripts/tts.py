#!/usr/bin/env python3
"""
OpenAI Text-to-Speech Script

Usage:
    python tts.py "Hello world" -o speech.mp3
    python tts.py "Welcome to VibeFrame" -o intro.mp3 -v nova --hd
"""

import argparse
import os
import sys
import json
import urllib.request
import urllib.error


VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"]


def text_to_speech(
    text: str,
    output_path: str,
    voice: str = "alloy",
    model: str = "tts-1",
    speed: float = 1.0,
    response_format: str = "mp3",
    api_key: str | None = None,
) -> dict:
    """Generate speech from text using OpenAI TTS."""

    api_key = api_key or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return {"success": False, "error": "OPENAI_API_KEY not set"}

    body = {
        "model": model,
        "input": text,
        "voice": voice,
        "speed": speed,
        "response_format": response_format,
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            "https://api.openai.com/v1/audio/speech",
            data=data,
            headers=headers,
            method="POST",
        )
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
        "voice": voice,
        "model": model,
    }


def main():
    parser = argparse.ArgumentParser(description="OpenAI Text-to-Speech")
    parser.add_argument("text", help="Text to convert to speech")
    parser.add_argument("-o", "--output", required=True, help="Output file path")
    parser.add_argument("-v", "--voice", default="alloy", choices=VOICES, help="Voice")
    parser.add_argument("--hd", action="store_true", help="Use HD model (tts-1-hd)")
    parser.add_argument("-s", "--speed", type=float, default=1.0, help="Speed (0.25-4.0)")
    parser.add_argument("-f", "--format", default="mp3",
                        choices=["mp3", "opus", "aac", "flac", "wav", "pcm"],
                        help="Output format")
    parser.add_argument("-k", "--api-key", help="API key (or set OPENAI_API_KEY)")

    args = parser.parse_args()

    model = "tts-1-hd" if args.hd else "tts-1"

    print(f"Generating speech: {args.text[:50]}{'...' if len(args.text) > 50 else ''}")
    print(f"Voice: {args.voice}, Model: {model}")

    result = text_to_speech(
        text=args.text,
        output_path=args.output,
        voice=args.voice,
        model=model,
        speed=args.speed,
        response_format=args.format,
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
