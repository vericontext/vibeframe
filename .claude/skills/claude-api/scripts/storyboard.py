#!/usr/bin/env python3
"""
Storyboard Generator using Claude

Usage:
    python storyboard.py "30-second product demo" -o storyboard.json
    python storyboard.py "YouTube intro sequence" -d 5
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error


SYSTEM_PROMPT = """You are a professional video storyboard creator. Create detailed shot lists with timing, camera angles, and visual descriptions.

Output format (JSON):
{
  "title": "string",
  "duration": number (seconds),
  "shots": [
    {
      "shot_number": number,
      "start_time": number (seconds),
      "end_time": number (seconds),
      "duration": number (seconds),
      "shot_type": "string (wide, medium, close-up, extreme close-up, aerial)",
      "camera_movement": "string (static, pan, tilt, dolly, zoom, tracking)",
      "description": "string (visual description)",
      "audio": "string (music, SFX, voiceover notes)",
      "text_overlay": "string or null (any on-screen text)",
      "notes": "string (additional production notes)"
    }
  ],
  "style_notes": "string (overall visual style guidance)"
}

Create professional, actionable storyboards. Output ONLY valid JSON."""


def generate_storyboard(
    description: str,
    duration: int = 30,
    model: str = "claude-sonnet-4-20250514",
    api_key: str | None = None,
) -> dict:
    """Generate storyboard using Claude."""

    api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return {"success": False, "error": "ANTHROPIC_API_KEY not set"}

    prompt = f"Create a {duration}-second video storyboard for: {description}"

    body = {
        "model": model,
        "max_tokens": 4096,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": prompt}],
    }

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }

    try:
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=data,
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        return {"success": False, "error": f"API error ({e.code}): {error_body}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

    content_blocks = result.get("content", [])
    text_content = ""
    for block in content_blocks:
        if block.get("type") == "text":
            text_content += block.get("text", "")

    # Parse JSON
    try:
        storyboard = json.loads(text_content.strip())
    except json.JSONDecodeError as e:
        return {"success": False, "error": f"Invalid JSON: {e}", "raw": text_content}

    return {
        "success": True,
        "storyboard": storyboard,
        "description": description,
    }


def main():
    parser = argparse.ArgumentParser(description="Generate video storyboard")
    parser.add_argument("description", help="Video description")
    parser.add_argument("-d", "--duration", type=int, default=30, help="Duration in seconds")
    parser.add_argument("-o", "--output", help="Output JSON file")
    parser.add_argument("-m", "--model", default="claude-sonnet-4-20250514", help="Model")
    parser.add_argument("-k", "--api-key", help="API key (or set ANTHROPIC_API_KEY)")

    args = parser.parse_args()

    print(f"Generating storyboard: {args.description}", file=sys.stderr)
    print(f"Duration: {args.duration}s", file=sys.stderr)

    result = generate_storyboard(
        description=args.description,
        duration=args.duration,
        model=args.model,
        api_key=args.api_key,
    )

    if result["success"]:
        output = json.dumps(result["storyboard"], indent=2)

        if args.output:
            with open(args.output, "w") as f:
                f.write(output)
            print(f"Saved to: {args.output}", file=sys.stderr)

            # Print summary
            shots = result["storyboard"].get("shots", [])
            print(f"Created {len(shots)} shots", file=sys.stderr)
        else:
            print(output)
    else:
        print(f"Error: {result['error']}", file=sys.stderr)
        if result.get("raw"):
            print(f"Raw: {result['raw'][:500]}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
