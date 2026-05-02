import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createBuildPlan } from "./build-plan.js";
import { projectConfigJson } from "./project-config.js";

async function makeProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vibe-build-plan-"));
  await mkdir(resolve(dir, "assets"), { recursive: true });
  await writeFile(resolve(dir, "vibe.config.json"), projectConfigJson({ name: "promo", aspect: "16:9" }), "utf-8");
  await writeFile(resolve(dir, "STORYBOARD.md"), `# Promo

## Beat hook - Hook

\`\`\`yaml
duration: 4
narration: "Say the thing."
backdrop: "Clean product frame."
\`\`\`

Body.
`, "utf-8");
  return dir;
}

describe("createBuildPlan", () => {
  it("reports missing generated assets and estimated cost", async () => {
    const dir = await makeProject();
    const plan = await createBuildPlan({ projectDir: dir, stage: "assets" });
    expect(plan.schemaVersion).toBe("1");
    expect(plan.kind).toBe("build-plan");
    expect(plan.status).toBe("ready");
    expect(plan.currentStage).toBe("assets");
    expect(plan.beats).toHaveLength(1);
    expect(plan.missing).toContain("assets");
    expect(plan.providers).toContain("auto-tts");
    expect(plan.providers).toContain("openai");
    expect(plan.estimatedCostUsd).toBe(3.05);
    expect(plan.summary).toMatchObject({
      beats: 1,
      estimatedCostUsd: 3.05,
      validationErrors: 0,
      validationWarnings: 0,
    });
    expect(plan.nextCommands).toContain(`vibe build ${dir} --stage assets --json`);
  });

  it("does not estimate cost for cached assets", async () => {
    const dir = await makeProject();
    await writeFile(resolve(dir, "assets/narration-hook.mp3"), "fake", "utf-8");
    await writeFile(resolve(dir, "assets/backdrop-hook.png"), "fake", "utf-8");
    const plan = await createBuildPlan({ projectDir: dir, stage: "assets" });
    expect(plan.estimatedCostUsd).toBe(0);
    expect(plan.beats[0].assets.narration?.exists).toBe(true);
    expect(plan.beats[0].assets.backdrop?.exists).toBe(true);
  });

  it("plans video and music cue assets with provider overrides", async () => {
    const dir = await makeProject();
    await writeFile(resolve(dir, "STORYBOARD.md"), `# Promo

## Beat hook - Hook

\`\`\`yaml
video: "Slow product camera push."
music: "Minimal confident pulse."
\`\`\`
`, "utf-8");

    const plan = await createBuildPlan({
      projectDir: dir,
      stage: "assets",
      videoProvider: "runway",
      musicProvider: "replicate",
    });

    expect(plan.missing).toContain("assets");
    expect(plan.providers).toContain("runway");
    expect(plan.providers).toContain("replicate");
    expect(plan.beats[0].assets.video?.path).toBe("assets/video-hook.mp4");
    expect(plan.beats[0].assets.music?.path).toBe("assets/music-hook.mp3");
    expect(plan.estimatedCostUsd).toBe(5.5);
  });

  it("returns an invalid plan with validation recovery commands", async () => {
    const dir = await makeProject();
    await writeFile(resolve(dir, "STORYBOARD.md"), `# Promo

## Beat hook - Hook

\`\`\`yaml
duration: -3
narration: "Say the thing."
\`\`\`

Body.
`, "utf-8");

    const plan = await createBuildPlan({ projectDir: dir, stage: "assets" });

    expect(plan.status).toBe("invalid");
    expect(plan.validation.ok).toBe(false);
    expect(plan.summary.validationErrors).toBe(1);
    expect(plan.validation.issues).toEqual([
      expect.objectContaining({ severity: "error", code: "INVALID_DURATION", beatId: "hook" }),
    ]);
    expect(plan.retryWith).toEqual([
      `vibe storyboard validate ${dir} --json`,
      `vibe storyboard revise ${dir} --from "<request>" --dry-run --json`,
    ]);
    expect(plan.nextCommands).toEqual(plan.retryWith);
  });
});
