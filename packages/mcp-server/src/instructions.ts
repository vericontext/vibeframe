import { isAbsolute, resolve } from "node:path";

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
