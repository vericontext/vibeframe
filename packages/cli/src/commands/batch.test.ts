import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
} from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

const CLI = `npx tsx ${resolve(__dirname, "../index.ts")}`;

describe("batch commands", () => {
  let tempDir: string;
  let projectFile: string;
  let mediaDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "vibe-batch-test-"));
    projectFile = join(tempDir, "test.vibe.json");
    mediaDir = join(tempDir, "media");
    mkdirSync(mediaDir);

    // Create project
    execSync(`${CLI} project create "Batch Test" -o "${projectFile}"`, {
      cwd: process.cwd(),
      encoding: "utf-8",
    });

    // Create dummy media files
    writeFileSync(join(mediaDir, "clip1.mp4"), "dummy video 1");
    writeFileSync(join(mediaDir, "clip2.mp4"), "dummy video 2");
    writeFileSync(join(mediaDir, "clip3.mp4"), "dummy video 3");
    writeFileSync(join(mediaDir, "audio.mp3"), "dummy audio");
    writeFileSync(join(mediaDir, "image.jpg"), "dummy image");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("batch import", () => {
    it("imports all media files from directory", () => {
      execSync(`${CLI} batch import "${projectFile}" "${mediaDir}"`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.sources).toHaveLength(5);
    });

    it("filters files by extension", () => {
      execSync(
        `${CLI} batch import "${projectFile}" "${mediaDir}" --filter ".mp4"`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.sources).toHaveLength(3);
      expect(content.state.sources.every((s: any) => s.name.endsWith(".mp4"))).toBe(
        true
      );
    });

    it("imports recursively", () => {
      // Create subdirectory with media
      const subDir = join(mediaDir, "subdir");
      mkdirSync(subDir);
      writeFileSync(join(subDir, "nested.mp4"), "nested video");

      execSync(`${CLI} batch import "${projectFile}" "${mediaDir}" -r`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.sources).toHaveLength(6);
    });
  });

  describe("batch concat", () => {
    let sourceIds: string[];

    beforeEach(() => {
      // Import media first
      execSync(
        `${CLI} batch import "${projectFile}" "${mediaDir}" --filter ".mp4"`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      // Set durations for sources
      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      content.state.sources.forEach((s: any, i: number) => {
        s.duration = 5 + i; // 5, 6, 7 seconds
      });
      writeFileSync(projectFile, JSON.stringify(content, null, 2), "utf-8");

      sourceIds = content.state.sources.map((s: any) => s.id);
    });

    it("concatenates all sources", () => {
      execSync(`${CLI} batch concat "${projectFile}" --all`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.clips).toHaveLength(3);

      // Check sequential positioning
      const clips = content.state.clips;
      expect(clips[0].startTime).toBe(0);
      expect(clips[1].startTime).toBe(clips[0].duration);
      expect(clips[2].startTime).toBe(clips[0].duration + clips[1].duration);
    });

    it("concatenates with gap between clips", () => {
      execSync(`${CLI} batch concat "${projectFile}" --all --gap 2`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      const clips = content.state.clips;

      expect(clips[1].startTime).toBe(clips[0].duration + 2);
    });

    it("concatenates from specific start time", () => {
      execSync(`${CLI} batch concat "${projectFile}" --all --start 10`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.clips[0].startTime).toBe(10);
    });
  });

  describe("batch apply-effect", () => {
    let clipIds: string[];

    beforeEach(() => {
      // Import and concat
      execSync(
        `${CLI} batch import "${projectFile}" "${mediaDir}" --filter ".mp4"`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      let content = JSON.parse(readFileSync(projectFile, "utf-8"));
      content.state.sources.forEach((s: any) => {
        s.duration = 5;
      });
      writeFileSync(projectFile, JSON.stringify(content, null, 2), "utf-8");

      execSync(`${CLI} batch concat "${projectFile}" --all`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      content = JSON.parse(readFileSync(projectFile, "utf-8"));
      clipIds = content.state.clips.map((c: any) => c.id);
    });

    it("applies effect to all clips", () => {
      execSync(`${CLI} batch apply-effect "${projectFile}" fadeIn --all`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.clips[0].effects).toHaveLength(1);
      expect(content.state.clips[1].effects).toHaveLength(1);
      expect(content.state.clips[2].effects).toHaveLength(1);
      expect(content.state.clips[0].effects[0].type).toBe("fadeIn");
    });

    it("applies effect with custom duration", () => {
      execSync(
        `${CLI} batch apply-effect "${projectFile}" fadeOut --all -d 2`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.clips[0].effects[0].duration).toBe(2);
    });

    it("applies effect to specific clips", () => {
      execSync(
        `${CLI} batch apply-effect "${projectFile}" blur ${clipIds[0]} ${clipIds[2]}`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.clips[0].effects).toHaveLength(1);
      expect(content.state.clips[1].effects).toHaveLength(0);
      expect(content.state.clips[2].effects).toHaveLength(1);
    });
  });

  describe("batch remove-clips", () => {
    beforeEach(() => {
      // Import and concat
      execSync(
        `${CLI} batch import "${projectFile}" "${mediaDir}" --filter ".mp4"`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      let content = JSON.parse(readFileSync(projectFile, "utf-8"));
      content.state.sources.forEach((s: any) => {
        s.duration = 5;
      });
      writeFileSync(projectFile, JSON.stringify(content, null, 2), "utf-8");

      execSync(`${CLI} batch concat "${projectFile}" --all`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });
    });

    it("removes all clips", () => {
      const before = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(before.state.clips).toHaveLength(3);

      execSync(`${CLI} batch remove-clips "${projectFile}" --all`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.clips).toHaveLength(0);
    });

    it("removes specific clips", () => {
      const before = JSON.parse(readFileSync(projectFile, "utf-8"));
      const clipId = before.state.clips[0].id;

      execSync(`${CLI} batch remove-clips "${projectFile}" ${clipId}`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.clips).toHaveLength(2);
    });
  });

  describe("batch info", () => {
    beforeEach(() => {
      // Import and concat
      execSync(
        `${CLI} batch import "${projectFile}" "${mediaDir}" --filter ".mp4"`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      let content = JSON.parse(readFileSync(projectFile, "utf-8"));
      content.state.sources.forEach((s: any) => {
        s.duration = 5;
      });
      writeFileSync(projectFile, JSON.stringify(content, null, 2), "utf-8");

      execSync(`${CLI} batch concat "${projectFile}" --all`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });
    });

    it("shows project statistics", () => {
      const output = execSync(`${CLI} batch info "${projectFile}"`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      expect(output).toContain("Sources:");
      expect(output).toContain("Clips:");
      expect(output).toContain("Timeline:");
      expect(output).toContain("3"); // 3 sources/clips
    });
  });
});
