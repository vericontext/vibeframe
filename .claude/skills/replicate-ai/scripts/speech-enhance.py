#!/usr/bin/env python3
"""
Replicate Speech Enhancement Script

Enhance and restore speech audio quality using AI models.

Usage:
    python speech-enhance.py noisy.mp3 -o clean.mp3
    python speech-enhance.py recording.wav -o enhanced.wav --denoise --dereverb

Requirements:
    - REPLICATE_API_TOKEN environment variable
    - Python 3.8+
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path


def audio_to_data_uri(file_path: str) -> str:
    """Convert audio file to data URI."""
    ext = Path(file_path).suffix.lower()
    mime_types = {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".m4a": "audio/mp4",
        ".ogg": "audio/ogg",
        ".flac": "audio/flac",
    }
    mime_type = mime_types.get(ext, "audio/mpeg")

    with open(file_path, "rb") as f:
        data = base64.b64encode(f.read()).decode()

    return f"data:{mime_type};base64,{data}"


def enhance_speech(
    audio_path: str | None = None,
    audio_url: str | None = None,
    output_path: str = None,
    denoise: bool = True,
    dereverb: bool = False,
    api_key: str | None = None,
) -> dict:
    """Enhance speech using Resemble Enhance on Replicate."""

    api_key = api_key or os.environ.get("REPLICATE_API_TOKEN")
    if not api_key:
        return {"success": False, "error": "REPLICATE_API_TOKEN environment variable not set"}

    # Determine audio source
    if audio_url:
        source = audio_url
    elif audio_path:
        if not os.path.exists(audio_path):
            return {"success": False, "error": f"Audio file not found: {audio_path}"}
        source = audio_to_data_uri(audio_path)
    else:
        return {"success": False, "error": "Either audio file or URL required"}

    url = "https://api.replicate.com/v1/predictions"

    # Using resemble-ai/resemble-enhance model
    # https://replicate.com/lucataco/resemble-enhance
    payload = {
        "version": "93266a7e7f5805fb79bcf213b1a4e0ef2e45aff3c06eefd96c59e850c87fd6a2",
        "input": {
            "audio": source,
            "solver": "Midpoint",
            "denoise": denoise,
            "nfe": 64,
            "tau": 0.5,
        }
    }

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
        print("Enhancing speech...")

        # Poll for completion
        status_url = f"https://api.replicate.com/v1/predictions/{prediction_id}"
        headers_get = {"Authorization": f"Bearer {api_key}"}
        start_time = time.time()
        timeout = 300

        while time.time() - start_time < timeout:
            req = urllib.request.Request(status_url, headers=headers_get, method="GET")
            with urllib.request.urlopen(req, timeout=30) as response:
                status_result = json.loads(response.read().decode("utf-8"))

            status = status_result.get("status")
            print(f"Status: {status}")

            if status == "succeeded":
                output = status_result.get("output")
                if output:
                    output_url = output if isinstance(output, str) else output[0]
                    urllib.request.urlretrieve(output_url, output_path)
                    return {
                        "success": True,
                        "output": output_path,
                        "prediction_id": prediction_id,
                    }
                return {"success": False, "error": "No output URL"}

            elif status == "failed":
                error = status_result.get("error", "Unknown error")
                return {"success": False, "error": f"Enhancement failed: {error}"}

            time.sleep(3)

        return {"success": False, "error": "Timeout"}

    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        return {"success": False, "error": f"API error ({e.code}): {error_body}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def main():
    parser = argparse.ArgumentParser(
        description="Enhance speech audio using AI on Replicate",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Basic speech enhancement
    %(prog)s recording.mp3 -o enhanced.mp3

    # With denoising
    %(prog)s noisy.wav -o clean.wav --denoise

    # From URL
    %(prog)s --url https://example.com/audio.mp3 -o enhanced.mp3

Use cases:
    - Clean up noisy recordings
    - Enhance podcast/interview audio
    - Improve voice quality for voiceovers
    - Restore old/degraded audio
        """
    )

    parser.add_argument("audio", nargs="?", help="Audio file path")
    parser.add_argument("-u", "--url", help="Audio URL")
    parser.add_argument("-o", "--output", required=True, help="Output file path")
    parser.add_argument("--denoise", action="store_true", default=True, help="Apply denoising (default)")
    parser.add_argument("--no-denoise", dest="denoise", action="store_false", help="Disable denoising")
    parser.add_argument("--dereverb", action="store_true", help="Apply dereverberation")
    parser.add_argument("-k", "--api-key", help="Replicate API token")
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose output")

    args = parser.parse_args()

    if not args.audio and not args.url:
        print("Error: Either audio file or --url required", file=sys.stderr)
        sys.exit(1)

    result = enhance_speech(
        audio_path=args.audio,
        audio_url=args.url,
        output_path=args.output,
        denoise=args.denoise,
        dereverb=args.dereverb,
        api_key=args.api_key,
    )

    if result["success"]:
        print(f"Saved: {result['output']}")
        if args.verbose:
            print(f"Prediction ID: {result['prediction_id']}")
        sys.exit(0)
    else:
        print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
