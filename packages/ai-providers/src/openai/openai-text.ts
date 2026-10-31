/** `generateText` on the OpenAI Responses API. */

import { ProviderError } from "../shared/errors.js";
import { providerRequest } from "../shared/http.js";
import { DEFAULT_MAX_OUTPUT_TOKENS, type TextRequest, type TextResult } from "../text/contract.js";
import { resolveCatalogModel } from "../video/models.js";
import { recordTokenUsage } from "../usage/meter.js";

const PROVIDER = "openai";

export async function openaiGenerateText(
  api: { apiKey?: string; baseUrl: string },
  request: TextRequest,
): Promise<TextResult> {
  if (!api.apiKey) throw new ProviderError({ kind: "auth", provider: PROVIDER, message: "OpenAI API key not configured" });
  const model = resolveCatalogModel(PROVIDER, "llm", request.model).id;
  const maxTokens = request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const response = await providerRequest(PROVIDER, `${api.baseUrl}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${api.apiKey}` },
    body: JSON.stringify({
      model,
      ...(request.system ? { instructions: request.system } : {}),
      input: request.messages.map((message) => ({ role: message.role, content: message.content })),
      // Reasoning tokens count against this cap.
      max_output_tokens: maxTokens,
      store: false,
      ...(request.jsonSchema
        ? { text: { format: { type: "json_schema", name: "reply", schema: request.jsonSchema, strict: true } } }
        : {}),
    }),
  }, { timeoutMs: 10 * 60_000 });
  const data = (await response.json()) as {
    status?: string;
    incomplete_details?: { reason?: string };
    output?: Array<{ type: string; content?: Array<{ type: string; text?: string; refusal?: string }> }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  // output_tokens includes reasoning tokens.
  recordTokenUsage(PROVIDER, model, data.usage?.input_tokens, data.usage?.output_tokens);
  const content = (data.output ?? []).filter((item) => item.type === "message").flatMap((item) => item.content ?? []);
  const refusal = content.find((part) => part.type === "refusal");
  if (refusal || data.incomplete_details?.reason === "content_filter") {
    throw new ProviderError({
      kind: "moderation",
      provider: PROVIDER,
      message: `${model} declined the request${refusal?.refusal ? `: ${refusal.refusal}` : "."}`,
    });
  }
  if (data.status === "incomplete") {
    throw new ProviderError({
      kind: "invalid-request",
      provider: PROVIDER,
      message: `${model} reply was cut off (${data.incomplete_details?.reason ?? "incomplete"}) at the ${maxTokens}-token output cap.`,
    });
  }
  const text = content.filter((part) => part.type === "output_text").map((part) => part.text ?? "").join("");
  if (!text.trim()) throw new ProviderError({ kind: "provider", provider: PROVIDER, message: `${model} returned no text.` });
  return { text, model };
}
