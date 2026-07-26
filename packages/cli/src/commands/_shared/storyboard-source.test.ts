import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  detectStoryboardLayout,
  listSceneFiles,
  loadStoryboard,
  sceneFilename,
  sceneToBeatSection,
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
