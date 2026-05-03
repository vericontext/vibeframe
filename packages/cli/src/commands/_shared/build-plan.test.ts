import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { createBuildPlan } from "./build-plan.js";
import { backdropCacheDescriptor, narrationCacheDescriptor } from "./build-cache.js";
import { writeAssetMetadata } from "./build-asset-metadata.js";
import { projectConfigJson } from "./project-config.js";

const ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ELEVENLABS_API_KEY",
  "FAL_API_KEY",
  "GOOGLE_API_KEY",
  "KLING_API_KEY",
  "OPENAI_API_KEY",
  "REPLICATE_API_TOKEN",
  "RUNWAY_API_SECRET",
  "XAI_API_KEY",
] as const;

let savedEnv: Record<string, string | undefined> = {};

async function makeProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vibe-build-plan-"));
  await mkdir(resolve(dir, "assets"), { recursive: true });
  await mkdir(resolve(dir, ".vibeframe"), { recursive: true });
  await writeFile(resolve(dir, ".vibeframe/config.yaml"), "providers: {}\n", "utf-8");
  await writeFile(
    resolve(dir, "vibe.config.json"),
    projectConfigJson({ name: "promo", aspect: "16:9" }),
    "utf-8"
  );
  await writeFile(
    resolve(dir, "STORYBOARD.md"),
    `# Promo

## Beat hook - Hook

\`\`\`yaml
duration: 4
narration: "Say the thing."
backdrop: "Clean product frame."
\`\`\`

Body.
`,
    "utf-8"
  );
  return dir;
}

