/**
 * @module ai-script-pipeline
 *
 * Library function for scene regeneration in script-to-video output
 * directories, plus pass-through re-exports of `_shared/video-utils.js` and
 * `_shared/video-providers.js` helpers (consumed by `ai-video.ts` and
 * `generate/video.ts`).
 *
 * Powers the manifest tool `pipeline_regenerate_scene` and the user-facing
 * `vibe pipeline regenerate-scene` CLI subcommand.
 *
 * Note: `executeScriptToVideo` and the `pipeline script-to-video` CLI / MCP
 * surface were removed in favour of the Hyperframes-style skill-driven
 * `vibe scene build` flow, which is idempotent, cheaper, and per-beat
 * editable. The `regenerate-scene` half is preserved because it operates on
 * the on-disk storyboard.{yaml,json} produced by older runs (and by other
 * pipelines that still emit that layout).
 *
 * @dependencies ElevenLabs (TTS), OpenAI/Gemini/Grok (images),
 *               Kling/Runway/Veo/Grok (video), FFmpeg (extension)
 */

import { readFile, writeFile, unlink, rename } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { existsSync } from "node:fs";
import { stringify as yamlStringify, parse as yamlParse } from "yaml";
import {
  GeminiProvider,
  OpenAIImageProvider,
  ElevenLabsProvider,
  KlingProvider,
  RunwayProvider,
  GrokProvider,
} from "@vibeframe/ai-providers";
import { getApiKey } from "../utils/api-key.js";
import { getApiKeyFromConfig } from "../config/index.js";
import { getAudioDuration, getVideoDuration, extendVideoNaturally } from "../utils/audio.js";
import { downloadVideo } from "./ai-helpers.js";

import {
  type StoryboardSegment,
  DEFAULT_VIDEO_RETRIES,
  RETRY_DELAY_MS,
  sleep,
  uploadToImgbb,
  extendVideoToTarget,
  logSceneFailure,
  waitForVideoWithRetry,
} from "./_shared/video-utils.js";
import {
  generateVideoWithRetryGrok,
  generateVideoWithRetryKling,
  generateVideoWithRetryRunway,
  generateVideoWithRetryVeo,
} from "./_shared/video-providers.js";

// Pass-through re-exports so `ai-video.ts` and `generate/video.ts` can keep
// importing `uploadToImgbb` from this module unchanged.
export {
  DEFAULT_VIDEO_RETRIES,
  RETRY_DELAY_MS,
  sleep,
  uploadToImgbb,
  extendVideoToTarget,
  logSceneFailure,
  waitForVideoWithRetry,
  generateVideoWithRetryGrok,
  generateVideoWithRetryKling,
  generateVideoWithRetryRunway,
  generateVideoWithRetryVeo,
};
export type { StoryboardSegment };

/** Options for {@link executeRegenerateScene}. */
export interface RegenerateSceneOptions {
  /** Path to the project output directory containing storyboard.json */
  projectDir: string;
  /** 1-indexed scene numbers to regenerate */
  scenes: number[];
  /** Only regenerate video (keep existing image) */
  videoOnly?: boolean;
  /** Only regenerate narration audio */
  narrationOnly?: boolean;
  /** Only regenerate scene image */
  imageOnly?: boolean;
  /** Video generation provider */
  generator?: "grok" | "kling" | "runway" | "veo";
  /** Image generation provider */
  imageProvider?: "gemini" | "openai" | "grok";
  /** ElevenLabs voice name or ID */
  voice?: string;
  /** Video aspect ratio */
  aspectRatio?: "16:9" | "9:16" | "1:1";
  /** Max retries per video generation call */
  retries?: number;
  /** Reference scene number for character consistency (auto-detects if not specified) */
  referenceScene?: number;
  /** Called at per-scene progress points (`Scene N: regenerating narration...`). */
  onProgress?: (message: string) => void;
}

/** Result from {@link executeRegenerateScene}. */
export interface RegenerateSceneResult {
  /** Whether all requested scenes were regenerated */
  success: boolean;
  /** 1-indexed scene numbers successfully regenerated */
  regeneratedScenes: number[];
  /** 1-indexed scene numbers that failed to regenerate */
  failedScenes: number[];
  /** Error message on failure */
  error?: string;
}

