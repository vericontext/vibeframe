/**
 * @module generate/music-status
 * @description `vibe generate music-status` (hidden) — Replicate music
 * generation status check. Split out of `generate.ts` in v0.69 (Plan G
 * Phase 2).
 */

import type { Command } from "commander";
import chalk from "chalk";
import { ReplicateProvider } from "@vibeframe/ai-providers";
import { requireApiKey, hasApiKey } from "../../utils/api-key.js";
import { getApiKeyFromConfig } from "../../config/index.js";
import { isJsonMode, outputResult, exitWithError, apiError } from "../output.js";

// ── Library: executeMusicStatus ─────────────────────────────────────────

export interface ExecuteMusicStatusOptions {
  taskId: string;
  apiKey?: string;
}
export interface ExecuteMusicStatusResult {
  success: boolean;
  taskId?: string;
  status?: "completed" | "failed" | "processing";
  audioUrl?: string;
  error?: string;
}

export async function executeMusicStatus(
  options: ExecuteMusicStatusOptions,
): Promise<ExecuteMusicStatusResult> {
  try {
    const apiKey =
      options.apiKey ??
      (hasApiKey("REPLICATE_API_TOKEN")
        ? ((await getApiKeyFromConfig("replicate")) ||
          process.env.REPLICATE_API_TOKEN!)
        : null);
    if (!apiKey)
      return { success: false, error: "REPLICATE_API_TOKEN required for music status" };

    const replicate = new ReplicateProvider();
    await replicate.initialize({ apiKey });
    const result = await replicate.getMusicStatus(options.taskId);

    const status: "completed" | "failed" | "processing" = result.audioUrl
      ? "completed"
      : result.error
        ? "failed"
        : "processing";

    return {
      success: true,
      taskId: options.taskId,
      status,
      audioUrl: result.audioUrl,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      error: `Music status check failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ── CLI: vibe generate music-status (hidden) ────────────────────────────

export function registerMusicStatusCommand(parent: Command): void {
  parent
    .command("music-status", { hidden: true })
    .description("Check music generation status")
    .argument("<task-id>", "Task ID from music generation")
    .option("-k, --api-key <key>", "Replicate API token (or set REPLICATE_API_TOKEN env)")
    .action(async (taskId: string, options) => {
      try {
        const apiKey = await requireApiKey(
          "REPLICATE_API_TOKEN",
          "Replicate",
          options.apiKey,
        );

        const replicate = new ReplicateProvider();
        await replicate.initialize({ apiKey });

        const result = await replicate.getMusicStatus(taskId);

        if (isJsonMode()) {
          const status = result.audioUrl
            ? "completed"
            : result.error
              ? "failed"
              : "processing";
          outputResult({
            success: true,
            taskId,
            status,
            audioUrl: result.audioUrl,
            error: result.error,
          });
          return;
        }

        console.log();
        console.log(chalk.bold.cyan("Music Generation Status"));
        console.log(chalk.dim("─".repeat(60)));
        console.log(`Task ID: ${taskId}`);

        if (result.audioUrl) {
          console.log(`Status: ${chalk.green("completed")}`);
          console.log(`Audio URL: ${result.audioUrl}`);
        } else if (result.error) {
          console.log(`Status: ${chalk.red("failed")}`);
          console.log(`Error: ${result.error}`);
        } else {
          console.log(`Status: ${chalk.yellow("processing")}`);
        }
        console.log();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        exitWithError(apiError(`Failed to get music status: ${msg}`, true));
      }
    });
}
