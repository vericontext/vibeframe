/**
 * @module manifest/generate
 * @description AI generation tools.
 *   generate_image, generate_video (+ status/cancel/extend lifecycle),
 *   generate_motion, generate_speech, generate_sound_effect, generate_music
 *   (+ generate_music_status), generate_storyboard, generate_thumbnail,
 *   generate_background.
 */

import { resolve } from "node:path";
import { z } from "zod";
import { defineTool, type AnyTool, failedTool } from "../define-tool.js";
import { TTS_PROVIDER_NAMES } from "../../commands/_shared/tts-providers.js";
import { executeMotion } from "../../commands/ai-motion.js";
import {
  executeSpeech,
  executeSoundEffect,
  executeMusic,
} from "../../commands/generate.js";
import { executeImageGenerate, executeThumbnailBestFrame } from "../../commands/ai-image.js";
import {
  executeVideoGenerate,
  executeVideoCancel,
  executeVideoExtend,
} from "../../commands/ai-video.js";
import { createAndWriteJobRecord } from "../../commands/_shared/status-jobs.js";
import { estimateImageCostUsd } from "../../commands/_shared/image-cost.js";
import { upperBoundCost } from "../../commands/_shared/actual-cost.js";
import { lookupCostEstimateUpperBound } from "../../commands/output.js";
import { realRunCost } from "../../commands/generate/video.js";
import { defaultOutputPath } from "../../commands/_shared/default-output.js";

/** Without an `output`, a paid result is saved under the working directory. */
const defaultOutputIn = (cwd: string, name: string, count = 1) => resolve(cwd, defaultOutputPath(name, count, cwd));

// ── generate_motion ─────────────────────────────────────────────────────────

export const generateMotionTool = defineTool({
  name: "generate_motion",
  category: "generate",
  cost: "low",
  title: "Generate Motion Graphics",
  annotations: { readOnly: false, openWorld: true },
  description:
    "Generate standalone motion graphics using Claude or Gemini + Remotion. For overlays on an existing video, prefer edit_motion_overlay. Requires ANTHROPIC_API_KEY (Claude) or GOOGLE_API_KEY (Gemini).",
  schema: z.object({
    description: z.string().describe("Description of the motion graphic to generate"),
    duration: z.number().optional().describe("Duration in seconds (default: 5)"),
    width: z.number().optional().describe("Width in pixels (default: 1920)"),
    height: z.number().optional().describe("Height in pixels (default: 1080)"),
    fps: z.number().optional().describe("Frames per second (default: 30)"),
    style: z.string().optional().describe("Visual style guidance"),
    render: z
      .boolean()
      .optional()
      .describe("Render with Remotion (default: false, returns TSX only)"),
    video: z.string().optional().describe("Base video path to composite motion graphic onto"),
    image: z.string().optional().describe("Reference image for color/mood analysis"),
    understand: z
      .enum(["auto", "off", "required"])
      .optional()
      .describe(
        "Analyze the base video with Gemini before generating motion graphics: auto, off, or required (default: auto)"
      ),
    understandingPrompt: z
      .string()
      .optional()
      .describe("Custom prompt for video understanding when --video is provided"),
    model: z
      .enum(["sonnet", "opus", "gemini", "gemini-2.5-pro", "gemini-3.1-pro"])
      .optional()
      .describe("LLM model for code generation (default: sonnet)"),
    output: z.string().optional().describe("Output path (TSX if code-only, MP4 if rendered)"),
  }),
  async execute(args) {
    const result = await executeMotion(args);
    if (!result.success)
      return failedTool(result, "Motion generation failed");
    const out = result.compositedPath ?? result.renderedPath ?? result.codePath;
    return {
      success: true,
      data: {
        codePath: result.codePath,
        renderedPath: result.renderedPath,
        compositedPath: result.compositedPath,
        componentName: result.componentName,
      },
      humanLines: [`✅ Motion generated → ${out}`],
    };
  },
});

