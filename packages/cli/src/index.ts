#!/usr/bin/env node

// Debug: Check if script starts at all
if (process.env.VIBE_DEBUG === "1") {
  console.log("[CLI] Script started, loading modules...");
}

import { Command, CommanderError, Help } from "commander";
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
import { inspectCommand } from "./commands/inspect.js";
import { audioCommand } from "./commands/audio.js";
import { remixCommand } from "./commands/remix.js";
import { schemaCommand } from "./commands/schema.js";
import { mediaCommand } from "./commands/media.js";
import { batchCommand } from "./commands/batch.js";
import { detectCommand } from "./commands/detect.js";
import { setupCommand } from "./commands/setup.js";
import { initCommand } from "./commands/init.js";
import { storyboardCommand } from "./commands/storyboard.js";
import { designCommand } from "./commands/design.js";
import { planCommand } from "./commands/plan.js";
import { buildCommand } from "./commands/build.js";
import { renderCommand } from "./commands/render.js";
import { previewCommand } from "./commands/preview.js";
import { assembleCommand } from "./commands/assemble.js";
import { statusCommand } from "./commands/status.js";
import { doctorCommand } from "./commands/doctor.js";
import { hostCommand } from "./commands/host.js";
import { demoCommand } from "./commands/demo.js";
import { contextCommand } from "./commands/context.js";
import { runCommand } from "./commands/run.js";
import { agentCommand } from "./commands/agent.js";
import { guideCommand, legacyGuideAliasCommand } from "./commands/walkthrough.js";
import { completionCommand } from "./commands/completion.js";
import { ApiKeyError } from "./utils/api-key.js";
import { isFirstRun, showFirstRunBanner, markBannerShown } from "./utils/first-run.js";
import { exitWithError, usageError } from "./commands/output.js";
import { rejectControlChars } from "./utils/input-validation.js";
import { buildSchema } from "./commands/schema.js";
import { getCostTier, TIER_DESCRIPTION, type CostTier } from "./commands/_shared/cost-tier.js";
import { productSurfaceForCommandPath } from "./commands/_shared/product-surface.js";
import { renderCommandGroups } from "./commands/_shared/help-groups.js";

interface HelpHiddenCommand {
  _hidden?: boolean;
}

/**
 * How many example commands each cost-tier row names. Two keeps every row
 * inside 80 columns; the tier's full membership is one command away via
 * `vibe schema --list --filter <tier>`.
 */
const COST_TIER_EXAMPLES = 2;

/**
 * Build the "Cost tiers" footer for `vibe --help`.
 *
 * Walks the live program tree, groups subcommands by cost tier, and
 * emits one row per tier with {@link COST_TIER_EXAMPLES} example commands
 * and the canonical price-band string. Pre-fix this section was a
 * hardcoded block in `addHelpText` that drifted from the SSOT (e.g. it
 * claimed "V.High remix (...)" while `remix animated-caption` is
 * actually low).
 */
function renderCostTierFooter(prog: Command): string {
  const buckets: Record<CostTier, string[]> = { free: [], low: [], high: [], "very-high": [] };
  const walk = (cmd: Command, prefix: string) => {
    if ((cmd as unknown as HelpHiddenCommand)._hidden) return;
    const path = prefix ? `${prefix}.${cmd.name()}` : cmd.name();
    const tier = getCostTier(cmd);
    const surface = productSurfaceForCommandPath(path).surface;
    if (tier && surface !== "legacy" && surface !== "internal") buckets[tier].push(path);
    for (const child of cmd.commands) walk(child, path);
  };
  for (const top of prog.commands) walk(top, "");

  const order: CostTier[] = ["free", "low", "high", "very-high"];
  const rows = order
    .map((tier) => ({
      tier,
      label: tier === "very-high" ? "V.High" : tier[0].toUpperCase() + tier.slice(1),
      examples: buckets[tier].slice(0, COST_TIER_EXAMPLES).join(", "),
    }))
    .filter((row) => row.examples);

  // Width is measured, not assumed: a fixed padEnd(50) silently overflowed
  // once the `low` tier's three example names grew past it, pushing that
  // row's price band out of column.
  const exampleWidth = Math.max(...rows.map((row) => row.examples.length));
  const lines: string[] = [
    "Cost tiers (`vibe --describe <cmd>` for each tag; legacy/internal omitted here):",
  ];
  for (const row of rows) {
    lines.push(
      `  ${row.label.padEnd(7)}${row.examples.padEnd(exampleWidth)}  ${TIER_DESCRIPTION[row.tier]}`
    );
  }
  return "\n" + lines.join("\n") + "\n";
}

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
export type {
  AgentConfig,
  AgentContext,
  AgentMessage,
  ToolCall,
  ToolResult,
  LLMAdapter,
} from "./agent/index.js";

const program = new Command();

