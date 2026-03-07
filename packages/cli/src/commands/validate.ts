/**
 * @module validate
 * @description Input validation layer for CLI commands.
 * Guards against path traversal, control characters, and invalid resource IDs.
 */

import { resolve, relative, isAbsolute } from "node:path";

/**
 * Validate and resolve an output path, ensuring it stays within the working directory.
 * Prevents path traversal attacks (e.g., --output ../../etc/passwd).
 */
export function validateOutputPath(path: string, cwd = process.cwd()): string {
  rejectControlChars(path);
  const resolved = resolve(cwd, path);
  const rel = relative(cwd, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
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
    throw new Error(
      `Invalid resource ID "${id}". Only alphanumeric characters, hyphens, and underscores are allowed.`
    );
  }
  if (id.length > 128) {
    throw new Error(`Resource ID too long (max 128 characters).`);
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
    throw new Error("Input contains invalid control characters.");
  }
  return input;
}

/**
 * Validate a media file path and check its extension against an allowlist.
 */
export function validateMediaFile(
  path: string,
  allowedExts: string[]
): string {
  rejectControlChars(path);
  const ext = path.toLowerCase().split(".").pop();
  if (!ext || !allowedExts.includes(`.${ext}`)) {
    throw new Error(
      `Unsupported file type ".${ext}". Allowed: ${allowedExts.join(", ")}`
    );
  }
  return path;
}

/** Common media file extensions */
export const MEDIA_EXTS = {
  video: [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".flv"],
  audio: [".mp3", ".wav", ".aac", ".ogg", ".m4a", ".flac", ".wma"],
  image: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".svg"],
  subtitle: [".srt", ".vtt", ".ass", ".ssa"],
};
