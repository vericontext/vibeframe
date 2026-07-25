import { describe, it, expect } from "vitest";
import { Command } from "commander";
import {
  COMMAND_GROUPS,
  renderCommandGroups,
  ungroupedCommandNames,
  visibleTopLevelCommands,
} from "./help-groups.js";

function makeProgram(): Command {
  const prog = new Command().name("vibe");
  prog.addCommand(new Command("init").description("Scaffold a VibeFrame project"));
  prog.addCommand(new Command("build").description("Build a project from STORYBOARD.md"));
  prog
    .addCommand(new Command("generate").alias("gen").description("Generate standalone assets"));
  prog.addCommand(new Command("setup").description("Configure VibeFrame"));
  prog.addCommand(new Command("timeline").description("Low-level primitive"), { hidden: true });
  return prog;
}

describe("COMMAND_GROUPS", () => {
  it("lists every command exactly once across all groups", () => {
    const all = COMMAND_GROUPS.flatMap((g) => g.commands);
    expect(all.length).toBe(new Set(all).size);
  });
});

describe("visibleTopLevelCommands", () => {
  it("drops hidden commands and Commander's auto help command", () => {
    const names = visibleTopLevelCommands(makeProgram()).map((c) => c.name());
    expect(names).toEqual(["init", "build", "generate", "setup"]);
    expect(names).not.toContain("timeline");
  });
});

describe("renderCommandGroups", () => {
  it("groups commands under their use-case heading", () => {
    const out = renderCommandGroups(makeProgram());
    expect(out).toContain("Project video");
    expect(out).toContain("One-off media");
    expect(out).toContain("Agents & setup");
    // Real description text comes from the command, not a restated copy.
    expect(out).toContain("Scaffold a VibeFrame project");
  });

  it("renders the alias alongside the name", () => {
    expect(renderCommandGroups(makeProgram())).toContain("generate|gen");
  });

  it("omits hidden commands", () => {
    expect(renderCommandGroups(makeProgram())).not.toContain("Low-level primitive");
  });

  it("surfaces an ungrouped command under Other rather than dropping it", () => {
    const prog = makeProgram();
    prog.addCommand(new Command("brand-new").description("Not in any group yet"));
    expect(ungroupedCommandNames(prog)).toEqual(["brand-new"]);
    const out = renderCommandGroups(prog);
    expect(out).toContain("Other");
    expect(out).toContain("brand-new");
  });

  it("keeps every line within the 80-column wrap target", () => {
    const prog = makeProgram();
    prog.addCommand(
      new Command("verbose").description(
        "A deliberately long description that has to wrap across more than one line to stay readable in a narrow terminal"
      )
    );
    for (const line of renderCommandGroups(prog).split("\n")) {
      expect(line.length).toBeLessThanOrEqual(80);
    }
  });
});
