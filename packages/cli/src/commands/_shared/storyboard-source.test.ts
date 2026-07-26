import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  detectStoryboardLayout,
  listSceneFiles,
  loadStoryboard,
  moveScene,
  planMigration,
  setSceneCue,
  sceneFilename,
  sceneToBeatSection,
  strayBeatIssues,
  upsertScene,
} from "./storyboard-source.js";
import { parseStoryboard } from "./storyboard-parse.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vibe-storyboard-source-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const HEAD = [
  "---",
  'type: Storyboard',
  'title: "Launch"',
  "duration: 10",
  "characters:",
  '  mira: "arctic photographer"',
  "---",
  "",
  "# Launch - Storyboard",
  "",
  "Pacing: keep scenes 6-15 seconds.",
  "",
].join("\n");

async function writeBundle(scenes: Array<[string, string]>) {
  await writeFile(join(dir, "STORYBOARD.md"), HEAD, "utf-8");
  await mkdir(join(dir, "scenes"), { recursive: true });
  for (const [name, body] of scenes) {
    await writeFile(join(dir, "scenes", name), body, "utf-8");
  }
}

describe("layout detection", () => {
  it("reports missing when the project has neither", () => {
    expect(detectStoryboardLayout(dir, 0)).toBe("missing");
  });

  it("reports single when only STORYBOARD.md exists", async () => {
    await writeFile(join(dir, "STORYBOARD.md"), HEAD, "utf-8");
    expect(detectStoryboardLayout(dir, 0)).toBe("single");
  });

  it("reports bundle as soon as one scene file exists", () => {
    expect(detectStoryboardLayout(dir, 1)).toBe("bundle");
  });
});

describe("scene ordering", () => {
  it("orders by numeric prefix, not filename", async () => {
    await writeBundle([
      ["10-close.md", "---\nduration: 2\n---\n\nClose."],
      ["02-proof.md", "---\nduration: 3\n---\n\nProof."],
      ["01-hook.md", "---\nduration: 5\n---\n\nHook."],
    ]);
    // Plain filename sort would put "10-close" before "02-proof".
    expect((await listSceneFiles(dir)).map((s) => s.id)).toEqual(["hook", "proof", "close"]);
  });

  it("strips the prefix from the beat id", async () => {
    await writeBundle([["07-final-word.md", "---\nduration: 2\n---\n\nx"]]);
    const [scene] = await listSceneFiles(dir);
    expect(scene.id).toBe("final-word");
    expect(scene.order).toBe(7);
  });

  it("accepts unprefixed files and sorts them after prefixed ones", async () => {
    await writeBundle([
      ["hook.md", "---\nduration: 1\n---\n\na"],
      ["01-intro.md", "---\nduration: 1\n---\n\nb"],
    ]);
    expect((await listSceneFiles(dir)).map((s) => s.id)).toEqual(["intro", "hook"]);
  });

  it("ignores underscore-prefixed and non-markdown files", async () => {
    await writeBundle([
      ["01-hook.md", "---\nduration: 1\n---\n\na"],
      ["_draft.md", "---\nduration: 1\n---\n\nb"],
      ["notes.txt", "not markdown"],
    ]);
    expect((await listSceneFiles(dir)).map((s) => s.id)).toEqual(["hook"]);
  });
});

describe("sceneToBeatSection", () => {
  it("moves frontmatter into a cue block and keeps the body", () => {
    const out = sceneToBeatSection(
      { id: "hook", path: "x", filename: "01-hook.md", order: 1 },
      '---\nduration: 5\nnarration: "Hi"\n---\n\nBody prose.\n'
    );
    expect(out).toContain("## Beat hook - Hook");
    expect(out).toContain("```yaml");
    expect(out).toContain("duration: 5");
    expect(out).toContain("Body prose.");
  });

  it("drops the OKF type field so it never trips the unknown-cue warning", () => {
    const out = sceneToBeatSection(
      { id: "hook", path: "x", filename: "01-hook.md", order: 1 },
      "---\ntype: Scene\nduration: 5\n---\n\nBody.\n"
    );
    expect(out).not.toContain("type:");
    expect(out).toContain("duration: 5");
  });

  it("keeps `title` as a cue rather than promoting it to the heading", () => {
    const out = sceneToBeatSection(
      { id: "hook", path: "x", filename: "01-hook.md", order: 1 },
      '---\ntitle: "Lower third copy"\n---\n\nBody.\n'
    );
    expect(out).toContain("## Beat hook - Hook");
    expect(out).toContain('title: Lower third copy');
  });
});

