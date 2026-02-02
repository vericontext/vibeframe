/**
 * TTY Input Utilities
 * Handles stdin fallback to /dev/tty for piped environments
 */

import { createInterface, Interface } from "node:readline";
import { ReadStream } from "node:tty";

let ttyStream: ReadStream | null = null;

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
export function createTTYInterface(options?: {
  prompt?: string;
  historySize?: number;
}): Interface {
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
 */
export async function prompt(question: string): Promise<string> {
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
 * Prompt for hidden input (password/API key)
 * Characters are not echoed to terminal
 */
export async function promptHidden(question: string): Promise<string> {
  const input = getTTYInputStream() as ReadStream;

  return new Promise((resolve) => {
    process.stdout.write(question);

    let value = "";

    // Check if we can use raw mode
    if (typeof input.setRawMode === "function") {
      input.setRawMode(true);
      input.resume();
      input.setEncoding("utf8");

      const onData = (char: string) => {
        if (char === "\n" || char === "\r" || char === "\u0004") {
          // Enter or EOF
          input.setRawMode(false);
          input.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(value);
        } else if (char === "\u0003") {
          // Ctrl+C
          input.setRawMode(false);
          process.stdout.write("\n");
          process.exit(1);
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

      input.on("data", onData);
    } else {
      // Fallback: no raw mode available, input will be visible
      const rl = createInterface({ input, output: process.stdout });
      rl.question("", (answer) => {
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
  question: string,
  options: string[],
  defaultIndex = 0
): Promise<number> {
  // Display options
  for (let i = 0; i < options.length; i++) {
    const marker = i === defaultIndex ? "→" : " ";
    console.log(`   ${marker} ${i + 1}. ${options[i]}`);
  }
  console.log();

  const answer = await prompt(question);
  const index = parseInt(answer, 10) - 1;

  if (isNaN(index) || index < 0 || index >= options.length) {
    return defaultIndex;
  }
  return index;
}

/**
 * Prompt for yes/no confirmation
 */
export async function promptConfirm(
  question: string,
  defaultYes = true
): Promise<boolean> {
  const hint = defaultYes ? "(Y/n)" : "(y/N)";
  const answer = await prompt(`${question} ${hint}: `);

  if (answer === "") return defaultYes;
  return answer.toLowerCase().startsWith("y");
}
