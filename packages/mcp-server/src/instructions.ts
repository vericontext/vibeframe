import { mkdirSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/**
 * Claude Desktop substitutes "${user_config.key}" templates in the MCPB
 * manifest's env block, but leaves UNFILLED optional fields unsubstituted —
 * the spawned process sees the literal template string (observed on Desktop
 * 1.11847.x: ANTHROPIC_API_KEY='${user_config.anthropic_api_key}'). Those
 * values are truthy, so they would poison API-key detection AND block the
 * workspace .env (dotenv never overrides existing vars). Drop them.
 */
export function scrubUnresolvedUserConfigEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const removed: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") continue;
    if (/^\$\{user_config\.[^}]+\}$/.test(value.trim())) {
      delete env[key];
      removed.push(key);
    }
  }
  return removed;
}

/**
 * Workspace pinning for MCP hosts that cannot control the spawn cwd.
 * Claude Desktop MCPB extensions run from the extension install directory;
 * the manifest maps the user's chosen workspace folder to VIBE_MCP_WORKSPACE
 * and this chdir makes relative project paths and the upward .env walk
 * resolve against that folder instead.
 */
export function applyWorkspaceEnv(
  env: NodeJS.ProcessEnv = process.env,
  // Injectable because process.chdir() is unavailable in vitest workers.
  chdir: (dir: string) => void = (dir) => process.chdir(dir)
): string | null {
  const raw = env.VIBE_MCP_WORKSPACE?.trim();
  if (!raw) return null;
  const dir = resolve(raw);
  try {
    mkdirSync(dir, { recursive: true });
    chdir(dir);
    return dir;
  } catch (error) {
    console.error(
      `[vibeframe] Could not use VIBE_MCP_WORKSPACE=${raw} (${
        error instanceof Error ? error.message : String(error)
      }); staying in ${process.cwd()}`
    );
    return null;
  }
}

export function resolveServerWorkspaceRoot(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): string {
  const initCwd = env.INIT_CWD?.trim();
  if (!initCwd) return cwd;
  return isAbsolute(initCwd) ? initCwd : resolve(cwd, initCwd);
}

export function buildServerInstructions(cwd = resolveServerWorkspaceRoot()): string {
  return [
    `VibeFrame MCP workspace root: ${cwd}. Treat this directory as the default workspace for relative paths.`,
    "For args named dir, projectDir, output, videoPath, or source, prefer workspace-relative paths unless the user explicitly provides an absolute path.",
    "When creating projects with init, use a project name or workspace-relative path under the workspace root.",
    "Do not create projects in /tmp, /home/claude, /workspace, or other synthetic roots unless the user explicitly asks.",
    "Before high or very-high cost provider work, run a dry-run or plan when available and ask the user to confirm provider spend.",
  ].join("\n");
}
