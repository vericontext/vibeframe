/**
 * ai-motion.ts — Motion graphics command (vibe ai motion).
 *
 * Extracted from ai.ts as part of modularisation.
 * ai.ts re-exports all public types and functions from this module.
 */

import { type Command } from 'commander';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import ora from 'ora';
import { ClaudeProvider } from '@vibeframe/ai-providers';
import { getApiKey } from '../utils/api-key.js';

// ── Motion: exported function for Agent tool ────────────────────────────────

export interface MotionCommandOptions {
  description: string;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  style?: string;
  /** If set, render the generated code with Remotion */
  render?: boolean;
  /** Base video to composite the motion graphic onto */
  video?: string;
  /** Output path (TSX if code-only, WebM/MP4 if rendered) */
  output?: string;
}

export interface MotionCommandResult {
  success: boolean;
  codePath?: string;
  renderedPath?: string;
  compositedPath?: string;
  componentName?: string;
  error?: string;
}

export async function executeMotion(options: MotionCommandOptions): Promise<MotionCommandResult> {
  const apiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic");
  if (!apiKey) {
    return { success: false, error: "Anthropic API key required (set ANTHROPIC_API_KEY)" };
  }

  const width = options.width || 1920;
  const height = options.height || 1080;
  const fps = options.fps || 30;
  const duration = options.duration || 5;

  const claude = new ClaudeProvider();
  await claude.initialize({ apiKey });

  const result = await claude.generateMotion(options.description, {
    duration,
    width,
    height,
    fps,
    style: options.style as "minimal" | "corporate" | "playful" | "cinematic" | undefined,
  });

  if (!result.success || !result.component) {
    return { success: false, error: result.error || "Motion generation failed" };
  }

  const { component } = result;
  const defaultOutput = options.video ? "motion-output.mp4" : options.render ? "motion.webm" : "motion.tsx";
  const outputPath = resolve(process.cwd(), options.output || defaultOutput);

  // Save TSX code
  const codePath = outputPath.replace(/\.\w+$/, ".tsx");
  await writeFile(codePath, component.code, "utf-8");

  const shouldRender = options.render || !!options.video;
  if (!shouldRender) {
    return { success: true, codePath, componentName: component.name };
  }

  // Render (and optionally composite onto video)
  const { ensureRemotionInstalled, renderMotion, wrapComponentWithVideo, renderWithEmbeddedVideo } = await import("../utils/remotion.js");

  const notInstalled = await ensureRemotionInstalled();
  if (notInstalled) {
    return { success: false, codePath, componentName: component.name, error: notInstalled };
  }

  const baseVideo = options.video ? resolve(process.cwd(), options.video) : undefined;

  if (baseVideo) {
    // Embed video inside the component (no transparency needed)
    const videoFileName = "source_video.mp4";
    const wrapped = wrapComponentWithVideo(component.code, component.name, videoFileName);

    const renderResult = await renderWithEmbeddedVideo({
      componentCode: wrapped.code,
      componentName: wrapped.name,
      width,
      height,
      fps,
      durationInFrames: component.durationInFrames,
      videoPath: baseVideo,
      videoFileName,
      outputPath,
    });

    if (!renderResult.success) {
      return { success: false, codePath, componentName: component.name, error: renderResult.error };
    }

    return { success: true, codePath, componentName: component.name, compositedPath: renderResult.outputPath };
  }

  // No base video — render standalone
  const renderResult = await renderMotion({
    componentCode: component.code,
    componentName: component.name,
    width,
    height,
    fps,
    durationInFrames: component.durationInFrames,
    outputPath,
    transparent: false,
  });

  if (!renderResult.success) {
    return { success: false, codePath, componentName: component.name, error: renderResult.error };
  }

  return { success: true, codePath, componentName: component.name, renderedPath: renderResult.outputPath };
}

/**
 * Register the 'motion' sub-command on the given parent command.
 * Called from ai.ts: registerMotionCommand(aiCommand)
 */
export function registerMotionCommand(aiCommand: Command): void {
  aiCommand
    .command("motion")
    .description("Generate motion graphics using Claude + Remotion (render & composite)")
    .argument("<description>", "Natural language description of the motion graphic")
    .option("-k, --api-key <key>", "Anthropic API key (or set ANTHROPIC_API_KEY env)")
    .option("-o, --output <path>", "Output file path", "motion.tsx")
    .option("-d, --duration <sec>", "Duration in seconds", "5")
    .option("-w, --width <px>", "Width in pixels", "1920")
    .option("-h, --height <px>", "Height in pixels", "1080")
    .option("--fps <fps>", "Frame rate", "30")
    .option("-s, --style <style>", "Style preset: minimal, corporate, playful, cinematic")
    .option("--render", "Render the generated code with Remotion (output .webm)")
    .option("--video <path>", "Base video to composite the motion graphic onto")
    .action(async (description: string, options) => {
      try {
        const shouldRender = options.render || !!options.video;

        const spinner = ora("Generating motion graphic...").start();

        const result = await executeMotion({
          description,
          duration: parseFloat(options.duration),
          width: parseInt(options.width),
          height: parseInt(options.height),
          fps: parseInt(options.fps),
          style: options.style,
          render: options.render,
          video: options.video,
          output: options.output !== "motion.tsx" ? options.output : undefined,
        });

        if (!result.success) {
          spinner.fail(chalk.red(result.error || "Motion generation failed"));
          if (result.codePath) {
            console.log(chalk.dim(`TSX code saved to: ${result.codePath}`));
          }
          process.exit(1);
        }

        spinner.succeed(chalk.green("Motion graphic generated"));

        console.log();
        console.log(chalk.bold.cyan("Motion Graphics Pipeline"));
        console.log(chalk.dim("─".repeat(60)));

        if (result.codePath) {
          console.log(chalk.green(`  Code: ${result.codePath}`));
        }
        if (result.renderedPath) {
          console.log(chalk.green(`  Rendered: ${result.renderedPath}`));
        }
        if (result.compositedPath) {
          console.log(chalk.green(`  Composited: ${result.compositedPath}`));
        }

        if (!shouldRender) {
          console.log();
          console.log(chalk.dim("To render, add --render flag or --video <path>:"));
          console.log(chalk.dim(`  vibe ai motion "${description}" --render -o motion.webm`));
          console.log(chalk.dim(`  vibe ai motion "${description}" --video input.mp4 -o output.mp4`));
        }

        console.log();
      } catch (error) {
        console.error(chalk.red("Motion generation failed"));
        console.error(error);
        process.exit(1);
      }
    });
}
