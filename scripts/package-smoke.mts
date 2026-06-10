import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

async function smokeMcpCommand(
  label: string,
  command: string,
  args: string[],
  cwd: string,
  opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const child = spawn(command, args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: opts.env ?? process.env,
  });

  let buffer = "";
  let stderr = "";

  const result = await new Promise<{ toolCount: number; firstTools: string[]; instructions: string }>((resolvePromise, reject) => {
    let instructions = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error(
          `${label} did not answer tools/list within ${timeoutMs / 1000}s${stderr ? `\n${stderr}` : ""}`
        )
      );
    }, timeoutMs);

    function send(message: unknown): void {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        const message = JSON.parse(line) as {
          id?: number;
          result?: { instructions?: string; tools?: Array<{ name: string }> };
        };
        if (message.id === 1 && message.result) {
          instructions = message.result.instructions ?? "";
          send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
          send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        }
        if (message.id === 2 && message.result?.tools) {
          clearTimeout(timeout);
          resolvePromise({
            toolCount: message.result.tools.length,
            firstTools: message.result.tools.slice(0, 5).map((tool) => tool.name),
            instructions,
          });
          child.kill("SIGTERM");
        }
      }
    });

    child.on("exit", (code, signal) => {
      if (code === 0 || signal === "SIGTERM") return;
      clearTimeout(timeout);
      reject(new Error(`${label} exited before smoke completed: code=${code} signal=${signal}${stderr ? `\n${stderr}` : ""}`));
    });

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "vibeframe-package-smoke", version: "0.0.0" },
      },
    });
  });

  if (result.toolCount <= 0) throw new Error("MCP server returned no tools");
  const realCwd = await realpath(cwd).catch(() => cwd);
  const acceptedCwds = new Set([cwd, realCwd]);
  const hasExpectedCwd = [...acceptedCwds].some((expectedCwd) =>
    result.instructions.includes(`VibeFrame MCP workspace root: ${expectedCwd}`)
  );
  if (!hasExpectedCwd) {
    throw new Error(
      `${label} initialize instructions did not include cwd ${cwd}\nInstructions:\n${result.instructions}`
    );
  }
  if (!result.instructions.includes("Do not create projects in /tmp")) {
    throw new Error(`${label} initialize instructions did not include workspace path guard`);
  }
  console.log(`ok ${label} tools/list (${result.toolCount} tools; first: ${result.firstTools.join(", ")})`);
}

async function smokeMcpServer(absPath: string): Promise<void> {
  await smokeMcpCommand("mcp server", process.execPath, [absPath], root);
}

async function smokePackedMcpServer(pkgDir: string): Promise<void> {
  const tmp = await mkdtemp(join(tmpdir(), "vibeframe-mcp-pack-"));
  try {
    const tarballName = execFileSync(
      "npm",
      ["pack", pkgDir, "--pack-destination", tmp, "--silent"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
    ).trim().split(/\r?\n/).pop();
    if (!tarballName) throw new Error("npm pack returned no tarball name");
    const runCwd = join(tmp, "run");
    await mkdir(runCwd, { recursive: true });
    // npm exec installs the tarball (plus dependencies) before the server
    // can answer. kokoro-js is an optionalDependency dragging a ~300MB
    // native graph — omit optionals here both to keep the smoke fast and to
    // prove the server boots without them; give the install headroom anyway.
    await smokeMcpCommand(
      "packed mcp server",
      "npm",
      ["exec", "--yes", "--package", resolve(tmp, tarballName), "--", "vibeframe-mcp"],
      runCwd,
      { env: { ...process.env, npm_config_omit: "optional" }, timeoutMs: 60_000 }
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
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
await smokeMcpServer(resolve(mcpDir, "dist/index.js"));
await smokePackedMcpServer(mcpDir);

console.log("Package smoke checks passed.");
