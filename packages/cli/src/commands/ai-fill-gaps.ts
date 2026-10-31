/**
 * @module ai-fill-gaps
 * @description Fill timeline gaps with AI-generated video (Kling image-to-video).
 *
 * ## Commands: vibe edit fill-gaps
 * ## Dependencies: Kling
 *
 * Post-v0.69 Phase 4: the 562-line `.action()` body is extracted into
 * `executeFillGaps` (commands/_shared/execute-fill-gaps.ts) so the
 * manifest entry `edit_fill_gaps` can call the same logic. This file
 * remains the CLI registration site — it wires `onProgress` to ora
 * spinners and prints `humanLines` on completion.
 */

import { type Command } from "commander";
import chalk from "chalk";
import {
  failureFromError,
  spinner as createSpinner,
  exitWithError,
  apiError,
  isJsonMode,
  isQuietMode,
  lookupCostEstimateUpperBound,
  outputSuccess,
  providerFailure,
} from "./output.js";
import { validateOutputPath } from "./validate.js";
import { executeFillGaps } from "./_shared/execute-fill-gaps.js";
import { upperBoundCost } from "./_shared/actual-cost.js";

export function registerFillGapsCommand(aiCommand: Command): void {
  aiCommand
    .command("fill-gaps")
    .description("Fill timeline gaps with AI-generated video (Kling image-to-video)")
    .argument("<project>", "Timeline file or directory")
    .option("-p, --provider <provider>", "AI provider (kling)", "kling")
    .option("-o, --output <path>", "Output project path (default: overwrite)")
    .option("-d, --dir <path>", "Directory to save generated videos")
    .option("--prompt <text>", "Custom prompt for video generation")
    .option("--dry-run", "Show gaps without generating")
    .option("--mode <mode>", "Generation mode: std or pro (Kling)", "std")
    .option("-r, --ratio <ratio>", "Aspect ratio: 16:9, 9:16, or 1:1", "16:9")
    .action(async (projectPath: string, options) => {
      const startedAt = Date.now();
      try {
        if (options.output) {
          validateOutputPath(options.output);
        }

        const spinner = createSpinner("Loading project...").start();
        let lastProgressMessage = "";

        const result = await executeFillGaps({
          projectPath,
          output: options.output,
          dir: options.dir,
          prompt: options.prompt,
          dryRun: options.dryRun,
          mode: options.mode as "std" | "pro" | undefined,
          ratio: options.ratio as "16:9" | "9:16" | "1:1" | undefined,
          onProgress: (message: string) => {
            lastProgressMessage = message;
            spinner.text = message;
          },
        });

        // Stop the spinner with a meaningful final state.
        if (result.success) {
          spinner.succeed(chalk.green(lastProgressMessage || "Done"));
        } else {
          spinner.fail(chalk.red(result.error || "Fill gaps failed"));
          const message = result.error || "Fill gaps failed";
          exitWithError(result.errorKind ? providerFailure(message, result.errorKind) : apiError(message, true));
        }

        if (isJsonMode() || isQuietMode()) {
          // One generated video per gap; video providers are not metered.
          const cost = result.dryRun
            ? undefined
            : upperBoundCost(lookupCostEstimateUpperBound("edit fill-gaps"), result.generatedCount ?? 0, options.provider);
          outputSuccess({
            command: "edit fill-gaps",
            startedAt,
            dryRun: result.dryRun,
            ...(cost ? { costUsd: cost.costUsd, costEstimated: cost.estimated, warnings: cost.warnings } : {}),
            data: {
              outputPath: result.outputPath,
              gaps: result.gaps ?? [],
              gapsNeedingAI: result.gapsNeedingAI ?? [],
              generatedCount: result.generatedCount ?? 0,
              noGaps: result.noGaps ?? false,
              allExtendable: result.allExtendable ?? false,
            },
          });
          return;
        }

        // Print humanLines (the action body's previous console.log output).
        for (const line of result.humanLines) {
          console.log(line);
        }
      } catch (error) {
        exitWithError(failureFromError(error, "Fill gaps failed", { retryable: true }));
      }
    });
}
