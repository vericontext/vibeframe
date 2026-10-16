/** `generateText` on the Gemini generateContent API. */

import { ProviderError } from "../shared/errors.js";
import { providerRequest } from "../shared/http.js";
import { DEFAULT_MAX_OUTPUT_TOKENS, type TextRequest, type TextResult } from "../text/contract.js";
import { resolveCatalogModel } from "../video/models.js";

const PROVIDER = "gemini";

export async function geminiGenerateText(
  api: { apiKey?: string; baseUrl: string },
  request: TextRequest,
): Promise<TextResult> {
  if (!api.apiKey) throw new ProviderError({ kind: "auth", provider: PROVIDER, message: "Google API key not configured" });
  const model = resolveCatalogModel(PROVIDER, "llm", request.model).id;
  const maxTokens = request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  // No temperature: it is deprecated on 3.x and values below 1 can loop.
  const response = await providerRequest(PROVIDER, `${api.baseUrl}/models/${model}:generateContent`, {
    method: "POST",
    // The key goes in a header so it never lands in a URL, log, or error message.
    headers: { "Content-Type": "application/json", "x-goog-api-key": api.apiKey },
    body: JSON.stringify({
      ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
      contents: request.messages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
      generationConfig: {
        // Thinking tokens count against this cap.
        maxOutputTokens: maxTokens,
        ...(request.jsonSchema
          ? { responseMimeType: "application/json", responseJsonSchema: request.jsonSchema }
          : {}),
      },
    }),
  }, { timeoutMs: 10 * 60_000 });
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
    promptFeedback?: { blockReason?: string };
  };
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
      message: `${model} reply was cut off at the ${maxTokens}-token output cap.`,
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
  return { text, model };
}
