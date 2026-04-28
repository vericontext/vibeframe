/**
 * @module utils/agent-host-detect
 *
 * Detect which agent hosts the user has installed so the v0.61 setup
 * wizard (`vibe setup`) and project scaffolder (`vibe init`) can tailor
 * what to write where.
 *
 * Detection is best-effort and *informational* — it never blocks setup,
 * never shells out beyond `which`, and never reads the contents of the
 * config dirs (just whether they exist).
 *
 * Two signals per host:
 *   - **binary** — found via `which`/`PATH` lookup (fast, exact)
 *   - **configDir** — known config directory exists in `$HOME` (catches
 *     installs where the binary isn't on PATH for the current shell)
 *
 * A host is "detected" if either signal fires. The caller decides how to
 * use that — typically `vibe setup` shows them in a summary, `vibe init`
 * uses them to pick which agent files to scaffold.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Agent hosts VibeFrame knows how to scaffold for. */
export type AgentHostId = "claude-code" | "codex" | "cursor" | "aider" | "gemini-cli" | "opencode";

export interface AgentHostInfo {
  id: AgentHostId;
  /** Human-friendly name for prompts and UI. */
  label: string;
  /** True when at least one signal fired. */
  detected: boolean;
  /** Signals that fired (empty array when `detected` is false). */
  signals: AgentHostSignal[];
  /**
   * Files this host expects in a project. Used by `vibe init` to know
   * what to scaffold; informational here.
   */
  projectFiles: string[];
}

export type AgentHostSignal =
  | { kind: "binary"; name: string }
  | { kind: "configDir"; path: string };

/**
 * Scan the current environment for known agent hosts. Synchronous because
 * every check is cheap (`existsSync` + `process.env.PATH` walk).
 */
export function detectAgentHosts(env: NodeJS.ProcessEnv = process.env): AgentHostInfo[] {
  const home = homedir();
  return [
    {
      id: "claude-code",
      label: "Claude Code",
      detected: false,
      signals: [],
      projectFiles: ["CLAUDE.md", ".claude/skills/"],
    },
    {
      id: "codex",
      label: "Codex (OpenAI)",
      detected: false,
      signals: [],
      projectFiles: ["AGENTS.md"],
    },
    {
      id: "cursor",
      label: "Cursor",
      detected: false,
      signals: [],
      projectFiles: ["AGENTS.md", ".cursor/rules/"],
    },
    {
      id: "aider",
      label: "Aider",
      detected: false,
      signals: [],
      projectFiles: ["AGENTS.md", ".aider.conf.yml"],
    },
    {
      id: "gemini-cli",
      label: "Gemini CLI",
      detected: false,
      signals: [],
      // Per https://geminicli.com/docs/cli/gemini-md/ Gemini CLI's primary
      // context file is GEMINI.md; AGENTS.md is the cross-tool fallback
      // VibeFrame writes by default. Both are honoured.
      projectFiles: ["GEMINI.md", "AGENTS.md", ".gemini/"],
    },
    {
      id: "opencode",
      label: "OpenCode",
      detected: false,
      signals: [],
      // sst/opencode officially supports the agents.md spec — AGENTS.md at
      // project root is the standard place. Local config also under
      // `.opencode/` per https://opencode.ai/docs/config/.
      projectFiles: ["AGENTS.md", ".opencode/"],
    },
  ].map((host) => {
    const signals: AgentHostSignal[] = [];

    // Binary lookup via PATH
    const binaryName = HOST_BINARIES[host.id as AgentHostId];
    if (binaryName && isOnPath(binaryName, env)) {
      signals.push({ kind: "binary", name: binaryName });
    }

    // Config directory in $HOME
    const configDirRel = HOST_CONFIG_DIRS[host.id as AgentHostId];
    if (configDirRel) {
      const path = join(home, configDirRel);
      if (existsSync(path)) {
        signals.push({ kind: "configDir", path });
      }
    }

    return {
      ...host,
      id: host.id as AgentHostId,
      detected: signals.length > 0,
      signals,
    };
  });
}

/**
 * Return only detected hosts, ordered by VibeFrame's recommendation:
 * Claude Code first (we ship slash commands for it), then alphabetical.
 */
export function detectedAgentHosts(env: NodeJS.ProcessEnv = process.env): AgentHostInfo[] {
  return detectAgentHosts(env)
    .filter((h) => h.detected)
    .sort((a, b) => {
      if (a.id === "claude-code") return -1;
      if (b.id === "claude-code") return 1;
      return a.id.localeCompare(b.id);
    });
}

/**
 * One-line status summary suitable for spinners / setup wizards.
 *
 * Examples:
 *   "Claude Code (binary + config), Codex (config)"
 *   "(none — install Claude Code, Codex, or Cursor for agent integration)"
 */
export function summariseAgentHosts(hosts: AgentHostInfo[]): string {
  const detected = hosts.filter((h) => h.detected);
  if (detected.length === 0) {
    return "(none detected)";
  }
  return detected
    .map((h) => {
      const sigs = h.signals.map((s) => (s.kind === "binary" ? "binary" : "config"));
      return `${h.label} (${sigs.join(" + ")})`;
    })
    .join(", ");
}

// ── Internals ────────────────────────────────────────────────────────────

const HOST_BINARIES: Record<AgentHostId, string | null> = {
  "claude-code": "claude",
  codex: "codex",
  cursor: "cursor",
  aider: "aider",
  "gemini-cli": "gemini",
  opencode: "opencode",
};

/**
 * Per-host `$HOME`-relative config directory. Set to `null` when the host
 * doesn't keep a stable config dir (signal becomes binary-only).
 */
const HOST_CONFIG_DIRS: Record<AgentHostId, string | null> = {
  "claude-code": ".claude",
  codex: ".codex",
  cursor: ".cursor", // some installs; macOS app stores prefs elsewhere
  aider: null,
  "gemini-cli": ".gemini",
  // sst/opencode uses XDG-style `~/.config/opencode/` per
  // https://opencode.ai/docs/config/. The path is relative to $HOME so
  // the join in detectAgentHosts() resolves correctly.
  opencode: ".config/opencode",
};

/**
 * Lightweight `which` — walks `$PATH` for an executable. Avoids spawning
 * a subprocess; works on POSIX + Windows (`PATHEXT` not handled — fine for
 * agent host CLIs which all ship POSIX-style binaries).
 */
function isOnPath(binary: string, env: NodeJS.ProcessEnv): boolean {
  const path = env.PATH ?? env.Path ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  for (const dir of path.split(sep)) {
    if (!dir) continue;
    if (existsSync(join(dir, binary))) return true;
    if (process.platform === "win32" && existsSync(join(dir, `${binary}.exe`))) return true;
  }
  return false;
}
