import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hostDefinitions, planHostSetup, renderHostSnippet } from "./host-integration.js";

let projectDir: string;
let originalHome: string | undefined;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "vibe-host-integration-"));
  originalHome = process.env.HOME;
  process.env.HOME = projectDir;
});

afterEach(async () => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  await rm(projectDir, { recursive: true, force: true });
});

function host(id: string) {
  const match = hostDefinitions(projectDir).find((h) => h.id === id);
  if (!match) throw new Error(`missing host ${id}`);
  return match;
}

describe("host integration helpers", () => {
  it("renders a Codex TOML MCP snippet", () => {
    expect(renderHostSnippet(host("codex"), projectDir)).toContain("[mcp_servers.vibeframe]");
    expect(renderHostSnippet(host("codex"), projectDir)).toContain("@vibeframe/mcp-server");
  });

  it("renders a JSON MCP snippet for Cursor", () => {
    const snippet = JSON.parse(renderHostSnippet(host("cursor"), projectDir));
    expect(snippet.mcpServers.vibeframe.command).toBe("npx");
    expect(snippet.mcpServers.vibeframe.args).toEqual(["-y", "@vibeframe/mcp-server"]);
    expect(snippet.mcpServers.vibeframe.cwd).toBeUndefined();
  });

  it("renders Claude Desktop config with a workspace-anchored wrapper", () => {
    const snippet = JSON.parse(renderHostSnippet(host("claude-desktop"), projectDir));
    expect(snippet.mcpServers.vibeframe.command).toBe("bash");
    expect(snippet.mcpServers.vibeframe.args).toEqual([
      "-lc",
      `cd '${projectDir}' && exec npx -y @vibeframe/mcp-server`,
    ]);
  });

  it("snippet mode does not write files", async () => {
    const plan = await planHostSetup(host("cursor"), projectDir, { write: false });
    expect(plan.files.some((file) => file.status === "would-write")).toBe(true);
    expect(existsSync(join(projectDir, ".cursor", "mcp.json"))).toBe(false);
  });

  it("writes Cursor MCP config while preserving other servers", async () => {
    const configPath = join(projectDir, ".cursor", "mcp.json");
    await mkdir(join(projectDir, ".cursor"), { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { existing: { command: "node", args: ["server.js"] } } }),
      "utf-8"
    );

    const plan = await planHostSetup(host("cursor"), projectDir, { write: true });
    const json = JSON.parse(await readFile(configPath, "utf-8"));

    expect(plan.files.find((file) => file.path === configPath)?.status).toBe("merged");
    expect(json.mcpServers.existing.command).toBe("node");
    expect(json.mcpServers.vibeframe.args).toEqual(["-y", "@vibeframe/mcp-server"]);
  });

  it("does not replace an existing MCP entry without --force", async () => {
    const configPath = join(projectDir, ".cursor", "mcp.json");
    await mkdir(join(projectDir, ".cursor"), { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { vibeframe: { command: "custom", args: [] } } }),
      "utf-8"
    );

    const plan = await planHostSetup(host("cursor"), projectDir, { write: true });
    const json = JSON.parse(await readFile(configPath, "utf-8"));

    expect(plan.files.find((file) => file.path === configPath)?.status).toBe("skipped-exists");
    expect(json.mcpServers.vibeframe.command).toBe("custom");
  });

  it("upgrades the default Claude Desktop server to a workspace-anchored wrapper", async () => {
    const configPath = host("claude-desktop").configPath(projectDir);
    await mkdir(join(configPath, ".."), { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          existing: { command: "node", args: ["server.js"] },
          vibeframe: { command: "npx", args: ["-y", "@vibeframe/mcp-server"] },
        },
      }),
      "utf-8"
    );

    const plan = await planHostSetup(host("claude-desktop"), projectDir, { write: true });
    const json = JSON.parse(await readFile(configPath, "utf-8"));

    expect(plan.files.find((file) => file.path === configPath)?.status).toBe("merged");
    expect(json.mcpServers.existing.command).toBe("node");
    expect(json.mcpServers.vibeframe.command).toBe("bash");
    expect(json.mcpServers.vibeframe.args).toEqual([
      "-lc",
      `cd '${projectDir}' && exec npx -y @vibeframe/mcp-server`,
    ]);
  });

  it("does not replace a custom Claude Desktop server without --force", async () => {
    const configPath = host("claude-desktop").configPath(projectDir);
    await mkdir(join(configPath, ".."), { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { vibeframe: { command: "custom", args: [] } } }),
      "utf-8"
    );

    const plan = await planHostSetup(host("claude-desktop"), projectDir, { write: true });
    const json = JSON.parse(await readFile(configPath, "utf-8"));

    expect(plan.files.find((file) => file.path === configPath)?.status).toBe("skipped-exists");
    expect(json.mcpServers.vibeframe.command).toBe("custom");
  });

  it("creates and updates a Codex managed block", async () => {
    const configPath = join(projectDir, ".codex", "config.toml");
    await planHostSetup(host("codex"), projectDir, { write: true });
    let toml = await readFile(configPath, "utf-8");

    expect(toml).toContain("# >>> VibeFrame MCP server >>>");
    expect(toml).toContain("[mcp_servers.vibeframe]");

    await planHostSetup(host("codex"), projectDir, { write: true });
    toml = await readFile(configPath, "utf-8");
    expect(toml.match(/\[mcp_servers\.vibeframe\]/g)).toHaveLength(1);
  });

  it("preserves existing Codex settings when appending MCP config", async () => {
    const configPath = join(projectDir, ".codex", "config.toml");
    await mkdir(join(projectDir, ".codex"), { recursive: true });
    await writeFile(configPath, "project_doc_max_bytes = 65536\n", "utf-8");

    await planHostSetup(host("codex"), projectDir, { write: true });
    const toml = await readFile(configPath, "utf-8");

    expect(toml).toContain("project_doc_max_bytes = 65536");
    expect(toml).toContain("[mcp_servers.vibeframe]");
  });
});
