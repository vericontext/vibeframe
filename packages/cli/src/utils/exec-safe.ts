import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Safe async exec — no shell, args as array */
export async function execSafe(
  cmd: string,
  args: string[],
  options?: { timeout?: number; maxBuffer?: number },
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(cmd, args, {
    timeout: options?.timeout,
    maxBuffer: options?.maxBuffer ?? 50 * 1024 * 1024,
  });
}

/** Safe sync exec — no shell, args as array */
export function execSafeSync(
  cmd: string,
  args: string[],
  options?: { stdio?: "pipe" | "ignore" },
): string {
  return execFileSync(cmd, args, {
    encoding: "utf-8",
    stdio: options?.stdio ?? "pipe",
  });
}

/** Shorthand: ffprobe duration query */
export async function ffprobeDuration(filePath: string): Promise<number> {
  const { stdout } = await execSafe("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const duration = parseFloat(stdout.trim());
  if (isNaN(duration)) throw new Error(`Invalid duration: ${stdout}`);
  return duration;
}

/** Shorthand: ffprobe video dimensions */
export async function ffprobeVideoSize(
  filePath: string,
): Promise<{ width: number; height: number }> {
  const { stdout } = await execSafe("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0:s=x",
    filePath,
  ]);
  const [w, h] = stdout.trim().split("x").map(Number);
  if (isNaN(w) || isNaN(h))
    throw new Error(`Invalid dimensions: ${stdout.trim()}`);
  return { width: w, height: h };
}

/** Shorthand: check if a command exists */
export function commandExists(cmd: string): boolean {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
