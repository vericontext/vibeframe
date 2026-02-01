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

    it("fails without API key", () => {
      expect(() => {
        execSync(`${CLI} ai music "upbeat electronic"`, {
          cwd: process.cwd(),
          encoding: "utf-8",
          env: { ...process.env, REPLICATE_API_TOKEN: undefined },
        });
      }).toThrow();
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

    it("fails without API key", () => {
      expect(() => {
        execSync(`${CLI} ai music-status test-task-id`, {
          cwd: process.cwd(),
          encoding: "utf-8",
          env: { ...process.env, REPLICATE_API_TOKEN: undefined },
        });
      }).toThrow();
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
});
