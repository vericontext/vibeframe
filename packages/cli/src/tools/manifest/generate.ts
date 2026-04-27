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
  executeMusicStatus,
  executeStoryboard,
  executeBackground,
} from "../../commands/generate.js";
import {
  executeImageGenerate,
  executeThumbnailBestFrame,
} from "../../commands/ai-image.js";
import {
  executeVideoGenerate,
  executeVideoStatus,
  executeVideoCancel,
  executeVideoExtend,
} from "../../commands/ai-video.js";

// ── generate_motion ─────────────────────────────────────────────────────────

export const generateMotionTool = defineTool({
  name: "generate_motion",
  category: "generate",
  cost: "low",
  description:
    "Generate motion graphics using Claude or Gemini + Remotion. Requires ANTHROPIC_API_KEY (Claude) or GOOGLE_API_KEY (Gemini).",
  schema: z.object({
    description: z.string().describe("Description of the motion graphic to generate"),
    duration: z.number().optional().describe("Duration in seconds (default: 5)"),
    width: z.number().optional().describe("Width in pixels (default: 1920)"),
    height: z.number().optional().describe("Height in pixels (default: 1080)"),
    fps: z.number().optional().describe("Frames per second (default: 30)"),
    style: z.string().optional().describe("Visual style guidance"),
    render: z.boolean().optional().describe("Render with Remotion (default: false, returns TSX only)"),
    video: z.string().optional().describe("Base video path to composite motion graphic onto"),
    image: z.string().optional().describe("Reference image for color/mood analysis"),
    model: z.enum(["sonnet", "opus", "gemini", "gemini-3.1-pro"]).optional().describe("LLM model for code generation (default: sonnet)"),
    output: z.string().optional().describe("Output path (TSX if code-only, MP4 if rendered)"),
  }),
  async execute(args) {
    const result = await executeMotion(args);
    if (!result.success) return { success: false, error: result.error ?? "Motion generation failed" };
    const out = result.compositedPath ?? result.renderedPath ?? result.codePath;
    return {
      success: true,
      data: { codePath: result.codePath, renderedPath: result.renderedPath, compositedPath: result.compositedPath, componentName: result.componentName },
      humanLines: [`✅ Motion generated → ${out}`],
    };
  },
});

// ── generate_speech ─────────────────────────────────────────────────────────

export const generateSpeechTool = defineTool({
  name: "generate_speech",
  category: "generate",
  cost: "low",
  description:
    "Generate speech from text using ElevenLabs TTS. Requires ELEVENLABS_API_KEY.",
  schema: z.object({
    text: z.string().describe("Text to convert to speech"),
    output: z.string().optional().describe("Output audio file path (default: output.mp3)"),
    voice: z.string().optional().describe("Voice ID (default: Rachel)"),
  }),
  async execute(args) {
    const result = await executeSpeech(args);
    if (!result.success) return { success: false, error: result.error ?? "Speech failed" };
    return {
      success: true,
      data: { outputPath: result.outputPath, characterCount: result.characterCount },
      humanLines: [`✅ Speech → ${result.outputPath}`],
    };
  },
});

// ── generate_sound_effect ───────────────────────────────────────────────────

export const generateSoundEffectTool = defineTool({
  name: "generate_sound_effect",
  category: "generate",
  cost: "low",
  description:
    "Generate sound effects using ElevenLabs. Requires ELEVENLABS_API_KEY.",
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
  description:
    "Generate background music from text prompt. ElevenLabs (default, up to 10min) or Replicate MusicGen (max 30s). Requires ELEVENLABS_API_KEY or REPLICATE_API_TOKEN.",
  schema: z.object({
    prompt: z.string().describe("Description of the music to generate"),
    output: z.string().optional().describe("Output audio file path (default: music.mp3)"),
    duration: z.number().optional().describe("Duration in seconds (elevenlabs: 3-600, replicate: 1-30)"),
    provider: z.enum(["elevenlabs", "replicate"]).optional().describe("Provider (default: elevenlabs)"),
    instrumental: z.boolean().optional().describe("Force instrumental, no vocals (ElevenLabs only)"),
  }),
  async execute(args) {
    const result = await executeMusic(args);
    if (!result.success) return { success: false, error: result.error ?? "Music gen failed" };
    return {
      success: true,
      data: { outputPath: result.outputPath, provider: result.provider, duration: result.duration },
      humanLines: [`✅ Music${result.provider ? ` (${result.provider})` : ""} → ${result.outputPath ?? "(async)"}`],
    };
  },
});

