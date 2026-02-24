/**
 * ai-motion.ts — Motion graphics command (vibe ai motion).
 *
 * Extracted from ai.ts as part of modularisation.
 * ai.ts re-exports all public types and functions from this module.
 */

import { type Command } from 'commander';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import ora from 'ora';
import { ClaudeProvider, GeminiProvider } from '@vibeframe/ai-providers';
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
  /** Image to analyze with Gemini — color/mood/composition fed into Claude prompt */
  image?: string;
  /** Path to existing TSX file to refine instead of generating from scratch */
  fromTsx?: string;
  /**
   * LLM model alias for code generation.
   * sonnet (default) | opus | gemini | gemini-3.1-pro
   */
  model?: string;
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

// Map model alias → { provider, modelId }
const MODEL_MAP: Record<string, { provider: "claude" | "gemini"; modelId: string }> = {
  sonnet:          { provider: "claude",  modelId: "claude-sonnet-4-6" },
  opus:            { provider: "claude",  modelId: "claude-opus-4-6" },
  gemini:          { provider: "gemini",  modelId: "gemini-2.5-pro" },
  "gemini-3.1-pro": { provider: "gemini", modelId: "gemini-3.1-pro-preview" },
};

export async function executeMotion(options: MotionCommandOptions): Promise<MotionCommandResult> {
  const modelAlias = options.model || "sonnet";
  const modelConfig = MODEL_MAP[modelAlias] ?? MODEL_MAP["sonnet"];
  const useGemini = modelConfig.provider === "gemini";

  const width = options.width || 1920;
  const height = options.height || 1080;
  const fps = options.fps || 30;
  const duration = options.duration || 5;

  // Resolve API key based on provider
  let apiKey: string | null;
  if (useGemini) {
    apiKey = await getApiKey("GOOGLE_API_KEY", "Google");
    if (!apiKey) return { success: false, error: "GOOGLE_API_KEY required for Gemini motion generation" };
  } else {
    apiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic");
    if (!apiKey) return { success: false, error: "ANTHROPIC_API_KEY required for Claude motion generation" };
  }

  // Step 0 (optional): Analyze image with Gemini, inject into description
  let enrichedDescription = options.description;
  if (options.image) {
    const geminiApiKey = await getApiKey("GOOGLE_API_KEY", "Google");
    if (!geminiApiKey) {
      return { success: false, error: "GOOGLE_API_KEY required for image analysis (--image)" };
    }

    const imagePath = resolve(process.cwd(), options.image);
    const imageBuffer = await readFile(imagePath);

    const gemini = new GeminiProvider();
    await gemini.initialize({ apiKey: geminiApiKey });

    const analysisResult = await gemini.analyzeImage(imageBuffer, `Analyze this image for motion graphics design purposes. Describe:
1. Dominant color palette (exact hex values if possible)
2. Subject placement and safe zones (where NOT to put text/graphics)
3. Overall mood and atmosphere
4. Lighting style (warm/cool, bright/dark, dramatic/soft)
5. Key visual elements and their positions

Be specific and concise — this analysis will guide a Remotion animation generator.`);

    if (analysisResult.success && analysisResult.response) {
      enrichedDescription = `${options.description}

[Image Analysis Context]
${analysisResult.response}

Use this image analysis to inform the color palette, typography placement, and overall aesthetic of the motion graphic.`;
    }
  }

  type MotionResult = Awaited<ReturnType<InstanceType<typeof ClaudeProvider>["generateMotion"]>>;
  let result: MotionResult;

  if (options.fromTsx) {
    // Refine mode: modify existing TSX instead of generating from scratch
    const tsxPath = resolve(process.cwd(), options.fromTsx);
    if (!existsSync(tsxPath)) {
      return { success: false, error: `TSX file not found: ${tsxPath}` };
    }
    const existingCode = await readFile(tsxPath, "utf-8");

    if (useGemini) {
      const gemini = new GeminiProvider();
      await gemini.initialize({ apiKey });
      result = await gemini.refineMotion(existingCode, options.description, {
        duration, width, height, fps, model: modelConfig.modelId,
      });
    } else {
      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey });
      result = await claude.refineMotion(existingCode, options.description, {
        duration, width, height, fps,
      });
    }
  } else {
    if (useGemini) {
      const gemini = new GeminiProvider();
      await gemini.initialize({ apiKey });
      result = await gemini.generateMotion(enrichedDescription, {
        duration, width, height, fps,
        style: options.style,
        model: modelConfig.modelId,
      });
    } else {
      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey });
      result = await claude.generateMotion(enrichedDescription, {
        duration, width, height, fps,
        style: options.style as "minimal" | "corporate" | "playful" | "cinematic" | undefined,
      });
    }
  }

  if (!result.success || !result.component) {
    return { success: false, error: result.error || "Motion generation failed" };
  }

  const { component } = result;
  const defaultOutput = (options.video || options.image) ? "motion-output.mp4" : options.render ? "motion.webm" : "motion.tsx";
  const outputPath = resolve(process.cwd(), options.output || defaultOutput);

  // Save TSX code
  const codePath = outputPath.replace(/\.\w+$/, ".tsx");
  await writeFile(codePath, component.code, "utf-8");

  const shouldRender = options.render || !!options.video || !!options.image;
  if (!shouldRender) {
    return { success: true, codePath, componentName: component.name };
  }

  // Render (and optionally composite onto video)
  const {
    ensureRemotionInstalled,
    renderMotion,
    wrapComponentWithVideo,
    renderWithEmbeddedVideo,
    wrapComponentWithImage,
    renderWithEmbeddedImage,
  } = await import("../utils/remotion.js");

  const notInstalled = await ensureRemotionInstalled();
  if (notInstalled) {
    return { success: false, codePath, componentName: component.name, error: notInstalled };
  }

  const baseVideo = options.video ? resolve(process.cwd(), options.video) : undefined;
  const baseImage = options.image ? resolve(process.cwd(), options.image) : undefined;

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

  if (baseImage) {
    // Embed image as background — motion graphic overlaid on top
    const ext = baseImage.split(".").pop() || "png";
    const imageFileName = `source_image.${ext}`;
    const wrapped = wrapComponentWithImage(component.code, component.name, imageFileName);

    const renderResult = await renderWithEmbeddedImage({
      componentCode: wrapped.code,
      componentName: wrapped.name,
      width,
      height,
      fps,
      durationInFrames: component.durationInFrames,
      imagePath: baseImage,
      imageFileName,
      outputPath,
    });

    if (!renderResult.success) {
      return { success: false, codePath, componentName: component.name, error: renderResult.error };
    }

    return { success: true, codePath, componentName: component.name, compositedPath: renderResult.outputPath };
  }

  // No base media — render standalone
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
    .option("--image <path>", "Image to analyze with Gemini — color/mood fed into Claude prompt")
    .option("--from-tsx <path>", "Refine an existing TSX file instead of generating from scratch")
    .option("-m, --model <alias>", "LLM model: sonnet (default), opus, gemini, gemini-3.1-pro", "sonnet")
    .action(async (description: string, options) => {
      try {
        const shouldRender = options.render || !!options.video || !!options.image;

        const spinner = ora("Generating motion graphic...").start();
        if (options.image) {
          spinner.text = "Analyzing image with Gemini...";
        }

        const result = await executeMotion({
          description,
          duration: parseFloat(options.duration),
          width: parseInt(options.width),
          height: parseInt(options.height),
          fps: parseInt(options.fps),
          style: options.style,
          render: options.render,
          video: options.video,
          image: options.image,
          fromTsx: options.fromTsx,
          model: options.model,
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
