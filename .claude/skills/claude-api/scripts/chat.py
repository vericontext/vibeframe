#!/usr/bin/env python3
"""
Claude Chat Script

Usage:
    python chat.py "your prompt"
    python chat.py "parse command" -m claude-sonnet-4-20250514 -s "You are a video editor"
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error


MODELS = {
    "opus": "claude-opus-4-5-20251101",
    "sonnet": "claude-sonnet-4-20250514",
    "haiku": "claude-3-5-haiku-20241022",
}


def chat(
    prompt: str,
    model: str = "claude-sonnet-4-20250514",
    system: str | None = None,
    max_tokens: int = 1024,
    api_key: str | None = None,
) -> dict:
    """Send message to Claude API."""

    api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return {"success": False, "error": "ANTHROPIC_API_KEY not set"}

    # Resolve model alias
    if model in MODELS:
        model = MODELS[model]

    body = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }

    if system:
        body["system"] = system

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

    usage = result.get("usage", {})

    return {
        "success": True,
        "content": text_content,
        "model": model,
        "usage": usage,
    }


def main():
    parser = argparse.ArgumentParser(description="Claude Chat")
    parser.add_argument("prompt", help="User prompt")
    parser.add_argument("-m", "--model", default="sonnet",
                        help="Model: opus, sonnet, haiku, or full model ID")
    parser.add_argument("-s", "--system", help="System prompt")
    parser.add_argument("--max-tokens", type=int, default=1024, help="Max tokens")
    parser.add_argument("-k", "--api-key", help="API key (or set ANTHROPIC_API_KEY)")
    parser.add_argument("-j", "--json", action="store_true", help="Output as JSON")

    args = parser.parse_args()

    result = chat(
        prompt=args.prompt,
        model=args.model,
        system=args.system,
        max_tokens=args.max_tokens,
        api_key=args.api_key,
    )

    if args.json:
        print(json.dumps(result, indent=2))
    elif result["success"]:
        print(result["content"])
    else:
        print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
