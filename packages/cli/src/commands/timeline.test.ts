import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

const CLI = `npx tsx ${resolve(__dirname, "../index.ts")}`;

describe("timeline commands", () => {
  let tempDir: string;
  let projectFile: string;
  let mediaFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "vibe-test-"));
    projectFile = join(tempDir, "test.vibe.json");
    mediaFile = join(tempDir, "sample.mp4");

    // Create project
    execSync(`${CLI} project create "Timeline Test" -o "${projectFile}"`, {
      cwd: process.cwd(),
      encoding: "utf-8",
    });

    // Create dummy media file
    writeFileSync(mediaFile, "dummy video content");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("timeline add-source", () => {
    it("adds a media source to project", () => {
      execSync(
        `${CLI} timeline add-source "${projectFile}" "${mediaFile}" --duration 10`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.sources).toHaveLength(1);
      expect(content.state.sources[0].name).toBe("sample.mp4");
      expect(content.state.sources[0].type).toBe("video");
      expect(content.state.sources[0].duration).toBe(10);
    });

    it("adds source with custom name", () => {
      execSync(
        `${CLI} timeline add-source "${projectFile}" "${mediaFile}" -n "My Video" -d 5`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.sources[0].name).toBe("My Video");
    });

    it("detects media type from extension", () => {
      const audioFile = join(tempDir, "audio.mp3");
      writeFileSync(audioFile, "dummy audio");

      execSync(
        `${CLI} timeline add-source "${projectFile}" "${audioFile}" -d 30`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.sources[0].type).toBe("audio");
    });
  });

  describe("timeline add-clip", () => {
    let sourceId: string;

    beforeEach(() => {
      execSync(
        `${CLI} timeline add-source "${projectFile}" "${mediaFile}" -d 10`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      sourceId = content.state.sources[0].id;
    });

    it("adds a clip to timeline", () => {
      execSync(`${CLI} timeline add-clip "${projectFile}" ${sourceId}`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.clips).toHaveLength(1);
      expect(content.state.clips[0].sourceId).toBe(sourceId);
      expect(content.state.clips[0].trackId).toBe("video-track-1");
    });

    it("adds clip with custom start time", () => {
      execSync(
        `${CLI} timeline add-clip "${projectFile}" ${sourceId} --start 5`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.clips[0].startTime).toBe(5);
    });

    it("adds clip with custom duration", () => {
      execSync(
        `${CLI} timeline add-clip "${projectFile}" ${sourceId} --duration 3`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.clips[0].duration).toBe(3);
    });

    it("updates project duration after adding clip", () => {
      execSync(
        `${CLI} timeline add-clip "${projectFile}" ${sourceId} --start 5 --duration 10`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.project.duration).toBe(15);
    });
  });

  describe("timeline add-track", () => {
    it("adds a video track", () => {
      execSync(`${CLI} timeline add-track "${projectFile}" video`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.tracks).toHaveLength(3);
      expect(content.state.tracks[2].type).toBe("video");
      expect(content.state.tracks[2].name).toBe("Video 2");
    });

    it("adds an audio track", () => {
      execSync(`${CLI} timeline add-track "${projectFile}" audio`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.tracks).toHaveLength(3);
      expect(content.state.tracks[2].type).toBe("audio");
    });

    it("adds track with custom name", () => {
      execSync(
        `${CLI} timeline add-track "${projectFile}" video -n "Overlay"`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.tracks[2].name).toBe("Overlay");
    });
  });

  describe("timeline add-effect", () => {
    let clipId: string;

    beforeEach(() => {
      execSync(
        `${CLI} timeline add-source "${projectFile}" "${mediaFile}" -d 10`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      let content = JSON.parse(readFileSync(projectFile, "utf-8"));
      const sourceId = content.state.sources[0].id;

      execSync(`${CLI} timeline add-clip "${projectFile}" ${sourceId}`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      content = JSON.parse(readFileSync(projectFile, "utf-8"));
      clipId = content.state.clips[0].id;
    });

    it("adds fadeIn effect to clip", () => {
      execSync(
        `${CLI} timeline add-effect "${projectFile}" ${clipId} fadeIn`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.clips[0].effects).toHaveLength(1);
      expect(content.state.clips[0].effects[0].type).toBe("fadeIn");
    });

    it("adds effect with custom duration", () => {
      execSync(
        `${CLI} timeline add-effect "${projectFile}" ${clipId} fadeOut --duration 2`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.clips[0].effects[0].duration).toBe(2);
    });

    it("adds multiple effects to same clip", () => {
      execSync(
        `${CLI} timeline add-effect "${projectFile}" ${clipId} fadeIn`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );
      execSync(
        `${CLI} timeline add-effect "${projectFile}" ${clipId} fadeOut`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.clips[0].effects).toHaveLength(2);
    });
  });

  describe("timeline trim", () => {
    let clipId: string;

    beforeEach(() => {
      execSync(
        `${CLI} timeline add-source "${projectFile}" "${mediaFile}" -d 10`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      let content = JSON.parse(readFileSync(projectFile, "utf-8"));
      const sourceId = content.state.sources[0].id;

      execSync(
        `${CLI} timeline add-clip "${projectFile}" ${sourceId} --duration 10`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      content = JSON.parse(readFileSync(projectFile, "utf-8"));
      clipId = content.state.clips[0].id;
    });

    it("trims clip duration", () => {
      execSync(
        `${CLI} timeline trim "${projectFile}" ${clipId} --duration 5`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.clips[0].duration).toBe(5);
    });

    it("trims clip start", () => {
      execSync(
        `${CLI} timeline trim "${projectFile}" ${clipId} --start 2`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.clips[0].startTime).toBe(2);
    });
  });

  describe("timeline list", () => {
    beforeEach(() => {
      execSync(
        `${CLI} timeline add-source "${projectFile}" "${mediaFile}" -d 10`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      const sourceId = content.state.sources[0].id;

      execSync(`${CLI} timeline add-clip "${projectFile}" ${sourceId}`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });
    });

    it("lists all timeline contents", () => {
      const output = execSync(`${CLI} timeline list "${projectFile}"`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      expect(output).toContain("Sources");
      expect(output).toContain("sample.mp4");
      expect(output).toContain("Tracks");
      expect(output).toContain("Video 1");
      expect(output).toContain("Clips");
    });

    it("lists only sources", () => {
      const output = execSync(
        `${CLI} timeline list "${projectFile}" --sources`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      expect(output).toContain("Sources");
      expect(output).toContain("sample.mp4");
      expect(output).not.toContain("Tracks");
      expect(output).not.toContain("Clips");
    });

    it("lists only tracks", () => {
      const output = execSync(
        `${CLI} timeline list "${projectFile}" --tracks`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      expect(output).toContain("Tracks");
      expect(output).toContain("Video 1");
      expect(output).not.toContain("Sources");
      expect(output).not.toContain("Clips");
    });
  });

  describe("timeline split", () => {
    let clipId: string;

    beforeEach(() => {
      execSync(
        `${CLI} timeline add-source "${projectFile}" "${mediaFile}" -d 10`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      let content = JSON.parse(readFileSync(projectFile, "utf-8"));
      const sourceId = content.state.sources[0].id;

      execSync(
        `${CLI} timeline add-clip "${projectFile}" ${sourceId} --duration 10`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      content = JSON.parse(readFileSync(projectFile, "utf-8"));
      clipId = content.state.clips[0].id;
    });

    it("splits a clip at given time", () => {
      execSync(`${CLI} timeline split "${projectFile}" ${clipId} --time 4`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.clips).toHaveLength(2);
      expect(content.state.clips[0].duration).toBe(4);
      expect(content.state.clips[1].duration).toBe(6);
      expect(content.state.clips[1].startTime).toBe(4);
    });

    it("fails with invalid split time", () => {
      expect(() => {
        execSync(`${CLI} timeline split "${projectFile}" ${clipId} --time 0`, {
          cwd: process.cwd(),
          encoding: "utf-8",
          stdio: "pipe",
        });
      }).toThrow();
    });
  });

  describe("timeline duplicate", () => {
    let clipId: string;

    beforeEach(() => {
      execSync(
        `${CLI} timeline add-source "${projectFile}" "${mediaFile}" -d 10`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      let content = JSON.parse(readFileSync(projectFile, "utf-8"));
      const sourceId = content.state.sources[0].id;

      execSync(
        `${CLI} timeline add-clip "${projectFile}" ${sourceId} --duration 5`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      content = JSON.parse(readFileSync(projectFile, "utf-8"));
      clipId = content.state.clips[0].id;
    });

    it("duplicates a clip after original", () => {
      execSync(`${CLI} timeline duplicate "${projectFile}" ${clipId}`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.clips).toHaveLength(2);
      expect(content.state.clips[1].startTime).toBe(5);
      expect(content.state.clips[1].duration).toBe(5);
    });

    it("duplicates a clip at specified time", () => {
      execSync(
        `${CLI} timeline duplicate "${projectFile}" ${clipId} --time 20`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.clips[1].startTime).toBe(20);
    });
  });

  describe("timeline delete", () => {
    let clipId: string;

    beforeEach(() => {
      execSync(
        `${CLI} timeline add-source "${projectFile}" "${mediaFile}" -d 10`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      let content = JSON.parse(readFileSync(projectFile, "utf-8"));
      const sourceId = content.state.sources[0].id;

      execSync(`${CLI} timeline add-clip "${projectFile}" ${sourceId}`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      content = JSON.parse(readFileSync(projectFile, "utf-8"));
      clipId = content.state.clips[0].id;
    });

    it("deletes a clip", () => {
      const contentBefore = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(contentBefore.state.clips).toHaveLength(1);

      execSync(`${CLI} timeline delete "${projectFile}" ${clipId}`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.clips).toHaveLength(0);
    });

    it("fails with non-existent clip", () => {
      expect(() => {
        execSync(`${CLI} timeline delete "${projectFile}" non-existent`, {
          cwd: process.cwd(),
          encoding: "utf-8",
          stdio: "pipe",
        });
      }).toThrow();
    });
  });

  describe("timeline move", () => {
    let clipId: string;

    beforeEach(() => {
      execSync(
        `${CLI} timeline add-source "${projectFile}" "${mediaFile}" -d 10`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      let content = JSON.parse(readFileSync(projectFile, "utf-8"));
      const sourceId = content.state.sources[0].id;

      execSync(`${CLI} timeline add-clip "${projectFile}" ${sourceId}`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      content = JSON.parse(readFileSync(projectFile, "utf-8"));
      clipId = content.state.clips[0].id;
    });

    it("moves a clip to new time", () => {
      execSync(`${CLI} timeline move "${projectFile}" ${clipId} --time 15`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.clips[0].startTime).toBe(15);
    });

    it("moves a clip to different track", () => {
      // Add audio track
      execSync(`${CLI} timeline add-track "${projectFile}" audio -n "Audio 2"`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      const newTrackId = content.state.tracks[2].id;

      execSync(
        `${CLI} timeline move "${projectFile}" ${clipId} --track ${newTrackId}`,
        { cwd: process.cwd(), encoding: "utf-8" }
      );

      const updated = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(updated.state.clips[0].trackId).toBe(newTrackId);
    });
  });
});
