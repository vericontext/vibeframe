/**
 * Context command - Output CONTEXT.md for agent runtime discovery.
 * Allows AI agents to read CLI guidelines without needing CLAUDE.md or CONTEXT.md on disk.
 */

import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const contextCommand = new Command("context")
  .description("Print CLI context/guidelines for AI agent integration")
  .option("--format <format>", "Output format: markdown | json", "markdown")
  .action(async (_options, cmd) => {
    const options = {
      json: cmd.parent?.opts()?.json || cmd.opts()?.json || cmd.opts()?.format === "json",
      format: String(cmd.opts()?.format ?? "markdown"),
    };
    if (options.format !== "markdown" && options.format !== "json") {
      console.error("Invalid --format. Use markdown or json.");
      process.exit(2);
    }

    const contract = {
      product: "vibeframe",
      sourceOfTruth: ["STORYBOARD.md", "DESIGN.md", "vibe.config.json"],
      preferredFlow: [
        "storyboard validate",
        "plan",
        "build --dry-run",
        "build",
        "inspect project",
        "render",
        "inspect render --cheap",
        "inspect render --ai when needed",
      ],
      mentalModel: {
        storyboard: "intent layer; edit or mutate beat cues here",
        scene: "generated artifact layer; lint/repair composition HTML here",
      },
      providerPrecedence: [
        "CLI flag",
        "per-beat STORYBOARD.md cue",
        "project vibe.config.json",
        "legacy vibe.project.yaml",
        "configured default or environment",
        "VibeFrame default",
      ],
      semanticFixes: "host-agent",
      mechanicalFixes: "vibe scene repair; vibe scene lint --fix remains the lower-level primitive",
      publicFlow: "vibe init --from <brief> -> edit STORYBOARD.md/DESIGN.md -> vibe storyboard validate -> vibe plan -> vibe build --dry-run --max-cost <usd> -> vibe build -> vibe inspect project -> vibe render -> vibe inspect render --cheap -> optional vibe inspect render --ai",
    };

    if (options.json) {
      console.log(JSON.stringify(contract, null, 2));
      return;
    }

    // CONTEXT.md lives at packages/cli/CONTEXT.md (one level up from dist/).
    // Pre-v0.79.3 this resolved to `../../CONTEXT.md` which silently
    // missed the file and fell through to the inline fallback every
    // time — `vibe context` only ever printed 8 lines.
    const contextPath = resolve(__dirname, "../CONTEXT.md");

    try {
      const content = await readFile(contextPath, "utf-8");
      console.log(
        content.replace(
          "## Mental model",
          `## Storyboard-to-video contract

Source of truth: \`STORYBOARD.md\`, \`DESIGN.md\`, and \`vibe.config.json\`.
\`STORYBOARD.md\` is the intent layer. Generated scene files under
\`compositions/\` are artifact layer. Use \`vibe storyboard *\` for narrow
cue edits; use \`vibe inspect project\`, \`vibe inspect render --cheap\`,
\`vibe inspect render --ai\`, and \`vibe scene repair\` for local and AI
review plus mechanical fixes.
Semantic creative fixes belong to the host agent.

Canonical flow:

\`\`\`bash
vibe init my-video --from "brief" --json
vibe storyboard validate my-video --json
vibe plan my-video --json
vibe build my-video --dry-run --max-cost 5 --json
vibe build my-video --max-cost 5 --json
vibe inspect project my-video --json
vibe render my-video --json
vibe inspect render my-video --cheap --json
vibe inspect render my-video --ai --json
\`\`\`

Provider precedence: CLI flag -> storyboard cue -> \`vibe.config.json\` ->
legacy \`vibe.project.yaml\` -> configured/env default -> VibeFrame default.

## Mental model`,
        ),
      );
    } catch {
      // Fallback: inline minimal context if file not found (e.g., bundled/npx usage)
      const fallback = `# VibeFrame CLI Agent Context

Use 'vibe schema --list --json' to discover all commands.
Use 'vibe schema <command> --json' to get parameter schemas.
Use 'vibe doctor --json' to check configured API keys.
Use '--dry-run --json' before any mutating/costly operation.

Cost tiers: Free (detect, edit silence-cut/fade/noise-reduce, project, timeline) | Low (inspect, audio transcribe, generate image) | High (generate video, edit image) | Very High (remix highlights/auto-shorts/regenerate-scene, vibe build)

Group → MCP tool name: '<group>_<leaf>' (snake_case). Bare top-level (init/build/render/run) maps to bare MCP names.

Full reference: docs/cli-reference.md
`;
      console.log(fallback);
    }
  });
