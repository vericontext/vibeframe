/**
 * @module pipeline
 *
 * Top-level `vibe pipeline` command group for AI video pipelines.
 *
 * Commands:
 *   pipeline script-to-video  - Full script-to-video pipeline
 *   pipeline regenerate-scene - Regenerate specific scene(s)
 *   pipeline highlights       - Extract highlights from long-form content
 *   pipeline auto-shorts      - Generate short-form clips from long-form video
 *   pipeline viral            - Viral optimizer for multi-platform export
 *   pipeline b-roll           - B-roll matching using Whisper + Claude Vision
 *   pipeline narrate          - Auto-narration (Gemini + Claude/OpenAI + ElevenLabs)
 *
 * @dependencies Whisper, Claude, Gemini, ElevenLabs, Kling, Runway, FFmpeg
 */

import { Command } from "commander";
import { resolve, dirname, basename } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import { Project, type ProjectFile } from "../engine/index.js";
import { ffprobeDuration } from "../utils/exec-safe.js";
import { getAudioDuration } from "../utils/audio.js";
import { formatTime } from "./ai-helpers.js";
import { autoNarrate } from "./ai-narrate.js";
import { registerScriptPipelineCommands } from "./ai-script-pipeline-cli.js";
import { registerHighlightsCommands } from "./ai-highlights.js";
import { registerViralCommand } from "./ai-viral.js";
import { registerBrollCommand } from "./ai-broll.js";
import { isJsonMode, outputResult } from "./output.js";

export const pipelineCommand = new Command("pipeline").description(
  "AI video pipelines (script-to-video, highlights, shorts, viral)"
);

// ── pipeline script-to-video & regenerate-scene ────────────────────────

registerScriptPipelineCommands(pipelineCommand);

// ── pipeline highlights & auto-shorts ──────────────────────────────────

registerHighlightsCommands(pipelineCommand);

// ── pipeline viral ─────────────────────────────────────────────────────

registerViralCommand(pipelineCommand);

// ── pipeline b-roll ────────────────────────────────────────────────────

registerBrollCommand(pipelineCommand);

// ── pipeline narrate ───────────────────────────────────────────────────

