#!/usr/bin/env node

// Debug: Check if script starts at all
if (process.env.VIBE_DEBUG === "1") {
  console.log("[CLI] Script started, loading modules...");
}

import { Command, CommanderError } from "commander";
import chalk from "chalk";
// Bundled inline by esbuild — works after `tsc` (workspace dev) and after
// `node build.js` (npm publish artifact). The previous `require("../package.json")`
// broke once the cli was bundled into a flat `dist/index.js` because the
// relative path resolution depended on the source file layout.
import pkg from "../package.json" with { type: "json" };

// Re-export engine for library usage
export { Project, generateId, type ProjectFile } from "./engine/index.js";
import { projectCommand } from "./commands/project.js";
import { sceneCommand } from "./commands/scene.js";
import { timelineCommand } from "./commands/timeline.js";
import { generateCommand } from "./commands/generate.js";
import { editCommand } from "./commands/edit-cmd.js";
import { analyzeCommand } from "./commands/analyze.js";
import { audioCommand } from "./commands/audio.js";
import { pipelineCommand } from "./commands/pipeline.js";
import { schemaCommand } from "./commands/schema.js";
import { mediaCommand } from "./commands/media.js";
import { exportCommand } from "./commands/export.js";
import { batchCommand } from "./commands/batch.js";
import { detectCommand } from "./commands/detect.js";
import { setupCommand } from "./commands/setup.js";
import { initCommand } from "./commands/init.js";
import { doctorCommand } from "./commands/doctor.js";
import { demoCommand } from "./commands/demo.js";
import { contextCommand } from "./commands/context.js";
import { runCommand } from "./commands/run.js";
import { agentCommand } from "./commands/agent.js";
import { ApiKeyError } from "./utils/api-key.js";
import { isFirstRun, showFirstRunBanner, markBannerShown } from "./utils/first-run.js";
import { exitWithError, usageError } from "./commands/output.js";
import { rejectControlChars } from "./utils/input-validation.js";
import { buildSchema } from "./commands/schema.js";

