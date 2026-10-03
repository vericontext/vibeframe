import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { execSafe } from "./exec-safe.js";
import { detectImageFormat, writeImageFile } from "./image-file.js";

describe("writeImageFile", () => {
  let dir: string;
  let jpeg: Buffer;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "image-file-"));
    const source = join(dir, "source.jpg");
    await execSafe("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=red:s=16x16", "-frames:v", "1", source]);
    jpeg = await readFile(source);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("detects formats from file signatures", () => {
    expect(detectImageFormat(jpeg)).toBe("jpeg");
    expect(detectImageFormat(Buffer.from("not an image"))).toBeUndefined();
  });

  it("converts JPEG bytes saved under a .png name", async () => {
    const out = join(dir, "out.png");
    await writeImageFile(out, jpeg);
    expect(detectImageFormat(await readFile(out))).toBe("png");
  });

  it("writes matching bytes unchanged", async () => {
    const out = join(dir, "out.jpg");
    await writeImageFile(out, jpeg);
    expect((await readFile(out)).equals(jpeg)).toBe(true);
  });
});
