import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

import { defineTool, type AnyTool } from "../define-tool.js";
import { parseStoryboard } from "../../commands/_shared/storyboard-parse.js";
import {
  getStoryboardBeat,
  moveStoryboardBeat,
  setStoryboardCue,
  validateStoryboardMarkdown,
} from "../../commands/_shared/storyboard-edit.js";
import { executeStoryboardRevision } from "../../commands/_shared/storyboard-revise.js";
import { createBuildPlan } from "../../commands/_shared/build-plan.js";

const projectDirSchema = z.object({
  projectDir: z.string().optional().describe("Project directory. Defaults to the surface's cwd."),
});

async function readStoryboard(projectDir: string): Promise<{ path: string; markdown: string } | null> {
  const path = resolve(projectDir, "STORYBOARD.md");
  if (!existsSync(path)) return null;
  return { path, markdown: await readFile(path, "utf-8") };
}

export const storyboardListTool = defineTool({
  name: "storyboard_list",
  category: "storyboard",
  cost: "free",
  description: "List beats, ids, durations, and cue blocks from a project's STORYBOARD.md.",
  schema: projectDirSchema,
  async execute(args, ctx) {
    const projectDir = args.projectDir ? resolve(ctx.workingDirectory, args.projectDir) : ctx.workingDirectory;
    const file = await readStoryboard(projectDir);
    if (!file) return { success: false, error: `STORYBOARD.md not found in ${projectDir}` };
    const parsed = parseStoryboard(file.markdown);
    return {
      success: true,
      data: {
        projectDir,
        beats: parsed.beats.map((beat) => ({ id: beat.id, heading: beat.heading, durationSec: beat.duration ?? null, cues: beat.cues ?? {} })),
      },
      humanLines: parsed.beats.map((beat) => `${beat.id} ${beat.duration ?? "-"}s ${beat.heading}`),
    };
  },
});

export const storyboardValidateTool = defineTool({
  name: "storyboard_validate",
  category: "storyboard",
  cost: "free",
  description: "Validate STORYBOARD.md beat ids and cue blocks.",
  schema: projectDirSchema,
  async execute(args, ctx) {
    const projectDir = args.projectDir ? resolve(ctx.workingDirectory, args.projectDir) : ctx.workingDirectory;
    const file = await readStoryboard(projectDir);
    if (!file) return { success: false, error: `STORYBOARD.md not found in ${projectDir}` };
    const result = validateStoryboardMarkdown(file.markdown);
    return {
      success: result.ok,
      data: {
        ok: result.ok,
        issues: result.issues,
        beats: result.beats.map((beat) => ({ id: beat.id, heading: beat.heading, durationSec: beat.duration ?? null, cues: beat.cues ?? {} })),
      },
      humanLines: [`Storyboard ${result.ok ? "valid" : "invalid"} — ${result.beats.length} beat(s)`],
      error: result.ok ? undefined : `${result.issues.filter((issue) => issue.severity === "error").length} storyboard error(s)`,
    };
  },
});

export const storyboardGetTool = defineTool({
  name: "storyboard_get",
  category: "storyboard",
  cost: "free",
  description: "Return one STORYBOARD.md beat as structured data.",
  schema: z.object({
    projectDir: z.string().optional().describe("Project directory. Defaults to the surface's cwd."),
    beat: z.string().describe("Beat id to return."),
  }),
  async execute(args, ctx) {
    const projectDir = args.projectDir ? resolve(ctx.workingDirectory, args.projectDir) : ctx.workingDirectory;
    const file = await readStoryboard(projectDir);
    if (!file) return { success: false, error: `STORYBOARD.md not found in ${projectDir}` };
    const beat = getStoryboardBeat(file.markdown, args.beat);
    if (!beat) return { success: false, error: `Beat not found: ${args.beat}` };
    return {
      success: true,
      data: { beat },
      humanLines: [JSON.stringify(beat, null, 2)],
    };
  },
});

