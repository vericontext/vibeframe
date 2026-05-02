/**
 * Generate `docs/cli-reference.md` from the live CLI surface.
 *
 * The CLI itself is the source of truth: this script invokes
 * `vibe schema --list` and `vibe schema <leaf>` for every command and
 * renders a comprehensive markdown reference. Run from the repo root:
 *
 *     pnpm gen:reference          # write docs/cli-reference.md
 *     pnpm gen:reference --check  # exit 1 if the file would change (CI)
 *
 * No drift: changing a flag in source + rebuilding + regenerating updates
 * the reference. The `--check` mode is meant to live next to lint in CI
 * so a PR that touches a flag without regenerating the docs fails fast.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { format as formatMarkdown } from "prettier";
import { TIER_DESCRIPTION, type CostTier } from "../packages/cli/src/commands/_shared/cost-tier.js";
import {
  PRODUCT_SURFACES,
  type ProductSurface,
} from "../packages/cli/src/commands/_shared/product-surface.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_BIN = resolve(REPO_ROOT, "packages/cli/dist/index.js");
const OUT_PATH = resolve(REPO_ROOT, "docs/cli-reference.md");

if (!existsSync(CLI_BIN)) {
  console.error(`CLI binary missing at ${CLI_BIN}. Run \`pnpm -F @vibeframe/cli build\` first.`);
  process.exit(1);
}

interface SchemaListEntry {
  path: string;
  description: string;
  surface: ProductSurface;
  replacement?: string;
  note?: string;
  cost?: CostTier;
}

interface ParameterSchema {
  type?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
}

interface ToolSchema {
  name: string;
  description: string;
  surface: ProductSurface;
  replacement?: string;
  note?: string;
  cost?: CostTier;
  parameters: {
    type: "object";
    properties: Record<string, ParameterSchema>;
    required?: string[];
  };
}

function runCli(args: string[]): string {
  return execFileSync(process.execPath, [CLI_BIN, ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function getCliVersion(): string {
  return runCli(["--version"]).trim();
}

function getLeaves(): SchemaListEntry[] {
  return JSON.parse(runCli(["schema", "--list"])) as SchemaListEntry[];
}

function getSchema(path: string): ToolSchema {
  return JSON.parse(runCli(["schema", path])) as ToolSchema;
}

// ── Static content blocks ────────────────────────────────────────────────────

const HEADER = `# VibeFrame CLI Reference

> **Auto-generated** from \`vibe schema --list\`. Do not edit by hand —
> run \`pnpm gen:reference\` after any flag/command change.

VibeFrame is CLI-first: every operation is a shell command. This file
lists every command, its arguments, and its options. For agentic /
machine-readable access use \`vibe schema --list\` and
\`vibe schema <command>\` directly; both return JSON.
`;

const MENTAL_MODEL = `## Mental model

The **storyboard project** is the primary product lane. \`STORYBOARD.md\`
and \`DESIGN.md\` are the source of truth; generated files under
\`compositions/\` are artifacts. Use \`vibe storyboard revise --dry-run\`
for project-aware STORYBOARD.md rewrites, \`vibe storyboard *\` for narrow
cue edits, and direct Markdown edits for larger DESIGN.md rewrites.

\`\`\`
init --from → storyboard revise → storyboard validate → plan → build → inspect → render
generate / edit / inspect / remix                          ← one-shot media tools
scene / timeline                                            ← lower-level authoring
run / agent / schema / context                              ← automation + agents
\`\`\`

\`vibe plan --json\` emits \`data.kind:"build-plan"\`,
\`schemaVersion:"1"\`, \`status:"ready"|"invalid"\`, \`summary\`,
\`providerResolution\`, cache-aware per-asset plans, asset reference metadata
(\`sourcePath\`, \`referenceError\`), \`validation\`, \`retryWith\`, and
\`nextCommands\`. Existing project-local media referenced by \`backdrop\`,
\`video\`, \`music\`, \`narration\`, or generic \`asset\` cues is planned as
\`reason:"referenced-asset"\` with no provider spend; invalid/out-of-project
paths are surfaced before provider dispatch. \`vibe plan\`,
\`vibe build --dry-run\`, and \`vibe build\` validate \`STORYBOARD.md\` before
cost caps or provider dispatch. Invalid storyboards return
\`code:"STORYBOARD_VALIDATION_FAILED"\` with validate/revise recovery commands.

Real \`vibe build\` runs deterministic scene repair after compose
(sub-compositions only) and after sync (including root \`index.html\`) before
render. Repair failures return \`code:"SCENE_REPAIR_FAILED"\` with
\`sceneRepair.retryWith\`, and \`build-report.json\` includes \`sceneRepair\`.
\`vibe scene repair\` also fixes deterministic root timeline drift: clip refs,
root duration, and root narration audio wiring.
Asset-stage failures stop the full build before compose/render and return
\`currentStage:"assets"\` with \`code:"ASSET_REFERENCE_INVALID"\`,
\`code:"MISSING_API_KEY"\`, or \`code:"ASSET_GENERATION_FAILED"\` plus
\`suggestion\`, \`recoverable:true\`, and \`retryWith\`.
Compose failures return \`code:"COMPOSE_FAILED"\`; render failures return the
render code or \`code:"RENDER_FAILED"\`. Both include \`currentStage\`,
\`suggestion\`, \`recoverable:true\`, and \`retryWith\`.

\`vibe inspect project\` and \`vibe inspect render\` write
\`review-report.json\` by default. The file uses \`kind:"review"\`,
\`mode:"project"|"render"\`, \`status\`, \`score\`, \`issues[]\`,
\`summary:{issueCount,errorCount,warningCount,infoCount,fixOwners}\`,
\`sourceReports\`, and \`retryWith\`. Issue-level \`fixOwner:"vibe"\` means
deterministic CLI recovery; \`fixOwner:"host-agent"\` means storyboard/design/
composition edits should be handled by the host agent.
`;

const GLOBAL_FLAGS = `## Global flags

Defined on the root \`vibe\` program and available across commands:

| Flag | Effect |
|---|---|
| \`-V, --version\` | Print version and exit |
| \`-h, --help\` | Print help for the command and exit |
| \`--json\` | Output JSON (auto-enabled when stdout is piped) |
| \`--fields <list>\` | Limit JSON output fields (e.g. \`--fields "path,duration"\`) |
| \`-q, --quiet\` | Output only the result value (path / URL / ID) |
| \`--stdin\` | Read options from stdin as JSON (agent / script use) |
| \`--describe\` | Print the command's JSON Schema and exit (no execution) |
`;

const OPTION_DISCOVERY = `## Option discovery

Short aliases are command-local. Use \`vibe <command> --help\` for the
exact CLI spelling, and use \`vibe schema <command>\` for stable
machine-readable parameter names. Scripts and agents should prefer long
flags, \`--stdin\`, or schema fields over one-letter aliases.

\`--dry-run\` is also command-specific: most paid or mutating commands
support it, but it is not a root/global flag. Check the command schema or
\`--help\` page before assuming it exists.
`;

function costLabel(tier: CostTier | "untiered"): string {
  if (tier === "very-high") return "Very High";
  if (tier === "untiered") return "Not tagged";
  return tier[0].toUpperCase() + tier.slice(1);
}

function renderCostTiers(leaves: SchemaListEntry[]): string {
  const buckets: Record<CostTier | "untiered", string[]> = {
    free: [],
    low: [],
    high: [],
    "very-high": [],
    untiered: [],
  };

  for (const leaf of leaves) {
    const tier = leaf.cost ?? "untiered";
    buckets[tier].push(leaf.path);
  }

  const formatExamples = (paths: string[]): string => {
    const examples = paths.slice(0, 8).map((path) => `\`${path}\``);
    if (paths.length > examples.length) examples.push(`+${paths.length - examples.length} more`);
    return examples.join(" · ");
  };

  const lines: string[] = [
    "## Cost tiers",
    "",
    "Generated from the live `cost` field in `vibe schema --list`.",
    "",
    "| Tier | Count | Examples | Per-call cost |",
    "|---|---:|---|---|",
  ];

  for (const tier of ["free", "low", "high", "very-high"] as const) {
    const paths = buckets[tier];
    lines.push(
      `| **${costLabel(tier)}** | ${paths.length} | ${formatExamples(paths)} | ${TIER_DESCRIPTION[tier]} |`
    );
  }

  if (buckets.untiered.length > 0) {
    lines.push(
      `| **${costLabel("untiered")}** | ${buckets.untiered.length} | ${formatExamples(buckets.untiered)} | Utility/orchestration/reference commands; inspect command behavior before assuming provider spend |`
    );
  }

  lines.push(
    "",
    "> **Tip:** Run `<paid command> --dry-run --json` first — the response",
    "> includes a `costUsd` estimate when the command supports dry-run.",
    ""
  );

  return lines.join("\n");
}

function surfaceLabel(surface: ProductSurface): string {
  return surface[0].toUpperCase() + surface.slice(1);
}

function renderProductSurfaces(leaves: SchemaListEntry[]): string {
  const buckets: Record<ProductSurface, string[]> = {
    public: [],
    agent: [],
    advanced: [],
    legacy: [],
    internal: [],
  };

  for (const leaf of leaves) buckets[leaf.surface].push(leaf.path);

  const formatExamples = (paths: string[]): string => {
    const examples = paths.slice(0, 10).map((path) => `\`${path}\``);
    if (paths.length > examples.length) examples.push(`+${paths.length - examples.length} more`);
    return examples.join(" · ") || "-";
  };

  const lines: string[] = [
    "## Product surfaces",
    "",
    "Generated from the live `surface` field in `vibe schema --list`. Use",
    "`vibe schema --list --surface public` for the small first-run command",
    "surface, and inspect `replacement` on legacy commands before using them.",
    "",
    "| Surface | Count | Examples |",
    "|---|---:|---|",
  ];

  for (const surface of PRODUCT_SURFACES) {
    lines.push(
      `| **${surfaceLabel(surface)}** | ${buckets[surface].length} | ${formatExamples(buckets[surface])} |`
    );
  }

  lines.push("");
  return lines.join("\n");
}

const ENVELOPE = `## JSON envelope

### Success

\`\`\`jsonc
{
  "command": "<group> <leaf>",
  "elapsedMs": 12345,
  "costUsd": 0.07,
  "warnings": [],
  "data": { /* command-specific */ },
  "dryRun": true            // present only when --dry-run was passed
}
\`\`\`

### Error (written to stderr)

\`\`\`json
{
  "success": false,
  "error": "<message>",
  "message": "<message>",
  "code": "USAGE_ERROR | NOT_FOUND | API_ERROR | NETWORK_ERROR | AUTH_ERROR | ERROR",
  "exitCode": 0 | 1 | 2 | 3 | 4 | 5 | 6,
  "suggestion": "<actionable next step>",
  "retryWith": ["<command or action>"],
  "recoverable": true,
  "retryable": true | false
}
\`\`\`

| Exit code | Meaning |
|---|---|
| 0 | success |
| 1 | generic error |
| 2 | usage error (bad arg) |
| 3 | not found |
| 4 | auth failure |
| 5 | API error |
| 6 | network error |
`;