export const generateNarrationTool = defineTool({
  name: "generate_narration",
  category: "generate",
  cost: "low",
  title: "Generate Narration Audio",
  annotations: { readOnly: false, openWorld: true },
  description:
    "Generate narration from text. Providers: elevenlabs (premium cloud voices), gemini (cloud voices on the Google API key), openai (fast cloud voice), kokoro (free, local; first use downloads ~90 MB). Default auto: the first of ElevenLabs, Gemini, OpenAI whose key is set, else Kokoro.",
  schema: z.object({
    text: z.string().describe("Narration text to convert to speech"),
    provider: z.enum(TTS_PROVIDER_NAMES).optional().describe("TTS provider (default: auto)"),
    output: z.string().optional().describe("Output audio file path (default: narration.mp3, or .wav for Gemini and Kokoro)"),
    voice: z.string().optional().describe("Voice: ElevenLabs name or ID, Gemini voice (e.g. Kore), OpenAI voice (e.g. marin), or Kokoro voice (e.g. af_heart)"),
    model: z.string().optional().describe("Model alias for the provider (ElevenLabs: v3, multilingual, flash; Gemini: flash, lite)"),
  }),
  async execute(args, ctx) {
    const result = await executeSpeech({ ...args, cwd: ctx.workingDirectory });
    if (!result.success) return failedTool(result, "Narration failed");
    return {
      success: true,
      data: {
        outputPath: result.outputPath,
        characterCount: result.characterCount,
        provider: result.provider,
        model: result.model,
        ...(result.warnings ? { warnings: result.warnings } : {}),
      },
      humanLines: [`✅ Narration → ${result.outputPath}`],
    };
  },
});

// ── generate_sound_effect ───────────────────────────────────────────────────

export const generateSoundEffectTool = defineTool({
  name: "generate_sound_effect",
  category: "generate",
  cost: "low",
  title: "Generate Sound Effect",
  annotations: { readOnly: false, openWorld: true },
  description: "Generate sound effects using ElevenLabs. Requires ELEVENLABS_API_KEY.",
  schema: z.object({
    prompt: z.string().describe("Description of the sound effect"),
    output: z.string().optional().describe("Output audio file path (default: sound-effect.mp3)"),
    duration: z.number().optional().describe("Duration in seconds (0.5-30, default: auto)"),
    promptInfluence: z.number().optional().describe("Prompt influence 0-1 (default: 0.3)"),
  }),
  async execute(args) {
    const result = await executeSoundEffect(args);
    if (!result.success) return failedTool(result, "SFX failed");
    return {
      success: true,
      data: { outputPath: result.outputPath },
      humanLines: [`✅ SFX → ${result.outputPath}`],
    };
  },
});

// ── generate_music ──────────────────────────────────────────────────────────

export const generateMusicTool = defineTool({
  name: "generate_music",
  category: "generate",
  cost: "low",
  title: "Generate Music",
  annotations: { readOnly: false, openWorld: true },
  description:
    "Generate background music from text prompt. ElevenLabs (default, up to 10min) or Replicate MusicGen (max 30s). Requires ELEVENLABS_API_KEY or REPLICATE_API_TOKEN.",
  schema: z.object({
    prompt: z.string().describe("Description of the music to generate"),
    output: z.string().optional().describe("Output audio file path (default: music.mp3)"),
    duration: z
      .number()
      .optional()
      .describe("Duration in seconds (elevenlabs: 3-600, replicate: 1-30)"),
    provider: z
      .enum(["elevenlabs", "replicate"])
      .optional()
      .describe("Provider (default: elevenlabs)"),
    instrumental: z
      .boolean()
      .optional()
      .describe("Force instrumental, no vocals (ElevenLabs only)"),
    wait: z
      .boolean()
      .optional()
      .describe("Wait for Replicate completion. Set false to return a local job id."),
  }),
  async execute(args, ctx) {
    const result = await executeMusic(args);
    if (!result.success) return failedTool(result, "Music gen failed");
    let job: Awaited<ReturnType<typeof createAndWriteJobRecord>> | undefined;
    if (args.wait === false && result.provider === "replicate" && result.taskId) {
      job = await createAndWriteJobRecord({
        jobType: "generate-music",
        provider: "replicate",
        providerTaskId: result.taskId,
        status: "running",
        workingDirectory: ctx.workingDirectory,
        command: "generate_music wait=false",
        prompt: args.prompt,
      });
    }
    return {
      success: true,
      data: {
        outputPath: result.outputPath,
        provider: result.provider,
        duration: result.duration,
        taskId: result.taskId,
        status: result.status,
        jobId: job?.id,
        statusCommand: job
          ? `vibe status job ${job.id} --project ${job.projectDir} --json`
          : undefined,
      },
      humanLines: [
        `✅ Music${result.provider ? ` (${result.provider})` : ""} → ${result.outputPath ?? job?.id ?? "(async)"}`,
      ],
    };
  },
});

