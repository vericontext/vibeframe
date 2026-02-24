/**
 * @module ai
 * @description AI command orchestrator - registers all AI subcommands.
 *
 * This file is a thin wiring layer. Each command group lives in its own module:
 * - ai-audio.ts       — TTS, SFX, music generation
 * - ai-image.ts       — Image generation (OpenAI, Gemini, Stability)
 * - ai-edit.ts        — Post-production editing (silence-cut, caption, etc.)
 * - ai-video.ts       — Video generation (Runway, Kling, Grok)
 * - ai-analyze.ts     — Unified media analysis
 * - ai-review.ts      — AI video review & auto-fix
 * - ai-highlights.ts  — Highlight extraction + auto-shorts
 * - ai-script-pipeline.ts — Script-to-video pipeline
 * - ai-motion.ts      — Remotion motion graphics
 * - ai-suggest-edit.ts — Suggest, edit, storyboard commands
 * - ai-fill-gaps.ts   — Fill timeline gaps with AI video
 * - ai-video-fx.ts    — Video upscale, interpolate, inpaint, track
 * - ai-broll.ts       — B-roll matching
 * - ai-viral.ts       — Viral optimizer
 * - ai-visual-fx.ts   — Grade, speed-ramp, reframe, style-transfer
 * - ai-narrate.ts     — Auto-narration + providers list
 *
 * @see MODELS.md for AI model configuration
 */

import { Command } from "commander";
import { Project } from "../engine/index.js";
import type { EffectType } from "@vibeframe/core/timeline";
import type { TimelineCommand } from "@vibeframe/ai-providers";

// Module registrations
import { registerAudioCommands } from "./ai-audio.js";
import { registerImageCommands } from "./ai-image.js";
import { registerEditCommands } from "./ai-edit.js";
import { registerVideoCommands } from "./ai-video.js";
import { registerAnalyzeCommands } from "./ai-analyze.js";
import { registerReviewCommand } from "./ai-review.js";
import { registerHighlightsCommands } from "./ai-highlights.js";
import { registerScriptPipelineCommands } from "./ai-script-pipeline-cli.js";
import { registerMotionCommand } from "./ai-motion.js";
import { registerSuggestEditCommands } from "./ai-suggest-edit.js";
import { registerFillGapsCommand } from "./ai-fill-gaps.js";
import { registerVideoFxCommands } from "./ai-video-fx.js";
import { registerBrollCommand } from "./ai-broll.js";
import { registerViralCommand } from "./ai-viral.js";
import { registerVisualFxCommands } from "./ai-visual-fx.js";
import { registerNarrateCommands } from "./ai-narrate.js";

// ============================================================================
// Re-exports for backward compatibility (agent tools import from this file)
// ============================================================================

export {
  executeMotion,
  type MotionCommandOptions,
  type MotionCommandResult,
} from "./ai-motion.js";

export {
  executeSilenceCut, executeJumpCut, executeCaption, executeNoiseReduce,
  executeFade, executeTranslateSrt, applyTextOverlays, executeTextOverlay,
  type TextOverlayStyle, type TextOverlayOptions, type TextOverlayResult,
  type CaptionStyle, type CaptionOptions, type CaptionResult,
  type SilencePeriod, type SilenceCutOptions, type SilenceCutResult,
  type FillerWord, type JumpCutOptions, type JumpCutResult,
  type NoiseReduceOptions, type NoiseReduceResult,
  type FadeOptions, type FadeResult,
  type TranslateSrtOptions, type TranslateSrtResult,
  DEFAULT_FILLER_WORDS, detectFillerRanges,
} from "./ai-edit.js";

export {
  executeThumbnailBestFrame,
  type ThumbnailBestFrameOptions,
  type ThumbnailBestFrameResult,
} from "./ai-image.js";

export {
  executeReview,
  type ReviewOptions,
  type ReviewResult,
} from "./ai-review.js";

export {
  executeHighlights,
  executeAutoShorts,
  type HighlightsOptions,
  type HighlightsExtractResult,
  type AutoShortsOptions,
  type AutoShortsResult,
} from "./ai-highlights.js";

export {
  executeGeminiVideo,
  executeAnalyze,
  type GeminiVideoOptions,
  type GeminiVideoResult,
  type AnalyzeOptions,
  type AnalyzeResult,
} from "./ai-analyze.js";

export {
  executeScriptToVideo,
  executeRegenerateScene,
  type ScriptToVideoOptions,
  type ScriptToVideoResult,
  type NarrationEntry,
  type RegenerateSceneOptions,
  type RegenerateSceneResult,
} from "./ai-script-pipeline.js";

export {
  autoNarrate,
  type AutoNarrateOptions,
  type AutoNarrateResult,
} from "./ai-narrate.js";

// ============================================================================
// AI Command — register all subcommands
// ============================================================================

export const aiCommand = new Command("ai")
  .description("AI provider commands");