const MCP_MAPPING = `## CLI ↔ MCP tool name mapping

\`@vibeframe/mcp-server\` is generated from the CLI/tool manifest, not
from this markdown file. The common naming convention is:

\`\`\`
Rule 1.  vibe <group> <leaf>   →  <group>_<leaf>      (snake_case)
         e.g. vibe edit silence-cut → edit_silence_cut

Rule 2.  Manifest-only helpers may expose filesystem/project/media
         operations that do not have a 1:1 top-level CLI command.

Rule 3.  Interactive diagnostics and local setup commands may remain
         CLI-only. Use MCP tools/list or the manifest as the source of
         truth for exact availability.
\`\`\`
`;

// ── Render command catalog ────────────────────────────────────────────────────

interface RenderedLeaf {
  pathDots: string; // e.g. "edit.silence-cut"
  pathSpace: string; // e.g. "edit silence-cut"
  description: string;
  surface: ProductSurface;
  replacement?: string;
  note?: string;
  cost?: CostTier;
  parameters: Record<string, ParameterSchema>;
  required: string[];
}

function renderArg(name: string, schema: ParameterSchema, isRequired: boolean): string {
  const desc = schema.description ?? "";
  const enums = schema.enum ? ` *(${schema.enum.join(" \\| ")})*` : "";
  const def =
    schema.default !== undefined ? ` *(default: \`${JSON.stringify(schema.default)}\`)*` : "";
  const requiredMark = isRequired ? " **required**" : "";
  return `- \`${name}\` *(${schema.type ?? "any"})*${requiredMark}${enums}${def} — ${desc}`;
}

