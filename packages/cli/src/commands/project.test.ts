import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

const CLI = `node ${resolve(__dirname, "../../dist/index.js")}`;

describe("project commands", () => {
  let tempDir: string;
  let projectFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "vibe-test-"));
    projectFile = join(tempDir, "test.vibe.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("project create", () => {
    it("keeps the legacy default filename for compatibility", () => {
      execSync(`${CLI} project create "Legacy Default"`, {
        cwd: tempDir,
        encoding: "utf-8",
      });

      expect(existsSync(join(tempDir, "project.vibe.json"))).toBe(true);
    });

    it("creates a project file with given name", () => {
      execSync(`${CLI} project create "My Project" -o "${projectFile}"`, {
        cwd: tempDir,
        encoding: "utf-8",
      });

      expect(existsSync(projectFile)).toBe(true);

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.version).toBe("1.0.0");
      expect(content.state.project.name).toBe("My Project");
    });

    it("creates project with custom aspect ratio", () => {
      execSync(`${CLI} project create "Vertical" -o "${projectFile}" -r 9:16`, {
        cwd: tempDir,
        encoding: "utf-8",
      });

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.project.aspectRatio).toBe("9:16");
    });

    it("creates project with custom frame rate", () => {
      execSync(`${CLI} project create "HFR" -o "${projectFile}" --fps 60`, {
        cwd: tempDir,
        encoding: "utf-8",
      });

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.project.frameRate).toBe(60);
    });

    it("creates project with default tracks", () => {
      execSync(`${CLI} project create "Test" -o "${projectFile}"`, {
        cwd: tempDir,
        encoding: "utf-8",
      });

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.tracks).toHaveLength(2);
      expect(content.state.tracks[0].type).toBe("video");
      expect(content.state.tracks[1].type).toBe("audio");
    });
  });

  describe("project info", () => {
    beforeEach(() => {
      execSync(`${CLI} project create "Info Test" -o "${projectFile}"`, {
        cwd: tempDir,
        encoding: "utf-8",
      });
    });

    it("displays project information", () => {
      const output = execSync(`${CLI} project info "${projectFile}"`, {
        cwd: tempDir,
        encoding: "utf-8",
      });

      expect(output).toContain("Info Test");
      expect(output).toContain("16:9");
      expect(output).toContain("30");
    });
  });

  describe("project set", () => {
    beforeEach(() => {
      execSync(`${CLI} project create "Original" -o "${projectFile}"`, {
        cwd: tempDir,
        encoding: "utf-8",
      });
    });

    it("updates project name", () => {
      execSync(`${CLI} project set "${projectFile}" --name "Updated Name"`, {
        cwd: tempDir,
        encoding: "utf-8",
      });

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.project.name).toBe("Updated Name");
    });

    it("updates aspect ratio", () => {
      execSync(`${CLI} project set "${projectFile}" -r 1:1`, {
        cwd: tempDir,
        encoding: "utf-8",
      });

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.project.aspectRatio).toBe("1:1");
    });

    it("updates frame rate", () => {
      execSync(`${CLI} project set "${projectFile}" --fps 24`, {
        cwd: tempDir,
        encoding: "utf-8",
      });

      const content = JSON.parse(readFileSync(projectFile, "utf-8"));
      expect(content.state.project.frameRate).toBe(24);
    });
  });
});
