/**
 * Write audio to the path a caller asked for, converting when the path's
 * extension does not match the bytes' container (Kokoro speaks WAV; a user
 * may ask for `narration.mp3`).
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, extname } from "node:path";
import { execSafe } from "./exec-safe.js";

const CONVERTIBLE = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);

/** Save `bytes` (in `container`, e.g. "mp3") to `path`, transcoding with ffmpeg if the extension differs. */
export async function writeAudioFile(path: string, bytes: Uint8Array, container: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const wanted = extname(path).toLowerCase();
  if (!CONVERTIBLE.has(wanted) || wanted === `.${container}`) {
    await writeFile(path, bytes);
    return;
  }
  const source = `${path}.source.${container}`;
  await writeFile(source, bytes);
  try {
    await execSafe("ffmpeg", ["-y", "-loglevel", "error", "-i", source, path]);
  } finally {
    await rm(source, { force: true });
  }
}
