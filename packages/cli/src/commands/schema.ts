/**
 * @module schema
 * @description Schema introspection command. Outputs JSON Schema for any CLI command,
 * enabling agent introspection without static docs.
 *
 * Usage: vibe schema generate.image
 *        vibe schema edit.silence-cut
 *        vibe schema --list
 */

import { Command } from "commander";
import { exitWithError, generalError, usageError } from "./output.js";

export const schemaCommand = new Command("schema")
  .description("Show JSON schema for a CLI command")
  .argument("[command]", "Command path (e.g., generate.image, edit.silence-cut)")
  .option("--list", "List all available command paths")
  .action((commandPath: string | undefined, options: { list?: boolean }) => {
    const program = schemaCommand.parent;
    if (!program) {
      exitWithError(generalError("Schema command must be registered on a program"));
    }

    if (options.list || !commandPath) {
      listCommands(program);
      return;
    }

    const parts = commandPath.split(".");

    if (parts.length === 1) {
      // Single command (e.g., "export", "setup", "doctor")
      const cmd = program.commands.find(
        (c: Command) => c.name() === parts[0]
      );
      if (!cmd) {
        exitWithError(usageError(`Unknown command: ${parts[0]}`, `Run 'vibe schema --list' to see all available commands.`));
      }
      const schema = buildSchema(cmd as Command, parts[0]);
      console.log(JSON.stringify(schema, null, 2));
      return;
    }

    if (parts.length !== 2) {
      exitWithError(usageError(
        `Invalid command path: ${commandPath}. Use format: group.action (e.g., generate.image)`,
        `Run 'vibe schema --list' to see all available commands.`
      ));
    }

    const [groupName, actionName] = parts;

    const groupCmd = program.commands.find(
      (c: Command) => c.name() === groupName
    );
    if (!groupCmd) {
      const availableGroups = program.commands
        .filter((c: Command) => (c as Command).commands.length > 0)
        .map((c: Command) => c.name())
        .join(", ");
      exitWithError(usageError(`Unknown group: ${groupName}`, `Available groups: ${availableGroups}`));
    }

    const actionCmd = (groupCmd as Command).commands.find(
      (c: Command) => c.name() === actionName
    );
    if (!actionCmd) {
      const availableActions = (groupCmd as Command).commands
        .map((c: Command) => c.name())
        .join(", ");
      exitWithError(usageError(`Unknown action: ${actionName} in group ${groupName}`, `Available actions: ${availableActions}`));
    }

    const toolName = `${groupName}_${actionName.replace(/-/g, "_")}`;
    const schema = buildSchema(actionCmd as Command, toolName);
    console.log(JSON.stringify(schema, null, 2));
  });

function listCommands(program: Command): void {
  const commands: { path: string; description: string }[] = [];
  const skipTopLevel = new Set(["help", "schema"]);

  for (const group of program.commands) {
    const name = group.name();
    if (skipTopLevel.has(name)) continue;

    const subCmds = (group as Command).commands;
    if (subCmds.length === 0) {
      // Top-level command without subcommands (e.g., export, setup, doctor)
      const desc = (group as Command).description() || "";
      if (desc.toLowerCase().includes("deprecated")) continue;
      commands.push({ path: name, description: desc });
      continue;
    }

    for (const sub of subCmds) {
      const desc = (sub as Command).description() || "";
      if (desc.toLowerCase().includes("deprecated")) continue;
      commands.push({
        path: `${name}.${(sub as Command).name()}`,
        description: desc,
      });
    }
  }

  console.log(JSON.stringify(commands, null, 2));
}

