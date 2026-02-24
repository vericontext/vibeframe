/**
 * Shared Claude API request helpers and types for split helper modules.
 */

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
    temperature?: number;
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
      max_tokens: opts.maxTokens,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      messages: opts.messages,
      system: opts.system,
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
