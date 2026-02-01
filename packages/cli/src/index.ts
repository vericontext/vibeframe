#!/usr/bin/env node

import { Command } from "commander";
import { projectCommand } from "./commands/project.js";
import { timelineCommand } from "./commands/timeline.js";
import { aiCommand } from "./commands/ai.js";
import { mediaCommand } from "./commands/media.js";
import { exportCommand } from "./commands/export.js";
import { batchCommand } from "./commands/batch.js";

const program = new Command();

program
  .name("vibe")
  .description("VibeEdit CLI - AI-First Video Editor")
  .version("0.1.0");

program.addCommand(projectCommand);
program.addCommand(timelineCommand);
program.addCommand(aiCommand);
program.addCommand(mediaCommand);
program.addCommand(exportCommand);
program.addCommand(batchCommand);

program.parse();
