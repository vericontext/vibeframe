/**
 * Review findings that point at takes.
 *
 * A project review (`vibe inspect project`, `vibe inspect render`) reports
 * issues per beat. Each beat is made of generations, and every generation is
 * a take. This module names, on each beat-scoped issue, the takes that fill
 * that beat's slots now, so a finding says which generation it is about.
 *
 * For a finding about generated content (a static or black stretch, a long
 * silence, an AI review note) it also offers the take-level fixes:
 * - `vibe take edit` when the take's provider session can revise it;
 * - `vibe take promote` when an earlier take for the same slot exists;
 * - `vibe take list --beat` to see every take made for the beat.
 *
 * Linking only reads local files and asks providers what a session can do
 * (no request, no key). It never fails a review: on any error the issues
 * come back unchanged.
 */

import { createVideoGenerator } from "@vibeframe/ai-providers";

import {
  commandReviewAction,
  deriveNextReviewActions,
  normalizeReviewIssues,
  type ReviewAction,
  type ReviewIssue,
  type ReviewIssueTake,
} from "../commands/_shared/review-report.js";
import { projectSlots } from "./slots.js";
import { TAKE_SLOTS, listTakes, projectTakeStore, type Take, type TakeSlot } from "./take.js";

/** Issue codes about the generated content of a beat, and the slots that content comes from. */
function contentSlots(code: string): readonly TakeSlot[] | undefined {
  if (code === "STATIC_FRAME_SEGMENT" || code === "BLACK_FRAME_SEGMENT") return ["video", "backdrop", "keyframe"];
  if (code === "LONG_SILENCE") return ["narration", "music"];
  if (code.startsWith("AI_REVIEW_") && code !== "AI_REVIEW_FAILED") return TAKE_SLOTS;
  return undefined;
}

/** What a video take's provider session can still do. Asked without a request or key. */
async function continuationsOf(take: Take): Promise<string[]> {
  if (take.kind !== "video" || !take.session || take.status !== "completed") return [];
  try {
    return [...(await createVideoGenerator(take.session.provider, "")).continuations(take.session)];
  } catch {
    return [];
  }
}

/** The takes filling each beat's slots now, keyed by beat id. */
async function beatSlots(projectDir: string): Promise<Map<string, ReviewIssueTake[]>> {
  const holders = projectSlots(projectDir);
  const byBeat = new Map<string, ReviewIssueTake[]>();
  if (holders.size === 0) return byBeat;
  const takes = await listTakes(projectTakeStore(projectDir));
  const byId = new Map(takes.map((take) => [take.id, take]));
  for (const [takeId, holder] of holders) {
    const take = byId.get(takeId);
    if (!take) continue;
    const alternatives = takes
      .filter(
        (other) =>
          other.id !== takeId &&
          other.status === "completed" &&
          other.outputs.length > 0 &&
          other.origin.beatId === holder.beatId &&
          other.origin.asset === holder.asset
      )
      .slice(0, 3)
      .map((other) => other.id);
    const continuations = await continuationsOf(take);
    const link: ReviewIssueTake = {
      takeId,
      asset: holder.asset,
      kind: take.kind,
      provider: take.provider,
      ...(take.model ? { model: take.model } : {}),
      promoted: holder.promoted,
      ...(continuations.length > 0 ? { continuations } : {}),
      ...(alternatives.length > 0 ? { alternatives } : {}),
    };
    const list = byBeat.get(holder.beatId) ?? [];
    list.push(link);
    byBeat.set(holder.beatId, list);
  }
  for (const list of byBeat.values()) {
    list.sort((a, b) => TAKE_SLOTS.indexOf(a.asset as TakeSlot) - TAKE_SLOTS.indexOf(b.asset as TakeSlot));
  }
  return byBeat;
}

function takeActions(projectDir: string, beatId: string, code: string, slots: ReviewIssueTake[]): ReviewAction[] {
  const sourceIssueCodes = [code];
  const actions: ReviewAction[] = [];
  for (const link of slots) {
    if (link.continuations?.includes("edit")) {
      actions.push(
        commandReviewAction(
          `vibe take edit ${link.takeId} --project ${projectDir} --prompt "<the change>" --dry-run --json`,
          {
            label: `Revise the ${link.asset} take of beat ${beatId} with a prompt`,
            reason: `${link.provider} can edit this take through its session; the edit records a new take that can be promoted into the slot.`,
            sourceIssueCodes,
          }
        )
      );
    }
    const earlier = link.alternatives?.[0];
    if (earlier) {
      actions.push(
        commandReviewAction(`vibe take promote ${earlier} --project ${projectDir} --dry-run --json`, {
          label: `Preview putting the earlier ${link.asset} take back into beat ${beatId}`,
          reason: "An earlier take for this slot is preserved; promoting it costs nothing.",
          sourceIssueCodes,
        })
      );
    }
  }
  actions.push(
    commandReviewAction(`vibe take list --project ${projectDir} --beat ${beatId} --json`, {
      label: `List every take made for beat ${beatId}`,
      reason: "Shows the generations behind this beat, what each cost, and which one fills each slot.",
      sourceIssueCodes,
    })
  );
  return actions;
}

/** Name the takes behind each beat-scoped issue, and add take-level fixes to content issues. */
export async function linkReviewTakes(projectDir: string, issues: ReviewIssue[]): Promise<ReviewIssue[]> {
  if (!issues.some((issue) => issue.beatId ?? issue.scene)) return issues;
  let slots: Map<string, ReviewIssueTake[]>;
  try {
    slots = await beatSlots(projectDir);
  } catch {
    return issues;
  }
  if (slots.size === 0) return issues;
  return issues.map((issue) => {
    const beatId = issue.beatId ?? issue.scene;
    const beat = beatId ? slots.get(beatId) : undefined;
    if (!beatId || !beat) return issue;
    const focus = contentSlots(issue.code);
    const relevant = focus ? beat.filter((link) => focus.includes(link.asset as TakeSlot)) : beat;
    if (relevant.length === 0) return issue;
    return {
      ...issue,
      takes: relevant,
      ...(focus ? { actions: [...(issue.actions ?? []), ...takeActions(projectDir, beatId, issue.code, relevant)] } : {}),
    };
  });
}

/** A review result with its issues linked to takes and its next actions derived again. */
export async function withReviewTakes<
  T extends { issues: ReviewIssue[]; nextActions: ReviewAction[]; retryWith: string[] },
>(projectDir: string, result: T): Promise<T> {
  const linked = await linkReviewTakes(projectDir, result.issues);
  if (linked === result.issues) return result;
  const issues = normalizeReviewIssues(linked, { projectDir, retryWith: result.retryWith });
  return {
    ...result,
    issues,
    nextActions: deriveNextReviewActions({ issues, retryWith: result.retryWith, projectDir }),
  };
}
