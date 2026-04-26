import { describe, expect, it } from "vitest";
import {
  buildClipReference,
  buildTranscriptTweens,
  emitSceneHtml,
  insertClipIntoRoot,
  nextSceneStart,
  readRootDims,
  renderTranscriptSpans,
  slugifySceneName,
  SCENE_PRESETS,
  type SceneTranscriptWord,
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
    // product-shot uses a more dramatic 1.12 endpoint (other presets use
    // the global default 1.08 emitted by kenBurnsTween()).
    expect(html).toContain("scale: 1.12, duration: 6.00");
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

// ── word-sync helpers ───────────────────────────────────────────────────────

describe("renderTranscriptSpans", () => {
  it("emits one span per word with sequential data-i indices", () => {
    const out = renderTranscriptSpans([
      { text: "Hello", start: 0, end: 0.5 },
      { text: "world.", start: 0.6, end: 1.0 },
    ]);
    expect(out).toBe(
      `<span class="word" data-i="0">Hello</span> <span class="word" data-i="1">world.</span>`,
    );
  });

  it("escapes HTML metacharacters inside words", () => {
    const out = renderTranscriptSpans([{ text: '"<x>&', start: 0, end: 0.5 }]);
    expect(out).toContain("&quot;&lt;x&gt;&amp;");
  });

  it("returns empty string for an empty transcript", () => {
    expect(renderTranscriptSpans([])).toBe("");
  });
});

describe("buildTranscriptTweens", () => {
  const words: SceneTranscriptWord[] = [
    { text: "Hello", start: 0, end: 0.5 },
    { text: "world.", start: 0.6, end: 1.0 },
  ];

  it("emits one absolute-timed fromTo per word", () => {
    const tweens = buildTranscriptTweens(words, "[data-composition-id=\"x\"] .caption .word");
    expect(tweens).toContain(`tl.fromTo('[data-composition-id="x"] .caption .word[data-i="0"]'`);
    expect(tweens).toContain(`tl.fromTo('[data-composition-id="x"] .caption .word[data-i="1"]'`);
    // Absolute start times preserved
    expect(tweens).toContain(", 0)");    // first word at 0
    expect(tweens).toContain(", 0.6)");  // second word at 0.6
  });

  it("clamps negative start times to 0", () => {
    const tweens = buildTranscriptTweens(
      [{ text: "First", start: -0.05, end: 0.3 }],
      "x",
    );
    expect(tweens).toContain(", 0)");
  });
});

// ── per-preset word-sync rendering ──────────────────────────────────────────

const transcriptFixture: SceneTranscriptWord[] = [
  { text: "Ship", start: 0.05, end: 0.5 },
  { text: "videos,", start: 0.55, end: 1.1 },
  { text: "not", start: 1.2, end: 1.4 },
  { text: "clicks.", start: 1.45, end: 2.0 },
];

describe("emitSceneHtml — word-sync rendering", () => {
  describe("simple preset", () => {
    it("renders captions as static text when transcript is absent", () => {
      const html = emitSceneHtml({
        id: "x",
        preset: "simple",
        width: 1920,
        height: 1080,
        duration: 3,
        subhead: "Ship videos.",
      });
      expect(html).toContain('<div class="caption" id="caption">Ship videos.</div>');
      expect(html).not.toContain('class="word"');
      // The caption itself uses a single `tl.from` (not per-word). The
      // `tl.fromTo` here is the Ken-Burns backdrop scale tween which now
      // ships in every preset — the assertion below ensures no per-word
      // fromTo leaks in when transcript is absent.
      expect(html).not.toContain('.caption .word[data-i=');
    });

    it("splits caption into word spans with absolute GSAP timing when transcript is present", () => {
      const html = emitSceneHtml({
        id: "x",
        preset: "simple",
        width: 1920,
        height: 1080,
        duration: 3,
        subhead: "Ship videos, not clicks.",
        transcript: transcriptFixture,
      });
      // Each word becomes its own span
      expect(html).toContain('<span class="word" data-i="0">Ship</span>');
      expect(html).toContain('<span class="word" data-i="3">clicks.</span>');
      // GSAP timeline uses absolute start times
      expect(html).toContain("tl.fromTo");
      expect(html).toContain(", 0.05)"); // first word
      expect(html).toContain(", 1.45)"); // last word
      // Tail fade-out was removed — the producer cuts the clip at its
      // data-duration and the next scene's own fade-in handles the
      // transition (see scene-html-emit.ts).
      expect(html).not.toContain("tl.to('[data-composition-id=\"x\"] .caption'");
    });
  });

  describe("explainer preset", () => {
    it("renders subtitle as static text when transcript is absent", () => {
      const html = emitSceneHtml({
        id: "x",
        preset: "explainer",
        width: 1920,
        height: 1080,
        duration: 4,
        headline: "Title",
        subhead: "Subtitle text",
      });
      expect(html).toContain('<div class="subtitle" id="subtitle">Subtitle text</div>');
      expect(html).not.toContain('class="word"');
    });

    it("splits subtitle into word spans when transcript is present (kicker/title stay static)", () => {
      const html = emitSceneHtml({
        id: "x",
        preset: "explainer",
        width: 1920,
        height: 1080,
        duration: 4,
        kicker: "VIDEO AS CODE",
        headline: "Author scenes, not timelines",
        subhead: "Ship videos, not clicks.",
        transcript: transcriptFixture,
      });
      // Subtitle becomes word spans
      expect(html).toContain('<span class="word" data-i="0">Ship</span>');
      // Kicker + title remain static
      expect(html).toContain('<div class="kicker" id="kicker">VIDEO AS CODE</div>');
      expect(html).toContain('<h1 class="title" id="title">Author scenes, not timelines</h1>');
      // GSAP word-sync against #subtitle .word
      expect(html).toContain(`#subtitle .word[data-i="0"]`);
    });

    it("falls back to static subtitle when transcript present but subhead empty", () => {
      const html = emitSceneHtml({
        id: "x",
        preset: "explainer",
        width: 1920,
        height: 1080,
        duration: 4,
        headline: "Title",
        transcript: transcriptFixture,
      });
      // No subtitle div, no word spans (CSS rules can still mention .subtitle)
      expect(html).not.toContain('id="subtitle"');
      expect(html).not.toContain('class="word"');
    });
  });

  describe("kinetic-type preset", () => {
    it("uses even stagger when transcript is absent", () => {
      const html = emitSceneHtml({
        id: "x",
        preset: "kinetic-type",
        width: 1920,
        height: 1080,
        duration: 3,
        headline: "Ship videos",
      });
      expect(html).toContain('id="w-0"');
      expect(html).toContain('id="w-1"');
      // Stagger generates even start values, e.g. 0.05, 0.05+s, ...
      expect(html).toMatch(/, 0\.\d{2}\)/);
    });

    it("uses absolute transcript timing when present (overrides headline source)", () => {
      const html = emitSceneHtml({
        id: "x",
        preset: "kinetic-type",
        width: 1920,
        height: 1080,
        duration: 3,
        headline: "ignored when transcript supplied",
        transcript: transcriptFixture,
      });
      // Transcript words become the visible text
      expect(html).toContain(">Ship<");
      expect(html).toContain(">clicks.<");
      expect(html).not.toContain(">ignored<");
      // Absolute timings present in tweens
      expect(html).toContain(", 0.05)");
      expect(html).toContain(", 1.45)");
    });
  });

  describe("announcement preset (transcript ignored — static headline)", () => {
    it("does not split headline even when transcript is present", () => {
      const html = emitSceneHtml({
        id: "x",
        preset: "announcement",
        width: 1920,
        height: 1080,
        duration: 3,
        headline: "Big Headline",
        transcript: transcriptFixture,
      });
      expect(html).toContain('<h1 id="headline">Big Headline</h1>');
      expect(html).not.toContain('class="word"');
    });
  });

  describe("product-shot preset (transcript ignored)", () => {
    it("does not split headline even when transcript is present", () => {
      const html = emitSceneHtml({
        id: "x",
        preset: "product-shot",
        width: 1920,
        height: 1080,
        duration: 3,
        headline: "Big Product",
        transcript: transcriptFixture,
      });
      expect(html).toContain('id="headline"');
      expect(html).toContain("Big Product");
      expect(html).not.toContain('class="word"');
    });
  });
});

