/**
 * @module adapters/agent
 * @description Adapter from manifest entries to in-process Agent
 * `ToolRegistry`. Consumed by `packages/cli/src/agent/tools/index.ts`.
 */

import type { ZodError } from "zod";
import { zodToAgentParameters } from "../zod-to-json-schema.js";
import type { ToolDefinition } from "../define-tool.js";
import type { ToolRegistry, ToolHandler } from "../../agent/tools/index.js";
import type {
  ToolDefinition as AgentToolDefinition,
  ToolParameter,
  ToolResult,
} from "../../agent/types.js";

function formatZodError(err: ZodError): string {
  return err.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

/**
 * Convert a manifest entry's JSON Schema into the Agent's
 * `{type:"object", properties: Record<string, ToolParameter>, required: string[]}`
 * shape. The shape is structurally identical; this is mostly a type cast plus
 * field-name harmonisation.
 */
function toAgentDefinition(t: ToolDefinition): AgentToolDefinition {
  const json = zodToAgentParameters(t.schema);
  // Recursively coerce JsonSchema → ToolParameter. Both have the same fields
  // (type, description, enum, items, properties), so the cast is sound for
  // the schema subset our converter supports.
  const properties: Record<string, ToolParameter> = {};
  for (const [k, v] of Object.entries(json.properties ?? {})) {
    properties[k] = v as unknown as ToolParameter;
  }
  return {
    name: t.name,
    description: t.description,
    parameters: {
      type: "object",
      properties,
      required: json.required ?? [],
    },
  };
}

/** Register every manifest entry tagged `agent` (or surfaces undefined) into a ToolRegistry. */
export function registerManifestIntoAgent(
  registry: ToolRegistry,
  manifest: readonly ToolDefinition[],
): void {
  for (const tool of manifest) {
    if (tool.surfaces && !tool.surfaces.includes("agent")) continue;

    const definition = toAgentDefinition(tool);
    const handler: ToolHandler = async (args, context): Promise<ToolResult> => {
      const parsed = tool.schema.safeParse(args);
      if (!parsed.success) {
        return {
          toolCallId: "",
          success: false,
          output: "",
          error: formatZodError(parsed.error),
        };
      }
      try {
        const result = await tool.execute(parsed.data, {
          workingDirectory: context.workingDirectory,
          surface: "agent",
        });
        if (!result.success) {
          return {
            toolCallId: "",
            success: false,
            output: "",
            error: result.error ?? "tool execution failed",
          };
        }
        const output =
          result.humanLines && result.humanLines.length > 0
            ? result.humanLines.join("\n")
            : result.data
              ? JSON.stringify(result.data)
              : "";
        return { toolCallId: "", success: true, output };
      } catch (error) {
        return {
          toolCallId: "",
          success: false,
          output: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    };

    registry.register(definition, handler);
  }
}
