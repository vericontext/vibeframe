/**
 * @module analyze
 *
 * Top-level `vibe analyze` command group for media analysis.
 *
 * Commands:
 *   analyze media   - Unified analysis for images, videos, and YouTube URLs (Gemini)
 *   analyze video   - Analyze video files or YouTube URLs with Gemini
 *   analyze review  - AI video quality review and auto-fix (Gemini)
 *   analyze suggest - Get AI edit suggestions using Gemini
 *
 * @dependencies Gemini (Google), FFmpeg (auto-fix filters)
 */

import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { GeminiProvider } from "@vibeframe/ai-providers";
import { Project, type ProjectFile } from "../engine/index.js";
import { getApiKey } from "../utils/api-key.js";
import { applySuggestion } from "./ai-helpers.js";
import { executeAnalyze, executeGeminiVideo } from "./ai-analyze.js";
import { registerReviewCommand } from "./ai-review.js";
import { isJsonMode, outputResult } from "./output.js";

export const analyzeCommand = new Command("analyze").description(
  "Analyze media using AI (images, videos, YouTube URLs)"
);

// ── analyze media ──────────────────────────────────────────────────────

analyzeCommand
  .command("media")
  .description("Analyze any media: images, videos, or YouTube URLs using Gemini")
  .argument("<source>", "Image/video file path, image URL, or YouTube URL")
  .argument("<prompt>", "Analysis prompt (e.g., 'Describe this image', 'Summarize this video')")
  .option("-k, --api-key <key>", "Google API key (or set GOOGLE_API_KEY env)")
  .option("-m, --model <model>", "Model: flash (default), flash-2.5, pro", "flash")
  .option("--fps <number>", "Frames per second for video (default: 1)")
  .option("--start <seconds>", "Start offset in seconds (video only)")
  .option("--end <seconds>", "End offset in seconds (video only)")
  .option("--low-res", "Use low resolution mode (fewer tokens)")
  .option("-v, --verbose", "Show token usage")
  .option("--fields <fields>", "Comma-separated fields to include in output (e.g., response,model)")
  .action(async (source: string, prompt: string, options) => {
    try {
      if (options.apiKey) {
        process.env.GOOGLE_API_KEY = options.apiKey;
      } else {
        const apiKey = await getApiKey("GOOGLE_API_KEY", "Google");
        if (!apiKey) {
          console.error(chalk.red("Google API key required."));
          console.error(chalk.dim("Use --api-key or set GOOGLE_API_KEY environment variable"));
          process.exit(1);
        }
      }

      const spinner = ora("Analyzing source...").start();
      const result = await executeAnalyze({
        source,
        prompt,
        model: options.model as "flash" | "flash-2.5" | "pro",
        fps: options.fps ? parseFloat(options.fps) : undefined,
        start: options.start ? parseInt(options.start, 10) : undefined,
        end: options.end ? parseInt(options.end, 10) : undefined,
        lowRes: options.lowRes,
      });

      if (!result.success) {
        spinner.fail(chalk.red(result.error || "Analysis failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Analysis complete"));

      if (isJsonMode()) {
        let result_obj: Record<string, unknown> = { success: true, response: result.response, sourceType: result.sourceType, model: result.model };
        if (result.totalTokens) {
          result_obj = { ...result_obj, promptTokens: result.promptTokens, responseTokens: result.responseTokens, totalTokens: result.totalTokens };
        }
        if (options.fields) {
          const fields = options.fields.split(",").map((f: string) => f.trim());
          result_obj = Object.fromEntries(Object.entries(result_obj).filter(([k]) => fields.includes(k) || k === "success"));
        }
        outputResult(result_obj);
        return;
      }

      console.log();
      console.log(result.response);
      console.log();

      if (options.verbose && result.totalTokens) {
        console.log(chalk.dim("-".repeat(40)));
        console.log(chalk.dim(`Source type: ${result.sourceType}`));
        console.log(chalk.dim(`Model: ${result.model}`));
        if (result.promptTokens) {
          console.log(chalk.dim(`Prompt tokens: ${result.promptTokens.toLocaleString()}`));
        }
        if (result.responseTokens) {
          console.log(chalk.dim(`Response tokens: ${result.responseTokens.toLocaleString()}`));
        }
        console.log(chalk.dim(`Total tokens: ${result.totalTokens.toLocaleString()}`));
      }
    } catch (error) {
      console.error(chalk.red("Analysis failed"));
      console.error(error);
      process.exit(1);
    }
  });

// ── analyze video ──────────────────────────────────────────────────────

analyzeCommand
  .command("video")
  .description("Analyze video using Gemini (summarize, Q&A, extract info)")
  .argument("<source>", "Video file path or YouTube URL")
  .argument("<prompt>", "Analysis prompt (e.g., 'Summarize this video')")
  .option("-k, --api-key <key>", "Google API key (or set GOOGLE_API_KEY env)")
  .option("-m, --model <model>", "Model: flash (default), flash-2.5, pro", "flash")
  .option("--fps <number>", "Frames per second (default: 1, higher for action)")
  .option("--start <seconds>", "Start offset in seconds (for clipping)")
  .option("--end <seconds>", "End offset in seconds (for clipping)")
  .option("--low-res", "Use low resolution mode (fewer tokens, longer videos)")
  .option("-v, --verbose", "Show token usage")
  .option("--fields <fields>", "Comma-separated fields to include in output (e.g., response,model)")
  .action(async (source: string, prompt: string, options) => {
    try {
      if (options.apiKey) {
        process.env.GOOGLE_API_KEY = options.apiKey;
      } else {
        const apiKey = await getApiKey("GOOGLE_API_KEY", "Google");
        if (!apiKey) {
          console.error(chalk.red("Google API key required."));
          console.error(chalk.dim("Use --api-key or set GOOGLE_API_KEY environment variable"));
          process.exit(1);
        }
      }

      const spinner = ora("Analyzing video...").start();
      const result = await executeGeminiVideo({
        source,
        prompt,
        model: options.model as "flash" | "flash-2.5" | "pro",
        fps: options.fps ? parseFloat(options.fps) : undefined,
        start: options.start ? parseInt(options.start, 10) : undefined,
        end: options.end ? parseInt(options.end, 10) : undefined,
        lowRes: options.lowRes,
      });

      if (!result.success) {
        spinner.fail(chalk.red(result.error || "Video analysis failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Video analyzed"));

      if (isJsonMode()) {
        let result_obj: Record<string, unknown> = { success: true, response: result.response, model: result.model };
        if (result.totalTokens) {
          result_obj = { ...result_obj, promptTokens: result.promptTokens, responseTokens: result.responseTokens, totalTokens: result.totalTokens };
        }
        if (options.fields) {
          const fields = options.fields.split(",").map((f: string) => f.trim());
          result_obj = Object.fromEntries(Object.entries(result_obj).filter(([k]) => fields.includes(k) || k === "success"));
        }
        outputResult(result_obj);
        return;
      }

      console.log();
      console.log(result.response);
      console.log();

      if (options.verbose && result.totalTokens) {
        console.log(chalk.dim("-".repeat(40)));
        console.log(chalk.dim(`Model: ${result.model}`));
        if (result.promptTokens) {
          console.log(chalk.dim(`Prompt tokens: ${result.promptTokens.toLocaleString()}`));
        }
        if (result.responseTokens) {
          console.log(chalk.dim(`Response tokens: ${result.responseTokens.toLocaleString()}`));
        }
        console.log(chalk.dim(`Total tokens: ${result.totalTokens.toLocaleString()}`));
      }
    } catch (error) {
      console.error(chalk.red("Video analysis failed"));
      console.error(error);
      process.exit(1);
    }
  });

// ── analyze review ─────────────────────────────────────────────────────

registerReviewCommand(analyzeCommand);

// ── analyze suggest ────────────────────────────────────────────────────

analyzeCommand
  .command("suggest")
  .description("Get AI edit suggestions using Gemini")
  .argument("<project>", "Project file path")
  .argument("<instruction>", "Natural language instruction")
  .option("-k, --api-key <key>", "Google API key (or set GOOGLE_API_KEY env)")
  .option("--apply", "Apply the first suggestion automatically")
  .action(async (projectPath: string, instruction: string, options) => {
    try {
      const apiKey = await getApiKey("GOOGLE_API_KEY", "Google", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Google API key required. Use --api-key or set GOOGLE_API_KEY"));
        process.exit(1);
      }

      const spinner = ora("Initializing Gemini...").start();

      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const gemini = new GeminiProvider();
      await gemini.initialize({ apiKey });

      spinner.text = "Analyzing...";
      const clips = project.getClips();
      const suggestions = await gemini.autoEdit(clips, instruction);

      spinner.succeed(chalk.green(`Found ${suggestions.length} suggestion(s)`));

      if (isJsonMode()) {
        outputResult({ success: true, suggestions: suggestions.map(s => ({ type: s.type, description: s.description, confidence: s.confidence, clipIds: s.clipIds, params: s.params })) });
        return;
      }

      console.log();
      console.log(chalk.bold.cyan("Edit Suggestions"));
      console.log(chalk.dim("─".repeat(60)));

      for (let i = 0; i < suggestions.length; i++) {
        const sug = suggestions[i];
        console.log();
        console.log(chalk.yellow(`[${i + 1}] ${sug.type.toUpperCase()}`));
        console.log(`    ${sug.description}`);
        console.log(chalk.dim(`    Confidence: ${(sug.confidence * 100).toFixed(0)}%`));
        console.log(chalk.dim(`    Clips: ${sug.clipIds.join(", ")}`));
        console.log(chalk.dim(`    Params: ${JSON.stringify(sug.params)}`));
      }

      if (options.apply && suggestions.length > 0) {
        console.log();
        spinner.start("Applying first suggestion...");

        const sug = suggestions[0];
        const applied = applySuggestion(project, sug);

        if (applied) {
          await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");
          spinner.succeed(chalk.green("Suggestion applied"));
        } else {
          spinner.warn(chalk.yellow("Could not apply suggestion automatically"));
        }
      }

      console.log();
    } catch (error) {
      console.error(chalk.red("AI suggestion failed"));
      console.error(error);
      process.exit(1);
    }
  });
