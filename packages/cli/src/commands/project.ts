import { Command } from "commander";
import { emitDeprecationWarning } from "./output.js";
import {
  executeTimelineCreate,
  executeTimelineInfo,
  executeTimelineSet,
  LEGACY_TIMELINE_FILENAME,
} from "./_shared/timeline-project.js";

export const projectCommand = new Command("project")
  .description("Deprecated alias for low-level timeline state commands")
  .addHelpText("after", `
Deprecated:
  'vibe project' manages low-level timeline JSON state and has moved to
  'vibe timeline'. Scene projects use 'vibe init', 'vibe build', and
  'vibe render'.

Examples:
  $ vibe timeline create my-video
  $ vibe timeline info my-video
  $ vibe timeline set my-video --fps 60

Compatibility:
  Existing project.vibe.json / *.vibe.json files remain readable.
  The 'vibe project' alias will be removed in v1.0.`);

projectCommand
  .command("create")
  .description("Deprecated alias for 'vibe timeline create'")
  .argument("<name>", "Timeline name or path")
  .option("-o, --output <path>", "Output file path (overrides name-based path)")
  .option("-r, --ratio <ratio>", "Aspect ratio (16:9, 9:16, 1:1, 4:5)", "16:9")
  .option("--fps <fps>", "Frame rate", "30")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (name: string, options) => {
    emitDeprecationWarning("project create", "timeline create", "v1.0");
    await executeTimelineCreate(name, options, "project create", Date.now(), LEGACY_TIMELINE_FILENAME, false);
  });

projectCommand
  .command("info")
  .description("Deprecated alias for 'vibe timeline info'")
  .argument("<file>", "Timeline file or directory")
  .action(async (file: string) => {
    emitDeprecationWarning("project info", "timeline info", "v1.0");
    await executeTimelineInfo(file, "project info", Date.now());
  });

projectCommand
  .command("set")
  .description("Deprecated alias for 'vibe timeline set'")
  .argument("<file>", "Timeline file or directory")
  .option("--name <name>", "Timeline name")
  .option("-r, --ratio <ratio>", "Aspect ratio (16:9, 9:16, 1:1, 4:5)")
  .option("--fps <fps>", "Frame rate")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (file: string, options) => {
    emitDeprecationWarning("project set", "timeline set", "v1.0");
    await executeTimelineSet(file, options, "project set", Date.now());
  });
