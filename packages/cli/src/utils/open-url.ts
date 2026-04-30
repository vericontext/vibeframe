/**
 * Cross-platform URL opener. Spawns the OS browser handler in a detached
 * process so the CLI's input flow continues uninterrupted.
 *
 * Silent on failure: launching a browser is convenience, never the user's
 * critical path. If the OS hook is missing (CI containers, headless Linux
 * without xdg-utils), the caller's prompt still works.
 */

import { spawn } from "node:child_process";
import { platform } from "node:os";

/**
 * Open `url` in the user's default browser.
 *
 * Resolves immediately; the spawned process is detached and unref'd, so the
 * CLI doesn't wait for the browser. Errors are swallowed.
 */
export async function openUrl(url: string): Promise<void> {
  const { command, args } = resolveOpener(url);
  if (!command) return;

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.on("error", () => {
      // Swallow — we don't want a missing `xdg-open` to surface as a stack trace
      // in the middle of an API-key prompt.
    });
    child.unref();
  } catch {
    // ditto — synchronous spawn errors (e.g. permission) are non-fatal here.
  }
}

interface Opener {
  command: string | null;
  args: string[];
}

/**
 * Pick the OS-appropriate opener command. Exported for unit testing — the
 * implementation has no side effects so we can verify the args without
 * actually spawning anything.
 */
export function resolveOpener(url: string): Opener {
  switch (platform()) {
    case "darwin":
      return { command: "open", args: [url] };
    case "win32":
      // The empty "" argument is Windows' workaround for `start` treating its
      // first quoted arg as a window title rather than the URL.
      return { command: "cmd", args: ["/c", "start", "", url] };
    case "linux":
    case "freebsd":
    case "openbsd":
      return { command: "xdg-open", args: [url] };
    default:
      return { command: null, args: [] };
  }
}