pipelineCommand
  .command("narrate")
  .description("Generate AI narration for a video file or project")
  .argument("<input>", "Video file or project file (.vibe.json)")
  .option("-o, --output <dir>", "Output directory for generated files", ".")
  .option("-v, --voice <name>", "ElevenLabs voice name (rachel, adam, josh, etc.)", "rachel")
  .option("-s, --style <style>", "Narration style: informative, energetic, calm, dramatic", "informative")
  .option("-l, --language <lang>", "Language code (e.g., en, ko)", "en")
  .option("-p, --provider <name>", "LLM for script generation: claude (default), openai", "claude")
  .option("--add-to-project", "Add narration to project (only for .vibe.json input)")
  .option("--dry-run", "Preview pipeline parameters without executing")
  .action(async (inputPath: string, options) => {
    try {
      const absPath = resolve(process.cwd(), inputPath);
      if (!existsSync(absPath)) {
        console.error(chalk.red(`File not found: ${absPath}`));
        process.exit(1);
      }

      if (options.dryRun) {
        outputResult({ dryRun: true, command: "pipeline narrate", params: { inputPath, voice: options.voice, style: options.style, language: options.language, provider: options.provider } });
        return;
      }

      console.log();
      console.log(chalk.bold.cyan("Auto-Narrate Pipeline"));
      console.log(chalk.dim("─".repeat(60)));
      console.log();

      const isProject = inputPath.endsWith(".vibe.json");
      let videoPath: string;
      let project: Project | null = null;
      let outputDir = resolve(process.cwd(), options.output);

      if (isProject) {
        // Load project to find video source
        const content = await readFile(absPath, "utf-8");
        const data: ProjectFile = JSON.parse(content);
        project = Project.fromJSON(data);
        const sources = project.getSources();
        const videoSource = sources.find((s) => s.type === "video");

        if (!videoSource) {
          console.error(chalk.red("No video source found in project"));
          process.exit(1);
        }

        videoPath = resolve(dirname(absPath), videoSource.url);
        if (!existsSync(videoPath)) {
          console.error(chalk.red(`Video file not found: ${videoPath}`));
          process.exit(1);
        }

        // Use project directory as output if not specified
        if (options.output === ".") {
          outputDir = dirname(absPath);
        }

        console.log(`Project: ${chalk.bold(project.getMeta().name)}`);
      } else {
        videoPath = absPath;
        console.log(`Video: ${chalk.bold(basename(videoPath))}`);
      }

      // Get video duration
      const durationSpinner = ora("Analyzing video...").start();
      let duration: number;
      try {
        duration = await ffprobeDuration(videoPath);
        durationSpinner.succeed(chalk.green(`Duration: ${formatTime(duration)}`));
      } catch {
        durationSpinner.fail(chalk.red("Failed to get video duration"));
        process.exit(1);
      }

      // Validate style option
      const validStyles = ["informative", "energetic", "calm", "dramatic"];
      if (!validStyles.includes(options.style)) {
        console.error(chalk.red(`Invalid style: ${options.style}`));
        console.error(chalk.dim(`Valid styles: ${validStyles.join(", ")}`));
        process.exit(1);
      }

      // Generate narration
      const generateSpinner = ora("Generating narration...").start();

      generateSpinner.text = "Analyzing video with Gemini...";
      const result = await autoNarrate({
        videoPath,
        duration,
        outputDir,
        voice: options.voice,
        style: options.style as "informative" | "energetic" | "calm" | "dramatic",
        language: options.language,
        scriptProvider: options.provider as "claude" | "openai",
      });

      if (!result.success) {
        generateSpinner.fail(chalk.red(`Failed: ${result.error}`));
        process.exit(1);
      }

      generateSpinner.succeed(chalk.green("Narration generated successfully"));

      if (isJsonMode()) {
        outputResult({ success: true, audioPath: result.audioPath, segments: result.segments?.map(s => ({ startTime: s.startTime, endTime: s.endTime, text: s.text })) });
        return;
      }

      // Display result
      console.log();
      console.log(chalk.bold.cyan("Generated Files"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`  Audio: ${chalk.green(result.audioPath)}`);
      console.log(`  Script: ${chalk.green(resolve(outputDir, "narration-script.txt"))}`);

      if (result.segments && result.segments.length > 0) {
        console.log();
        console.log(chalk.bold.cyan("Narration Segments"));
        console.log(chalk.dim("─".repeat(60)));
        for (const seg of result.segments.slice(0, 5)) {
          console.log(`  [${formatTime(seg.startTime)} - ${formatTime(seg.endTime)}] ${chalk.dim(seg.text.substring(0, 50))}${seg.text.length > 50 ? "..." : ""}`);
        }
        if (result.segments.length > 5) {
          console.log(chalk.dim(`  ... and ${result.segments.length - 5} more segments`));
        }
      }

      // Add to project if requested
      if (options.addToProject && project && isProject) {
        const addSpinner = ora("Adding narration to project...").start();

        // Get audio duration
        let audioDuration: number;
        try {
          audioDuration = await getAudioDuration(result.audioPath!);
        } catch {
          audioDuration = duration; // Fallback to video duration
        }

        // Add audio source
        const audioSource = project.addSource({
          name: "Auto-generated narration",
          url: basename(result.audioPath!),
          type: "audio",
          duration: audioDuration,
        });

        // Add audio clip to audio track
        const audioTrack = project.getTracks().find((t) => t.type === "audio");
        if (audioTrack) {
          project.addClip({
            sourceId: audioSource.id,
            trackId: audioTrack.id,
            startTime: 0,
            duration: Math.min(audioDuration, duration),
            sourceStartOffset: 0,
            sourceEndOffset: Math.min(audioDuration, duration),
          });
        }

        // Save updated project
        await writeFile(absPath, JSON.stringify(project.toJSON(), null, 2), "utf-8");
        addSpinner.succeed(chalk.green("Narration added to project"));
      }

      console.log();
      console.log(chalk.bold.green("Auto-narrate complete!"));

      if (!options.addToProject && isProject) {
        console.log();
        console.log(chalk.dim("Tip: Use --add-to-project to automatically add the narration to your project"));
      }

      console.log();
    } catch (error) {
      console.error(chalk.red("Auto-narrate failed"));
      console.error(error);
      process.exit(1);
    }
  });
