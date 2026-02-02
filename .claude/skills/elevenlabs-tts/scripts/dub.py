#!/usr/bin/env python3
"""
ElevenLabs Dubbing Script

Automatically dub videos into different languages using ElevenLabs API.

Usage:
    python dub.py video.mp4 -o dubbed.mp4 --target-lang es
    python dub.py video.mp4 -o dubbed.mp4 --target-lang ko --source-lang en

Requirements:
    - ELEVENLABS_API_KEY environment variable
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


def get_mime_type(file_path: str) -> str:
    """Get MIME type from file extension."""
    ext = Path(file_path).suffix.lower()
    mime_types = {
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".avi": "video/x-msvideo",
        ".webm": "video/webm",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".m4a": "audio/mp4",
    }
    return mime_types.get(ext, "video/mp4")


def create_dubbing_project(
    file_path: str,
    target_lang: str,
    source_lang: str | None = None,
    name: str | None = None,
    api_key: str | None = None,
) -> dict:
    """Create a dubbing project using ElevenLabs API."""

    api_key = api_key or os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        return {"success": False, "error": "ELEVENLABS_API_KEY environment variable not set"}

    if not os.path.exists(file_path):
        return {"success": False, "error": f"File not found: {file_path}"}

    url = "https://api.elevenlabs.io/v1/dubbing"

    # Build multipart form data
    boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"

    filename = Path(file_path).name
    mime_type = get_mime_type(file_path)

    with open(file_path, "rb") as f:
        file_data = f.read()

    body_parts = []

    # Add file
    body_parts.append(f"--{boundary}".encode())
    body_parts.append(f'Content-Disposition: form-data; name="file"; filename="{filename}"'.encode())
    body_parts.append(f"Content-Type: {mime_type}".encode())
    body_parts.append(b"")
    body_parts.append(file_data)

    # Add target language
    body_parts.append(f"--{boundary}".encode())
    body_parts.append(b'Content-Disposition: form-data; name="target_lang"')
    body_parts.append(b"")
    body_parts.append(target_lang.encode())

    # Add source language if provided
    if source_lang:
        body_parts.append(f"--{boundary}".encode())
        body_parts.append(b'Content-Disposition: form-data; name="source_lang"')
        body_parts.append(b"")
        body_parts.append(source_lang.encode())

    # Add project name
    if name:
        body_parts.append(f"--{boundary}".encode())
        body_parts.append(b'Content-Disposition: form-data; name="name"')
        body_parts.append(b"")
        body_parts.append(name.encode())

    body_parts.append(f"--{boundary}--".encode())
    body_parts.append(b"")

    body = b"\r\n".join(body_parts)

    headers = {
        "xi-api-key": api_key,
        "Accept": "application/json",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    }

    try:
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=120) as response:
            result = json.loads(response.read().decode("utf-8"))

            return {
                "success": True,
                "dubbing_id": result.get("dubbing_id"),
                "expected_duration": result.get("expected_duration_sec"),
            }
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        try:
            error_json = json.loads(error_body)
            error_msg = error_json.get("detail", {}).get("message", error_body)
        except (json.JSONDecodeError, TypeError):
            error_msg = error_body
        return {"success": False, "error": f"API error ({e.code}): {error_msg}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_dubbing_status(dubbing_id: str, api_key: str | None = None) -> dict:
    """Check dubbing project status."""

    api_key = api_key or os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        return {"success": False, "error": "ELEVENLABS_API_KEY not set"}

    url = f"https://api.elevenlabs.io/v1/dubbing/{dubbing_id}"

    headers = {
        "xi-api-key": api_key,
        "Accept": "application/json",
    }

    try:
        req = urllib.request.Request(url, headers=headers, method="GET")
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
            return {
                "success": True,
                "status": result.get("status"),
                "target_languages": result.get("target_languages", []),
                "error": result.get("error"),
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


def download_dubbed_file(
    dubbing_id: str,
    language_code: str,
    output_path: str,
    api_key: str | None = None,
) -> dict:
    """Download the dubbed file."""

    api_key = api_key or os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        return {"success": False, "error": "ELEVENLABS_API_KEY not set"}

    url = f"https://api.elevenlabs.io/v1/dubbing/{dubbing_id}/audio/{language_code}"

    headers = {
        "xi-api-key": api_key,
        "Accept": "audio/mpeg",
    }

    try:
        req = urllib.request.Request(url, headers=headers, method="GET")
        with urllib.request.urlopen(req, timeout=300) as response:
            with open(output_path, "wb") as f:
                f.write(response.read())
            return {"success": True, "output": output_path}
    except Exception as e:
        return {"success": False, "error": str(e)}


def dub_video(
    file_path: str,
    output_path: str,
    target_lang: str,
    source_lang: str | None = None,
    api_key: str | None = None,
) -> dict:
    """Full dubbing pipeline: create, wait, download."""

    # Step 1: Create dubbing project
    print(f"Creating dubbing project ({target_lang})...")
    create_result = create_dubbing_project(
        file_path=file_path,
        target_lang=target_lang,
        source_lang=source_lang,
        api_key=api_key,
    )

    if not create_result["success"]:
        return create_result

    dubbing_id = create_result["dubbing_id"]
    print(f"Dubbing ID: {dubbing_id}")

    expected_duration = create_result.get("expected_duration")
    if expected_duration:
        print(f"Expected duration: {expected_duration}s")

    # Step 2: Poll for completion
    print("Processing dubbing...")
    start_time = time.time()
    timeout = 1800  # 30 minutes

    while time.time() - start_time < timeout:
        status_result = get_dubbing_status(dubbing_id, api_key)

        if not status_result["success"]:
            return status_result

        status = status_result["status"]
        print(f"Status: {status}")

        if status == "dubbed":
            # Step 3: Download
            print("Downloading dubbed file...")
            return download_dubbed_file(
                dubbing_id=dubbing_id,
                language_code=target_lang,
                output_path=output_path,
                api_key=api_key,
            )

        elif status == "failed":
            return {"success": False, "error": status_result.get("error", "Dubbing failed")}

        time.sleep(10)

    return {"success": False, "error": "Timeout waiting for dubbing"}


def main():
    parser = argparse.ArgumentParser(
        description="Dub videos into different languages using ElevenLabs",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Dub to Spanish (auto-detect source)
    %(prog)s video.mp4 -o dubbed_es.mp4 --target-lang es

    # Dub to Korean with explicit source language
    %(prog)s video.mp4 -o dubbed_ko.mp4 --target-lang ko --source-lang en

    # Dub to Japanese
    %(prog)s podcast.mp3 -o podcast_ja.mp3 --target-lang ja

Supported languages:
    en (English), es (Spanish), fr (French), de (German),
    it (Italian), pt (Portuguese), pl (Polish), hi (Hindi),
    zh (Chinese), ja (Japanese), ko (Korean), and more.
        """
    )

    parser.add_argument("file", help="Video or audio file to dub")
    parser.add_argument("-o", "--output", required=True, help="Output file path")
    parser.add_argument("-t", "--target-lang", required=True, help="Target language code (e.g., es, ko, ja)")
    parser.add_argument("-s", "--source-lang", help="Source language code (auto-detected if not specified)")
    parser.add_argument("-k", "--api-key", help="ElevenLabs API key")
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose output")

    args = parser.parse_args()

    result = dub_video(
        file_path=args.file,
        output_path=args.output,
        target_lang=args.target_lang,
        source_lang=args.source_lang,
        api_key=args.api_key,
    )

    if result["success"]:
        print(f"Saved: {result['output']}")
        sys.exit(0)
    else:
        print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
