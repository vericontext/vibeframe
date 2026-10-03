/**
 * Shared Claude API request helpers and types for split helper modules.
 */

/** Floor for max_tokens; see callClaude. It is a cap, so unused room costs nothing. */
export const CLAUDE_MIN_MAX_TOKENS = 16000;

/** Parameters needed to make a Claude Messages API call */
export interface ClaudeApiParams {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** Standard Claude Messages API response shape */
export interface ClaudeApiResponse {
  content: Array<{ type: string; text?: string }>;
}

/**
 * Send a request to the Claude Messages API and return the raw text response.
 * Throws on HTTP errors or missing content.
 */
export async function callClaude(
  params: ClaudeApiParams,
  opts: {
    system: string;
    messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>;
    maxTokens: number;
    /**
     * JSON Schema the reply must match (structured outputs). Use it whenever
     * the reply carries code or other text that is hard to escape by hand.
     */
    jsonSchema?: Record<string, unknown>;
  }
): Promise<string> {
  const response = await fetch(`${params.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: params.model,
      // Claude 5.x thinks by default and thinking tokens count against
      // max_tokens, so a small cap can end before any text is written.
      max_tokens: Math.max(opts.maxTokens, CLAUDE_MIN_MAX_TOKENS),
      messages: opts.messages,
      system: opts.system,
      ...(opts.jsonSchema
        ? { output_config: { format: { type: "json_schema", schema: opts.jsonSchema } } }
        : {}),
    }),
  });

  if (!response.ok) {
    const error = await response.text().catch(() => "");
    throw new Error(`Claude API error ${response.status}: ${error}`);
  }

  const data = (await response.json()) as ClaudeApiResponse;
  const text = data.content?.find((c) => c.type === "text")?.text;
  if (!text) {
    throw new Error("No text content in Claude response");
  }
  return text;
}

/** Extract a JSON object ({...}) from Claude's text response */
export function extractJsonObject(text: string): string | null {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

/** Extract a JSON array ([...]) from Claude's text response */
export function extractJsonArray(text: string): string | null {
  const match = text.match(/\[[\s\S]*\]/);
  return match ? match[0] : null;
}
