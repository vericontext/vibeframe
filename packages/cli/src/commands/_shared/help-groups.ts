/**
 * @module commands/_shared/help-groups
 *
 * Groups the root `vibe --help` command listing by use case instead of
 * alphabetically.
 *
 * Before this, the root help printed the same commands twice: once as
 * Commander's flat alphabetical `Commands:` block, then again under a
 * "Common workflows" footer that re-listed most of them by use case. The
 * footer's own preamble admitted it ("the alphabetical list above is the
 * full command set; this section shows the typical entry points by use
 * case"), which left the reader to map the two lists onto each other.
 *
 * Descriptions are read from the live command tree rather than restated
 * here, so this file can only ever drift in *grouping*, never in wording.
 * A command missing from {@link COMMAND_GROUPS} lands in a trailing
 * "Other" group rather than disappearing; `help-groups.test.ts` asserts
 * that group stays empty so adding a top-level command fails the test
 * instead of silently degrading the help.
 */

import type { Command } from "commander";

/** Terminal width the listing wraps to. */
const WRAP_COLUMNS = 80;

/** Gap between the command column and the description column. */
const COLUMN_GAP = 2;

/** Left indent for command rows. */
const INDENT = "  ";

/**
 * Use-case groups for the root help listing, in display order.
 *
 * Ordered by the sequence a first-time reader needs them: build a project
 * video, reach for a one-off asset, then wire up hosts and automation.
 */
export const COMMAND_GROUPS: ReadonlyArray<{
  readonly title: string;
  readonly commands: readonly string[];
}> = [
  {
    title: "Project video",
    commands: [
      "init",
      "plan",
      "build",
      "preview",
      "render",
      "assemble",
      "storyboard",
      "design",
      "status",
      "inspect",
    ],
  },
  {
    title: "One-off media",
    commands: ["generate", "edit", "audio", "detect", "remix"],
  },
  {
    title: "Agents & setup",
    commands: [
      "setup",
      "doctor",
      "host",
      "schema",
      "context",
      "guide",
      "run",
      "agent",
      "completion",
    ],
  },
];

/** Commander marks hidden subcommands with a private `_hidden` flag. */
interface HelpHiddenCommand {
  _hidden?: boolean;
}

/**
 * Top-level commands that appear in help, excluding hidden ones and
 * Commander's auto-generated `help` command.
 */
export function visibleTopLevelCommands(prog: Command): Command[] {
  return prog.commands.filter(
    (cmd) => !(cmd as unknown as HelpHiddenCommand)._hidden && cmd.name() !== "help"
  );
}

/**
 * Visible top-level command names that no group in {@link COMMAND_GROUPS}
 * claims. Empty in a healthy tree; the test asserts that.
 */
export function ungroupedCommandNames(prog: Command): string[] {
  const grouped = new Set(COMMAND_GROUPS.flatMap((g) => g.commands));
  return visibleTopLevelCommands(prog)
    .map((cmd) => cmd.name())
    .filter((name) => !grouped.has(name));
}

/** `generate|gen` when an alias exists, otherwise just the name. */
function displayName(cmd: Command): string {
  const alias = cmd.aliases()[0];
  return alias ? `${cmd.name()}|${alias}` : cmd.name();
}

/**
 * Wrap `text` to `width`, indenting every line after the first by
 * `hangingIndent` spaces so descriptions stay in their column.
 */
function wrapDescription(text: string, width: number, hangingIndent: number): string[] {
  if (width <= 0) return [text];
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.map((line, i) => (i === 0 ? line : " ".repeat(hangingIndent) + line));
}

/**
 * Render the grouped command listing for the root `vibe --help`.
 *
 * Returns the block that replaces Commander's flat `Commands:` section,
 * already prefixed and suffixed with a blank line so it slots between the
 * options block and the remaining help footers.
 */
export function renderCommandGroups(prog: Command): string {
  const byName = new Map(visibleTopLevelCommands(prog).map((cmd) => [cmd.name(), cmd]));

  const groups = COMMAND_GROUPS.map((group) => ({
    title: group.title,
    commands: group.commands.map((name) => byName.get(name)).filter((c): c is Command => !!c),
  })).filter((group) => group.commands.length > 0);

  // Anything a group forgot still shows up, so a new command can never
  // vanish from help just because nobody updated COMMAND_GROUPS.
  const leftovers = ungroupedCommandNames(prog)
    .map((name) => byName.get(name))
    .filter((c): c is Command => !!c);
  if (leftovers.length > 0) {
    groups.push({ title: "Other", commands: leftovers });
  }

  const nameWidth = Math.max(
    ...groups.flatMap((g) => g.commands.map((c) => displayName(c).length))
  );
  const descColumn = INDENT.length + nameWidth + COLUMN_GAP;
  const descWidth = WRAP_COLUMNS - descColumn;

  const lines: string[] = [];
  for (const group of groups) {
    lines.push("", `${group.title}`);
    for (const cmd of group.commands) {
      const label = displayName(cmd).padEnd(nameWidth + COLUMN_GAP);
      const desc = wrapDescription(cmd.description(), descWidth, descColumn);
      lines.push(`${INDENT}${label}${desc[0] ?? ""}`.trimEnd());
      for (const extra of desc.slice(1)) lines.push(extra);
    }
  }
  // No trailing newline: Commander joins help sections with one, and the
  // block that follows opens with its own blank line.
  return lines.join("\n");
}
