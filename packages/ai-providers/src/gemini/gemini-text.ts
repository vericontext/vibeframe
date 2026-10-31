/**
 * Calls to the Gemini generateContent API that return text: `generateText`
 * (the text contract) and {@link geminiGenerateContent}, which also takes
 * video and image parts. Every failure is a `ProviderError`.
 */

import { ProviderError } from "../shared/errors.js";
import { providerRequest } from "../shared/http.js";
import { DEFAULT_MAX_OUTPUT_TOKENS, type TextRequest, type TextResult } from "../text/contract.js";
import { resolveCatalogModel } from "../video/models.js";
import { recordTokenUsage } from "../usage/meter.js";

const PROVIDER = "gemini";

/** One part of a Gemini `contents` turn: text, inline bytes, or a file URI. */
export type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string }; video_metadata?: Record<string, unknown> }
  | { file_data: { file_uri: string }; video_metadata?: Record<string, unknown> };

export interface GeminiContentRequest {
  /** A resolved Gemini model ID. */
  model: string;
  system?: string;
  contents: Array<{ role: "user" | "model"; parts: GeminiPart[] }>;
  /** Output cap; thinking tokens count against it. */
  maxOutputTokens: number;
  /** Fewer tokens per video frame or image. */
  lowResolution?: boolean;
  jsonSchema?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface GeminiContentResult {
  text: string;
  model: string;
  promptTokens?: number;
  responseTokens?: number;
  totalTokens?: number;
}

/**
 * One generateContent call. Throws a `ProviderError` on HTTP errors, blocked
 * prompts, a reply cut off at the output cap, and empty replies.
 */
export async function geminiGenerateContent(
  api: { apiKey?: string; baseUrl: string },
  request: GeminiContentRequest,
): Promise<GeminiContentResult> {
  if (!api.apiKey) throw new ProviderError({ kind: "auth", provider: PROVIDER, message: "Google API key not configured" });
  const { model, maxOutputTokens } = request;
  // No temperature: it is deprecated on 3.x and values below 1 can loop.
  const response = await providerRequest(PROVIDER, `${api.baseUrl}/models/${model}:generateContent`, {
    method: "POST",
    // The key goes in a header so it never lands in a URL, log, or error message.
    headers: { "Content-Type": "application/json", "x-goog-api-key": api.apiKey },
    body: JSON.stringify({
      ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
      contents: request.contents,
      generationConfig: {
        maxOutputTokens,
        ...(request.lowResolution ? { mediaResolution: "MEDIA_RESOLUTION_LOW" } : {}),
        ...(request.jsonSchema
          ? { responseMimeType: "application/json", responseJsonSchema: request.jsonSchema }
          : {}),
      },
    }),
  }, { timeoutMs: request.timeoutMs ?? 10 * 60_000 });
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
    promptFeedback?: { blockReason?: string };
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
      totalTokenCount?: number;
    };
  };
  const usage = data.usageMetadata;
  // Thinking tokens bill as output but are not part of candidatesTokenCount.
  if (usage) {
    recordTokenUsage(PROVIDER, model, usage.promptTokenCount ?? 0, (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0));
  }
  const candidate = data.candidates?.[0];
  const blockReason = data.promptFeedback?.blockReason;
  if (blockReason || candidate?.finishReason === "SAFETY" || candidate?.finishReason === "PROHIBITED_CONTENT") {
    throw new ProviderError({
      kind: "moderation",
      provider: PROVIDER,
      message: `${model} blocked the request (${blockReason ?? candidate?.finishReason}).`,
    });
  }
  if (candidate?.finishReason === "MAX_TOKENS") {
    throw new ProviderError({
      kind: "invalid-request",
      provider: PROVIDER,
      message: `${model} reply was cut off at the ${maxOutputTokens}-token output cap.`,
    });
  }
  const text = (candidate?.content?.parts ?? []).filter((part) => !part.thought).map((part) => part.text ?? "").join("");
  if (!text.trim()) {
    throw new ProviderError({
      kind: "provider",
      provider: PROVIDER,
      message: `${model} returned no text${candidate?.finishReason ? ` (finishReason: ${candidate.finishReason})` : ""}.`,
    });
  }
  return {
    text,
    model,
    promptTokens: data.usageMetadata?.promptTokenCount,
    responseTokens: data.usageMetadata?.candidatesTokenCount,
    totalTokens: data.usageMetadata?.totalTokenCount,
  };
}

export async function geminiGenerateText(
  api: { apiKey?: string; baseUrl: string },
  request: TextRequest,
): Promise<TextResult> {
  if (!api.apiKey) throw new ProviderError({ kind: "auth", provider: PROVIDER, message: "Google API key not configured" });
  const { text, model } = await geminiGenerateContent(api, {
    model: resolveCatalogModel(PROVIDER, "llm", request.model).id,
    system: request.system,
    contents: request.messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    })),
    maxOutputTokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    jsonSchema: request.jsonSchema,
  });
  return { text, model };
}