program
  .name("vibe")
  .showSuggestionAfterError(true)
  .description("VibeFrame CLI - AI video generation on your own provider keys, behind dry runs and a hard cost cap")
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
        const err = {
          success: false,
          error: str.trim(),
          message: str.trim(),
          code: "USAGE_ERROR",
          exitCode: 2,
          retryable: false,
          recoverable: false,
          retryWith: ["Run with --help for full options."],
        };
        process.stderr.write(JSON.stringify(err, null, 2) + "\n");
      } else {
        write(chalk.red(str.trim()) + "\n");
        write(chalk.dim("Run with --help for full options.\n"));
      }
    },
  })
  // Root help lists commands by use case instead of alphabetically. The
  // flat `Commands:` block is suppressed for the root only (subcommands
  // keep Commander's default), because it used to duplicate the very
  // listing the footer below already gave by use case.
  .configureHelp({
    visibleCommands(cmd) {
      if (cmd === program) return [];
      return Help.prototype.visibleCommands.call(this, cmd);
    },
  })
  .addHelpText("after", () => renderCommandGroups(program))
  .addHelpText(
    "after",
    `
Full command catalog, including the timeline, batch, and scene primitives
this listing omits:

  vibe schema --list                  Every command, with cost tier
  vibe schema --list --surface public First-run product path only
  vibe schema generate.video          JSON schema for one command

Most commands accept --dry-run to preview cost and output before invoking
a paid provider.`
  )
  // Cost tiers block - generated from the live cost-tier registry so
  // it can't drift from `_shared/cost-tier.ts`. Picks two representative
  // examples per tier (registry order) instead of hand-curating.
  .addHelpText("after", () => renderCostTierFooter(program));

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
      exitWithError(
        usageError(
          "--stdin requires piped input.",
          'echo \'{"key":"value"}\' | vibe <command> --stdin'
        )
      );
    }
    try {
      const raw = await readStdin();
      if (!raw) {
        exitWithError(
          usageError(
            "--stdin received empty input.",
            "Pipe JSON to stdin: echo '{...}' | vibe <command> --stdin"
          )
        );
      }
      const json = JSON.parse(raw);
      if (typeof json !== "object" || json === null || Array.isArray(json)) {
        exitWithError(
          usageError(
            "--stdin expects a JSON object.",
            'Example: {"output":"out.mp4","provider":"kling"}'
          )
        );
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
            exitWithError(
              usageError(
                `--stdin field '${key}' contains control characters.`,
                "Remove non-printable characters from the JSON value."
              )
            );
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
        exitWithError(
          usageError(
            `--stdin received invalid JSON: ${err.message}`,
            'Ensure valid JSON: echo \'{"key":"value"}\' | vibe <command> --stdin'
          )
        );
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
program.addCommand(inspectCommand);
program.addCommand(audioCommand);
program.addCommand(remixCommand);
program.addCommand(setupCommand);
program.addCommand(initCommand);
program.addCommand(storyboardCommand);
program.addCommand(designCommand);
program.addCommand(planCommand);
program.addCommand(buildCommand);
program.addCommand(renderCommand);
program.addCommand(previewCommand);
program.addCommand(assembleCommand);
program.addCommand(statusCommand);
program.addCommand(doctorCommand);
program.addCommand(hostCommand);
program.addCommand(demoCommand, { hidden: true });
program.addCommand(runCommand);
program.addCommand(agentCommand);

// Workflow commands
//
// `project`, `scene`, `timeline` are hidden from `vibe --help` because
// their descriptions either self-deprecate ("Deprecated alias…") or
// nudge users toward `init`/`build`/`render` ("For project flow use
// `vibe init`…"). They still register, still show in
// `vibe schema --list`, and tab completion still finds them — they
// just don't take visual weight in the front-page Commands list.
program.addCommand(projectCommand, { hidden: true });
program.addCommand(sceneCommand, { hidden: true });
program.addCommand(timelineCommand, { hidden: true });
program.addCommand(detectCommand);
program.addCommand(batchCommand, { hidden: true });

// Agent integration commands
program.addCommand(schemaCommand);
program.addCommand(contextCommand);
program.addCommand(guideCommand);
program.addCommand(legacyGuideAliasCommand, { hidden: true });
program.addCommand(completionCommand);

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
          const err = {
            success: false,
            error: str.trim(),
            message: str.trim(),
            code: "USAGE_ERROR",
            exitCode: 2,
            retryable: false,
            recoverable: false,
            retryWith: ["Run with --help for full options."],
          };
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

// Compatibility shortcut: Commander exposes `--version`, but many users try
// `vibe version` by muscle memory. Handle it before normal command parsing so
// it does not become part of the agent-facing schema/tool surface.
if (process.argv.length === 3 && process.argv[2] === "version") {
  console.log(pkg.version);
  process.exit(0);
}

// Global --describe: resolve command and output schema without parsing args
if (process.argv.includes("--describe")) {
  const args = process.argv.slice(2).filter((a) => a !== "--describe" && a !== "--json");
  // Walk the command tree to find the target command
  let cmd: Command = program;
  const nameParts: string[] = [];
  for (const arg of args) {
    const sub = cmd.commands.find((c) => c.name() === arg || c.aliases().includes(arg));
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
  program.outputHelp();
  process.exit(0);
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
