/**
 * Every command name the CLI reports must name a real command.
 *
 * The cost table, the `command` label of each `--json` envelope, and the
 * pipeline action catalog are keyed by command name. When a command was
 * renamed (`ai highlights` -> `remix highlights`, `analyze media` ->
 * `inspect media`) the old keys stayed behind, so dry runs priced paid
 * commands at $0 and envelopes named commands that no longer exist.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { COST_ESTIMATES } from "./output.js";
import { pipelineActionMetadata } from "../pipeline/executor.js";

const here = dirname(fileURLToPath(import.meta.url));

interface SchemaEntry {
  path: string;
  cost?: string;
}

/** `vibe schema --list`, from the source tree, with `group.sub` paths as `group sub`. */
function listCommands(): Map<string, SchemaEntry> {
  const out = execFileSync("npx", ["tsx", resolve(here, "../index.ts"), "schema", "--list", "--json"], {
    encoding: "utf-8",
    env: process.env,
    timeout: 60_000,
  });
  const entries = JSON.parse(out) as SchemaEntry[];
  return new Map(entries.map((entry) => [entry.path.replace(".", " "), entry]));
}

/** The `command` label of every `outputSuccess({ command: "..." })` call in the command sources. */
function envelopeLabels(): Array<{ file: string; label: string }> {
  const labels: Array<{ file: string; label: string }> = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".ts") && !name.includes(".test.")) {
        const source = readFileSync(path, "utf-8");
        for (const match of source.matchAll(/outputSuccess\(\{\s*command:\s*"([^"]+)"/g)) {
          labels.push({ file: path.slice(here.length + 1), label: match[1] });
        }
      }
    }
  };
  walk(here);
  return labels;
}

const commands = listCommands();
const pipelineCommands = new Set(pipelineActionMetadata().flatMap((action) => (action.command ? [action.command] : [])));

/** A label names a command when it is a command path, optionally followed by flags. */
const namesCommand = (label: string): boolean =>
  commands.has(label) || [...commands.keys()].some((path) => label.startsWith(`${path} -`));

describe("command names", () => {
  it("every cost table key is a CLI command or a pipeline action's command", () => {
    const stale = Object.keys(COST_ESTIMATES).filter((key) => !commands.has(key) && !pipelineCommands.has(key));
    expect(stale).toEqual([]);
  });

  it("every pipeline action's command is priced, or is a free CLI command", () => {
    const unpriced = [...pipelineCommands].filter(
      (command) => !(command in COST_ESTIMATES) && commands.get(command)?.cost !== "free"
    );
    expect(unpriced).toEqual([]);
  });

  it("every high and very-high cost command has a cost estimate", () => {
    const unpriced = [...commands.values()]
      .filter((entry) => entry.cost === "high" || entry.cost === "very-high")
      .map((entry) => entry.path.replace(".", " "))
      .filter((path) => !(path in COST_ESTIMATES));
    expect(unpriced).toEqual([]);
  });

  it("every --json envelope names a real command", () => {
    const stale = envelopeLabels().filter(({ label }) => !namesCommand(label));
    expect(stale).toEqual([]);
  });
});
