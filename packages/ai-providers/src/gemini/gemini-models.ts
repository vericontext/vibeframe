/**
 * Shared Gemini text-model aliases.
 *
 * Keep long-running agent loops on their explicit default in the CLI adapter.
 * Provider-backed one-shot analysis, review, storyboard, and composition calls
 * use the default here.
 */

export const GEMINI_DEFAULT_TEXT_MODEL = "gemini-3.5-flash";
export const GEMINI_AGENT_DEFAULT_TEXT_MODEL = "gemini-2.5-flash";

export const GEMINI_TEXT_MODEL_ALIASES = {
  flash: GEMINI_DEFAULT_TEXT_MODEL,
  latest: GEMINI_DEFAULT_TEXT_MODEL,
  "flash-3.5": GEMINI_DEFAULT_TEXT_MODEL,
  "flash-3": "gemini-3-flash-preview",
  "flash-2.5": "gemini-2.5-flash",
  pro: "gemini-2.5-pro",
  "pro-3.1": "gemini-3.1-pro-preview",
} as const;

export type GeminiTextModelAlias = keyof typeof GEMINI_TEXT_MODEL_ALIASES;
export type GeminiTextModel = string;

export const GEMINI_TEXT_MODEL_HELP =
  "flash/latest (Gemini 3.5 Flash), flash-3.5, flash-3, flash-2.5, pro, pro-3.1, or a full gemini-* model ID";

export function isGeminiTextModelAlias(model: string): model is GeminiTextModelAlias {
  return Object.prototype.hasOwnProperty.call(GEMINI_TEXT_MODEL_ALIASES, model);
}

export function resolveGeminiTextModel(model?: string): GeminiTextModel {
  const trimmed = model?.trim();
  if (!trimmed) return GEMINI_DEFAULT_TEXT_MODEL;
  if (isGeminiTextModelAlias(trimmed)) return GEMINI_TEXT_MODEL_ALIASES[trimmed];
  if (trimmed.startsWith("gemini-")) return trimmed;
  return GEMINI_DEFAULT_TEXT_MODEL;
}