// ── generate_image ──────────────────────────────────────────────────────────

export const generateImageTool = defineTool({
  name: "generate_image",
  category: "generate",
  cost: "low",
  title: "Generate Image",
  annotations: { readOnly: false, openWorld: true },
  description:
    "Generate an image using AI. Supports Gemini (free), OpenAI GPT Image, or Grok Imagine. Requires GOOGLE_API_KEY (Gemini), OPENAI_API_KEY (OpenAI), or XAI_API_KEY (Grok).",
  schema: z.object({
    prompt: z.string().describe("Image description prompt"),
    provider: z
      .enum(["gemini", "openai", "grok"])
      .optional()
      .describe(
        "Image provider (default: openai when OPENAI_API_KEY is configured, otherwise first configured provider)"
      ),
    output: z.string().optional().describe("Output file path (default: image.png, or the next free image-N.png)"),
    size: z.string().optional().describe("Explicit OpenAI size (1024x1024, 1536x1024, 1024x1536); otherwise the ratio picks one"),
    ratio: z
      .string()
      .optional()
      .describe("Aspect ratio for any provider (1:1, 16:9, 9:16, 4:3, 3:4, ...)"),
    quality: z.string().optional().describe("Quality: low, medium, high (OpenAI and Grok)"),
    resolution: z.string().optional().describe("Gemini 1K/2K/4K (512px on 3.1 Flash, Lite 1K only) or Grok 1k/2k"),
    count: z.number().optional().describe("Number of images (default: 1)"),
    model: z.string().optional().describe("Image model. Gemini: flash (default), lite, pro. OpenAI: 2.5 (default), flare, 2, 1.5. Grok: pro"),
  }),
  async execute(args, ctx) {
    const output = args.output ?? defaultOutputIn(ctx.workingDirectory, "image.png", args.count ?? 1);
    const result = await executeImageGenerate({ ...args, output });
    if (!result.success)
      return failedTool(result, "Image generation failed");
    // Image providers are not metered: list price per image, as the CLI reports.
    const cost = estimateImageCostUsd(result.provider ?? args.provider ?? "gemini", args.model, result.images?.length ?? 1, args.resolution, args.size);
    return {
      success: true,
      data: {
        outputPath: result.outputPath,
        provider: result.provider,
        model: result.model,
        imageCount: result.images?.length,
        costUsd: cost.costUsd,
        costEstimated: true,
      },
      humanLines: [`✅ Image (${result.provider}) → ${result.outputPath}`],
    };
  },
});

// ── generate_thumbnail ──────────────────────────────────────────────────────

export const generateThumbnailTool = defineTool({
  name: "generate_thumbnail",
  category: "generate",
  cost: "low",
  title: "Generate Thumbnail",
  annotations: { readOnly: false, openWorld: true },
  description:
    "Extract the best thumbnail frame from a video using Gemini AI analysis. Requires GOOGLE_API_KEY.",
  schema: z.object({
    videoPath: z.string().describe("Path to the video file"),
    outputPath: z.string().describe("Output path for the thumbnail image"),
    prompt: z.string().optional().describe("Custom criteria for best frame selection"),
    model: z.string().optional().describe("Gemini model variant"),
  }),
  async execute(args) {
    const result = await executeThumbnailBestFrame(args);
    if (!result.success) return failedTool(result, "Thumbnail failed");
    return {
      success: true,
      data: { outputPath: result.outputPath, timestamp: result.timestamp, reason: result.reason },
      humanLines: [`✅ Thumbnail (t=${result.timestamp?.toFixed(2)}s) → ${result.outputPath}`],
    };
  },
});