function renderLeaf(leaf: RenderedLeaf): string {
  const lines: string[] = [];
  lines.push(`#### \`vibe ${leaf.pathSpace}\``);
  lines.push("");
  lines.push(leaf.description);
  lines.push("");
  lines.push(`Product surface: \`${leaf.surface}\``);
  if (leaf.replacement) lines.push(`Replacement: \`${leaf.replacement}\``);
  if (leaf.note) lines.push(`Note: ${leaf.note}`);
  lines.push("");
  lines.push(`Cost tier: ${leaf.cost ? `\`${leaf.cost}\`` : "_not tagged_"}`);
  lines.push("");
  const props = Object.entries(leaf.parameters);
  if (props.length === 0) {
    lines.push("*No parameters.*");
  } else {
    lines.push("**Parameters:**");
    lines.push("");
    for (const [name, schema] of props) {
      lines.push(renderArg(name, schema, leaf.required.includes(name)));
    }
  }
  const notes = leafNotes(leaf.pathDots);
  if (notes.length > 0) {
    lines.push("");
    lines.push(...notes);
  }
  lines.push("");
  return lines.join("\n");
}

function leafNotes(pathDots: string): string[] {
  if (pathDots === "status.job") {
    return [
      'JSON payload: `data.kind` is `"job"` and includes flat job fields (`id`, `jobType`, `provider`, `status`, timestamps), `progress`, `result`, `retryWith`, and the raw `job` record for compatibility.',
    ];
  }
  if (pathDots === "status.project") {
    return [
      'JSON payload: `data.kind` is `"project"` and includes `status`, `currentStage`, `beats` readiness counts, `jobs.latest`, `build`, `review`, `warnings`, and `retryWith`. `review` includes `mode`, issue/error/warning/info counts, `fixOwners`, `sourceReports`, and `retryWith`; top-level `retryWith` is the resume contract.',
    ];
  }
  if (pathDots === "inspect.project") {
    return [
      '`review-report.json` payload uses `kind:"review"`, `mode:"project"`, `summary`, `sourceReports`, `retryWith`, and issue-level `fixOwner:"vibe"|"host-agent"`. Command output keeps `data.kind:"project"`.',
    ];
  }
  if (pathDots === "inspect.render") {
    return [
      '`review-report.json` payload uses `kind:"review"`, `mode:"render"`, `summary`, `sourceReports`, `retryWith`, and issue-level `fixOwner:"vibe"|"host-agent"`. `--ai` maps Gemini findings to host-agent-owned issues.',
    ];
  }
  if (pathDots === "storyboard.revise") {
    return [
      'JSON payload: `data.kind` is `"storyboard-revision"` and includes `provider`, `summary`, `changedBeats`, `validation`, `wrote`, `warnings`, and `retryWith`. Use `--dry-run` before writing.',
    ];
  }
  if (pathDots === "plan") {
    return [
      'JSON payload: `data.kind` is `"build-plan"` and includes `schemaVersion:"1"`, `status:"ready"|"invalid"`, `summary`, `providerResolution`, cache-aware asset plans, asset reference metadata, `validation`, `retryWith`, and `nextCommands`. Invalid storyboards exit non-zero with `code:"STORYBOARD_VALIDATION_FAILED"`.',
    ];
  }
  if (pathDots === "build") {
    return [
      '`--dry-run --json` returns `data.plan.kind:"build-plan"`. `build --dry-run` and real `build` validate `STORYBOARD.md` before cost caps or provider dispatch, and invalid storyboards fail with `code:"STORYBOARD_VALIDATION_FAILED"` plus validate/revise `retryWith` commands.',
      'Real `build` runs deterministic scene repair after compose and sync before render. JSON/build-report payloads include `providerResolution`, nested asset `sourcePath`, nested `composition` status/cache metadata, and `sceneRepair`; repair failures use `code:"SCENE_REPAIR_FAILED"` and `sceneRepair.retryWith`. `scene repair` also fixes root clip refs, root duration, and root narration audio wiring.',
      'Asset-stage failures stop before compose/render and return `currentStage:"assets"` with `code:"ASSET_REFERENCE_INVALID"|"MISSING_API_KEY"|"ASSET_GENERATION_FAILED"`, `suggestion`, `recoverable:true`, and `retryWith`.',
      'Compose failures return `code:"COMPOSE_FAILED"`; render failures return the render code or `code:"RENDER_FAILED"`. Both include `currentStage`, `suggestion`, `recoverable:true`, and `retryWith`.',
    ];
  }
  return [];
}

function renderGroup(groupName: string, leaves: RenderedLeaf[]): string {
  const lines: string[] = [];
  lines.push(`### \`${groupName}\``);
  lines.push("");
  for (const leaf of leaves.sort((a, b) => a.pathSpace.localeCompare(b.pathSpace))) {
    lines.push(renderLeaf(leaf));
  }
  return lines.join("\n");
}

