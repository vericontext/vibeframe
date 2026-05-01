/**
 * TTY Input Utilities
 * Handles stdin fallback to /dev/tty for piped environments
 */

import { createInterface, Interface } from "node:readline";
import { ReadStream } from "node:tty";
import { openUrl } from "./open-url.js";

let ttyStream: ReadStream | null = null;

function splitTTYInput(chunk: string): string[] {
  const tokens: string[] = [];
  for (let i = 0; i < chunk.length; i++) {
    if (chunk[i] === "\x1b" && chunk[i + 1] === "[" && i + 2 < chunk.length) {
      tokens.push(chunk.slice(i, i + 3));
      i += 2;
    } else {
      tokens.push(chunk[i]);
    }
  }
  return tokens;
}

/**
 * Get a TTY-capable input stream
 * Falls back to /dev/tty when stdin is piped (e.g., from curl)
 */
export function getTTYInputStream(): typeof process.stdin | ReadStream {
  if (process.stdin.isTTY) {
    return process.stdin;
  }

  // stdin is not a TTY (piped), open /dev/tty directly
  if (!ttyStream) {
    try {
      // Open /dev/tty as a TTY stream
      const fd = require("fs").openSync("/dev/tty", "r");
      ttyStream = new ReadStream(fd);
    } catch {
      // Fallback to stdin if /dev/tty is not available
      console.warn("Warning: Cannot open /dev/tty, interactive input may not work");
      return process.stdin;
    }
  }
  return ttyStream;
}

/**
 * Check if we have TTY input available
 */
