/**
 * AI Tools - Barrel module for all AI agent tools
 *
 * Delegates to three sub-modules:
 * - ai-generation.ts: Image, video, TTS, SFX, music, storyboard, motion (8 tools)
 * - ai-pipeline.ts: Script-to-video, highlights, auto-shorts, analysis, editing, regeneration (7 tools)
 * - ai-editing.ts: Text overlay, review, silence cut, jump cut, captions, noise reduce, fade, thumbnail, translate (9 tools)
 *
 * Total: 24 AI tools
 */

import type { ToolRegistry } from "./index.js";
import { registerGenerationTools } from "./ai-generation.js";
import { registerPipelineTools } from "./ai-pipeline.js";
import { registerEditingTools } from "./ai-editing.js";

export function registerAITools(registry: ToolRegistry): void {
  registerGenerationTools(registry);
  registerPipelineTools(registry);
  registerEditingTools(registry);
}
