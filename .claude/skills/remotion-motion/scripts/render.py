#!/usr/bin/env python3
"""
Remotion Render Helper

A simple wrapper to render Remotion compositions.
This script helps with common render commands.

Usage:
    python render.py MyComposition -o output.mp4
    python render.py MyComposition -o output.gif --codec gif
    python render.py MyComposition -o frame.png --still --frame 50
"""

import argparse
import subprocess
import sys


def render_video(
    composition: str,
    output: str,
    entry_point: str = "src/index.ts",
    codec: str = "h264",
    crf: int = 18,
    fps: int | None = None,
    still: bool = False,
    frame: int = 0,
) -> dict:
    """Render Remotion composition."""

    if still:
        cmd = [
            "npx", "remotion", "still",
            entry_point,
            composition,
            output,
            "--frame", str(frame),
        ]
    else:
        cmd = [
            "npx", "remotion", "render",
            entry_point,
            composition,
            output,
            "--codec", codec,
            "--crf", str(crf),
        ]
        if fps:
            cmd.extend(["--fps", str(fps)])

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,  # 10 min timeout
        )

        if result.returncode == 0:
            return {
                "success": True,
                "output": output,
                "command": " ".join(cmd),
            }
        else:
            return {
                "success": False,
                "error": result.stderr or result.stdout,
                "command": " ".join(cmd),
            }
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Render timeout (10 min)"}
    except FileNotFoundError:
        return {"success": False, "error": "npx not found. Is Node.js installed?"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def main():
    parser = argparse.ArgumentParser(description="Render Remotion composition")
    parser.add_argument("composition", help="Composition ID to render")
    parser.add_argument("-o", "--output", required=True, help="Output file path")
    parser.add_argument("-e", "--entry", default="src/index.ts", help="Entry point")
    parser.add_argument("-c", "--codec", default="h264",
                        choices=["h264", "h265", "vp8", "vp9", "gif", "prores"],
                        help="Video codec")
    parser.add_argument("--crf", type=int, default=18, help="Quality (0-51, lower=better)")
    parser.add_argument("--fps", type=int, help="Frame rate override")
    parser.add_argument("--still", action="store_true", help="Render single frame")
    parser.add_argument("--frame", type=int, default=0, help="Frame number (for --still)")

    args = parser.parse_args()

    if args.still:
        print(f"Rendering frame {args.frame} of {args.composition}...")
    else:
        print(f"Rendering {args.composition} to {args.output}...")

    result = render_video(
        composition=args.composition,
        output=args.output,
        entry_point=args.entry,
        codec=args.codec,
        crf=args.crf,
        fps=args.fps,
        still=args.still,
        frame=args.frame,
    )

    if result["success"]:
        print(f"Rendered to: {result['output']}")
    else:
        print(f"Error: {result['error']}", file=sys.stderr)
        print(f"Command: {result.get('command', 'N/A')}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
