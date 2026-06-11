import type { ElicitFn } from "@vibeframe/cli/tools/adapters/mcp";

/**
 * Minimal structural view of the SDK Server — just what makeElicitFn needs.
 * Keeps the function trivially testable with a fake object.
 */
export interface ElicitCapableServer {
  getClientCapabilities(): { elicitation?: object } | undefined;
  elicitInput(
    params: {
      mode: "form";
      message: string;
      requestedSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
    },
    options?: { timeout?: number }
  ): Promise<{
    action: "accept" | "decline" | "cancel";
    content?: Record<string, string | number | boolean | string[]>;
  }>;
}

/**
 * Users answer forms at human speed, not RPC speed — well past the SDK's
 * 60s default request timeout.
 */
const ELICIT_TIMEOUT_MS = 600_000;

/**
 * Builds the per-call elicitation channel handed to tools, or undefined when
 * the connected client never declared the capability (e.g. Claude Desktop as
 * of 1.11847.x) — tools then keep their non-interactive defaults.
 * VIBE_MCP_ELICIT=off force-disables it for headless/automation setups.
 */
export function makeElicitFn(
  server: ElicitCapableServer,
  env: NodeJS.ProcessEnv = process.env
): ElicitFn | undefined {
  if ((env.VIBE_MCP_ELICIT ?? "").toLowerCase() === "off") return undefined;
  if (!server.getClientCapabilities()?.elicitation) return undefined;
  return (form) =>
    server.elicitInput(
      { mode: "form", message: form.message, requestedSchema: form.requestedSchema },
      { timeout: ELICIT_TIMEOUT_MS }
    );
}
