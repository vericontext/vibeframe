import { Command } from "commander";
import chalk from "chalk";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";

import { parseDesign, validateDesignMarkdown } from "./_shared/design-parse.js";
import { applyTiers } from "./_shared/cost-tier.js";
import { exitWithError, generalError, isJsonMode, outputSuccess } from "./output.js";

export const designCommand = new Command("design")
  .description("Read and validate DESIGN.md (google-labs design.md format)")
  .addHelpText(
    "after",
    `
Examples:
  $ vibe design validate my-video        Validate DESIGN.md tokens + sections
  $ vibe design validate my-video --json
`
  );

designCommand
  .command("validate")
  .description("Validate DESIGN.md front-matter tokens and sections")
  .argument("[project-dir]", "Project directory", ".")
  .action(async (projectDirArg: string) => {
    const startedAt = Date.now();
    const projectDir = resolve(projectDirArg);
    const path = join(projectDir, "DESIGN.md");
    if (!existsSync(path)) {
      exitWithError(generalError(`DESIGN.md not found in ${projectDir}`));
      return;
    }
    const md = await readFile(path, "utf-8");
    const issues = validateDesignMarkdown(md);
    const design = parseDesign(md);
    const ok = !issues.some((issue) => issue.severity === "error");

    if (isJsonMode()) {
      outputSuccess({
        command: "design validate",
        startedAt,
        data: {
          projectDir,
          ok,
          name: design.name ?? null,
          colors: design.colors,
          sections: Object.keys(design.sections),
          issues,
        },
      });
      if (!ok) process.exitCode = 1;
      return;
    }

    const colorCount = Object.keys(design.colors).length;
    if (ok) {
      console.log(chalk.green(`DESIGN.md valid — ${colorCount} color token(s)`));
    } else {
      console.log(
        chalk.red(`DESIGN.md invalid — ${issues.filter((i) => i.severity === "error").length} error(s)`)
      );
    }
    for (const issue of issues) {
      const color =
        issue.severity === "error" ? chalk.red : issue.severity === "warning" ? chalk.yellow : chalk.dim;
      console.log(color(`[${issue.severity}] ${issue.code}: ${issue.message}`));
    }
    if (!ok) process.exitCode = 1;
  });

applyTiers(designCommand, { validate: "free" });
