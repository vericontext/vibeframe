/**
 * Demo command - Run sample edits on a generated test video.
 * No API keys needed, FFmpeg only.
 */

import { Command } from "commander";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import chalk from "chalk";
import ora from "ora";
import { commandExists, execSafe } from "../utils/exec-safe.js";
import { executeDetectScenes, executeDetectSilence } from "./detect.js";
import { executeSilenceCut, executeFade, executeNoiseReduce } from "./ai-edit.js";
import { outputSuccess, exitWithError, generalError, isJsonMode } from "./output.js";

const DEMO_DIR = resolve(process.cwd(), ".vibeframe-demo");

/**
 * Generate a short test video with FFmpeg (color bars + tone + silence gaps).
 * No external downloads needed.
 */
async function generateTestVideo(outputPath: string): Promise<boolean> {
  // 12s video: 3s tone → 2s silence → 4s tone → 1s silence → 2s tone
  // Uses lavfi to generate color + sine wave, with volume modulation for silence gaps
  const filter = [
    // Video: color bars with text
    "color=c=0x1a1a2e:s=1280x720:d=12,drawtext=text='VibeFrame Demo':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2",
    // Audio: sine wave with silence gaps
    "sine=frequency=440:duration=12,volume='if(between(t,3,5)+between(t,9,10),0,1)':eval=frame",
  ].join(";");

  try {
    await execSafe("ffmpeg", [
      "-f", "lavfi", "-i", filter,
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
      "-c:a", "aac", "-b:a", "64k",
      "-t", "12", "-y", outputPath,
    ], { timeout: 30000, maxBuffer: 50 * 1024 * 1024 });
    return existsSync(outputPath);
  } catch {
    // Fallback: simpler video without drawtext (in case libfreetype missing)
    try {
      await execSafe("ffmpeg", [
        "-f", "lavfi", "-i", `color=c=0x1a1a2e:s=1280x720:d=12`,
        "-f", "lavfi", "-i", `sine=frequency=440:duration=12,volume='if(between(t,3,5)+between(t,9,10),0,1)':eval=frame`,
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
        "-c:a", "aac", "-b:a", "64k",
        "-shortest", "-y", outputPath,
      ], { timeout: 30000, maxBuffer: 50 * 1024 * 1024 });
      return existsSync(outputPath);
    } catch {
      return false;
    }
  }
}

interface DemoStep {
  name: string;
  description: string;
  run: () => Promise<{ success: boolean; detail?: string }>;
}