export function hasTTY(): boolean {
  if (process.stdin.isTTY) return true;

  // Try to actually open /dev/tty to verify it's accessible
  try {
    const fs = require("fs");
    const fd = fs.openSync("/dev/tty", "r");
    fs.closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Close the TTY stream if we opened one
 */
export function closeTTYStream(): void {
  if (ttyStream) {
    ttyStream.destroy();
    ttyStream = null;
  }
}

/**
 * Create a readline interface with TTY support
 */
export function createTTYInterface(options?: { prompt?: string; historySize?: number }): Interface {
  const input = getTTYInputStream();
  return createInterface({
    input,
    output: process.stdout,
    terminal: true,
    historySize: options?.historySize ?? 100,
    prompt: options?.prompt ?? "> ",
  });
}

/**
 * Prompt for input (single line)
 * Throws in non-TTY environments to prevent hanging.
 */
export async function prompt(question: string): Promise<string> {
  if (!hasTTY()) {
    throw new Error(
      "Interactive input required but no TTY available. " +
        "Use command flags to provide values non-interactively."
    );
  }
  const input = getTTYInputStream();
  const rl = createInterface({
    input,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Prompt for hidden input (password/API key).
 * Characters are not echoed to the terminal.
 *
 * `opts.openHotkeyUrl`: when set, the user can press lowercase `o` as the
 * very first key (no input typed yet) to launch the URL in their default
 * browser. Subsequent keys behave normally. Safe for our setup wizard
 * because every registered API-key prefix (`sk-`, `AIza`, `xai-`, `key_`,
 * `r8_`, `sk_`, etc.) starts with something other than `o`. Pressing `o`
 * after typing any character is treated as part of the value, not a hotkey.
 */
export interface PromptHiddenOptions {
  /** URL to launch in the default browser when the user presses `o` first. */
  openHotkeyUrl?: string;
}

export async function promptHidden(
  question: string,
  opts: PromptHiddenOptions = {}
): Promise<string> {
  const input = getTTYInputStream() as ReadStream;

  return new Promise((resolve) => {
    let value = "";

    // Check if we can use raw mode
    if (typeof input.setRawMode === "function") {
      input.setRawMode(true);
      input.resume();
      input.setEncoding("utf8");

      let finished = false;
      const handleChar = (char: string) => {
        if (finished) return;
        if (char === "\n" || char === "\r" || char === "\u0004") {
          // Enter or EOF
          finished = true;
          input.setRawMode(false);
          input.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(value);
        } else if (char === "\u0003") {
          // Ctrl+C
          input.setRawMode(false);
          process.stdout.write("\n");
          process.exit(1);
        } else if (opts.openHotkeyUrl && value.length === 0 && (char === "o" || char === "O")) {
          // Browser-open hotkey: only triggers as the very first key.
          // Fire-and-forget — we keep accepting input while the OS opens
          // the URL.
          void openUrl(opts.openHotkeyUrl);
        } else if (char === "\u007F" || char === "\b") {
          // Backspace
          if (value.length > 0) {
            value = value.slice(0, -1);
            // Clear character from display
            process.stdout.write("\b \b");
          }
        } else if (char >= " ") {
          // Printable character (may be multiple chars when pasting)
          value += char;
          process.stdout.write("*".repeat(char.length)); // Show asterisk for each char
        }
      };
      const onData = (chunk: string) => {
        for (const char of splitTTYInput(chunk)) handleChar(char);
      };

      input.on("data", onData);
      process.stdout.write(question);
    } else {
      // Fallback: no raw mode available, input will be visible
      const rl = createInterface({ input, output: process.stdout });
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

/**
 * Prompt for selection from a list (1-based index)
 */
export async function promptSelect(
  _question: string,
  options: string[],
  defaultIndex = 0,
  opts: { backIndex?: number } = {}
): Promise<number> {
  const input = getTTYInputStream() as ReadStream;

  // Try interactive arrow-key mode if raw mode is available
  if (typeof input.setRawMode === "function") {
    return new Promise((resolve) => {
      let selected = defaultIndex;

      const render = () => {
        // Move cursor up to overwrite previous render (except first time)
        if (renderCount > 0) {
          process.stdout.write(`\x1b[${options.length}A`);
        }
        for (let i = 0; i < options.length; i++) {
          const marker = i === selected ? "\x1b[36m❯\x1b[0m" : " ";
          const text = i === selected ? `\x1b[1m${options[i]}\x1b[0m` : options[i];
          process.stdout.write(`\x1b[2K   ${marker} ${text}\n`);
        }
        renderCount++;
      };

      let renderCount = 0;
      render();

      input.setRawMode(true);
      input.resume();
      input.setEncoding("utf8");

      let finished = false;
      const handleChar = (char: string) => {
        if (finished) return;
        if (char === "\r" || char === "\n") {
          // Enter — confirm selection
          finished = true;
          input.setRawMode(false);
          input.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(selected);
        } else if (char === "\u0003") {
          // Ctrl+C
          input.setRawMode(false);
          process.stdout.write("\n");
          process.exit(1);
        } else if (opts.backIndex !== undefined && (char === "\x1b" || char === "\x1b[D")) {
          finished = true;
          input.setRawMode(false);
          input.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(opts.backIndex);
        } else if (char === "\x1b[A" || char === "k") {
          // Up arrow or k
          selected = (selected - 1 + options.length) % options.length;
          render();
        } else if (char === "\x1b[B" || char === "j") {
          // Down arrow or j
          selected = (selected + 1) % options.length;
          render();
        } else if (char >= "1" && char <= String(options.length)) {
          // Number key — direct select
          selected = parseInt(char, 10) - 1;
          finished = true;
          input.setRawMode(false);
          input.removeListener("data", onData);
          render();
          process.stdout.write("\n");
          resolve(selected);
        }
      };
      const onData = (chunk: string) => {
        for (const char of splitTTYInput(chunk)) handleChar(char);
      };

      input.on("data", onData);
    });
  }

  // Fallback: number input for non-TTY
  for (let i = 0; i < options.length; i++) {
    const marker = i === defaultIndex ? "→" : " ";
    console.log(`   ${marker} ${i + 1}. ${options[i]}`);
  }
  console.log();

  const answer = await prompt(_question);
  const index = parseInt(answer, 10) - 1;

  if (isNaN(index) || index < 0 || index >= options.length) {
    return defaultIndex;
  }
  return index;
}

/**
 * Prompt for yes/no confirmation.
 *
 * Renders an arrow-key Yes/No selector when a TTY is available (matching the
 * paradigm of `promptSelect` / `promptMultiSelect`), falling back to the
 * legacy `(Y/n)` text prompt for piped/CI input so scripts continue to work
 * unchanged.
 */
export async function promptConfirm(question: string, defaultYes = true): Promise<boolean> {
  const input = getTTYInputStream() as ReadStream;

  if (typeof input.setRawMode === "function") {
    return new Promise((resolve) => {
      const options = ["Yes", "No"];
      let selected = defaultYes ? 0 : 1;
      let renderCount = 0;

      // Print the question once above the selector so it stays visible while
      // the cursor redraws Yes/No below it.
      process.stdout.write(`${question}\n`);

      const render = () => {
        if (renderCount > 0) {
          process.stdout.write(`\x1b[${options.length}A`);
        }
        for (let i = 0; i < options.length; i++) {
          const marker = i === selected ? "\x1b[36m❯\x1b[0m" : " ";
          const text = i === selected ? `\x1b[1m${options[i]}\x1b[0m` : options[i];
          process.stdout.write(`\x1b[2K   ${marker} ${text}\n`);
        }
        renderCount++;
      };

      render();

      input.setRawMode(true);
      input.resume();
      input.setEncoding("utf8");

      let finished = false;
      const handleChar = (char: string) => {
        if (finished) return;
        if (char === "\r" || char === "\n") {
          finished = true;
          input.setRawMode(false);
          input.removeListener("data", onData);
          resolve(selected === 0);
        } else if (char === "\u0003") {
          input.setRawMode(false);
          process.stdout.write("\n");
          process.exit(1);
        } else if (char === "\x1b[A" || char === "\x1b[B" || char === "k" || char === "j") {
          // Toggle on any vertical movement — only two options, so there's
          // nowhere to go but the other one.
          selected = selected === 0 ? 1 : 0;
          render();
        } else if (char === "y" || char === "Y") {
          selected = 0;
          finished = true;
          input.setRawMode(false);
          input.removeListener("data", onData);
          render();
          resolve(true);
        } else if (char === "n" || char === "N") {
          selected = 1;
          finished = true;
          input.setRawMode(false);
          input.removeListener("data", onData);
          render();
          resolve(false);
        }
      };
      const onData = (chunk: string) => {
        for (const char of splitTTYInput(chunk)) handleChar(char);
      };

      input.on("data", onData);
    });
  }

  // Non-TTY fallback — preserves the historical text-based contract for CI /
  // piped invocations like `echo y | vibe ...`.
  const hint = defaultYes ? "(Y/n)" : "(y/N)";
  const answer = await prompt(`${question} ${hint}: `);

  if (answer === "") return defaultYes;
  return answer.toLowerCase().startsWith("y");
}

/**
 * Prompt for multi-select (checkbox) from a list.
 *
 * Returns the indexes selected (sorted ascending). ↑↓ navigates, space toggles,
 * enter confirms. `pickFocusedOnEnter` (formerly `enterSelectsFocusedWhenEmpty`)
 * makes Enter behave like a single-choice select **as long as the user has
 * not pressed space yet** — once any explicit toggle happens, Enter confirms
 * the current selection as-is. This lets a pre-checked default be overridden
 * by a single arrow + Enter while still allowing additive multi-pick via
 * space + Enter.
 * `preserveDefaultSelectionOnEnter` changes the no-toggle Enter shortcut from
 * replace to add when there are already checked rows. This is useful for setup
 * screens where previously configured choices should remain visible and sticky.
 * In non-TTY environments accepts comma-separated 1-based indices, the literal
 * "all", or empty/"none" for no selection.
 */
export async function promptMultiSelect(
  _question: string,
  options: string[],
  defaultSelected: boolean[] = [],
  opts: {
    pickFocusedOnEnter?: boolean;
    preserveDefaultSelectionOnEnter?: boolean;
    backIndex?: number;
    /** @deprecated Use pickFocusedOnEnter — same flag, broader semantics. */
    enterSelectsFocusedWhenEmpty?: boolean;
  } = {}
): Promise<number[]> {
  const pickFocused = opts.pickFocusedOnEnter ?? opts.enterSelectsFocusedWhenEmpty ?? false;
  const input = getTTYInputStream() as ReadStream;
  const selected = options.map((_, i) => Boolean(defaultSelected[i]));

  if (typeof input.setRawMode === "function") {
    return new Promise((resolve) => {
      let cursor = 0;
      let renderCount = 0;
      let userToggled = false;

      const render = () => {
        if (renderCount > 0) {
          process.stdout.write(`\x1b[${options.length}A`);
        }
        for (let i = 0; i < options.length; i++) {
          const pointer = i === cursor ? "\x1b[36m❯\x1b[0m" : " ";
          const box = selected[i] ? "\x1b[36m[x]\x1b[0m" : "[ ]";
          const text = i === cursor ? `\x1b[1m${options[i]}\x1b[0m` : options[i];
          process.stdout.write(`\x1b[2K   ${pointer} ${box} ${text}\n`);
        }
        renderCount++;
      };

      render();

      input.setRawMode(true);
      input.resume();
      input.setEncoding("utf8");

      const finish = () => {
        input.setRawMode(false);
        input.removeListener("data", onData);
        process.stdout.write("\n");
        const result: number[] = [];
        for (let i = 0; i < selected.length; i++) {
          if (selected[i]) result.push(i);
        }
        resolve(result);
      };

      let finished = false;
      const handleChar = (char: string) => {
        if (finished) return;
        if (char === "\r" || char === "\n") {
          if (pickFocused && !userToggled) {
            const hasDefaultSelection = selected.some(Boolean);
            if (!opts.preserveDefaultSelectionOnEnter || !hasDefaultSelection) {
              for (let i = 0; i < selected.length; i++) selected[i] = false;
            }
            selected[cursor] = true;
            render();
          }
          finished = true;
          finish();
        } else if (char === "\u0003") {
          input.setRawMode(false);
          process.stdout.write("\n");
          process.exit(1);
        } else if (opts.backIndex !== undefined && (char === "\x1b" || char === "\x1b[D")) {
          for (let i = 0; i < selected.length; i++) selected[i] = false;
          selected[opts.backIndex] = true;
          finished = true;
          finish();
        } else if (char === " ") {
          selected[cursor] = !selected[cursor];
          userToggled = true;
          render();
        } else if (char === "\x1b[A" || char === "k") {
          cursor = (cursor - 1 + options.length) % options.length;
          render();
        } else if (char === "\x1b[B" || char === "j") {
          cursor = (cursor + 1) % options.length;
          render();
        } else if (char === "a") {
          // Convenience: 'a' selects all
          const allOn = selected.every(Boolean);
          for (let i = 0; i < selected.length; i++) selected[i] = !allOn;
          userToggled = true;
          render();
        } else if (char >= "1" && char <= String(Math.min(options.length, 9))) {
          // Number key — toggle item directly
          const i = parseInt(char, 10) - 1;
          selected[i] = !selected[i];
          userToggled = true;
          render();
        }
      };
      const onData = (chunk: string) => {
        for (const char of splitTTYInput(chunk)) handleChar(char);
      };

      input.on("data", onData);
    });
  }

  // Fallback for non-TTY: list and accept comma-separated indices
  for (let i = 0; i < options.length; i++) {
    const box = selected[i] ? "[x]" : "[ ]";
    console.log(`   ${box} ${i + 1}. ${options[i]}`);
  }
  console.log();

  const answer = (await prompt(_question)).trim().toLowerCase();
  if (answer === "" || answer === "none") {
    return [];
  }
  if (answer === "all") {
    return options.map((_, i) => i);
  }
  const picked = new Set<number>();
  for (const tok of answer.split(",")) {
    const n = parseInt(tok.trim(), 10);
    if (!isNaN(n) && n >= 1 && n <= options.length) {
      picked.add(n - 1);
    }
  }
  return [...picked].sort((a, b) => a - b);
}