describe("loadStoryboard", () => {
  it("assembles a bundle into a document the existing parser understands", async () => {
    await writeBundle([
      ["01-hook.md", '---\ntype: Scene\nduration: 5\nnarration: "One"\n---\n\nHook body.'],
      ["02-proof.md", '---\ntype: Scene\nduration: 5\ncharacters: [mira]\n---\n\nProof body.'],
    ]);
    const loaded = await loadStoryboard(dir);
    expect(loaded.layout).toBe("bundle");

    const parsed = parseStoryboard(loaded.markdown);
    expect(parsed.beats.map((b) => b.id)).toEqual(["hook", "proof"]);
    expect(parsed.beats[0].cues?.narration).toBe("One");
    expect(parsed.beats[0].duration).toBe(5);
    expect(parsed.beats[1].cues?.characters).toEqual(["mira"]);
    // Project frontmatter survives the round trip.
    expect(parsed.frontmatter?.title).toBe("Launch");
    expect(Object.keys(parsed.frontmatter?.characters ?? {})).toEqual(["mira"]);
    // Direction prose stays in the global block.
    expect(parsed.global).toContain("Pacing: keep scenes 6-15 seconds.");
  });

  it("reads a legacy single-file project unchanged", async () => {
    const legacy = `${HEAD}\n## Beat hook - Hook\n\n\`\`\`yaml\nduration: 4\n\`\`\`\n\nBody.\n`;
    await writeFile(join(dir, "STORYBOARD.md"), legacy, "utf-8");
    const loaded = await loadStoryboard(dir);
    expect(loaded.layout).toBe("single");
    expect(loaded.markdown).toBe(legacy);
    expect(parseStoryboard(loaded.markdown).beats.map((b) => b.id)).toEqual(["hook"]);
  });

  it("returns empty for a project with no storyboard at all", async () => {
    const loaded = await loadStoryboard(dir);
    expect(loaded.layout).toBe("missing");
    expect(loaded.markdown).toBe("");
  });

  it("produces cues that pass validation, including no unknown-cue warnings", async () => {
    await writeBundle([
      [
        "01-hook.md",
        '---\ntype: Scene\nduration: 5\nnarration: "n"\nbackdrop: "b"\nmotion: "m"\n---\n\nBody.',
      ],
    ]);
    const { validateStoryboardMarkdown } = await import("./storyboard-edit.js");
    const result = validateStoryboardMarkdown((await loadStoryboard(dir)).markdown);
    expect(result.issues.map((i) => i.code)).not.toContain("UNKNOWN_CUE");
    expect(result.ok).toBe(true);
  });
});

describe("sceneFilename", () => {
  it("pads to two digits, widening only past 99", () => {
    expect(sceneFilename(1, "hook")).toBe("01-hook.md");
    expect(sceneFilename(12, "proof")).toBe("12-proof.md");
    expect(sceneFilename(100, "late")).toBe("100-late.md");
  });
});