export const storyboardSetTool = defineTool({
  name: "storyboard_set",
  category: "storyboard",
  cost: "free",
  description: "Set or unset one cue on one beat in STORYBOARD.md.",
  schema: z.object({
    projectDir: z.string().optional().describe("Project directory. Defaults to the surface's cwd."),
    beat: z.string().describe("Beat id to mutate."),
    key: z.string().describe("Cue key to set."),
    value: z.string().optional().describe("Cue value. Required unless unset is true."),
    jsonValue: z.boolean().optional().describe("Parse value as JSON before writing."),
    unset: z.boolean().optional().describe("Remove the cue key."),
  }),
  async execute(args, ctx) {
    const projectDir = args.projectDir ? resolve(ctx.workingDirectory, args.projectDir) : ctx.workingDirectory;
    const file = await readStoryboard(projectDir);
    if (!file) return { success: false, error: `STORYBOARD.md not found in ${projectDir}` };
    try {
      const value = args.jsonValue && args.value !== undefined ? JSON.parse(args.value) : args.value;
      const next = setStoryboardCue(file.markdown, { beatId: args.beat, key: args.key, value, unset: args.unset });
      await writeFile(file.path, next, "utf-8");
      return { success: true, data: { beat: args.beat, key: args.key }, humanLines: [`Updated ${args.beat}.${args.key}`] };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
});

export const storyboardMoveTool = defineTool({
  name: "storyboard_move",
  category: "storyboard",
  cost: "free",
  description: "Move one beat after another beat in STORYBOARD.md.",
  schema: z.object({
    projectDir: z.string().optional().describe("Project directory. Defaults to the surface's cwd."),
    beat: z.string().describe("Beat id to move."),
    after: z.string().describe("Beat id that should precede the moved beat."),
  }),
  async execute(args, ctx) {
    const projectDir = args.projectDir ? resolve(ctx.workingDirectory, args.projectDir) : ctx.workingDirectory;
    const file = await readStoryboard(projectDir);
    if (!file) return { success: false, error: `STORYBOARD.md not found in ${projectDir}` };
    try {
      const next = moveStoryboardBeat(file.markdown, { beatId: args.beat, afterBeatId: args.after });
      await writeFile(file.path, next, "utf-8");
      return { success: true, data: { beat: args.beat, after: args.after }, humanLines: [`Moved ${args.beat} after ${args.after}`] };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
});

export const storyboardReviseTool = defineTool({
  name: "storyboard_revise",
  category: "storyboard",
  cost: "low",
  description:
    "Revise an existing STORYBOARD.md from a natural-language request. Reads project context, validates the revised storyboard, and writes unless dryRun is true.",
  schema: z.object({
    projectDir: z.string().optional().describe("Project directory. Defaults to the surface's cwd."),
    request: z.string().describe("Revision request, e.g. 'make the hook punchier and shorten to 30 seconds'."),
    durationSec: z.number().optional().describe("Target total duration in seconds."),
    composer: z.enum(["claude", "openai", "gemini"]).optional().describe("Revision LLM provider. Defaults to project config or available API keys."),
    dryRun: z.boolean().optional().describe("Preview the revised storyboard without writing."),
  }),
  async execute(args, ctx) {
    const projectDir = args.projectDir ? resolve(ctx.workingDirectory, args.projectDir) : ctx.workingDirectory;
    const result = await executeStoryboardRevision({
      projectDir,
      request: args.request,
      durationSec: args.durationSec,
      composer: args.composer,
      dryRun: args.dryRun ?? false,
    });
    return {
      success: result.success,
      data: result as unknown as Record<string, unknown>,
      humanLines: [
        result.success
          ? `Storyboard revised: ${result.summary || result.changedBeats.join(", ") || "ok"}`
          : `Storyboard revision failed: ${result.message ?? result.code ?? "unknown error"}`,
      ],
      error: result.success ? undefined : result.message ?? result.code,
    };
  },
});

export const planTool = defineTool({
  name: "plan",
  category: "storyboard",
  cost: "free",
  description: "Read STORYBOARD.md and return the build plan, missing artifacts, provider needs, and estimated cost.",
  schema: z.object({
    projectDir: z.string().optional().describe("Project directory. Defaults to the surface's cwd."),
    stage: z.enum(["assets", "compose", "sync", "render", "all"]).optional().describe("Stage to plan. Default all."),
    beat: z.string().optional().describe("Restrict the plan to one beat id."),
    mode: z.enum(["agent", "batch", "auto"]).optional().describe("Build mode. Default auto."),
    force: z.boolean().optional().describe("Plan regeneration even when outputs exist."),
  }),
  async execute(args, ctx) {
    const projectDir = args.projectDir ? resolve(ctx.workingDirectory, args.projectDir) : ctx.workingDirectory;
    const plan = await createBuildPlan({
      projectDir,
      stage: args.stage,
      beat: args.beat,
      mode: args.mode,
      force: args.force,
    });
    return {
      success: plan.validation.ok,
      data: plan as unknown as Record<string, unknown>,
      humanLines: [`Plan ${plan.status}: ${plan.beats.length} beat(s), missing=${plan.missing.join(", ") || "none"}, est=$${plan.estimatedCostUsd.toFixed(2)}`],
      error: plan.validation.ok ? undefined : "Storyboard validation failed",
    };
  },
});

export const storyboardTools: readonly AnyTool[] = [
  storyboardListTool as unknown as AnyTool,
  storyboardValidateTool as unknown as AnyTool,
  storyboardGetTool as unknown as AnyTool,
  storyboardSetTool as unknown as AnyTool,
  storyboardMoveTool as unknown as AnyTool,
  storyboardReviseTool as unknown as AnyTool,
  planTool as unknown as AnyTool,
];
