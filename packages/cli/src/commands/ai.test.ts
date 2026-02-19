import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { resolve } from "path";
import { detectFillerRanges, DEFAULT_FILLER_WORDS } from "./ai.js";
import type { FillerWord } from "./ai.js";

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
      expect(output).toContain("Gen-4.5");
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

  describe("ai b-roll", () => {
    it("shows help", () => {
      const output = execSync(`${CLI} ai b-roll --help`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      expect(output).toContain("Match B-roll footage");
      expect(output).toContain("--threshold");
      expect(output).toContain("--broll");
      expect(output).toContain("--broll-dir");
      expect(output).toContain("--output");
      expect(output).toContain("--analyze-only");
      expect(output).toContain("--language");
    });

    it("fails without B-roll files", () => {
      expect(() => {
        execSync(`${CLI} ai b-roll "test narration"`, {
          cwd: process.cwd(),
          encoding: "utf-8",
          env: { ...process.env, OPENAI_API_KEY: "test", ANTHROPIC_API_KEY: "test" },
        });
      }).toThrow();
    });

    it("fails without API keys", () => {
      expect(() => {
        execSync(`${CLI} ai b-roll test.mp3 -b clip.mp4`, {
          cwd: process.cwd(),
          encoding: "utf-8",
          env: { ...process.env, OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined },
        });
      }).toThrow();
    });
  });

  describe("ai viral", () => {
    it("shows help", () => {
      const output = execSync(`${CLI} ai viral --help`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      expect(output).toContain("Optimize video for viral potential");
      expect(output).toContain("--platforms");
      expect(output).toContain("--output-dir");
      expect(output).toContain("--analyze-only");
      expect(output).toContain("--skip-captions");
      expect(output).toContain("--caption-style");
      expect(output).toContain("--hook-duration");
    });

    it("validates platform names", () => {
      expect(() => {
        execSync(`${CLI} ai viral /tmp/test.vibe.json -p invalid-platform`, {
          cwd: process.cwd(),
          encoding: "utf-8",
          env: { ...process.env, OPENAI_API_KEY: "test", ANTHROPIC_API_KEY: "test" },
        });
      }).toThrow();
    });

    it("fails without API keys", () => {
      expect(() => {
        execSync(`${CLI} ai viral /tmp/test.vibe.json`, {
          cwd: process.cwd(),
          encoding: "utf-8",
          env: { ...process.env, OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined },
        });
      }).toThrow();
    });

    it("fails with nonexistent project", () => {
      expect(() => {
        execSync(`${CLI} ai viral /tmp/nonexistent_project_12345.vibe.json`, {
          cwd: process.cwd(),
          encoding: "utf-8",
          env: { ...process.env, OPENAI_API_KEY: "test", ANTHROPIC_API_KEY: "test" },
        });
      }).toThrow();
    });
  });

  describe("ai video-extend", () => {
    it("shows help", () => {
      const output = execSync(`${CLI} ai video-extend --help`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      expect(output).toContain("Extend video duration");
      expect(output).toContain("--output");
      expect(output).toContain("--prompt");
      expect(output).toContain("--duration");
      expect(output).toContain("--negative");
    });

    it("fails without API key", () => {
      expect(() => {
        execSync(`${CLI} ai video-extend /tmp/video.mp4`, {
          cwd: process.cwd(),
          encoding: "utf-8",
          env: { ...process.env, KLING_API_KEY: undefined },
        });
      }).toThrow();
    });
  });

  describe("ai video-upscale", () => {
    it("shows help", () => {
      const output = execSync(`${CLI} ai video-upscale --help`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      expect(output).toContain("Upscale video resolution");
      expect(output).toContain("--output");
      expect(output).toContain("--scale");
      expect(output).toContain("--model");
      expect(output).toContain("--ffmpeg");
    });

    it("validates scale option", () => {
      expect(() => {
        execSync(`${CLI} ai video-upscale /tmp/video.mp4 --scale 3 --ffmpeg`, {
          cwd: process.cwd(),
          encoding: "utf-8",
        });
      }).toThrow();
    });
  });

  describe("ai video-interpolate", () => {
    it("shows help", () => {
      const output = execSync(`${CLI} ai video-interpolate --help`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      expect(output).toContain("slow motion");
      expect(output).toContain("--output");
      expect(output).toContain("--factor");
      expect(output).toContain("--fps");
      expect(output).toContain("--quality");
    });

    it("validates factor option", () => {
      expect(() => {
        execSync(`${CLI} ai video-interpolate /tmp/video.mp4 --factor 3`, {
          cwd: process.cwd(),
          encoding: "utf-8",
        });
      }).toThrow();
    });
  });

  describe("ai video-inpaint", () => {
    it("shows help", () => {
      const output = execSync(`${CLI} ai video-inpaint --help`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      expect(output).toContain("Remove objects from video");
      expect(output).toContain("--output");
      expect(output).toContain("--target");
      expect(output).toContain("--mask");
      expect(output).toContain("--provider");
    });

    it("fails without target or mask", () => {
      expect(() => {
        execSync(`${CLI} ai video-inpaint https://example.com/video.mp4`, {
          cwd: process.cwd(),
          encoding: "utf-8",
          env: { ...process.env, REPLICATE_API_TOKEN: "test" },
        });
      }).toThrow();
    });

    it("fails without API key", () => {
      expect(() => {
        execSync(`${CLI} ai video-inpaint https://example.com/video.mp4 --target "watermark"`, {
          cwd: process.cwd(),
          encoding: "utf-8",
          env: { ...process.env, REPLICATE_API_TOKEN: undefined },
        });
      }).toThrow();
    });
  });

  // Voice & Audio Features
  describe("ai voice-clone", () => {
    it("shows help", () => {
      const output = execSync(`${CLI} ai voice-clone --help`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      expect(output).toContain("Clone a voice");
      expect(output).toContain("--name");
      expect(output).toContain("--description");
      expect(output).toContain("--labels");
      expect(output).toContain("--remove-noise");
      expect(output).toContain("--list");
    });

    it("requires name option when cloning", () => {
      expect(() => {
        execSync(`${CLI} ai voice-clone sample.mp3`, {
          cwd: process.cwd(),
          encoding: "utf-8",
          env: { ...process.env, ELEVENLABS_API_KEY: "test" },
        });
      }).toThrow();
    });

    it("fails without API key", () => {
      expect(() => {
        execSync(`${CLI} ai voice-clone sample.mp3 --name "TestVoice"`, {
          cwd: process.cwd(),
          encoding: "utf-8",
          env: { ...process.env, ELEVENLABS_API_KEY: undefined },
        });
      }).toThrow();
    });
  });

  describe("ai music", () => {
    it("shows help", () => {
      const output = execSync(`${CLI} ai music --help`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      expect(output).toContain("Generate background music");
      expect(output).toContain("--duration");
      expect(output).toContain("--melody");
      expect(output).toContain("--model");
      expect(output).toContain("--output");
      expect(output).toContain("--no-wait");
    });

    it("requires API key or shows error", () => {
      // Note: This test may pass if API key is in config file (~/.vibeframe/config.yaml)
      // We test that it either succeeds (key in config) or fails (no key anywhere)
      try {
        const output = execSync(`${CLI} ai music "upbeat electronic" --no-wait`, {
          cwd: process.cwd(),
          encoding: "utf-8",
          env: { ...process.env, REPLICATE_API_TOKEN: undefined },
          timeout: 10000,
        });
        // If it succeeds, the API key was found in config
        expect(output).toBeTruthy();
      } catch (error: unknown) {
        // If it fails, it should mention API key
        const execError = error as { stderr?: string; stdout?: string };
        const errorOutput = execError.stderr || execError.stdout || "";
        expect(errorOutput.toLowerCase()).toMatch(/api|key|token|replicate/i);
      }
    });
  });

  describe("ai music-status", () => {
    it("shows help", () => {
      const output = execSync(`${CLI} ai music-status --help`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      expect(output).toContain("Check music generation status");
      expect(output).toContain("task-id");
    });

    it("requires API key or shows error", () => {
      // Note: This test may pass if API key is in config file (~/.vibeframe/config.yaml)
      try {
        const output = execSync(`${CLI} ai music-status test-task-id`, {
          cwd: process.cwd(),
          encoding: "utf-8",
          env: { ...process.env, REPLICATE_API_TOKEN: undefined },
          timeout: 10000,
        });
        // If it succeeds, the API key was found in config
        expect(output).toBeTruthy();
      } catch (error: unknown) {
        // If it fails, it should mention API key or invalid task
        const execError = error as { stderr?: string; stdout?: string };
        const errorOutput = execError.stderr || execError.stdout || "";
        expect(errorOutput.toLowerCase()).toMatch(/api|key|token|replicate|task|invalid/i);
      }
    });
  });

  describe("ai audio-restore", () => {
    it("shows help", () => {
      const output = execSync(`${CLI} ai audio-restore --help`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      expect(output).toContain("Restore audio quality");
      expect(output).toContain("--output");
      expect(output).toContain("--ffmpeg");
      expect(output).toContain("--denoise");
      expect(output).toContain("--enhance");
      expect(output).toContain("--noise-floor");
    });

    it("fails with nonexistent file", () => {
      expect(() => {
        execSync(`${CLI} ai audio-restore /tmp/nonexistent_audio_12345.mp3 --ffmpeg`, {
          cwd: process.cwd(),
          encoding: "utf-8",
        });
      }).toThrow();
    });
  });

  describe("ai dub", () => {
    it("shows help", () => {
      const output = execSync(`${CLI} ai dub --help`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      expect(output).toContain("Dub audio/video");
      expect(output).toContain("--language");
      expect(output).toContain("--source");
      expect(output).toContain("--voice");
      expect(output).toContain("--analyze-only");
      expect(output).toContain("--output");
    });

    it("requires language option", () => {
      expect(() => {
        execSync(`${CLI} ai dub /tmp/video.mp4`, {
          cwd: process.cwd(),
          encoding: "utf-8",
          env: { ...process.env, OPENAI_API_KEY: "test", ANTHROPIC_API_KEY: "test" },
        });
      }).toThrow();
    });

    it("fails without API keys", () => {
      expect(() => {
        execSync(`${CLI} ai dub /tmp/video.mp4 -l es`, {
          cwd: process.cwd(),
          encoding: "utf-8",
          env: { ...process.env, OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined },
        });
      }).toThrow();
    });

    it("fails with nonexistent file", () => {
      expect(() => {
        execSync(`${CLI} ai dub /tmp/nonexistent_video_12345.mp4 -l es`, {
          cwd: process.cwd(),
          encoding: "utf-8",
          env: { ...process.env, OPENAI_API_KEY: "test", ANTHROPIC_API_KEY: "test", ELEVENLABS_API_KEY: "test" },
        });
      }).toThrow();
    });
  });

  describe("ai jump-cut", () => {
    it("shows help", () => {
      const output = execSync(`${CLI} ai jump-cut --help`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      expect(output).toContain("Remove filler words");
      expect(output).toContain("--fillers");
      expect(output).toContain("--padding");
      expect(output).toContain("--analyze-only");
      expect(output).toContain("--language");
      expect(output).toContain("--api-key");
      expect(output).toContain("--output");
    });

    it("fails with nonexistent file", () => {
      expect(() => {
        execSync(`${CLI} ai jump-cut /tmp/nonexistent_video_12345.mp4`, {
          cwd: process.cwd(),
          encoding: "utf-8",
          env: { ...process.env, OPENAI_API_KEY: "test" },
        });
      }).toThrow();
    });

    it("fails without API key", () => {
      expect(() => {
        execSync(`${CLI} ai jump-cut /tmp/nonexistent.mp4`, {
          cwd: process.cwd(),
          encoding: "utf-8",
          env: { ...process.env, OPENAI_API_KEY: undefined },
        });
      }).toThrow();
    });
  });

  describe("detectFillerRanges", () => {
    const words = [
      { word: "Hello", start: 0.0, end: 0.5 },
      { word: "um", start: 0.6, end: 0.9 },
      { word: "I", start: 1.0, end: 1.1 },
      { word: "think", start: 1.2, end: 1.5 },
      { word: "like", start: 1.6, end: 1.9 },
      { word: "this", start: 2.0, end: 2.3 },
      { word: "is", start: 2.4, end: 2.6 },
      { word: "basically", start: 2.7, end: 3.2 },
      { word: "great", start: 3.3, end: 3.6 },
    ];

    it("detects filler words with default list", () => {
      const result = detectFillerRanges(words, DEFAULT_FILLER_WORDS, 0.05);

      expect(result.length).toBe(3);
      expect(result[0].word).toBe("um");
      expect(result[1].word).toBe("like");
      expect(result[2].word).toBe("basically");
    });

    it("detects fillers case-insensitively", () => {
      const mixedCase = [
        { word: "UM", start: 0.0, end: 0.3 },
        { word: "Like", start: 1.0, end: 1.3 },
      ];
      const result = detectFillerRanges(mixedCase, DEFAULT_FILLER_WORDS, 0.05);

      expect(result.length).toBe(2);
    });

    it("strips punctuation before matching", () => {
      const punctuated = [
        { word: "um,", start: 0.0, end: 0.3 },
        { word: "like.", start: 1.0, end: 1.3 },
        { word: "right?", start: 2.0, end: 2.3 },
      ];
      const result = detectFillerRanges(punctuated, DEFAULT_FILLER_WORDS, 0.05);

      expect(result.length).toBe(3);
    });

    it("merges adjacent filler ranges within padding distance", () => {
      const adjacent = [
        { word: "um", start: 1.0, end: 1.3 },
        { word: "uh", start: 1.35, end: 1.6 },
      ];
      // padding=0.05 => merge threshold = 0.1, gap = 0.05 < 0.1
      const result = detectFillerRanges(adjacent, DEFAULT_FILLER_WORDS, 0.05);

      expect(result.length).toBe(1);
      expect(result[0].start).toBe(1.0);
      expect(result[0].end).toBe(1.6);
      expect(result[0].word).toContain("um");
      expect(result[0].word).toContain("uh");
    });

    it("does not merge distant filler ranges", () => {
      const distant = [
        { word: "um", start: 1.0, end: 1.3 },
        { word: "uh", start: 5.0, end: 5.3 },
      ];
      const result = detectFillerRanges(distant, DEFAULT_FILLER_WORDS, 0.05);

      expect(result.length).toBe(2);
    });

    it("returns empty array when no fillers found", () => {
      const clean = [
        { word: "This", start: 0.0, end: 0.3 },
        { word: "is", start: 0.4, end: 0.5 },
        { word: "great", start: 0.6, end: 0.9 },
      ];
      const result = detectFillerRanges(clean, DEFAULT_FILLER_WORDS, 0.05);

      expect(result.length).toBe(0);
    });

    it("respects custom filler list", () => {
      const customFillers = ["hello", "great"];
      const result = detectFillerRanges(words, customFillers, 0.05);

      expect(result.length).toBe(2);
      expect(result[0].word).toBe("Hello");
      expect(result[1].word).toBe("great");
    });

    it("handles empty word array", () => {
      const result = detectFillerRanges([], DEFAULT_FILLER_WORDS, 0.05);

      expect(result.length).toBe(0);
    });
  });

  describe("DEFAULT_FILLER_WORDS", () => {
    it("contains expected common fillers", () => {
      expect(DEFAULT_FILLER_WORDS).toContain("um");
      expect(DEFAULT_FILLER_WORDS).toContain("uh");
      expect(DEFAULT_FILLER_WORDS).toContain("like");
      expect(DEFAULT_FILLER_WORDS).toContain("you know");
      expect(DEFAULT_FILLER_WORDS).toContain("basically");
      expect(DEFAULT_FILLER_WORDS).toContain("literally");
      expect(DEFAULT_FILLER_WORDS).toContain("i mean");
      expect(DEFAULT_FILLER_WORDS).toContain("actually");
    });

    it("has all words in lowercase", () => {
      for (const word of DEFAULT_FILLER_WORDS) {
        expect(word).toBe(word.toLowerCase());
      }
    });
  });
});