describe("planMigration", () => {
  const LEGACY = [
    "---",
    "type: Storyboard",
    'title: "Launch"',
    "characters:",
    '  mira: "arctic photographer"',
    "---",
    "",
    "# Launch - Storyboard",
    "",
    "Pacing note.",
    "",
    "## Beat hook - Hook",
    "",
    "```yaml",
    "duration: 5",
    'narration: "One"',
    "```",
    "",
    "Hook body.",
    "",
    "## Beat proof - Proof",
    "",
    "```yaml",
    "duration: 4",
    "characters: [mira]",
    "```",
    "",
    "Proof body.",
    "",
  ].join("\n");

  it("writes one numbered scene file per beat, in order", () => {
    const plan = planMigration(LEGACY);
    expect(plan.scenes.map((f) => f.path)).toEqual([
      "scenes/01-hook.md",
      "scenes/02-proof.md",
    ]);
    expect(plan.beatIds).toEqual(["hook", "proof"]);
  });

  it("turns cues into frontmatter and tags the file as a Scene", () => {
    const [hook] = planMigration(LEGACY).scenes;
    expect(hook.contents).toMatch(/^---\ntype: Scene\n/);
    expect(hook.contents).toContain("duration: 5");
    expect(hook.contents).toContain("Hook body.");
    expect(hook.contents).not.toContain("```yaml");
  });

  it("leaves STORYBOARD.md with frontmatter and prose but no beats", () => {
    const { storyboard } = planMigration(LEGACY);
    expect(storyboard.contents).toContain("type: Storyboard");
    expect(storyboard.contents).toContain("mira: arctic photographer");
    expect(storyboard.contents).toContain("Pacing note.");
    expect(storyboard.contents).not.toContain("## Beat");
    expect(storyboard.contents).toContain("Scenes live in `scenes/`");
  });

  it("round-trips: the migrated bundle parses to the same beats", async () => {
    const plan = planMigration(LEGACY);
    await writeFile(join(dir, "STORYBOARD.md"), plan.storyboard.contents, "utf-8");
    await mkdir(join(dir, "scenes"), { recursive: true });
    for (const file of plan.scenes) {
      await writeFile(join(dir, file.path), file.contents, "utf-8");
    }
    const before = parseStoryboard(LEGACY);
    const after = parseStoryboard((await loadStoryboard(dir)).markdown);

    expect(after.beats.map((b) => b.id)).toEqual(before.beats.map((b) => b.id));
    expect(after.beats.map((b) => b.cues)).toEqual(before.beats.map((b) => b.cues));
    expect(after.beats.map((b) => b.duration)).toEqual(before.beats.map((b) => b.duration));
    expect(after.frontmatter?.characters).toEqual(before.frontmatter?.characters);
  });

  it("carries a duration that only existed as a `### Beat duration` subsection", () => {
    const md = [
      "## Beat solo - Solo",
      "",
      "### Beat duration",
      "",
      "7 seconds",
      "",
      "Body.",
      "",
    ].join("\n");
    const parsedDuration = parseStoryboard(md).beats[0]?.duration;
    const [scene] = planMigration(md).scenes;
    if (parsedDuration !== undefined) {
      expect(scene.contents).toContain(`duration: ${parsedDuration}`);
    }
  });
});

