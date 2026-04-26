import { describe, expect, it } from "vitest";

import {
  deriveBeatId,
  parseBeatDuration,
  parseStoryboard,
} from "./storyboard-parse.js";

describe("parseStoryboard", () => {
  it("returns empty global + beats for empty input", () => {
    expect(parseStoryboard("")).toEqual({ global: "", beats: [] });
  });

  it("treats no-heading input as pure global direction", () => {
    const r = parseStoryboard("Just some prose.\n\nNo headings here.\n");
    expect(r.beats).toEqual([]);
    expect(r.global).toContain("Just some prose.");
    expect(r.global).toContain("No headings here.");
  });

  it("parses a single beat with global direction before it", () => {
    const md = `**Format:** 1920×1080
**Audio:** Kokoro, monotone

## Beat 1 — Hook (0–3s)

### Concept

Cold open.
`;
    const r = parseStoryboard(md);
    expect(r.global).toContain("**Format:** 1920×1080");
    expect(r.global).toContain("**Audio:** Kokoro");
    expect(r.beats).toHaveLength(1);
    expect(r.beats[0].id).toBe("1");
    expect(r.beats[0].heading).toBe("Beat 1 — Hook (0–3s)");
    expect(r.beats[0].body).toContain("### Concept");
    expect(r.beats[0].body).toContain("Cold open.");
  });

  it("parses multiple beats sequentially", () => {
    const md = `## Beat 1 — Hook

Body 1.

## Beat 2 — Core

Body 2.

## Beat 3 — Outro

Body 3.
`;
    const r = parseStoryboard(md);
    expect(r.beats.map((b) => b.id)).toEqual(["1", "2", "3"]);
    expect(r.beats[0].body).toBe("Body 1.");
    expect(r.beats[1].body).toBe("Body 2.");
    expect(r.beats[2].body).toBe("Body 3.");
  });

  it("accepts em-dash, hyphen, and colon as the separator", () => {
    const md = `## Beat 1 — Em-dash
body
## Beat 2 - Hyphen
body
## Beat 3 : Colon
body
`;
    const r = parseStoryboard(md);
    expect(r.beats.map((b) => b.id)).toEqual(["1", "2", "3"]);
  });

  it("falls back to slug of heading when there's no Beat prefix", () => {
    const md = `## The Big Reveal

body
`;
    const r = parseStoryboard(md);
    expect(r.beats[0].id).toBe("the-big-reveal");
    expect(r.beats[0].heading).toBe("The Big Reveal");
  });

  it("strips parenthesised duration suffix from heading slug", () => {
    const md = `## Hook (3 seconds)

body
`;
    const r = parseStoryboard(md);
    expect(r.beats[0].id).toBe("hook");
  });

  it("preserves nested ### subsections inside beat body", () => {
    const md = `## Beat 1 — Hook

### Concept
foo
### VO cue
bar
### Visual
baz
`;
    const r = parseStoryboard(md);
    expect(r.beats[0].body).toContain("### Concept");
    expect(r.beats[0].body).toContain("### VO cue");
    expect(r.beats[0].body).toContain("### Visual");
  });

  it("returns global when document has no beats but has headings of other levels", () => {
    const md = `# Top-level only
### Subsection — not a beat
prose
`;
    const r = parseStoryboard(md);
    expect(r.beats).toEqual([]);
    expect(r.global).toContain("Top-level only");
    expect(r.global).toContain("Subsection");
  });

  it("normalises CRLF line endings", () => {
    const md = "## Beat 1 — Hook\r\n\r\nbody\r\n";
    const r = parseStoryboard(md);
    expect(r.beats).toHaveLength(1);
    expect(r.beats[0].body).toBe("body");
  });

  it("non-numeric beat ids slugify (Beat hook, Beat scene-2 etc.)", () => {
    const md = `## Beat hook — Title

body

## Beat scene-2 - Another

body
`;
    const r = parseStoryboard(md);
    expect(r.beats.map((b) => b.id)).toEqual(["hook", "scene-2"]);
  });
});

describe("deriveBeatId", () => {
  it.each([
    ["Beat 1 — Hook", "1"],
    ["Beat 2 - Core", "2"],
    ["Beat 3 : Outro", "3"],
    ["Beat hook — Intro", "hook"],
    ["The Big Reveal", "the-big-reveal"],
    ["Hook", "hook"],
    ["Hook (3s)", "hook"],
    ["", "beat"],                  // empty heading falls back
    ["!!!", "beat"],                // pure punctuation falls back
    ["café opener", "cafe-opener"], // diacritics stripped
  ] as const)("%j → %j", (heading, expected) => {
    expect(deriveBeatId(heading)).toBe(expected);
  });
});

describe("parseBeatDuration", () => {
  it("parses bare seconds value", () => {
    const body = `### Beat duration\n\n3 seconds\n`;
    expect(parseBeatDuration(body)).toBe(3);
  });

  it("parses fractional seconds with the s suffix", () => {
    const body = `### Beat duration\n\n3.5s\n`;
    expect(parseBeatDuration(body)).toBe(3.5);
  });

  it("parses bare integer", () => {
    const body = `### Beat duration\n\n5\n`;
    expect(parseBeatDuration(body)).toBe(5);
  });

  it("returns undefined when no Beat duration subsection", () => {
    expect(parseBeatDuration("### Concept\n\nfoo")).toBeUndefined();
  });

  it("returns undefined when subsection has no parseable number", () => {
    expect(parseBeatDuration("### Beat duration\n\nlong\n")).toBeUndefined();
  });

  it("returns undefined for negative or zero duration", () => {
    expect(parseBeatDuration("### Beat duration\n\n0\n")).toBeUndefined();
    expect(parseBeatDuration("### Beat duration\n\n-3\n")).toBeUndefined();
  });

  it("only reads first Beat-duration subsection it sees, then stops at next heading", () => {
    const body = `### Beat duration\n\n4\n\n### Notes\n\n10 seconds of post-roll\n`;
    expect(parseBeatDuration(body)).toBe(4);
  });
});
