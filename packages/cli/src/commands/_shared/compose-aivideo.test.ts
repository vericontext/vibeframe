import { describe, expect, it } from "vitest";
import {
  beatOverlayText,
  buildBgConcatArgs,
  emitOverlayScene,
  extractDesignTokens,
  injectBgVideo,
  DEFAULT_AIVIDEO_TOKENS,
} from "./compose-aivideo.js";
import type { Beat } from "./storyboard-parse.js";

const beat = (id: string, heading: string, cues: Record<string, unknown> = {}): Beat => ({
  id,
  heading,
  body: "",
  cues: cues as Beat["cues"],
});

describe("beatOverlayText", () => {
  it("derives title from the heading descriptor and kicker from the id", () => {
    const t = beatOverlayText(beat("camp", "Beat camp — First Light"));
    expect(t.title).toBe("First Light");
    expect(t.kicker).toBe("Camp");
    expect(t.sub).toBe("");
  });

  it("honors explicit title/eyebrow/caption cues", () => {
    const t = beatOverlayText(
      beat("camp", "Beat camp — First Light", {
        title: "Base Camp",
        eyebrow: "First Light",
        caption: "Before the world wakes.",
      })
    );
    expect(t).toEqual({ kicker: "First Light", title: "Base Camp", sub: "Before the world wakes." });
  });

  it("falls back to a humanised id when there is no descriptor", () => {
    const t = beatOverlayText(beat("the-summit", "the-summit"));
    expect(t.title).toBe("The Summit");
    expect(t.kicker).toBe("");
  });
});

describe("buildBgConcatArgs", () => {
  it("builds a scale+crop+concat filter graph with no audio", () => {
    const args = buildBgConcatArgs(["a.mp4", "b.mp4"], "out.mp4");
    expect(args[0]).toBe("-y");
    expect(args).toContain("-i");
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("concat=n=2:v=1:a=0[v]");
    expect(fc).toContain("[0:v]scale=1920:1080");
    expect(args).toContain("[v]"); // -map [v]
    expect(args[args.length - 1]).toBe("out.mp4");
  });
});

describe("emitOverlayScene", () => {
  const text = { kicker: "First Light", title: "Base Camp", sub: "Before the world wakes." };

  it("emits a transparent overlay (no baked video backdrop)", () => {
    const html = emitOverlayScene({ id: "camp", text, duration: 6 });
    expect(html).toContain("background: transparent");
    expect(html).not.toContain("<video"); // the bg video lives at the root, not per-scene
    expect(html).toContain('window.__timelines["camp"]');
    expect(html).toContain("Base Camp");
    expect(html).toContain("First Light");
    expect(html).toContain('data-duration="6"');
  });

  it("emits a syntactically valid inline GSAP script (selectors single-quoted)", () => {
    // Guards the double-quote-in-double-quote bug: a `[data-composition-id="x"]`
    // selector inside a double-quoted JS string breaks the inline script.
    const html = emitOverlayScene({ id: "camp", text, duration: 6, isLast: true });
    const inline =
      [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes("__timelines")) ?? "";
    expect(inline.length).toBeGreaterThan(0);
    expect(() => new Function("gsap", "window", inline)).not.toThrow();
  });

  it("adds a fade-out only on the last scene", () => {
    expect(emitOverlayScene({ id: "x", text, duration: 6, isLast: true })).toContain(".fadeout");
    expect(emitOverlayScene({ id: "x", text, duration: 6, isLast: false })).not.toContain(".fadeout");
  });

  it("omits the eyebrow/sub markup when empty", () => {
    const html = emitOverlayScene({ id: "x", text: { kicker: "", title: "Only Title", sub: "" }, duration: 5 });
    expect(html).toContain("Only Title");
    expect(html).not.toContain("class=\"kicker\"");
    expect(html).not.toContain("class=\"sub\"");
  });
});

describe("injectBgVideo", () => {
  const shell = (body = "") =>
    `<head><style>html{}</style></head><body>\n` +
    `<div id="root" data-composition-id="main" data-start="0" data-duration="24">${body}</div>\n</body>`;

  it("inserts one bg video + cover/z-index CSS", () => {
    const out = injectBgVideo(shell(), "assets/bg-full.mp4", 24);
    expect((out.match(/id="bg-video"/g) ?? []).length).toBe(1);
    expect(out).toContain("/* aivideo-bg */");
    expect(out).toContain("object-fit: cover");
    expect(out).toContain('data-duration="24"');
  });

  it("is idempotent — never doubles the bg video or CSS", () => {
    const once = injectBgVideo(shell(), "assets/bg-full.mp4", 24);
    const twice = injectBgVideo(once, "assets/bg-full.mp4", 24);
    expect((twice.match(/id="bg-video"/g) ?? []).length).toBe(1);
    expect((twice.match(/aivideo-bg/g) ?? []).length).toBe(1);
  });

  it("updates src/duration of an existing bg video", () => {
    const once = injectBgVideo(shell(), "assets/old.mp4", 12);
    const updated = injectBgVideo(once, "assets/bg-full.mp4", 30);
    expect((updated.match(/id="bg-video"/g) ?? []).length).toBe(1);
    expect(updated).toContain("assets/bg-full.mp4");
    expect(updated).toContain('data-duration="30"');
    expect(updated).not.toContain("assets/old.mp4");
  });
});

describe("extractDesignTokens", () => {
  it("maps darkest→ground, lightest→primary, most-saturated→accent", () => {
    const md = "## Palette\n- `#EAF2F7` primary\n- `#0E1A24` ground\n- `#E2683C` accent\n";
    const t = extractDesignTokens(md);
    expect(t.ground).toBe("#0E1A24");
    expect(t.primary).toBe("#EAF2F7");
    expect(t.accent).toBe("#E2683C");
  });

  it("falls back to defaults when fewer than 3 hexes are present", () => {
    expect(extractDesignTokens("no colors here")).toEqual(DEFAULT_AIVIDEO_TOKENS);
  });
});
