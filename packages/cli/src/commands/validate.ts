/**
 * @module validate
 * @description Input validation layer for CLI commands.
 * Guards against path traversal, control characters, and invalid resource IDs.
 */

import { resolve, relative, isAbsolute } from "node:path";

/**
 * Bad user input caught by a validator (a path outside the working
 * directory, a malformed ID, control characters). `failureFromError` maps it
 * to a usage error (exit 2), so a command's catch-all never reports it as a
 * retryable provider failure.
 */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

/**
 * Validate and resolve an output path.
 * Prevents path traversal attacks (e.g., --output ../../etc/passwd).
 * Absolute paths are allowed (explicit user intent), but relative paths
 * containing ".." that escape the working directory are blocked.
 */
export function validateOutputPath(path: string, cwd = process.cwd()): string {
  rejectControlChars(path);
  // Absolute paths are explicit user intent — allow them
  if (isAbsolute(path)) {
    return resolve(path);
  }
  // Relative paths must stay within cwd
  const resolved = resolve(cwd, path);
  const rel = relative(cwd, resolved);
  if (rel.startsWith("..")) {
    throw new InputError(
      `Output path "${path}" escapes the working directory. Use a path within "${cwd}".`
    );
  }
  return resolved;
}

/**
 * Validate a resource ID (source-*, clip-*, track-*, effect-*).
 * Only allows alphanumeric characters, hyphens, and underscores.
 */
export function validateResourceId(id: string): string {
  rejectControlChars(id);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new InputError(
      `Invalid resource ID "${id}". Only alphanumeric characters, hyphens, and underscores are allowed.`
    );
  }
  if (id.length > 128) {
    throw new InputError(`Resource ID too long (max 128 characters).`);
  }
  return id;
}

/**
 * Reject strings containing control characters (U+0000–U+001F, U+007F–U+009F).
 * Prevents terminal injection and other control-char exploits.
 */
export function rejectControlChars(input: string): string {
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f-\x9f]/.test(input)) {
    throw new InputError("Input contains invalid control characters.");
  }
  return input;
}
