import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  applyMechanicalFixes,
  discoverSceneFiles,
  filterSubCompFalsePositives,
  rootExists,
  runProjectLint,
  SUB_COMP_FALSE_POSITIVES,
  type LintFinding,
} from "./scene-lint.js";
import {
  buildEmptyRootHtml,
  scaffoldSceneProject,
} from "./scene-project.js";
import {
  buildClipReference,
  emitSceneHtml,
  insertClipIntoRoot,
} from "./scene-html-emit.js";

async function makeTmp(label = "vibe-scene-lint-"): Promise<string> {
  return mkdtemp(join(tmpdir(), label));
}

// ── filterSubCompFalsePositives ─────────────────────────────────────────────

describe("filterSubCompFalsePositives", () => {
  const findings: LintFinding[] = [
    { code: "standalone_composition_wrapped_in_template", severity: "warning", message: "x" },
    { code: "root_composition_missing_html_wrapper",      severity: "warning", message: "x" },
    { code: "missing_timeline_registry",                  severity: "error",   message: "real" },
  ];

  it("drops the two known false positives for sub-compositions", () => {
    const out = filterSubCompFalsePositives(findings, true);
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe("missing_timeline_registry");
  });

  it("returns root-composition findings unchanged", () => {
    const out = filterSubCompFalsePositives(findings, false);
    expect(out).toHaveLength(3);
  });

  it("exposes the filtered codes via SUB_COMP_FALSE_POSITIVES", () => {
    expect(SUB_COMP_FALSE_POSITIVES.has("standalone_composition_wrapped_in_template")).toBe(true);
    expect(SUB_COMP_FALSE_POSITIVES.has("root_composition_missing_html_wrapper")).toBe(true);
    expect(SUB_COMP_FALSE_POSITIVES.size).toBe(2);
  });
});

// ── applyMechanicalFixes ────────────────────────────────────────────────────

describe("applyMechanicalFixes — timed_element_missing_clip_class", () => {
  const finding: LintFinding = {
    code: "timed_element_missing_clip_class",
    severity: "error",
    message: "missing class=\"clip\"",
  };

  it("adds class=\"clip\" to elements with timing attributes and no class", () => {
    const html = `<div data-start="0" data-duration="3" data-track-index="1">x</div>`;
    const { html: out, fixedCodes } = applyMechanicalFixes(html, [finding]);
    expect(out).toContain('<div class="clip" data-start="0" data-duration="3"');
    expect(fixedCodes).toEqual(["timed_element_missing_clip_class"]);
  });

  it("merges into an existing class list rather than overwriting", () => {
    const html = `<div class="card glow" data-start="0" data-duration="3" data-track-index="1">x</div>`;
    const { html: out } = applyMechanicalFixes(html, [finding]);
    expect(out).toContain('class="card glow clip"');
  });

  it("is idempotent — already-clipped elements aren't modified", () => {
    const html = `<div class="clip card" data-start="0" data-duration="3" data-track-index="1">x</div>`;
    const { html: out, fixedCodes } = applyMechanicalFixes(html, [finding]);
    expect(out).toBe(html);
    expect(fixedCodes).toEqual([]);
  });

  it("skips <audio> and <video> (their lint rule already exempts them)", () => {
    const html = `<audio data-start="0" data-duration="3" src="x.mp3"></audio>
<video data-start="0" data-duration="3" src="x.mp4"></video>`;
    const { html: out, fixedCodes } = applyMechanicalFixes(html, [finding]);
    expect(out).toBe(html);
    expect(fixedCodes).toEqual([]);
  });

  it("does not fix codes outside the auto-fix allow-list", () => {
    const html = `<div data-start="0" data-duration="3">x</div>`;
    const other: LintFinding = { code: "missing_timeline_registry", severity: "error", message: "x" };
    const { html: out, fixedCodes } = applyMechanicalFixes(html, [other]);
    expect(out).toBe(html);
    expect(fixedCodes).toEqual([]);
  });
});

// ── discoverSceneFiles + rootExists ─────────────────────────────────────────

describe("discoverSceneFiles", () => {
  it("returns null root when index.html is missing", async () => {
    const dir = await makeTmp();
    const out = await discoverSceneFiles({ projectDir: dir });
    expect(out.root).toBeNull();
    expect(out.subs).toEqual([]);
  });

  it("walks compositions/ recursively and sorts results", async () => {
    const dir = await makeTmp();
    await scaffoldSceneProject({ dir, name: "fix", aspect: "16:9", duration: 6 });
    await mkdir(resolve(dir, "compositions/nested"), { recursive: true });
    await writeFile(resolve(dir, "compositions/scene-b.html"), "x", "utf-8");
    await writeFile(resolve(dir, "compositions/scene-a.html"), "x", "utf-8");
    await writeFile(resolve(dir, "compositions/nested/deep.html"), "x", "utf-8");
    await writeFile(resolve(dir, "compositions/notes.txt"), "ignored", "utf-8");

    const out = await discoverSceneFiles({ projectDir: dir });
    expect(out.root).toBe(resolve(dir, "index.html"));
    expect(out.subs).toEqual([
      resolve(dir, "compositions/nested/deep.html"),
      resolve(dir, "compositions/scene-a.html"),
      resolve(dir, "compositions/scene-b.html"),
    ]);
  });
});

describe("rootExists", () => {
  it("true when index.html exists, false otherwise", async () => {
    const dir = await makeTmp();
    expect(await rootExists(dir)).toBe(false);
    await scaffoldSceneProject({ dir, name: "x", aspect: "16:9", duration: 4 });
    expect(await rootExists(dir)).toBe(true);
  });
});