export const demoCommand = new Command("demo")
  .description("Run sample edits on a test video (no API keys needed)")
  .option("--keep", "Keep demo output files after completion")
  .option("--json", "Output results as JSON")
  .action(async (options) => {
    const startedAt = Date.now();
    if (options.json) process.env.VIBE_JSON_OUTPUT = "1";
    const isJson = isJsonMode() || !process.stdin.isTTY;

    if (!commandExists("ffmpeg")) {
      exitWithError(generalError(
        "FFmpeg not found.",
        "Install FFmpeg first: https://ffmpeg.org/download.html",
      ));
    }

    const results: Array<{ step: string; success: boolean; detail?: string; duration?: number }> = [];

    if (!isJson) {
      console.log();
      console.log(chalk.bold.cyan("  VibeFrame Demo"));
      console.log(chalk.dim("  Running sample edits with FFmpeg (no API keys needed)"));
      console.log(chalk.dim("  " + "─".repeat(50)));
      console.log();
    }

    // Setup
    await mkdir(DEMO_DIR, { recursive: true });
    const testVideo = resolve(DEMO_DIR, "test-input.mp4");

    const genSpinner = !isJson ? ora("Generating test video...").start() : null;
    const generated = await generateTestVideo(testVideo);
    if (!generated) {
      genSpinner?.fail("Failed to generate test video");
      exitWithError(generalError("Failed to generate test video"));
    }
    genSpinner?.succeed(chalk.green("Test video generated (12s, 720p, with silence gaps)"));

    // Define demo steps
    const steps: DemoStep[] = [
      {
        name: "Detect Scenes",
        description: "Analyzing video for scene changes",
        run: async () => {
          const r = await executeDetectScenes({ videoPath: testVideo, threshold: 0.3 });
          return { success: r.success, detail: r.success ? `Found ${r.scenes?.length || 0} scenes` : r.error };
        },
      },
      {
        name: "Detect Silence",
        description: "Finding silent segments",
        run: async () => {
          const r = await executeDetectSilence({ mediaPath: testVideo, noise: "-30", duration: "0.5" });
          return { success: r.success, detail: r.success ? `Found ${r.silences?.length || 0} silent segments` : r.error };
        },
      },
      {
        name: "Silence Cut",
        description: "Removing silent segments",
        run: async () => {
          const output = resolve(DEMO_DIR, "silence-cut.mp4");
          const r = await executeSilenceCut({ videoPath: testVideo, outputPath: output, padding: 0.1 });
          if (r.success && r.totalDuration && r.silentDuration) {
            return { success: true, detail: `Removed ${r.silentDuration.toFixed(1)}s silence (${r.totalDuration.toFixed(1)}s → ${(r.totalDuration - r.silentDuration).toFixed(1)}s)` };
          }
          return { success: r.success, detail: r.success ? `Output: ${output}` : r.error };
        },
      },
      {
        name: "Noise Reduce",
        description: "Reducing background noise",
        run: async () => {
          const output = resolve(DEMO_DIR, "noise-reduced.mp4");
          const r = await executeNoiseReduce({ inputPath: testVideo, outputPath: output, strength: "medium" });
          return { success: r.success, detail: r.success ? `Cleaned audio → ${output}` : r.error };
        },
      },
      {
        name: "Fade Effects",
        description: "Adding fade in/out",
        run: async () => {
          const output = resolve(DEMO_DIR, "faded.mp4");
          const r = await executeFade({ videoPath: testVideo, outputPath: output, fadeIn: 1, fadeOut: 1 });
          return { success: r.success, detail: r.success ? `1s fade in + 1s fade out → ${output}` : r.error };
        },
      },
    ];

    // Run steps
    for (const step of steps) {
      const spinner = !isJson ? ora(step.description + "...").start() : null;
      const start = Date.now();

      try {
        const result = await step.run();
        const elapsed = Date.now() - start;

        results.push({ step: step.name, success: result.success, detail: result.detail, duration: elapsed });

        if (!isJson) {
          if (result.success) {
            spinner?.succeed(`${chalk.green(step.name)} ${chalk.dim(`(${elapsed}ms)`)} — ${result.detail}`);
          } else {
            spinner?.fail(`${chalk.red(step.name)} — ${result.detail}`);
          }
        }
      } catch (error) {
        const elapsed = Date.now() - start;
        const msg = error instanceof Error ? error.message : String(error);
        results.push({ step: step.name, success: false, detail: msg, duration: elapsed });
        if (!isJson) {
          spinner?.fail(`${chalk.red(step.name)} — ${msg}`);
        }
      }
    }

    // Summary
    const passed = results.filter(r => r.success).length;
    const total = results.length;

    if (isJson) {
      outputSuccess({
        command: "demo",
        startedAt,
        data: {
          allPassed: passed === total,
          passed,
          total,
          steps: results,
          demoDir: DEMO_DIR,
        },
      });
    } else {
      console.log();
      console.log(chalk.dim("  " + "─".repeat(50)));
      console.log(`  ${chalk.bold(`${passed}/${total} steps passed`)}${passed === total ? chalk.green(" ✓") : ""}`);
      console.log(`  ${chalk.dim(`Output: ${DEMO_DIR}`)}`);
      console.log();

      if (passed === total) {
        console.log(chalk.bold("  Next steps:"));
        console.log(chalk.dim("  vibe setup              # Configure API keys for AI features"));
        console.log(chalk.dim("  vibe doctor             # Check system health"));
        console.log(chalk.dim("  vibe edit caption <video> -o out.mp4  # Add captions (needs OpenAI key)"));
        console.log();
      }
    }

    // Cleanup unless --keep
    if (!options.keep) {
      try {
        await rm(DEMO_DIR, { recursive: true, force: true });
      } catch { /* best-effort cleanup */ }
    }
  });
