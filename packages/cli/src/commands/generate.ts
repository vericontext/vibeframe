/**
 * @module generate
 *
 * Top-level `vibe generate` command group for AI asset generation.
 *
 * Commands:
 *   generate image          - Generate image (Gemini, OpenAI, Grok, Runway)
 *   generate video          - Generate video (Seedance, Grok, Kling, Runway, Veo)
 *   generate sound-effect   - Sound effects (ElevenLabs)
 *   generate music          - Music generation (ElevenLabs default, Replicate MusicGen)
 *   generate motion         - Standalone motion assets (Claude/Gemini + Remotion)
 *   generate thumbnail      - Thumbnail generation/extraction
 *   generate video-cancel   - Cancel video generation (Grok/Runway)
 *   generate video-extend   - Extend video (Kling/Veo)
 *
 * @dependencies OpenAI, Gemini, Runway, Kling, ElevenLabs, Replicate, Claude, FFmpeg
 */

import { Command } from "commander";
import { registerMotionCommand } from "./ai-motion.js";
import { registerSoundEffectCommand } from "./generate/sound-effect.js";
import { registerVideoCancelCommand } from "./generate/video-cancel.js";
import { registerNarrationCommand } from "./generate/speech.js";
import { registerMusicCommand } from "./generate/music.js";
import { registerThumbnailCommand } from "./generate/thumbnail.js";
import { registerVideoExtendCommand } from "./generate/video-extend.js";
import { registerImageCommand } from "./generate/image.js";
import { registerVideoCommand } from "./generate/video.js";
import { applyTier, type CostTier } from "./_shared/cost-tier.js";

/**
 * Apply a cost tier to the most recently registered subcommand on `parent`.
 * Used after each `register*Command(parent)` call so the tier annotation
 * lives next to the registration order — single source of truth for what
 * each command costs to run.
 */
function tierLast(parent: Command, tier: CostTier): void {
  const newest = parent.commands[parent.commands.length - 1];
  if (newest) applyTier(newest, tier);
}
// Re-export for backward compat (pipeline/executor.ts and other consumers
// import these from `./generate.js`).
export { executeSoundEffect } from "./generate/sound-effect.js";
export type {
  ExecuteSoundEffectOptions,
  ExecuteSoundEffectResult,
} from "./generate/sound-effect.js";
export { executeMusicStatus } from "./generate/music-status.js";
export type {
  ExecuteMusicStatusOptions,
  ExecuteMusicStatusResult,
} from "./generate/music-status.js";
export { executeStoryboard } from "./generate/storyboard.js";
export type { ExecuteStoryboardOptions, ExecuteStoryboardResult } from "./generate/storyboard.js";
export { executeSpeech } from "./generate/speech.js";
export type { ExecuteSpeechOptions, ExecuteSpeechResult } from "./generate/speech.js";
export { executeMusic } from "./generate/music.js";
export type { ExecuteMusicOptions, ExecuteMusicResult } from "./generate/music.js";

// ── Command group ────────────────────────────────────────────────────────────

export const generateCommand = new Command("generate")
  .alias("gen")
  .description("Generate standalone assets (image, video, narration, music, SFX)")
  .addHelpText(
    "after",
    `
Examples:
  $ vibe generate image "a sunset over the ocean" -o sunset.png
  $ vibe generate image "logo design" -o logo.png -p openai
  $ vibe generate video "dancing cat" -o cat.mp4                  # Seedance when FAL_API_KEY is set
  $ vibe generate video "city timelapse" -o city.mp4 -p seedance  # Seedance via fal.ai
  $ vibe generate video "city timelapse" -o city.mp4 -p kling     # Kling
  $ vibe generate video "epic scene" -i frame.png -o out.mp4 -p runway  # Image-to-video
  $ vibe generate narration "Hello world" -o narration.mp3
  $ vibe generate music "upbeat jazz" -o jazz.mp3 -d 30
  $ vibe generate motion "animated product logo reveal" --render -o logo-reveal.mp4

Advanced:
  generate motion       Advanced standalone motion; project scenes use 'vibe build --stage compose'
  generate video-cancel Provider lifecycle control; poll with 'vibe status job <job-id> --json'

API Keys (per provider):
  GOOGLE_API_KEY     Image (default), Veo video
  OPENAI_API_KEY     Image (-p openai)
  FAL_API_KEY        Seedance video (-p seedance, default video)
  XAI_API_KEY        Grok image/video
  KLING_API_KEY      Kling video (-p kling)
  RUNWAY_API_SECRET  Runway video (-p runway)
  ELEVENLABS_API_KEY Narration, sound effects, music
  ANTHROPIC_API_KEY  Storyboard, motion graphics

Run 'vibe setup --show' to check API key status.
Run 'vibe schema --list --surface public' for the first-run asset surface.
Run 'vibe schema generate.<command>' for structured parameter info.
`
  );

// ============================================================================
// 1. Image → moved to commands/generate/image.ts (v0.69 Phase 2)
// ============================================================================

registerImageCommand(generateCommand);
tierLast(generateCommand, "high");

// ============================================================================
// 2. Video → moved to commands/generate/video.ts (v0.69 Phase 2)
// ============================================================================

registerVideoCommand(generateCommand);
tierLast(generateCommand, "very-high");

// ============================================================================
// 3. Narration → commands/generate/speech.ts (v0.69 Phase 2)
// ============================================================================

registerNarrationCommand(generateCommand);
tierLast(generateCommand, "low");

// ============================================================================
// 4. Sound Effect → moved to commands/generate/sound-effect.ts (v0.69 Phase 2)
// ============================================================================

registerSoundEffectCommand(generateCommand);
tierLast(generateCommand, "low");

// ============================================================================
// 5. Music → moved to commands/generate/music.ts (v0.69 Phase 2)
// ============================================================================

registerMusicCommand(generateCommand);
tierLast(generateCommand, "low");

// ============================================================================
// 8. Motion (delegated to registerMotionCommand)
// ============================================================================

registerMotionCommand(generateCommand);
tierLast(generateCommand, "high");

// ============================================================================
// 9. Thumbnail → moved to commands/generate/thumbnail.ts (v0.69 Phase 2)
// ============================================================================

registerThumbnailCommand(generateCommand);
tierLast(generateCommand, "free");

// ============================================================================
// 12. Video Cancel → moved to commands/generate/video-cancel.ts (v0.69 Phase 2)
// ============================================================================

registerVideoCancelCommand(generateCommand);
tierLast(generateCommand, "free");

// ============================================================================
// 13. Video Extend → moved to commands/generate/video-extend.ts (v0.69 Phase 2)
// ============================================================================

registerVideoExtendCommand(generateCommand);
tierLast(generateCommand, "very-high");
