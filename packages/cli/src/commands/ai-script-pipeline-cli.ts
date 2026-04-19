/**
 * @module ai-script-pipeline-cli
 * @description CLI command registration for the script-to-video pipeline and
 *   scene regeneration commands. Execute functions and helpers live in
 *   ai-script-pipeline.ts; this file wires them up as Commander.js subcommands.
 */

import { Command } from "commander";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { resolve, dirname, extname } from "node:path";
import { existsSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import { stringify as yamlStringify, parse as yamlParse } from "yaml";
import {
  GeminiProvider,
  OpenAIProvider,
  OpenAIImageProvider,
  ClaudeProvider,
  ElevenLabsProvider,
  KlingProvider,
  RunwayProvider,
  GrokProvider,
} from "@vibeframe/ai-providers";
import { getApiKey, loadEnv } from "../utils/api-key.js";
import { getApiKeyFromConfig } from "../config/index.js";
import { Project, type ProjectFile } from "../engine/index.js";
import { getAudioDuration } from "../utils/audio.js";
import { applyTextOverlays, type TextOverlayStyle } from "./ai-edit.js";
import { executeReview } from "./ai-review.js";
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

      // Get storyboard provider API key
      const storyboardProvider = (options.storyboardProvider || "claude") as "claude" | "openai" | "gemini";
      let storyboardApiKey: string | undefined;

      if (storyboardProvider === "openai") {
        storyboardApiKey = (await getApiKey("OPENAI_API_KEY", "OpenAI")) ?? undefined;
        if (!storyboardApiKey) {
          exitWithError(authError("OPENAI_API_KEY", "OpenAI"));
        }
      } else if (storyboardProvider === "gemini") {
        storyboardApiKey = (await getApiKey("GOOGLE_API_KEY", "Google")) ?? undefined;
        if (!storyboardApiKey) {
          exitWithError(authError("GOOGLE_API_KEY", "Google"));
        }
      } else if (storyboardProvider === "claude") {
        storyboardApiKey = (await getApiKey("ANTHROPIC_API_KEY", "Anthropic")) ?? undefined;
        if (!storyboardApiKey) {
          exitWithError(authError("ANTHROPIC_API_KEY", "Anthropic"));
        }
      } else {
        exitWithError(usageError(`Unknown storyboard provider: ${storyboardProvider}`, "Use claude, openai, or gemini"));
      }

      // Get image provider API key
      let imageApiKey: string | undefined;
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
      } else {
        exitWithError(usageError(`Unknown image provider: ${imageProvider}`, "Use openai, gemini, or grok"));
      }

      let elevenlabsApiKey: string | undefined;
      if (options.voiceover !== false) {
        const key = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs");
        if (!key) {
          exitWithError(authError("ELEVENLABS_API_KEY", "ElevenLabs"));
        }
        elevenlabsApiKey = key;
      }

      let videoApiKey: string | undefined;
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
        const key = await getApiKey(genInfo.envVar, genInfo.name);
        if (!key) {
          exitWithError(authError(genInfo.envVar, genInfo.name));
        }
        videoApiKey = key;
      }

      // Read script content
      let scriptContent = script;
      if (options.file) {
        const filePath = resolve(process.cwd(), script);
        scriptContent = await readFile(filePath, "utf-8");
      }

      // Grok and Veo route through executeScriptToVideo (fully supports all 4 providers).
      // Kling and Runway still use the inline path below pending full dedup (#38 follow-up).
      const delegatedGenerators = new Set(["grok", "veo"]);
      if (!options.imagesOnly && delegatedGenerators.has(options.generator)) {
        const pipelineSpinner = ora(`🎬 Running script-to-video with ${options.generator}...`).start();
        const result = await executeScriptToVideo({
          script: scriptContent,
          outputDir: options.outputDir,
          duration: options.duration ? parseFloat(options.duration) : undefined,
          voice: options.voice,
          generator: options.generator as "grok" | "veo",
          imageProvider: options.imageProvider as "openai" | "gemini" | "grok" | undefined,
          aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1" | undefined,
          imagesOnly: options.imagesOnly,
          noVoiceover: options.voiceover === false,
          retries: parseInt(options.retries) || DEFAULT_VIDEO_RETRIES,
          creativity: (options.creativity as "low" | "high" | undefined),
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
        return;
      }

      // Determine output directory for assets
      // If -o looks like a directory and --output-dir is not explicitly set, use -o directory for assets
      let effectiveOutputDir = options.outputDir;
      const outputLooksLikeDirectory =
        options.output.endsWith("/") ||
        (!options.output.endsWith(".json") && !options.output.endsWith(".vibe.json"));

      if (outputLooksLikeDirectory && options.outputDir === "script-video-output") {
        // User specified a directory for -o but didn't set --output-dir, use -o directory for assets
        effectiveOutputDir = options.output;
      }

      // Create output directory
      const outputDir = resolve(process.cwd(), effectiveOutputDir);
      if (!existsSync(outputDir)) {
        await mkdir(outputDir, { recursive: true });
      }

      // Validate creativity level
      const creativity = options.creativity?.toLowerCase();
      if (creativity && creativity !== "low" && creativity !== "high") {
        exitWithError(usageError("Invalid creativity level.", "Use 'low' or 'high'."));
      }

      console.log();
      console.log(chalk.bold.cyan("🎬 Script-to-Video Pipeline"));
      console.log(chalk.dim("─".repeat(60)));
      if (creativity === "high") {
        console.log(chalk.yellow("🎨 High creativity mode: Generating varied, unexpected scenes"));
      }
      console.log();

      // Step 1: Generate storyboard
      const providerLabel = storyboardProvider.charAt(0).toUpperCase() + storyboardProvider.slice(1);
      const storyboardSpinnerText = creativity === "high"
        ? `Analyzing script with ${providerLabel} (high creativity)...`
        : `Analyzing script with ${providerLabel}...`;
      const storyboardSpinner = ora(storyboardSpinnerText).start();

      let segments: StoryboardSegment[];
      const creativityOpts = { creativity: creativity as "low" | "high" | undefined };
      const durationOpt = options.duration ? parseFloat(options.duration) : undefined;

      if (storyboardProvider === "openai") {
        const openai = new OpenAIProvider();
        await openai.initialize({ apiKey: storyboardApiKey! });
        segments = await openai.analyzeContent(scriptContent, durationOpt, creativityOpts);
      } else if (storyboardProvider === "gemini") {
        const gemini = new GeminiProvider();
        await gemini.initialize({ apiKey: storyboardApiKey! });
        segments = await gemini.analyzeContent(scriptContent, durationOpt, creativityOpts);
      } else {
        const claude = new ClaudeProvider();
        await claude.initialize({ apiKey: storyboardApiKey! });
        segments = await claude.analyzeContent(scriptContent, durationOpt, creativityOpts);
      }

      if (segments.length === 0) {
        storyboardSpinner.fail("Failed to generate storyboard");
        exitWithError(apiError("Failed to generate storyboard (check API key and error above)", true));
      }

      let totalDuration = segments.reduce((sum, seg) => sum + seg.duration, 0);
      storyboardSpinner.succeed(chalk.green(`Generated ${segments.length} scenes (total: ${totalDuration}s)`));

      // Save storyboard
      const storyboardPath = resolve(outputDir, "storyboard.json");
      await writeFile(storyboardPath, JSON.stringify(segments, null, 2), "utf-8");
      console.log(chalk.dim(`  → Saved: ${storyboardPath}`));
      console.log();

      // Step 2: Generate per-scene voiceovers with ElevenLabs
      const perSceneTTS: { path: string; duration: number; segmentIndex: number }[] = [];
      const failedNarrations: { sceneNum: number; error: string }[] = [];

      if (options.voiceover !== false && elevenlabsApiKey) {
        const ttsSpinner = ora("🎙️ Generating voiceovers with ElevenLabs...").start();

        const elevenlabs = new ElevenLabsProvider();
        await elevenlabs.initialize({ apiKey: elevenlabsApiKey });

        let totalCharacters = 0;

        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i];
          const narrationText = segment.narration || segment.description;

          if (!narrationText) continue;

          // Pre-TTS word count validation
          const wordCount = narrationText.split(/\s+/).filter(Boolean).length;
          const maxWords = segment.duration > 5 ? 24 : 12;
          if (wordCount > maxWords * 1.3) {
            console.log(chalk.yellow(`  ⚠ Scene ${i + 1} narration too long: ${wordCount} words (max ~${maxWords} for ${segment.duration}s). Trimming may cause rushed speech.`));
          }

          ttsSpinner.text = `🎙️ Generating narration ${i + 1}/${segments.length}...`;

          let ttsResult = await elevenlabs.textToSpeech(narrationText, {
            voiceId: options.voice,
          });

          if (!ttsResult.success || !ttsResult.audioBuffer) {
            const errorMsg = ttsResult.error || "Unknown error";
            failedNarrations.push({ sceneNum: i + 1, error: errorMsg });
            ttsSpinner.text = `🎙️ Generating narration ${i + 1}/${segments.length}... (failed)`;
            console.log(chalk.yellow(`\n  ⚠ Narration ${i + 1} failed: ${errorMsg}`));
            continue;
          }

          const audioPath = resolve(outputDir, `narration-${i + 1}.mp3`);
          await writeFile(audioPath, ttsResult.audioBuffer);

          // Get actual audio duration using ffprobe
          let actualDuration = await getAudioDuration(audioPath);

          // Auto speed-adjust if narration exceeds video bracket (5s or 10s)
          const videoBracket = segment.duration > 5 ? 10 : 5;
          const overageRatio = actualDuration / videoBracket;
          if (overageRatio > 1.0 && overageRatio <= 1.35) {
            // Narration exceeds bracket by 0-35% — regenerate at faster speed
            const adjustedSpeed = Math.min(1.35, parseFloat(overageRatio.toFixed(2)));
            ttsSpinner.text = `🎙️ Narration ${i + 1}: adjusting speed to ${adjustedSpeed}x...`;
            const speedResult = await elevenlabs.textToSpeech(narrationText, {
              voiceId: options.voice,
              speed: adjustedSpeed,
            });
            if (speedResult.success && speedResult.audioBuffer) {
              await writeFile(audioPath, speedResult.audioBuffer);
              actualDuration = await getAudioDuration(audioPath);
              ttsResult = speedResult;
              console.log(chalk.dim(`  → Speed-adjusted narration ${i + 1}: ${adjustedSpeed}x → ${actualDuration.toFixed(1)}s`));
            }
          } else if (overageRatio > 1.35) {
            // Narration way too long — warn user
            console.log(chalk.yellow(`  ⚠ Narration ${i + 1} is ${((overageRatio - 1) * 100).toFixed(0)}% over target (${actualDuration.toFixed(1)}s vs ${videoBracket}s bracket)`));
          }

          // Update segment duration to match actual narration length
          segment.duration = actualDuration;

          perSceneTTS.push({ path: audioPath, duration: actualDuration, segmentIndex: i });
          totalCharacters += ttsResult.characterCount || 0;

          console.log(chalk.dim(`  → Saved: ${audioPath} (${actualDuration.toFixed(1)}s)`));
        }

        // Recalculate startTime for all segments based on updated durations
        let currentTime = 0;
        for (const segment of segments) {
          segment.startTime = currentTime;
          currentTime += segment.duration;
        }

        // Update total duration
        totalDuration = segments.reduce((sum, seg) => sum + seg.duration, 0);

        // Show success with failed count if any
        if (failedNarrations.length > 0) {
          ttsSpinner.warn(chalk.yellow(`Generated ${perSceneTTS.length}/${segments.length} narrations (${failedNarrations.length} failed)`));
        } else {
          ttsSpinner.succeed(chalk.green(`Generated ${perSceneTTS.length}/${segments.length} narrations (${totalCharacters} chars, ${totalDuration.toFixed(1)}s total)`));
        }

        // Re-save storyboard with updated durations
        await writeFile(storyboardPath, JSON.stringify(segments, null, 2), "utf-8");
        console.log(chalk.dim(`  → Updated storyboard: ${storyboardPath}`));
        console.log();
      }

      // Step 3: Generate images with selected provider
      const providerNames: Record<string, string> = {
        openai: "OpenAI GPT Image 1.5",
        dalle: "OpenAI GPT Image 1.5", // backward compatibility
        gemini: "Gemini",
        grok: "xAI Grok",
      };
      const imageSpinner = ora(`🎨 Generating visuals with ${providerNames[imageProvider]}...`).start();

      // Determine image size/aspect ratio based on provider
      const dalleImageSizes: Record<string, "1536x1024" | "1024x1536" | "1024x1024"> = {
        "16:9": "1536x1024",
        "9:16": "1024x1536",
        "1:1": "1024x1024",
      };
      const imagePaths: string[] = [];

      // Store first scene image for style continuity
      let firstSceneImage: Buffer | undefined;

      // Initialize the selected provider
      let openaiImageInstance: OpenAIImageProvider | undefined;
      let geminiInstance: GeminiProvider | undefined;
      let grokInstance: GrokProvider | undefined;

      if (imageProvider === "openai" || imageProvider === "dalle") {
        openaiImageInstance = new OpenAIImageProvider();
        await openaiImageInstance.initialize({ apiKey: imageApiKey });
      } else if (imageProvider === "gemini") {
        geminiInstance = new GeminiProvider();
        await geminiInstance.initialize({ apiKey: imageApiKey });
      } else if (imageProvider === "grok") {
        grokInstance = new GrokProvider();
        await grokInstance.initialize({ apiKey: imageApiKey });
      }

      // Get character description from first segment (should be same across all)
      const characterDescription = segments[0]?.characterDescription;

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        imageSpinner.text = `🎨 Generating image ${i + 1}/${segments.length}: ${segment.description.slice(0, 30)}...`;

        // Build comprehensive image prompt with character description
        let imagePrompt = segment.visuals;

        // Add character description to ensure consistency
        if (characterDescription) {
          imagePrompt = `CHARACTER (must match exactly): ${characterDescription}. SCENE: ${imagePrompt}`;
        }

        // Add visual style
        if (segment.visualStyle) {
          imagePrompt = `${imagePrompt}. STYLE: ${segment.visualStyle}`;
        }

        // For scenes after the first, add extra continuity instruction (OpenAI)
        // Gemini uses editImage with reference instead
        if (i > 0 && firstSceneImage && imageProvider !== "gemini") {
          imagePrompt = `${imagePrompt}. CRITICAL: The character must look IDENTICAL to the first scene - same face, hair, clothing, accessories.`;
        }

        try {
          let imageBuffer: Buffer | undefined;
          let imageUrl: string | undefined;
          let imageError: string | undefined;

          if ((imageProvider === "openai" || imageProvider === "dalle") && openaiImageInstance) {
            const imageResult = await openaiImageInstance.generateImage(imagePrompt, {
              size: dalleImageSizes[options.aspectRatio] || "1536x1024",
              quality: "standard",
            });
            if (imageResult.success && imageResult.images && imageResult.images.length > 0) {
              // GPT Image 1.5 returns base64, DALL-E 3 returns URL
              const img = imageResult.images[0];
              if (img.base64) {
                imageBuffer = Buffer.from(img.base64, "base64");
              } else if (img.url) {
                imageUrl = img.url;
              }
            } else {
              imageError = imageResult.error;
            }
          } else if (imageProvider === "gemini" && geminiInstance) {
            // Gemini: use editImage with first scene reference for subsequent scenes
            if (i > 0 && firstSceneImage) {
              // Use editImage to maintain style continuity with first scene
              const editPrompt = `Create a new scene for a video: ${imagePrompt}. IMPORTANT: Maintain the exact same character appearance, clothing, environment style, color palette, and art style as the reference image.`;
              const imageResult = await geminiInstance.editImage([firstSceneImage], editPrompt, {
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
              // First scene: use regular generateImage
              const imageResult = await geminiInstance.generateImage(imagePrompt, {
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
          } else if (imageProvider === "grok" && grokInstance) {
            const imageResult = await grokInstance.generateImage(imagePrompt, {
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

          // Save the image
          const imagePath = resolve(outputDir, `scene-${i + 1}.png`);

          if (imageBuffer) {
            await writeFile(imagePath, imageBuffer);
            imagePaths.push(imagePath);
            // Store first successful image for style continuity
            if (!firstSceneImage) {
              firstSceneImage = imageBuffer;
            }
          } else if (imageUrl) {
            const response = await fetch(imageUrl);
            const buffer = Buffer.from(await response.arrayBuffer());
            await writeFile(imagePath, buffer);
            imagePaths.push(imagePath);
            // Store first successful image for style continuity
            if (!firstSceneImage) {
              firstSceneImage = buffer;
            }
          } else {
            const errorMsg = imageError || "Unknown error";
            console.log(chalk.yellow(`\n  ⚠ Failed to generate image for scene ${i + 1}: ${errorMsg}`));
            imagePaths.push("");
          }
        } catch (err) {
          console.log(chalk.yellow(`\n  ⚠ Error generating image for scene ${i + 1}: ${err}`));
          imagePaths.push("");
        }

        // Small delay to avoid rate limiting
        if (i < segments.length - 1) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      const successfulImages = imagePaths.filter((p) => p !== "").length;
      imageSpinner.succeed(chalk.green(`Generated ${successfulImages}/${segments.length} images with ${providerNames[imageProvider]}`));
      console.log();

      // Step 4: Generate videos (if not images-only)
      const videoPaths: string[] = [];
      const failedScenes: number[] = []; // Track failed scenes for summary
      const maxRetries = parseInt(options.retries) || DEFAULT_VIDEO_RETRIES;

      if (!options.imagesOnly && videoApiKey) {
        // Guard already enforced above (before storyboard/image/narration);
        // reaching here means generator ∈ {kling, runway}.
        const providerLabel = options.generator === "kling" ? "Kling" : "Runway";
        const videoSpinner = ora(`🎬 Generating videos with ${providerLabel}...`).start();

        if (options.generator === "kling") {
          const kling = new KlingProvider();
          await kling.initialize({ apiKey: videoApiKey });

          if (!kling.isConfigured()) {
            videoSpinner.fail("Invalid Kling API key format");
            exitWithError(authError("KLING_API_KEY", "Kling"));
          }

          // Check for ImgBB API key for image-to-video support (from config or env)
          const imgbbApiKey = await getApiKeyFromConfig("imgbb") || process.env.IMGBB_API_KEY;
          const useImageToVideo = !!imgbbApiKey;

          if (useImageToVideo) {
            videoSpinner.text = `🎬 Uploading images to ImgBB for image-to-video...`;
          }

          // Upload images to ImgBB if API key is available (for Kling v2.x image-to-video)
          const imageUrls: (string | undefined)[] = [];
          if (useImageToVideo) {
            for (let i = 0; i < imagePaths.length; i++) {
              if (imagePaths[i] && imagePaths[i] !== "") {
                try {
                  const imageBuffer = await readFile(imagePaths[i]);
                  const uploadResult = await uploadToImgbb(imageBuffer, imgbbApiKey);
                  if (uploadResult.success && uploadResult.url) {
                    imageUrls[i] = uploadResult.url;
                  } else {
                    console.log(chalk.yellow(`\n  ⚠ Failed to upload image ${i + 1}: ${uploadResult.error}`));
                    imageUrls[i] = undefined;
                  }
                } catch {
                  imageUrls[i] = undefined;
                }
              } else {
                imageUrls[i] = undefined;
              }
            }
            const uploadedCount = imageUrls.filter((u) => u).length;
            if (uploadedCount > 0) {
              videoSpinner.text = `🎬 Uploaded ${uploadedCount}/${imagePaths.length} images to ImgBB`;
            }
          }

          // Sequential mode: generate one video at a time (slower but more reliable)
          if (options.sequential) {
            for (let i = 0; i < segments.length; i++) {
              const segment = segments[i] as StoryboardSegment;
              videoSpinner.text = `🎬 Scene ${i + 1}/${segments.length}: Starting...`;

              const videoDuration = (segment.duration > 5 ? 10 : 5) as 5 | 10;
              const referenceImage = imageUrls[i];

              let completed = false;
              for (let attempt = 0; attempt <= maxRetries && !completed; attempt++) {
                const result = await generateVideoWithRetryKling(
                  kling,
                  segment,
                  {
                    duration: videoDuration,
                    aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1",
                    referenceImage,
                  },
                  0, // Handle retries at this level
                  (msg) => {
                    videoSpinner.text = `🎬 Scene ${i + 1}/${segments.length}: ${msg}`;
                  }
                );

                if (!result) {
                  if (attempt < maxRetries) {
                    videoSpinner.text = `🎬 Scene ${i + 1}: Submit failed, retry ${attempt + 1}/${maxRetries}...`;
                    await sleep(RETRY_DELAY_MS);
                    continue;
                  }
                  console.log(chalk.yellow(`\n  ⚠ Failed to start video generation for scene ${i + 1}`));
                  videoPaths[i] = "";
                  failedScenes.push(i + 1);
                  break;
                }

                try {
                  const waitResult = await kling.waitForCompletion(
                    result.taskId,
                    result.type,
                    (status) => {
                      videoSpinner.text = `🎬 Scene ${i + 1}/${segments.length}: ${status.status}...`;
                    },
                    600000
                  );

                  if (waitResult.status === "completed" && waitResult.videoUrl) {
                    const videoPath = resolve(outputDir, `scene-${i + 1}.mp4`);
                    const buffer = await downloadVideo(waitResult.videoUrl, videoApiKey);
                    await writeFile(videoPath, buffer);

                    // Extend video to match narration duration if needed
                    await extendVideoToTarget(videoPath, segment.duration, outputDir, `Scene ${i + 1}`, {
                      kling,
                      videoId: waitResult.videoId,
                      onProgress: (msg) => { videoSpinner.text = `🎬 ${msg}`; },
                    });

                    videoPaths[i] = videoPath;
                    completed = true;
                    console.log(chalk.green(`\n  ✓ Scene ${i + 1} completed`));
                  } else if (attempt < maxRetries) {
                    videoSpinner.text = `🎬 Scene ${i + 1}: Failed, retry ${attempt + 1}/${maxRetries}...`;
                    await sleep(RETRY_DELAY_MS);
                  } else {
                    videoPaths[i] = "";
                    failedScenes.push(i + 1);
                  }
                } catch (err) {
                  if (attempt < maxRetries) {
                    videoSpinner.text = `🎬 Scene ${i + 1}: Error, retry ${attempt + 1}/${maxRetries}...`;
                    await sleep(RETRY_DELAY_MS);
                  } else {
                    console.log(chalk.yellow(`\n  ⚠ Error for scene ${i + 1}: ${err}`));
                    videoPaths[i] = "";
                    failedScenes.push(i + 1);
                  }
                }
              }
            }
          } else {
            // Parallel mode (default): batch-based submission respecting concurrency limit
            const concurrency = Math.max(1, parseInt(options.concurrency) || 3);

            for (let batchStart = 0; batchStart < segments.length; batchStart += concurrency) {
              const batchEnd = Math.min(batchStart + concurrency, segments.length);
              const batchNum = Math.floor(batchStart / concurrency) + 1;
              const totalBatches = Math.ceil(segments.length / concurrency);

              if (totalBatches > 1) {
                videoSpinner.text = `🎬 Batch ${batchNum}/${totalBatches}: submitting scenes ${batchStart + 1}-${batchEnd}...`;
              }

              // Phase 1: Submit batch
              const tasks: Array<{ taskId: string; index: number; segment: StoryboardSegment; type: "text2video" | "image2video" }> = [];

              for (let i = batchStart; i < batchEnd; i++) {
                const segment = segments[i] as StoryboardSegment;
                videoSpinner.text = `🎬 Submitting video task ${i + 1}/${segments.length}...`;

                const videoDuration = (segment.duration > 5 ? 10 : 5) as 5 | 10;
                const referenceImage = imageUrls[i];

                const result = await generateVideoWithRetryKling(
                  kling,
                  segment,
                  {
                    duration: videoDuration,
                    aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1",
                    referenceImage,
                  },
                  maxRetries,
                  (msg) => {
                    videoSpinner.text = `🎬 Scene ${i + 1}: ${msg}`;
                  }
                );

                if (result) {
                  tasks.push({ taskId: result.taskId, index: i, segment, type: result.type });
                  if (!videoPaths[i]) videoPaths[i] = "";
                } else {
                  console.log(chalk.yellow(`\n  ⚠ Failed to start video generation for scene ${i + 1} (after ${maxRetries} retries)`));
                  videoPaths[i] = "";
                  failedScenes.push(i + 1);
                }
              }

              // Phase 2: Wait for batch completion
              videoSpinner.text = `🎬 Waiting for batch ${batchNum} (${tasks.length} video${tasks.length > 1 ? "s" : ""})...`;

              for (const task of tasks) {
                let completed = false;
                let currentTaskId = task.taskId;
                let currentType = task.type;

                for (let attempt = 0; attempt <= maxRetries && !completed; attempt++) {
                  try {
                    const result = await kling.waitForCompletion(
                      currentTaskId,
                      currentType,
                      (status) => {
                        videoSpinner.text = `🎬 Scene ${task.index + 1}: ${status.status}...`;
                      },
                      600000
                    );

                    if (result.status === "completed" && result.videoUrl) {
                      const videoPath = resolve(outputDir, `scene-${task.index + 1}.mp4`);
                      const buffer = await downloadVideo(result.videoUrl, videoApiKey);
                      await writeFile(videoPath, buffer);

                      // Extend video to match narration duration if needed
                      await extendVideoToTarget(videoPath, task.segment.duration, outputDir, `Scene ${task.index + 1}`, {
                        kling,
                        videoId: result.videoId,
                        onProgress: (msg) => { videoSpinner.text = `🎬 ${msg}`; },
                      });

                      videoPaths[task.index] = videoPath;
                      completed = true;
                    } else if (attempt < maxRetries) {
                      videoSpinner.text = `🎬 Scene ${task.index + 1}: Retry ${attempt + 1}/${maxRetries}...`;
                      await sleep(RETRY_DELAY_MS);

                      const videoDuration = (task.segment.duration > 5 ? 10 : 5) as 5 | 10;
                      const retryReferenceImage = imageUrls[task.index];

                      const retryResult = await generateVideoWithRetryKling(
                        kling,
                        task.segment,
                        {
                          duration: videoDuration,
                          aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1",
                          referenceImage: retryReferenceImage,
                        },
                        0
                      );

                      if (retryResult) {
                        currentTaskId = retryResult.taskId;
                        currentType = retryResult.type;
                      } else {
                        videoPaths[task.index] = "";
                        failedScenes.push(task.index + 1);
                        completed = true;
                      }
                    } else {
                      videoPaths[task.index] = "";
                      failedScenes.push(task.index + 1);
                    }
                  } catch (err) {
                    if (attempt >= maxRetries) {
                      console.log(chalk.yellow(`\n  ⚠ Error completing video for scene ${task.index + 1}: ${err}`));
                      videoPaths[task.index] = "";
                      failedScenes.push(task.index + 1);
                    } else {
                      videoSpinner.text = `🎬 Scene ${task.index + 1}: Error, retry ${attempt + 1}/${maxRetries}...`;
                      await sleep(RETRY_DELAY_MS);
                    }
                  }
                }
              }

              if (totalBatches > 1 && batchEnd < segments.length) {
                console.log(chalk.dim(`  → Batch ${batchNum}/${totalBatches} complete`));
              }
            }
          }
        } else {
          // Runway
          const runway = new RunwayProvider();
          await runway.initialize({ apiKey: videoApiKey });

          // Submit all video generation tasks with retry logic
          const tasks: Array<{ taskId: string; index: number; imagePath: string; referenceImage: string; segment: StoryboardSegment }> = [];

          for (let i = 0; i < segments.length; i++) {
            if (!imagePaths[i]) {
              videoPaths.push("");
              continue;
            }

            const segment = segments[i] as StoryboardSegment;
            videoSpinner.text = `🎬 Submitting video task ${i + 1}/${segments.length}...`;

            const imageBuffer = await readFile(imagePaths[i]);
            const ext = extname(imagePaths[i]).toLowerCase().slice(1);
            const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
            const referenceImage = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

            // Use 10s video if narration > 5s to avoid video ending before narration
            const videoDuration = (segment.duration > 5 ? 10 : 5) as 5 | 10;

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
                videoSpinner.text = `🎬 Scene ${i + 1}: ${msg}`;
              }
            );

            if (result) {
              tasks.push({ taskId: result.taskId, index: i, imagePath: imagePaths[i], referenceImage, segment });
            } else {
              console.log(chalk.yellow(`\n  ⚠ Failed to start video generation for scene ${i + 1} (after ${maxRetries} retries)`));
              videoPaths[i] = "";
              failedScenes.push(i + 1);
            }
          }

          // Wait for all tasks to complete with retry logic
          videoSpinner.text = `🎬 Waiting for ${tasks.length} video(s) to complete...`;

          for (const task of tasks) {
            let completed = false;
            let currentTaskId = task.taskId;

            for (let attempt = 0; attempt <= maxRetries && !completed; attempt++) {
              try {
                const result = await runway.waitForCompletion(
                  currentTaskId,
                  (status) => {
                    const progress = status.progress !== undefined ? `${status.progress}%` : status.status;
                    videoSpinner.text = `🎬 Scene ${task.index + 1}: ${progress}...`;
                  },
                  300000 // 5 minute timeout per video
                );

                if (result.status === "completed" && result.videoUrl) {
                  const videoPath = resolve(outputDir, `scene-${task.index + 1}.mp4`);
                  const buffer = await downloadVideo(result.videoUrl, videoApiKey);
                  await writeFile(videoPath, buffer);

                  // Extend video to match narration duration if needed
                  await extendVideoToTarget(videoPath, task.segment.duration, outputDir, `Scene ${task.index + 1}`, {
                    onProgress: (msg) => { videoSpinner.text = `🎬 ${msg}`; },
                  });

                  videoPaths[task.index] = videoPath;
                  completed = true;
                } else if (attempt < maxRetries) {
                  // Resubmit task on failure
                  videoSpinner.text = `🎬 Scene ${task.index + 1}: Retry ${attempt + 1}/${maxRetries}...`;
                  await sleep(RETRY_DELAY_MS);

                  const videoDuration = (task.segment.duration > 5 ? 10 : 5) as 5 | 10;
                  const retryResult = await generateVideoWithRetryRunway(
                    runway,
                    task.segment,
                    task.referenceImage,
                    {
                      duration: videoDuration,
                      aspectRatio: options.aspectRatio === "1:1" ? "16:9" : (options.aspectRatio as "16:9" | "9:16"),
                    },
                    0, // No nested retries
                    (msg) => {
                      videoSpinner.text = `🎬 Scene ${task.index + 1}: ${msg}`;
                    }
                  );

                  if (retryResult) {
                    currentTaskId = retryResult.taskId;
                  } else {
                    videoPaths[task.index] = "";
                    failedScenes.push(task.index + 1);
                    completed = true; // Exit retry loop
                  }
                } else {
                  videoPaths[task.index] = "";
                  failedScenes.push(task.index + 1);
                }
              } catch (err) {
                if (attempt >= maxRetries) {
                  console.log(chalk.yellow(`\n  ⚠ Error completing video for scene ${task.index + 1}: ${err}`));
                  videoPaths[task.index] = "";
                  failedScenes.push(task.index + 1);
                } else {
                  videoSpinner.text = `🎬 Scene ${task.index + 1}: Error, retry ${attempt + 1}/${maxRetries}...`;
                  await sleep(RETRY_DELAY_MS);
                }
              }
            }
          }
        }

        const successfulVideos = videoPaths.filter((p) => p && p !== "").length;
        videoSpinner.succeed(chalk.green(`Generated ${successfulVideos}/${segments.length} videos`));
        console.log();
      }

      // Step 4.5: Apply text overlays (if segments have textOverlays)
      if (options.textOverlay !== false) {
        const overlaySegments = segments.filter(
          (s: StoryboardSegment, i: number) => s.textOverlays && s.textOverlays.length > 0 && videoPaths[i] && videoPaths[i] !== ""
        );
        if (overlaySegments.length > 0) {
          const overlaySpinner = ora(`Applying text overlays to ${overlaySegments.length} scene(s)...`).start();
          let overlayCount = 0;
          for (let i = 0; i < segments.length; i++) {
            const segment = segments[i] as StoryboardSegment;
            if (segment.textOverlays && segment.textOverlays.length > 0 && videoPaths[i] && videoPaths[i] !== "") {
              try {
                const overlayOutput = videoPaths[i].replace(/(\.[^.]+)$/, "-overlay$1");
                const overlayResult = await applyTextOverlays({
                  videoPath: videoPaths[i],
                  texts: segment.textOverlays,
                  outputPath: overlayOutput,
                  style: (options.textStyle as TextOverlayStyle) || "lower-third",
                });
                if (overlayResult.success && overlayResult.outputPath) {
                  videoPaths[i] = overlayResult.outputPath;
                  overlayCount++;
                }
              } catch {
                // Silent fallback: keep original video
              }
            }
          }
          overlaySpinner.succeed(chalk.green(`Applied text overlays to ${overlayCount} scene(s)`));
          console.log();
        }
      }

      // Step 5: Assemble project
      const assembleSpinner = ora("Assembling project...").start();

      const project = new Project("Script-to-Video Output");
      project.setAspectRatio(options.aspectRatio as "16:9" | "9:16" | "1:1");

      // Clear default tracks and create new ones
      const defaultTracks = project.getTracks();
      for (const track of defaultTracks) {
        project.removeTrack(track.id);
      }

      const videoTrack = project.addTrack({
        name: "Video",
        type: "video",
        order: 1,
        isMuted: false,
        isLocked: false,
        isVisible: true,
      });

      const audioTrack = project.addTrack({
        name: "Audio",
        type: "audio",
        order: 0,
        isMuted: false,
        isLocked: false,
        isVisible: true,
      });

      // Add per-scene narration sources and clips
      for (const tts of perSceneTTS) {
        const segment = segments[tts.segmentIndex];
        const audioSource = project.addSource({
          name: `Narration ${tts.segmentIndex + 1}`,
          url: tts.path,
          type: "audio",
          duration: tts.duration,
        });

        project.addClip({
          sourceId: audioSource.id,
          trackId: audioTrack.id,
          startTime: segment.startTime,
          duration: tts.duration,
          sourceStartOffset: 0,
          sourceEndOffset: tts.duration,
        });
      }

      // Add video/image sources and clips
      let currentTime = 0;
      const videoClipIds: string[] = [];
      const fadeDuration = 0.3; // Fade duration in seconds for smooth transitions

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const hasVideo = videoPaths[i] && videoPaths[i] !== "";
        const hasImage = imagePaths[i] && imagePaths[i] !== "";

        if (!hasVideo && !hasImage) {
          // Skip if no visual asset
          currentTime += segment.duration;
          continue;
        }

        const assetPath = hasVideo ? videoPaths[i] : imagePaths[i];
        const mediaType = hasVideo ? "video" : "image";

        const source = project.addSource({
          name: `Scene ${i + 1}`,
          url: assetPath,
          type: mediaType as "video" | "image",
          duration: segment.duration,
        });

        const clip = project.addClip({
          sourceId: source.id,
          trackId: videoTrack.id,
          startTime: currentTime,
          duration: segment.duration,
          sourceStartOffset: 0,
          sourceEndOffset: segment.duration,
        });

        videoClipIds.push(clip.id);
        currentTime += segment.duration;
      }

      // Add fade effects to video clips for smoother scene transitions
      for (let i = 0; i < videoClipIds.length; i++) {
        const clipId = videoClipIds[i];
        const clip = project.getClips().find(c => c.id === clipId);
        if (!clip) continue;

        // Add fadeIn effect (except for first clip)
        if (i > 0) {
          project.addEffect(clipId, {
            type: "fadeIn",
            startTime: 0,
            duration: fadeDuration,
            params: {},
          });
        }

        // Add fadeOut effect (except for last clip)
        if (i < videoClipIds.length - 1) {
          project.addEffect(clipId, {
            type: "fadeOut",
            startTime: clip.duration - fadeDuration,
            duration: fadeDuration,
            params: {},
          });
        }
      }

      // Save project file
      let outputPath = resolve(process.cwd(), options.output);

      // Detect if output looks like a directory (ends with / or no .json extension)
      const looksLikeDirectory =
        options.output.endsWith("/") ||
        (!options.output.endsWith(".json") &&
          !options.output.endsWith(".vibe.json"));

      if (looksLikeDirectory) {
        // Create directory if it doesn't exist
        if (!existsSync(outputPath)) {
          await mkdir(outputPath, { recursive: true });
        }
        outputPath = resolve(outputPath, "project.vibe.json");
      } else if (
        existsSync(outputPath) &&
        (await stat(outputPath)).isDirectory()
      ) {
        // Existing directory without trailing slash
        outputPath = resolve(outputPath, "project.vibe.json");
      } else {
        // File path - ensure parent directory exists
        const parentDir = dirname(outputPath);
        if (!existsSync(parentDir)) {
          await mkdir(parentDir, { recursive: true });
        }
      }

      await writeFile(
        outputPath,
        JSON.stringify(project.toJSON(), null, 2),
        "utf-8"
      );

      assembleSpinner.succeed(chalk.green("Project assembled"));

      // Step 6: AI Review (optional)
      if (options.review) {
        const reviewSpinner = ora("Reviewing video with Gemini AI...").start();
        try {
          const reviewTarget = videoPaths.find((p) => p && p !== "");
          if (reviewTarget) {
            const storyboardFile = resolve(effectiveOutputDir, "storyboard.json");
            const reviewResult = await executeReview({
              videoPath: reviewTarget,
              storyboardPath: existsSync(storyboardFile) ? storyboardFile : undefined,
              autoApply: options.reviewAutoApply,
              model: "flash",
            });

            if (reviewResult.success && reviewResult.feedback) {
              reviewSpinner.succeed(chalk.green(`AI Review: ${reviewResult.feedback.overallScore}/10`));
              if (reviewResult.appliedFixes && reviewResult.appliedFixes.length > 0) {
                for (const fix of reviewResult.appliedFixes) {
                  console.log(chalk.green(`  + ${fix}`));
                }
              }
              if (reviewResult.feedback.recommendations.length > 0) {
                for (const rec of reviewResult.feedback.recommendations) {
                  console.log(chalk.dim(`  * ${rec}`));
                }
              }
            } else {
              reviewSpinner.warn(chalk.yellow("AI review completed but no actionable feedback"));
            }
          } else {
            reviewSpinner.warn(chalk.yellow("No videos available for review"));
          }
        } catch {
          reviewSpinner.warn(chalk.yellow("AI review skipped (non-critical error)"));
        }
        console.log();
      }

      // Final summary
      console.log();
      console.log(chalk.bold.green("Script-to-Video complete!"));
      console.log(chalk.dim("─".repeat(60)));
      console.log();
      console.log(`  📄 Project: ${chalk.cyan(outputPath)}`);
      console.log(`  🎬 Scenes: ${segments.length}`);
      console.log(`  ⏱️  Duration: ${totalDuration}s`);
      console.log(`  📁 Assets: ${effectiveOutputDir}/`);
      if (perSceneTTS.length > 0 || failedNarrations.length > 0) {
        const narrationInfo = `${perSceneTTS.length}/${segments.length}`;
        if (failedNarrations.length > 0) {
          const failedSceneNums = failedNarrations.map((f) => f.sceneNum).join(", ");
          console.log(`  🎙️  Narrations: ${narrationInfo} narration-*.mp3`);
          console.log(chalk.yellow(`     ⚠ Failed: scene ${failedSceneNums}`));
        } else {
          console.log(`  🎙️  Narrations: ${perSceneTTS.length} narration-*.mp3`);
        }
      }
      console.log(`  🖼️  Images: ${successfulImages} scene-*.png`);
      if (!options.imagesOnly) {
        const videoCount = videoPaths.filter((p) => p && p !== "").length;
        console.log(`  🎥 Videos: ${videoCount}/${segments.length} scene-*.mp4`);
        if (failedScenes.length > 0) {
          const uniqueFailedScenes = [...new Set(failedScenes)].sort((a, b) => a - b);
          console.log(chalk.yellow(`     ⚠ Failed: scene ${uniqueFailedScenes.join(", ")} (fallback to image)`));
        }
      }
      console.log();
      console.log(chalk.dim("Next steps:"));
      console.log(chalk.dim(`  vibe project info ${options.output}`));
      console.log(chalk.dim(`  vibe export ${options.output} -o final.mp4`));

      // Show regeneration hint if there were failures
      if (!options.imagesOnly && failedScenes.length > 0) {
        const uniqueFailedScenes = [...new Set(failedScenes)].sort((a, b) => a - b);
        console.log();
        console.log(chalk.dim("💡 To regenerate failed scenes:"));
        for (const sceneNum of uniqueFailedScenes) {
          console.log(chalk.dim(`  vibe ai regenerate-scene ${effectiveOutputDir}/ --scene ${sceneNum} --video-only`));
        }
      }
      console.log();
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
