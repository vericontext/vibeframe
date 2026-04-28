/**
 * @module ai-edit
 * @description Barrel re-exporting executeXxx functions and types for the
 * `vibe edit *` subcommands. The real implementations live under
 * `commands/_shared/edit/<name>.ts` (split out in v0.69 Plan G Phase 3).
 *
 * This barrel exists for backward compat: 9 consumer files (demo,
 * edit-cmd, ai-edit-cli, ai-review, ai-script-pipeline-cli,
 * ai-animated-caption, ai, ai-script-pipeline, ai.test) already import
 * from `./ai-edit.js` and continue to work unchanged.
 *
 * Adding a new edit operation: create `commands/_shared/edit/<name>.ts`
 * with `executeXxx` + `XxxOptions/Result`, then add a re-export here.
 */

// silence-cut
export { executeSilenceCut } from "./_shared/edit/silence-cut.js";
export type {
  SilencePeriod,
  SilenceCutOptions,
  SilenceCutResult,
} from "./_shared/edit/silence-cut.js";

// jump-cut
export {
  executeJumpCut,
  transcribeWithWords,
  detectFillerRanges,
  DEFAULT_FILLER_WORDS,
} from "./_shared/edit/jump-cut.js";
export type {
  FillerWord,
  JumpCutOptions,
  JumpCutResult,
} from "./_shared/edit/jump-cut.js";

// caption
export { executeCaption } from "./_shared/edit/caption.js";
export type {
  CaptionStyle,
  CaptionOptions,
  CaptionResult,
} from "./_shared/edit/caption.js";

// noise-reduce
export { executeNoiseReduce } from "./_shared/edit/noise-reduce.js";
export type {
  NoiseReduceOptions,
  NoiseReduceResult,
} from "./_shared/edit/noise-reduce.js";

// fade
export { executeFade } from "./_shared/edit/fade.js";
export type { FadeOptions, FadeResult } from "./_shared/edit/fade.js";

// translate-srt
export { executeTranslateSrt } from "./_shared/edit/translate-srt.js";
export type {
  TranslateSrtOptions,
  TranslateSrtResult,
} from "./_shared/edit/translate-srt.js";

// text-overlay
export {
  applyTextOverlays,
  executeTextOverlay,
} from "./_shared/edit/text-overlay.js";
export type {
  TextOverlayStyle,
  TextOverlayOptions,
  TextOverlayResult,
} from "./_shared/edit/text-overlay.js";

// video-review (types only; actual analysis lives in commands/ai-review.ts)
export type {
  AutoFix,
  VideoReviewCategory,
  VideoReviewFeedback,
} from "./_shared/edit/video-review.js";
