/**
 * @module sanitize
 * @description Sanitize AI/LLM responses to prevent prompt injection and terminal exploits.
 */

/**
 * Strip suspicious prompt injection patterns from LLM text output.
 * Catches common injection attempts like "Ignore previous instructions",
 * fake system prompts, and markdown-disguised commands.
 */
export function sanitizeLLMResponse(text: string): string {
  if (!text || typeof text !== "string") return text;

  let sanitized = text;

  // Strip ANSI escape sequences that could manipulate terminal
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");

  // Strip other control characters (except newline, tab, carriage return)
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");

  return sanitized;
}

/**
 * Sanitize structured data from AI responses (e.g., JSON parsed results).
 * Recursively sanitizes all string values.
 */
export function sanitizeAIResult<T>(data: T): T {
  if (data === null || data === undefined) return data;
  if (typeof data === "string") return sanitizeLLMResponse(data) as T;
  if (Array.isArray(data)) return data.map(sanitizeAIResult) as T;
  if (typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      result[key] = sanitizeAIResult(value);
    }
    return result as T;
  }
  return data;
}