// ── generate_video ──────────────────────────────────────────────────────────

export const generateVideoTool = defineTool({
  name: "generate_video",
  category: "generate",
  cost: "high",
  title: "Generate Video",
  annotations: { readOnly: false, openWorld: true },
  description:
    "Generate video using AI. Supports Seedance 2.0 via fal.ai, Grok, Kling, Runway, and Gemini Omni. Requires FAL_API_KEY, XAI_API_KEY, KLING_API_KEY, RUNWAY_API_SECRET, or GOOGLE_API_KEY.",
  schema: z.object({
    prompt: z.string().describe("Text prompt describing the video"),
    provider: z
      .enum(["seedance", "grok", "kling", "runway", "omni"])
      .optional()
      .describe(
        "Video provider (default: seedance when FAL_API_KEY is configured, otherwise first configured provider). `omni` = Gemini Omni 1.1 Flash, uses GOOGLE_API_KEY."
      ),
    image: z.string().optional().describe("Reference image path for image-to-video"),
    endImage: z.string().optional().describe("Ending frame image path for Seedance image-to-video"),
    refImages: z
      .array(z.string())
      .optional()
      .describe("Reference images for Seedance reference-to-video"),
    refVideos: z
      .array(z.string())
      .optional()
      .describe("Reference videos for Seedance reference-to-video"),
    refAudio: z
      .array(z.string())
      .optional()
      .describe("Reference audio files for Seedance reference-to-video"),
    duration: z
      .number()
      .optional()
      .describe("Duration in seconds (default: 5; Seedance accepts 4-15)"),
    ratio: z.string().optional().describe("Aspect ratio: 16:9, 9:16, 1:1 (default: 16:9)"),
    mode: z.string().optional().describe("Kling mode: std or pro"),
    negative: z.string().optional().describe("Negative prompt (Seedance/Kling)"),
    resolution: z
      .string()
      .optional()
      .describe("Resolution: 480p, 720p, 1080p, or 4k depending on provider"),
    runwayModel: z.string().optional().describe("Runway model: gen4.5, gen4_turbo"),
    seedanceModel: z
      .string()
      .optional()
      .describe("Seedance variant: quality (2.0), fast, or 2.5 (fal.ai only)"),
    grokModel: z.string().optional().describe("Grok video model: 1.5 (default), lite, classic"),
    klingModel: z.string().optional().describe("Kling model: v3 (default), v2.6, v2.5-turbo"),
    generateAudio: z
      .boolean()
      .optional()
      .describe("Generate native synchronized audio when supported"),
    output: z.string().optional().describe("Output file path (default: video.mp4, or the next free video-N.mp4)"),
    wait: z.boolean().optional().describe("Wait for completion (default: true)"),
  }),
  async execute(args, ctx) {
    const output = args.output ?? defaultOutputIn(ctx.workingDirectory, "video.mp4");
    const result = await executeVideoGenerate({ ...args, output });
    if (!result.success) {
      // Keep the job ID: a job that failed or timed out after submission may
      // still have been billed, or may still finish.
      const taskNote = result.taskId ? ` (${result.provider} task ${result.taskId})` : "";
      return failedTool({ ...result, error: `${result.error ?? "Video gen failed"}${taskNote}` }, "Video gen failed");
    }
    let job: Awaited<ReturnType<typeof createAndWriteJobRecord>> | undefined;
    if (args.wait === false && result.taskId && result.status !== "completed") {
      job = await createAndWriteJobRecord({
        jobType: "generate-video",
        provider: result.provider ?? args.provider ?? "unknown",
        providerTaskId: result.taskId,
        providerJob: result.job,
        status: "running",
        workingDirectory: ctx.workingDirectory,
        command: "generate_video wait=false",
        prompt: args.prompt,
        outputPath: output,
      });
    }
    // Video providers are not metered; same estimate as the CLI envelope.
    const cost = realRunCost(result.provider ?? args.provider ?? "seedance", {
      duration: args.duration !== undefined ? String(args.duration) : undefined,
      resolution: args.resolution,
      ratio: args.ratio,
      seedanceModel: args.seedanceModel,
      refVideos: args.refVideos,
    });
    return {
      success: true,
      data: {
        taskId: result.taskId,
        status: result.status,
        videoUrl: result.videoUrl,
        duration: result.duration,
        outputPath: result.outputPath,
        provider: result.provider,
        costUsd: cost.costUsd,
        costEstimated: true,
        jobId: job?.id,
        statusCommand: job
          ? `vibe status job ${job.id} --project ${job.projectDir} --json`
          : undefined,
      },
      humanLines: [
        `✅ Video (${result.provider}, ${result.status})${result.outputPath ? ` → ${result.outputPath}` : job ? ` → ${job.id}` : ""}`,
      ],
    };
  },
});

