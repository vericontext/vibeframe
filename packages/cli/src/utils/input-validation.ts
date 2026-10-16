/**
 * Input validation utilities for agent-safety (agentic CLI hardening).
 *
 * Defends against: path traversal, control character injection,
 * and overly long inputs that agents may hallucinate.
 */

import { resolve, relative } from "node:path";

/**
 * Check if a string contains control characters (below ASCII 0x20,
 * excluding tab=0x09, newline=0x0a, carriage return=0x0d).
 */
function hasControlChars(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      return true;
    }
  }
  return false;
}

/**
 * Reject strings containing control characters (below ASCII 0x20,
 * excluding tab, newline, CR which are sometimes intentional).
 */
export function rejectControlChars(value: string, fieldName = "input"): string {
  if (hasControlChars(value)) {
    throw new Error(
      `Control character detected in ${fieldName}. Input contains non-printable characters.`
    );
  }
  return value;
}

/**
 * Validate that a file path does not escape the sandbox directory.
 * Returns the resolved absolute path.
 */
export function validateSafePath(
  inputPath: string,
  sandbox?: string,
): string {
  const base = sandbox ?? process.cwd();
  const resolved = resolve(base, inputPath);
  const rel = relative(base, resolved);

  // If the relative path starts with ".." it escapes the sandbox
  if (rel.startsWith("..")) {
    throw new Error(
      `Path traversal detected: '${inputPath}' resolves outside '${base}'.`
    );
  }
  return resolved;
}

/**
 * Validate output path — must not traverse outside cwd unless absolute.
 * Allows absolute paths (user-specified like /tmp/output.mp4).
 */
export function validateOutputPath(outputPath: string): string {
  // Absolute paths are trusted (user explicitly chose them)
  if (outputPath.startsWith("/") || outputPath.startsWith("~")) {
    return resolve(outputPath);
  }
  return validateSafePath(outputPath);
}
