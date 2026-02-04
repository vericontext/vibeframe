/**
 * E2E Tests: AI Pipeline Tools with Real API Calls
 *
 * ⚠️  WARNING: These tests make REAL API calls and incur COSTS!
 *
 * To run these tests:
 *   RUN_E2E=1 pnpm vitest run src/agent/tools/e2e.test.ts
 *
 * Required API keys (set in ~/.vibeframe/config.yaml or env):
 *   - ANTHROPIC_API_KEY (Claude - storyboard)
 *   - GOOGLE_API_KEY (Gemini - image, video analysis)
 *   - OPENAI_API_KEY (Whisper - transcription)
 *   - ELEVENLABS_API_KEY (TTS)
 *
 * Estimated costs per full run:
 *   - ai_gemini_video: ~$0.01-0.05 (depending on video length)
 *   - ai_storyboard: ~$0.01-0.02
 *   - ai_image (gemini): Free tier available
 *   - ai_tts: ~$0.01-0.05 (depending on text length)
 *   - ai_script_to_video (images-only): ~$0.05-0.20
 *   - ai_highlights (with Gemini): ~$0.05-0.20
 *
 * Total estimated cost: $0.10-0.50 per full run
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import { ToolRegistry } from "./index.js";
import { registerAITools } from "./ai.js";
import type { AgentContext } from "../types.js";

// Skip all tests unless RUN_E2E is set
const RUN_E2E = process.env.RUN_E2E === "1" || process.env.RUN_E2E === "true";

// Test output directory
const TEST_OUTPUT_DIR = resolve(process.cwd(), ".e2e-test-output");

// Mock context for tool execution
const createContext = (subdir?: string): AgentContext => ({
  workingDirectory: subdir ? join(TEST_OUTPUT_DIR, subdir) : TEST_OUTPUT_DIR,
  projectPath: undefined,
});

// Check if required API keys are available
function checkApiKey(keyName: string): boolean {
  // Check environment
  if (process.env[keyName]) return true;

  // Check config file
  try {
    const configPath = resolve(
      process.env.HOME || "~",
      ".vibeframe",
      "config.yaml"
    );
    if (existsSync(configPath)) {
      const content = execSync(`cat "${configPath}"`, { encoding: "utf-8" });
      const keyMapping: Record<string, string> = {
        GOOGLE_API_KEY: "google:",
        ANTHROPIC_API_KEY: "anthropic:",
        OPENAI_API_KEY: "openai:",
        ELEVENLABS_API_KEY: "elevenlabs:",
      };
      if (keyMapping[keyName] && content.includes(keyMapping[keyName])) {
        return true;
      }
    }
  } catch {
    // Ignore errors
  }
  return false;
}

// Print cost warning
function printCostWarning() {
  console.log("\n");
  console.log("⚠️  ═══════════════════════════════════════════════════════════");
  console.log("⚠️  E2E TESTS - REAL API CALLS - COSTS WILL BE INCURRED");
  console.log("⚠️  ═══════════════════════════════════════════════════════════");
  console.log("⚠️  Estimated cost: $0.10-0.50 per full run");
  console.log("⚠️  ═══════════════════════════════════════════════════════════");
  console.log("\n");
}

describe.skipIf(!RUN_E2E)("E2E: AI Pipeline Tools", () => {
  let registry: ToolRegistry;

  beforeAll(() => {
    printCostWarning();

    // Setup registry
    registry = new ToolRegistry();
    registerAITools(registry);

    // Create test output directory
    if (!existsSync(TEST_OUTPUT_DIR)) {
      mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
    }

    console.log(`📁 Test output directory: ${TEST_OUTPUT_DIR}`);
  });

  afterAll(() => {
    console.log("\n");
    console.log("✅ E2E tests completed");
    console.log(`📁 Output files saved to: ${TEST_OUTPUT_DIR}`);
    console.log("💡 Run 'rm -rf .e2e-test-output' to clean up");
    console.log("\n");
  });

  describe("ai_gemini_video", () => {
    const hasKey = checkApiKey("GOOGLE_API_KEY");

    it.skipIf(!hasKey)(
      "analyzes a sample video with Gemini",
      async () => {
        console.log("\n🎬 Testing ai_gemini_video...");

        // Create a simple test video using FFmpeg
        const testVideoPath = join(TEST_OUTPUT_DIR, "test-video.mp4");

        if (!existsSync(testVideoPath)) {
          console.log("  Creating test video with FFmpeg...");
          try {
            execSync(
              `ffmpeg -f lavfi -i color=c=blue:s=320x240:d=3 -f lavfi -i anullsrc=r=44100:cl=stereo -t 3 -c:v libx264 -c:a aac "${testVideoPath}" -y`,
              { stdio: "pipe" }
            );
          } catch {
            console.log("  ⚠️ FFmpeg not available, skipping video creation");
            return;
          }
        }

        const handler = registry.getHandler("ai_gemini_video");
        expect(handler).toBeDefined();

        const result = await handler!(
          {
            source: testVideoPath,
            prompt: "Describe what you see in this video in one sentence.",
            model: "flash",
          },
          createContext()
        );

        console.log(`  Result: ${result.success ? "✅" : "❌"}`);
        if (result.success) {
          console.log(`  Response: ${result.output.substring(0, 100)}...`);
        } else {
          console.log(`  Error: ${result.error}`);
        }

        expect(result.success).toBe(true);
        expect(result.output).toBeTruthy();
      },
      60000 // 60s timeout
    );

    it.skipIf(!hasKey)(
      "handles YouTube URL",
      async () => {
        console.log("\n🎬 Testing ai_gemini_video with YouTube URL...");

        const handler = registry.getHandler("ai_gemini_video");

        // Use a short, public domain video
        const result = await handler!(
          {
            source: "https://www.youtube.com/watch?v=jNQXAC9IVRw", // "Me at the zoo" - first YouTube video
            prompt: "What is shown in this video? Answer in one sentence.",
            model: "flash",
          },
          createContext()
        );

        console.log(`  Result: ${result.success ? "✅" : "❌"}`);
        if (result.success) {
          console.log(`  Response: ${result.output.substring(0, 100)}...`);
        } else {
          console.log(`  Error: ${result.error}`);
        }

        // YouTube support may vary, so we just check it doesn't crash
        expect(result).toBeDefined();
      },
      120000 // 120s timeout for YouTube
    );
  });

  describe("ai_storyboard", () => {
    const hasKey = checkApiKey("ANTHROPIC_API_KEY");

    it.skipIf(!hasKey)(
      "generates storyboard from script",
      async () => {
        console.log("\n📝 Testing ai_storyboard...");

        const handler = registry.getHandler("ai_storyboard");
        expect(handler).toBeDefined();

        const result = await handler!(
          {
            script: "A robot learns to dance. First awkward moves, then graceful spins.",
            targetDuration: 10,
            output: "test-storyboard.json",
          },
          createContext()
        );

        console.log(`  Result: ${result.success ? "✅" : "❌"}`);
        if (result.success) {
          console.log(`  Output: ${result.output.substring(0, 150)}...`);
        } else {
          console.log(`  Error: ${result.error}`);
        }

        expect(result.success).toBe(true);
      },
      60000
    );
  });

  describe("ai_image", () => {
    const hasGeminiKey = checkApiKey("GOOGLE_API_KEY");

    it.skipIf(!hasGeminiKey)(
      "generates image with Gemini",
      async () => {
        console.log("\n🖼️  Testing ai_image (Gemini)...");

        const handler = registry.getHandler("ai_image");
        expect(handler).toBeDefined();

        const result = await handler!(
          {
            prompt: "A simple blue square on white background",
            output: "test-image-gemini.png",
            provider: "gemini",
          },
          createContext()
        );

        console.log(`  Result: ${result.success ? "✅" : "❌"}`);
        if (result.success) {
          console.log(`  Output: ${result.output}`);
          const imagePath = join(TEST_OUTPUT_DIR, "test-image-gemini.png");
          console.log(`  File exists: ${existsSync(imagePath)}`);
        } else {
          console.log(`  Error: ${result.error}`);
        }

        expect(result.success).toBe(true);
      },
      60000
    );
  });

  describe("ai_tts", () => {
    const hasKey = checkApiKey("ELEVENLABS_API_KEY");

    it.skipIf(!hasKey)(
      "generates speech from text",
      async () => {
        console.log("\n🎙️  Testing ai_tts...");

        const handler = registry.getHandler("ai_tts");
        expect(handler).toBeDefined();

        const result = await handler!(
          {
            text: "Hello, this is a test of the text to speech system.",
            output: "test-tts.mp3",
          },
          createContext()
        );

        console.log(`  Result: ${result.success ? "✅" : "❌"}`);
        if (result.success) {
          console.log(`  Output: ${result.output}`);
          const audioPath = join(TEST_OUTPUT_DIR, "test-tts.mp3");
          console.log(`  File exists: ${existsSync(audioPath)}`);
        } else {
          console.log(`  Error: ${result.error}`);
        }

        expect(result.success).toBe(true);
      },
      30000
    );
  });

  describe("ai_sfx", () => {
    const hasKey = checkApiKey("ELEVENLABS_API_KEY");

    it.skipIf(!hasKey)(
      "generates sound effect",
      async () => {
        console.log("\n🔊 Testing ai_sfx...");

        const handler = registry.getHandler("ai_sfx");
        expect(handler).toBeDefined();

        const result = await handler!(
          {
            prompt: "short beep notification sound",
            output: "test-sfx.mp3",
            duration: 1,
          },
          createContext()
        );

        console.log(`  Result: ${result.success ? "✅" : "❌"}`);
        if (result.success) {
          console.log(`  Output: ${result.output}`);
        } else {
          console.log(`  Error: ${result.error}`);
        }

        expect(result.success).toBe(true);
      },
      30000
    );
  });

  describe("ai_script_to_video (images-only)", () => {
    const hasClaudeKey = checkApiKey("ANTHROPIC_API_KEY");
    const hasGeminiKey = checkApiKey("GOOGLE_API_KEY");
    const hasTTSKey = checkApiKey("ELEVENLABS_API_KEY");

    it.skipIf(!hasClaudeKey || !hasGeminiKey)(
      "generates images from script (no video, no voiceover)",
      async () => {
        console.log("\n🎬 Testing ai_script_to_video (images-only)...");
        console.log("  ⚠️ This test may take 1-2 minutes");

        // Create subdirectory for this test
        const outputDir = join(TEST_OUTPUT_DIR, "script-to-video-test");
        if (!existsSync(outputDir)) {
          mkdirSync(outputDir, { recursive: true });
        }

        const handler = registry.getHandler("ai_script_to_video");
        expect(handler).toBeDefined();

        const result = await handler!(
          {
            script: "A sunrise over mountains. Birds flying in the sky.",
            outputDir: "script-to-video-test",
            imageProvider: "gemini",
            imagesOnly: true,
            noVoiceover: true,
          },
          createContext()
        );

        console.log(`  Result: ${result.success ? "✅" : "❌"}`);
        if (result.success) {
          console.log(`  Output: ${result.output.substring(0, 200)}...`);

          // Check if files were created
          const storyboardPath = join(outputDir, "storyboard.json");
          console.log(`  Storyboard exists: ${existsSync(storyboardPath)}`);
        } else {
          console.log(`  Error: ${result.error}`);
        }

        expect(result.success).toBe(true);
      },
      180000 // 3 minutes timeout
    );

    it.skipIf(!hasClaudeKey || !hasGeminiKey || !hasTTSKey)(
      "generates images with voiceover (no video)",
      async () => {
        console.log("\n🎬 Testing ai_script_to_video (images + voiceover)...");
        console.log("  ⚠️ This test may take 2-3 minutes");

        const outputDir = join(TEST_OUTPUT_DIR, "script-to-video-with-tts");
        if (!existsSync(outputDir)) {
          mkdirSync(outputDir, { recursive: true });
        }

        const handler = registry.getHandler("ai_script_to_video");

        const result = await handler!(
          {
            script: "Welcome to our demo. This is amazing technology.",
            outputDir: "script-to-video-with-tts",
            imageProvider: "gemini",
            imagesOnly: true,
            // voiceover enabled by default
          },
          createContext()
        );

        console.log(`  Result: ${result.success ? "✅" : "❌"}`);
        if (result.success) {
          console.log(`  Output: ${result.output.substring(0, 200)}...`);
        } else {
          console.log(`  Error: ${result.error}`);
        }

        expect(result.success).toBe(true);
      },
      300000 // 5 minutes timeout
    );
  });

  describe("ai_highlights (with Gemini)", () => {
    const hasGeminiKey = checkApiKey("GOOGLE_API_KEY");

    it.skipIf(!hasGeminiKey)(
      "extracts highlights from video using Gemini",
      async () => {
        console.log("\n🎯 Testing ai_highlights (Gemini)...");

        // Create test video with FFmpeg
        const testVideoPath = join(TEST_OUTPUT_DIR, "test-highlights-video.mp4");

        if (!existsSync(testVideoPath)) {
          console.log("  Creating 10s test video with FFmpeg...");
          try {
            // Create a 10 second video with changing colors
            execSync(
              `ffmpeg -f lavfi -i "color=c=red:s=320x240:d=3,format=yuv420p[v0];` +
                `color=c=green:s=320x240:d=4,format=yuv420p[v1];` +
                `color=c=blue:s=320x240:d=3,format=yuv420p[v2];` +
                `[v0][v1][v2]concat=n=3:v=1:a=0" ` +
                `-f lavfi -i anullsrc=r=44100:cl=stereo -t 10 ` +
                `-c:v libx264 -c:a aac "${testVideoPath}" -y`,
              { stdio: "pipe" }
            );
          } catch {
            console.log("  ⚠️ FFmpeg not available, skipping");
            return;
          }
        }

        const handler = registry.getHandler("ai_highlights");
        expect(handler).toBeDefined();

        const result = await handler!(
          {
            media: testVideoPath,
            useGemini: true,
            count: 2,
            criteria: "all",
          },
          createContext()
        );

        console.log(`  Result: ${result.success ? "✅" : "❌"}`);
        if (result.success) {
          console.log(`  Output: ${result.output.substring(0, 200)}...`);
        } else {
          console.log(`  Error: ${result.error}`);
        }

        // May not find highlights in simple test video, but should not error
        expect(result.success).toBe(true);
      },
      120000
    );
  });

  describe("ai_auto_shorts (analyze-only)", () => {
    const hasGeminiKey = checkApiKey("GOOGLE_API_KEY");

    it.skipIf(!hasGeminiKey)(
      "analyzes video for shorts (no generation)",
      async () => {
        console.log("\n📱 Testing ai_auto_shorts (analyze-only)...");

        const testVideoPath = join(TEST_OUTPUT_DIR, "test-highlights-video.mp4");

        // Reuse video from highlights test or create if needed
        if (!existsSync(testVideoPath)) {
          console.log("  Creating test video...");
          try {
            execSync(
              `ffmpeg -f lavfi -i color=c=blue:s=320x240:d=10 -f lavfi -i anullsrc=r=44100:cl=stereo -t 10 -c:v libx264 -c:a aac "${testVideoPath}" -y`,
              { stdio: "pipe" }
            );
          } catch {
            console.log("  ⚠️ FFmpeg not available, skipping");
            return;
          }
        }

        const handler = registry.getHandler("ai_auto_shorts");
        expect(handler).toBeDefined();

        const result = await handler!(
          {
            video: testVideoPath,
            analyzeOnly: true,
            useGemini: true,
            count: 1,
          },
          createContext()
        );

        console.log(`  Result: ${result.success ? "✅" : "❌"}`);
        if (result.success) {
          console.log(`  Output: ${result.output.substring(0, 200)}...`);
        } else {
          console.log(`  Error: ${result.error}`);
        }

        expect(result.success).toBe(true);
      },
      120000
    );
  });
});

// Summary test to show what was tested
describe.skipIf(!RUN_E2E)("E2E Summary", () => {
  it("prints API key status", () => {
    console.log("\n");
    console.log("📊 API Key Status:");
    console.log("─".repeat(50));

    const keys = [
      { name: "GOOGLE_API_KEY", desc: "Gemini (image, video)" },
      { name: "ANTHROPIC_API_KEY", desc: "Claude (storyboard)" },
      { name: "OPENAI_API_KEY", desc: "Whisper (transcription)" },
      { name: "ELEVENLABS_API_KEY", desc: "TTS, SFX" },
      { name: "RUNWAY_API_SECRET", desc: "Video generation" },
      { name: "KLING_API_KEY", desc: "Video generation" },
      { name: "STABILITY_API_KEY", desc: "Stable Diffusion" },
    ];

    for (const key of keys) {
      const hasKey = checkApiKey(key.name);
      const status = hasKey ? "✅" : "❌";
      console.log(`  ${status} ${key.name.padEnd(25)} - ${key.desc}`);
    }

    console.log("─".repeat(50));
    console.log("\n");
  });
});
