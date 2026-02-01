import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { resolve } from "path";

const CLI = `npx tsx ${resolve(__dirname, "../index.ts")}`;

describe("ai commands", () => {
  describe("ai providers", () => {
    it("lists all available providers", () => {
      const output = execSync(`${CLI} ai providers`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      expect(output).toContain("Available AI Providers");
      expect(output).toContain("OpenAI Whisper");
      expect(output).toContain("Google Gemini");
      expect(output).toContain("Runway Gen-3");
      expect(output).toContain("Kling AI");
    });

    it("shows provider capabilities", () => {
      const output = execSync(`${CLI} ai providers`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      expect(output).toContain("speech-to-text");
      expect(output).toContain("text-to-video");
      expect(output).toContain("auto-edit");
    });
  });

  // Note: ai transcribe and ai suggest commands require API keys
  // These would need mocking or environment variables to test
  describe("ai transcribe", () => {
    it("fails without API key", () => {
      expect(() => {
        execSync(`${CLI} ai transcribe /tmp/nonexistent.mp3`, {
          cwd: process.cwd(),
          encoding: "utf-8",
          env: { ...process.env, OPENAI_API_KEY: undefined },
        });
      }).toThrow();
    });
  });

  describe("ai suggest", () => {
    it("fails without API key", () => {
      expect(() => {
        execSync(`${CLI} ai suggest /tmp/nonexistent.json "trim clip"`, {
          cwd: process.cwd(),
          encoding: "utf-8",
          env: { ...process.env, GOOGLE_API_KEY: undefined },
        });
      }).toThrow();
    });
  });

  describe("ai highlights", () => {
    it("shows help", () => {
      const output = execSync(`${CLI} ai highlights --help`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      expect(output).toContain("Extract highlights");
      expect(output).toContain("--threshold");
      expect(output).toContain("--criteria");
      expect(output).toContain("--duration");
      expect(output).toContain("--count");
      expect(output).toContain("--output");
      expect(output).toContain("--project");
    });

    it("fails without API keys", () => {
      expect(() => {
        execSync(`${CLI} ai highlights /tmp/nonexistent.mp4`, {
          cwd: process.cwd(),
          encoding: "utf-8",
          env: { ...process.env, OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined },
        });
      }).toThrow();
    });

    it("fails with nonexistent file", () => {
      expect(() => {
        execSync(`${CLI} ai highlights /tmp/nonexistent_video_12345.mp4`, {
          cwd: process.cwd(),
          encoding: "utf-8",
          env: { ...process.env, OPENAI_API_KEY: "test", ANTHROPIC_API_KEY: "test" },
        });
      }).toThrow();
    });
  });
});
