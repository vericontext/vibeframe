/**
 * Translate a list of short texts (subtitle cues, dub segments) with Claude
 * or OpenAI, in batches, keeping each text's position. Lines come back
 * tagged `[N]` and are matched by that index, so a skipped or merged line
 * cannot shift every later translation; anything missing keeps its source
 * text.
 */

import { defaultModel, isProviderError, providerRequest, type ProviderErrorKind } from "@vibeframe/ai-providers";
import { getConfiguredApiKey } from "../../utils/api-key.js";

export interface TranslateTextsOptions {
  /** Target language name or code ("Korean", "ko"). */
  targetLanguage: string;
  sourceLanguage?: string;
  /** Default: Claude when ANTHROPIC_API_KEY is set, else OpenAI. */
  provider?: "claude" | "openai";
  apiKey?: string;
  /** Texts per request. Default 30. */
  batchSize?: number;
}

export type TranslateTextsResult =
  | { success: true; texts: string[]; provider: "claude" | "openai" }
  | { success: false; error: string; errorKind?: ProviderErrorKind };

const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese",
  ja: "Japanese", ko: "Korean", zh: "Chinese", ar: "Arabic", ru: "Russian", hi: "Hindi",
};

/** "ko" → "Korean"; names pass through. */
export function languageName(code: string): string {
  return LANGUAGE_NAMES[code.toLowerCase()] ?? code;
}

export async function translateTexts(texts: string[], options: TranslateTextsOptions): Promise<TranslateTextsResult> {
  const claudeKey = options.provider !== "openai" ? await getConfiguredApiKey("ANTHROPIC_API_KEY", options.provider === "claude" ? options.apiKey : undefined) : undefined;
  const provider = options.provider ?? (claudeKey ? "claude" : "openai");
  const key = provider === "claude" ? claudeKey : await getConfiguredApiKey("OPENAI_API_KEY", options.apiKey);
  if (!key) {
    const envVar = provider === "claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
    return { success: false, error: `${envVar} required for translation. Run 'vibe setup' or set it in .env`, errorKind: "auth" };
  }

  const target = languageName(options.targetLanguage);
  const batchSize = options.batchSize ?? 30;
  const out = [...texts];
  try {
    for (let start = 0; start < texts.length; start += batchSize) {
      const batch = texts.slice(start, start + batchSize);
      const prompt =
        `Translate each line below to ${target}.` +
        (options.sourceLanguage ? ` The source language is ${languageName(options.sourceLanguage)}.` : "") +
        " Return exactly one line per input, keeping its [N] prefix, and nothing else.\n\n" +
        batch.map((text, i) => `[${i}] ${text.replace(/\s+/g, " ").trim()}`).join("\n");
      const reply = provider === "claude" ? await askClaude(key, prompt) : await askOpenAI(key, prompt);
      for (const line of reply.split("\n")) {
        const m = line.match(/^\s*\[(\d+)\]\s*(.*)$/);
        const index = m ? Number(m[1]) : -1;
        if (m && index >= 0 && index < batch.length && m[2].trim()) out[start + index] = m[2].trim();
      }
    }
    return { success: true, texts: out, provider };
  } catch (error) {
    return {
      success: false,
      error: `Translation failed: ${error instanceof Error ? error.message : String(error)}`,
      errorKind: isProviderError(error) ? error.kind : undefined,
    };
  }
}

async function askClaude(apiKey: string, prompt: string): Promise<string> {
  const response = await providerRequest("claude", "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: defaultModel("claude", "llm").id, max_tokens: 16000, messages: [{ role: "user", content: prompt }] }),
  });
  const data = (await response.json()) as { content?: Array<{ type: string; text: string }> };
  return data.content?.find((c) => c.type === "text")?.text ?? "";
}

async function askOpenAI(apiKey: string, prompt: string): Promise<string> {
  const response = await providerRequest("openai", "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: defaultModel("openai", "llm").id, messages: [{ role: "user", content: prompt }] }),
  });
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}
