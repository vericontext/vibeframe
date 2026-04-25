import { describe, expect, it } from "vitest";
import {
  buildClipReference,
  emitSceneHtml,
  insertClipIntoRoot,
  nextSceneStart,
  readRootDims,
  slugifySceneName,
  SCENE_PRESETS,
  type ScenePreset,
} from "./scene-html-emit.js";
import { buildEmptyRootHtml } from "./scene-project.js";

// ── slugifySceneName ────────────────────────────────────────────────────────

describe("slugifySceneName", () => {
  it.each([
    ["intro",          "intro"],
    ["My Intro",       "my-intro"],
    ["Product Shot!",  "product-shot"],
    ["scene  3 hello", "scene-3-hello"],
    ["__weird__name", "weird-name"],
    ["",              "scene"],
    ["!!!",           "scene"],
  ])("%j → %j", (input, expected) => {
    expect(slugifySceneName(input)).toBe(expected);
  });
});

// ── nextSceneStart ──────────────────────────────────────────────────────────

describe("nextSceneStart", () => {
  it("returns 0 for an empty root", () => {
    const root = buildEmptyRootHtml({ aspect: "16:9", duration: 10 });
    expect(nextSceneStart(root)).toBe(0);
  });

  it("returns the max end-time of existing clips", () => {
    const root = `
      <div class="clip" data-composition-src="a.html" data-start="0" data-duration="3" data-track-index="1"></div>
      <div class="clip" data-composition-src="b.html" data-start="3" data-duration="2.5" data-track-index="1"></div>
    `;
    expect(nextSceneStart(root)).toBeCloseTo(5.5, 5);
  });

  it("ignores clips with malformed data-start", () => {
    const root = `<div class="clip" data-composition-src="x.html" data-start="oops" data-duration="2" data-track-index="1"></div>`;
    expect(nextSceneStart(root)).toBe(0);
  });
});

// ── buildClipReference ──────────────────────────────────────────────────────

describe("buildClipReference", () => {
  it("builds a Hyperframes-compatible clip div with data-composition-id", () => {
    const out = buildClipReference({ id: "intro", start: 0, duration: 4 });
    expect(out).toContain('class="clip"');
    expect(out).toContain('data-composition-id="intro"');
    expect(out).toContain('data-composition-src="compositions/scene-intro.html"');
    expect(out).toContain('data-start="0"');
    expect(out).toContain('data-duration="4"');
    expect(out).toContain('data-track-index="1"');
  });

  it("respects an explicit track and src override and still emits data-composition-id", () => {
    const out = buildClipReference({ id: "x", start: 1.234, duration: 2.345, trackIndex: 3, src: "custom/path.html" });
    expect(out).toContain('data-composition-id="x"');
    expect(out).toContain('data-composition-src="custom/path.html"');
    expect(out).toContain('data-track-index="3"');
    expect(out).toContain('data-start="1.234"');
    expect(out).toContain('data-duration="2.345"');
  });
});

// ── insertClipIntoRoot ──────────────────────────────────────────────────────

describe("insertClipIntoRoot", () => {
  it("inserts a clip before the root closing div", () => {
    const root = buildEmptyRootHtml({ aspect: "16:9", duration: 10 });
    const updated = insertClipIntoRoot(root, { id: "intro", start: 0, duration: 4 });
    expect(updated).toContain('<div class="clip" data-composition-id="intro" data-composition-src="compositions/scene-intro.html"');
    // The new clip must appear *before* the root's closing </div>
    const clipIdx = updated.indexOf("compositions/scene-intro.html");
    const rootCloseIdx = updated.lastIndexOf("</div>\n\n    <script>");
    expect(clipIdx).toBeGreaterThan(0);
    expect(rootCloseIdx).toBeGreaterThan(clipIdx);
  });

  it("grows root data-duration when clip end exceeds it but never shrinks", () => {
    const root = buildEmptyRootHtml({ aspect: "16:9", duration: 10 });
    const grown = insertClipIntoRoot(root, { id: "long", start: 0, duration: 14 });
    expect(grown).toContain('data-duration="14"');

    const stillShort = insertClipIntoRoot(root, { id: "short", start: 0, duration: 4 });
    expect(stillShort).toContain('data-duration="10"');
  });

  it("appends sequentially and tracks the new start via nextSceneStart", () => {
    let root = buildEmptyRootHtml({ aspect: "16:9", duration: 0 });

    root = insertClipIntoRoot(root, { id: "a", start: 0, duration: 3 });
    expect(nextSceneStart(root)).toBe(3);

    root = insertClipIntoRoot(root, { id: "b", start: 3, duration: 2 });
    expect(nextSceneStart(root)).toBe(5);

    expect(root).toContain('data-composition-src="compositions/scene-a.html"');
    expect(root).toContain('data-composition-src="compositions/scene-b.html"');
  });

  it("throws on a root that lacks the expected closing tag", () => {
    const broken = "<html><body>no root</body></html>";
    expect(() => insertClipIntoRoot(broken, { id: "x", start: 0, duration: 1 })).toThrow(/closing/);
  });
});

