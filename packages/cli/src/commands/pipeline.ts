/**
 * @module pipeline
 *
 * Top-level `vibe pipeline` command group for AI media transformations
 * on existing video / audio files.
 *
 * For BUILDING new video from text intent (storyboard → MP4), see
 * `vibe scene build` (v0.60+) — that's the skills-driven path. Pipelines
 * here process media you already have.
 *
 * Commands:
 *   pipeline regenerate-scene - Regenerate specific scene(s) against an existing storyboard
 *   pipeline highlights       - Extract highlights from long-form content
 *   pipeline auto-shorts      - Generate short-form clips from long-form video
 *   pipeline animated-caption - Add word-by-word animated captions
 *
 * Removed in earlier cycles (skills + agent flows replaced these):
 *   pipeline script-to-video, pipeline viral, pipeline b-roll, pipeline narrate
 *
 * @dependencies Whisper, Claude, Gemini, ElevenLabs, Kling, Runway, FFmpeg
 */

import { Command } from "commander";
import { resolve, basename } from "node:path";
import { existsSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import { registerScriptPipelineCommands } from "./ai-script-pipeline-cli.js";
import { registerHighlightsCommands } from "./ai-highlights.js";
import { executeAnimatedCaption, type AnimatedCaptionStyle } from "./ai-animated-caption.js";
import { isJsonMode, outputResult, exitWithError, notFoundError, usageError, apiError, generalError } from "./output.js";

export const pipelineCommand = new Command("pipeline")
  .alias("pipe")
  .description(
    "AI media transformations on existing video / audio (highlights, auto-shorts, animated captions). For BUILD-from-text flows see `vibe scene build`."
  )
  .addHelpText(
    "after",
    `
Two flows — pick by intent:
  BUILD     — text → MP4 (intent → AI generation → new video)
              Use \`vibe scene build\` with a STORYBOARD.md + DESIGN.md.
              Idempotent, agent-editable, skills-driven (v0.60+).
  PROCESS   — existing video/audio → transformed media
              Use \`vibe pipeline\` (this group) or \`vibe edit\` / \`vibe audio\`.
              One-shot, batch-oriented, no storyboard required.

Examples (PROCESS):
  $ vibe pipeline highlights long-video.mp4 -o highlights.json -d 60
  $ vibe pipeline auto-shorts long-video.mp4 -o shorts/ -n 3 --add-captions
  $ vibe pipeline animated-caption video.mp4 -o captioned.mp4 -s highlight
  $ vibe pipeline animated-caption video.mp4 -o out.mp4 -s karaoke-sweep --fast

Required API Keys:
  highlights:          GOOGLE_API_KEY (Gemini analysis)
  auto-shorts:         GOOGLE_API_KEY + OPENAI_API_KEY (optional captions)
  animated-caption:    OPENAI_API_KEY (Whisper transcription)

Cost tiers:
  highlights:          $   Low (~$0.05)
  auto-shorts:         $$  Medium (~$0.10-$1)
  animated-caption:    $   Low (~$0.01)
  regenerate-scene:    $$$ High (per-scene re-run; depends on provider)

Note: \`pipeline script-to-video\` was removed — use \`vibe scene build\` for
text → MP4. \`pipeline regenerate-scene\` still operates on the
storyboard.{yaml,json} layout produced by older runs.

Use '--dry-run' to preview parameters before execution.
Run 'vibe schema pipeline.<command>' for structured parameter info.
`
  );

// ── pipeline regenerate-scene ──────────────────────────────────────────

registerScriptPipelineCommands(pipelineCommand);

// ── pipeline highlights & auto-shorts ──────────────────────────────────

registerHighlightsCommands(pipelineCommand);

// ── pipeline animated-caption ────────────────────────────────────────────

const ANIMATED_CAPTION_STYLES = ["highlight", "bounce", "pop-in", "neon", "karaoke-sweep", "typewriter"];

pipelineCommand
  .command("animated-caption")
  .description("Add animated captions with word-by-word effects (Whisper + Remotion/ASS)")
  .argument("<video>", "Video file path")
  .option("-s, --style <preset>", "Style preset (default: highlight)", "highlight")
  .option("--highlight-color <color>", "Active word highlight color", "#FFFF00")
  .option("--font-size <px>", "Font size (default: auto based on resolution)")
  .option("--position <pos>", "Caption position: top, center, bottom", "bottom")
  .option("--words-per-group <n>", "Words shown at once (default: auto 3-5)")
  .option("--max-chars <n>", "Max characters per group")
  .option("-l, --language <lang>", "Whisper language hint")
  .option("--fast", "Use ASS/FFmpeg only (no Remotion, forces ASS tier styles)")
  .option("-o, --output <path>", "Output file path")
  .option("--dry-run", "Preview parameters without executing")
  .addHelpText(
    "after",
    `
Examples:
  $ vibe pipeline animated-caption video.mp4 -o captioned.mp4
  $ vibe pipeline animated-caption video.mp4 -o out.mp4 -s bounce
  $ vibe pipeline animated-caption video.mp4 -o out.mp4 -s karaoke-sweep --fast

Styles:
  highlight (default)  TikTok-style background highlight on active word (Remotion)
  bounce               Words spring-animate in (Remotion)
  pop-in               Words scale-up on entry (Remotion)
  neon                 Glowing neon effect on active word (Remotion)
  karaoke-sweep        Color sweep across active word (ASS/FFmpeg, fast)
  typewriter           Words appear one by one (ASS/FFmpeg, fast)

Required API Key: OPENAI_API_KEY (Whisper transcription)
`,
  )
  .action(async (videoPath: string, options) => {
    try {
      const absVideoPath = resolve(process.cwd(), videoPath);
      if (!existsSync(absVideoPath)) {
        exitWithError(notFoundError(absVideoPath));
      }

      // Validate style
      if (!ANIMATED_CAPTION_STYLES.includes(options.style)) {
        exitWithError(usageError(`Invalid style: ${options.style}`, `Valid styles: ${ANIMATED_CAPTION_STYLES.join(", ")}`));
      }

      const outputFile = options.output || videoPath.replace(/(\.\w+)$/, "-captioned$1");

      if (options.dryRun) {
        outputResult({
          dryRun: true,
          command: "pipeline animated-caption",
          params: {
            videoPath: absVideoPath,
            outputPath: outputFile,
            style: options.style,
            highlightColor: options.highlightColor,
            fontSize: options.fontSize ? parseInt(options.fontSize) : "auto",
            position: options.position,
            wordsPerGroup: options.wordsPerGroup ? parseInt(options.wordsPerGroup) : "auto",
            maxChars: options.maxChars ? parseInt(options.maxChars) : "auto",
            language: options.language || "auto",
            fast: !!options.fast,
          },
        });
        return;
      }

      console.log();
      console.log(chalk.bold.cyan("Animated Caption Pipeline"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`  Video: ${chalk.bold(basename(absVideoPath))}`);
      console.log(`  Style: ${chalk.bold(options.style)}`);
      console.log(`  Mode:  ${chalk.bold(options.fast ? "ASS (fast)" : "Remotion")}`);
      console.log();

      const spinner = ora("Processing animated captions...").start();

      const result = await executeAnimatedCaption({
        videoPath: absVideoPath,
        outputPath: outputFile,
        style: options.style as AnimatedCaptionStyle,
        highlightColor: options.highlightColor,
        fontSize: options.fontSize ? parseInt(options.fontSize) : undefined,
        position: options.position as "top" | "center" | "bottom",
        wordsPerGroup: options.wordsPerGroup ? parseInt(options.wordsPerGroup) : undefined,
        maxChars: options.maxChars ? parseInt(options.maxChars) : undefined,
        language: options.language,
        fast: options.fast,
      });

      if (!result.success) {
        spinner.fail(result.error || "Animated caption failed");
        exitWithError(apiError(result.error || "Animated caption failed", true));
      }

      spinner.succeed(chalk.green("Animated captions applied successfully"));

      if (isJsonMode()) {
        outputResult({
          success: true,
          outputPath: result.outputPath,
          wordCount: result.wordCount,
          groupCount: result.groupCount,
          style: result.style,
          tier: result.tier,
        });
        return;
      }

      console.log();
      console.log(chalk.bold.cyan("Result"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`  Output:  ${chalk.green(result.outputPath)}`);
      console.log(`  Words:   ${result.wordCount}`);
      console.log(`  Groups:  ${result.groupCount}`);
      console.log(`  Style:   ${result.style}`);
      console.log(`  Tier:    ${result.tier}`);
      console.log();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Animated caption failed: ${msg}`));
    }
  });
