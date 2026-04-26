/**
 * @module ai-script-pipeline-cli
 * @description CLI command registration for the script-to-video pipeline and
 *   scene regeneration commands. Execute functions and helpers live in
 *   ai-script-pipeline.ts; this file wires them up as Commander.js subcommands.
 */

import { Command } from "commander";
import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import { parse as yamlParse } from "yaml";
import { getApiKey, loadEnv } from "../utils/api-key.js";
import { type ProjectFile } from "../engine/index.js";
import { type TextOverlayStyle } from "./ai-edit.js";
import {
  type StoryboardSegment,
  DEFAULT_VIDEO_RETRIES,
  executeScriptToVideo,
  executeRegenerateScene,
} from "./ai-script-pipeline.js";
import { exitWithError, outputResult, isJsonMode, authError, notFoundError, usageError, apiError, generalError } from "./output.js";
import { validateOutputPath } from "./validate.js";

export function registerScriptPipelineCommands(aiCommand: Command): void {
// Script-to-Video command
aiCommand
  .command("script-to-video")
  .alias("s2v")
  .description("Generate complete video from text script using AI pipeline")
  .argument("<script>", "Script text or file path (use -f for file)")
  .option("-f, --file", "Treat script argument as file path")
  .option("-o, --output <path>", "Output project file path", "script-video.vibe.json")
  .option("-d, --duration <seconds>", "Target total duration in seconds")
  .option("-v, --voice <id>", "ElevenLabs voice ID for narration")
  .option("-g, --generator <engine>", "Video generator: grok | kling | runway | veo", "grok")
  .option("-i, --image-provider <provider>", "Image provider: gemini | openai | grok", "gemini")
  .option("-a, --aspect-ratio <ratio>", "Aspect ratio: 16:9 | 9:16 | 1:1", "16:9")
  .option("--images-only", "Generate images only, skip video generation")
  .option("--no-voiceover", "Skip voiceover generation")
  .option("--output-dir <dir>", "Directory for generated assets", "script-video-output")
  .option("--retries <count>", "Number of retries for video generation failures", String(DEFAULT_VIDEO_RETRIES))
  .option("--sequential", "Generate videos one at a time (slower but more reliable)")
  .option("--concurrency <count>", "Max concurrent video tasks in parallel mode (default: 3)", "3")
  .option("-c, --creativity <level>", "Creativity level: low (default, consistent) or high (varied, unexpected)", "low")
  .option("-s, --storyboard-provider <provider>", "Storyboard provider: claude (default), openai, or gemini", "claude")
  .option("--no-text-overlay", "Skip text overlay step")
  .option("--text-style <style>", "Text overlay style: lower-third, center-bold, subtitle, minimal", "lower-third")
  .option("--review", "Run AI review after assembly (requires GOOGLE_API_KEY)")
  .option("--review-auto-apply", "Auto-apply fixable issues from AI review")
  .option("--format <mode>", "Output format: mp4 (default, full pipeline) or scenes (DEPRECATED in v0.62 — use `vibe scene build` with STORYBOARD frontmatter cues; removal scheduled for v0.63)", "mp4")
  .option("--scene-style <preset>", "Style preset for --format scenes: simple | announcement | explainer | kinetic-type | product-shot", "explainer")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (script: string, options) => {
    try {
      if (options.output) {
        validateOutputPath(options.output);
      }

      // v0.62: --format scenes deprecation warning fires before any other
      // work so dry-runs surface the same notice production runs do.
      // Removal scheduled for v0.63 — point users at `vibe scene build`.
      if (options.format === "scenes" && !isJsonMode()) {
        console.warn();
        console.warn(chalk.yellow("⚠  --format scenes is deprecated and will be removed in v0.63."));
        console.warn(chalk.dim("   Migrate to: write STORYBOARD.md with per-beat YAML cues, then `vibe scene build <project-dir>`."));
        console.warn(chalk.dim("   See examples/scene-promo-pipeline.yaml for the v0.62 reference flow."));
        console.warn();
      }

      if (options.dryRun) {
        outputResult({
          dryRun: true,
          command: "pipeline script-to-video",
          params: {
            script: script.slice(0, 200),
            file: options.file ?? false,
            output: options.output,
            duration: options.duration,
            generator: options.generator,
            imageProvider: options.imageProvider,
            aspectRatio: options.aspectRatio,
            imagesOnly: options.imagesOnly ?? false,
            voiceover: options.voiceover,
            outputDir: options.outputDir,
            creativity: options.creativity,
            storyboardProvider: options.storyboardProvider,
            textOverlay: options.textOverlay,
            textStyle: options.textStyle,
            review: options.review ?? false,
          },
        });
        return;
      }

      // Load environment variables from .env file
      loadEnv();

      // Pre-check API keys so we surface friendly exit codes (AUTH instead
      // of API_ERROR) before executeScriptToVideo's internal re-check fires.
      const storyboardProvider = (options.storyboardProvider || "claude") as "claude" | "openai" | "gemini";
      const storyboardKeyMap: Record<typeof storyboardProvider, { envVar: string; name: string }> = {
        claude: { envVar: "ANTHROPIC_API_KEY", name: "Anthropic" },
        openai: { envVar: "OPENAI_API_KEY", name: "OpenAI" },
        gemini: { envVar: "GOOGLE_API_KEY", name: "Google" },
      };
      {
        const info = storyboardKeyMap[storyboardProvider];
        if (!info) {
          exitWithError(usageError(`Unknown storyboard provider: ${storyboardProvider}`, "Use claude, openai, or gemini"));
        }
        if (!(await getApiKey(info.envVar, info.name))) {
          exitWithError(authError(info.envVar, info.name));
        }
      }

      const imageProvider = (options.imageProvider || "openai") as "openai" | "dalle" | "gemini" | "grok";
      const imageKeyMap: Record<typeof imageProvider, { envVar: string; name: string }> = {
        openai: { envVar: "OPENAI_API_KEY", name: "OpenAI" },
        dalle: { envVar: "OPENAI_API_KEY", name: "OpenAI" },
        gemini: { envVar: "GOOGLE_API_KEY", name: "Google" },
        grok: { envVar: "XAI_API_KEY", name: "xAI" },
      };
      {
        const info = imageKeyMap[imageProvider];
        if (!info) {
          exitWithError(usageError(`Unknown image provider: ${imageProvider}`, "Use openai, gemini, or grok"));
        }
        if (!(await getApiKey(info.envVar, info.name))) {
          exitWithError(authError(info.envVar, info.name));
        }
      }

      if (options.voiceover !== false) {
        if (!(await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs"))) {
          exitWithError(authError("ELEVENLABS_API_KEY", "ElevenLabs"));
        }
      }

      if (!options.imagesOnly) {
        const generatorKeyMap: Record<string, { envVar: string; name: string }> = {
          grok: { envVar: "XAI_API_KEY", name: "xAI" },
          kling: { envVar: "KLING_API_KEY", name: "Kling" },
          runway: { envVar: "RUNWAY_API_SECRET", name: "Runway" },
          veo: { envVar: "GOOGLE_API_KEY", name: "Google" },
        };
        const generator = options.generator || "grok";
        const genInfo = generatorKeyMap[generator];
        if (!genInfo) {
          exitWithError(usageError(`Invalid generator: ${generator}`, `Available: ${Object.keys(generatorKeyMap).join(", ")}`));
        }
        if (!(await getApiKey(genInfo.envVar, genInfo.name))) {
          exitWithError(authError(genInfo.envVar, genInfo.name));
        }
      }

      // Read script content
      let scriptContent = script;
      if (options.file) {
        const filePath = resolve(process.cwd(), script);
        scriptContent = await readFile(filePath, "utf-8");
      }

      // Resolve -o / --output-dir semantics (identical to the old inline path):
      //   -o foo/           → outputDir = foo,       project = foo/project.vibe.json
      //   -o foo.vibe.json  → outputDir = default,   project = foo.vibe.json
      //   -o foo            → outputDir = foo,       project = foo/project.vibe.json
      let effectiveOutputDir = options.outputDir;
      const outputLooksLikeDirectory =
        options.output.endsWith("/") ||
        (!options.output.endsWith(".json") && !options.output.endsWith(".vibe.json"));
      if (outputLooksLikeDirectory && options.outputDir === "script-video-output") {
        effectiveOutputDir = options.output;
      }

      let projectFilePath = resolve(process.cwd(), options.output);
      if (outputLooksLikeDirectory) {
        projectFilePath = resolve(projectFilePath, "project.vibe.json");
      } else if (existsSync(projectFilePath) && (await stat(projectFilePath)).isDirectory()) {
        projectFilePath = resolve(projectFilePath, "project.vibe.json");
      }

      const creativity = (options.creativity ?? "low").toLowerCase();
      if (creativity !== "low" && creativity !== "high") {
        exitWithError(usageError("Invalid creativity level.", "Use 'low' or 'high'."));
      }

      console.log();
      console.log(chalk.bold.cyan("🎬 Script-to-Video Pipeline"));
      console.log(chalk.dim("─".repeat(60)));
      if (creativity === "high") {
        console.log(chalk.yellow("🎨 High creativity mode: Generating varied, unexpected scenes"));
      }
      console.log();

      const pipelineSpinner = ora(`🎬 Running script-to-video with ${options.generator}...`).start();
      const format = (options.format ?? "mp4") as "mp4" | "scenes";
      if (format !== "mp4" && format !== "scenes") {
        exitWithError(usageError(`Invalid --format: ${options.format}`, "Valid: mp4, scenes"));
      }
      const validScenePresets = ["simple", "announcement", "explainer", "kinetic-type", "product-shot"] as const;
      type ScenePresetCli = typeof validScenePresets[number];
      const scenePreset = options.sceneStyle as ScenePresetCli;
      if (format === "scenes" && !validScenePresets.includes(scenePreset)) {
        exitWithError(usageError(`Invalid --scene-style: ${scenePreset}`, `Valid: ${validScenePresets.join(", ")}`));
      }

      const result = await executeScriptToVideo({
        script: scriptContent,
        outputDir: effectiveOutputDir,
        projectFilePath,
        duration: options.duration ? parseFloat(options.duration) : undefined,
        voice: options.voice,
        generator: options.generator as "grok" | "runway" | "kling" | "veo",
        imageProvider: options.imageProvider as "openai" | "gemini" | "grok" | undefined,
        aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1" | undefined,
        imagesOnly: options.imagesOnly,
        noVoiceover: options.voiceover === false,
        retries: parseInt(options.retries) || DEFAULT_VIDEO_RETRIES,
        creativity: creativity as "low" | "high",
        storyboardProvider: options.storyboardProvider as "claude" | "openai" | "gemini" | undefined,
        noTextOverlay: options.textOverlay === false,
        textStyle: options.textStyle as TextOverlayStyle | undefined,
        review: options.review,
        reviewAutoApply: options.reviewAutoApply,
        format,
        scenePreset,
        onProgress: (msg: string) => { pipelineSpinner.text = msg; },
      });

      if (!result.success) {
        pipelineSpinner.fail(chalk.red(result.error || "Script-to-Video failed"));
        exitWithError(apiError(result.error || "Script-to-Video failed", true));
      }

      // ---- Scene-project output path -------------------------------------
      if (result.format === "scenes") {
        pipelineSpinner.succeed(chalk.green(`Generated ${result.scenes} scene HTML file(s) → ${effectiveOutputDir}/`));

        const lint = result.sceneLint;
        const lintLine = lint
          ? `  🧪 Lint: ${lint.errorCount} error(s), ${lint.warningCount} warning(s), ${lint.infoCount} info`
          : "  🧪 Lint: skipped";

        console.log();
        console.log(chalk.bold.green("Script-to-Scenes complete!"));
        console.log(chalk.dim("─".repeat(60)));
        console.log();
        console.log(`  📁 Project: ${chalk.cyan(effectiveOutputDir)}/`);
        console.log(`  🎬 Scenes: ${result.scenes}`);
        console.log(`  ⏱️  Duration: ${result.totalDuration ?? 0}s`);
        console.log(lintLine);
        console.log();
        console.log(chalk.dim("Next steps:"));
        console.log(chalk.dim(`  vibe scene lint --project ${effectiveOutputDir}`));
        console.log(chalk.dim(`  vibe scene render --project ${effectiveOutputDir}`));
        console.log();

        outputResult({
          success: true,
          command: "pipeline script-to-video",
          result: {
            format: "scenes",
            outputDir: result.outputDir,
            scenes: result.scenes,
            totalDuration: result.totalDuration,
            scenePaths: result.scenePaths ?? [],
            lint: lint
              ? { ok: lint.ok, errorCount: lint.errorCount, warningCount: lint.warningCount, infoCount: lint.infoCount }
              : undefined,
          },
        });
        return;
      }

      pipelineSpinner.succeed(chalk.green(`Generated ${result.scenes} scene(s) → ${result.projectPath}`));

      // Final summary (presentational; keeps parity with the pre-thin-wrap CLI).
      const narrationCount = (result.narrationEntries ?? []).filter((e) => e.path).length;
      const failedNarrationNums = result.failedNarrations ?? [];
      const failedSceneNums = [...new Set(result.failedScenes ?? [])].sort((a, b) => a - b);
      const imageCount = result.images?.length ?? 0;
      const videoCount = result.videos?.length ?? 0;

      console.log();
      console.log(chalk.bold.green("Script-to-Video complete!"));
      console.log(chalk.dim("─".repeat(60)));
      console.log();
      console.log(`  📄 Project: ${chalk.cyan(result.projectPath)}`);
      console.log(`  🎬 Scenes: ${result.scenes}`);
      console.log(`  ⏱️  Duration: ${result.totalDuration ?? 0}s`);
      console.log(`  📁 Assets: ${effectiveOutputDir}/`);
      if (narrationCount > 0 || failedNarrationNums.length > 0) {
        console.log(`  🎙️  Narrations: ${narrationCount}/${result.scenes} narration-*.mp3`);
        if (failedNarrationNums.length > 0) {
          console.log(chalk.yellow(`     ⚠ Failed: scene ${failedNarrationNums.join(", ")}`));
        }
      }
      console.log(`  🖼️  Images: ${imageCount} scene-*.png`);
      if (!options.imagesOnly) {
        console.log(`  🎥 Videos: ${videoCount}/${result.scenes} scene-*.mp4`);
        if (failedSceneNums.length > 0) {
          console.log(chalk.yellow(`     ⚠ Failed: scene ${failedSceneNums.join(", ")} (fallback to image)`));
        }
      }
      console.log();
      console.log(chalk.dim("Next steps:"));
      console.log(chalk.dim(`  vibe project info ${options.output}`));
      console.log(chalk.dim(`  vibe export ${options.output} -o final.mp4`));
      if (!options.imagesOnly && failedSceneNums.length > 0) {
        console.log();
        console.log(chalk.dim("💡 To regenerate failed scenes:"));
        for (const sceneNum of failedSceneNums) {
          console.log(chalk.dim(`  vibe ai regenerate-scene ${effectiveOutputDir}/ --scene ${sceneNum} --video-only`));
        }
      }
      console.log();

      // JSON shape is byte-identical to the pre-thin-wrap delegation block;
      // agent callers depend on these exact fields and counts.
      outputResult({
        success: true,
        command: "pipeline script-to-video",
        result: {
          projectPath: result.projectPath,
          outputDir: result.outputDir,
          scenes: result.scenes,
          totalDuration: result.totalDuration,
          images: result.images?.length ?? 0,
          videos: result.videos?.length ?? 0,
          failedScenes: result.failedScenes ?? [],
        },
      });

    } catch (error) {
      exitWithError(generalError(error instanceof Error ? error.message : "Script-to-Video failed"));
    }
  });

// Regenerate Scene command
aiCommand
  .command("regenerate-scene")
  .description("Regenerate a specific scene in a script-to-video project")
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

      // Storyboard: prefer YAML (current executeScriptToVideo output), fall back
      // to JSON (pre-0.48.6 inline kling/runway output). Track source format so
      // the CLI's project-file update can re-read it after the library has
      // rewritten segment durations.
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

      // API-key pre-check for friendly AUTH exit codes (library re-checks).
      if (regenerateImage) {
        const provider = (options.imageProvider || "openai") as "openai" | "dalle" | "gemini" | "grok";
        const keyMap: Record<typeof provider, { envVar: string; name: string }> = {
          openai: { envVar: "OPENAI_API_KEY", name: "OpenAI" },
          dalle: { envVar: "OPENAI_API_KEY", name: "OpenAI" },
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
        // `dalle` is a CLI alias for OpenAI image generation; the library only
        // knows `openai`.
        imageProvider: (options.imageProvider === "dalle" ? "openai" : options.imageProvider) as "openai" | "gemini" | "grok" | undefined,
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
