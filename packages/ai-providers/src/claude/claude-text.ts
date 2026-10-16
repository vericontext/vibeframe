/** `generateText` on the Claude Messages API. */

import { ProviderError } from "../shared/errors.js";
import { providerRequest } from "../shared/http.js";
import { DEFAULT_MAX_OUTPUT_TOKENS, type TextRequest, type TextResult } from "../text/contract.js";
import { resolveCatalogModel } from "../video/models.js";

const PROVIDER = "claude";

export async function claudeGenerateText(
  api: { apiKey?: string; baseUrl: string },
  request: TextRequest,
): Promise<TextResult> {
  if (!api.apiKey) throw new ProviderError({ kind: "auth", provider: PROVIDER, message: "Anthropic API key not configured" });
  const model = resolveCatalogModel(PROVIDER, "llm", request.model).id;
  const maxTokens = request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const response = await providerRequest(PROVIDER, `${api.baseUrl}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": api.apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      // Thinking is on by default on 5.x and counts against max_tokens.
      max_tokens: maxTokens,
      ...(request.system ? { system: request.system } : {}),
      messages: request.messages,
      ...(request.jsonSchema
        ? { output_config: { format: { type: "json_schema", schema: request.jsonSchema } } }
        : {}),
    }),
  }, { timeoutMs: 10 * 60_000 });
  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
    stop_reason?: string;
  };
  if (data.stop_reason === "refusal") {
    throw new ProviderError({ kind: "moderation", provider: PROVIDER, message: `${model} declined the request.` });
  }
  if (data.stop_reason === "max_tokens") {
    throw new ProviderError({
      kind: "invalid-request",
      provider: PROVIDER,
      message: `${model} reply was cut off at the ${maxTokens}-token output cap.`,
    });
  }
  const text = (data.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
  if (!text.trim()) throw new ProviderError({ kind: "provider", provider: PROVIDER, message: `${model} returned no text.` });
  return { text, model };
}
