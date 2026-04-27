/**
 * @module manifest
 * @description Aggregated tool manifest. Concatenation of all category files.
 * MCP server and Agent registry both consume this single export.
 */

import type { AnyTool } from "../define-tool.js";
import { sceneTools } from "./scene.js";

export const manifest: readonly AnyTool[] = [
  ...sceneTools,
  // Future commits add: audio, edit, analyze, generate, pipeline, detect,
  // timeline, project, export, agent-only, mcp-only.
];

export { sceneTools };
