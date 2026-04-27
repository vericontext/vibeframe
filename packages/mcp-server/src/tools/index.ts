/**
 * @module mcp-server/tools
 * @description The MCP server's tools/list + tools/call implementation,
 * driven entirely by the v0.65 manifest.
 *
 * After C6 (legacy collapse) every tool comes from
 * `@vibeframe/cli/tools/manifest`. The legacy hand-written tool files
 * (`scene.ts`, `timeline.ts`, etc.) and their `handle*ToolCall` switches
 * have been deleted.
 */

import { manifest } from "@vibeframe/cli/tools/manifest";
import {
  manifestToMcpTools,
  buildMcpDispatcher,
} from "@vibeframe/cli/tools/adapters/mcp";

export const tools = manifestToMcpTools(manifest);

const dispatch = buildMcpDispatcher(manifest);

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  return dispatch(name, args);
}
