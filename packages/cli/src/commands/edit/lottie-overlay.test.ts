import { describe, expect, it } from "vitest";
import { lottieLayerHtml } from "./lottie-overlay.js";

describe("lottieLayerHtml", () => {
  const html = lottieLayerHtml({
    width: 640,
    height: 360,
    duration: 2.5,
    assetUrl: "./assets/animation.json",
    box: { left: 10, top: 20, width: 300, height: 150 },
    opacity: 0.4,
    loop: false,
  });

  it("draws on a transparent page at the layer size", () => {
    expect(html).toContain("width: 640px; height: 360px");
    expect(html).toContain("background: transparent");
    expect(html).toContain('<canvas id="lottie" width="300" height="150">');
    expect(html).toContain("left: 10px; top: 20px; width: 300px; height: 150px; opacity: 0.4");
  });

  it("drives the player from seek instead of autoplay", () => {
    expect(html).toContain("autoplay: false");
    expect(html).toContain("player.setFrame(");
    expect(html).toContain("const LOOP = false");
    expect(html).toContain("const DURATION = 2.5");
    expect(html).not.toMatch(/<dotlottie-wc|autoplay:\s*true/);
  });

  it("publishes window.__hf only once the animation has loaded", () => {
    const load = html.indexOf('addEventListener("load"');
    expect(load).toBeGreaterThan(0);
    expect(html.indexOf("window.__hf =")).toBeGreaterThan(load);
  });
});
