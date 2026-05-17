import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface PackFile {
  path: string;
}

interface PackResult {
  name: string;
  version: string;
  files: PackFile[];
}

function packDryRun(pkgDir: string): PackResult {
  const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: pkgDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const parsed = JSON.parse(raw) as PackResult[];
  if (!parsed[0]) throw new Error(`npm pack returned no result for ${pkgDir}`);
  return parsed[0];
}

function assertPackFiles(result: PackResult, required: string[]): void {
  const packed = new Set(result.files.map((file) => file.path));
  const missing = required.filter((file) => !packed.has(file));
  if (missing.length > 0) {
    throw new Error(`${result.name} pack is missing required files: ${missing.join(", ")}`);
  }
}

function assertExportTargets(pkgDir: string): void {
  const pkg = JSON.parse(readFileSync(resolve(pkgDir, "package.json"), "utf8")) as {
    exports?: Record<string, string | { import?: string; types?: string }>;
  };
  for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
    if (typeof target === "string") {
      const abs = resolve(pkgDir, target);
      if (!existsSync(abs)) throw new Error(`${subpath} export target does not exist: ${target}`);
      continue;
    }
    for (const key of ["import", "types"] as const) {
      const value = target[key];
      if (!value) continue;
      const abs = resolve(pkgDir, value);
      if (!existsSync(abs)) {
        throw new Error(`${subpath}.${key} export target does not exist: ${value}`);
      }
    }
  }
}

async function smokeImport(label: string, absPath: string): Promise<void> {
  await import(pathToFileURL(absPath).href);
  console.log(`ok import ${label}`);
}

const cliDir = resolve(root, "packages/cli");
const mcpDir = resolve(root, "packages/mcp-server");

assertPackFiles(packDryRun(cliDir), [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/engine/index.js",
  "dist/engine/index.d.ts",
  "dist/tools/manifest/index.js",
  "dist/tools/manifest/index.d.ts",
  "dist/tools/define-tool.js",
  "dist/tools/define-tool.d.ts",
  "dist/tools/adapters/mcp.js",
  "dist/tools/adapters/mcp.d.ts",
  "dist/tools/adapters/agent.js",
  "dist/tools/adapters/agent.d.ts",
  "package.json",
]);
assertExportTargets(cliDir);

assertPackFiles(packDryRun(mcpDir), ["dist/index.js", "package.json"]);
assertExportTargets(mcpDir);

await smokeImport("@vibeframe/cli/engine", resolve(cliDir, "dist/engine/index.js"));
await smokeImport("@vibeframe/cli/tools/manifest", resolve(cliDir, "dist/tools/manifest/index.js"));
await smokeImport("@vibeframe/cli/tools/define-tool", resolve(cliDir, "dist/tools/define-tool.js"));
await smokeImport(
  "@vibeframe/cli/tools/adapters/mcp",
  resolve(cliDir, "dist/tools/adapters/mcp.js")
);
await smokeImport(
  "@vibeframe/cli/tools/adapters/agent",
  resolve(cliDir, "dist/tools/adapters/agent.js")
);

console.log("Package smoke checks passed.");
