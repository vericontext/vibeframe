/**
 * @module _shared/host-integration
 *
 * Host-app integration helpers for Codex, Claude, and Cursor.
 * Default UX is snippet-first: print exactly what to paste, and only write
 * files when the user passes an explicit --write flag.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type HostSetupId = "codex" | "claude-code" | "claude-desktop" | "cursor";
export type HostSelection = HostSetupId | "claude" | "all";

export const HOST_SELECTIONS: readonly HostSelection[] = [
  "codex",
  "claude",
  "claude-code",
  "claude-desktop",
  "cursor",
  "all",
];

export interface HostDefinition {
  id: HostSetupId;
  label: string;
  surfaces: Array<"shell" | "project-guidance" | "mcp">;
  guidanceFiles: string[];
  configPath: (projectDir: string) => string;
  configKind: "codex-toml" | "mcp-json";
  notes: string[];
}

export interface HostFileAction {
  path: string;
  status: "would-write" | "wrote" | "would-merge" | "merged" | "skipped-exists" | "missing";
  reason?: string;
}

export interface HostSetupPlan {
  host: HostDefinition;
  snippet: string;
  command?: string;
  configPath: string;
  files: HostFileAction[];
  warnings: string[];
  nextSteps: string[];
}

export interface HostDoctorResult {
  host: HostDefinition;
  configPath: string;
  configured: boolean;
  guidanceFiles: HostFileAction[];
  warnings: string[];
  nextSteps: string[];
}

interface McpServerJson {
  command: string;
  args: string[];
}

const VIBEFRAME_MCP_JSON: McpServerJson = {
  command: "npx",
  args: ["-y", "@vibeframe/mcp-server"],
};

const CODEX_MCP_BLOCK = `[mcp_servers.vibeframe]
command = "npx"
args = ["-y", "@vibeframe/mcp-server"]
enabled = true
`;

const CODEX_MANAGED_START = "# >>> VibeFrame MCP server >>>";
const CODEX_MANAGED_END = "# <<< VibeFrame MCP server <<<";

export function hostDefinitions(_projectDir = process.cwd()): HostDefinition[] {
  return [
    {
      id: "codex",
      label: "OpenAI Codex",
      surfaces: ["shell", "project-guidance", "mcp"],
      guidanceFiles: ["AGENTS.md"],
      configPath: (dir: string) => join(resolve(dir), ".codex", "config.toml"),
      configKind: "codex-toml",
      notes: [
        "Codex reads AGENTS.md and can also load project-scoped .codex/config.toml after the project is trusted.",
        "Keep provider/auth keys in VibeFrame config or environment, not in project-local Codex config.",
      ],
    },
    {
      id: "claude-code",
      label: "Claude Code",
      surfaces: ["shell", "project-guidance", "mcp"],
      guidanceFiles: ["AGENTS.md", "CLAUDE.md", ".claude/skills/hyperframes/"],
      configPath: (dir: string) => join(resolve(dir), ".mcp.json"),
      configKind: "mcp-json",
      notes: [
        "Claude Code can drive vibe directly through shell plus AGENTS.md/CLAUDE.md.",
        "The MCP entry is optional and gives Claude Code a typed tool surface.",
      ],
    },
    {
      id: "claude-desktop",
      label: "Claude Desktop",
      surfaces: ["mcp"],
      guidanceFiles: [],
      configPath: (_dir: string) => claudeDesktopConfigPath(),
      configKind: "mcp-json",
      notes: [
        "Claude Desktop uses MCP config rather than project shell commands.",
        "With --write, VibeFrame backs up the existing config before merging.",
      ],
    },
    {
      id: "cursor",
      label: "Cursor",
      surfaces: ["shell", "project-guidance", "mcp"],
      guidanceFiles: ["AGENTS.md", ".cursor/rules/hyperframes.mdc"],
      configPath: (dir: string) => join(resolve(dir), ".cursor", "mcp.json"),
      configKind: "mcp-json",
      notes: [
        "Cursor can use AGENTS.md/rules for shell-driven work and .cursor/mcp.json for typed MCP tools.",
      ],
    },
  ];
}

export function resolveHostSelection(selection: HostSelection): HostSetupId[] {
  if (selection === "all") return ["codex", "claude-code", "claude-desktop", "cursor"];
  if (selection === "claude") return ["claude-code", "claude-desktop"];
  return [selection];
}

function vibeframeMcpJson(host: HostDefinition, projectDir: string): McpServerJson {
  if (host.id !== "claude-desktop") return { ...VIBEFRAME_MCP_JSON };

  const workspace = resolve(projectDir);
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", `cd /d ${cmdQuote(workspace)} && npx -y @vibeframe/mcp-server`],
    };
  }

  return {
    command: "bash",
    args: ["-lc", `cd ${shellQuote(workspace)} && exec npx -y @vibeframe/mcp-server`],
  };
}

export function renderHostSnippet(host: HostDefinition, projectDir: string): string {
  if (host.configKind === "codex-toml") return CODEX_MCP_BLOCK.trimEnd();
  return JSON.stringify({ mcpServers: { vibeframe: vibeframeMcpJson(host, projectDir) } }, null, 2);
}

export function claudeCodeAddCommand(): string {
  return "claude mcp add vibeframe --scope project -- npx -y @vibeframe/mcp-server";
}

export async function planHostSetup(
  host: HostDefinition,
  projectDir: string,
  opts: { write?: boolean; dryRun?: boolean; force?: boolean }
): Promise<HostSetupPlan> {
  const configPath = host.configPath(projectDir);
  const snippet = renderHostSnippet(host, projectDir);
  const files: HostFileAction[] = [];
  const warnings: string[] = [];
  const nextSteps = hostNextSteps(host);

  for (const relPath of host.guidanceFiles.filter((p) => !p.endsWith("/"))) {
    const absPath = join(resolve(projectDir), relPath);
    files.push({
      path: absPath,
      status: existsSync(absPath) ? "skipped-exists" : "missing",
      reason: existsSync(absPath) ? "already present" : "run vibe init --agent all first",
    });
  }

  if (!opts.write || opts.dryRun) {
    files.push({
      path: configPath,
      status: opts.write ? "would-merge" : "would-write",
      reason: opts.write ? "dry run" : "snippet only; pass --write to modify",
    });
    return { host, snippet, command: host.id === "claude-code" ? claudeCodeAddCommand() : undefined, configPath, files, warnings, nextSteps };
  }

  try {
    const action =
      host.configKind === "codex-toml"
        ? await mergeCodexToml(configPath, { force: opts.force === true })
        : await mergeMcpJson(configPath, {
            server: vibeframeMcpJson(host, projectDir),
            force: opts.force === true,
            backup: host.id === "claude-desktop",
          });
    files.push(action);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
  }

  return { host, snippet, command: host.id === "claude-code" ? claudeCodeAddCommand() : undefined, configPath, files, warnings, nextSteps };
}

export async function inspectHost(host: HostDefinition, projectDir: string): Promise<HostDoctorResult> {
  const configPath = host.configPath(projectDir);
  const warnings: string[] = [];
  const nextSteps = hostNextSteps(host);
  const guidanceFiles = host.guidanceFiles.map((relPath) => {
    const absPath = relPath.endsWith("/")
      ? join(resolve(projectDir), relPath)
      : join(resolve(projectDir), relPath);
    return {
      path: absPath,
      status: existsSync(absPath) ? "skipped-exists" : "missing",
      reason: existsSync(absPath) ? "present" : "missing",
    } satisfies HostFileAction;
  });

  let configured = false;
  if (existsSync(configPath)) {
    try {
      const content = await readFile(configPath, "utf-8");
      if (host.configKind === "codex-toml") {
        configured = /\[mcp_servers\.vibeframe\]/.test(content);
      } else {
        const json = JSON.parse(content);
        configured = hasVibeframeMcpServer(json);
        const server = readVibeframeMcpServer(json);
        if (host.id === "claude-desktop" && configured && !isAnchoredClaudeDesktopServer(server)) {
          warnings.push(
            "Claude Desktop vibeframe MCP config is not workspace-anchored; run `vibe host setup claude-desktop <workspace> --write` to anchor relative paths."
          );
        }
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { host, configPath, configured, guidanceFiles, warnings, nextSteps };
}

async function mergeMcpJson(
  configPath: string,
  opts: { server: McpServerJson; force: boolean; backup: boolean }
): Promise<HostFileAction> {
  let root: Record<string, unknown> = {};
  const exists = existsSync(configPath);
  if (exists) {
    const raw = await readFile(configPath, "utf-8");
    try {
      root = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch (error) {
      throw new Error(`Invalid JSON in ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const mcpServers =
    typeof root.mcpServers === "object" && root.mcpServers !== null && !Array.isArray(root.mcpServers)
      ? (root.mcpServers as Record<string, unknown>)
      : {};

  if (mcpServers.vibeframe && !opts.force) {
    const existing = mcpServers.vibeframe;
    if (canUpgradeDefaultServer(existing, opts.server)) {
      root.mcpServers = {
        ...mcpServers,
        vibeframe: opts.server,
      };
      await mkdir(dirname(configPath), { recursive: true });
      if (exists && opts.backup) {
        await writeFile(`${configPath}.bak-${timestamp()}`, await readFile(configPath, "utf-8"), "utf-8");
      }
      await writeFile(configPath, JSON.stringify(root, null, 2) + "\n", "utf-8");
      return { path: configPath, status: "merged", reason: "anchored existing default vibeframe MCP server" };
    }
    return {
      path: configPath,
      status: "skipped-exists",
      reason: "vibeframe MCP server already exists; pass --force to replace",
    };
  }

  root.mcpServers = { ...mcpServers, vibeframe: opts.server };
  await mkdir(dirname(configPath), { recursive: true });
  if (exists && opts.backup) {
    await writeFile(`${configPath}.bak-${timestamp()}`, await readFile(configPath, "utf-8"), "utf-8");
  }
  await writeFile(configPath, JSON.stringify(root, null, 2) + "\n", "utf-8");
  return { path: configPath, status: exists ? "merged" : "wrote" };
}

async function mergeCodexToml(configPath: string, opts: { force: boolean }): Promise<HostFileAction> {
  const exists = existsSync(configPath);
  const block = `${CODEX_MANAGED_START}\n${CODEX_MCP_BLOCK}${CODEX_MANAGED_END}`;
  if (!exists) {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, `#:schema https://developers.openai.com/codex/config-schema.json\n\n${block}\n`, "utf-8");
    return { path: configPath, status: "wrote" };
  }

  const raw = await readFile(configPath, "utf-8");
  if (raw.includes(CODEX_MANAGED_START)) {
    const updated = raw.replace(
      new RegExp(`${escapeRegExp(CODEX_MANAGED_START)}[\\s\\S]*?${escapeRegExp(CODEX_MANAGED_END)}`),
      block
    );
    await writeFile(configPath, ensureTrailingNewline(updated), "utf-8");
    return { path: configPath, status: "merged", reason: "updated managed VibeFrame block" };
  }

  if (/\[mcp_servers\.vibeframe\]/.test(raw)) {
    if (!opts.force) {
      return {
        path: configPath,
        status: "skipped-exists",
        reason: "vibeframe MCP table already exists; pass --force to replace",
      };
    }
    const updated = raw.replace(/\n?\[mcp_servers\.vibeframe\][\s\S]*?(?=\n\[|$)/, `\n${block}\n`);
    await writeFile(configPath, ensureTrailingNewline(updated), "utf-8");
    return { path: configPath, status: "merged", reason: "replaced existing VibeFrame MCP table" };
  }

  await writeFile(configPath, `${ensureTrailingNewline(raw)}\n${block}\n`, "utf-8");
  return { path: configPath, status: "merged" };
}

function hasVibeframeMcpServer(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const root = value as { mcpServers?: unknown };
  if (!root.mcpServers || typeof root.mcpServers !== "object") return false;
  return Object.prototype.hasOwnProperty.call(root.mcpServers, "vibeframe");
}

function readVibeframeMcpServer(value: unknown): (McpServerJson & Record<string, unknown>) | null {
  if (!value || typeof value !== "object") return null;
  const root = value as { mcpServers?: unknown };
  if (!root.mcpServers || typeof root.mcpServers !== "object" || Array.isArray(root.mcpServers)) return null;
  const server = (root.mcpServers as Record<string, unknown>).vibeframe;
  if (!server || typeof server !== "object" || Array.isArray(server)) return null;
  return server as McpServerJson & Record<string, unknown>;
}

function isAnchoredClaudeDesktopServer(server: (McpServerJson & Record<string, unknown>) | null): boolean {
  if (!server) return false;
  if (server.command === "bash" && Array.isArray(server.args)) {
    return server.args[0] === "-lc" && typeof server.args[1] === "string" && server.args[1].includes("exec npx -y @vibeframe/mcp-server");
  }
  if (server.command === "cmd.exe" && Array.isArray(server.args)) {
    return server.args.some((arg) => typeof arg === "string" && arg.includes("npx -y @vibeframe/mcp-server"));
  }
  return false;
}

function canUpgradeDefaultServer(existing: unknown, target: McpServerJson): boolean {
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) return false;
  const current = existing as Record<string, unknown>;
  if (!Array.isArray(current.args)) return false;
  if (current.command === target.command && JSON.stringify(current.args) === JSON.stringify(target.args)) {
    return false;
  }
  return current.command === VIBEFRAME_MCP_JSON.command && JSON.stringify(current.args) === JSON.stringify(VIBEFRAME_MCP_JSON.args);
}

function hostNextSteps(host: HostDefinition): string[] {
  if (host.id === "codex") {
    return [
      "Trust the project in Codex so .codex/config.toml is loaded.",
      "Run /mcp in Codex to confirm the vibeframe server is connected.",
    ];
  }
  if (host.id === "claude-code") {
    return [
      "Restart Claude Code or run /mcp to approve the project-scoped server.",
      "Use AGENTS.md/CLAUDE.md for shell-driven vibe workflows.",
    ];
  }
  if (host.id === "claude-desktop") {
    return ["Restart Claude Desktop after updating its MCP config."];
  }
  return ["Restart Cursor or reload MCP servers, then ask Cursor to use the vibeframe MCP tools."];
}

function claudeDesktopConfigPath(): string {
  const home = homedir();
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  }
  return join(home, ".config", "Claude", "claude_desktop_config.json");
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function cmdQuote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
