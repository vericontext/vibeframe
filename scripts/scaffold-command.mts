/**
 * @file scripts/scaffold-command.mts
 * @description Generate a new CLI subcommand scaffold under
 * `packages/cli/src/commands/<group>/<name>.ts`. Creates the file with
 * a `register*Command` + `executeXxx` stub, and inserts a registration
 * line in the parent group file (`commands/<group>.ts`).
 *
 * Usage:
 *   pnpm scaffold:command <group> <name>
 *
 * Supported groups (post-v0.69 splits):
 *   - generate (output: packages/cli/src/commands/generate/<name>.ts,
 *               registered in commands/generate.ts)
 *   - edit     (output: packages/cli/src/commands/_shared/edit/<name>.ts,
 *               re-exported via commands/ai-edit.ts barrel)
 *
 * Example:
 *   pnpm scaffold:command generate my-feature
 *
 * The scaffold gives you:
 *   - schema scaffold (commander options)
 *   - executeXxx stub returning a typed Result
 *   - registerXxxCommand wrapping it for CLI use
 *
 * For a manifest-only entry (MCP/Agent without a CLI command), edit
 * `packages/cli/src/tools/manifest/<group>.ts` directly with
 * `defineTool({...})`.
 */

import { existsSync } from "node:fs";
import { writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const group = args[0];
const rawName = args[1];

const SUPPORTED_GROUPS = ["generate", "edit"];

if (!group || !rawName) {
  console.error("Usage: pnpm scaffold:command <group> <name>");
  console.error(`Supported groups: ${SUPPORTED_GROUPS.join(", ")}`);
  console.error("Example: pnpm scaffold:command generate my-feature");
  process.exit(2);
}

if (!SUPPORTED_GROUPS.includes(group)) {
  console.error(`Unsupported group "${group}".`);
  console.error(`Supported: ${SUPPORTED_GROUPS.join(", ")}`);
  process.exit(2);
}

if (!/^[a-z][a-z0-9-]*$/.test(rawName)) {
  console.error(
    `Invalid name "${rawName}". Use lowercase letters, digits, and hyphens (e.g. "my-feature").`,
  );
  process.exit(2);
}

const id = rawName;
// "my-feature" → "MyFeature"
const pascalName = rawName
  .split("-")
  .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
  .join("");
// "my-feature" → "myFeature"
const camelName = pascalName.charAt(0).toLowerCase() + pascalName.slice(1);

const repoRoot = resolve(import.meta.dirname, "..");

let outputFile: string;
let parentFile: string;
let parentInsertion: string;
let importInsertion: string;
let isShared = false;

if (group === "generate") {
  outputFile = resolve(
    repoRoot,
    `packages/cli/src/commands/generate/${id}.ts`,
  );
  parentFile = resolve(repoRoot, "packages/cli/src/commands/generate.ts");
  importInsertion = `import { register${pascalName}Command } from "./generate/${id}.js";\n`;
  parentInsertion = `\n// ============================================================================\n// ${pascalName} → commands/generate/${id}.ts (added via scaffold)\n// ============================================================================\n\nregister${pascalName}Command(generateCommand);\n`;
} else {
  // group === "edit"
  isShared = true;
  outputFile = resolve(
    repoRoot,
    `packages/cli/src/commands/_shared/edit/${id}.ts`,
  );
  parentFile = resolve(repoRoot, "packages/cli/src/commands/ai-edit.ts");
  importInsertion = "";
  parentInsertion = `\n// ${pascalName} (added via scaffold)\nexport { execute${pascalName} } from "./_shared/edit/${id}.js";\nexport type { ${pascalName}Options, ${pascalName}Result } from "./_shared/edit/${id}.js";\n`;
}

if (existsSync(outputFile)) {
  console.error(`File already exists: ${outputFile}`);
  process.exit(1);
}

// File source
const stubSource = isShared
  ? generateEditStub(pascalName, camelName, id)
  : generateGenerateStub(pascalName, camelName, id);

await writeFile(outputFile, stubSource, "utf-8");

// Parent file insertion
const parentContent = await readFile(parentFile, "utf-8");
let updatedParent = parentContent;
if (importInsertion && !parentContent.includes(importInsertion.trim())) {
  // Insert import after the last existing import line.
  const lines = parentContent.split("\n");
  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^import\s/.test(lines[i])) lastImportIdx = i;
  }
  if (lastImportIdx >= 0) {
    lines.splice(lastImportIdx + 1, 0, importInsertion.trim());
    updatedParent = lines.join("\n");
  }
}
if (!updatedParent.includes(parentInsertion.trim())) {
  updatedParent += parentInsertion;
}
await writeFile(parentFile, updatedParent, "utf-8");