// ── runProjectLint — integration against scaffolded projects ────────────────

describe("runProjectLint — integration", () => {
  async function scaffoldWithScenes(): Promise<string> {
    const dir = await makeTmp("vibe-lint-int-");
    await scaffoldSceneProject({ dir, name: "fixture", aspect: "16:9", duration: 8 });

    // Add two scenes by hand using the C2 emit helpers (avoids spawning the CLI).
    let root = await readFile(resolve(dir, "index.html"), "utf-8");

    const intro = emitSceneHtml({
      id: "intro", preset: "announcement", width: 1920, height: 1080,
      duration: 4, headline: "Hello",
    });
    await writeFile(resolve(dir, "compositions/scene-intro.html"), intro, "utf-8");
    root = insertClipIntoRoot(root, { id: "intro", start: 0, duration: 4 });

    const outro = emitSceneHtml({
      id: "outro", preset: "simple", width: 1920, height: 1080,
      duration: 3, subhead: "Thanks",
    });
    await writeFile(resolve(dir, "compositions/scene-outro.html"), outro, "utf-8");
    root = insertClipIntoRoot(root, { id: "outro", start: 4, duration: 3 });

    await writeFile(resolve(dir, "index.html"), root, "utf-8");
    return dir;
  }

  it("produces ok=true on a freshly scaffolded project with valid scenes", async () => {
    const dir = await scaffoldWithScenes();
    const result = await runProjectLint({ projectDir: dir });

    expect(result.ok).toBe(true);
    expect(result.errorCount).toBe(0);
    // 1 root + 2 sub-comps inspected
    expect(result.files.map((f) => f.file).sort()).toEqual([
      "compositions/scene-intro.html",
      "compositions/scene-outro.html",
      "index.html",
    ]);
    // Sub-comp false positives must not appear
    for (const file of result.files) {
      for (const f of file.findings) {
        expect(SUB_COMP_FALSE_POSITIVES.has(f.code)).toBe(false);
      }
    }
  });

  it("flags a sub-comp that has timing attributes but no class=\"clip\"", async () => {
    const dir = await scaffoldWithScenes();
    // Mutate scene-intro.html: drop `class="clip"` from a timed element.
    const broken = `<template id="bad-template">
  <div data-composition-id="bad" data-start="0" data-duration="3" data-width="1920" data-height="1080">
    <div data-start="0" data-duration="2" data-track-index="1">no class</div>
  </div>
</template>`;
    await writeFile(resolve(dir, "compositions/scene-bad.html"), broken, "utf-8");

    const result = await runProjectLint({ projectDir: dir });
    const badFile = result.files.find((f) => f.file.endsWith("scene-bad.html"))!;
    expect(badFile).toBeDefined();
    expect(badFile.findings.some((f) => f.code === "timed_element_missing_clip_class")).toBe(true);
  });

  it("--fix repairs timed_element_missing_clip_class and re-lint shows it gone", async () => {
    const dir = await scaffoldWithScenes();
    const broken = `<template id="bad-template">
  <div data-composition-id="bad" data-start="0" data-duration="3" data-width="1920" data-height="1080">
    <div data-start="0" data-duration="2" data-track-index="1">no class</div>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      window.__timelines["bad"] = tl;
    </script>
  </div>
</template>`;
    const badPath = resolve(dir, "compositions/scene-bad.html");
    await writeFile(badPath, broken, "utf-8");

    const result = await runProjectLint({ projectDir: dir, fix: true });

    // Fix tracked
    const fix = result.fixed.find((f) => f.file.endsWith("scene-bad.html"));
    expect(fix).toBeDefined();
    expect(fix!.codes).toContain("timed_element_missing_clip_class");

    // File on disk is updated
    const after = await readFile(badPath, "utf-8");
    expect(after).toContain('<div class="clip" data-start="0" data-duration="2"');

    // Re-lint result no longer reports it for that file
    const badFile = result.files.find((f) => f.file.endsWith("scene-bad.html"))!;
    expect(badFile.findings.some((f) => f.code === "timed_element_missing_clip_class")).toBe(false);
  });

  it("returns ok=true and empty findings on an empty root with no compositions/ dir", async () => {
    const dir = await makeTmp();
    await writeFile(resolve(dir, "index.html"), buildEmptyRootHtml({ aspect: "16:9", duration: 5 }), "utf-8");
    const result = await runProjectLint({ projectDir: dir });
    expect(result.ok).toBe(true);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].file).toBe("index.html");
  });

  it("does not flag a buildClipReference()-built clip in the root", async () => {
    const dir = await scaffoldWithScenes();
    // Produce one extra clip via the C2 helper just to be sure the produced
    // markup keeps lint clean.
    const root = await readFile(resolve(dir, "index.html"), "utf-8");
    const augmented = root.replace(
      "</div>\n\n    <script>",
      `  ${buildClipReference({ id: "extra", start: 7, duration: 2 })}\n    </div>\n\n    <script>`,
    );
    await writeFile(resolve(dir, "index.html"), augmented, "utf-8");
    // The extra clip references a non-existent composition file — that's a
    // semantic/runtime concern, not a lint rule. So lint should still pass.
    const result = await runProjectLint({ projectDir: dir });
    const rootFile = result.files.find((f) => f.file === "index.html")!;
    expect(rootFile.findings.some((f) => f.code === "timed_element_missing_clip_class")).toBe(false);
  });
});

