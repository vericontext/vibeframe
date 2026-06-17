import { describe, expect, it } from "vitest";

import {
  commandReviewAction,
  deriveNextReviewActions,
  normalizeReviewActions,
  normalizeReviewIssues,
  reviewActionsFromRetryWith,
} from "./review-report.js";

describe("review report actions", () => {
  it("classifies deterministic local commands as safe to auto-run", () => {
    expect(
      commandReviewAction("vibe scene repair /tmp/demo --json", {
        reason: "repair",
      })
    ).toMatchObject({
      kind: "command",
      costTier: "free",
      safeToAutoRun: true,
      requiresConfirmation: false,
    });

    expect(
      commandReviewAction("vibe inspect render /tmp/demo --cheap --json", {
        reason: "inspect",
      })
    ).toMatchObject({
      costTier: "free",
      safeToAutoRun: true,
      requiresConfirmation: false,
    });
  });

  it("requires confirmation for provider-backed or ambiguous commands", () => {
    expect(
      commandReviewAction("vibe build /tmp/demo --stage assets --force --json", {
        reason: "assets",
      })
    ).toMatchObject({
      costTier: "unknown",
      safeToAutoRun: false,
      requiresConfirmation: true,
    });

    expect(
      commandReviewAction("vibe inspect render /tmp/demo --ai --json", {
        reason: "ai",
      })
    ).toMatchObject({
      costTier: "low",
      safeToAutoRun: false,
      requiresConfirmation: true,
    });
  });

  it("deduplicates actions and merges source issue codes", () => {
    const actions = normalizeReviewActions([
      commandReviewAction("vibe render /tmp/demo --json", {
        reason: "first",
        sourceIssueCodes: ["A"],
      }),
      commandReviewAction("vibe render /tmp/demo --json", {
        reason: "second",
        sourceIssueCodes: ["B"],
      }),
    ]);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      command: "vibe render /tmp/demo --json",
      sourceIssueCodes: ["A", "B"],
    });
  });

  it("adds issue-level defaults and top-level retry actions", () => {
    const retryWith = ["vibe render /tmp/demo --beat hook --json"];
    const issues = normalizeReviewIssues(
      [
        {
          severity: "error",
          code: "MISSING_COMPOSITION",
          message: "Missing composition",
          beatId: "hook",
        },
      ],
      { projectDir: "/tmp/demo", retryWith }
    );

    expect(issues[0].actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "vibe build /tmp/demo --beat hook --stage compose --json",
          sourceIssueCodes: ["MISSING_COMPOSITION"],
          safeToAutoRun: false,
          requiresConfirmation: true,
        }),
      ])
    );
    expect(deriveNextReviewActions({ issues, retryWith })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: "vibe render /tmp/demo --beat hook --json" }),
      ])
    );
  });

  it("maps host-agent retry hints to agent actions", () => {
    expect(reviewActionsFromRetryWith(['codex "fix issues from review-report.json"'])).toEqual([
      expect.objectContaining({
        kind: "agent",
        fixOwner: "host-agent",
        safeToAutoRun: false,
        requiresConfirmation: false,
      }),
    ]);
  });
});
