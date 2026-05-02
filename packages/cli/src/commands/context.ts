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
        "storyboard revise after init when the brief changes",
        "storyboard validate",
        "plan",
        "build --dry-run",
        "build",
        "status project --refresh when build returns pending-jobs",
        "inspect project",
        "render",
        "inspect render --cheap",
        "inspect render --ai when needed",
        "status project when async jobs are involved",
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
      buildPlanContract: {
        kind: "build-plan",
        schemaVersion: "1",
        status: "ready | invalid",
        gate: "plan, build --dry-run, and build validate STORYBOARD.md before cost caps or provider dispatch",
        invalidCode: "STORYBOARD_VALIDATION_FAILED",
      },
      buildRepairContract: {
        reportField: "sceneRepair",
        runs: "real build runs deterministic scene repair after compose (sub-compositions only) and after sync (including root index.html) before render",
        failureCode: "SCENE_REPAIR_FAILED",
        retrySource: "sceneRepair.retryWith",
      },
      assetFailureContract: {
        gate: "full build stops before compose/render when assets fail",
        codes: ["ASSET_REFERENCE_INVALID", "MISSING_API_KEY", "ASSET_GENERATION_FAILED"],
        fields: ["currentStage", "suggestion", "recoverable", "retryWith"],
      },
      reviewReportContract: {
        kind: "review",
        modes: ["project", "render"],
        fields: ["status", "score", "issues", "summary", "sourceReports", "retryWith"],
        issueFixOwner: {
          vibe: "deterministic CLI recovery",
          "host-agent": "storyboard/design/composition edits the host agent should make",
        },
      },
      machineStatusContract: {
        buildReport:
          "kind/status/currentStage/beatSummary/jobs/sceneRepair/stageReports/warnings/retryWith plus nested per-beat asset metadata",
        projectStatus: "kind/status/currentStage/beats/jobs.latest/build/review/warnings/retryWith",
        reviewSummary:
          "review.mode/issueCount/errorCount/warningCount/infoCount/fixOwners/sourceReports/retryWith",
      },
      productSurfaceContract: {
        surfaces: ["public", "agent", "advanced", "legacy", "internal"],
        discovery: "vibe schema --list --surface public",
        rule: "prefer public commands; use legacy only for compatibility and inspect replacement first",
      },
      semanticFixes:
        "vibe storyboard revise for STORYBOARD.md; host-agent for composition code and DESIGN.md rewrites",
      mechanicalFixes: "vibe scene repair; vibe scene lint --fix remains the lower-level primitive",
      publicFlow:
        "vibe init --from <brief> -> optional vibe storyboard revise --from <request> -> edit STORYBOARD.md/DESIGN.md -> vibe storyboard validate -> vibe plan -> vibe build --dry-run --max-cost <usd> -> vibe build -> vibe status project --refresh when build returns pending-jobs -> vibe inspect project -> vibe render -> vibe inspect render --cheap -> optional vibe inspect render --ai",
      beatLoop:
        "vibe build <project> --beat <id> --stage sync --json -> vibe inspect project <project> --beat <id> --json -> vibe render <project> --beat <id> --json -> vibe inspect render <project> --beat <id> --cheap --json",
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
vibe storyboard revise my-video --from "make the hook sharper" --dry-run --json
vibe storyboard validate my-video --json
vibe plan my-video --json
vibe build my-video --dry-run --max-cost 5 --json
vibe build my-video --max-cost 5 --json
vibe status project my-video --refresh --json
vibe inspect project my-video --json
vibe render my-video --json
vibe inspect render my-video --cheap --json
vibe inspect render my-video --ai --json

# Single-beat loop
vibe build my-video --beat hook --stage sync --json
vibe inspect project my-video --beat hook --json
vibe render my-video --beat hook --json
vibe inspect render my-video --beat hook --cheap --json
vibe status project my-video --json
\`\`\`

\`vibe storyboard revise\` uses project context and a composer LLM
(Claude/OpenAI/Gemini) to revise \`STORYBOARD.md\`; use \`--dry-run\`
first and inspect \`data.validation\`, \`data.changedBeats\`, and
\`data.retryWith\`.

Provider precedence: CLI flag -> storyboard cue -> \`vibe.config.json\` ->
legacy \`vibe.project.yaml\` -> configured/env default -> VibeFrame default.

\`vibe plan --json\` emits \`data.kind:"build-plan"\`,
\`schemaVersion:"1"\`, \`status:"ready"|"invalid"\`, \`summary\`,
\`providerResolution\`, cache-aware per-asset plans, \`validation\`,
\`retryWith\`, and \`nextCommands\`. \`vibe plan\`, \`vibe build --dry-run\`,
and \`vibe build\` validate \`STORYBOARD.md\`
before cost caps or provider dispatch. Invalid storyboards exit non-zero
with \`code:"STORYBOARD_VALIDATION_FAILED"\`.

Real \`vibe build\` runs deterministic scene repair after compose
(sub-compositions only) and after sync (including root \`index.html\`) before
render. Repair failures return \`code:"SCENE_REPAIR_FAILED"\` with
\`sceneRepair.retryWith\`. If assets fail, full build stops before compose/
render with \`currentStage:"assets"\` and \`code:"ASSET_REFERENCE_INVALID"\`,
\`code:"MISSING_API_KEY"\`, or \`code:"ASSET_GENERATION_FAILED"\`.
\`build-report.json\` includes \`sceneRepair\`, and \`status project\` carries
review issue counts, \`fixOwners\`, \`sourceReports\`, and
\`review.retryWith\`.

\`review-report.json\` is written by \`inspect project\` and \`inspect render\`
as \`kind:"review"\` with \`mode:"project"|"render"\`, \`summary\`,
\`sourceReports\`, \`retryWith\`, and issue-level
\`fixOwner:"vibe"|"host-agent"\`.

\`vibe schema --list\` includes \`surface\`, \`replacement\`, and \`note\`.
Prefer \`vibe schema --list --surface public\` for the small product surface,
and use legacy commands only when compatibility requires them.

## Mental model`
        )
      );
    } catch {
      // Fallback: inline minimal context if file not found (e.g., bundled/npx usage)
      const fallback = `# VibeFrame CLI Agent Context

Use 'vibe schema --list --json' to discover all commands.
Use 'vibe schema --list --surface public' for the small product surface.
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
