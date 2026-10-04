/**
 * Shared Gemini text-model aliases, read from the model catalog.
 *
 * Provider-backed one-shot analysis, review, storyboard, and composition
 * calls and the agent loop all default to the catalog's Gemini LLM default.
 */

import { defaultModel, listModels } from "../catalog/catalog.js";

export const GEMINI_DEFAULT_TEXT_MODEL = defaultModel("gemini", "llm").id;
export const GEMINI_AGENT_DEFAULT_TEXT_MODEL = GEMINI_DEFAULT_TEXT_MODEL;

/** Alias → model ID for every Gemini text model in the catalog. */
export const GEMINI_TEXT_MODEL_ALIASES: Readonly<Record<string, string>> = Object.fromEntries(
  listModels({ provider: "gemini", kind: "llm" }).flatMap((m) => (m.aliases ?? []).map((a) => [a, m.id]))
);

export type GeminiTextModelAlias = string;
export type GeminiTextModel = string;

export const GEMINI_TEXT_MODEL_HELP =
  "flash/latest (Gemini 3.8 Flash), flash-3.8, flash-3.5, flash-3, flash-2.5, pro (Gemini 3.1 Pro), pro-3.1, pro-2.5, or a full gemini-* model ID";

export function isGeminiTextModelAlias(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(GEMINI_TEXT_MODEL_ALIASES, model);
}

export function resolveGeminiTextModel(model?: string): GeminiTextModel {
  const trimmed = model?.trim();
  if (!trimmed) return GEMINI_DEFAULT_TEXT_MODEL;
  if (isGeminiTextModelAlias(trimmed)) return GEMINI_TEXT_MODEL_ALIASES[trimmed];
  if (trimmed.startsWith("gemini-")) return trimmed;
  return GEMINI_DEFAULT_TEXT_MODEL;
}