// ── robust-default behaviour (Ken-Burns + auto-fit font sizing) ────────────

describe("emitSceneHtml — robust defaults across input variability", () => {
  it("ships Ken-Burns backdrop motion on every preset (no static dead frames)", () => {
    for (const preset of ["simple", "announcement", "explainer", "kinetic-type", "product-shot"] as const) {
      const html = emitSceneHtml({
        id: "x",
        preset,
        width: 1920,
        height: 1080,
        duration: 5,
        headline: "Test",
        subhead: "sub",
        kicker: "kick",
      });
      expect(html, `${preset} should include Ken-Burns backdrop tween`).toMatch(
        /tl\.fromTo\('\[data-composition-id="x"\] \.backdrop'.*scale: 1\.0/,
      );
    }
  });

  it("announcement: scales font size down for long headlines, never below 72px", () => {
    const short = emitSceneHtml({
      id: "x", preset: "announcement", width: 1920, height: 1080, duration: 5,
      headline: "Short tagline",
    });
    const long = emitSceneHtml({
      id: "x", preset: "announcement", width: 1920, height: 1080, duration: 5,
      headline: "VibeFrame turns natural language into editable HTML scenes that render to video",
    });
    expect(short).toContain("font-size: 160px");
    // 80-char headline: ratio = 22/80 ≈ 0.275, baseMax 160 × 0.275 ≈ 44 → clamped to 72
    expect(long).toMatch(/font-size: (7[2-9]|8[0-9])px/);
    expect(long).not.toContain("font-size: 160px");
  });

  it("kinetic-type: word-count-aware font size keeps text inside 1920×1080 canvas", () => {
    const fewWords = emitSceneHtml({
      id: "x", preset: "kinetic-type", width: 1920, height: 1080, duration: 5,
      headline: "Ship fast", // 9 chars → 180px
    });
    const manyWords = emitSceneHtml({
      id: "x", preset: "kinetic-type", width: 1920, height: 1080, duration: 5,
      headline: "Author scenes generate edit render publish ship done", // 8 words / 52 chars → 90px
    });
    const tons = emitSceneHtml({
      id: "x", preset: "kinetic-type", width: 1920, height: 1080, duration: 5,
      headline: "One two three four five six seven eight nine ten eleven twelve more text here", // 70+ chars → 72px
    });
    expect(fewWords).toContain("font-size: 180px");
    expect(manyWords).toContain("font-size: 90px");
    expect(tons).toContain("font-size: 72px");
  });

  it("kinetic-type: emits flex-wrap so wrapping is the fallback when heuristic underestimates", () => {
    const html = emitSceneHtml({
      id: "x", preset: "kinetic-type", width: 1920, height: 1080, duration: 5,
      headline: "Hello world",
    });
    expect(html).toContain("flex-wrap: wrap");
  });

  it("explainer: scales title font down for long headlines", () => {
    const long = emitSceneHtml({
      id: "x", preset: "explainer", width: 1920, height: 1080, duration: 5,
      kicker: "INTRO", headline: "An exhaustively long explanation that would otherwise overflow the canvas",
    });
    expect(long).not.toContain("font-size: 110px"); // base maxes
    expect(long).toMatch(/\.title \{[\s\S]*font-size: \d+px/); // some computed value
  });

  it("ships scope crossfade tweens (fade-in at 0, fade-out at dur-overlap) on every preset", () => {
    for (const preset of ["simple", "announcement", "explainer", "kinetic-type", "product-shot"] as const) {
      const html = emitSceneHtml({
        id: "x",
        preset,
        width: 1920,
        height: 1080,
        duration: 5,
        headline: "Test",
        subhead: "sub",
        kicker: "kick",
      });
      // Symmetric fade-in / fade-out, both 0.4 s. Combined with z-index
      // inversion in buildClipReference() (earlier scenes on top), the
      // outgoing fade-out reveals the incoming below cleanly.
      expect(html, `${preset} should fade-in scope at 0`).toMatch(
        /tl\.from\('\[data-composition-id="x"\]', \{ opacity: 0, duration: 0\.4.*\}, 0\)/,
      );
      expect(html, `${preset} should fade-out scope before end`).toMatch(
        /tl\.to\('\[data-composition-id="x"\]', \{ opacity: 0, duration: 0\.4.*\}, 4\.60\)/,
      );
    }
  });

  it("buildClipReference assigns inverted z-index so earlier scenes paint on top during overlap", () => {
    const a = buildClipReference({ id: "intro", start: 0, duration: 5 });
    const b = buildClipReference({ id: "core", start: 4.6, duration: 7 });
    const c = buildClipReference({ id: "outro", start: 11.2, duration: 6 });
    // Higher z-index = painted on top. start=0 should outrank start=4.6
    // which should outrank start=11.2.
    const z = (clip: string) => parseInt(clip.match(/z-index: (\d+);/)?.[1] ?? "0", 10);
    expect(z(a)).toBeGreaterThan(z(b));
    expect(z(b)).toBeGreaterThan(z(c));
  });

  it("nextSceneStart respects optional overlap so subsequent clips overlap by SCENE_OVERLAP_SECONDS", () => {
    const root = `
      <div class="clip" data-composition-src="a.html" data-start="0" data-duration="5" data-track-index="1"></div>
      <div class="clip" data-composition-src="b.html" data-start="5" data-duration="7" data-track-index="1"></div>
    `;
    // Without overlap: behaves like before (logical end)
    expect(nextSceneStart(root)).toBe(12);
    // With overlap: returns 12 - 0.4 = 11.6 so the next clip overlaps the
    // last 0.4 s of the previous one, matching the crossfade window.
    expect(nextSceneStart(root, 0.4)).toBeCloseTo(11.6, 5);
  });

  it("hero text containers all get overflow-wrap break-word as a safety net", () => {
    for (const preset of ["simple", "announcement", "explainer", "kinetic-type", "product-shot"] as const) {
      const html = emitSceneHtml({
        id: "x", preset, width: 1920, height: 1080, duration: 5,
        headline: "Test", subhead: "sub", kicker: "kick",
      });
      expect(html, `${preset} should include overflow-wrap`).toContain("overflow-wrap: break-word");
    }
  });
});