describe("bundle writes", () => {
  async function bundle() {
    await writeBundle([
      ["01-hook.md", '---\ntype: Scene\nduration: 5\nnarration: "One"\n---\n\nHook body.'],
      ["02-proof.md", '---\ntype: Scene\nduration: 4\n---\n\nProof body.'],
      ["03-close.md", '---\ntype: Scene\nduration: 3\n---\n\nClose body.'],
    ]);
  }

  it("sets a cue in one scene file and leaves the body alone", async () => {
    await bundle();
    const { cues } = await setSceneCue(dir, { beatId: "hook", key: "duration", value: 9 });
    expect(cues.duration).toBe(9);
    const raw = await readFile(join(dir, "scenes", "01-hook.md"), "utf-8");
    expect(raw).toContain("duration: 9");
    expect(raw).toContain("Hook body.");
    expect(raw).toMatch(/^---\ntype: Scene\n/);
  });

  it("unsets a cue", async () => {
    await bundle();
    const { cues } = await setSceneCue(dir, { beatId: "hook", key: "narration", unset: true });
    expect(cues.narration).toBeUndefined();
    expect(cues.duration).toBe(5);
  });

  it("rejects an unsupported cue key", async () => {
    await bundle();
    await expect(setSceneCue(dir, { beatId: "hook", key: "bogus", value: "x" })).rejects.toThrow(
      /Unsupported cue/
    );
  });

  it("rejects a non-positive duration, like the single-document writer", async () => {
    await bundle();
    await expect(
      setSceneCue(dir, { beatId: "hook", key: "duration", value: "abc" })
    ).rejects.toThrow(/positive number/);
  });

  it("names the known scenes when the id is wrong", async () => {
    await bundle();
    await expect(setSceneCue(dir, { beatId: "nope", key: "duration", value: 1 })).rejects.toThrow(
      /hook, proof, close/
    );
  });

  it("renumbers filenames on move without leaving temp files", async () => {
    await bundle();
    const order = await moveScene(dir, { beatId: "hook", afterBeatId: "close" });
    expect(order).toEqual(["proof", "close", "hook"]);
    const names = (await listSceneFiles(dir)).map((s) => s.filename);
    expect(names).toEqual(["01-proof.md", "02-close.md", "03-hook.md"]);
    const { readdir } = await import("node:fs/promises");
    const all = await readdir(join(dir, "scenes"));
    expect(all.filter((n) => n.startsWith(".vibe-move"))).toEqual([]);
  });

  it("survives a permutation that a naive rename order would clobber", async () => {
    await bundle();
    // close -> front. Every file needs a new number and 01 is occupied.
    await moveScene(dir, { beatId: "close", afterBeatId: "hook" });
    const scenes = await listSceneFiles(dir);
    expect(scenes.map((s) => s.id)).toEqual(["hook", "close", "proof"]);
    // No scene was lost or overwritten.
    expect(scenes).toHaveLength(3);
  });

  it("moving a scene onto itself is a no-op", async () => {
    await bundle();
    const order = await moveScene(dir, { beatId: "hook", afterBeatId: "hook" });
    expect(order).toEqual(["hook", "proof", "close"]);
  });
});

describe("stray beats in a bundle's STORYBOARD.md", () => {
  const HEAD_WITH_BEAT = [
    "---",
    "type: Storyboard",
    'title: "Launch"',
    "---",
    "",
    "# Launch - Storyboard",
    "",
    "Direction prose.",
    "",
    "## Beat leftover - Leftover",
    "",
    "```yaml",
    "duration: 9",
    "```",
    "",
    "A beat that was never moved into scenes/.",
    "",
  ].join("\n");

  it("does not merge them into the timeline", async () => {
    await writeFile(join(dir, "STORYBOARD.md"), HEAD_WITH_BEAT, "utf-8");
    await mkdir(join(dir, "scenes"), { recursive: true });
    await writeFile(join(dir, "scenes", "01-hook.md"), "---\nduration: 5\n---\n\nHook.", "utf-8");

    const loaded = await loadStoryboard(dir);
    const ids = parseStoryboard(loaded.markdown).beats.map((b) => b.id);
    expect(ids).toEqual(["hook"]);
    expect(ids).not.toContain("leftover");
  });

  it("reports them so they cannot pass unnoticed", async () => {
    await writeFile(join(dir, "STORYBOARD.md"), HEAD_WITH_BEAT, "utf-8");
    await mkdir(join(dir, "scenes"), { recursive: true });
    await writeFile(join(dir, "scenes", "01-hook.md"), "---\nduration: 5\n---\n\nHook.", "utf-8");

    const loaded = await loadStoryboard(dir);
    expect(loaded.strayBeatIds).toEqual(["leftover"]);
    const issues = strayBeatIssues(loaded.strayBeatIds);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].code).toBe("STRAY_BEATS_IN_STORYBOARD");
    expect(issues[0].message).toContain("scenes/");
  });

  it("keeps the frontmatter and prose that precede the stray heading", async () => {
    await writeFile(join(dir, "STORYBOARD.md"), HEAD_WITH_BEAT, "utf-8");
    await mkdir(join(dir, "scenes"), { recursive: true });
    await writeFile(join(dir, "scenes", "01-hook.md"), "---\nduration: 5\n---\n\nHook.", "utf-8");

    const parsed = parseStoryboard((await loadStoryboard(dir)).markdown);
    expect(parsed.frontmatter?.title).toBe("Launch");
    expect(parsed.global).toContain("Direction prose.");
    expect(parsed.global).not.toContain("never moved into scenes/");
  });

  it("stays empty for a clean bundle and for the single layout", async () => {
    await writeBundle([["01-hook.md", "---\nduration: 5\n---\n\nHook."]]);
    expect((await loadStoryboard(dir)).strayBeatIds).toEqual([]);

    await rm(join(dir, "scenes"), { recursive: true, force: true });
    await writeFile(
      join(dir, "STORYBOARD.md"),
      "## Beat hook - Hook\n\n```yaml\nduration: 5\n```\n\nBody.\n",
      "utf-8"
    );
    const single = await loadStoryboard(dir);
    expect(single.layout).toBe("single");
    expect(single.strayBeatIds).toEqual([]);
    expect(parseStoryboard(single.markdown).beats.map((b) => b.id)).toEqual(["hook"]);
  });
});

