/**
 * @module manifest
 * @description Aggregated tool manifest. Concatenation of all category files.
 * MCP server and Agent registry both consume this single export.
 */

import type { AnyTool } from "../define-tool.js";
import { sceneTools } from "./scene.js";
import { audioTools } from "./audio.js";
import { editTools } from "./edit.js";
import { inspectTools } from "./inspect.js";
import { generateTools } from "./generate.js";
import { storyboardTools } from "./storyboard.js";
import { designTools } from "./design.js";
import { remixTools } from "./remix.js";
import { detectTools } from "./detect.js";
import { timelineTools } from "./timeline.js";
import { projectTools } from "./project.js";
import { exportTools } from "./export.js";
import { agentOnlyTools } from "./agent-only.js";
import { guideTools } from "./walkthrough.js";
import { statusTools } from "./status.js";

export const manifest: readonly AnyTool[] = [
  ...sceneTools,
  ...audioTools,
  ...editTools,
  ...inspectTools,
  ...generateTools,
  ...storyboardTools,
  ...designTools,
  ...remixTools,
  ...detectTools,
  ...timelineTools,
  ...projectTools,
  ...exportTools,
  ...agentOnlyTools,
  ...guideTools,
  ...statusTools,
];

export {
  sceneTools,
  audioTools,
  editTools,
  inspectTools,
  generateTools,
  storyboardTools,
  designTools,
  remixTools,
  detectTools,
  timelineTools,
  projectTools,
  exportTools,
  agentOnlyTools,
  guideTools,
  statusTools,
};