// ── generate_music_status ───────────────────────────────────────────────────

export const generateMusicStatusTool = defineTool({
  name: "generate_music_status",
  category: "generate",
  cost: "free",
  description:
    "Check Replicate music generation task status. `generate_music` returns a task id; this tool polls it until the audio URL is ready. Requires REPLICATE_API_TOKEN.",
  schema: z.object({
    taskId: z.string().describe("Task ID returned from generate_music"),
  }),
  async execute(args) {
    const result = await executeMusicStatus(args);
    if (!result.success) return { success: false, error: result.error ?? "Music status failed" };
    return {
      success: true,
      data: { taskId: result.taskId, status: result.status, audioUrl: result.audioUrl, error: result.error },
      humanLines: [`Music task ${result.taskId}: ${result.status}`],
    };
  },
});

// ── generate_image ──────────────────────────────────────────────────────────

export const generateImageTool = defineTool({
  name: "generate_image",
  category: "generate",
  cost: "low",
  description:
    "Generate an image using AI. Supports Gemini (free), OpenAI GPT Image, or Grok Imagine. Requires GOOGLE_API_KEY (Gemini), OPENAI_API_KEY (OpenAI), or XAI_API_KEY (Grok).",
  schema: z.object({
    prompt: z.string().describe("Image description prompt"),
    provider: z.enum(["gemini", "openai", "grok"]).optional().describe("Image provider (default: gemini)"),
    output: z.string().optional().describe("Output file path"),
    size: z.string().optional().describe("Image size for OpenAI (1024x1024, 1536x1024, 1024x1536)"),
    ratio: z.string().optional().describe("Aspect ratio for Gemini (1:1, 16:9, 9:16, 4:3, 3:4, etc.)"),
    quality: z.string().optional().describe("Quality for OpenAI: standard, hd"),
    count: z.number().optional().describe("Number of images (default: 1)"),
    model: z.string().optional().describe("Gemini model: flash, 3.1-flash, latest, pro"),
  }),
  async execute(args) {
    const result = await executeImageGenerate(args);
    if (!result.success) return { success: false, error: result.error ?? "Image generation failed" };
    return {
      success: true,
      data: { outputPath: result.outputPath, provider: result.provider, model: result.model, imageCount: result.images?.length },
      humanLines: [`✅ Image (${result.provider}) → ${result.outputPath}`],
    };
  },
});

// ── generate_storyboard ─────────────────────────────────────────────────────

export const generateStoryboardTool = defineTool({
  name: "generate_storyboard",
  category: "generate",
  cost: "low",
  description:
    "Generate a video storyboard from text content using Claude. Returns scene segments with descriptions, visuals, and narration. Requires ANTHROPIC_API_KEY.",
  schema: z.object({
    content: z.string().describe("Text content to analyze (script, article, etc.)"),
    duration: z.number().optional().describe("Target total duration in seconds"),
    creativity: z.enum(["low", "high"]).optional().describe("Creativity level (default: low — consistent; high — varied)"),
    output: z.string().optional().describe("Output JSON file path"),
  }),
  async execute(args) {
    const result = await executeStoryboard(args);
    if (!result.success) return { success: false, error: result.error ?? "Storyboard failed" };
    return {
      success: true,
      data: { segmentCount: result.segmentCount, outputPath: result.outputPath },
      humanLines: [`✅ Storyboard: ${result.segmentCount} segments${result.outputPath ? ` → ${result.outputPath}` : ""}`],
    };
  },
});

// ── generate_background ─────────────────────────────────────────────────────

export const generateBackgroundTool = defineTool({
  name: "generate_background",
  category: "generate",
  cost: "low",
  description:
    "Generate a cinematic backdrop image (OpenAI gpt-image-2 / DALL·E variant tuned for video backgrounds). Returns the image URL and, when `output` is provided, downloads the PNG to disk. Requires OPENAI_API_KEY.",
  schema: z.object({
    description: z.string().describe("Background description / image prompt."),
    aspect: z.enum(["16:9", "9:16", "1:1"]).optional().describe("Aspect ratio. Default '16:9'."),
    output: z.string().optional().describe("Output PNG path. Relative paths resolve against the surface's cwd."),
  }),
  async execute(args) {
    const result = await executeBackground(args);
    if (!result.success) return { success: false, error: result.error ?? "Background failed" };
    return {
      success: true,
      data: { imageUrl: result.imageUrl, outputPath: result.outputPath, revisedPrompt: result.revisedPrompt },
      humanLines: [`✅ Background → ${result.outputPath ?? result.imageUrl}`],
    };
  },
});

