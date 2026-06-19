import { describe, expect, it } from "vitest";

import {
  moveStoryboardBeat,
  setStoryboardCue,
  upsertStoryboardBeat,
  validateStoryboardMarkdown,
} from "./storyboard-edit.js";
import { buildStoryboardMd } from "./scene-project.js";
import { parseStoryboard } from "./storyboard-parse.js";

const STORYBOARD = `# Demo

## Beat hook - Hook

\`\`\`yaml
duration: 3
narration: "Old line."
\`\`\`

Body.

## Beat proof - Proof

Body 2.
`;

describe("storyboard-edit", () => {
  it("sets one cue while preserving the beat body", () => {
    const next = setStoryboardCue(STORYBOARD, {
      beatId: "hook",
      key: "narration",
      value: "New line.",
    });
    const parsed = parseStoryboard(next);
    expect(parsed.beats[0].cues?.narration).toBe("New line.");
    expect(parsed.beats[0].body).toContain("Body.");
  });

  it("creates a cue block when a beat has none", () => {
    const next = setStoryboardCue(STORYBOARD, {
      beatId: "proof",
      key: "duration",
      value: "4.5",
    });
    const parsed = parseStoryboard(next);
    expect(parsed.beats[1].cues?.duration).toBe(4.5);
    expect(parsed.beats[1].body).toContain("Body 2.");
  });

  it("moves a beat after another beat", () => {
    const next = moveStoryboardBeat(STORYBOARD, {
      beatId: "hook",
      afterBeatId: "proof",
    });
    expect(parseStoryboard(next).beats.map((beat) => beat.id)).toEqual(["proof", "hook"]);
  });

  it("replaces the untouched starter storyboard with the added beat", () => {
    const result = upsertStoryboardBeat(buildStoryboardMd("Demo", 12), {
      beatId: "intro-scene",
      title: "Intro Scene",
      duration: 4,
    });
    const parsed = parseStoryboard(result.markdown);
    expect(result.action).toBe("replaced-starter");
    expect(parsed.beats.map((beat) => beat.id)).toEqual(["intro-scene"]);
    expect(parsed.beats[0].duration).toBe(4);
    expect(result.markdown).not.toContain("## Beat hook");
  });

  it("appends a missing beat to a custom storyboard", () => {
    const result = upsertStoryboardBeat(STORYBOARD, {
      beatId: "close",
      title: "Close",
      duration: 5,
      narration: "Finish the thought.",
      backdrop: "Clean final plate.",
    });
    const parsed = parseStoryboard(result.markdown);
    expect(result.action).toBe("appended");
    expect(parsed.beats.map((beat) => beat.id)).toEqual(["hook", "proof", "close"]);
    expect(parsed.beats[2].cues).toMatchObject({
      duration: 5,
      narration: "Finish the thought.",
      backdrop: "Clean final plate.",
    });
  });

  it("updates an existing beat cue block without clobbering body text", () => {
    const result = upsertStoryboardBeat(STORYBOARD, {
      beatId: "hook",
      duration: 6,
    });
    const parsed = parseStoryboard(result.markdown);
    expect(result.action).toBe("updated");
    expect(parsed.beats[0].duration).toBe(6);
    expect(parsed.beats[0].body).toContain("Body.");
  });

  it("throws when updating an existing beat with malformed cue YAML", () => {
    const malformed = `# Demo\n\n## Beat hook - Hook\n\n\`\`\`yaml\nduration: [\n\`\`\`\n\nBody.\n`;
    expect(() =>
      upsertStoryboardBeat(malformed, {
        beatId: "hook",
        duration: 4,
      })
    ).toThrow(/malformed YAML cues/);
  });

  it("validates duplicate beat ids and invalid cue shapes", () => {
    const result = validateStoryboardMarkdown(`${STORYBOARD}\n## Beat hook - Again\n\n\`\`\`yaml\nduration: nope\n\`\`\`\n`);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("DUPLICATE_BEAT_ID");
    expect(result.issues.map((issue) => issue.code)).toContain("INVALID_DURATION");
  });
});

describe("BEAT_DURATION_TOO_LONG pacing warning", () => {
  const sb = (duration: number) => `---
title: pacing
duration: ${duration}
---

# Pacing

## Beat hook — Hook

\`\`\`yaml
narration: "Long narration."
duration: ${duration}
\`\`\`

Body.
`;

  it("warns on beats longer than 15s without failing validation", () => {
    const result = validateStoryboardMarkdown(sb(23.5));
    const warning = result.issues.find((i) => i.code === "BEAT_DURATION_TOO_LONG");
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe("warning");
    expect(warning?.beatId).toBe("hook");
    expect(warning?.message).toContain("6-15s");
    expect(result.ok).toBe(true);
  });

  it("stays quiet for beats within the 6-15s window", () => {
    const result = validateStoryboardMarkdown(sb(12));
    expect(result.issues.find((i) => i.code === "BEAT_DURATION_TOO_LONG")).toBeUndefined();
  });
});

describe("characters cue validation", () => {
  const withPool = (cue: string) =>
    `---\ncharacters:\n  nova: "teal jacket engineer"\n---\n\n## Beat hook - Hook\n\n\`\`\`yaml\n${cue}\n\`\`\`\n\nBody.\n`;

  it("accepts a known single name and a known list", () => {
    expect(validateStoryboardMarkdown(withPool(`characters: nova`)).ok).toBe(true);
    expect(validateStoryboardMarkdown(withPool(`characters: [nova]`)).ok).toBe(true);
  });

  it("errors when characters is not a name or list of names", () => {
    const result = validateStoryboardMarkdown(withPool(`characters: 42`));
    expect(result.issues.map((i) => i.code)).toContain("INVALID_CHARACTERS_VALUE");
  });

  it("warns when a referenced character is absent from the pool", () => {
    const result = validateStoryboardMarkdown(withPool(`characters: [nova, ghost]`));
    const warning = result.issues.find((i) => i.code === "UNKNOWN_CHARACTER");
    expect(warning?.message).toContain("ghost");
    // Unknown character is a warning, not a hard error.
    expect(result.ok).toBe(true);
  });

  it("round-trips a characters list cue through setStoryboardCue", () => {
    const md = setStoryboardCue(buildStoryboardMd("demo"), {
      beatId: "hook",
      key: "characters",
      value: ["nova", "rival"],
    });
    expect(parseStoryboard(md).beats.find((b) => b.id === "hook")?.cues?.characters).toEqual([
      "nova",
      "rival",
    ]);
  });
});

describe("keyframe cue validation", () => {
  const withKeyframe = (cue: string) =>
    `## Beat hook - Hook\n\n\`\`\`yaml\n${cue}\n\`\`\`\n\nBody.\n`;

  it("accepts a string keyframe cue", () => {
    const result = validateStoryboardMarkdown(
      withKeyframe(`keyframe: "nova walking down the pit lane, cinematic"`)
    );
    expect(result.ok).toBe(true);
    expect(result.issues.map((i) => i.code)).not.toContain("UNKNOWN_CUE");
  });

  it("parses the keyframe cue into BeatCues", () => {
    const md = withKeyframe(`keyframe: "nova on the grid"`);
    expect(parseStoryboard(md).beats.find((b) => b.id === "hook")?.cues?.keyframe).toBe(
      "nova on the grid"
    );
  });
});
