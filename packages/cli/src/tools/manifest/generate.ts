/**
 * @module manifest/generate
 * @description AI generation tools.
 *   generate_image, generate_video (+ status/cancel/extend lifecycle),
 *   generate_motion, generate_speech, generate_sound_effect, generate_music
 *   (+ generate_music_status), generate_storyboard, generate_thumbnail,
 *   generate_background.
 */

import { z } from "zod";
import { defineTool, type AnyTool } from "../define-tool.js";
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
      return { success: false, error: result.error ?? "Motion generation failed" };
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
    "Generate narration from text using ElevenLabs TTS. Product-facing alias for generate_speech. Requires ELEVENLABS_API_KEY.",
  schema: z.object({
    text: z.string().describe("Narration text to convert to speech"),
    output: z.string().optional().describe("Output audio file path (default: narration.mp3)"),
    voice: z.string().optional().describe("Voice ID (default: Rachel)"),
  }),
  async execute(args) {
    const result = await executeSpeech({
      text: args.text,
      output: args.output ?? "narration.mp3",
      voice: args.voice,
    });
    if (!result.success) return { success: false, error: result.error ?? "Narration failed" };
    return {
      success: true,
      data: { outputPath: result.outputPath, characterCount: result.characterCount },
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
    duration: z.number().optional().describe("Duration in seconds (0.5-22, default: auto)"),
    promptInfluence: z.number().optional().describe("Prompt influence 0-1 (default: 0.3)"),
  }),
  async execute(args) {
    const result = await executeSoundEffect(args);
    if (!result.success) return { success: false, error: result.error ?? "SFX failed" };
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
    if (!result.success) return { success: false, error: result.error ?? "Music gen failed" };
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
    output: z.string().optional().describe("Output file path"),
    size: z.string().optional().describe("Image size for OpenAI (1024x1024, 1536x1024, 1024x1536)"),
    ratio: z
      .string()
      .optional()
      .describe("Aspect ratio for Gemini (1:1, 16:9, 9:16, 4:3, 3:4, etc.)"),
    quality: z.string().optional().describe("Quality for OpenAI: standard, hd"),
    count: z.number().optional().describe("Number of images (default: 1)"),
    model: z.string().optional().describe("Gemini model: flash, 3.1-flash, latest, pro"),
  }),
  async execute(args) {
    const result = await executeImageGenerate(args);
    if (!result.success)
      return { success: false, error: result.error ?? "Image generation failed" };
    return {
      success: true,
      data: {
        outputPath: result.outputPath,
        provider: result.provider,
        model: result.model,
        imageCount: result.images?.length,
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
    if (!result.success) return { success: false, error: result.error ?? "Thumbnail failed" };
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
    "Generate video using AI. Supports Seedance 2.0 via fal.ai, Grok, Kling, Runway, and Veo. Requires FAL_API_KEY, XAI_API_KEY, KLING_API_KEY, RUNWAY_API_SECRET, or GOOGLE_API_KEY.",
  schema: z.object({
    prompt: z.string().describe("Text prompt describing the video"),
    provider: z
      .enum(["seedance", "grok", "kling", "runway", "veo", "omni"])
      .optional()
      .describe(
        "Video provider (default: seedance when FAL_API_KEY is configured, otherwise first configured provider). `omni` = Gemini Omni, experimental/opt-in, uses GOOGLE_API_KEY."
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
    negative: z.string().optional().describe("Negative prompt (Seedance/Kling/Veo)"),
    resolution: z
      .string()
      .optional()
      .describe("Resolution: 480p, 720p, 1080p, or 4k depending on provider"),
    veoModel: z.string().optional().describe("Veo model: 3.0, 3.1, 3.1-fast"),
    runwayModel: z.string().optional().describe("Runway model: gen4.5, gen4_turbo"),
    seedanceModel: z
      .string()
      .optional()
      .describe("Seedance variant: quality or fast (fal.ai only)"),
    generateAudio: z
      .boolean()
      .optional()
      .describe("Generate native synchronized audio when supported"),
    output: z.string().optional().describe("Output file path (downloads video)"),
    wait: z.boolean().optional().describe("Wait for completion (default: true)"),
  }),
  async execute(args, ctx) {
    const result = await executeVideoGenerate(args);
    if (!result.success) return { success: false, error: result.error ?? "Video gen failed" };
    let job: Awaited<ReturnType<typeof createAndWriteJobRecord>> | undefined;
    if (args.wait === false && result.taskId && result.status !== "completed") {
      job = await createAndWriteJobRecord({
        jobType: "generate-video",
        provider: result.provider ?? args.provider ?? "unknown",
        providerTaskId: result.taskId,
        providerTaskType:
          result.provider === "kling" && args.image
            ? "image2video"
            : result.provider === "kling"
              ? "text2video"
              : undefined,
        status: "running",
        workingDirectory: ctx.workingDirectory,
        command: "generate_video wait=false",
        prompt: args.prompt,
      });
    }
    return {
      success: true,
      data: {
        taskId: result.taskId,
        status: result.status,
        videoUrl: result.videoUrl,
        duration: result.duration,
        outputPath: result.outputPath,
        provider: result.provider,
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
  description: "Cancel a Runway video generation task.",
  schema: z.object({
    taskId: z.string().describe("Task ID to cancel"),
  }),
  async execute(args) {
    const result = await executeVideoCancel(args);
    if (!result.success) return { success: false, error: result.error ?? "Cancel failed" };
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
    "Extend video duration using Kling or Veo. Requires the video/operation ID from a previous generation.",
  schema: z.object({
    videoId: z.string().describe("Video ID (Kling) or operation name (Veo)"),
    provider: z.enum(["kling", "veo"]).optional().describe("Provider (default: kling)"),
    prompt: z.string().optional().describe("Continuation prompt"),
    duration: z.number().optional().describe("Duration in seconds"),
    negative: z.string().optional().describe("Negative prompt (Kling)"),
    veoModel: z.string().optional().describe("Veo model: 3.0, 3.1, 3.1-fast"),
    output: z.string().optional().describe("Output file path"),
    wait: z.boolean().optional().describe("Wait for completion (default: true)"),
  }),
  async execute(args) {
    const result = await executeVideoExtend(args);
    if (!result.success) return { success: false, error: result.error ?? "Extend failed" };
    return {
      success: true,
      data: {
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
