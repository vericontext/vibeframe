/**
 * @module adapters/mcp
 * @description Adapter from manifest entries to MCP server tool array +
 * dispatcher. Consumed by `packages/mcp-server/src/tools/index.ts`.
 */

import type { ZodError } from "zod";
import { zodToJsonSchema, type JsonSchema } from "../zod-to-json-schema.js";
import type { ToolDefinition } from "../define-tool.js";

/**
 * Top-level MCP tool inputSchema. We always emit `{ type:"object", properties,
 * required }` at the root, so unlike the generic `JsonSchema` (which has
 * optional `properties`/`required` for leaf nodes), the top-level shape's
 * `properties` is required.
 */
export interface McpInputSchema {
  type: "object";
  properties: Record<string, JsonSchema>;
  required: string[];
  description?: string;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: McpInputSchema;
}

export type McpDispatcher = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ content: Array<{ type: "text"; text: string }> }>;

function formatZodError(err: ZodError): string {
  // Surface "this required field is missing/null/undefined" as the legacy
  // "missing required argument" phrasing so existing MCP-host integrations
  // that match on that string keep working. Zod issues this with two
  // shapes:
  //   - {code: "invalid_type", message: "Required", received: "undefined"}
  //   - {code: "invalid_type", message: "Expected …, received null", received: "null"}
  const missing = err.issues
    .filter((i) => {
      if (i.code !== "invalid_type") return false;
      // ZodIssue's `received` field is typed `unknown` here.
      const received = (i as unknown as { received?: string }).received;
      return received === "undefined" || received === "null";
    })
    .map((i) => i.path.join("."))
    .filter(Boolean);
  if (missing.length > 0) {
    const plural = missing.length > 1 ? "s" : "";
    return `missing required argument${plural}: ${missing.join(", ")}`;
  }
  return err.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

/** Filter manifest by `surfaces.mcp` (default: included) and project to MCP tool shape. */
export function manifestToMcpTools(manifest: readonly ToolDefinition[]): McpTool[] {
  return manifest
    .filter((t) => !t.surfaces || t.surfaces.includes("mcp"))
    .map((t) => {
      const inputSchema = zodToJsonSchema(t.schema);
      // zodToJsonSchema always emits properties/required for top-level
      // ZodObject (validated by zod-to-json-schema's convertObject); narrow
      // the type for MCP consumers.
      return {
        name: t.name,
        description: t.description,
        inputSchema: {
          type: "object" as const,
          properties: inputSchema.properties ?? {},
          required: inputSchema.required ?? [],
          ...(inputSchema.description ? { description: inputSchema.description } : {}),
        },
      };
    });
}

/** Build the dispatcher used by `handleToolCall` in the MCP server. */
export function buildMcpDispatcher(manifest: readonly ToolDefinition[]): McpDispatcher {
  const byName = new Map<string, ToolDefinition>();
  for (const t of manifest) {
    if (!t.surfaces || t.surfaces.includes("mcp")) {
      byName.set(t.name, t);
    }
  }

  return async (name, args) => {
    const tool = byName.get(name);
    if (!tool) {
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }
    const parsed = tool.schema.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{ type: "text", text: `${name} failed: ${formatZodError(parsed.error)}` }],
      };
    }
    try {
      const result = await tool.execute(parsed.data, {
        workingDirectory: process.cwd(),
        surface: "mcp",
      });
      const text = result.success
        ? JSON.stringify({ success: true, ...result.data })
        : `${name} failed: ${result.error ?? "unknown error"}`;
      return { content: [{ type: "text", text }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `${name} threw: ${msg}` }] };
    }
  };
}
