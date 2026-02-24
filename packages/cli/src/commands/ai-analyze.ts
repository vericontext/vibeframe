import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { existsSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import { GeminiProvider } from "@vibeframe/ai-providers";
import { getApiKey } from "../utils/api-key.js";

export interface GeminiVideoOptions {
  source: string;
  prompt: string;
  model?: "flash" | "flash-2.5" | "pro";
  fps?: number;
  start?: number;
  end?: number;
  lowRes?: boolean;
}

export interface GeminiVideoResult {
  success: boolean;
  response?: string;
  model?: string;
  totalTokens?: number;
  promptTokens?: number;
  responseTokens?: number;
  error?: string;
}

export async function executeGeminiVideo(
  options: GeminiVideoOptions
): Promise<GeminiVideoResult> {
  try {
    const apiKey = await getApiKey("GOOGLE_API_KEY", "Google");
    if (!apiKey) {
      return { success: false, error: "Google API key required" };
    }

    const isYouTube = options.source.includes("youtube.com") || options.source.includes("youtu.be");

    const modelMap: Record<string, string> = {
      flash: "gemini-3-flash-preview",
      "flash-2.5": "gemini-2.5-flash",
      pro: "gemini-2.5-pro",
    };
    const modelId = modelMap[options.model || "flash"] || modelMap.flash;

    let videoData: Buffer | string;
    if (isYouTube) {
      videoData = options.source;
    } else {
      const absPath = resolve(process.cwd(), options.source);
      if (!existsSync(absPath)) {
        return { success: false, error: `File not found: ${absPath}` };
      }
      videoData = await readFile(absPath);
    }

    const gemini = new GeminiProvider();
    await gemini.initialize({ apiKey });

    const result = await gemini.analyzeVideo(videoData, options.prompt, {
      model: modelId as "gemini-3-flash-preview" | "gemini-2.5-flash" | "gemini-2.5-pro",
      fps: options.fps,
      startOffset: options.start,
      endOffset: options.end,
      lowResolution: options.lowRes,
    });

    if (!result.success) {
      return { success: false, error: result.error || "Video analysis failed" };
    }

    return {
      success: true,
      response: result.response,
      model: result.model,
      totalTokens: result.totalTokens,
      promptTokens: result.promptTokens,
      responseTokens: result.responseTokens,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface AnalyzeOptions {
  source: string;
  prompt: string;
  model?: "flash" | "flash-2.5" | "pro";
  fps?: number;
  start?: number;
  end?: number;
  lowRes?: boolean;
}

export interface AnalyzeResult {
  success: boolean;
  response?: string;
  model?: string;
  sourceType?: "image" | "video" | "youtube";
  totalTokens?: number;
  promptTokens?: number;
  responseTokens?: number;
  error?: string;
}

export async function executeAnalyze(
  options: AnalyzeOptions
): Promise<AnalyzeResult> {
  try {
    const apiKey = await getApiKey("GOOGLE_API_KEY", "Google");
    if (!apiKey) {
      return { success: false, error: "Google API key required" };
    }

    const source = options.source;

    const isYouTube = source.includes("youtube.com") || source.includes("youtu.be");
    const isImageUrl = /^https?:\/\/.+\.(png|jpg|jpeg|webp|gif)(\?.*)?$/i.test(source);
    const isVideoUrl = /^https?:\/\/.+\.(mp4|mov|webm)(\?.*)?$/i.test(source);
    const ext = extname(source).toLowerCase();
    const imageExts = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
    const videoExts = [".mp4", ".mov", ".webm", ".avi", ".mkv"];
    const isLocalImage = imageExts.includes(ext);
    const isLocalVideo = videoExts.includes(ext);
    const isImage = isImageUrl || isLocalImage;
    const isVideo = isYouTube || isVideoUrl || isLocalVideo;

    if (!isImage && !isVideo) {
      return {
        success: false,
        error: "Cannot detect source type. Supported: images (.png/.jpg/.webp/.gif), videos (.mp4/.mov/.webm), YouTube URLs, image URLs.",
      };
    }

    const modelMap: Record<string, string> = {
      flash: "gemini-3-flash-preview",
      "flash-2.5": "gemini-2.5-flash",
      pro: "gemini-2.5-pro",
    };
    const modelId = modelMap[options.model || "flash"] || modelMap.flash;

    const gemini = new GeminiProvider();
    await gemini.initialize({ apiKey });

    if (isImage) {
      let imageBuffer: Buffer;
      if (isImageUrl) {
        const response = await fetch(source);
        if (!response.ok) {
          return { success: false, error: `Failed to fetch image: ${response.status}` };
        }
        imageBuffer = Buffer.from(await response.arrayBuffer());
      } else {
        const absPath = resolve(process.cwd(), source);
        if (!existsSync(absPath)) {
          return { success: false, error: `File not found: ${absPath}` };
        }
        imageBuffer = await readFile(absPath);
      }

      const result = await gemini.analyzeImage(imageBuffer, options.prompt, {
        model: modelId as "gemini-3-flash-preview" | "gemini-2.5-flash" | "gemini-2.5-pro",
        lowResolution: options.lowRes,
      });

      if (!result.success) {
        return { success: false, error: result.error || "Image analysis failed" };
      }

      return {
        success: true,
        response: result.response,
        model: result.model,
        sourceType: "image",
        totalTokens: result.totalTokens,
        promptTokens: result.promptTokens,
        responseTokens: result.responseTokens,
      };
    }

    let videoData: Buffer | string;
    let sourceType: "video" | "youtube" = "video";

    if (isYouTube) {
      videoData = source;
      sourceType = "youtube";
    } else if (isVideoUrl) {
      const response = await fetch(source);
      if (!response.ok) {
        return { success: false, error: `Failed to fetch video: ${response.status}` };
      }
      videoData = Buffer.from(await response.arrayBuffer());
    } else {
      const absPath = resolve(process.cwd(), source);
      if (!existsSync(absPath)) {
        return { success: false, error: `File not found: ${absPath}` };
      }
      videoData = await readFile(absPath);
    }

    const result = await gemini.analyzeVideo(videoData, options.prompt, {
      model: modelId as "gemini-3-flash-preview" | "gemini-2.5-flash" | "gemini-2.5-pro",
      fps: options.fps,
      startOffset: options.start,
      endOffset: options.end,
      lowResolution: options.lowRes,
    });

    if (!result.success) {
      return { success: false, error: result.error || "Video analysis failed" };
    }

    return {
      success: true,
      response: result.response,
      model: result.model,
      sourceType,
      totalTokens: result.totalTokens,
      promptTokens: result.promptTokens,
      responseTokens: result.responseTokens,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function registerAnalyzeCommands(aiCommand: Command): void {
  aiCommand
    .command("gemini-video")
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

  aiCommand
    .command("analyze")
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
}
