#!/usr/bin/env python3
"""
Replicate Prediction Script

Generic script for running any Replicate model.

Usage:
    python predict.py <version> '{"prompt": "hello"}' -o output.json
    python predict.py stability-ai/sdxl:version '{"prompt": "cat"}' --wait
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error


BASE_URL = "https://api.replicate.com/v1"
POLL_INTERVAL = 2  # seconds
MAX_WAIT = 300  # 5 minutes


def create_prediction(
    version: str,
    input_data: dict,
    api_key: str | None = None,
) -> dict:
    """Create a prediction on Replicate."""

    api_key = api_key or os.environ.get("REPLICATE_API_TOKEN")
    if not api_key:
        return {"success": False, "error": "REPLICATE_API_TOKEN not set"}

    body = {
        "version": version,
        "input": input_data,
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            f"{BASE_URL}/predictions",
            data=data,
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        return {"success": False, "error": f"API error ({e.code}): {error_body}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

    return {
        "success": True,
        "id": result.get("id"),
        "status": result.get("status"),
        "urls": result.get("urls", {}),
    }


def get_prediction(
    prediction_id: str,
    api_key: str | None = None,
) -> dict:
    """Get prediction status."""

    api_key = api_key or os.environ.get("REPLICATE_API_TOKEN")
    if not api_key:
        return {"success": False, "error": "REPLICATE_API_TOKEN not set"}

    headers = {
        "Authorization": f"Bearer {api_key}",
    }

    try:
        req = urllib.request.Request(
            f"{BASE_URL}/predictions/{prediction_id}",
            headers=headers,
        )
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
    except Exception as e:
        return {"success": False, "error": str(e)}

    return {
        "success": True,
        "id": result.get("id"),
        "status": result.get("status"),
        "output": result.get("output"),
        "error": result.get("error"),
    }


def wait_for_prediction(
    prediction_id: str,
    api_key: str | None = None,
    max_wait: int = MAX_WAIT,
) -> dict:
    """Poll until prediction completes."""

    start_time = time.time()

    while time.time() - start_time < max_wait:
        result = get_prediction(prediction_id, api_key)

        if not result["success"]:
            return result

        status = result.get("status")
        print(f"Status: {status}", file=sys.stderr)

        if status == "succeeded":
            return {
                "success": True,
                "output": result.get("output"),
                "id": prediction_id,
            }
        elif status == "failed":
            return {
                "success": False,
                "error": result.get("error", "Prediction failed"),
            }
        elif status == "canceled":
            return {"success": False, "error": "Prediction canceled"}

        time.sleep(POLL_INTERVAL)

    return {"success": False, "error": "Timeout waiting for prediction"}


def main():
    parser = argparse.ArgumentParser(description="Run Replicate prediction")
    parser.add_argument("version", help="Model version ID")
    parser.add_argument("input", help="Input JSON")
    parser.add_argument("-o", "--output", help="Save output to file")
    parser.add_argument("-w", "--wait", action="store_true", help="Wait for completion")
    parser.add_argument("-k", "--api-key", help="API key (or set REPLICATE_API_TOKEN)")

    args = parser.parse_args()

    # Parse input
    try:
        input_data = json.loads(args.input)
    except json.JSONDecodeError as e:
        print(f"Invalid input JSON: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"Creating prediction with {args.version}...", file=sys.stderr)

    result = create_prediction(
        version=args.version,
        input_data=input_data,
        api_key=args.api_key,
    )

    if not result["success"]:
        print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(1)

    prediction_id = result["id"]
    print(f"Prediction ID: {prediction_id}", file=sys.stderr)

    if args.wait:
        print("Waiting for completion...", file=sys.stderr)
        result = wait_for_prediction(prediction_id, args.api_key)

        if result["success"]:
            output = json.dumps(result["output"], indent=2)
            if args.output:
                with open(args.output, "w") as f:
                    f.write(output)
                print(f"Saved to: {args.output}", file=sys.stderr)
            else:
                print(output)
        else:
            print(f"Error: {result['error']}", file=sys.stderr)
            sys.exit(1)
    else:
        print(json.dumps(result, indent=2))
        print(f"\nCheck status: curl {result['urls'].get('get')}", file=sys.stderr)


if __name__ == "__main__":
    main()
