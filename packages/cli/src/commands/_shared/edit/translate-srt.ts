/**
 * @module _shared/edit/translate-srt
 * @description `executeTranslateSrt` — translate SRT subtitle files via
 * Claude or OpenAI in 30-segment batches. Preserves timestamps; only
 * text content is translated. Split out of `ai-edit.ts` in v0.69 (Plan G
 * Phase 3).
 */

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { formatSRT, parseSRT } from "../../../utils/subtitle.js";
import { translateTexts } from "../translate-texts.js";

export interface TranslateSrtOptions {
  /** Path to the source SRT subtitle file */
  srtPath: string;
  /** Path for the translated SRT output */
  outputPath: string;
  /** Target language name (e.g. "Korean", "Spanish") */
  targetLanguage: string;
  /** LLM provider for translation (default: "claude") */
  provider?: "claude" | "openai";
  /** Source language hint (auto-detected if omitted) */
  sourceLanguage?: string;
  /** Override API key for the chosen provider */
  apiKey?: string;
}

export interface TranslateSrtResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Path to the translated SRT file */
  outputPath?: string;
  /** Number of subtitle segments translated */
  segmentCount?: number;
  /** Detected or specified source language */
  sourceLanguage?: string;
  /** Target language used for translation */
  targetLanguage?: string;
  /** Error message on failure */
  error?: string;
}

/**
 * Translate an SRT subtitle file to a target language using Claude or OpenAI.
 * Segments are batched (~30 at a time) for efficient API usage.
 */
export async function executeTranslateSrt(
  options: TranslateSrtOptions,
): Promise<TranslateSrtResult> {
  const {
    srtPath,
    outputPath,
    targetLanguage,
    provider = "claude",
    sourceLanguage,
    apiKey,
  } = options;

  if (!existsSync(srtPath)) {
    return { success: false, error: `SRT file not found: ${srtPath}` };
  }

  try {
    const srtContent = await readFile(srtPath, "utf-8");
    const segments = parseSRT(srtContent);

    if (segments.length === 0) {
      return { success: false, error: "No subtitle segments found in SRT file" };
    }

    const translated = await translateTexts(
      segments.map((s) => s.text),
      { targetLanguage, sourceLanguage, provider, apiKey },
    );
    if (!translated.success) return { success: false, error: translated.error };
    const translatedSegments = segments.map((s, i) => ({
      startTime: s.startTime,
      endTime: s.endTime,
      text: translated.texts[i],
    }));

    // Format as SRT and write
    const translatedSrt = formatSRT(translatedSegments);
    await writeFile(outputPath, translatedSrt);

    return {
      success: true,
      outputPath,
      segmentCount: translatedSegments.length,
      sourceLanguage: sourceLanguage || "auto",
      targetLanguage,
    };
  } catch (error) {
    return {
      success: false,
      error: `Translation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
