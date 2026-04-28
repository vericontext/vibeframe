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

    // Batch translate segments (~30 at a time)
    const batchSize = 30;
    const translatedSegments: { startTime: number; endTime: number; text: string }[] = [];

    for (let i = 0; i < segments.length; i += batchSize) {
      const batch = segments.slice(i, i + batchSize);
      const textsToTranslate = batch.map((s, idx) => `[${idx}] ${s.text}`).join("\n");

      const translatePrompt =
        `Translate the following subtitle texts to ${targetLanguage}.` +
        (sourceLanguage ? ` The source language is ${sourceLanguage}.` : "") +
        ` Return ONLY the translated texts, one per line, preserving the [N] prefix format exactly. ` +
        `Do not add explanations.\n\n${textsToTranslate}`;

      let translatedText: string;

      if (provider === "openai") {
        const openaiKey = apiKey || process.env.OPENAI_API_KEY;
        if (!openaiKey) {
          return {
            success: false,
            error:
              "OpenAI API key required for translation. Run 'vibe setup' or set OPENAI_API_KEY in .env",
          };
        }
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-5-mini",
            messages: [{ role: "user", content: translatePrompt }],
            temperature: 0.3,
          }),
        });
        if (!response.ok) {
          return {
            success: false,
            error: `OpenAI API error: ${response.status} ${response.statusText}`,
          };
        }
        const data = (await response.json()) as {
          choices: Array<{ message: { content: string } }>;
        };
        translatedText = data.choices[0]?.message?.content || "";
      } else {
        const claudeKey = apiKey || process.env.ANTHROPIC_API_KEY;
        if (!claudeKey) {
          return {
            success: false,
            error:
              "Anthropic API key required for translation. Run 'vibe setup' or set ANTHROPIC_API_KEY in .env",
          };
        }
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": claudeKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6-20250514",
            max_tokens: 4096,
            messages: [{ role: "user", content: translatePrompt }],
          }),
        });
        if (!response.ok) {
          return {
            success: false,
            error: `Claude API error: ${response.status} ${response.statusText}`,
          };
        }
        const data = (await response.json()) as {
          content: Array<{ type: string; text: string }>;
        };
        translatedText = data.content?.find((c) => c.type === "text")?.text || "";
      }

      // Parse translated lines
      const translatedLines = translatedText.trim().split("\n");
      for (let j = 0; j < batch.length; j++) {
        const seg = batch[j];
        // Try to match [N] prefix
        const line = translatedLines[j];
        let text: string;
        if (line) {
          text = line.replace(/^\[\d+\]\s*/, "").trim();
        } else {
          // Fallback: use original text if translation is missing
          text = seg.text;
        }
        translatedSegments.push({
          startTime: seg.startTime,
          endTime: seg.endTime,
          text,
        });
      }
    }

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