// Previously extracted modules
registerAudioCommands(aiCommand);
registerImageCommands(aiCommand);
registerEditCommands(aiCommand);
registerVideoCommands(aiCommand);
registerAnalyzeCommands(aiCommand);
registerReviewCommand(aiCommand);
registerHighlightsCommands(aiCommand);
registerScriptPipelineCommands(aiCommand);
registerMotionCommand(aiCommand);

// Newly extracted modules
registerSuggestEditCommands(aiCommand);
registerFillGapsCommand(aiCommand);
registerVideoFxCommands(aiCommand);
registerBrollCommand(aiCommand);
registerViralCommand(aiCommand);
registerVisualFxCommands(aiCommand);
registerNarrateCommands(aiCommand);

// ============================================================================
// executeCommand — applies parsed timeline commands to a project
// ============================================================================

export function executeCommand(project: Project, cmd: TimelineCommand): boolean {
  const { action, clipIds, params } = cmd;

  try {
    switch (action) {
      case "trim":
        for (const clipId of clipIds) {
          if (params.newDuration) {
            project.trimClipEnd(clipId, params.newDuration as number);
          }
          if (params.startTrim) {
            project.trimClipStart(clipId, params.startTrim as number);
          }
        }
        return true;

      case "remove-clip":
        for (const clipId of clipIds) {
          project.removeClip(clipId);
        }
        return true;

      case "split":
        if (clipIds.length > 0 && params.splitTime) {
          project.splitClip(clipIds[0], params.splitTime as number);
        }
        return true;

      case "duplicate":
        for (const clipId of clipIds) {
          project.duplicateClip(clipId, params.newStartTime as number | undefined);
        }
        return true;

      case "move":
        for (const clipId of clipIds) {
          const clip = project.getClips().find((c) => c.id === clipId);
          if (clip) {
            const newTrackId = (params.newTrackId as string) || clip.trackId;
            const newStartTime = (params.newStartTime as number) ?? clip.startTime;
            project.moveClip(clipId, newTrackId, newStartTime);
          }
        }
        return true;

      case "add-effect":
        for (const clipId of clipIds) {
          const effectType = ((params.effectType as string) || "fadeIn") as EffectType;
          project.addEffect(clipId, {
            type: effectType,
            startTime: (params.startTime as number) || 0,
            duration: (params.duration as number) || 1,
            params: {},
          });
        }
        return true;

      case "remove-effect":
        console.warn("remove-effect is not yet supported. Use the timeline UI to remove effects.");
        return false;

      case "set-volume":
        console.warn("set-volume is not yet supported. Audio ducking via 'vibe ai duck' can adjust levels.");
        return false;

      case "add-track": {
        const trackType = (params.trackType as "video" | "audio") || "video";
        const tracks = project.getTracks();
        project.addTrack({
          type: trackType,
          name: `${trackType}-track-${tracks.length + 1}`,
          order: tracks.length,
          isMuted: false,
          isLocked: false,
          isVisible: true,
        });
        return true;
      }

      case "speed-change":
        for (const clipId of clipIds) {
          const clip = project.getClips().find((c) => c.id === clipId);
          if (clip) {
            const speed = (params.speed as number) || 1.0;
            project.addEffect(clipId, {
              type: "speed" as EffectType,
              startTime: 0,
              duration: clip.duration,
              params: { speed },
            });
          }
        }
        return true;

      case "reverse":
        for (const clipId of clipIds) {
          const clip = project.getClips().find((c) => c.id === clipId);
          if (clip) {
            project.addEffect(clipId, {
              type: "reverse" as EffectType,
              startTime: 0,
              duration: clip.duration,
              params: {},
            });
          }
        }
        return true;

      case "crop":
        for (const clipId of clipIds) {
          const clip = project.getClips().find((c) => c.id === clipId);
          if (clip) {
            project.addEffect(clipId, {
              type: "crop" as EffectType,
              startTime: 0,
              duration: clip.duration,
              params: {
                aspectRatio: params.aspectRatio as string,
                x: params.x as number,
                y: params.y as number,
                width: params.width as number,
                height: params.height as number,
              },
            });
          }
        }
        return true;

      case "position":
        for (const clipId of clipIds) {
          const clip = project.getClips().find((c) => c.id === clipId);
          if (clip) {
            const position = params.position as string;
            const allClips = project.getClips().filter((c) => c.trackId === clip.trackId);
            let newStartTime = 0;

            if (position === "end") {
              const maxEnd = Math.max(...allClips.filter((c) => c.id !== clipId).map((c) => c.startTime + c.duration));
              newStartTime = maxEnd;
            } else if (position === "middle") {
              const totalDuration = allClips.reduce((sum, c) => sum + c.duration, 0);
              newStartTime = (totalDuration - clip.duration) / 2;
            }
            // "beginning" stays at 0

            project.moveClip(clipId, clip.trackId, newStartTime);
          }
        }
        return true;

      default:
        console.warn(`Unknown action: ${action}`);
        return false;
    }
  } catch (error) {
    console.error(`Error executing ${action}:`, error);
    return false;
  }
}
