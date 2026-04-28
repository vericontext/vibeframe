import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getComposePrompts } from "./compose-prompts.js";

describe("getComposePrompts", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "compose-prompts-test-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function seed(opts: { storyboard?: string; design?: string; withSkill?: boolean } = {}): void {
    writeFileSync(
      join(projectDir, "DESIGN.md"),
      opts.design ?? "# Design\n\n## Palette\n- `#000000`\n",
      "utf-8",
    );
    writeFileSync(
      join(projectDir, "STORYBOARD.md"),
      opts.storyboard
        ?? "**Format:** 1920x1080\n\n## Beat hook — Hook (0–3s)\n\nbody1\n\n## Beat outro — Outro (3–6s)\n\nbody2\n",
      "utf-8",
    );
    if (opts.withSkill) {
      writeFileSync(
        join(projectDir, "SKILL.md"),
        "---\nname: hyperframes\n---\nFRAMEWORK RULES",
        "utf-8",
      );
    }
  }

  it("returns one entry per beat with userPrompt + outputPath when storyboard is well-formed", async () => {
    seed({ withSkill: true });
    const r = await getComposePrompts({ projectDir });

    expect(r.success).toBe(true);
    expect(r.beats).toHaveLength(2);
    expect(r.beats[0].id).toBe("hook");
    expect(r.beats[0].outputPath).toBe("compositions/scene-hook.html");
    expect(r.beats[0].userPrompt).toContain("compositions/scene-hook.html");
    expect(r.beats[0].userPrompt).toContain('data-composition-id="scene-hook"');
    expect(r.beats[1].id).toBe("outro");
    expect(r.beats[1].outputPath).toBe("compositions/scene-outro.html");
  });

  it("does not call any LLM (function is purely synchronous I/O)", async () => {
    // Indirect proof: providing zero API keys should not affect anything.
    const originalEnv = { ...process.env };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    try {
      seed({ withSkill: true });
      const r = await getComposePrompts({ projectDir });
      expect(r.success).toBe(true);
      expect(r.beats).toHaveLength(2);
    } finally {
      process.env = originalEnv;
    }
  });

  it("flags compositions that already exist on disk", async () => {
    seed({ withSkill: true });
    mkdirSync(join(projectDir, "compositions"), { recursive: true });
    writeFileSync(join(projectDir, "compositions/scene-hook.html"), "<existing/>", "utf-8");

    const r = await getComposePrompts({ projectDir });
    expect(r.beats[0].exists).toBe(true);
    expect(r.beats[1].exists).toBe(false);
  });

  it("filters to a single beat when beatId is set", async () => {
    seed({ withSkill: true });
    const r = await getComposePrompts({ projectDir, beatId: "outro" });
    expect(r.success).toBe(true);
    expect(r.beats).toHaveLength(1);
    expect(r.beats[0].id).toBe("outro");
  });

  it("returns an error when beatId doesn't match", async () => {
    seed({ withSkill: true });
    const r = await getComposePrompts({ projectDir, beatId: "nope" });
    expect(r.success).toBe(false);
    expect(r.error).toContain('Beat "nope" not found');
    expect(r.error).toContain("hook");
    expect(r.error).toContain("outro");
  });

  it("warns + skillReference=null when SKILL.md isn't installed", async () => {
    seed({ withSkill: false });
    const r = await getComposePrompts({ projectDir });
    expect(r.success).toBe(true);
    expect(r.skillReference).toBeNull();
    expect(r.warnings.some((w) => w.includes("install-skill"))).toBe(true);
    // Instructions tell the agent to install the skill first
    expect(r.instructions[0]).toContain("install-skill");
  });

  it("populates skillReference + lint-friendly instructions when SKILL.md is installed", async () => {
    seed({ withSkill: true });
    const r = await getComposePrompts({ projectDir });
    expect(r.skillReference).toBe("SKILL.md");
    expect(r.warnings).toEqual([]);
    expect(r.instructions[0]).toContain("SKILL.md");
    expect(r.instructions.some((l) => l.includes("scene lint"))).toBe(true);
    expect(r.instructions.some((l) => l.includes("scene render"))).toBe(true);
  });

  it("returns failure when DESIGN.md is missing", async () => {
    writeFileSync(join(projectDir, "STORYBOARD.md"), "## Beat 1 — x\nbody\n");
    const r = await getComposePrompts({ projectDir });
    expect(r.success).toBe(false);
    expect(r.error).toContain("DESIGN.md not found");
    expect(r.beats).toEqual([]);
  });

  it("returns failure when STORYBOARD.md is missing", async () => {
    writeFileSync(join(projectDir, "DESIGN.md"), "# d");
    const r = await getComposePrompts({ projectDir });
    expect(r.success).toBe(false);
    expect(r.error).toContain("STORYBOARD.md not found");
  });

  it("returns failure when STORYBOARD.md has no beats", async () => {
    seed({ storyboard: "Just prose, no headings.\n", withSkill: true });
    const r = await getComposePrompts({ projectDir });
    expect(r.success).toBe(false);
    expect(r.error).toContain("no `## Beat …` headings");
  });

  it("surfaces beat duration from cue YAML when present", async () => {
    seed({
      withSkill: true,
      storyboard: [
        "**Format:** 1920x1080",
        "",
        "## Beat hook — Hook",
        "",
        "```yaml",
        'narration: "Type a YAML."',
        "duration: 3",
        "```",
        "",
        "Cold open body.",
        "",
      ].join("\n"),
    });
    const r = await getComposePrompts({ projectDir });
    expect(r.beats[0].duration).toBe(3);
    expect(r.beats[0].cues).toMatchObject({ narration: "Type a YAML.", duration: 3 });
  });

  it("returns the bundle version (matches loadHyperframesSkillBundle / install-skill)", async () => {
    seed({ withSkill: true });
    const r = await getComposePrompts({ projectDir });
    expect(r.bundleVersion).toMatch(/^[0-9a-f]+-\d{4}-\d{2}-\d{2}$/);
  });
});
