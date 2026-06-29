import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { z } from "zod";

import { defineTool, type AnyTool } from "../define-tool.js";
import { parseDesign, validateDesignMarkdown } from "../../commands/_shared/design-parse.js";

const PROJECT_DIR_DESCRIPTION =
  "Project directory. Defaults to the surface's cwd; in MCP hosts, relative paths resolve under the configured server workspace.";

const projectDirSchema = z.object({
  projectDir: z.string().optional().describe(PROJECT_DIR_DESCRIPTION),
});

export const designValidateTool = defineTool({
  name: "design_validate",
  category: "design",
  cost: "free",
  title: "Validate Design",
  annotations: { readOnly: true, openWorld: false },
  description: "Validate DESIGN.md front-matter color/typography tokens and sections (google-labs design.md format).",
  schema: projectDirSchema,
  async execute(args, ctx) {
    const projectDir = args.projectDir
      ? resolve(ctx.workingDirectory, args.projectDir)
      : ctx.workingDirectory;
    const path = join(projectDir, "DESIGN.md");
    if (!existsSync(path)) return { success: false, error: `DESIGN.md not found in ${projectDir}` };
    const md = await readFile(path, "utf-8");
    const issues = validateDesignMarkdown(md);
    const design = parseDesign(md);
    const ok = !issues.some((issue) => issue.severity === "error");
    return {
      success: ok,
      data: {
        ok,
        name: design.name ?? null,
        colors: design.colors,
        sections: Object.keys(design.sections),
        issues,
      },
      humanLines: [`DESIGN.md ${ok ? "valid" : "invalid"} — ${Object.keys(design.colors).length} color token(s)`],
      error: ok ? undefined : `${issues.filter((i) => i.severity === "error").length} design error(s)`,
    };
  },
});

export const designTools: readonly AnyTool[] = [designValidateTool as unknown as AnyTool];
