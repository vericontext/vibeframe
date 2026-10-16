import { describe, expect, it } from "vitest";

import { draftStoryboardFromBrief } from "./storyboard-draft.js";
import { parseStoryboard } from "./storyboard-parse.js";
import { validateStoryboardMarkdown } from "./storyboard-edit.js";
import { getVisualStyle } from "./visual-styles.js";

function beats(brief: string, durationSec = 20) {
  const draft = draftStoryboardFromBrief({ name: "demo", brief, durationSec });
  return { draft, beats: parseStoryboard(draft.storyboardMd).beats };
}

describe("draftStoryboardFromBrief (offline skeleton)", () => {
  it("takes the beats from the brief's own outline", () => {
    const { draft, beats: parsed } = beats(
      "A 20-second explainer on why paper boats float: hook, buoyancy, folding tip."
    );
    expect(parsed.map((beat) => beat.id)).toEqual(["hook", "buoyancy", "folding-tip"]);
    expect(draft.storyboardMd).toContain(
      'backdrop: "Buoyancy: an explainer on why paper boats float. No readable text'
    );
    expect(validateStoryboardMarkdown(draft.storyboardMd).ok).toBe(true);
  });

  it("reads numbered outlines without their numbers", () => {
    const { beats: parsed, draft } = beats("Explain compound interest - 1. what it is 2. the formula 3. a worked example");
    expect(parsed.map((beat) => beat.id)).toEqual(["what-it-is", "the-formula", "a-worked-example"]);
    expect(draft.storyboardMd).toContain('"The formula: Explain compound interest. No readable');
  });

  it("never invents narration, and says so", () => {
    const { draft, beats: parsed } = beats("24-second calm mountain sunrise launch video for Apex Ridge", 24);
    expect(draft.storyboardMd).toContain('title: "Apex Ridge"');
    expect(draft.storyboardMd).not.toMatch(/narration:/);
    expect(draft.storyboardMd).not.toMatch(/storyboard becomes files|build-report\.json|ready to show/);
    expect(parsed.map((beat) => beat.id)).toEqual(["hook", "setup", "payoff", "close"]);
    expect(draft.warnings.join(" ")).toMatch(/no narration yet.*storyboard revise/);
  });

  it("splits the duration across beats exactly", () => {
    const { beats: parsed } = beats("Make a teaser: open, reveal, price, website", 30);
    const total = parsed.reduce((sum, beat) => sum + Number(beat.cues?.duration ?? 0), 0);
    expect(total).toBeCloseTo(30, 5);
  });

  it("cuts long backdrop prompts at a word boundary", () => {
    const long = `${"A very long description of a scene with many many words ".repeat(6)}: intro, outro`;
    const { draft } = beats(long);
    const backdrop = draft.storyboardMd.match(/backdrop: "([^"]+)"/)?.[1] ?? "";
    expect(backdrop.length).toBeLessThanOrEqual(180);
    expect(long).toContain(backdrop.split(": ")[1].split(" ").at(-1) ?? "");
  });

  it("preserves visual style when drafting from a brief", () => {
    const swiss = getVisualStyle("Swiss Pulse");
    expect(swiss).toBeDefined();

    const draft = draftStoryboardFromBrief({
      name: "my-video",
      brief: "30-second product launch video for Grid Pilot",
      durationSec: 30,
      visualStyle: swiss,
    });

    expect(draft.designMd).toContain("Swiss Pulse");
    expect(draft.designMd).toContain("#0066FF");
    expect(draft.designMd).not.toContain("_hex_");
  });
});