function extractEnumFromDescription(description: string): string[] | undefined {
  // Strip parentheticals first so "(default ...)" / "(when X is set)" don't
  // truncate downstream parsing. We re-add a paren-list match at the end as
  // pattern 3 for descriptions whose enum IS the parenthesized list.
  const cleaned = description.replace(/\s*\([^()]*\)/g, "");

  const finalize = (raw: string[]): string[] | undefined => {
    const values = raw
      .map((v) => v.trim().replace(/^or\s+/i, "")) // "a, b, or c" → "a, b, c"
      .filter(Boolean);
    // Reject if any value still has whitespace inside it (indicates prose
    // like "5 or 10" or "auto-detected" rather than a clean enum).
    if (values.some((v) => /\s/.test(v))) return undefined;
    if (values.length >= 2 && values.length <= 12) return values;
    return undefined;
  };

  // Pattern 1: "Provider: gemini, openai, grok"
  const providerMatch = cleaned.match(
    /(?:Provider|Providers?):\s*([a-z0-9,\s-]+?)$/i
  );
  if (providerMatch) {
    const values = finalize(providerMatch[1].split(","));
    if (values) return values;
  }

  // Pattern 2: "<Multi-word label>: val1, val2, val3"
  // (extends the original "Style: vivid, natural" to allow 1-3-word labels
  //  and ratio-shaped values like "16:9")
  const labeledMatch = cleaned.match(
    /^([A-Z][a-z]+(?:\s+[a-z]+){0,2}):\s*([a-z0-9:,\s/-]+?)$/
  );
  if (labeledMatch) {
    return finalize(labeledMatch[2].split(","));
  }

  // Pattern 3: "Anything (val1, val2, val3)" — parenthesized list
  // This is the most common shape for option descriptions in the CLI.
  // Restrict to lists where every value is alphanumeric+ratio-shaped so
  // we don't accidentally enum-ify free-form prose like "(default: 30)".
  const parenMatch = description.match(/\(([^()]+)\)\s*$/);
  if (parenMatch) {
    const inner = parenMatch[1].trim();
    // Skip "default: X" annotations and prose
    if (/^default:|^e\.g\.|^or\s|via\s|run\s/i.test(inner)) return undefined;
    const rawValues = inner
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // Strip "or " from oxford-comma list ("a, b, or c" → "a, b, c")
    const values = rawValues.map((v) => v.replace(/^or\s+/i, "").trim());
    // Each value must look like an enum candidate: short, no spaces (or ratio-shaped)
    const looksLikeEnum = values.every((v) =>
      /^[a-z0-9][a-z0-9:/_-]*$/i.test(v) && v.length <= 24
    );
    if (looksLikeEnum && values.length >= 2 && values.length <= 12) return values;
  }

  return undefined;
}

function inferType(
  opt: { flags: string; defaultValue?: unknown },
  name: string
): string {
  // Check flags for numeric hints
  const numericFlags = [
    "<number>",
    "<seconds>",
    "<sec>",
    "<dB>",
    "<pixels>",
    "<ms>",
    "<n>",
    "<count>",
    "<duration>",
  ];
  if (numericFlags.some((f) => opt.flags.includes(f))) {
    return "number";
  }

  // Check name for numeric hints
  const numericNames = [
    "count",
    "duration",
    "retries",
    "fadeIn",
    "fadeOut",
    "start",
    "end",
    "time",
    "threshold",
    "padding",
    "pageSize",
    "maxResults",
    "fps",
    "bitrate",
    "width",
    "height",
  ];
  if (numericNames.includes(name)) {
    return "number";
  }

  // Check default value type
  if (typeof opt.defaultValue === "number") return "number";
  if (typeof opt.defaultValue === "boolean") return "boolean";

  // Boolean flags (no value argument)
  if (opt.flags.includes("<") && opt.flags.includes(">")) {
    return "string";
  }

  return "boolean";
}

export function buildSchema(
  cmd: Command,
  toolName: string
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  // Extract arguments
  for (const arg of cmd.registeredArguments || []) {
    const name = arg.name();
    const prop: Record<string, unknown> = {
      type: "string",
      description: arg.description,
    };

    if (arg.variadic) {
      prop.type = "array";
      prop.items = { type: "string" };
    }

    properties[name] = prop;
    if (arg.required) {
      required.push(name);
    }
  }

  // Extract options
  for (const opt of cmd.options) {
    const name = camelCase(
      opt.long?.replace(/^--/, "") || opt.short?.replace(/^-/, "") || ""
    );
    if (!name || name === "help") continue;

    const prop: Record<string, unknown> = {
      description: opt.description,
    };

    // Infer type
    prop.type = inferType(
      { flags: opt.flags, defaultValue: opt.defaultValue },
      name
    );

    // Extract enum values from description
    if (opt.description) {
      const enumValues = extractEnumFromDescription(opt.description);
      if (enumValues) {
        prop.enum = enumValues;
      }
    }

    // Default value
    if (opt.defaultValue !== undefined) {
      prop.default = opt.defaultValue;
      // Fix stringified numbers
      if (prop.type === "number" && typeof opt.defaultValue === "string") {
        const num = Number(opt.defaultValue);
        if (!isNaN(num)) prop.default = num;
      }
    }

    properties[name] = prop;
  }

  return {
    name: toolName,
    description: cmd.description(),
    parameters: {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    },
  };
}

function camelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}
