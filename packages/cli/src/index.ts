#!/usr/bin/env node

// Debug: Check if script starts at all
if (process.env.VIBE_DEBUG === "1") {
  console.log("[CLI] Script started, loading modules...");
}

import { Command } from "commander";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

// Re-export engine for library usage
export { Project, generateId, type ProjectFile } from "./engine/index.js";
import { projectCommand } from "./commands/project.js";
import { timelineCommand } from "./commands/timeline.js";
import { aiCommand } from "./commands/ai.js";
import { mediaCommand } from "./commands/media.js";
import { exportCommand } from "./commands/export.js";
import { batchCommand } from "./commands/batch.js";
import { detectCommand } from "./commands/detect.js";
import { setupCommand } from "./commands/setup.js";
import { agentCommand, startAgent } from "./commands/agent.js";

export { startAgent } from "./commands/agent.js";
export { loadConfig, saveConfig, isConfigured, type VibeConfig } from "./config/index.js";
export { AgentExecutor, ToolRegistry, ConversationMemory } from "./agent/index.js";
export type { AgentConfig, AgentContext, AgentMessage, ToolCall, ToolResult, LLMAdapter } from "./agent/index.js";

const program = new Command();

program
  .name("vibe")
  .description("VibeFrame CLI - AI-First Video Editor")
  .version(pkg.version);

program.addCommand(projectCommand);
program.addCommand(timelineCommand);
program.addCommand(aiCommand);
program.addCommand(mediaCommand);
program.addCommand(exportCommand);
program.addCommand(batchCommand);
program.addCommand(detectCommand);
program.addCommand(setupCommand);
program.addCommand(agentCommand);

// Check if any arguments provided
if (process.argv.length <= 2) {
  // No arguments - start Agent mode
  if (process.env.VIBE_DEBUG === "1") {
    console.log("[CLI] No args, starting Agent...");
  }
  startAgent().catch((err) => {
    console.error("Failed to start Agent:", err);
    process.exit(1);
  });
} else {
  // Arguments provided - parse normally
  program.parse();
}
