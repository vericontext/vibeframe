#!/usr/bin/env python3
"""
Whisper Transcription Script

Usage:
    python whisper.py audio.mp3 -o transcript.json
    python whisper.py audio.mp3 -o subtitles.srt -f srt
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error


def transcribe(
    audio_path: str,
    output_path: str,
    response_format: str = "verbose_json",
    language: str | None = None,
    timestamps: bool = True,
    api_key: str | None = None,
) -> dict:
    """Transcribe audio using Whisper."""

    api_key = api_key or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return {"success": False, "error": "OPENAI_API_KEY not set"}

    if not os.path.exists(audio_path):
        return {"success": False, "error": f"File not found: {audio_path}"}

    # Build multipart form data
    boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"

    with open(audio_path, "rb") as f:
        audio_data = f.read()

    filename = os.path.basename(audio_path)
    body_parts = []

    # File field
    body_parts.append(
        f'--{boundary}\r\n'
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f'Content-Type: audio/mpeg\r\n\r\n'
    )
    body_bytes = body_parts[0].encode("utf-8") + audio_data + b"\r\n"

    # Model field
    body_bytes += f'--{boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n'.encode("utf-8")

    # Response format
    body_bytes += f'--{boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\n{response_format}\r\n'.encode("utf-8")

    # Language (optional)
    if language:
        body_bytes += f'--{boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n{language}\r\n'.encode("utf-8")

    # Timestamps
    if timestamps and response_format == "verbose_json":
        body_bytes += f'--{boundary}\r\nContent-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\nword\r\n'.encode("utf-8")
        body_bytes += f'--{boundary}\r\nContent-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\nsegment\r\n'.encode("utf-8")

    body_bytes += f'--{boundary}--\r\n'.encode("utf-8")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    }

    try:
        req = urllib.request.Request(
            "https://api.openai.com/v1/audio/transcriptions",
            data=body_bytes,
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=300) as response:
            result = response.read()

            if response_format in ["json", "verbose_json"]:
                result = json.loads(result.decode("utf-8"))
            else:
                result = result.decode("utf-8")
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        return {"success": False, "error": f"API error ({e.code}): {error_body}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

    # Save result
    try:
        with open(output_path, "w", encoding="utf-8") as f:
            if isinstance(result, dict):
                json.dump(result, f, indent=2, ensure_ascii=False)
            else:
                f.write(result)
    except Exception as e:
        return {"success": False, "error": f"Failed to save: {e}"}

    return {
        "success": True,
        "output_path": output_path,
        "format": response_format,
        "text": result.get("text") if isinstance(result, dict) else result[:200],
    }


def main():
    parser = argparse.ArgumentParser(description="Whisper Transcription")
    parser.add_argument("audio", help="Input audio file")
    parser.add_argument("-o", "--output", required=True, help="Output file path")
    parser.add_argument("-f", "--format", default="verbose_json",
                        choices=["json", "verbose_json", "text", "srt", "vtt"],
                        help="Output format")
    parser.add_argument("-l", "--language", help="Source language (ISO-639-1)")
    parser.add_argument("--no-timestamps", action="store_true", help="Disable timestamps")
    parser.add_argument("-k", "--api-key", help="API key (or set OPENAI_API_KEY)")

    args = parser.parse_args()

    print(f"Transcribing: {args.audio}")

    result = transcribe(
        audio_path=args.audio,
        output_path=args.output,
        response_format=args.format,
        language=args.language,
        timestamps=not args.no_timestamps,
        api_key=args.api_key,
    )

    if result["success"]:
        print(f"Saved to: {result['output_path']}")
        print(f"Format: {result['format']}")
        if result.get("text"):
            preview = result["text"][:100] + "..." if len(result["text"]) > 100 else result["text"]
            print(f"Preview: {preview}")
    else:
        print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
