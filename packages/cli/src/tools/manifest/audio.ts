/**
 * @module manifest/audio
 * @description Audio post-processing tools.
 *   audio_transcribe (Whisper), audio_isolate (ElevenLabs vocals isolation),
 *   audio_voice_clone (ElevenLabs IVC), audio_dub (Whisper+Claude+ElevenLabs),
 *   audio_duck (FFmpeg sidechain).
 */

import { z } from "zod";
import { defineTool, type AnyTool } from "../define-tool.js";
import {
  executeTranscribe,
  executeIsolate,
  executeVoiceClone,
  executeDub,
  executeDuck,
} from "../../commands/ai-audio.js";

// ── audio_transcribe ────────────────────────────────────────────────────────

export const audioTranscribeTool = defineTool({
  name: "audio_transcribe",
  category: "audio",
  cost: "low",
  description:
    "Transcribe audio using OpenAI Whisper. Outputs text, SRT, or VTT. Requires OPENAI_API_KEY.",
  schema: z.object({
    audioPath: z.string().describe("Input audio file path"),
    language: z.string().optional().describe("Language code (e.g., en, ko)"),
    output: z.string().optional().describe("Output file path (format auto-detected from extension: .json, .srt, .vtt)"),
    format: z.string().optional().describe("Output format override: json, srt, vtt"),
  }),
  async execute(args) {
    const result = await executeTranscribe(args);
    if (!result.success) return { success: false, error: result.error ?? "Transcription failed" };
    return {
      success: true,
      data: {
        text: result.text?.slice(0, 500),
        segmentCount: result.segments?.length,
        detectedLanguage: result.detectedLanguage,
        outputPath: result.outputPath,
      },
      humanLines: [
        `✅ Transcribed${result.outputPath ? ` → ${result.outputPath}` : ""}`,
        `   ${result.segments?.length ?? 0} segment(s)${result.detectedLanguage ? ` · ${result.detectedLanguage}` : ""}`,
      ],
    };
  },
});

// ── audio_isolate ───────────────────────────────────────────────────────────

export const audioIsolateTool = defineTool({
  name: "audio_isolate",
  category: "audio",
  cost: "low",
  description:
    "Isolate vocals from audio using ElevenLabs. Requires ELEVENLABS_API_KEY.",
  schema: z.object({
    audioPath: z.string().describe("Input audio file path"),
    output: z.string().optional().describe("Output audio file path (default: vocals.mp3)"),
  }),
  async execute(args) {
    const result = await executeIsolate(args);
    if (!result.success) return { success: false, error: result.error ?? "Isolation failed" };
    return {
      success: true,
      data: { outputPath: result.outputPath },
      humanLines: [`✅ Vocals isolated → ${result.outputPath}`],
    };
  },
});

// ── audio_voice_clone ───────────────────────────────────────────────────────

export const audioVoiceCloneTool = defineTool({
  name: "audio_voice_clone",
  category: "audio",
  cost: "low",
  description:
    "Clone a voice from audio samples using ElevenLabs. Requires ELEVENLABS_API_KEY.",
  schema: z.object({
    samplePaths: z
      .array(z.string())
      .describe("Audio sample file paths (1-25 files)"),
    name: z.string().describe("Voice name"),
    description: z.string().optional().describe("Voice description"),
    removeNoise: z.boolean().optional().describe("Remove background noise from samples"),
  }),
  async execute(args) {
    const result = await executeVoiceClone(args);
    if (!result.success) return { success: false, error: result.error ?? "Voice cloning failed" };
    return {
      success: true,
      data: { voiceId: result.voiceId, name: result.name },
      humanLines: [`✅ Voice cloned: ${result.name} (id=${result.voiceId})`],
    };
  },
});

// ── audio_dub ───────────────────────────────────────────────────────────────

export const audioDubTool = defineTool({
  name: "audio_dub",
  category: "audio",
  cost: "high",
  description:
    "Dub audio/video to another language (transcribe + translate + TTS). Requires OPENAI_API_KEY, ANTHROPIC_API_KEY, ELEVENLABS_API_KEY.",
  schema: z.object({
    mediaPath: z.string().describe("Input media file (video or audio)"),
    language: z.string().describe("Target language code (e.g., es, ko, ja)"),
    source: z.string().optional().describe("Source language code (default: auto-detect)"),
    voice: z.string().optional().describe("ElevenLabs voice ID for output"),
    analyzeOnly: z.boolean().optional().describe("Only analyze timing, don't generate audio"),
    output: z.string().optional().describe("Output file path"),
  }),
  async execute(args) {
    const result = await executeDub(args);
    if (!result.success) return { success: false, error: result.error ?? "Dubbing failed" };
    return {
      success: true,
      data: {
        outputPath: result.outputPath,
        sourceLanguage: result.sourceLanguage,
        targetLanguage: result.targetLanguage,
        segmentCount: result.segmentCount,
      },
      humanLines: [
        `✅ Dubbed ${result.sourceLanguage}→${result.targetLanguage} (${result.segmentCount} segments) → ${result.outputPath}`,
      ],
    };
  },
});

// ── audio_duck ──────────────────────────────────────────────────────────────

export const audioDuckTool = defineTool({
  name: "audio_duck",
  category: "audio",
  cost: "free",
  description:
    "Auto-duck background music when voice is present using FFmpeg sidechain compression. Free, no API key needed.",
  schema: z.object({
    musicPath: z.string().describe("Background music file path"),
    voicePath: z.string().describe("Voice/narration track path"),
    output: z.string().optional().describe("Output audio file path"),
    threshold: z.string().optional().describe("Sidechain threshold in dB (default: -30)"),
    ratio: z.string().optional().describe("Compression ratio (default: 3)"),
  }),
  async execute(args) {
    const result = await executeDuck(args);
    if (!result.success) return { success: false, error: result.error ?? "Ducking failed" };
    return {
      success: true,
      data: { outputPath: result.outputPath },
      humanLines: [`✅ Music ducked → ${result.outputPath}`],
    };
  },
});

export const audioTools: readonly AnyTool[] = [
  audioTranscribeTool as unknown as AnyTool,
  audioIsolateTool as unknown as AnyTool,
  audioVoiceCloneTool as unknown as AnyTool,
  audioDubTool as unknown as AnyTool,
  audioDuckTool as unknown as AnyTool,
];
