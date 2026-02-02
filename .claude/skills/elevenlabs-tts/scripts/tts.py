#!/usr/bin/env python3
"""
ElevenLabs Text-to-Speech Script

Usage:
    python tts.py "Your text" -o output.mp3
    python tts.py "Your text" -o output.mp3 -v EXAVITQu4vr4xnSDxMaL
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error

VOICES = {
    "rachel": "21m00Tcm4TlvDq8ikWAM",
    "adam": "pNInz6obpgDQGcFmaJgB",
    "bella": "EXAVITQu4vr4xnSDxMaL",
    "antoni": "ErXwobaYiN019PkySvjV",
    "elli": "MF3mGyEYCl7XYWbV9V6O",
    "josh": "TxGEqnHWrfWFTfGW9XjX",
}

def text_to_speech(
    text: str,
    output_path: str,
    voice_id: str = "EXAVITQu4vr4xnSDxMaL",
    model: str = "eleven_multilingual_v2",
    stability: float = 0.5,
    similarity_boost: float = 0.75,
    api_key: str | None = None,
) -> dict:
    """Generate speech from text."""

    api_key = api_key or os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        return {"success": False, "error": "ELEVENLABS_API_KEY not set"}

    # Resolve voice alias
    if voice_id.lower() in VOICES:
        voice_id = VOICES[voice_id.lower()]

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"

    payload = {
        "text": text,
        "model_id": model,
        "voice_settings": {
            "stability": stability,
            "similarity_boost": similarity_boost,
            "style": 0.0,
            "use_speaker_boost": True,
        }
    }

    data = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "xi-api-key": api_key,
        "Accept": "audio/mpeg",
    }

    try:
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=60) as response:
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
        "character_count": len(text),
    }


def main():
    parser = argparse.ArgumentParser(description="ElevenLabs Text-to-Speech")
    parser.add_argument("text", help="Text to convert to speech")
    parser.add_argument("-o", "--output", required=True, help="Output file path")
    parser.add_argument("-v", "--voice", default="bella", help="Voice ID or name (default: bella)")
    parser.add_argument("-m", "--model", default="eleven_multilingual_v2", help="Model ID")
    parser.add_argument("--stability", type=float, default=0.5, help="Stability (0-1)")
    parser.add_argument("--similarity", type=float, default=0.75, help="Similarity boost (0-1)")
    parser.add_argument("-k", "--api-key", help="API key (or set ELEVENLABS_API_KEY)")

    args = parser.parse_args()

    result = text_to_speech(
        text=args.text,
        output_path=args.output,
        voice_id=args.voice,
        model=args.model,
        stability=args.stability,
        similarity_boost=args.similarity,
        api_key=args.api_key,
    )

    if result["success"]:
        print(f"Saved to: {result['output_path']}")
        print(f"Size: {result['size_bytes']:,} bytes")
        print(f"Characters: {result['character_count']}")
    else:
        print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