/**
 * Regenerate specific scene(s) in an existing script-to-video project.
 *
 * Reads the storyboard.{yaml,json} from the project directory, then
 * regenerates the requested scenes using the specified video/image provider.
 * Supports image-to-video via ImgBB URL upload for Kling.
 *
 * @param options - Scene regeneration configuration
 * @returns Result with lists of regenerated and failed scene numbers
 */
export async function executeRegenerateScene(
  options: RegenerateSceneOptions
): Promise<RegenerateSceneResult> {
  const result: RegenerateSceneResult = {
    success: false,
    regeneratedScenes: [],
    failedScenes: [],
  };

  try {
    const outputDir = resolve(process.cwd(), options.projectDir);

    if (!existsSync(outputDir)) {
      return { ...result, error: `Project directory not found: ${outputDir}` };
    }

    const yamlPath = resolve(outputDir, "storyboard.yaml");
    const jsonPath = resolve(outputDir, "storyboard.json");
    const storyboardPath = existsSync(yamlPath) ? yamlPath : existsSync(jsonPath) ? jsonPath : null;

    if (!storyboardPath) {
      return { ...result, error: `Storyboard not found in: ${outputDir} (expected storyboard.yaml or storyboard.json)` };
    }

    const storyboardContent = await readFile(storyboardPath, "utf-8");
    const segments: StoryboardSegment[] = storyboardPath.endsWith(".yaml")
      ? (yamlParse(storyboardContent) as { scenes: StoryboardSegment[] }).scenes
      : JSON.parse(storyboardContent);

    for (const sceneNum of options.scenes) {
      if (sceneNum < 1 || sceneNum > segments.length) {
        return { ...result, error: `Scene ${sceneNum} does not exist. Storyboard has ${segments.length} scenes.` };
      }
    }

    const regenerateVideo = options.videoOnly || (!options.narrationOnly && !options.imageOnly);
    const regenerateNarration = options.narrationOnly || (!options.videoOnly && !options.imageOnly);
    const regenerateImage = options.imageOnly || (!options.videoOnly && !options.narrationOnly);

    let videoApiKey: string | undefined;
    if (regenerateVideo) {
      const generatorKeyMap: Record<string, { envVar: string; name: string }> = {
        grok: { envVar: "XAI_API_KEY", name: "xAI (Grok)" },
        kling: { envVar: "KLING_API_KEY", name: "Kling" },
        runway: { envVar: "RUNWAY_API_SECRET", name: "Runway" },
        veo: { envVar: "GOOGLE_API_KEY", name: "Google (Veo)" },
      };
      const generator = options.generator || "grok";
      const genInfo = generatorKeyMap[generator];
      if (!genInfo) {
        return { ...result, error: `Invalid generator: ${generator}. Available: ${Object.keys(generatorKeyMap).join(", ")}` };
      }
      videoApiKey = (await getApiKey(genInfo.envVar, genInfo.name)) ?? undefined;
      if (!videoApiKey) {
        return { ...result, error: `${genInfo.name} API key required. Run 'vibe setup' or set ${genInfo.envVar} in .env` };
      }
    }

    let imageApiKey: string | undefined;
    if (regenerateImage) {
      const imageProvider = options.imageProvider || "openai";
      const imageKeyMap: Record<typeof imageProvider, { envVar: string; name: string }> = {
        openai: { envVar: "OPENAI_API_KEY", name: "OpenAI" },
        gemini: { envVar: "GOOGLE_API_KEY", name: "Google" },
        grok: { envVar: "XAI_API_KEY", name: "xAI" },
      };
      const info = imageKeyMap[imageProvider];
      if (!info) {
        return { ...result, error: `Invalid imageProvider: ${imageProvider}` };
      }
      imageApiKey = (await getApiKey(info.envVar, info.name)) ?? undefined;
      if (!imageApiKey) {
        return { ...result, error: `${info.name} API key required. Run 'vibe setup' or set ${info.envVar} in .env` };
      }
    }

    let elevenlabsApiKey: string | undefined;
    if (regenerateNarration) {
      elevenlabsApiKey = (await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs")) ?? undefined;
      if (!elevenlabsApiKey) {
        return { ...result, error: "ElevenLabs API key required. Run 'vibe setup' or set ELEVENLABS_API_KEY in .env" };
      }
    }

    let storyboardMutated = false;

    for (const sceneNum of options.scenes) {
      const segment = segments[sceneNum - 1];
      const narrationPath = resolve(outputDir, `narration-${sceneNum}.mp3`);
      const imagePath = resolve(outputDir, `scene-${sceneNum}.png`);
      const videoPath = resolve(outputDir, `scene-${sceneNum}.mp4`);

      let sceneFailed = false;

      if (regenerateNarration && elevenlabsApiKey) {
        options.onProgress?.(`Scene ${sceneNum}: regenerating narration...`);
        const elevenlabs = new ElevenLabsProvider();
        await elevenlabs.initialize({ apiKey: elevenlabsApiKey });
        const narrationText = segment.narration || segment.description;

        const ttsResult = await elevenlabs.textToSpeech(narrationText, {
          voiceId: options.voice,
        });
        if (ttsResult.success && ttsResult.audioBuffer) {
          await writeFile(narrationPath, ttsResult.audioBuffer);
          segment.duration = await getAudioDuration(narrationPath);
          storyboardMutated = true;
        } else {
          sceneFailed = true;
        }
      }

      if (!sceneFailed && regenerateImage && imageApiKey) {
        options.onProgress?.(`Scene ${sceneNum}: regenerating image...`);
        const imageProvider = options.imageProvider || "openai";

        const characterDesc = segment.characterDescription || segments[0]?.characterDescription;
        let imagePrompt = segment.visualStyle
          ? `${segment.visuals}. Style: ${segment.visualStyle}`
          : segment.visuals;
        if (characterDesc) {
          imagePrompt = `${imagePrompt}\n\nIMPORTANT - Character appearance must match exactly: ${characterDesc}`;
        }

        let referenceImageBuffer: Buffer | undefined;
        const refSceneNum = options.referenceScene;
        if (refSceneNum && refSceneNum >= 1 && refSceneNum <= segments.length && refSceneNum !== sceneNum) {
          const refImagePath = resolve(outputDir, `scene-${refSceneNum}.png`);
          if (existsSync(refImagePath)) {
            referenceImageBuffer = await readFile(refImagePath);
          }
        } else if (!refSceneNum) {
          for (let i = 1; i <= segments.length; i++) {
            if (i !== sceneNum) {
              const otherImagePath = resolve(outputDir, `scene-${i}.png`);
              if (existsSync(otherImagePath)) {
                referenceImageBuffer = await readFile(otherImagePath);
                break;
              }
            }
          }
        }

        const dalleImageSizes: Record<string, "1536x1024" | "1024x1536" | "1024x1024"> = {
          "16:9": "1536x1024",
          "9:16": "1024x1536",
          "1:1": "1024x1024",
        };
        let imageBuffer: Buffer | undefined;
        let imageUrl: string | undefined;

        if (imageProvider === "openai") {
          const openaiImage = new OpenAIImageProvider();
          await openaiImage.initialize({ apiKey: imageApiKey });
          const imageResult = await openaiImage.generateImage(imagePrompt, {
            size: dalleImageSizes[options.aspectRatio || "16:9"] || "1536x1024",
            quality: "standard",
          });
          if (imageResult.success && imageResult.images?.[0]) {
            const img = imageResult.images[0];
            if (img.base64) imageBuffer = Buffer.from(img.base64, "base64");
            else if (img.url) imageUrl = img.url;
          }
        } else if (imageProvider === "gemini") {
          const gemini = new GeminiProvider();
          await gemini.initialize({ apiKey: imageApiKey });
          if (referenceImageBuffer) {
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
              aspectRatio: (options.aspectRatio || "16:9") as "16:9" | "9:16" | "1:1",
            });
            if (imageResult.success && imageResult.images?.[0]?.base64) {
              imageBuffer = Buffer.from(imageResult.images[0].base64, "base64");
            }
          } else {
            const imageResult = await gemini.generateImage(imagePrompt, {
              aspectRatio: (options.aspectRatio || "16:9") as "16:9" | "9:16" | "1:1",
            });
            if (imageResult.success && imageResult.images?.[0]?.base64) {
              imageBuffer = Buffer.from(imageResult.images[0].base64, "base64");
            }
          }
        } else if (imageProvider === "grok") {
          const grok = new GrokProvider();
          await grok.initialize({ apiKey: imageApiKey });
          const imageResult = await grok.generateImage(imagePrompt, {
            aspectRatio: options.aspectRatio || "16:9",
          });
          if (imageResult.success && imageResult.images?.[0]) {
            const img = imageResult.images[0];
            if (img.base64) imageBuffer = Buffer.from(img.base64, "base64");
            else if (img.url) imageUrl = img.url;
          }
        }

        if (imageBuffer) {
          await writeFile(imagePath, imageBuffer);
        } else if (imageUrl) {
          const response = await fetch(imageUrl);
          const buffer = Buffer.from(await response.arrayBuffer());
          await writeFile(imagePath, buffer);
        } else {
          sceneFailed = true;
        }
      }

      if (sceneFailed) {
        result.failedScenes.push(sceneNum);
        continue;
      }

      if (regenerateVideo && videoApiKey) {
        options.onProgress?.(`Scene ${sceneNum}: regenerating video (${options.generator || "grok"})...`);
        if (!existsSync(imagePath)) {
          result.failedScenes.push(sceneNum);
          continue;
        }

        const imageBuffer = await readFile(imagePath);
        const videoDuration = (segment.duration > 5 ? 10 : 5) as 5 | 10;
        const maxRetries = options.retries ?? DEFAULT_VIDEO_RETRIES;

        if (options.generator === "grok") {
          const grok = new GrokProvider();
          await grok.initialize({ apiKey: videoApiKey });

          const ext = extname(imagePath).toLowerCase().slice(1);
          const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
          const referenceImage = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
          const grokDuration = Math.min(15, Math.max(1, segment.duration));

          const taskResult = await generateVideoWithRetryGrok(
            grok,
            segment,
            {
              duration: grokDuration,
              aspectRatio: (options.aspectRatio || "16:9") as "16:9" | "9:16" | "1:1",
              referenceImage,
            },
            maxRetries
          );

          if (taskResult) {
            try {
              const waitResult = await grok.waitForCompletion(taskResult.requestId, undefined, 300000);
              if (waitResult.status === "completed" && waitResult.videoUrl) {
                const buffer = await downloadVideo(waitResult.videoUrl, videoApiKey);
                await writeFile(videoPath, buffer);

                const targetDuration = segment.duration;
                const actualVideoDuration = await getVideoDuration(videoPath);

                if (actualVideoDuration < targetDuration - 0.1) {
                  const extendedPath = resolve(outputDir, `scene-${sceneNum}-extended.mp4`);
                  await extendVideoNaturally(videoPath, targetDuration, extendedPath);
                  await unlink(videoPath);
                  await rename(extendedPath, videoPath);
                }

                result.regeneratedScenes.push(sceneNum);
              } else {
                logSceneFailure("Grok", `scene ${sceneNum}`, waitResult);
                result.failedScenes.push(sceneNum);
              }
            } catch (err) {
              logSceneFailure("Grok", `scene ${sceneNum}`, err);
              result.failedScenes.push(sceneNum);
            }
          } else {
            result.failedScenes.push(sceneNum);
          }
        } else if (options.generator === "veo") {
          const veo = new GeminiProvider();
          await veo.initialize({ apiKey: videoApiKey });

          const ext = extname(imagePath).toLowerCase().slice(1);
          const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
          const referenceImage = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
          const veoDuration = (segment.duration > 6 ? 8 : segment.duration > 4 ? 6 : 4) as 4 | 6 | 8;

          const taskResult = await generateVideoWithRetryVeo(
            veo,
            segment,
            {
              duration: veoDuration,
              aspectRatio: (options.aspectRatio || "16:9") as "16:9" | "9:16" | "1:1",
              referenceImage,
            },
            maxRetries
          );

          if (taskResult) {
            try {
              const waitResult = await veo.waitForVideoCompletion(taskResult.operationName, undefined, 300000);
              if (waitResult.status === "completed" && waitResult.videoUrl) {
                const buffer = await downloadVideo(waitResult.videoUrl, videoApiKey);
                await writeFile(videoPath, buffer);

                const targetDuration = segment.duration;
                const actualVideoDuration = await getVideoDuration(videoPath);

                if (actualVideoDuration < targetDuration - 0.1) {
                  const extendedPath = resolve(outputDir, `scene-${sceneNum}-extended.mp4`);
                  await extendVideoNaturally(videoPath, targetDuration, extendedPath);
                  await unlink(videoPath);
                  await rename(extendedPath, videoPath);
                }

                result.regeneratedScenes.push(sceneNum);
              } else {
                logSceneFailure("Veo", `scene ${sceneNum}`, waitResult);
                result.failedScenes.push(sceneNum);
              }
            } catch (err) {
              logSceneFailure("Veo", `scene ${sceneNum}`, err);
              result.failedScenes.push(sceneNum);
            }
          } else {
            result.failedScenes.push(sceneNum);
          }
        } else if (options.generator === "kling" || !options.generator) {
          const kling = new KlingProvider();
          await kling.initialize({ apiKey: videoApiKey });

          if (!kling.isConfigured()) {
            result.failedScenes.push(sceneNum);
            continue;
          }

          const imgbbApiKey = await getApiKeyFromConfig("imgbb") || process.env.IMGBB_API_KEY;
          let imageUrl: string | undefined;

          if (imgbbApiKey) {
            const uploadResult = await uploadToImgbb(imageBuffer, imgbbApiKey);
            if (uploadResult.success && uploadResult.url) {
              imageUrl = uploadResult.url;
            }
          }

          const taskResult = await generateVideoWithRetryKling(
            kling,
            segment,
            {
              duration: videoDuration,
              aspectRatio: (options.aspectRatio || "16:9") as "16:9" | "9:16" | "1:1",
              referenceImage: imageUrl,
            },
            maxRetries
          );

          if (taskResult) {
            try {
              const waitResult = await kling.waitForCompletion(taskResult.taskId, taskResult.type, undefined, 600000);
              if (waitResult.status === "completed" && waitResult.videoUrl) {
                const buffer = await downloadVideo(waitResult.videoUrl, videoApiKey);
                await writeFile(videoPath, buffer);

                await extendVideoToTarget(
                  videoPath,
                  segment.duration,
                  outputDir,
                  `Scene ${sceneNum}`,
                  {
                    kling,
                    videoId: waitResult.videoId,
                    onProgress: options.onProgress,
                  }
                );

                result.regeneratedScenes.push(sceneNum);
              } else {
                logSceneFailure("Kling", `scene ${sceneNum}`, waitResult);
                result.failedScenes.push(sceneNum);
              }
            } catch (err) {
              logSceneFailure("Kling", `scene ${sceneNum}`, err);
              result.failedScenes.push(sceneNum);
            }
          } else {
            result.failedScenes.push(sceneNum);
          }
        } else {
          const runway = new RunwayProvider();
          await runway.initialize({ apiKey: videoApiKey });

          const ext = extname(imagePath).toLowerCase().slice(1);
          const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
          const referenceImage = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

          const aspectRatio = options.aspectRatio === "1:1" ? "16:9" : ((options.aspectRatio || "16:9") as "16:9" | "9:16");

          const taskResult = await generateVideoWithRetryRunway(
            runway,
            segment,
            referenceImage,
            { duration: videoDuration, aspectRatio },
            maxRetries
          );

          if (taskResult) {
            try {
              const waitResult = await runway.waitForCompletion(taskResult.taskId, undefined, 300000);
              if (waitResult.status === "completed" && waitResult.videoUrl) {
                const buffer = await downloadVideo(waitResult.videoUrl, videoApiKey);
                await writeFile(videoPath, buffer);

                const targetDuration = segment.duration;
                const actualVideoDuration = await getVideoDuration(videoPath);

                if (actualVideoDuration < targetDuration - 0.1) {
                  const extendedPath = resolve(outputDir, `scene-${sceneNum}-extended.mp4`);
                  await extendVideoNaturally(videoPath, targetDuration, extendedPath);
                  await unlink(videoPath);
                  await rename(extendedPath, videoPath);
                }

                result.regeneratedScenes.push(sceneNum);
              } else {
                logSceneFailure("Runway", `scene ${sceneNum}`, waitResult);
                result.failedScenes.push(sceneNum);
              }
            } catch (err) {
              logSceneFailure("Runway", `scene ${sceneNum}`, err);
              result.failedScenes.push(sceneNum);
            }
          } else {
            result.failedScenes.push(sceneNum);
          }
        }
      } else if (!sceneFailed) {
        result.regeneratedScenes.push(sceneNum);
      }
    }

    if (storyboardMutated) {
      let currentTime = 0;
      for (const segment of segments) {
        segment.startTime = currentTime;
        currentTime += segment.duration;
      }
      const serialized = storyboardPath.endsWith(".yaml")
        ? yamlStringify({ scenes: segments }, { indent: 2 })
        : JSON.stringify(segments, null, 2);
      await writeFile(storyboardPath, serialized, "utf-8");
    }

    result.success = result.failedScenes.length === 0;
    return result;
  } catch (error) {
    return {
      ...result,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