// ── generate_video_cancel ───────────────────────────────────────────────────

export const generateVideoCancelTool = defineTool({
  name: "generate_video_cancel",
  category: "generate",
  cost: "free",
  title: "Cancel Video Generation",
  annotations: { readOnly: false, openWorld: true },
  description:
    "Cancel a video generation task. Runway, Seedance, and Gemini Omni have cancel APIs; Kling and Grok do not.",
  schema: z.object({
    taskId: z.string().describe("Task ID to cancel"),
    provider: z
      .enum(["runway", "seedance", "omni"])
      .optional()
      .describe("Provider that owns the task (default: runway)"),
  }),
  async execute(args) {
    const result = await executeVideoCancel(args);
    if (!result.success) return failedTool(result, "Cancel failed");
    return {
      success: true,
      data: { taskId: args.taskId },
      humanLines: [`Task ${args.taskId} cancelled.`],
    };
  },
});

// ── generate_video_extend ───────────────────────────────────────────────────

export const generateVideoExtendTool = defineTool({
  name: "generate_video_extend",
  category: "generate",
  cost: "high",
  title: "Extend Generated Video",
  annotations: { readOnly: false, openWorld: true },
  description:
    "Extend a generated video from its last frame. Kling, Grok (classic model), and Gemini Omni can extend; pass the task ID the generation returned.",
  schema: z.object({
    videoId: z.string().describe("Task ID of the video to extend"),
    provider: z
      .enum(["kling", "grok", "omni"])
      .optional()
      .describe("Provider that generated the video (default: kling)"),
    prompt: z.string().optional().describe("Continuation prompt"),
    duration: z.number().optional().describe("Duration in seconds"),
    negative: z.string().optional().describe("Negative prompt (Kling)"),
    output: z.string().optional().describe("Output file path (default: video-extended.mp4, or the next free video-extended-N.mp4)"),
    wait: z.boolean().optional().describe("Wait for completion (default: true)"),
  }),
  async execute(args, ctx) {
    const result = await executeVideoExtend({
      ...args,
      output: args.output ?? defaultOutputIn(ctx.workingDirectory, "video-extended.mp4"),
    });
    if (!result.success) return failedTool(result, "Extend failed");
    const cost = upperBoundCost(lookupCostEstimateUpperBound("generate video-extend"), 1, args.provider ?? "kling");
    return {
      success: true,
      data: {
        costUsd: cost.costUsd,
        costEstimated: cost.estimated,
        taskId: result.taskId,
        status: result.status,
        videoUrl: result.videoUrl,
        duration: result.duration,
        outputPath: result.outputPath,
      },
      humanLines: [
        `✅ Video extended (${result.status})${result.outputPath ? ` → ${result.outputPath}` : ""}`,
      ],
    };
  },
});

export const generateTools: readonly AnyTool[] = [
  generateMotionTool as unknown as AnyTool,
  generateNarrationTool as unknown as AnyTool,
  generateSoundEffectTool as unknown as AnyTool,
  generateMusicTool as unknown as AnyTool,
  generateImageTool as unknown as AnyTool,
  generateThumbnailTool as unknown as AnyTool,
  generateVideoTool as unknown as AnyTool,
  generateVideoCancelTool as unknown as AnyTool,
  generateVideoExtendTool as unknown as AnyTool,
];