// ── generate_thumbnail ──────────────────────────────────────────────────────

export const generateThumbnailTool = defineTool({
  name: "generate_thumbnail",
  category: "generate",
  cost: "low",
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
  description:
    "Generate video using AI. Supports Grok (default, free with audio), Kling, Runway, and Veo. Requires provider-specific API key.",
  schema: z.object({
    prompt: z.string().describe("Text prompt describing the video"),
    provider: z.enum(["grok", "kling", "runway", "veo"]).optional().describe("Video provider (default: kling)"),
    image: z.string().optional().describe("Reference image path for image-to-video"),
    duration: z.number().optional().describe("Duration in seconds (default: 5)"),
    ratio: z.string().optional().describe("Aspect ratio: 16:9, 9:16, 1:1 (default: 16:9)"),
    mode: z.string().optional().describe("Kling mode: std or pro"),
    negative: z.string().optional().describe("Negative prompt (Kling/Veo)"),
    resolution: z.string().optional().describe("Resolution: 720p, 1080p, 4k (Veo only)"),
    veoModel: z.string().optional().describe("Veo model: 3.0, 3.1, 3.1-fast"),
    runwayModel: z.string().optional().describe("Runway model: gen4.5, gen4_turbo"),
    output: z.string().optional().describe("Output file path (downloads video)"),
    wait: z.boolean().optional().describe("Wait for completion (default: true)"),
  }),
  async execute(args) {
    const result = await executeVideoGenerate(args);
    if (!result.success) return { success: false, error: result.error ?? "Video gen failed" };
    return {
      success: true,
      data: {
        taskId: result.taskId,
        status: result.status,
        videoUrl: result.videoUrl,
        duration: result.duration,
        outputPath: result.outputPath,
        provider: result.provider,
      },
      humanLines: [`✅ Video (${result.provider}, ${result.status})${result.outputPath ? ` → ${result.outputPath}` : ""}`],
    };
  },
});

// ── generate_video_status ───────────────────────────────────────────────────

export const generateVideoStatusTool = defineTool({
  name: "generate_video_status",
  category: "generate",
  cost: "free",
  description: "Check video generation status for Runway or Kling tasks.",
  schema: z.object({
    taskId: z.string().describe("Task ID from video generation"),
    provider: z.enum(["runway", "kling"]).optional().describe("Provider (default: runway)"),
    taskType: z.enum(["text2video", "image2video"]).optional().describe("Kling task type (default: text2video)"),
    wait: z.boolean().optional().describe("Wait for completion"),
    output: z.string().optional().describe("Download video when complete"),
  }),
  async execute(args) {
    const result = await executeVideoStatus(args);
    if (!result.success) return { success: false, error: result.error ?? "Status check failed" };
    return {
      success: true,
      data: { taskId: result.taskId, status: result.status, progress: result.progress, videoUrl: result.videoUrl, outputPath: result.outputPath },
      humanLines: [`Task ${result.taskId}: ${result.status}${result.progress !== undefined ? ` (${result.progress}%)` : ""}`],
    };
  },
});

// ── generate_video_cancel ───────────────────────────────────────────────────

export const generateVideoCancelTool = defineTool({
  name: "generate_video_cancel",
  category: "generate",
  cost: "free",
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
      data: { taskId: result.taskId, status: result.status, videoUrl: result.videoUrl, duration: result.duration, outputPath: result.outputPath },
      humanLines: [`✅ Video extended (${result.status})${result.outputPath ? ` → ${result.outputPath}` : ""}`],
    };
  },
});

export const generateTools: readonly AnyTool[] = [
  generateMotionTool as unknown as AnyTool,
  generateSpeechTool as unknown as AnyTool,
  generateSoundEffectTool as unknown as AnyTool,
  generateMusicTool as unknown as AnyTool,
  generateMusicStatusTool as unknown as AnyTool,
  generateImageTool as unknown as AnyTool,
  generateStoryboardTool as unknown as AnyTool,
  generateBackgroundTool as unknown as AnyTool,
  generateThumbnailTool as unknown as AnyTool,
  generateVideoTool as unknown as AnyTool,
  generateVideoStatusTool as unknown as AnyTool,
  generateVideoCancelTool as unknown as AnyTool,
  generateVideoExtendTool as unknown as AnyTool,
];
