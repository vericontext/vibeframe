/**
 * @module ai-script-pipeline-cli
 * @description Commander wiring for `vibe pipeline regenerate-scene`. The
 *   sibling `script-to-video` subcommand and its execute function were
 *   removed in favour of the skill-driven `vibe scene build` flow; only
 *   regenerate-scene survives because it operates on existing on-disk
 *   storyboards. Execute function lives in `ai-script-pipeline.ts`.
 */

import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import { parse as yamlParse } from "yaml";
import { getApiKey } from "../utils/api-key.js";
import { type ProjectFile } from "../engine/index.js";
import {
  type StoryboardSegment,
  DEFAULT_VIDEO_RETRIES,
  executeRegenerateScene,
} from "./ai-script-pipeline.js";
import { exitWithError, outputResult, authError, notFoundError, usageError, apiError, generalError } from "./output.js";

export function registerScriptPipelineCommands(aiCommand: Command): void {
aiCommand
  .command("regenerate-scene")
  .description("Regenerate a specific scene in a script-to-video output directory")
  .argument("<project-dir>", "Path to the script-to-video output directory")
  .requiredOption("--scene <numbers>", "Scene number(s) to regenerate (1-based), e.g., 3 or 3,4,5")
  .option("--video-only", "Only regenerate video")
  .option("--narration-only", "Only regenerate narration")
  .option("--image-only", "Only regenerate image")
  .option("-g, --generator <engine>", "Video generator: grok | kling | runway | veo", "grok")
  .option("-i, --image-provider <provider>", "Image provider: gemini | openai | grok", "gemini")
  .option("-v, --voice <id>", "ElevenLabs voice ID for narration")
  .option("-a, --aspect-ratio <ratio>", "Aspect ratio: 16:9 | 9:16 | 1:1", "16:9")
  .option("--retries <count>", "Number of retries for video generation failures", String(DEFAULT_VIDEO_RETRIES))
  .option("--reference-scene <num>", "Use another scene's image as reference for character consistency")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (projectDir: string, options) => {
    try {
      const outputDir = resolve(process.cwd(), projectDir);
      const projectPath = resolve(outputDir, "project.vibe.json");

      if (!existsSync(outputDir)) {
        exitWithError(notFoundError(outputDir));
      }

      const yamlPath = resolve(outputDir, "storyboard.yaml");
      const jsonPath = resolve(outputDir, "storyboard.json");
      const storyboardPath = existsSync(yamlPath) ? yamlPath : existsSync(jsonPath) ? jsonPath : null;
      const storyboardIsYaml = storyboardPath === yamlPath;
      if (!storyboardPath) {
        exitWithError(notFoundError(`${outputDir}/storyboard.{yaml,json}`));
      }

      const sceneNums: number[] = options.scene
        .split(",")
        .map((s: string) => parseInt(s.trim()))
        .filter((n: number) => !isNaN(n) && n >= 1);
      if (sceneNums.length === 0) {
        exitWithError(usageError("Scene number must be a positive integer (1-based)", "e.g., --scene 3 or --scene 3,4,5"));
      }

      if (options.dryRun) {
        outputResult({
          dryRun: true,
          command: "pipeline regenerate-scene",
          params: {
            projectDir,
            scene: sceneNums,
            videoOnly: options.videoOnly ?? false,
            narrationOnly: options.narrationOnly ?? false,
            imageOnly: options.imageOnly ?? false,
            generator: options.generator,
            imageProvider: options.imageProvider,
            aspectRatio: options.aspectRatio,
            retries: options.retries,
            referenceScene: options.referenceScene,
          },
        });
        return;
      }

      // Validate scene numbers against the on-disk storyboard so we fail before
      // any API calls. executeRegenerateScene validates too, but a usage exit
      // code is friendlier than API_ERROR here.
      const content = await readFile(storyboardPath!, "utf-8");
      const segments: StoryboardSegment[] = storyboardIsYaml
        ? (yamlParse(content) as { scenes: StoryboardSegment[] }).scenes
        : (JSON.parse(content) as StoryboardSegment[]);
      for (const sceneNum of sceneNums) {
        if (sceneNum > segments.length) {
          exitWithError(usageError(`Scene ${sceneNum} does not exist. Storyboard has ${segments.length} scenes.`));
        }
      }

      const regenerateVideo = options.videoOnly || (!options.narrationOnly && !options.imageOnly);
      const regenerateNarration = options.narrationOnly || (!options.videoOnly && !options.imageOnly);
      const regenerateImage = options.imageOnly || (!options.videoOnly && !options.narrationOnly);

      if (regenerateImage) {
        const provider = (options.imageProvider || "openai") as "openai" | "gemini" | "grok";
        const keyMap: Record<typeof provider, { envVar: string; name: string }> = {
          openai: { envVar: "OPENAI_API_KEY", name: "OpenAI" },
          gemini: { envVar: "GOOGLE_API_KEY", name: "Google" },
          grok: { envVar: "XAI_API_KEY", name: "xAI" },
        };
        const info = keyMap[provider];
        if (!info) exitWithError(usageError(`Unknown image provider: ${provider}`));
        if (!(await getApiKey(info.envVar, info.name))) exitWithError(authError(info.envVar, info.name));
      }
      if (regenerateVideo) {
        const generatorKeyMap: Record<string, { envVar: string; name: string }> = {
          grok: { envVar: "XAI_API_KEY", name: "xAI" },
          kling: { envVar: "KLING_API_KEY", name: "Kling" },
          runway: { envVar: "RUNWAY_API_SECRET", name: "Runway" },
          veo: { envVar: "GOOGLE_API_KEY", name: "Google" },
        };
        const generator = options.generator || "grok";
        const info = generatorKeyMap[generator];
        if (!info) exitWithError(usageError(`Invalid generator: ${generator}`, `Available: ${Object.keys(generatorKeyMap).join(", ")}`));
        if (!(await getApiKey(info.envVar, info.name))) exitWithError(authError(info.envVar, info.name));
      }
      if (regenerateNarration) {
        if (!(await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs"))) {
          exitWithError(authError("ELEVENLABS_API_KEY", "ElevenLabs"));
        }
      }

      console.log();
      console.log(chalk.bold.cyan(`🔄 Regenerating Scene${sceneNums.length > 1 ? "s" : ""} ${sceneNums.join(", ")}`));
      console.log(chalk.dim("─".repeat(60)));
      console.log();
      console.log(`  📁 Project: ${outputDir}`);
      console.log(`  🎬 Scenes: ${sceneNums.join(", ")} of ${segments.length}`);
      console.log();

      const spinner = ora("Regenerating...").start();
      const result = await executeRegenerateScene({
        projectDir,
        scenes: sceneNums,
        videoOnly: options.videoOnly,
        narrationOnly: options.narrationOnly,
        imageOnly: options.imageOnly,
        generator: options.generator as "grok" | "kling" | "runway" | "veo" | undefined,
        imageProvider: options.imageProvider as "openai" | "gemini" | "grok" | undefined,
        voice: options.voice,
        aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1" | undefined,
        retries: parseInt(options.retries) || DEFAULT_VIDEO_RETRIES,
        referenceScene: options.referenceScene ? parseInt(options.referenceScene) : undefined,
        onProgress: (msg: string) => { spinner.text = msg; },
      });

      if (!result.success) {
        spinner.fail(chalk.red(result.error || "Scene regeneration failed"));
        exitWithError(apiError(result.error || "Scene regeneration failed", true));
      }
      spinner.succeed(chalk.green(`Regenerated ${result.regeneratedScenes.length} scene(s)`));

      // Sync project.vibe.json clip durations with the updated storyboard.
      // The library rewrites segment.duration when narration changes; we
      // re-read it here so every clip's startTime/duration line up.
      if (existsSync(projectPath) && result.regeneratedScenes.length > 0) {
        const updateSpinner = ora("📦 Updating project file...").start();
        try {
          const updatedContent = await readFile(storyboardPath!, "utf-8");
          const updatedSegments: StoryboardSegment[] = storyboardIsYaml
            ? (yamlParse(updatedContent) as { scenes: StoryboardSegment[] }).scenes
            : (JSON.parse(updatedContent) as StoryboardSegment[]);

          const projectContent = await readFile(projectPath, "utf-8");
          const projectData = JSON.parse(projectContent) as ProjectFile;

          for (const sceneNum of result.regeneratedScenes) {
            const segment = updatedSegments[sceneNum - 1];
            if (!segment) continue;
            const videoPath = resolve(outputDir, `scene-${sceneNum}.mp4`);
            const imagePath = resolve(outputDir, `scene-${sceneNum}.png`);
            const videoSource = projectData.state.sources.find((s) => s.name === `Scene ${sceneNum}`);
            if (videoSource) {
              const hasVideo = existsSync(videoPath);
              videoSource.url = hasVideo ? videoPath : imagePath;
              videoSource.type = hasVideo ? "video" : "image";
              videoSource.duration = segment.duration;
            }
            if (regenerateNarration) {
              const narrationSource = projectData.state.sources.find((s) => s.name === `Narration ${sceneNum}`);
              if (narrationSource) {
                narrationSource.duration = segment.duration;
              }
            }
          }

          for (const clip of projectData.state.clips) {
            const source = projectData.state.sources.find((s) => s.id === clip.sourceId);
            if (!source) continue;
            const sceneMatch = source.name.match(/^Scene (\d+)$/);
            const narrationMatch = source.name.match(/^Narration (\d+)$/);
            const segIdx = sceneMatch ? parseInt(sceneMatch[1]) - 1 : narrationMatch ? parseInt(narrationMatch[1]) - 1 : -1;
            if (segIdx >= 0 && segIdx < updatedSegments.length) {
              const seg = updatedSegments[segIdx];
              clip.startTime = seg.startTime;
              clip.duration = seg.duration;
              clip.sourceEndOffset = seg.duration;
              source.duration = seg.duration;
            }
          }

          await writeFile(projectPath, JSON.stringify(projectData, null, 2), "utf-8");
          updateSpinner.succeed(chalk.green("Updated project file (all clips synced)"));
        } catch (err) {
          updateSpinner.warn(chalk.yellow(`Could not update project file: ${err}`));
        }
      }

      console.log();
      console.log(chalk.bold.green(`✅ ${result.regeneratedScenes.length} scene${result.regeneratedScenes.length !== 1 ? "s" : ""} regenerated successfully!`));
      console.log(chalk.dim("─".repeat(60)));
      console.log();
      console.log(chalk.dim("Next steps:"));
      console.log(chalk.dim(`  vibe export ${outputDir}/ -o final.mp4`));
      console.log();
    } catch (error) {
      exitWithError(generalError(error instanceof Error ? error.message : "Scene regeneration failed"));
    }
  });
}