/**
 * Read all data from stdin (non-blocking, only when stdin is piped).
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}

export { startAgent } from "./commands/agent.js";
export { loadConfig, saveConfig, isConfigured, type VibeConfig } from "./config/index.js";
export { AgentExecutor, ToolRegistry, ConversationMemory } from "./agent/index.js";
export type { AgentConfig, AgentContext, AgentMessage, ToolCall, ToolResult, LLMAdapter } from "./agent/index.js";

const program = new Command();

program
  .name("vibe")
  .showSuggestionAfterError(true)
  .description("VibeFrame CLI - AI-First Video Editor")
  .version(pkg.version)
  .option("--json", "Output in JSON format")
  .option("-q, --quiet", "Output only the primary result value (path, URL, or ID)")
  .option("--fields <fields>", "Limit JSON output to specific fields (comma-separated)")
  .option("--stdin", "Read options from stdin as JSON (for agent/script use)")
  .option("--describe", "Show JSON schema for the command and exit (no execution)")
  .exitOverride() // Throw instead of calling process.exit, so we can catch and format
  .configureOutput({
    outputError: (str, write) => {
      // In JSON mode, output structured error to stderr
      if (process.env.VIBE_JSON_OUTPUT === "1" || process.argv.includes("--json")) {
        const err = { success: false, error: str.trim(), code: "USAGE_ERROR", exitCode: 2, retryable: false };
        process.stderr.write(JSON.stringify(err, null, 2) + "\n");
      } else {
        write(chalk.red(str.trim()) + "\n");
        write(chalk.dim("Run with --help for full options.\n"));
      }
    },
  })
  .addHelpText(
    "after",
    `
Global flags (work with any command):
  --json         Output JSON (auto-enabled when piped)
  --fields       Limit output fields (e.g., --fields "path,duration")
  --quiet        Output only the result value (path, URL, or ID)
  --stdin        Read options from stdin as JSON (for agent/script use)
  --dry-run      Preview without executing (most commands)

Cost tiers:
  Free     detect, edit (silence-cut/fade/noise-reduce), project, timeline, export
  Low      analyze, audio transcribe, generate image               ~$0.01-$0.10
  High     generate video, edit image                              ~$1-$5
  V.High   pipeline (regenerate-scene, highlights, auto-shorts)   ~$5-$50+

Quick start:
  vibe doctor                  Check system health and API keys
  vibe setup                   Configure API keys interactively
  vibe schema --list           Discover all commands (69 commands)

Agent integration:
  echo '{"provider":"kling"}' | vibe generate video "prompt" --stdin --json
  vibe schema generate.video   Get parameter schema for any command
`
  );

// Set JSON mode env var before subcommand parsing
// Also check for first-run, stdin JSON, and show banner
program.hook("preAction", async (thisCommand, actionCommand) => {
  const opts = program.opts();

  // --json flag or auto-detect non-TTY stdout
  if (opts.json || (!process.stdout.isTTY && !process.env.VIBE_HUMAN_OUTPUT)) {
    process.env.VIBE_JSON_OUTPUT = "1";
  }

  // --quiet flag
  if (opts.quiet) {
    process.env.VIBE_QUIET_OUTPUT = "1";
  }

  // --fields flag
  if (opts.fields) {
    process.env.VIBE_OUTPUT_FIELDS = opts.fields;
  }

  // --stdin: read JSON from stdin and merge into command options
  // Usage: echo '{"output":"out.mp4","provider":"kling"}' | vibe generate video "prompt" --stdin
  if (opts.stdin) {
    if (process.stdin.isTTY) {
      exitWithError(usageError("--stdin requires piped input.", "echo '{\"key\":\"value\"}' | vibe <command> --stdin"));
    }
    try {
      const raw = await readStdin();
      if (!raw) {
        exitWithError(usageError("--stdin received empty input.", "Pipe JSON to stdin: echo '{...}' | vibe <command> --stdin"));
      }
      const json = JSON.parse(raw);
      if (typeof json !== "object" || json === null || Array.isArray(json)) {
        exitWithError(usageError("--stdin expects a JSON object.", 'Example: {"output":"out.mp4","provider":"kling"}'));
      }
      // Merge JSON keys into the action command's options (CLI flags take precedence)
      for (const [key, value] of Object.entries(json)) {
        // Convert kebab-case to camelCase (e.g., "api-key" → "apiKey")
        const camelKey = key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
        // Reject control characters in string values from stdin
        if (typeof value === "string") {
          try {
            rejectControlChars(value, key);
          } catch {
            exitWithError(usageError(`--stdin field '${key}' contains control characters.`, "Remove non-printable characters from the JSON value."));
          }
        }
        // Only set if not already explicitly specified via CLI flag
        const source = actionCommand.getOptionValueSource(camelKey);
        if (source === undefined || source === "default") {
          actionCommand.setOptionValueWithSource(camelKey, value, "stdin");
        }
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        exitWithError(usageError(`--stdin received invalid JSON: ${err.message}`, "Ensure valid JSON: echo '{\"key\":\"value\"}' | vibe <command> --stdin"));
      }
      throw err;
    }
  }

  // Show first-run banner for non-setup/doctor commands
  // Use actionCommand (the actual subcommand) not thisCommand (root "vibe")
  const cmdName = actionCommand.name();
  const skipBannerCommands = ["setup", "doctor", "help"];
  if (!skipBannerCommands.includes(cmdName) && process.stdin.isTTY && process.stdout.isTTY) {
    try {
      if (await isFirstRun()) {
        showFirstRunBanner();
        await markBannerShown();
      }
    } catch {
      // Don't block on first-run check failure
    }
  }
});

// Main commands (visible in --help)
program.addCommand(generateCommand);
program.addCommand(editCommand);
program.addCommand(analyzeCommand);
program.addCommand(audioCommand);
program.addCommand(pipelineCommand);
program.addCommand(setupCommand);
program.addCommand(initCommand);
program.addCommand(doctorCommand);
program.addCommand(demoCommand);
program.addCommand(runCommand);
program.addCommand(agentCommand);

// Workflow commands
program.addCommand(projectCommand);
program.addCommand(sceneCommand);
program.addCommand(timelineCommand);
program.addCommand(exportCommand);
program.addCommand(detectCommand);
program.addCommand(batchCommand);

// Agent integration commands
program.addCommand(schemaCommand);
program.addCommand(contextCommand);

// Utility commands (less commonly used directly)
program.addCommand(mediaCommand, { hidden: true });

// Propagate exitOverride and JSON-aware error output to all subcommands
// Commander.js doesn't inherit these settings from the parent program
function propagateErrorHandling(cmd: Command): void {
  for (const sub of cmd.commands) {
    sub.exitOverride();
    sub.configureOutput({
      outputError: (str, write) => {
        if (process.env.VIBE_JSON_OUTPUT === "1" || process.argv.includes("--json")) {
          const err = { success: false, error: str.trim(), code: "USAGE_ERROR", exitCode: 2, retryable: false };
          process.stderr.write(JSON.stringify(err, null, 2) + "\n");
        } else {
          write(chalk.red(str.trim()) + "\n");
          write(chalk.dim("Run with --help for full options.\n"));
        }
      },
    });
    propagateErrorHandling(sub);
  }
}
propagateErrorHandling(program);

// Global --describe: resolve command and output schema without parsing args
if (process.argv.includes("--describe")) {
  const args = process.argv.slice(2).filter(a => a !== "--describe" && a !== "--json");
  // Walk the command tree to find the target command
  let cmd: Command = program;
  const nameParts: string[] = [];
  for (const arg of args) {
    const sub = cmd.commands.find(c => c.name() === arg || c.aliases().includes(arg));
    if (sub) {
      cmd = sub;
      nameParts.push(sub.name());
    } else {
      break; // Remaining args are arguments, not subcommands
    }
  }
  if (nameParts.length > 0) {
    const schema = buildSchema(cmd, nameParts.join("."));
    console.log(JSON.stringify(schema, null, 2));
    process.exit(0);
  } else {
    console.error("Usage: vibe <command> --describe");
    process.exit(2);
  }
}

// Check if any arguments provided
if (process.argv.length <= 2) {
  // No arguments — show help (standard CLI behavior)
  program.help();
} else {
  // Arguments provided - parse normally with global error handling
  (async () => {
    try {
      await program.parseAsync();
    } catch (err) {
      if (err instanceof CommanderError) {
        // Commander errors (missing args, unknown options, --help, --version)
        // configureOutput.outputError already formatted the message
        const code = err.exitCode === 0 ? 0 : 2; // 0 for --help/--version, 2 for usage errors
        process.exit(code);
      }
      if (err instanceof ApiKeyError) {
        exitWithError(err.toStructured());
      }
      // Re-throw non-ApiKeyError errors
      throw err;
    }
  })();
}