describe("createBuildPlan", () => {
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of ENV_KEYS) process.env[key] = "";
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("reports missing generated assets and estimated cost", async () => {
    const dir = await makeProject();
    const plan = await createBuildPlan({ projectDir: dir, stage: "assets" });
    expect(plan.schemaVersion).toBe("1");
    expect(plan.kind).toBe("build-plan");
    expect(plan.status).toBe("ready");
    expect(plan.currentStage).toBe("assets");
    expect(plan.beats).toHaveLength(1);
    expect(plan.missing).toContain("assets");
    expect(plan.providers).toContain("kokoro");
    expect(plan.providers).toContain("openai");
    expect(plan.estimatedCostUsd).toBe(3);
    expect(plan.summary).toMatchObject({
      beats: 1,
      estimatedCostUsd: 3,
      validationErrors: 0,
      validationWarnings: 0,
    });
    expect(plan.warnings.some((warning) => warning.includes("--skip-backdrop"))).toBe(true);
    expect(plan.retryWith).toContain(`vibe build ${dir} --stage assets --skip-backdrop --json`);
    expect(plan.providerResolution).toEqual([
      expect.objectContaining({
        kind: "narration",
        requested: null,
        resolved: "kokoro",
        configured: true,
      }),
      expect.objectContaining({
        kind: "backdrop",
        requested: null,
        resolved: "openai",
        configured: false,
      }),
    ]);
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
    expect(plan.beats[0].assets.backdrop?.reason).toBe("canonical-unknown");
    expect(plan.warnings.some((warning) => warning.includes("freshness metadata"))).toBe(true);
  });

  it("treats canonical assets with matching metadata as fresh", async () => {
    const dir = await makeProject();
    const cache = narrationCacheDescriptor({
      beatId: "hook",
      cue: "Say the thing.",
      provider: "kokoro",
      ext: "wav",
    });
    await writeFile(resolve(dir, "assets/narration-hook.wav"), "fake", "utf-8");
    await writeAssetMetadata({
      projectDir: dir,
      kind: "narration",
      beatId: "hook",
      cue: "Say the thing.",
      provider: "kokoro",
      cacheKey: cache.key,
      canonicalPath: "assets/narration-hook.wav",
      cachePath: cache.path,
    });

    const plan = await createBuildPlan({ projectDir: dir, stage: "assets" });

    expect(plan.beats[0].assets.narration).toMatchObject({
      reason: "canonical-exists",
      freshness: "fresh",
      willGenerate: false,
    });
  });

  it("plans stale canonical assets for cache copy or regeneration", async () => {
    const dir = await makeProject();
    const oldCache = narrationCacheDescriptor({
      beatId: "hook",
      cue: "Old line.",
      provider: "kokoro",
      ext: "wav",
    });
    await writeFile(resolve(dir, "assets/narration-hook.wav"), "fake", "utf-8");
    await writeAssetMetadata({
      projectDir: dir,
      kind: "narration",
      beatId: "hook",
      cue: "Old line.",
      provider: "kokoro",
      cacheKey: oldCache.key,
      canonicalPath: "assets/narration-hook.wav",
      cachePath: oldCache.path,
    });

    const plan = await createBuildPlan({ projectDir: dir, stage: "assets" });

    expect(plan.beats[0].assets.narration).toMatchObject({
      reason: "canonical-stale",
      freshness: "stale",
      willGenerate: true,
    });
    expect(plan.missing).toContain("assets");
  });

  it("detects content cache hits without estimating provider cost", async () => {
    const dir = await makeProject();
    const narrationCache = narrationCacheDescriptor({
      beatId: "hook",
      cue: "Say the thing.",
      provider: "kokoro",
      ext: "wav",
    });
    const backdropCache = backdropCacheDescriptor({
      beatId: "hook",
      cue: "Clean product frame.",
      provider: "openai",
      quality: "hd",
      size: "1536x1024",
      ratio: "3:2",
    });
    await mkdir(dirname(resolve(dir, narrationCache.path)), { recursive: true });
    await writeFile(resolve(dir, narrationCache.path), "fake", "utf-8");
    await writeFile(resolve(dir, backdropCache.path), "fake", "utf-8");

    const plan = await createBuildPlan({ projectDir: dir, stage: "assets" });

    expect(plan.estimatedCostUsd).toBe(0);
    expect(plan.beats[0].assets.narration).toMatchObject({
      exists: false,
      cacheHit: true,
      willCopyFromCache: true,
      willGenerate: false,
      cachePath: narrationCache.path,
      cacheKey: narrationCache.key,
      reason: "content-cache-hit",
    });
    expect(plan.beats[0].assets.backdrop).toMatchObject({
      exists: false,
      cacheHit: true,
      willCopyFromCache: true,
      willGenerate: false,
      cachePath: backdropCache.path,
      cacheKey: backdropCache.key,
      reason: "content-cache-hit",
    });
  });

  it.each(["gemini", "grok"] as const)(
    "plans generated backdrop cues for supported %s build image provider",
    async (imageProvider) => {
      const dir = await makeProject();
      const plan = await createBuildPlan({ projectDir: dir, stage: "assets", imageProvider });

      expect(plan.status).toBe("ready");
      expect(plan.validation.ok).toBe(true);
      expect(plan.providers).toContain(imageProvider);
      expect(plan.providerResolution).toContainEqual(
        expect.objectContaining({
          kind: "backdrop",
          requested: imageProvider,
          resolved: imageProvider,
        })
      );
      expect(plan.beats[0].assets.backdrop).toMatchObject({
        provider: imageProvider,
        willGenerate: true,
        reason: "missing",
      });
      expect(plan.validation.issues).not.toContainEqual(
        expect.objectContaining({ code: "UNSUPPORTED_BUILD_IMAGE_PROVIDER" })
      );
    }
  );

  it("invalidates generated backdrop cues when the build image provider is not supported", async () => {
    const dir = await makeProject();
    const plan = await createBuildPlan({
      projectDir: dir,
      stage: "assets",
      imageProvider: "runway",
    });

    expect(plan.status).toBe("invalid");
    expect(plan.validation.ok).toBe(false);
    expect(plan.validation.issues).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "UNSUPPORTED_BUILD_IMAGE_PROVIDER",
        beatId: "hook",
      })
    );
    expect(plan.retryWith).toContain(
      `vibe build ${dir} --stage assets --image-provider openai --json`
    );
    expect(plan.nextCommands).toEqual(plan.retryWith);
    expect(plan.warnings).not.toContain(
      "Backdrop generation will need runway (OPENAI_API_KEY), but no key/config is available."
    );
  });

  it("plans generic asset references without provider cost", async () => {
    const dir = await makeProject();
    await writeFile(resolve(dir, "assets/source.png"), "fake", "utf-8");
    await writeFile(
      resolve(dir, "STORYBOARD.md"),
      `# Promo

## Beat hook - Hook

\`\`\`yaml
duration: 4
asset: "assets/source.png"
\`\`\`
`,
      "utf-8"
    );

    const plan = await createBuildPlan({
      projectDir: dir,
      stage: "assets",
      imageProvider: "gemini",
    });

    expect(plan.status).toBe("ready");
    expect(plan.estimatedCostUsd).toBe(0);
    expect(plan.providers).not.toContain("openai");
    expect(plan.validation.issues).not.toContainEqual(
      expect.objectContaining({ code: "UNSUPPORTED_BUILD_IMAGE_PROVIDER" })
    );
    expect(plan.providerResolution).not.toContainEqual(
      expect.objectContaining({ kind: "backdrop" })
    );
    expect(plan.beats[0].assets.backdrop).toMatchObject({
      provider: "local",
      path: "assets/source.png",
      sourcePath: "assets/source.png",
      exists: true,
      willGenerate: false,
      reason: "referenced-asset",
    });
  });

  it("plans typed narration audio references without resolving TTS", async () => {
    const dir = await makeProject();
    await writeFile(resolve(dir, "assets/voice.wav"), "fake", "utf-8");
    await writeFile(
      resolve(dir, "STORYBOARD.md"),
      `# Promo

## Beat hook - Hook

\`\`\`yaml
narration: "assets/voice.wav"
\`\`\`
`,
      "utf-8"
    );

    const plan = await createBuildPlan({ projectDir: dir, stage: "assets" });

    expect(plan.estimatedCostUsd).toBe(0);
    expect(plan.providers).not.toContain("kokoro");
    expect(plan.providerResolution).toEqual([]);
    expect(plan.beats[0].assets.narration).toMatchObject({
      provider: "local",
      path: "assets/voice.wav",
      sourcePath: "assets/voice.wav",
      exists: true,
      willGenerate: false,
      reason: "referenced-asset",
    });
  });

  it("flags invalid asset references before provider planning", async () => {
    const dir = await makeProject();
    await writeFile(
      resolve(dir, "STORYBOARD.md"),
      `# Promo

## Beat hook - Hook

\`\`\`yaml
backdrop: "../outside.png"
\`\`\`
`,
      "utf-8"
    );

    const plan = await createBuildPlan({ projectDir: dir, stage: "assets" });

    expect(plan.missing).toContain("assets");
    expect(plan.providers).not.toContain("openai");
    expect(plan.warnings).toContain(
      'Asset reference "../outside.png" must stay inside the project directory.'
    );
    expect(plan.beats[0].assets.backdrop).toMatchObject({
      provider: "local",
      sourcePath: "../outside.png",
      exists: false,
      willGenerate: false,
      reason: "invalid-reference",
      referenceError: 'Asset reference "../outside.png" must stay inside the project directory.',
    });
  });

  it("plans regeneration when force is set even if the content cache exists", async () => {
    const dir = await makeProject();
    const backdropCache = backdropCacheDescriptor({
      beatId: "hook",
      cue: "Clean product frame.",
      provider: "openai",
      quality: "hd",
      size: "1536x1024",
      ratio: "3:2",
    });
    await mkdir(dirname(resolve(dir, backdropCache.path)), { recursive: true });
    await writeFile(resolve(dir, backdropCache.path), "fake", "utf-8");

    const plan = await createBuildPlan({ projectDir: dir, stage: "assets", force: true });

    expect(plan.beats[0].assets.backdrop).toMatchObject({
      cacheHit: true,
      willCopyFromCache: false,
      willGenerate: true,
      reason: "force",
    });
    expect(plan.estimatedCostUsd).toBe(3);
  });

  it("plans video and music cue assets with provider overrides", async () => {
    const dir = await makeProject();
    await writeFile(
      resolve(dir, "STORYBOARD.md"),
      `# Promo

## Beat hook - Hook

\`\`\`yaml
video: "Slow product camera push."
music: "Minimal confident pulse."
\`\`\`
`,
      "utf-8"
    );

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
    await writeFile(
      resolve(dir, "STORYBOARD.md"),
      `# Promo

## Beat hook - Hook

\`\`\`yaml
duration: -3
narration: "Say the thing."
\`\`\`

Body.
`,
      "utf-8"
    );

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
