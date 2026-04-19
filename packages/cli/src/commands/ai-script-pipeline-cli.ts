/**
 * @module ai-script-pipeline-cli
 * @description CLI command registration for the script-to-video pipeline and
 *   scene regeneration commands. Execute functions and helpers live in
 *   ai-script-pipeline.ts; this file wires them up as Commander.js subcommands.
 */

import { Command } from "commander";
import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { existsSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import { stringify as yamlStringify, parse as yamlParse } from "yaml";
import {
  GeminiProvider,
  OpenAIImageProvider,
  ElevenLabsProvider,
  KlingProvider,
  RunwayProvider,
} from "@vibeframe/ai-providers";
import { getApiKey, loadEnv } from "../utils/api-key.js";
import { getApiKeyFromConfig } from "../config/index.js";
import { type ProjectFile } from "../engine/index.js";
import { getAudioDuration } from "../utils/audio.js";
import { type TextOverlayStyle } from "./ai-edit.js";
import {
  type StoryboardSegment,
  DEFAULT_VIDEO_RETRIES,
  RETRY_DELAY_MS,
  sleep,
  uploadToImgbb,
  extendVideoToTarget,
  generateVideoWithRetryKling,
  generateVideoWithRetryRunway,
  executeScriptToVideo,
  executeRegenerateScene,
} from "./ai-script-pipeline.js";
import { downloadVideo } from "./ai-helpers.js";
import { exitWithError, outputResult, authError, notFoundError, usageError, apiError, generalError } from "./output.js";
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
  .option("--dry-run", "Preview parameters without executing")
  .action(async (script: string, options) => {
    try {
      if (options.output) {
        validateOutputPath(options.output);
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
        onProgress: (msg: string) => { pipelineSpinner.text = msg; },
      });

      if (!result.success) {
        pipelineSpinner.fail(chalk.red(result.error || "Script-to-Video failed"));
        exitWithError(apiError(result.error || "Script-to-Video failed", true));
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

      // Validate project directory
      if (!existsSync(outputDir)) {
        exitWithError(notFoundError(outputDir));
      }

      // Storyboard: prefer YAML (written by executeScriptToVideo / grok+veo path),
      // fall back to JSON (written by legacy kling/runway CLI inline path). Track
      // source format so re-save preserves it.
      const yamlPath = resolve(outputDir, "storyboard.yaml");
      const jsonPath = resolve(outputDir, "storyboard.json");
      const storyboardPath = existsSync(yamlPath) ? yamlPath : existsSync(jsonPath) ? jsonPath : null;
      const storyboardIsYaml = storyboardPath === yamlPath;

      if (!storyboardPath) {
        exitWithError(notFoundError(`${outputDir}/storyboard.{yaml,json}`));
      }

      // Parse scene number(s) - supports "3" or "3,4,5"
      const sceneNums = options.scene.split(",").map((s: string) => parseInt(s.trim())).filter((n: number) => !isNaN(n) && n >= 1);
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

      // Load storyboard — YAML wraps segments in `scenes:` key, JSON is a bare array.
      const storyboardContent = await readFile(storyboardPath!, "utf-8");
      const segments: StoryboardSegment[] = storyboardIsYaml
        ? (yamlParse(storyboardContent) as { scenes: StoryboardSegment[] }).scenes
        : (JSON.parse(storyboardContent) as StoryboardSegment[]);

      // Validate all scene numbers
      for (const sceneNum of sceneNums) {
        if (sceneNum > segments.length) {
          exitWithError(usageError(`Scene ${sceneNum} does not exist. Storyboard has ${segments.length} scenes.`));
        }
      }

      // Determine what to regenerate
      const regenerateVideo = options.videoOnly || (!options.narrationOnly && !options.imageOnly);
      const regenerateNarration = options.narrationOnly || (!options.videoOnly && !options.imageOnly);
      const regenerateImage = options.imageOnly || (!options.videoOnly && !options.narrationOnly);

      console.log();
      console.log(chalk.bold.cyan(`🔄 Regenerating Scene${sceneNums.length > 1 ? "s" : ""} ${sceneNums.join(", ")}`));
      console.log(chalk.dim("─".repeat(60)));
      console.log();
      console.log(`  📁 Project: ${outputDir}`);
      console.log(`  🎬 Scenes: ${sceneNums.join(", ")} of ${segments.length}`);
      console.log();

      // Get required API keys (once, before processing scenes)
      let imageApiKey: string | undefined;
      let videoApiKey: string | undefined;
      let elevenlabsApiKey: string | undefined;

      if (regenerateImage) {
        const imageProvider = options.imageProvider || "openai";
        if (imageProvider === "openai" || imageProvider === "dalle") {
          imageApiKey = (await getApiKey("OPENAI_API_KEY", "OpenAI")) ?? undefined;
          if (!imageApiKey) {
            exitWithError(authError("OPENAI_API_KEY", "OpenAI"));
          }
        } else if (imageProvider === "gemini") {
          imageApiKey = (await getApiKey("GOOGLE_API_KEY", "Google")) ?? undefined;
          if (!imageApiKey) {
            exitWithError(authError("GOOGLE_API_KEY", "Google"));
          }
        } else if (imageProvider === "grok") {
          imageApiKey = (await getApiKey("XAI_API_KEY", "xAI")) ?? undefined;
          if (!imageApiKey) {
            exitWithError(authError("XAI_API_KEY", "xAI"));
          }
        }
      }

      if (regenerateVideo) {
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
        const key = await getApiKey(genInfo.envVar, genInfo.name);
        if (!key) {
          exitWithError(authError(genInfo.envVar, genInfo.name));
        }
        videoApiKey = key;
      }

      if (regenerateNarration) {
        const key = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs");
        if (!key) {
          exitWithError(authError("ELEVENLABS_API_KEY", "ElevenLabs"));
        }
        elevenlabsApiKey = key;
      }

      // Process each scene
      for (const sceneNum of sceneNums) {
        const segment = segments[sceneNum - 1];

        console.log(chalk.cyan(`\n── Scene ${sceneNum} ──`));
        console.log(chalk.dim(`  ${segment.description.slice(0, 50)}...`));

        // Step 1: Regenerate narration if needed
        const narrationPath = resolve(outputDir, `narration-${sceneNum}.mp3`);
        let narrationDuration = segment.duration;

      if (regenerateNarration && elevenlabsApiKey) {
        const ttsSpinner = ora(`🎙️ Regenerating narration for scene ${sceneNum}...`).start();

        const elevenlabs = new ElevenLabsProvider();
        await elevenlabs.initialize({ apiKey: elevenlabsApiKey });

        const narrationText = segment.narration || segment.description;

        const ttsResult = await elevenlabs.textToSpeech(narrationText, {
          voiceId: options.voice,
        });

        if (!ttsResult.success || !ttsResult.audioBuffer) {
          ttsSpinner.fail(`Failed to generate narration: ${ttsResult.error || "Unknown error"}`);
          exitWithError(apiError(`Failed to generate narration: ${ttsResult.error || "Unknown error"}`, true));
        }

        await writeFile(narrationPath, ttsResult.audioBuffer);
        narrationDuration = await getAudioDuration(narrationPath);

        // Update segment duration in storyboard
        segment.duration = narrationDuration;

        ttsSpinner.succeed(chalk.green(`Generated narration (${narrationDuration.toFixed(1)}s)`));
      }

      // Step 2: Regenerate image if needed
      const imagePath = resolve(outputDir, `scene-${sceneNum}.png`);

      if (regenerateImage && imageApiKey) {
        const imageSpinner = ora(`🎨 Regenerating image for scene ${sceneNum}...`).start();

        const imageProvider = options.imageProvider || "gemini";

        // Build prompt with character description for consistency
        const characterDesc = segment.characterDescription || segments[0]?.characterDescription;
        let imagePrompt = segment.visualStyle
          ? `${segment.visuals}. Style: ${segment.visualStyle}`
          : segment.visuals;

        // Add character description to prompt if available
        if (characterDesc) {
          imagePrompt = `${imagePrompt}\n\nIMPORTANT - Character appearance must match exactly: ${characterDesc}`;
        }

        // Check if we should use reference-based generation for character consistency
        const refSceneNum = options.referenceScene ? parseInt(options.referenceScene) : null;
        let referenceImageBuffer: Buffer | undefined;

        if (refSceneNum && refSceneNum >= 1 && refSceneNum <= segments.length && refSceneNum !== sceneNum) {
          const refImagePath = resolve(outputDir, `scene-${refSceneNum}.png`);
          if (existsSync(refImagePath)) {
            referenceImageBuffer = await readFile(refImagePath);
            imageSpinner.text = `🎨 Regenerating image for scene ${sceneNum} (using scene ${refSceneNum} as reference)...`;
          }
        } else if (!refSceneNum) {
          // Auto-detect: use the first available scene image as reference
          for (let i = 1; i <= segments.length; i++) {
            if (i !== sceneNum) {
              const otherImagePath = resolve(outputDir, `scene-${i}.png`);
              if (existsSync(otherImagePath)) {
                referenceImageBuffer = await readFile(otherImagePath);
                imageSpinner.text = `🎨 Regenerating image for scene ${sceneNum} (using scene ${i} as reference)...`;
                break;
              }
            }
          }
        }

        // Determine image size/aspect ratio based on provider
        const dalleImageSizes: Record<string, "1536x1024" | "1024x1536" | "1024x1024"> = {
          "16:9": "1536x1024",
          "9:16": "1024x1536",
          "1:1": "1024x1024",
        };
        let imageBuffer: Buffer | undefined;
        let imageUrl: string | undefined;
        let imageError: string | undefined;

        if (imageProvider === "openai" || imageProvider === "dalle") {
          const openaiImage = new OpenAIImageProvider();
          await openaiImage.initialize({ apiKey: imageApiKey });
          const imageResult = await openaiImage.generateImage(imagePrompt, {
            size: dalleImageSizes[options.aspectRatio] || "1536x1024",
            quality: "standard",
          });
          if (imageResult.success && imageResult.images && imageResult.images.length > 0) {
            imageUrl = imageResult.images[0].url;
          } else {
            imageError = imageResult.error;
          }
        } else if (imageProvider === "gemini") {
          const gemini = new GeminiProvider();
          await gemini.initialize({ apiKey: imageApiKey });

          // Use editImage with reference for character consistency
          if (referenceImageBuffer) {
            // Extract the main action from the scene description (take first action if multiple)
            const simplifiedVisuals = segment.visuals.split(/[,.]/).find((part: string) =>
              part.includes("standing") || part.includes("sitting") || part.includes("walking") ||
              part.includes("lying") || part.includes("reaching") || part.includes("looking") ||
              part.includes("working") || part.includes("coding") || part.includes("typing")
            ) || segment.visuals.split(".")[0];

            const editPrompt = `Generate a new image showing the SAME SINGLE person from the reference image in a new scene.

REFERENCE: Look at the person in the reference image - their face, hair, build, and overall appearance.

NEW SCENE: ${simplifiedVisuals}

CRITICAL RULES:
1. Show ONLY ONE person - the exact same individual from the reference image
2. The person must have the IDENTICAL face, hair style, and body type
3. Do NOT show multiple people or duplicate the character
4. Create a single moment in time, one pose, one action
5. Match the art style and quality of the reference image

Generate the single-person scene image now.`;

            const imageResult = await gemini.editImage([referenceImageBuffer], editPrompt, {
              aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1",
            });
            if (imageResult.success && imageResult.images && imageResult.images.length > 0) {
              const img = imageResult.images[0];
              if (img.base64) {
                imageBuffer = Buffer.from(img.base64, "base64");
              }
            } else {
              imageError = imageResult.error;
            }
          } else {
            // No reference image, use regular generation
            const imageResult = await gemini.generateImage(imagePrompt, {
              aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1",
            });
            if (imageResult.success && imageResult.images && imageResult.images.length > 0) {
              const img = imageResult.images[0];
              if (img.base64) {
                imageBuffer = Buffer.from(img.base64, "base64");
              }
            } else {
              imageError = imageResult.error;
            }
          }
        } else if (imageProvider === "grok") {
          const { GrokProvider } = await import("@vibeframe/ai-providers");
          const grok = new GrokProvider();
          await grok.initialize({ apiKey: imageApiKey });
          const imageResult = await grok.generateImage(imagePrompt, {
            aspectRatio: options.aspectRatio || "16:9",
          });
          if (imageResult.success && imageResult.images && imageResult.images.length > 0) {
            const img = imageResult.images[0];
            if (img.base64) {
              imageBuffer = Buffer.from(img.base64, "base64");
            } else if (img.url) {
              imageUrl = img.url;
            }
          } else {
            imageError = imageResult.error;
          }
        }

        if (imageBuffer) {
          await writeFile(imagePath, imageBuffer);
          imageSpinner.succeed(chalk.green("Generated image"));
        } else if (imageUrl) {
          const response = await fetch(imageUrl);
          const buffer = Buffer.from(await response.arrayBuffer());
          await writeFile(imagePath, buffer);
          imageSpinner.succeed(chalk.green("Generated image"));
        } else {
          const errorMsg = imageError || "Unknown error";
          imageSpinner.fail(`Failed to generate image: ${errorMsg}`);
          exitWithError(apiError(`Failed to generate image: ${errorMsg}`, true));
        }
      }

      // Step 3: Regenerate video if needed
      const videoPath = resolve(outputDir, `scene-${sceneNum}.mp4`);

      if (regenerateVideo && videoApiKey) {
        const videoSpinner = ora(`🎬 Regenerating video for scene ${sceneNum}...`).start();

        // Check if image exists
        if (!existsSync(imagePath)) {
          videoSpinner.fail(`Reference image not found: ${imagePath}`);
          exitWithError(notFoundError(imagePath));
        }

        const imageBuffer = await readFile(imagePath);
        const ext = extname(imagePath).toLowerCase().slice(1);
        const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
        const referenceImage = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

        const videoDuration = (segment.duration > 5 ? 10 : 5) as 5 | 10;
        const maxRetries = parseInt(options.retries) || DEFAULT_VIDEO_RETRIES;

        let videoGenerated = false;

        // Grok and Veo: delegate to executeRegenerateScene (library function supports all 4
        // since v0.48.5). Kling and Runway continue through the inline path below pending
        // full dedup (#46).
        if (options.generator === "grok" || options.generator === "veo") {
          videoSpinner.text = `🎬 Regenerating scene ${sceneNum} video with ${options.generator}...`;
          const delResult = await executeRegenerateScene({
            projectDir,
            scenes: [sceneNum],
            videoOnly: true,
            generator: options.generator as "grok" | "veo",
            aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1" | undefined,
            retries: maxRetries,
          });
          if (delResult.success && delResult.regeneratedScenes.includes(sceneNum)) {
            videoGenerated = true;
          } else if (delResult.error) {
            videoSpinner.fail(delResult.error);
            exitWithError(apiError(delResult.error, true));
          }
        } else if (options.generator === "kling") {
          const kling = new KlingProvider();
          await kling.initialize({ apiKey: videoApiKey });

          if (!kling.isConfigured()) {
            videoSpinner.fail("Invalid Kling API key format");
            exitWithError(authError("KLING_API_KEY", "Kling"));
          }

          // Try to use image-to-video if ImgBB API key is available
          const imgbbApiKey = await getApiKeyFromConfig("imgbb") || process.env.IMGBB_API_KEY;
          let imageUrl: string | undefined;

          if (imgbbApiKey) {
            videoSpinner.text = `🎬 Uploading image to ImgBB...`;
            const uploadResult = await uploadToImgbb(imageBuffer, imgbbApiKey);
            if (uploadResult.success && uploadResult.url) {
              imageUrl = uploadResult.url;
              videoSpinner.text = `🎬 Starting image-to-video generation...`;
            } else {
              console.log(chalk.yellow(`\n  ⚠ ImgBB upload failed, falling back to text-to-video`));
            }
          }

          const result = await generateVideoWithRetryKling(
            kling,
            segment,
            {
              duration: videoDuration,
              aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1",
              referenceImage: imageUrl, // Use uploaded URL for image-to-video
            },
            maxRetries
          );

          if (result) {
            videoSpinner.text = `🎬 Waiting for video to complete...`;

            for (let attempt = 0; attempt <= maxRetries && !videoGenerated; attempt++) {
              try {
                const waitResult = await kling.waitForCompletion(
                  result.taskId,
                  result.type,
                  (status) => {
                    videoSpinner.text = `🎬 Scene ${sceneNum}: ${status.status}...`;
                  },
                  600000
                );

                if (waitResult.status === "completed" && waitResult.videoUrl) {
                  const buffer = await downloadVideo(waitResult.videoUrl, videoApiKey);
                  await writeFile(videoPath, buffer);

                  // Extend video to match narration duration if needed
                  await extendVideoToTarget(videoPath, segment.duration, outputDir, `Scene ${sceneNum}`, {
                    kling,
                    videoId: waitResult.videoId,
                    onProgress: (msg) => { videoSpinner.text = `🎬 ${msg}`; },
                  });

                  videoGenerated = true;
                } else if (attempt < maxRetries) {
                  videoSpinner.text = `🎬 Scene ${sceneNum}: Retry ${attempt + 1}/${maxRetries}...`;
                  await sleep(RETRY_DELAY_MS);
                }
              } catch (err) {
                if (attempt >= maxRetries) {
                  throw err;
                }
                videoSpinner.text = `🎬 Scene ${sceneNum}: Error, retry ${attempt + 1}/${maxRetries}...`;
                await sleep(RETRY_DELAY_MS);
              }
            }
          }
        } else {
          // Runway
          const runway = new RunwayProvider();
          await runway.initialize({ apiKey: videoApiKey });

          const result = await generateVideoWithRetryRunway(
            runway,
            segment,
            referenceImage,
            {
              duration: videoDuration,
              aspectRatio: options.aspectRatio === "1:1" ? "16:9" : (options.aspectRatio as "16:9" | "9:16"),
            },
            maxRetries,
            (msg) => {
              videoSpinner.text = `🎬 Scene ${sceneNum}: ${msg}`;
            }
          );

          if (result) {
            videoSpinner.text = `🎬 Waiting for video to complete...`;

            for (let attempt = 0; attempt <= maxRetries && !videoGenerated; attempt++) {
              try {
                const waitResult = await runway.waitForCompletion(
                  result.taskId,
                  (status) => {
                    const progress = status.progress !== undefined ? `${status.progress}%` : status.status;
                    videoSpinner.text = `🎬 Scene ${sceneNum}: ${progress}...`;
                  },
                  300000
                );

                if (waitResult.status === "completed" && waitResult.videoUrl) {
                  const buffer = await downloadVideo(waitResult.videoUrl, videoApiKey);
                  await writeFile(videoPath, buffer);

                  // Extend video to match narration duration if needed (Runway - no Kling extend)
                  await extendVideoToTarget(videoPath, segment.duration, outputDir, `Scene ${sceneNum}`, {
                    onProgress: (msg) => { videoSpinner.text = `🎬 ${msg}`; },
                  });

                  videoGenerated = true;
                } else if (attempt < maxRetries) {
                  videoSpinner.text = `🎬 Scene ${sceneNum}: Retry ${attempt + 1}/${maxRetries}...`;
                  await sleep(RETRY_DELAY_MS);
                }
              } catch (err) {
                if (attempt >= maxRetries) {
                  throw err;
                }
                videoSpinner.text = `🎬 Scene ${sceneNum}: Error, retry ${attempt + 1}/${maxRetries}...`;
                await sleep(RETRY_DELAY_MS);
              }
            }
          }
        }

        if (videoGenerated) {
          videoSpinner.succeed(chalk.green("Generated video"));
        } else {
          videoSpinner.fail("Failed to generate video after all retries");
          exitWithError(apiError("Failed to generate video after all retries", true));
        }
      }

      // Step 4: Recalculate startTime for ALL segments and re-save storyboard
      {
        let currentTime = 0;
        for (const seg of segments) {
          seg.startTime = currentTime;
          currentTime += seg.duration;
        }
        // Preserve the source format (don't silently downgrade YAML to JSON).
        const serialized = storyboardIsYaml
          ? yamlStringify({ scenes: segments }, { indent: 2 })
          : JSON.stringify(segments, null, 2);
        await writeFile(storyboardPath!, serialized, "utf-8");
        console.log(chalk.dim(`  → Updated storyboard: ${storyboardPath}`));
      }

      // Step 5: Update project.vibe.json if it exists — update ALL clips' startTime/duration
      if (existsSync(projectPath)) {
        const updateSpinner = ora("📦 Updating project file...").start();

        try {
          const projectContent = await readFile(projectPath, "utf-8");
          const projectData = JSON.parse(projectContent) as ProjectFile;

          // Find and update the source for this scene
          const sceneName = `Scene ${sceneNum}`;
          const narrationName = `Narration ${sceneNum}`;

          // Update video/image source
          const videoSource = projectData.state.sources.find((s) => s.name === sceneName);
          if (videoSource) {
            const hasVideo = existsSync(videoPath);
            videoSource.url = hasVideo ? videoPath : imagePath;
            videoSource.type = hasVideo ? "video" : "image";
            videoSource.duration = segment.duration;
          }

          // Update narration source
          const narrationSource = projectData.state.sources.find((s) => s.name === narrationName);
          if (narrationSource && regenerateNarration) {
            narrationSource.duration = narrationDuration;
          }

          // Update ALL clips' startTime and duration based on recalculated segments
          for (const clip of projectData.state.clips) {
            const source = projectData.state.sources.find((s) => s.id === clip.sourceId);
            if (!source) continue;

            // Match source name to segment (e.g., "Scene 1" → segment 0, "Narration 2" → segment 1)
            const sceneMatch = source.name.match(/^Scene (\d+)$/);
            const narrationMatch = source.name.match(/^Narration (\d+)$/);
            const segIdx = sceneMatch ? parseInt(sceneMatch[1]) - 1 : narrationMatch ? parseInt(narrationMatch[1]) - 1 : -1;

            if (segIdx >= 0 && segIdx < segments.length) {
              const seg = segments[segIdx];
              clip.startTime = seg.startTime;
              clip.duration = seg.duration;
              clip.sourceEndOffset = seg.duration;
              // Also update the source duration to match segment
              source.duration = seg.duration;
            }
          }

          await writeFile(projectPath, JSON.stringify(projectData, null, 2), "utf-8");
          updateSpinner.succeed(chalk.green("Updated project file (all clips synced)"));
        } catch (err) {
          updateSpinner.warn(chalk.yellow(`Could not update project file: ${err}`));
        }
      }

        console.log(chalk.green(`  ✓ Scene ${sceneNum} done`));
      } // End of for loop over sceneNums

      // Final summary
      console.log();
      console.log(chalk.bold.green(`✅ ${sceneNums.length} scene${sceneNums.length > 1 ? "s" : ""} regenerated successfully!`));
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