console.log(`✓ Created ${outputFile}`);
console.log(`  - register${pascalName}Command + execute${pascalName} stubs`);
console.log(`✓ Updated ${parentFile}`);
console.log("");
console.log("Next steps:");
console.log(`  1. Edit ${outputFile}`);
console.log(`     to implement the command logic.`);
console.log(`  2. Run \`pnpm -F @vibeframe/cli build\` to verify.`);
console.log(`  3. Try it out:`);
if (group === "generate") {
  console.log(`       node packages/cli/dist/index.js generate ${id} --help`);
} else {
  console.log(`       (edit subcommands are wired through edit-cmd.ts;`);
  console.log(`        register the new ${pascalName} via registerEditCommands)`);
}
console.log("");
console.log("To add a manifest entry (for MCP/Agent surfaces), edit");
console.log(`packages/cli/src/tools/manifest/${group}.ts and call`);
console.log(`defineTool({ name: "${group}_${id.replace(/-/g, "_")}", ... }).`);

// ── Stub generators ───────────────────────────────────────────────────────

function generateGenerateStub(
  Pascal: string,
  camel: string,
  fileId: string,
): string {
  void camel;
  return `/**
 * @module generate/${fileId}
 * @description \`vibe generate ${fileId}\` — TODO describe what this command does.
 * Generated by \`pnpm scaffold:command generate ${fileId}\`.
 */

import type { Command } from "commander";
import { isJsonMode, outputResult, exitWithError, apiError } from "../output.js";

// ── Library: execute${Pascal} (used by manifest / pipeline) ───────────

export interface ${Pascal}Options {
  // TODO: define option fields
  /** Example required prompt argument. */
  prompt: string;
  /** Optional output path. */
  output?: string;
}

export interface ${Pascal}Result {
  success: boolean;
  outputPath?: string;
  error?: string;
}

export async function execute${Pascal}(
  options: ${Pascal}Options,
): Promise<${Pascal}Result> {
  try {
    // TODO: implement the actual logic. Return { success: true, ... } on
    // happy path, or { success: false, error: "..." } on failure.
    void options;
    return { success: false, error: "Not implemented" };
  } catch (error) {
    return {
      success: false,
      error: \`${Pascal} failed: \${error instanceof Error ? error.message : String(error)}\`,
    };
  }
}

// ── CLI: vibe generate ${fileId} ──────────────────────────────────────

export function register${Pascal}Command(parent: Command): void {
  parent
    .command("${fileId}")
    .description("TODO short description shown in \`vibe generate --help\`")
    .argument("<prompt>", "TODO describe the required argument")
    .option("-o, --output <path>", "Output file path")
    .option("--dry-run", "Preview parameters without executing")
    .action(async (prompt: string, options) => {
      try {
        if (options.dryRun) {
          outputResult({
            dryRun: true,
            command: "generate ${fileId}",
            params: { prompt, output: options.output },
          });
          return;
        }

        const result = await execute${Pascal}({ prompt, output: options.output });

        if (!result.success) {
          exitWithError(apiError(result.error ?? "${Pascal} failed", true));
        }

        if (isJsonMode()) {
          outputResult({ success: true, outputPath: result.outputPath });
          return;
        }

        console.log(\`✓ ${Pascal} done. Output: \${result.outputPath ?? "(none)"}\`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        exitWithError(apiError(\`${Pascal} failed: \${msg}\`, true));
      }
    });
}
`;
}

function generateEditStub(
  Pascal: string,
  camel: string,
  fileId: string,
): string {
  void camel;
  return `/**
 * @module _shared/edit/${fileId}
 * @description \`execute${Pascal}\` — TODO describe what this edit operation does.
 * Generated by \`pnpm scaffold:command edit ${fileId}\`.
 *
 * After editing, re-export from \`commands/ai-edit.ts\` barrel and wire
 * the CLI subcommand registration in \`commands/ai-edit-cli.ts\` if needed.
 */

import { existsSync } from "node:fs";
import { execSafe, commandExists } from "../../../utils/exec-safe.js";

export interface ${Pascal}Options {
  /** Path to the input video/audio file */
  inputPath: string;
  /** Path for the output file */
  outputPath: string;
  // TODO: add more option fields
}

export interface ${Pascal}Result {
  success: boolean;
  outputPath?: string;
  error?: string;
}

export async function execute${Pascal}(
  options: ${Pascal}Options,
): Promise<${Pascal}Result> {
  const { inputPath, outputPath } = options;

  if (!existsSync(inputPath)) {
    return { success: false, error: \`Input not found: \${inputPath}\` };
  }

  if (!commandExists("ffmpeg")) {
    return {
      success: false,
      error:
        "FFmpeg not found. Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux). Run \`vibe doctor\` for details.",
    };
  }

  try {
    // TODO: implement the actual logic, e.g.:
    // await execSafe("ffmpeg", ["-i", inputPath, ...filters, outputPath, "-y"], { ... });
    void execSafe;
    return { success: false, error: "Not implemented" };
  } catch (error) {
    return {
      success: false,
      error: \`${Pascal} failed: \${error instanceof Error ? error.message : String(error)}\`,
    };
  }
}
`;
}
