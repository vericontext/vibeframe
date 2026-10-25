import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultOutputPath, numberedPath } from "./default-output.js";

const makeTmp = () => mkdtempSync(join(tmpdir(), "vibe-default-output-"));

describe("defaultOutputPath", () => {
  it("uses the plain name when nothing is there", () => {
    expect(defaultOutputPath("image.png", 1, makeTmp())).toBe("image.png");
  });

  it("never picks a path that already exists", () => {
    const cwd = makeTmp();
    writeFileSync(join(cwd, "image.png"), "");
    writeFileSync(join(cwd, "image-2.png"), "");
    expect(defaultOutputPath("image.png", 1, cwd)).toBe("image-3.png");
  });

  it("keeps a multi-image run's numbered siblings clear too", () => {
    const cwd = makeTmp();
    writeFileSync(join(cwd, "image-2.png"), "");
    // image.png is free, but a 2-image run would also write image-2.png.
    expect(defaultOutputPath("image.png", 2, cwd)).toBe("image-3.png");
  });
});

describe("numberedPath", () => {
  it("numbers before the extension, or at the end without one", () => {
    expect(numberedPath("out/thumb.png", 2)).toBe("out/thumb-2.png");
    expect(numberedPath("out.d/thumb", 3)).toBe("out.d/thumb-3");
  });
});
