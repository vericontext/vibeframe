/**
 * @module manifest/take
 * @description Read the take record: every paid generation, its inputs and
 *   outputs, its provider session, and what it cost with the basis of that
 *   figure; and promote an earlier take back into a project's beat slot.
 *   Free; no provider calls.
 */

import { z } from "zod";

import { defineTool, failedTool, type AnyTool } from "../define-tool.js";
import { executeTakeList, executeTakeLog, executeTakeShow } from "../../takes/query.js";
import { executeTakePromote } from "../../takes/promote.js";
import { TAKE_SLOTS } from "../../takes/take.js";

const SCOPE = {
  projectDir: z.string().optional().describe("Project whose takes to read. Defaults to the project around the workspace, else the global store."),
  global: z.boolean().optional().describe("Read the global ledger instead: every take on this machine, in any project."),
};

const FILTER = {
  kind: z.enum(["video", "image", "audio"]).optional().describe("Only this kind of take."),
  beatId: z.string().optional().describe("Only takes a build made for this storyboard beat."),
  since: z.string().optional().describe("Only takes made on or after this date, e.g. 2026-11-01."),
};

export const takeListTool = defineTool({
  name: "take_list",
  category: "take",
  cost: "free",
  title: "List Takes",
  annotations: { readOnly: true, openWorld: false },
  description:
    "List takes (the record of every paid generation), newest first: id, kind, provider/model, status, cost and its basis (reported, metered, estimate, upper-bound), prompt, output path, the beat slot a build made it for, and inSlot when its output is what that slot holds now.",
  schema: z.object({
    ...SCOPE,
    ...FILTER,
    limit: z.number().int().positive().optional().describe("Most takes to return (default 50)."),
  }),
  async execute(args, ctx) {
    const result = await executeTakeList(
      { cwd: ctx.workingDirectory, projectDir: args.projectDir, global: args.global },
      { kind: args.kind, beatId: args.beatId, since: args.since, limit: args.limit },
    );
    return {
      success: true,
      data: result as unknown as Record<string, unknown>,
      humanLines: [`${result.takes.length} of ${result.total} take(s) in ${result.store}`],
    };
  },
});

export const takeShowTool = defineTool({
  name: "take_show",
  category: "take",
  cost: "free",
  title: "Show Take",
  annotations: { readOnly: true, openWorld: false },
  description:
    "Show one take in full: prompt, parameters, inputs and outputs with sha256, provider session handle, parent take, origin, and cost with its usage records.",
  schema: z.object({
    takeId: z.string().describe("Take id, e.g. take_mh2k1x0a_1f2e3d4c"),
    projectDir: SCOPE.projectDir,
  }),
  async execute(args, ctx) {
    const found = await executeTakeShow(args.takeId, { cwd: ctx.workingDirectory, projectDir: args.projectDir });
    if (!found) return { success: false, error: `Take not found: ${args.takeId}` };
    return {
      success: true,
      data: { store: found.store, take: found.take } as unknown as Record<string, unknown>,
      humanLines: [`${found.take.id}: ${found.take.kind} ${found.take.operation} (${found.take.provider}), $${found.take.cost.usd} ${found.take.cost.basis}`],
    };
  },
});

export const takeLogTool = defineTool({
  name: "take_log",
  category: "take",
  cost: "free",
  title: "Total Take Spend",
  annotations: { readOnly: true, openWorld: false },
  description:
    "Total the spend on takes by provider, model, and kind, and split it by basis: provider-reported or metered billing versus estimates and tier upper bounds. Use global for every project on this machine.",
  schema: z.object({ ...SCOPE, ...FILTER }),
  async execute(args, ctx) {
    const result = await executeTakeLog(
      { cwd: ctx.workingDirectory, projectDir: args.projectDir, global: args.global },
      { kind: args.kind, beatId: args.beatId, since: args.since },
    );
    return {
      success: true,
      data: result as unknown as Record<string, unknown>,
      humanLines: [`$${result.totalUsd} over ${result.takes} take(s) (${result.store})`],
    };
  },
});

export const takePromoteTool = defineTool({
  name: "take_promote",
  category: "take",
  cost: "free",
  title: "Promote Take",
  annotations: { readOnly: false, openWorld: false },
  description:
    "Put an earlier take's output back into a project's beat slot (narration, backdrop, keyframe, video, music), replacing what the slot holds. Later builds keep the promoted take until the beat's cue is edited or the build runs with force. Free; copies a preserved file, no provider call. Use dryRun to see the change first.",
  schema: z.object({
    takeId: z.string().describe("Take id, e.g. take_mh2k1x0a_1f2e3d4c"),
    projectDir: SCOPE.projectDir,
    beatId: z.string().optional().describe("Beat to fill. Default: the beat the take was made for."),
    asset: z.enum(TAKE_SLOTS).optional().describe("Slot to fill. Default: the slot the take was made for."),
    dryRun: z.boolean().optional().describe("Report what would change without writing."),
  }),
  async execute(args, ctx) {
    const result = await executeTakePromote({ ...args, cwd: ctx.workingDirectory });
    if (!result.success) return failedTool(result, "Could not promote the take");
    return {
      success: true,
      data: result as unknown as Record<string, unknown>,
      humanLines: [`${result.dryRun ? "Would promote" : "Promoted"} ${result.takeId} into the ${result.asset} slot of beat ${result.beatId} (${result.path})`],
    };
  },
});

export const takeTools: readonly AnyTool[] = [
  takeListTool as unknown as AnyTool,
  takeShowTool as unknown as AnyTool,
  takeLogTool as unknown as AnyTool,
  takePromoteTool as unknown as AnyTool,
];
