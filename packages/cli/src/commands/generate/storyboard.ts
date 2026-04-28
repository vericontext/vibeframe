/**
 * @module generate/storyboard
 * @description `vibe generate storyboard` — Claude-powered script-to-
 * storyboard analysis. Split out of `generate.ts` in v0.69 (Plan G Phase 2).
 */

import type { Command } from "commander";
import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import chalk from "chalk";
import ora from "ora";
import { ClaudeProvider } from "@vibeframe/ai-providers";
import { requireApiKey } from "../../utils/api-key.js";
import { sanitizeLLMResponse } from "../sanitize.js";
import {
  isJsonMode,
  outputResult,
  exitWithError,
  apiError,
  usageError,
} from "../output.js";
import { rejectControlChars, validateOutputPath } from "../validate.js";
import { formatTime } from "../ai-helpers.js";

// ── Library: executeStoryboard ──────────────────────────────────────────

export interface ExecuteStoryboardOptions {
  content: string;
  duration?: number;
  creativity?: "low" | "high";
  output?: string;
  apiKey?: string;
}

export interface ExecuteStoryboardResult {
  success: boolean;
  segments?: Array<{
    description: string;
    visuals?: string;
    duration?: number;
    narration?: string;
  }>;
  segmentCount?: number;
  outputPath?: string;
  error?: string;
}

export async function executeStoryboard(
  options: ExecuteStoryboardOptions,
): Promise<ExecuteStoryboardResult> {
  const { content, duration, creativity = "low", output, apiKey } = options;

  try {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) return { success: false, error: "ANTHROPIC_API_KEY required" };

    const claude = new ClaudeProvider();
    await claude.initialize({ apiKey: key });

    const segments = await claude.analyzeContent(content, duration, { creativity });

    if (segments.length === 0) {
      return { success: false, error: "Could not generate storyboard" };
    }

    // Sanitize LLM output
    for (const seg of segments) {
      seg.description = sanitizeLLMResponse(seg.description);
      if (seg.visuals) seg.visuals = sanitizeLLMResponse(seg.visuals);
    }

    let outputPath: string | undefined;
    if (output) {
      outputPath = resolve(process.cwd(), output);
      await writeFile(outputPath, JSON.stringify(segments, null, 2), "utf-8");
    }

    return { success: true, segments, segmentCount: segments.length, outputPath };
  } catch (error) {
    return {
      success: false,
      error: `Storyboard failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ── CLI: vibe generate storyboard ───────────────────────────────────────

export function registerStoryboardCommand(parent: Command): void {
  parent
    .command("storyboard")
    .description("Generate video storyboard from content using Claude")
    .argument("<content>", "Content to analyze (text or file path)")
    .option("-k, --api-key <key>", "Anthropic API key (or set ANTHROPIC_API_KEY env)")
    .option("-o, --output <path>", "Output JSON file path")
    .option("-d, --duration <sec>", "Target total duration in seconds")
    .option("-f, --file", "Treat content argument as file path")
    .option("-c, --creativity <level>", "Creativity level: low (default, consistent) or high (varied, unexpected)", "low")
    .option("--dry-run", "Preview parameters without executing")
    .action(async (content: string, options) => {
      try {
        rejectControlChars(content);
        if (options.output) {
          validateOutputPath(options.output);
        }

        // Validate creativity level
        const creativity = options.creativity?.toLowerCase();
        if (creativity && creativity !== "low" && creativity !== "high") {
          exitWithError(usageError("Invalid creativity level. Use 'low' or 'high'."));
        }

        let textContent = content;
        if (options.file) {
          const filePath = resolve(process.cwd(), content);
          textContent = await readFile(filePath, "utf-8");
        }

        if (options.dryRun) {
          outputResult({
            dryRun: true,
            command: "generate storyboard",
            params: {
              content: textContent.substring(0, 200),
              duration: options.duration,
              creativity,
            },
          });
          return;
        }

        const apiKey = await requireApiKey(
          "ANTHROPIC_API_KEY",
          "Anthropic",
          options.apiKey,
        );

        const spinnerText = creativity === "high"
          ? "Analyzing content with high creativity..."
          : "Analyzing content...";
        const spinner = ora(spinnerText).start();

        const claude = new ClaudeProvider();
        await claude.initialize({ apiKey });

        const segments = await claude.analyzeContent(
          textContent,
          options.duration ? parseFloat(options.duration) : undefined,
          { creativity: creativity as "low" | "high" | undefined },
        );

        if (segments.length === 0) {
          spinner.fail("Could not generate storyboard");
          exitWithError(apiError("Could not generate storyboard", true));
        }

        spinner.succeed(chalk.green(`Generated ${segments.length} segments`));

        for (const seg of segments) {
          seg.description = sanitizeLLMResponse(seg.description);
          if (seg.visuals) seg.visuals = sanitizeLLMResponse(seg.visuals);
        }

        if (options.output) {
          const outputPath = resolve(process.cwd(), options.output);
          await writeFile(outputPath, JSON.stringify(segments, null, 2), "utf-8");
          if (isJsonMode()) {
            outputResult({
              success: true,
              segmentCount: segments.length,
              segments,
              outputPath,
            });
            return;
          }
        } else if (isJsonMode()) {
          outputResult({ success: true, segmentCount: segments.length, segments });
          return;
        }

        console.log();
        console.log(chalk.bold.cyan("Storyboard"));
        console.log(chalk.dim("─".repeat(60)));

        for (const seg of segments) {
          console.log();
          console.log(
            chalk.yellow(
              `[${seg.index + 1}] ${formatTime(seg.startTime)} - ${formatTime(seg.startTime + seg.duration)}`,
            ),
          );
          console.log(`  ${seg.description}`);
          console.log(chalk.dim(`  Visuals: ${seg.visuals}`));
          if (seg.audio) {
            console.log(chalk.dim(`  Audio: ${seg.audio}`));
          }
          if (seg.textOverlays && seg.textOverlays.length > 0) {
            console.log(chalk.dim(`  Text: ${seg.textOverlays.join(", ")}`));
          }
        }
        console.log();

        if (options.output) {
          console.log(chalk.green(`Saved to: ${resolve(process.cwd(), options.output)}`));
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        exitWithError(apiError(`Storyboard generation failed: ${msg}`, true));
      }
    });
}
