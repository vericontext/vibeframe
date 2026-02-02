#!/usr/bin/env python3
"""
Motion Graphics Code Generator using Claude

Usage:
    python motion.py "animated subscribe button" -o SubscribeButton.tsx
    python motion.py "lower third with name and title" -o LowerThird.tsx
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error


SYSTEM_PROMPT = """You are a Remotion motion graphics expert. Generate React/TypeScript code for animated video components.

Requirements:
1. Use @remotion/core imports (useCurrentFrame, useVideoConfig, interpolate, spring, etc.)
2. Use TypeScript with proper types
3. Include all necessary imports
4. Make animations smooth and professional
5. Use spring() for bouncy animations, interpolate() for linear
6. Export the component as default

Example structure:
```tsx
import { useCurrentFrame, useVideoConfig, interpolate, spring, AbsoluteFill } from "remotion";

interface Props {
  // component props
}

export const ComponentName: React.FC<Props> = ({ prop1 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // animations
  const opacity = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill>
      {/* content */}
    </AbsoluteFill>
  );
};

export default ComponentName;
```

Output ONLY the code, no explanations or markdown code blocks."""


def generate_motion(
    description: str,
    model: str = "claude-sonnet-4-20250514",
    api_key: str | None = None,
) -> dict:
    """Generate motion graphics code using Claude."""

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
    code = ""
    for block in content_blocks:
        if block.get("type") == "text":
            code += block.get("text", "")

    # Clean up code (remove markdown if present)
    code = code.strip()
    if code.startswith("```"):
        lines = code.split("\n")
        code = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])

    return {
        "success": True,
        "code": code,
        "description": description,
    }


def main():
    parser = argparse.ArgumentParser(description="Generate Remotion motion graphics")
    parser.add_argument("description", help="Description of the animation")
    parser.add_argument("-o", "--output", help="Output .tsx file")
    parser.add_argument("-m", "--model", default="claude-sonnet-4-20250514", help="Model")
    parser.add_argument("-k", "--api-key", help="API key (or set ANTHROPIC_API_KEY)")

    args = parser.parse_args()

    print(f"Generating: {args.description}", file=sys.stderr)

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
        else:
            print(result["code"])
    else:
        print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
