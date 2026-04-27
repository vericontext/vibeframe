/**
 * @module manifest
 * @description Aggregated tool manifest. Concatenation of all category files.
 * MCP server and Agent registry both consume this single export.
 */

import type { AnyTool } from "../define-tool.js";
import { sceneTools } from "./scene.js";
import { audioTools } from "./audio.js";
import { editTools } from "./edit.js";
import { analyzeTools } from "./analyze.js";

export const manifest: readonly AnyTool[] = [
  ...sceneTools,
  ...audioTools,
  ...editTools,
  ...analyzeTools,
  // Future commits add: generate, pipeline, detect, timeline, project,
  // export, agent-only, mcp-only.
];

export { sceneTools, audioTools, editTools, analyzeTools };