function buildReference(): string {
  const version = getCliVersion();
  const leaves = getLeaves();

  const groups: Record<string, RenderedLeaf[]> = {};
  const topLevel: RenderedLeaf[] = [];

  for (const leaf of leaves) {
    const schema = getSchema(leaf.path);
    const rendered: RenderedLeaf = {
      pathDots: leaf.path,
      pathSpace: leaf.path.replace(/\./g, " "),
      description: leaf.description,
      surface: schema.surface ?? leaf.surface,
      replacement: schema.replacement ?? leaf.replacement,
      note: schema.note ?? leaf.note,
      cost: schema.cost ?? leaf.cost,
      parameters: schema.parameters?.properties ?? {},
      required: schema.parameters?.required ?? [],
    };
    if (leaf.path.includes(".")) {
      const group = leaf.path.split(".")[0];
      groups[group] ??= [];
      groups[group].push(rendered);
    } else {
      topLevel.push(rendered);
    }
  }

  const sections: string[] = [
    HEADER,
    // Version pins the CLI surface; no timestamp on purpose — a daily
    // regeneration would otherwise diff on `Generated: <date>` alone
    // and turn `gen:reference:check` into a false-positive.
    `> CLI version: \`${version}\``,
    "",
    MENTAL_MODEL,
    GLOBAL_FLAGS,
    OPTION_DISCOVERY,
    renderProductSurfaces(leaves),
    renderCostTiers(leaves),
    ENVELOPE,
    MCP_MAPPING,
    "## Commands",
    "",
  ];

  // Top-level first (project flow + meta).
  if (topLevel.length > 0) {
    sections.push("### Top-level commands");
    sections.push("");
    for (const leaf of topLevel.sort((a, b) => a.pathSpace.localeCompare(b.pathSpace))) {
      sections.push(renderLeaf(leaf));
    }
  }

  // Then groups in a stable, intent-ordered sequence.
  const GROUP_ORDER = [
    "generate",
    "edit",
    "inspect",
    "audio",
    "remix",
    "scene",
    "timeline",
    "detect",
    "batch",
    "media",
  ];
  for (const groupName of GROUP_ORDER) {
    if (!groups[groupName]) continue;
    sections.push(renderGroup(groupName, groups[groupName]));
    delete groups[groupName];
  }
  // Anything left (future-proof if a new group lands without an entry above).
  for (const [groupName, leaves] of Object.entries(groups)) {
    sections.push(renderGroup(groupName, leaves));
  }

  return (
    sections
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  );
}

