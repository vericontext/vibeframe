import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Need to mock os.homedir() before the module loads — set up the mock
// here, then dynamic-import the module fresh per test.
let HOME: string;
let PATH_DIR: string;

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => HOME,
  };
});

import { detectAgentHosts, detectedAgentHosts, summariseAgentHosts } from "./agent-host-detect.js";

beforeEach(() => {
  HOME = mkdtempSync(join(tmpdir(), "vibe-agent-host-home-"));
  PATH_DIR = mkdtempSync(join(tmpdir(), "vibe-agent-host-path-"));
});

afterEach(() => {
  rmSync(HOME, { recursive: true, force: true });
  rmSync(PATH_DIR, { recursive: true, force: true });
  vi.clearAllMocks();
});

function makeBinary(name: string): void {
  const path = join(PATH_DIR, name);
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o755);
}

function makeConfigDir(rel: string): void {
  mkdirSync(join(HOME, rel), { recursive: true });
}

describe("detectAgentHosts", () => {
  it("returns all 4 hosts with detected=false in a clean environment", () => {
    const hosts = detectAgentHosts({ PATH: PATH_DIR });
    expect(hosts).toHaveLength(4);
    for (const h of hosts) {
      expect(h.detected).toBe(false);
      expect(h.signals).toEqual([]);
    }
    expect(hosts.map((h) => h.id)).toEqual([
      "claude-code",
      "codex",
      "cursor",
      "aider",
    ]);
  });

  it("detects Claude Code via binary on PATH", () => {
    makeBinary("claude");
    const hosts = detectAgentHosts({ PATH: PATH_DIR });
    const claude = hosts.find((h) => h.id === "claude-code")!;
    expect(claude.detected).toBe(true);
    expect(claude.signals).toEqual([{ kind: "binary", name: "claude" }]);
  });

  it("detects Claude Code via ~/.claude config dir even when binary is missing", () => {
    makeConfigDir(".claude");
    const hosts = detectAgentHosts({ PATH: PATH_DIR });
    const claude = hosts.find((h) => h.id === "claude-code")!;
    expect(claude.detected).toBe(true);
    expect(claude.signals).toEqual([
      { kind: "configDir", path: join(HOME, ".claude") },
    ]);
  });

  it("emits both signals when binary AND config dir are present", () => {
    makeBinary("claude");
    makeConfigDir(".claude");
    const hosts = detectAgentHosts({ PATH: PATH_DIR });
    const claude = hosts.find((h) => h.id === "claude-code")!;
    expect(claude.signals).toHaveLength(2);
    expect(claude.signals.map((s) => s.kind).sort()).toEqual(["binary", "configDir"]);
  });

  it("detects Codex via .codex config dir", () => {
    makeConfigDir(".codex");
    const hosts = detectAgentHosts({ PATH: PATH_DIR });
    const codex = hosts.find((h) => h.id === "codex")!;
    expect(codex.detected).toBe(true);
  });

  it("aider has no config-dir signal — binary-only detection", () => {
    // Aider is binary-only; even if .aider exists in HOME it won't match.
    makeConfigDir(".aider");
    const noBinary = detectAgentHosts({ PATH: PATH_DIR });
    expect(noBinary.find((h) => h.id === "aider")!.detected).toBe(false);

    makeBinary("aider");
    const withBinary = detectAgentHosts({ PATH: PATH_DIR });
    expect(withBinary.find((h) => h.id === "aider")!.detected).toBe(true);
  });
});

describe("detectedAgentHosts", () => {
  it("filters to detected only and orders Claude Code first", () => {
    makeBinary("codex");
    makeBinary("claude");
    const detected = detectedAgentHosts({ PATH: PATH_DIR });
    expect(detected.map((h) => h.id)).toEqual(["claude-code", "codex"]);
  });

  it("returns empty array when nothing detected", () => {
    expect(detectedAgentHosts({ PATH: PATH_DIR })).toEqual([]);
  });
});

describe("summariseAgentHosts", () => {
  it("returns '(none detected)' for empty environment", () => {
    const hosts = detectAgentHosts({ PATH: PATH_DIR });
    expect(summariseAgentHosts(hosts)).toBe("(none detected)");
  });

  it("formats single host with its signal types", () => {
    makeBinary("claude");
    makeConfigDir(".claude");
    const hosts = detectAgentHosts({ PATH: PATH_DIR });
    expect(summariseAgentHosts(hosts)).toBe("Claude Code (binary + config)");
  });

  it("comma-joins multiple detected hosts", () => {
    makeBinary("claude");
    makeBinary("codex");
    const hosts = detectAgentHosts({ PATH: PATH_DIR });
    expect(summariseAgentHosts(hosts)).toBe(
      "Claude Code (binary), Codex (OpenAI) (binary)",
    );
  });
});
