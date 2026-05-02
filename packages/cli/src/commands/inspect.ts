/**
 * @module inspect
 *
 * Top-level `vibe inspect` command group for media analysis. (Renamed
 * from `analyze` in v0.74; `analyze` and `az` aliases were removed in
 * v0.75. The rename clarifies the read-only intent — `analyze` doubled
 * as both group and verb in the old design.)
 *
 * Commands:
 *   inspect project - Local project completeness and composition checks
 *   inspect render  - Local rendered video checks plus optional Gemini review
 *   inspect media   - Unified analysis for images, videos, and YouTube URLs (Gemini)
 *   inspect video   - Analyze video files or YouTube URLs with Gemini
 *   inspect review  - AI video quality review and auto-fix (Gemini)
 *   inspect suggest - Get AI edit suggestions using Gemini
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
import { requireApiKey } from "../utils/api-key.js";
import { applySuggestion } from "./ai-helpers.js";
import { executeAnalyze, executeGeminiVideo } from "./ai-analyze.js";
import { registerReviewCommand } from "./ai-review.js";
import { isJsonMode, outputSuccess, exitWithError, apiError, generalError, usageError } from "./output.js";
import { sanitizeLLMResponse } from "./sanitize.js";
import { rejectControlChars } from "./validate.js";
import { applyTier } from "./_shared/cost-tier.js";
import { inspectProject } from "./_shared/scene-inspect.js";
import {
  inspectRender,
  previewInspectRender,
  type RenderInspectModel,
} from "./_shared/render-inspect.js";
import type { ReviewIssue, ReviewStatus } from "./_shared/review-report.js";

const VALID_RENDER_AI_MODELS: RenderInspectModel[] = ["flash", "flash-2.5", "pro"];

export const inspectCommand = new Command("inspect")
  .description("Inspect media using AI (images, videos, YouTube URLs)")
  .addHelpText(
    "after",
    `
Examples:
  $ vibe inspect project my-video --json
  $ vibe inspect render my-video --cheap --json
  $ vibe inspect render my-video --ai --json
  $ vibe inspect media image.png "Describe this image"
  $ vibe inspect media video.mp4 "Summarize this video"
  $ vibe inspect media "https://youtube.com/watch?v=..." "Key takeaways"
  $ vibe inspect video video.mp4 "List all scene changes" --low-res
  $ vibe inspect review video.mp4 --auto-apply -o fixed.mp4
  $ vibe inspect suggest timeline.json "make it more dramatic"

API Keys:
  GOOGLE_API_KEY  Required for all inspect commands (Gemini)

Use '--fields response,model' to limit output size.
Run 'vibe schema inspect.<command>' for structured parameter info.
`
  );

// ── inspect project ───────────────────────────────────────────────────

inspectCommand
  .command("project")
  .description("Inspect project completeness, storyboard validity, scene lint, and asset references")
  .argument("[project-dir]", "VibeFrame project directory", ".")
  .option("-o, --output <path>", "Write review report to this path (default: <project>/review-report.json)")
  .option("--no-report", "Do not write review-report.json")
  .action(async (projectDirArg: string, options) => {
    const startedAt = Date.now();
    try {
      const result = await inspectProject({
        projectDir: resolve(projectDirArg),
        outputPath: options.output,
        writeReport: options.report !== false,
      });
      if (isJsonMode()) {
        outputSuccess({
          command: "inspect project",
          startedAt,
          data: { ...result },
        });
        if (result.status === "fail") process.exitCode = 1;
        return;
      }

      printInspectSummary("Project Inspection", result.status, result.score, result.issues, result.reportPath);
      if (result.status === "fail") process.exitCode = 1;
    } catch (error) {
      exitWithError(generalError(`Project inspection failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  });
applyTier(inspectCommand.commands[inspectCommand.commands.length - 1], "free");

// ── inspect render ────────────────────────────────────────────────────

inspectCommand
  .command("render")
  .description("Inspect a rendered project video with local checks and optional Gemini review")
  .argument("[project-dir]", "VibeFrame project directory", ".")
  .option("--cheap", "Run local checks only (default; no AI/API calls)")
  .option("--ai", "Also run Gemini video review and merge findings into review-report.json")
  .option("-m, --model <model>", "Gemini model for --ai: flash (default), flash-2.5, pro", "flash")
  .option("--video <path>", "Rendered video path. Defaults to build-report outputPath or latest renders/* video.")
  .option("-o, --output <path>", "Write review report to this path (default: <project>/review-report.json)")
  .option("--no-report", "Do not write review-report.json")
  .option("--dry-run", "Preview parameters without probing video or calling Gemini")
  .action(async (projectDirArg: string, options) => {
    const startedAt = Date.now();
    try {
      const model = parseRenderAiModel(options.model);
      const projectDir = resolve(projectDirArg);
      if (options.dryRun) {
        const result = await previewInspectRender({
          projectDir,
          videoPath: options.video,
          outputPath: options.output,
          writeReport: options.report !== false,
          ai: options.ai === true,
          model,
        });
        outputSuccess({
          command: "inspect render",
          startedAt,
          dryRun: true,
          costUsd: options.ai ? 0.1 : 0,
          data: { ...result },
        });
        return;
      }

      const result = await inspectRender({
        projectDir,
        videoPath: options.video,
        outputPath: options.output,
        writeReport: options.report !== false,
        ai: options.ai === true,
        model,
      });
      if (isJsonMode()) {
        outputSuccess({
          command: "inspect render",
          startedAt,
          data: { ...result },
        });
        if (result.status === "fail") process.exitCode = 1;
        return;
      }

      printInspectSummary("Render Inspection", result.status, result.score, result.issues, result.reportPath);
      if (result.status === "fail") process.exitCode = 1;
    } catch (error) {
      exitWithError(generalError(`Render inspection failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  });
applyTier(inspectCommand.commands[inspectCommand.commands.length - 1], "low");

// ── analyze media ──────────────────────────────────────────────────────

inspectCommand
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
  .option("--verbose", "Show token usage")
  .option("--fields <fields>", "Comma-separated fields to include in output (e.g., response,model)")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (source: string, prompt: string, options) => {
    const startedAt = Date.now();
    try {
      rejectControlChars(prompt);

      if (options.dryRun) {
        outputSuccess({
          command: "inspect media",
          startedAt,
          dryRun: true,
          data: {
            params: {
              source,
              prompt,
              model: options.model,
              fps: options.fps,
              start: options.start,
              end: options.end,
              lowRes: options.lowRes ?? false,
            },
          },
        });
        return;
      }

      if (options.apiKey) {
        process.env.GOOGLE_API_KEY = options.apiKey;
      } else {
        await requireApiKey("GOOGLE_API_KEY", "Google");
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
        spinner.fail();
        exitWithError(apiError(result.error || "Analysis failed", true));
      }

      spinner.succeed(chalk.green("Analysis complete"));

      const response = sanitizeLLMResponse(result.response || "");

      if (isJsonMode()) {
        const data: Record<string, unknown> = { response, sourceType: result.sourceType, model: result.model };
        if (result.totalTokens) {
          data.promptTokens = result.promptTokens;
          data.responseTokens = result.responseTokens;
          data.totalTokens = result.totalTokens;
        }
        outputSuccess({
          command: "inspect media",
          startedAt,
          data,
        });
        return;
      }

      console.log();
      console.log(response);
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
      exitWithError(apiError(`Analysis failed: ${(error as Error).message}`));
    }
  });
applyTier(inspectCommand.commands[inspectCommand.commands.length - 1], "low");

function printInspectSummary(
  title: string,
  status: ReviewStatus,
  score: number,
  issues: ReviewIssue[],
  reportPath?: string,
): void {
  const color = status === "pass" ? chalk.green : status === "warn" ? chalk.yellow : chalk.red;
  console.log();
  console.log(chalk.bold.cyan(title));
  console.log(chalk.dim("-".repeat(60)));
  console.log(`  Status: ${color(status)}  Score: ${score}/100`);
  if (reportPath) console.log(`  Report: ${chalk.dim(reportPath)}`);
  if (issues.length === 0) {
    console.log();
    console.log(chalk.green("  No issues found."));
    return;
  }
  console.log();
  for (const issue of issues) {
    const tag = issue.severity === "error" ? chalk.red("error") : issue.severity === "warning" ? chalk.yellow("warn") : chalk.blue("info");
    const loc = issue.file ? chalk.dim(` ${issue.file}`) : issue.scene ? chalk.dim(` ${issue.scene}`) : "";
    console.log(`  ${tag} ${chalk.dim(`[${issue.code}]`)}${loc} ${issue.message}`);
    if (issue.suggestedFix) console.log(`       ${chalk.dim(issue.suggestedFix)}`);
  }
}

function parseRenderAiModel(value: string): RenderInspectModel {
  if (VALID_RENDER_AI_MODELS.includes(value as RenderInspectModel)) {
    return value as RenderInspectModel;
  }
  exitWithError(usageError(`Invalid --model: ${value}`, `Must be one of: ${VALID_RENDER_AI_MODELS.join(", ")}`));
}

// ── analyze video ──────────────────────────────────────────────────────

inspectCommand
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
  .option("--verbose", "Show token usage")
  .option("--fields <fields>", "Comma-separated fields to include in output (e.g., response,model)")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (source: string, prompt: string, options) => {
    const startedAt = Date.now();
    try {
      rejectControlChars(prompt);

      if (options.dryRun) {
        outputSuccess({
          command: "inspect video",
          startedAt,
          dryRun: true,
          data: {
            params: {
              source,
              prompt,
              model: options.model,
              fps: options.fps,
              start: options.start,
              end: options.end,
              lowRes: options.lowRes ?? false,
            },
          },
        });
        return;
      }

      if (options.apiKey) {
        process.env.GOOGLE_API_KEY = options.apiKey;
      } else {
        await requireApiKey("GOOGLE_API_KEY", "Google");
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
        spinner.fail();
        exitWithError(apiError(result.error || "Video analysis failed", true));
      }

      spinner.succeed(chalk.green("Video analyzed"));

      const response = sanitizeLLMResponse(result.response || "");

      if (isJsonMode()) {
        const data: Record<string, unknown> = { response, model: result.model };
        if (result.totalTokens) {
          data.promptTokens = result.promptTokens;
          data.responseTokens = result.responseTokens;
          data.totalTokens = result.totalTokens;
        }
        outputSuccess({
          command: "inspect video",
          startedAt,
          data,
        });
        return;
      }

      console.log();
      console.log(response);
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
      exitWithError(apiError(`Video analysis failed: ${(error as Error).message}`));
    }
  });
applyTier(inspectCommand.commands[inspectCommand.commands.length - 1], "low");

// ── analyze review ─────────────────────────────────────────────────────

registerReviewCommand(inspectCommand);
applyTier(inspectCommand.commands[inspectCommand.commands.length - 1], "low");

// ── analyze suggest ────────────────────────────────────────────────────

inspectCommand
  .command("suggest")
  .description("Get AI edit suggestions using Gemini")
  .argument("<project>", "Timeline file or directory")
  .argument("<instruction>", "Natural language instruction")
  .option("-k, --api-key <key>", "Google API key (or set GOOGLE_API_KEY env)")
  .option("--apply", "Apply the first suggestion automatically")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (projectPath: string, instruction: string, options) => {
    const startedAt = Date.now();
    try {
      rejectControlChars(instruction);

      if (options.dryRun) {
        outputSuccess({
          command: "inspect suggest",
          startedAt,
          dryRun: true,
          data: {
            params: {
              project: projectPath,
              instruction,
              apply: options.apply ?? false,
            },
          },
        });
        return;
      }

      const apiKey = await requireApiKey("GOOGLE_API_KEY", "Google", options.apiKey);

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
        outputSuccess({
          command: "inspect suggest",
          startedAt,
          data: {
            suggestions: suggestions.map(s => ({ type: s.type, description: s.description, confidence: s.confidence, clipIds: s.clipIds, params: s.params })),
          },
        });
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
      exitWithError(apiError(`AI suggestion failed: ${(error as Error).message}`));
    }
  });
applyTier(inspectCommand.commands[inspectCommand.commands.length - 1], "low");
