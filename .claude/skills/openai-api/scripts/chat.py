#!/usr/bin/env python3
"""
OpenAI Chat Completion Script

Usage:
    python chat.py "your prompt"
    python chat.py "parse this command" -m gpt-4o -s "You are a video editor"
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error


def chat(
    prompt: str,
    model: str = "gpt-4o-mini",
    system: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 1000,
    api_key: str | None = None,
) -> dict:
    """Send chat completion request to OpenAI."""

    api_key = api_key or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return {"success": False, "error": "OPENAI_API_KEY not set"}

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    body = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
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

    content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    usage = result.get("usage", {})

    return {
        "success": True,
        "content": content,
        "model": model,
        "usage": usage,
    }


def main():
    parser = argparse.ArgumentParser(description="OpenAI Chat Completion")
    parser.add_argument("prompt", help="User prompt")
    parser.add_argument("-m", "--model", default="gpt-4o-mini", help="Model (gpt-4o, gpt-4o-mini)")
    parser.add_argument("-s", "--system", help="System prompt")
    parser.add_argument("-t", "--temperature", type=float, default=0.7, help="Temperature (0-2)")
    parser.add_argument("--max-tokens", type=int, default=1000, help="Max tokens")
    parser.add_argument("-k", "--api-key", help="API key (or set OPENAI_API_KEY)")
    parser.add_argument("-j", "--json", action="store_true", help="Output as JSON")

    args = parser.parse_args()

    result = chat(
        prompt=args.prompt,
        model=args.model,
        system=args.system,
        temperature=args.temperature,
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
