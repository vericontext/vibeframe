/**
 * Write generated image bytes to the path the user or project asked for.
 *
 * Providers do not always return the format the file name implies: newer
 * Gemini image models answer with JPEG even when the caller saves to
 * `.png`. Writing those bytes as-is leaves a JPEG behind a `.png` name,
 * which upload hosts and downstream tools then mislabel. This helper
 * converts with FFmpeg (a required VibeFrame dependency) when the bytes
 * and the extension disagree.
 */

import { rm, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { execSafe } from "./exec-safe.js";

export type ImageFormat = "png" | "jpeg" | "webp";

const EXTENSION_FORMATS: Record<string, ImageFormat> = {
  ".png": "png",
  ".jpg": "jpeg",
  ".jpeg": "jpeg",
  ".webp": "webp",
};

/** Detect PNG, JPEG, or WebP from the file signature. */
export function detectImageFormat(buffer: Buffer): ImageFormat | undefined {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "webp";
  }
  return undefined;
}

/**
 * Write `buffer` to `path`, converting it first when its format does not
 * match the path's extension. Unknown formats or extensions are written
 * unchanged.
 */
export async function writeImageFile(path: string, buffer: Buffer): Promise<void> {
  const wanted = EXTENSION_FORMATS[extname(path).toLowerCase()];
  const actual = detectImageFormat(buffer);
  if (!wanted || !actual || wanted === actual) {
    await writeFile(path, buffer);
    return;
  }

  const source = `${path}.source.${actual === "jpeg" ? "jpg" : actual}`;
  await writeFile(source, buffer);
  try {
    await execSafe("ffmpeg", ["-y", "-loglevel", "error", "-i", source, "-frames:v", "1", path]);
  } finally {
    await rm(source, { force: true });
  }
}
