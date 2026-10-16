import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkLottieAsset, overlayBox } from "./lottie.js";

const layer = { width: 1000, height: 500 };

describe("overlayBox", () => {
  it("covers the whole layer for full", () => {
    expect(overlayBox(layer, "full", 0.3)).toEqual({ left: 0, top: 0, width: 1000, height: 500 });
  });

  it("centres a scaled box", () => {
    expect(overlayBox(layer, "center", 0.5)).toEqual({ left: 250, top: 125, width: 500, height: 250 });
  });

  it("insets corner boxes by 4% of each side", () => {
    expect(overlayBox(layer, "top-left", 0.2)).toEqual({ left: 40, top: 20, width: 200, height: 100 });
    expect(overlayBox(layer, "bottom-right", 0.2)).toEqual({ left: 760, top: 380, width: 200, height: 100 });
    expect(overlayBox(layer, "top-right", 0.2)).toMatchObject({ left: 760, top: 20 });
    expect(overlayBox(layer, "bottom-left", 0.2)).toMatchObject({ left: 40, top: 380 });
  });
});

describe("checkLottieAsset", () => {
  const dir = mkdtempSync(join(tmpdir(), "lottie-asset-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("accepts Lottie JSON and .lottie archives", async () => {
    const json = join(dir, "a.json");
    writeFileSync(json, JSON.stringify({ v: "5.7.0", layers: [] }));
    const zip = join(dir, "a.lottie");
    writeFileSync(zip, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]));
    expect(await checkLottieAsset(json)).toBeUndefined();
    expect(await checkLottieAsset(zip)).toBeUndefined();
  });

  it("rejects files that are neither", async () => {
    const bad = join(dir, "b.lottie");
    writeFileSync(bad, "dummy lottie");
    const notLottie = join(dir, "c.json");
    writeFileSync(notLottie, JSON.stringify({ hello: "world" }));
    expect(await checkLottieAsset(bad)).toMatch(/not a Lottie animation/);
    expect(await checkLottieAsset(notLottie)).toMatch(/not a Lottie animation/);
  });
});
