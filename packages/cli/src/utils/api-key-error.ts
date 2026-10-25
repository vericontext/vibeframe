/**
 * @module api-key-error
 *
 * The one error every command raises when a provider key is not configured.
 * It lives apart from `api-key.ts` (which reads config files and `.env`) so
 * that `commands/output.ts` and the MCP adapter can recognize it without
 * pulling in config loading.
 */

/** URLs where users can obtain API keys */
const API_KEY_URLS: Record<string, string> = {
  GOOGLE_API_KEY: "https://aistudio.google.com/apikey",
  OPENAI_API_KEY: "https://platform.openai.com/api-keys",
  ANTHROPIC_API_KEY: "https://console.anthropic.com/settings/keys",
  XAI_API_KEY: "https://console.x.ai",
  ELEVENLABS_API_KEY: "https://elevenlabs.io/app/settings/api-keys",
  FAL_API_KEY: "https://fal.ai/dashboard/keys",
  RUNWAY_API_SECRET: "https://app.runwayml.com/settings/api-keys",
  KLING_API_KEY: "https://klingai.com/dev",
  REPLICATE_API_TOKEN: "https://replicate.com/account/api-tokens",
  IMGBB_API_KEY: "https://api.imgbb.com/",
};

/**
 * A required provider key is not set (no `--api-key`, no config.yaml entry,
 * no `.env` or environment variable). Thrown by `requireApiKey()` and by
 * executors before any provider call, so nothing is spent. Commands turn it
 * into the `API_KEY_MISSING` structured error (exit 4) with `toStructured()`,
 * usually through `failureFromError()` in `commands/output.ts`.
 *
 * Executors that return `{ success: false, error }` results must let this
 * error propagate instead of folding it into a result string; otherwise the
 * caller can no longer tell a missing key from a provider failure.
 */
export class ApiKeyError extends Error {
  public envVar: string;
  public providerName: string;

  constructor(envVar: string, providerName: string) {
    const keyUrl = API_KEY_URLS[envVar];
    const urlHint = keyUrl ? `\n  Get key: ${keyUrl}` : "";
    super(
      `${providerName} API key required.\n` +
        `  Set ${envVar} in .env, or run: vibe setup${urlHint}`
    );
    this.name = "ApiKeyError";
    this.envVar = envVar;
    this.providerName = providerName;
  }

  toStructured(): {
    success: false;
    error: string;
    code: string;
    exitCode: number;
    suggestion: string;
    retryable: false;
  } {
    const keyUrl = API_KEY_URLS[this.envVar];
    const urlHint = keyUrl ? ` Get key: ${keyUrl}` : "";
    return {
      success: false as const,
      error: `${this.providerName} API key required.`,
      code: "API_KEY_MISSING",
      exitCode: 4,
      suggestion: `Set ${this.envVar} in .env, or run: vibe setup. Check available features: vibe doctor --json.${urlHint}`,
      retryable: false as const,
    };
  }
}
