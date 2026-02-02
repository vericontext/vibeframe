#!/usr/bin/env python3
"""
Video Command Parser using Claude

Usage:
    python parse.py "trim first 10 seconds"
    python parse.py "add fade in and fade out" -o command.json
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error


SYSTEM_PROMPT = """You are a video editing command parser. Convert natural language video editing commands into structured JSON.

Output format:
{
  "action": "string (trim, cut, fade, filter, speed, split, merge, etc.)",
  "parameters": {
    // action-specific parameters
  },
  "target": "string (optional: specific clip or track)"
}

Examples:
- "trim first 10 seconds" -> {"action": "trim", "parameters": {"start": 0, "end": 10, "mode": "remove"}}
- "add fade in" -> {"action": "fade", "parameters": {"type": "in", "duration": 1}}
- "speed up 2x" -> {"action": "speed", "parameters": {"factor": 2}}
- "add blur filter" -> {"action": "filter", "parameters": {"type": "blur", "intensity": 0.5}}

Output ONLY valid JSON, no explanations."""


def parse_command(
    command: str,
    model: str = "claude-sonnet-4-20250514",
    api_key: str | None = None,
) -> dict:
    """Parse natural language video command using Claude."""

    api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return {"success": False, "error": "ANTHROPIC_API_KEY not set"}

    body = {
        "model": model,
        "max_tokens": 1024,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": command}],
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
        with urllib.request.urlopen(req, timeout=60) as response:
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

    # Parse JSON from response
    try:
        parsed = json.loads(text_content.strip())
    except json.JSONDecodeError as e:
        return {"success": False, "error": f"Invalid JSON response: {e}", "raw": text_content}

    return {
        "success": True,
        "command": parsed,
        "original": command,
    }


def main():
    parser = argparse.ArgumentParser(description="Parse video editing commands")
    parser.add_argument("command", help="Natural language video command")
    parser.add_argument("-o", "--output", help="Save JSON to file")
    parser.add_argument("-m", "--model", default="claude-sonnet-4-20250514", help="Model")
    parser.add_argument("-k", "--api-key", help="API key (or set ANTHROPIC_API_KEY)")

    args = parser.parse_args()

    result = parse_command(
        command=args.command,
        model=args.model,
        api_key=args.api_key,
    )

    if result["success"]:
        output = json.dumps(result["command"], indent=2)
        print(output)

        if args.output:
            with open(args.output, "w") as f:
                f.write(output)
            print(f"\nSaved to: {args.output}", file=sys.stderr)
    else:
        print(f"Error: {result['error']}", file=sys.stderr)
        if result.get("raw"):
            print(f"Raw response: {result['raw']}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