describe("upsertScene", () => {
  const STARTER = (id: string, prose: string) =>
    `---\ntype: Scene\nduration: 4\n---\n\n${prose}`;

  async function starterBundle() {
    // Same three ids and prose markers `isStarterStoryboard` looks for.
    await writeBundle([
      ["01-hook.md", STARTER("hook", "Introduce the promise in one crisp sentence.")],
      [
        "02-proof.md",
        STARTER("proof", "Show the mechanism or proof point that makes the promise believable."),
      ],
      ["03-close.md", STARTER("close", "Close with the action the viewer should remember.")],
    ]);
  }

  it("clears an untouched starter instead of appending to it", async () => {
    await starterBundle();
    const { action } = await upsertScene(dir, { beatId: "intro", duration: 5 });
    expect(action).toBe("replaced-starter");
    expect((await listSceneFiles(dir)).map((s) => s.filename)).toEqual(["01-intro.md"]);
  });

  it("appends after a bundle that is no longer the starter", async () => {
    await writeBundle([["01-mine.md", "---\ntype: Scene\nduration: 5\n---\n\nMine."]]);
    const { action } = await upsertScene(dir, { beatId: "next", duration: 3 });
    expect(action).toBe("appended");
    expect((await listSceneFiles(dir)).map((s) => s.id)).toEqual(["mine", "next"]);
  });

  it("updates an existing scene in place without renumbering", async () => {
    await writeBundle([
      ["01-a.md", "---\ntype: Scene\nduration: 5\n---\n\nOriginal body."],
      ["02-b.md", "---\ntype: Scene\nduration: 5\n---\n\nB."],
    ]);
    const { action } = await upsertScene(dir, { beatId: "a", duration: 9, title: "New" });
    expect(action).toBe("updated");
    expect((await listSceneFiles(dir)).map((s) => s.filename)).toEqual(["01-a.md", "02-b.md"]);

    const raw = await readFile(join(dir, "scenes", "01-a.md"), "utf-8");
    expect(raw).toContain("duration: 9");
    expect(raw).toContain("title: New");
    // The body survives an update that does not supply one.
    expect(raw).toContain("Original body.");
  });

  it("keeps type: Scene first after an update", async () => {
    await writeBundle([["01-a.md", "---\ntype: Scene\nduration: 5\n---\n\nBody."]]);
    await upsertScene(dir, { beatId: "a", duration: 6 });
    const raw = await readFile(join(dir, "scenes", "01-a.md"), "utf-8");
    expect(raw).toMatch(/^---\ntype: Scene\n/);
  });

  it("creates the scenes directory when the project has none yet", async () => {
    await writeFile(join(dir, "STORYBOARD.md"), HEAD, "utf-8");
    const { action } = await upsertScene(dir, { beatId: "first", duration: 4 });
    expect(action).toBe("appended");
    expect((await listSceneFiles(dir)).map((s) => s.filename)).toEqual(["01-first.md"]);
  });
});