// ── readRootDims ────────────────────────────────────────────────────────────

describe("readRootDims", () => {
  it("reads dims from the standard scaffold", () => {
    const root = buildEmptyRootHtml({ aspect: "9:16", duration: 8 });
    expect(readRootDims(root)).toEqual({ width: 1080, height: 1920 });
  });

  it("returns null when dims are missing", () => {
    expect(readRootDims('<div id="root"></div>')).toBeNull();
  });
});

// ── emitSceneHtml — shared invariants ───────────────────────────────────────

const baseInput = {
  id: "intro",
  width: 1920,
  height: 1080,
  duration: 4,
  headline: "Welcome to VibeFrame",
};

describe.each(SCENE_PRESETS)("emitSceneHtml(%s)", (preset: ScenePreset) => {
  it("emits a Hyperframes-compatible composition", () => {
    const html = emitSceneHtml({ ...baseInput, preset });
    expect(html).toContain('<template id="scene-intro-template">');
    expect(html).toContain('data-composition-id="intro"');
    expect(html).toContain('data-start="0"');
    expect(html).toContain('data-duration="4"');
    expect(html).toContain('data-width="1920"');
    expect(html).toContain('data-height="1080"');
  });

  it("registers a paused timeline keyed by the scene id", () => {
    const html = emitSceneHtml({ ...baseInput, preset });
    expect(html).toContain("gsap.timeline({ paused: true })");
    expect(html).toContain('window.__timelines["intro"] = tl');
  });

  it("includes the audio element only when audioPath is given", () => {
    const without = emitSceneHtml({ ...baseInput, preset });
    expect(without).not.toContain("<audio");

    const withAudio = emitSceneHtml({ ...baseInput, preset, audioPath: "assets/narration-intro.mp3" });
    expect(withAudio).toContain('<audio');
    expect(withAudio).toContain('src="assets/narration-intro.mp3"');
    expect(withAudio).toContain('data-track-index="2"');
  });

  it("includes the backdrop image only when imagePath is given", () => {
    const without = emitSceneHtml({ ...baseInput, preset });
    expect(without).not.toContain("background-image: url(");

    const withImage = emitSceneHtml({ ...baseInput, preset, imagePath: "assets/scene-intro.png" });
    expect(withImage).toContain('background-image: url("assets/scene-intro.png")');
  });
});

// ── emitSceneHtml — preset specifics ────────────────────────────────────────

describe("emitSceneHtml — preset specifics", () => {
  it("simple: shows narration as the caption", () => {
    const html = emitSceneHtml({ ...baseInput, preset: "simple", subhead: "Hello world" });
    expect(html).toContain("Hello world");
    expect(html).toContain('id="caption"');
  });

  it("announcement: renders headline as the centered h1", () => {
    const html = emitSceneHtml({ ...baseInput, preset: "announcement" });
    expect(html).toMatch(/<h1[^>]*id="headline">\s*Welcome to VibeFrame\s*<\/h1>/);
  });

  it("explainer: renders kicker + title and includes subtitle when subhead is set", () => {
    const html = emitSceneHtml({
      ...baseInput,
      preset: "explainer",
      kicker: "Episode 1",
      subhead: "Authoring videos with code",
    });
    expect(html).toContain('id="kicker"');
    expect(html).toContain("Episode 1");
    expect(html).toContain('id="subtitle"');
    expect(html).toContain("Authoring videos with code");
  });

  it("explainer: omits the subtitle div when no subhead is provided", () => {
    const html = emitSceneHtml({ ...baseInput, preset: "explainer" });
    expect(html).not.toContain('id="subtitle"');
  });

  it("kinetic-type: emits one span per word", () => {
    const html = emitSceneHtml({ ...baseInput, preset: "kinetic-type" });
    // baseInput.headline = "Welcome to VibeFrame" → 3 words
    expect(html).toContain('id="w-0"');
    expect(html).toContain('id="w-1"');
    expect(html).toContain('id="w-2"');
    expect(html).not.toContain('id="w-3"');
  });

  it("product-shot: applies a Ken-Burns scale tween over the full duration", () => {
    const html = emitSceneHtml({ ...baseInput, preset: "product-shot", duration: 6 });
    expect(html).toContain("scale: 1.08, duration: 6.00");
  });

  it("escapes HTML metacharacters in headline + subhead", () => {
    const html = emitSceneHtml({
      id: "x",
      preset: "simple",
      width: 1920,
      height: 1080,
      duration: 3,
      subhead: '<script>alert("xss")</script>',
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
  });

  it("rejects non-positive durations", () => {
    expect(() => emitSceneHtml({ ...baseInput, preset: "simple", duration: 0 })).toThrow(/duration/);
    expect(() => emitSceneHtml({ ...baseInput, preset: "simple", duration: -1 })).toThrow(/duration/);
  });

  it("falls back to humanised id when no headline is provided", () => {
    const html = emitSceneHtml({
      id: "product-shot",
      preset: "announcement",
      width: 1920,
      height: 1080,
      duration: 4,
    });
    expect(html).toContain("Product Shot");
  });
});
