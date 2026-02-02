#!/usr/bin/env python3
"""
Remotion Component Generator

This script uses Claude to generate Remotion components.
It's a wrapper that calls the claude-api/scripts/motion.py script.

Usage:
    python generate.py "lower third" -o LowerThird.tsx
    python generate.py "animated title sequence" -o Title.tsx
"""

import argparse
import os
import sys

# Add parent skills directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "claude-api", "scripts"))

try:
    from motion import generate_motion
except ImportError:
    # Fallback implementation
    import json
    import urllib.request
    import urllib.error

    SYSTEM_PROMPT = """You are a Remotion motion graphics expert. Generate React/TypeScript code for animated video components.
Use @remotion/core imports. Output ONLY the code, no markdown."""

    def generate_motion(description: str, model: str = "claude-sonnet-4-20250514", api_key: str | None = None) -> dict:
        api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            return {"success": False, "error": "ANTHROPIC_API_KEY not set"}

        body = {
            "model": model,
            "max_tokens": 4096,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": f"Create a Remotion component for: {description}"}],
        }

        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }

        try:
            data = json.dumps(body).encode("utf-8")
            req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=data, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=120) as response:
                result = json.loads(response.read().decode("utf-8"))
        except Exception as e:
            return {"success": False, "error": str(e)}

        code = ""
        for block in result.get("content", []):
            if block.get("type") == "text":
                code += block.get("text", "")

        code = code.strip()
        if code.startswith("```"):
            lines = code.split("\n")
            code = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])

        return {"success": True, "code": code, "description": description}


def main():
    parser = argparse.ArgumentParser(description="Generate Remotion component")
    parser.add_argument("description", help="Animation description")
    parser.add_argument("-o", "--output", help="Output .tsx file")
    parser.add_argument("-m", "--model", default="claude-sonnet-4-20250514", help="Claude model")
    parser.add_argument("-k", "--api-key", help="API key (or set ANTHROPIC_API_KEY)")

    args = parser.parse_args()

    print(f"Generating Remotion component: {args.description}", file=sys.stderr)

    result = generate_motion(
        description=args.description,
        model=args.model,
        api_key=args.api_key,
    )

    if result["success"]:
        if args.output:
            with open(args.output, "w") as f:
                f.write(result["code"])
            print(f"Saved to: {args.output}", file=sys.stderr)
            print(f"\nTo use this component:", file=sys.stderr)
            print(f"  1. Add to your Remotion project", file=sys.stderr)
            print(f"  2. Import in Root.tsx", file=sys.stderr)
            print(f"  3. npx remotion studio", file=sys.stderr)
        else:
            print(result["code"])
    else:
        print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
