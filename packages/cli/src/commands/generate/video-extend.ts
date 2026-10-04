/**
 * @module generate/video-extend
 * @description `vibe generate video-extend` (hidden) — extend a generated
 * video from its last frame, on any provider that can (Kling, Grok classic,
 * Gemini Omni, and Veo until 2026-10-22).
 */

import type { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { findModel } from "@vibeframe/ai-providers";
import { checkModelLifecycle } from "../../utils/model-lifecycle.js";
import { executeVideoExtend } from "../ai-video.js";
import { createAndWriteJobRecord } from "../_shared/status-jobs.js";
import { isJsonMode, outputSuccess, printWarnings, exitWithError, providerFailure, usageError } from "../output.js";
import { validateOutputPath } from "../validate.js";

const EXTEND_PROVIDERS = ["kling", "grok", "omni", "veo"];

export function registerVideoExtendCommand(parent: Command): void {
  parent
    .command("video-extend", { hidden: true })
    .description("Extend a generated video from its last frame (Kling, Grok, Gemini Omni, Veo)")
    .argument("<task-id>", "Task ID the generation returned (Veo: its operation name)")
    .option("-p, --provider <provider>", `Provider: ${EXTEND_PROVIDERS.join(", ")}`, "kling")
    .option("-k, --api-key <key>", "API key for the provider")
    .option("-o, --output <path>", "Output file path")
    .option("--prompt <text>", "Continuation prompt")
    .option("-d, --duration <sec>", "Seconds to add: 5 or 10 (Kling), 2-10 (Grok), 4/6/8 (Veo); Omni picks its own", "5")
    .option("--negative <prompt>", "Negative prompt (what to avoid, Kling only)")
    .option("--veo-model <model>", "Veo model: 3.1, 3.1-fast", "3.1")
    .option("--no-wait", "Start extension and return task ID without waiting")
    .option("--dry-run", "Preview parameters without executing")
    .action(async (id: string, options) => {
      const startedAt = Date.now();
      const provider = String(options.provider || "kling").toLowerCase();
      if (!EXTEND_PROVIDERS.includes(provider)) {
        exitWithError(usageError(`Invalid provider: ${provider}. Video extend supports: ${EXTEND_PROVIDERS.join(", ")}`));
      }
      if (options.output) validateOutputPath(options.output);

      const veoSpec = provider === "veo" ? findModel("veo", "video", options.veoModel) : undefined;
      if (provider === "veo" && !veoSpec) {
        exitWithError(usageError(`Unknown Veo model "${options.veoModel}". Valid: 3.1, 3.1-fast.`));
      }
      const lifecycleWarnings = checkModelLifecycle(veoSpec);
      const params = {
        id,
        provider,
        prompt: options.prompt,
        duration: options.duration,
        negative: options.negative,
        veoModel: provider === "veo" ? options.veoModel : undefined,
      };

      if (options.dryRun) {
        outputSuccess({ command: "generate video-extend", startedAt, dryRun: true, warnings: lifecycleWarnings, data: { params } });
        return;
      }
      printWarnings(lifecycleWarnings);

      const spinner = isJsonMode() ? null : ora(`Extending ${provider} video (this may take a few minutes)...`).start();
      const result = await executeVideoExtend({
        videoId: id,
        provider,
        prompt: options.prompt,
        duration: Number(options.duration),
        negative: options.negative,
        veoModel: options.veoModel,
        output: options.output,
        wait: options.wait,
        apiKey: options.apiKey,
      });

      if (!result.success) {
        spinner?.fail(result.error ?? "Extension failed");
        const task = result.taskId ? ` (${provider} task ${result.taskId})` : "";
        exitWithError(providerFailure(`${result.error ?? "Video extension failed"}${task}`, result.errorKind));
      }

      // A job left running gets a record, so `vibe status job` can poll,
      // download, and cache it later.
      const record =
        result.status !== "completed" && result.taskId
          ? await createAndWriteJobRecord({
              jobType: "generate-video",
              provider,
              providerTaskId: result.taskId,
              providerJob: result.job,
              status: "running",
              command: "vibe generate video-extend",
              prompt: options.prompt,
              outputPath: options.output,
            })
          : undefined;

      if (isJsonMode()) {
        outputSuccess({
          command: "generate video-extend",
          startedAt,
          warnings: lifecycleWarnings,
          data: {
            provider,
            jobId: record?.id,
            statusCommand: record?.retryWith[0],
            taskId: result.taskId,
            status: result.status,
            videoUrl: result.videoUrl,
            duration: result.duration,
            outputPath: result.outputPath,
          },
        });
        return;
      }

      if (record) {
        spinner?.succeed(chalk.green(`Extension started: ${provider} task ${result.taskId}`));
        console.log(chalk.dim(`  Check it with: ${record.retryWith[0]}`));
        return;
      }
      spinner?.succeed(chalk.green("Video extended"));
      if (result.videoUrl) console.log(`Video URL: ${result.videoUrl}`);
      if (result.duration) console.log(`Duration: ${result.duration}s`);
      if (result.outputPath) console.log(chalk.green(`Saved to: ${result.outputPath}`));
    });
}
