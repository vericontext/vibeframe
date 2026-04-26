import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { scaffoldSceneProject } from "./_shared/scene-project.js";
import { executeSceneAdd } from "./scene.js";

async function pathExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

async function makeProject(label = "vibe-scene-add-test-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), label));
  await scaffoldSceneProject({ dir, name: "fixture", aspect: "16:9", duration: 10 });
  return dir;
}

describe("executeSceneAdd — offline (--no-audio --no-image)", () => {
  it("emits scene HTML and inserts a clip into the root", async () => {
    const projectDir = await makeProject();

    const result = await executeSceneAdd({
      name: "Intro Scene",
      preset: "announcement",
      headline: "Welcome",
      duration: 4,
      projectDir,
      skipAudio: true,
      skipImage: true,
    });

    expect(result.success).toBe(true);
    expect(result.id).toBe("intro-scene");
    expect(result.start).toBe(0);
    expect(result.duration).toBe(4);
    expect(result.audioPath).toBeUndefined();
    expect(result.imagePath).toBeUndefined();

    // Scene file written
    const scenePath = resolve(projectDir, "compositions/scene-intro-scene.html");
    expect(await pathExists(scenePath)).toBe(true);
    const sceneHtml = await readFile(scenePath, "utf-8");
    expect(sceneHtml).toContain('data-composition-id="intro-scene"');
    expect(sceneHtml).toContain("Welcome");
    expect(sceneHtml).not.toContain("<audio");
    expect(sceneHtml).not.toContain("background-image: url(");

    // Root updated with the clip ref
    const rootHtml = await readFile(resolve(projectDir, "index.html"), "utf-8");
    expect(rootHtml).toContain('data-composition-src="compositions/scene-intro-scene.html"');
    expect(rootHtml).toContain('data-start="0"');
    expect(rootHtml).toContain('data-duration="4"');
  });

  it("appends multiple scenes sequentially with running start times", async () => {
    const projectDir = await makeProject();

    const a = await executeSceneAdd({
      name: "intro", preset: "simple", duration: 3, projectDir, skipAudio: true, skipImage: true,
    });
    expect(a.success).toBe(true);
    expect(a.start).toBe(0);

    const b = await executeSceneAdd({
      name: "outro", preset: "simple", duration: 2, projectDir, skipAudio: true, skipImage: true,
    });
    expect(b.success).toBe(true);
    // Crossfade architecture: second scene starts 0.4 s before the first
    // ends so the two clips overlap by SCENE_OVERLAP_SECONDS in the parent
    // timeline. Adjacent clips alternate track-index to keep the
    // Hyperframes overlap-on-same-track linter happy.
    expect(b.start).toBeCloseTo(2.6, 5);

    const root = await readFile(resolve(projectDir, "index.html"), "utf-8");
    expect(root).toContain('data-composition-src="compositions/scene-intro.html"');
    expect(root).toContain('data-composition-src="compositions/scene-outro.html"');
  });

  it("uses the narration text as the subhead even when --no-audio is set", async () => {
    const projectDir = await makeProject();

    const result = await executeSceneAdd({
      name: "explain",
      preset: "explainer",
      narration: "VibeFrame turns YAML into MP4s.",
      duration: 5,
      projectDir,
      skipAudio: true,
      skipImage: true,
    });

    expect(result.success).toBe(true);
    const html = await readFile(resolve(projectDir, "compositions/scene-explain.html"), "utf-8");
    expect(html).toContain("VibeFrame turns YAML into MP4s.");
    expect(html).not.toContain("<audio"); // skipAudio honored
  });

  it("falls back to vibe.project.yaml defaultSceneDuration when neither --duration nor narration audio is available", async () => {
    const projectDir = await makeProject();

    const result = await executeSceneAdd({
      name: "default-dur",
      preset: "simple",
      projectDir,
      skipAudio: true,
      skipImage: true,
    });

    expect(result.success).toBe(true);
    expect(result.duration).toBe(5); // defaultSceneDuration in defaultVibeProjectConfig
  });

  it("refuses to overwrite an existing scene unless --force is passed", async () => {
    const projectDir = await makeProject();

    const first = await executeSceneAdd({
      name: "intro", preset: "simple", duration: 3, projectDir, skipAudio: true, skipImage: true,
    });
    expect(first.success).toBe(true);

    const second = await executeSceneAdd({
      name: "intro", preset: "simple", duration: 3, projectDir, skipAudio: true, skipImage: true,
    });
    expect(second.success).toBe(false);
    expect(second.error).toMatch(/already exists/);

    const forced = await executeSceneAdd({
      name: "intro", preset: "simple", duration: 3, projectDir, skipAudio: true, skipImage: true, force: true,
    });
    expect(forced.success).toBe(true);
  });

  it("returns a structured error when the root composition is missing", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "vibe-scene-noroot-"));

    const result = await executeSceneAdd({
      name: "x", preset: "simple", duration: 3, projectDir, skipAudio: true, skipImage: true,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Root composition not found/);
  });

  it("emits canvas dims that match the project aspect", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vibe-scene-vertical-"));
    await scaffoldSceneProject({ dir, name: "vert", aspect: "9:16", duration: 8 });

    const result = await executeSceneAdd({
      name: "hook", preset: "simple", duration: 3, projectDir: dir, skipAudio: true, skipImage: true,
    });
    expect(result.success).toBe(true);
    const html = await readFile(resolve(dir, "compositions/scene-hook.html"), "utf-8");
    expect(html).toContain('data-width="1080"');
    expect(html).toContain('data-height="1920"');
  });
});