// ── Entrypoint ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const checkMode = args.includes("--check");

const fresh = await formatMarkdown(buildReference(), { parser: "markdown" });

if (checkMode) {
  const existing = existsSync(OUT_PATH) ? readFileSync(OUT_PATH, "utf-8") : "";
  if (existing.trim() === fresh.trim()) {
    console.log(`docs/cli-reference.md is up-to-date (${fresh.length} chars).`);
    process.exit(0);
  }
  console.error(
    "docs/cli-reference.md is out of date. Run `pnpm gen:reference` and commit the result."
  );
  // Print first divergent lines so CI logs surface the actual drift instead
  // of just "out of date". Cap output so we don't spam logs on big diffs.
  const existingLines = existing.split("\n");
  const freshLines = fresh.split("\n");
  const max = Math.max(existingLines.length, freshLines.length);
  let shown = 0;
  for (let i = 0; i < max && shown < 20; i++) {
    if (existingLines[i] !== freshLines[i]) {
      console.error(
        `L${i + 1}:\n  committed: ${JSON.stringify(existingLines[i] ?? "<EOF>")}\n  fresh:     ${JSON.stringify(freshLines[i] ?? "<EOF>")}`
      );
      shown++;
    }
  }
  console.error(`Sizes — committed: ${existing.length} chars, fresh: ${fresh.length} chars.`);
  process.exit(1);
}

writeFileSync(OUT_PATH, fresh);
console.log(`Wrote ${OUT_PATH} (${fresh.length} chars).`);
