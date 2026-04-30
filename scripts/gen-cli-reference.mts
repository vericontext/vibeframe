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
machine-readable access use \`vibe schema --list --json\` and
\`vibe schema <command> --json\` directly.
`;

const MENTAL_MODEL = `## Mental model

The **project** is the implicit area. Bare top-level commands act on the
current project; grouped commands handle resources or one-shot
operations.

\`\`\`
init → build → render          ← 90% users start here  (Tier 1)
gen / edit / inspect / remix    ← one-shot media tools  (Tier 2)
scene / timeline                ← lower-level authoring (Tier 3)
run / agent / schema / context  ← automation + agents   (Tier 4)
\`\`\`
`;

const GLOBAL_FLAGS = `## Global flags

Work with any command:

| Flag | Effect |
|---|---|
| \`-V, --version\` | Print version and exit |
| \`-h, --help\` | Print help for the command and exit |
| \`--json\` | Output JSON (auto-enabled when stdout is piped) |
| \`--fields <list>\` | Limit JSON output fields (e.g. \`--fields "path,duration"\`) |
| \`-q, --quiet\` | Output only the result value (path / URL / ID) |
| \`--stdin\` | Read options from stdin as JSON (agent / script use) |
| \`--describe\` | Print the command's JSON Schema and exit (no execution) |
| \`--dry-run\` | Preview parameters without executing (most commands) |
`;

const SHORT_FLAG_TABLE = `## Standard short flags (per-command, dominant meaning only)

After the v0.78 dedup, each one-letter flag has a single canonical
meaning. Non-dominant uses are long-only.

| Short | Long | Uses |
|---|---|---|
| \`-o\` | \`--output\` | 40 |
| \`-k\` | \`--api-key\` | 31 |
| \`-d\` | \`--duration\` | 19 |
| \`-m\` | \`--model\` | 11 |
| \`-p\` | \`--provider\` | 10 |
| \`-r\` | \`--ratio\` | 9 |
| \`-l\` | \`--language\` | 9 |
| \`-a\` | \`--aspect\` | 5 |
| \`-v\` | \`--verbose\` | 3 |
| \`-i\` | \`--image\` / \`--input\` | 3 |
| \`-c\` | \`--confirm\` | 1 |

Flags without a short form (\`--style\`, \`--name\`, \`--size\`, \`--count\`,
\`--mode\`, \`--text\`, \`--fps\`, etc.) had no dominant meaning across the
surface and were collapsed to long-only.
`;

const COST_TIERS = `## Cost tiers

| Tier | Commands | Per-call cost |
|---|---|---|
| **Free** | \`detect *\` · \`edit silence-cut/fade/noise-reduce/text-overlay/interpolate\` · \`timeline *\` · \`scene lint\` / \`list-styles\` · \`audio duck\` | $0 |
| **Low** | \`inspect *\` · \`audio transcribe\` / \`list-voices\` · \`generate image\` | ~$0.01–0.10 |
| **High** | \`generate video\` · \`edit image\` · \`edit grade\` / \`reframe\` / \`speed-ramp\` (Claude analysis) | ~$1–5 |
| **Very High** | \`remix highlights\` / \`auto-shorts\` / \`regenerate-scene\` · \`vibe build\` (full pipeline) | ~$5–50+ |

> **Tip:** Run \`<paid command> --dry-run --json\` first — the response
> includes a \`costUsd\` estimate without spending a cent.
`;

const ENVELOPE = `## JSON envelope

### Success

\`\`\`json
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
  "code": "USAGE_ERROR | NOT_FOUND | API_ERROR | NETWORK_ERROR | AUTH_ERROR | ERROR",
  "exitCode": 0 | 1 | 2 | 3 | 4 | 5 | 6,
  "suggestion": "<actionable next step>",
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

\`@vibeframe/mcp-server\` exposes the same operations as MCP tools:

\`\`\`
Rule 1.  vibe <group> <leaf>   →  <group>_<leaf>      (snake_case)
         e.g. vibe edit silence-cut → edit_silence_cut

Rule 2.  vibe <bare-name>      →  <bare-name>
         e.g. vibe init / build / render / run → init / build / render / run

Rule 3.  CLI-only (not exposed via MCP):
         setup, doctor, demo, agent, schema, context, walkthrough

Rule 4.  MCP-only agent tools (engine direct access):
         fs_*, media_*, project_open / project_save
\`\`\`
`;

// ── Render command catalog ────────────────────────────────────────────────────

interface RenderedLeaf {
  pathDots: string;        // e.g. "edit.silence-cut"
  pathSpace: string;       // e.g. "edit silence-cut"
  description: string;
  parameters: Record<string, ParameterSchema>;
  required: string[];
}

function renderArg(name: string, schema: ParameterSchema, isRequired: boolean): string {
  const desc = schema.description ?? "";
  const enums = schema.enum ? ` *(${schema.enum.join(" \\| ")})*` : "";
  const def = schema.default !== undefined ? ` *(default: \`${JSON.stringify(schema.default)}\`)*` : "";
  const requiredMark = isRequired ? " **required**" : "";
  return `- \`${name}\` *(${schema.type ?? "any"})*${requiredMark}${enums}${def} — ${desc}`;
}

function renderLeaf(leaf: RenderedLeaf): string {
  const lines: string[] = [];
  lines.push(`#### \`vibe ${leaf.pathSpace}\``);
  lines.push("");
  lines.push(leaf.description);
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
  lines.push("");
  return lines.join("\n");
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
    SHORT_FLAG_TABLE,
    COST_TIERS,
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
    "generate", "edit", "inspect", "audio", "remix",
    "project", "scene", "timeline", "detect", "batch", "media",
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

  return sections.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ── Entrypoint ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const checkMode = args.includes("--check");

const fresh = buildReference();

if (checkMode) {
  const existing = existsSync(OUT_PATH) ? readFileSync(OUT_PATH, "utf-8") : "";
  if (existing.trim() === fresh.trim()) {
    console.log(`docs/cli-reference.md is up-to-date (${fresh.length} chars).`);
    process.exit(0);
  }
  console.error("docs/cli-reference.md is out of date. Run `pnpm gen:reference` and commit the result.");
  process.exit(1);
}

writeFileSync(OUT_PATH, fresh);
console.log(`Wrote ${OUT_PATH} (${fresh.length} chars).`);