describe("executeSceneAdd — narration-file path", () => {
  it("copies an external wav into assets/ and skips TTS", async () => {
    const projectDir = await makeProject();
    // Minimal valid 8-byte stub — getAudioDuration may fail on non-real wav
    // but the pathway under test is just file copy + skip-TTS.
    const externalWav = join(projectDir, "external.wav");
    await writeFile(externalWav, Buffer.from([82, 73, 70, 70, 0, 0, 0, 0]));

    const result = await executeSceneAdd({
      name: "from-file",
      preset: "simple",
      narrationFile: externalWav,
      duration: 4,
      projectDir,
      skipImage: true,
      skipTranscribe: true,
    });

    expect(result.success).toBe(true);
    expect(result.audioPath).toBeDefined();
    const copied = resolve(projectDir, "assets/narration-from-file.wav");
    expect(await pathExists(copied)).toBe(true);
  });

  it("returns an error for missing narration file", async () => {
    const projectDir = await makeProject();
    const result = await executeSceneAdd({
      name: "x",
      preset: "simple",
      narrationFile: "/does/not/exist.wav",
      duration: 3,
      projectDir,
      skipImage: true,
      skipTranscribe: true,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Narration file not found/);
  });

  it("rejects unsupported audio extensions", async () => {
    const projectDir = await makeProject();
    const externalFlac = join(projectDir, "audio.flac");
    await writeFile(externalFlac, Buffer.from([1, 2, 3]));

    const result = await executeSceneAdd({
      name: "x",
      preset: "simple",
      narrationFile: externalFlac,
      duration: 3,
      projectDir,
      skipImage: true,
      skipTranscribe: true,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unsupported narration file extension/);
  });
});

describe("executeSceneAdd — transcribe", () => {
  it("does not emit transcript when skipTranscribe is true", async () => {
    const projectDir = await makeProject();
    const externalWav = join(projectDir, "ext.wav");
    await writeFile(externalWav, Buffer.from([82, 73, 70, 70, 0, 0, 0, 0]));

    const result = await executeSceneAdd({
      name: "no-transcribe",
      preset: "simple",
      narrationFile: externalWav,
      duration: 3,
      projectDir,
      skipImage: true,
      skipTranscribe: true,
    });

    expect(result.success).toBe(true);
    expect(result.transcriptPath).toBeUndefined();
    expect(result.transcriptWordCount).toBeUndefined();
    const transcriptFile = resolve(projectDir, "assets/transcript-no-transcribe.json");
    expect(await pathExists(transcriptFile)).toBe(false);
  });

  it("does not emit transcript when there's no audio to transcribe", async () => {
    const projectDir = await makeProject();

    const result = await executeSceneAdd({
      name: "silent",
      preset: "simple",
      duration: 3,
      projectDir,
      skipAudio: true,
      skipImage: true,
    });

    expect(result.success).toBe(true);
    expect(result.transcriptPath).toBeUndefined();
  });
});
