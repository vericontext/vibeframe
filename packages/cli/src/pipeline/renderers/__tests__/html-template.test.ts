import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { TimelineState } from "@vibeframe/core";
import { generateCompositionHtml } from "../html-template.js";
import { buildClipElements, buildMediaDeclarations, buildClipRuntimeData, relAsset } from "../html-clips.js";
import { aspectToResolution, qualityToCrf } from "../hyperframes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): TimelineState {
  const raw = readFileSync(resolve(__dirname, "fixtures", name), "utf-8");
  const data = JSON.parse(raw) as { version: string; state: TimelineState };
  return data.state;
}

describe("aspectToResolution", () => {
  it("maps 16:9 to 1920×1080", () => {
    expect(aspectToResolution("16:9")).toEqual({ width: 1920, height: 1080 });
  });
  it("maps 9:16 to 1080×1920", () => {
    expect(aspectToResolution("9:16")).toEqual({ width: 1080, height: 1920 });
  });
  it("maps 1:1 to 1080×1080", () => {
    expect(aspectToResolution("1:1")).toEqual({ width: 1080, height: 1080 });
  });
  it("maps 4:5 to 1080×1350", () => {
    expect(aspectToResolution("4:5")).toEqual({ width: 1080, height: 1350 });
  });
  it("falls back to 1920×1080 for unknown ratio", () => {
    expect(aspectToResolution("unknown")).toEqual({ width: 1920, height: 1080 });
  });
});

describe("qualityToCrf", () => {
  it("draft → 28", () => expect(qualityToCrf("draft")).toBe(28));
  it("standard → 23", () => expect(qualityToCrf("standard")).toBe(23));
  it("high → 18", () => expect(qualityToCrf("high")).toBe(18));
  it("default (no arg) → 23", () => expect(qualityToCrf()).toBe(23));
});

describe("relAsset", () => {
  it("strips dir and prefixes assets/", () => {
    expect(relAsset("some/path/file.jpg")).toBe("assets/file.jpg");
    expect(relAsset("file.mp4")).toBe("assets/file.mp4");
  });
});

describe("generateCompositionHtml with simple-2clip fixture", () => {
  const state = loadFixture("simple-2clip.vibe.json");

  it("fixture loads correctly", () => {
    expect(state.project.duration).toBe(6);
    expect(state.clips).toHaveLength(2);
    expect(state.sources).toHaveLength(2);
    expect(state.project.aspectRatio).toBe("16:9");
  });

  it("produces valid HTML structure", () => {
    const html = generateCompositionHtml(state);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html>");
    expect(html).toContain("</html>");
    expect(html).toContain("<body>");
  });

  it("embeds correct canvas dimensions for 16:9", () => {
    const html = generateCompositionHtml(state);
    expect(html).toContain("width: 1920px");
    expect(html).toContain("height: 1080px");
  });

  it("emits one .clip div per clip", () => {
    const html = generateCompositionHtml(state);
    const matches = html.match(/class="clip"/g);
    expect(matches).toHaveLength(2);
  });

  it("contains clip ids in DOM", () => {
    const html = generateCompositionHtml(state);
    expect(html).toContain('id="clip-1"');
    expect(html).toContain('id="clip-2"');
  });

  it("embeds window.__hf with correct duration", () => {
    const html = generateCompositionHtml(state);
    expect(html).toContain("window.__hf");
    expect(html).toContain(`duration: ${state.project.duration}`);
  });

  it("embeds clips JSON with all clip ids", () => {
    const html = generateCompositionHtml(state);
    expect(html).toContain('"clip-1"');
    expect(html).toContain('"clip-2"');
  });

  it("image clips use assets/ relative path", () => {
    const html = generateCompositionHtml(state);
    expect(html).toContain('src="assets/frame-a.jpg"');
    expect(html).toContain('src="assets/frame-b.jpg"');
  });
});

describe("buildMediaDeclarations — image-only fixture produces empty array", () => {
  it("returns no media for image-only clips", () => {
    const state = loadFixture("simple-2clip.vibe.json");
    const media = buildMediaDeclarations(state);
    expect(media).toHaveLength(0);
  });
});

describe("buildClipRuntimeData", () => {
  it("includes all clips with correct startTime and duration", () => {
    const state = loadFixture("simple-2clip.vibe.json");
    const data = buildClipRuntimeData(state);
    expect(data).toHaveLength(2);
    expect(data[0].id).toBe("clip-1");
    expect(data[0].startTime).toBe(0);
    expect(data[0].duration).toBe(3);
    expect(data[1].id).toBe("clip-2");
    expect(data[1].startTime).toBe(3);
    expect(data[1].duration).toBe(3);
  });

  it("includes effects on clip-1", () => {
    const state = loadFixture("simple-2clip.vibe.json");
    const data = buildClipRuntimeData(state);
    expect(data[0].effects).toHaveLength(1);
    expect(data[0].effects[0].type).toBe("fadeIn");
  });
});

describe("buildClipElements", () => {
  it("generates div.clip for each image source", () => {
    const state = loadFixture("simple-2clip.vibe.json");
    const markup = buildClipElements(state);
    expect(markup).toContain('id="clip-1"');
    expect(markup).toContain('id="clip-2"');
    expect(markup).toContain("<img");
  });

  it("emits <dotlottie-wc> for lottie sources", () => {
    const state: TimelineState = {
      ...loadFixture("simple-2clip.vibe.json"),
      sources: [
        { id: "source-l", name: "anim.lottie", type: "lottie", url: "/abs/anim.lottie", duration: 3 },
      ],
      clips: [
        {
          id: "clip-l",
          sourceId: "source-l",
          trackId: "track-1",
          startTime: 0,
          duration: 3,
          sourceStartOffset: 0,
          sourceEndOffset: 3,
          effects: [],
        },
      ],
    };
    const markup = buildClipElements(state);
    expect(markup).toContain("<dotlottie-wc");
    expect(markup).toContain('src="assets/anim.lottie"');
    expect(markup).toContain("autoplay");
    expect(markup).toContain("loop");
  });
});

describe("generateCompositionHtml with lottie source", () => {
  it("injects dotlottie-wc module + setWasmUrl when state has a lottie source", () => {
    const base = loadFixture("simple-2clip.vibe.json");
    const state: TimelineState = {
      ...base,
      sources: [
        { id: "source-l", name: "anim.lottie", type: "lottie", url: "/abs/anim.lottie", duration: 3 },
      ],
      clips: [],
    };
    const html = generateCompositionHtml(state);
    expect(html).toContain('/vendor/dotlottie-wc/index.js');
    expect(html).toContain('setWasmUrl("/vendor/dotlottie-player.wasm")');
  });

  it("does not inject lottie runtime when no lottie source present", () => {
    const state = loadFixture("simple-2clip.vibe.json");
    const html = generateCompositionHtml(state);
    expect(html).not.toContain('dotlottie-wc');
    expect(html).not.toContain('setWasmUrl');
  });
});
