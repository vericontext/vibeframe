import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { execSafe, execSafeSync } from "./exec-safe.js";
import { detectImageFormat, writeImageFile } from "./image-file.js";

/** Conversion needs FFmpeg, which not every CI runner has installed. */
const hasFfmpeg = (() => {
  try {
    execSafeSync("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
})();

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

describe("writeImageFile", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "image-file-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("detects formats from file signatures", () => {
    expect(detectImageFormat(PNG_SIGNATURE)).toBe("png");
    expect(detectImageFormat(JPEG_SIGNATURE)).toBe("jpeg");
    expect(detectImageFormat(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(detectImageFormat(Buffer.from("not an image"))).toBeUndefined();
  });

  it("writes bytes unchanged when they match the extension", async () => {
    const out = join(dir, "out.jpg");
    await writeImageFile(out, JPEG_SIGNATURE);
    expect((await readFile(out)).equals(JPEG_SIGNATURE)).toBe(true);
  });

  it.skipIf(!hasFfmpeg)("converts JPEG bytes saved under a .png name", async () => {
    const source = join(dir, "source.jpg");
    await execSafe("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=red:s=16x16", "-frames:v", "1", source]);
    const out = join(dir, "out.png");
    await writeImageFile(out, await readFile(source));
    expect(detectImageFormat(await readFile(out))).toBe("png");
  });
});
