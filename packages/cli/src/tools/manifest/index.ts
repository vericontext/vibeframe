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
import { generateTools } from "./generate.js";
import { pipelineTools } from "./pipeline.js";
import { detectTools } from "./detect.js";
import { timelineTools } from "./timeline.js";
import { projectTools } from "./project.js";
import { exportTools } from "./export.js";

export const manifest: readonly AnyTool[] = [
  ...sceneTools,
  ...audioTools,
  ...editTools,
  ...analyzeTools,
  ...generateTools,
  ...pipelineTools,
  ...detectTools,
  ...timelineTools,
  ...projectTools,
  ...exportTools,
];

export {
  sceneTools,
  audioTools,
  editTools,
  analyzeTools,
  generateTools,
  pipelineTools,
  detectTools,
  timelineTools,
  projectTools,
  exportTools,
};
