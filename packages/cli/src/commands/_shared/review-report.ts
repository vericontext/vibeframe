import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type ReviewSeverity = "error" | "warning" | "info";
export type ReviewStatus = "pass" | "warn" | "fail";
export type ReviewMode = "project" | "render";
export type ReviewFixOwner = "vibe" | "host-agent";
export type ReviewActionKind = "command" | "agent" | "manual";
export type ReviewActionCostTier = "free" | "low" | "high" | "very-high" | "unknown";

export interface ReviewAction {
  id: string;
  kind: ReviewActionKind;
  label: string;
  command?: string;
  agentPrompt?: string;
  fixOwner: ReviewFixOwner;
  costTier: ReviewActionCostTier;
  safeToAutoRun: boolean;
  requiresConfirmation: boolean;
  reason: string;
  sourceIssueCodes?: string[];
}

export interface ReviewIssue {
  severity: ReviewSeverity;
  code: string;
  message: string;
  file?: string;
  scene?: string;
  beatId?: string;
  timeRange?: {
    start: number;
    end: number;
    duration?: number;
  };
  sceneDurationSec?: number;
  narrationDurationSec?: number;
  audioCoverageRatio?: number;
  fixOwner?: ReviewFixOwner;
  suggestedFix?: string;
  actions?: ReviewAction[];
}

export interface ReviewSummary {
  issueCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  fixOwners: {
    vibe: number;
    hostAgent: number;
  };
}

export interface ReviewReport {
  schemaVersion: "1";
  kind: "review";
  project: string;
  mode: ReviewMode;
  beat?: string;
  status: ReviewStatus;
  score: number;
  issues: ReviewIssue[];
  summary: ReviewSummary;
  nextActions: ReviewAction[];
  retryWith: string[];
  sourceReports: string[];
  reportPath?: string;
}

export function statusFromIssues(issues: ReviewIssue[]): ReviewStatus {
  if (issues.some((issue) => issue.severity === "error")) return "fail";
  if (issues.some((issue) => issue.severity === "warning")) return "warn";
  return "pass";
}

export function scoreIssues(issues: ReviewIssue[]): number {
  let score = 100;
  for (const issue of issues) {
    if (issue.severity === "error") score -= 25;
    else if (issue.severity === "warning") score -= 8;
    else score -= 2;
  }
  return Math.max(0, Math.min(100, score));
}

export function uniqueRetryWith(items: Array<string | undefined | null>): string[] {
  return [
    ...new Set(items.filter((item): item is string => typeof item === "string" && item.length > 0)),
  ];
}

export function commandReviewAction(
  command: string,
  opts: {
    label?: string;
    fixOwner?: ReviewFixOwner;
    reason: string;
    sourceIssueCodes?: string[];
    costTier?: ReviewActionCostTier;
    safeToAutoRun?: boolean;
    requiresConfirmation?: boolean;
  }
): ReviewAction {
  const classified = classifyReviewCommand(command);
  return stripUndefined({
    id: actionId("command", command),
    kind: "command" as const,
    label: opts.label ?? command,
    command,
    fixOwner: opts.fixOwner ?? classified.fixOwner,
    costTier: opts.costTier ?? classified.costTier,
    safeToAutoRun: opts.safeToAutoRun ?? classified.safeToAutoRun,
    requiresConfirmation: opts.requiresConfirmation ?? classified.requiresConfirmation,
    reason: opts.reason,
    sourceIssueCodes: uniqueStrings(opts.sourceIssueCodes ?? []),
  });
}

export function agentReviewAction(opts: {
  label: string;
  agentPrompt: string;
  reason: string;
  sourceIssueCodes?: string[];
}): ReviewAction {
  return stripUndefined({
    id: actionId("agent", opts.agentPrompt),
    kind: "agent" as const,
    label: opts.label,
    agentPrompt: opts.agentPrompt,
    fixOwner: "host-agent" as const,
    costTier: "unknown" as const,
    safeToAutoRun: false,
    requiresConfirmation: false,
    reason: opts.reason,
    sourceIssueCodes: uniqueStrings(opts.sourceIssueCodes ?? []),
  });
}

export function manualReviewAction(opts: {
  label: string;
  reason: string;
  fixOwner?: ReviewFixOwner;
  sourceIssueCodes?: string[];
}): ReviewAction {
  return stripUndefined({
    id: actionId("manual", opts.label),
    kind: "manual" as const,
    label: opts.label,
    fixOwner: opts.fixOwner ?? "host-agent",
    costTier: "unknown" as const,
    safeToAutoRun: false,
    requiresConfirmation: false,
    reason: opts.reason,
    sourceIssueCodes: uniqueStrings(opts.sourceIssueCodes ?? []),
  });
}

export function reviewActionsFromRetryWith(
  retryWith: string[],
  sourceIssueCodes: string[] = []
): ReviewAction[] {
  return normalizeReviewActions(
    retryWith.map((item) => {
      if (/^codex\s+/i.test(item)) {
        return agentReviewAction({
          label: "Ask the host agent to fix review issues",
          agentPrompt: item,
          reason: "The review report contains host-agent-owned issues.",
          sourceIssueCodes,
        });
      }
      return commandReviewAction(item, {
        reason: "Backward-compatible retryWith command.",
        sourceIssueCodes,
      });
    })
  );
}

export function normalizeReviewActions(actions: ReviewAction[]): ReviewAction[] {
  const merged = new Map<string, ReviewAction>();
  for (const action of actions) {
    const key = [action.kind, action.command ?? action.agentPrompt ?? action.label].join("\0");
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...action,
        sourceIssueCodes: uniqueStrings(action.sourceIssueCodes ?? []),
      });
      continue;
    }
    merged.set(key, {
      ...existing,
      safeToAutoRun: existing.safeToAutoRun && action.safeToAutoRun,
      requiresConfirmation: existing.requiresConfirmation || action.requiresConfirmation,
      sourceIssueCodes: uniqueStrings([
        ...(existing.sourceIssueCodes ?? []),
        ...(action.sourceIssueCodes ?? []),
      ]),
    });
  }
  return [...merged.values()].map((action) =>
    stripUndefined({
      ...action,
      sourceIssueCodes:
        action.sourceIssueCodes && action.sourceIssueCodes.length > 0
          ? action.sourceIssueCodes
          : undefined,
    })
  );
}

export function deriveNextReviewActions(opts: {
  issues: ReviewIssue[];
  retryWith: string[];
  projectDir?: string;
}): ReviewAction[] {
  return normalizeReviewActions([
    ...opts.issues.flatMap((issue) => issue.actions ?? []),
    ...reviewActionsFromRetryWith(opts.retryWith),
  ]);
}

export function fixOwnerForIssue(issue: Pick<ReviewIssue, "code" | "fixOwner">): ReviewFixOwner {
  if (issue.fixOwner) return issue.fixOwner;
  if (issue.code.startsWith("AI_REVIEW_")) return "host-agent";
  if (issue.code.startsWith("STORYBOARD_")) return "host-agent";
  if (
    issue.code === "PROJECT_NOT_FOUND" ||
    issue.code === "MISSING_STORYBOARD" ||
    issue.code === "BEAT_NOT_FOUND" ||
    issue.code === "MISSING_DESIGN"
  ) {
    return "host-agent";
  }
  return "vibe";
}

export function normalizeReviewIssues(
  issues: ReviewIssue[],
  opts?: ReviewFixOwner | { fallbackOwner?: ReviewFixOwner; projectDir?: string; retryWith?: string[] }
): ReviewIssue[] {
  const fallbackOwner = typeof opts === "string" ? opts : opts?.fallbackOwner;
  const projectDir = typeof opts === "string" ? undefined : opts?.projectDir;
  return issues.map((issue) => {
    const normalized = {
      ...issue,
      fixOwner: issue.fixOwner ?? fallbackOwner ?? fixOwnerForIssue(issue),
    };
    const actions = normalizeReviewActions([
      ...(issue.actions ?? []),
      ...(projectDir ? defaultActionsForIssue(normalized, projectDir) : []),
    ]);
    return stripUndefined({
      ...normalized,
      actions: actions.length > 0 ? actions : undefined,
    });
  });
}

export function summarizeReviewIssues(issues: ReviewIssue[]): ReviewSummary {
  const normalized = normalizeReviewIssues(issues);
  return {
    issueCount: normalized.length,
    errorCount: normalized.filter((issue) => issue.severity === "error").length,
    warningCount: normalized.filter((issue) => issue.severity === "warning").length,
    infoCount: normalized.filter((issue) => issue.severity === "info").length,
    fixOwners: {
      vibe: normalized.filter((issue) => issue.fixOwner === "vibe").length,
      hostAgent: normalized.filter((issue) => issue.fixOwner === "host-agent").length,
    },
  };
}

export function buildReviewReport(opts: {
  project: string;
  mode: ReviewMode;
  beat?: string;
  status: ReviewStatus;
  score: number;
  issues: ReviewIssue[];
  retryWith: string[];
  sourceReports?: string[];
  reportPath?: string;
}): ReviewReport {
  const retryWith = uniqueRetryWith(opts.retryWith);
  const issues = normalizeReviewIssues(opts.issues, {
    projectDir: opts.project,
    retryWith,
  });
  return stripUndefined({
    schemaVersion: "1",
    kind: "review",
    project: resolve(opts.project),
    mode: opts.mode,
    beat: opts.beat,
    status: opts.status,
    score: opts.score,
    issues,
    summary: summarizeReviewIssues(issues),
    nextActions: deriveNextReviewActions({ issues, retryWith, projectDir: opts.project }),
    retryWith,
    sourceReports: opts.sourceReports ?? [],
    reportPath: opts.reportPath,
  });
}

export function defaultReviewReportPath(projectDir: string): string {
  return join(resolve(projectDir), "review-report.json");
}

export async function writeReviewReport(
  path: string,
  report: Record<string, unknown>
): Promise<void> {
  await writeFile(path, JSON.stringify(report, null, 2) + "\n", "utf-8");
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function defaultActionsForIssue(issue: ReviewIssue, projectDir: string): ReviewAction[] {
  const code = issue.code;
  const beat = issue.beatId ?? issue.scene;
  const beatFlag = beat ? ` --beat ${beat}` : "";
  const sourceIssueCodes = [code];

  if (code === "PROJECT_NOT_FOUND" || code === "MISSING_STORYBOARD") {
    return [
      commandReviewAction(`vibe init ${projectDir} --from "<brief>" --json`, {
        label: "Initialize the project from a brief",
        fixOwner: "host-agent",
        reason: "The project cannot be inspected until the core project files exist.",
        sourceIssueCodes,
      }),
    ];
  }

  if (code === "MISSING_DESIGN" || code === "DESIGN_PLACEHOLDER_FIELD") {
    return [
      manualReviewAction({
        label: "Create or complete DESIGN.md",
        reason: "Visual direction needs host-agent or human input before VibeFrame can repair it.",
        sourceIssueCodes,
      }),
    ];
  }

  if (code === "BEAT_NOT_FOUND" || code.startsWith("STORYBOARD_")) {
    const actions = [
      commandReviewAction(`vibe storyboard validate ${projectDir} --json`, {
        label: "Validate the storyboard",
        fixOwner: "host-agent",
        reason: "The storyboard issue needs structured validation before editing.",
        sourceIssueCodes,
      }),
    ];
    if (code === "STORYBOARD_PLACEHOLDER_CUE") {
      actions.push(
        commandReviewAction(
          `vibe storyboard revise ${projectDir} --from "<make cues concrete>" --dry-run --json`,
          {
            label: "Preview a storyboard revision",
            fixOwner: "host-agent",
            reason: "Placeholder cues should be revised into concrete video intent.",
            sourceIssueCodes,
          }
        )
      );
    }
    return actions;
  }

  if (code === "MISSING_ROOT_COMPOSITION" || code === "ROOT_SYNC_CHECK_FAILED") {
    return [
      commandReviewAction(`vibe build ${projectDir} --stage sync --json`, {
        label: "Sync the project root composition",
        reason: "The root composition is missing or could not be verified.",
        sourceIssueCodes,
      }),
    ];
  }

  if (code.startsWith("ROOT_")) {
    return issue.fixOwner === "host-agent"
      ? [
          agentReviewAction({
            label: "Repair the root composition shell",
            agentPrompt: "Fix host-agent-owned root composition issues from review-report.json",
            reason: "The root composition cannot be repaired deterministically.",
            sourceIssueCodes,
          }),
        ]
      : [
          commandReviewAction(`vibe scene repair ${projectDir} --json`, {
            label: "Repair deterministic scene/root issues",
            reason: "The root composition has deterministic sync issues.",
            sourceIssueCodes,
          }),
          commandReviewAction(`vibe build ${projectDir} --stage sync --json`, {
            label: "Resync root composition after repair",
            reason: "The root composition should be synced after deterministic repair.",
            sourceIssueCodes,
          }),
        ];
  }

  if (code === "MISSING_COMPOSITION") {
    return [
      commandReviewAction(`vibe build ${projectDir}${beatFlag} --stage compose --json`, {
        label: beat ? `Compose beat ${beat}` : "Compose missing scenes",
        reason: "Missing scene compositions must be generated or authored before render.",
        sourceIssueCodes,
      }),
    ];
  }

  if (code === "MISSING_BUILD_REPORT") {
    return [
      commandReviewAction(`vibe build ${projectDir} --dry-run --json`, {
        label: "Preview the build plan",
        reason: "A dry-run build report is needed before choosing a paid or mutating build step.",
        sourceIssueCodes,
      }),
    ];
  }

  if (code === "BUILD_REPORT_BEAT_MISSING") {
    return [
      commandReviewAction(`vibe build ${projectDir}${beatFlag} --stage sync --json`, {
        label: beat ? `Sync build report for beat ${beat}` : "Sync the build report",
        reason: "The build report does not include the inspected beat.",
        sourceIssueCodes,
      }),
    ];
  }

  if (code === "MALFORMED_BUILD_REPORT") {
    return [
      commandReviewAction(`vibe build ${projectDir} --json`, {
        label: "Regenerate the build report",
        reason: "The existing build report cannot be parsed.",
        sourceIssueCodes,
      }),
    ];
  }

  if (
    code === "MISSING_REPORTED_ASSET" ||
    code === "STALE_ASSET" ||
    code === "UNKNOWN_ASSET_FRESHNESS"
  ) {
    return [
      commandReviewAction(`vibe build ${projectDir}${beatFlag} --stage assets --force --json`, {
        label: beat ? `Regenerate assets for beat ${beat}` : "Regenerate stale or missing assets",
        reason: "Asset generation may call providers, so the host should confirm first.",
        sourceIssueCodes,
      }),
    ];
  }

  if (code === "MUSIC_CUE_NOT_READY") {
    return [
      commandReviewAction(`vibe build ${projectDir}${beatFlag} --stage assets --json`, {
        label: beat ? `Generate music for beat ${beat}` : "Generate missing music assets",
        reason: "Music generation may call providers, so the host should confirm first.",
        sourceIssueCodes,
      }),
      commandReviewAction(`vibe build ${projectDir} --stage sync --json`, {
        label: "Sync music into the root composition",
        reason: "Generated music needs root composition wiring.",
        sourceIssueCodes,
      }),
    ];
  }

  if (code.startsWith("SCENE_LINT_")) {
    return [
      commandReviewAction(`vibe scene repair ${projectDir} --json`, {
        label: "Repair deterministic scene lint issues",
        reason: "Scene lint reported an issue VibeFrame may be able to repair mechanically.",
        sourceIssueCodes,
      }),
    ];
  }

  if (code === "RENDER_NOT_FOUND" || code === "EMPTY_RENDER") {
    return [
      commandReviewAction(
        beat
          ? `vibe render ${projectDir} --beat ${beat} --json`
          : `vibe render ${projectDir} --json`,
        {
          label: beat ? `Render beat ${beat}` : "Render the project",
          reason: "A render file is required before render inspection can pass.",
          sourceIssueCodes,
        }
      ),
    ];
  }

  if (code === "NO_AUDIO_STREAM" || code === "DURATION_DRIFT") {
    return [
      commandReviewAction(`vibe build ${projectDir}${beatFlag} --stage sync --json`, {
        label: beat ? `Sync timing/audio for beat ${beat}` : "Sync timing and audio wiring",
        reason: "The render output no longer matches synced project state.",
        sourceIssueCodes,
      }),
      commandReviewAction(
        beat
          ? `vibe render ${projectDir} --beat ${beat} --json`
          : `vibe render ${projectDir} --json`,
        {
          label: beat ? `Rerender beat ${beat}` : "Rerender the project",
          reason: "The render should be regenerated after sync repair.",
          sourceIssueCodes,
        }
      ),
    ];
  }

  if (code === "BLACK_FRAME_SEGMENT") {
    return issue.fixOwner === "host-agent"
      ? [
          agentReviewAction({
            label: beat ? `Fix black frames in beat ${beat}` : "Fix black frame segment",
            agentPrompt: "Fix black-frame issues from review-report.json, then rerender.",
            reason: "The issue likely needs scene, storyboard, or visual cue changes.",
            sourceIssueCodes,
          }),
        ]
      : [
          commandReviewAction(`vibe scene repair ${projectDir} --json`, {
            label: "Repair deterministic scene timing",
            reason: "Black frames outside a specific beat may be recoverable with scene repair.",
            sourceIssueCodes,
          }),
        ];
  }

  if (code === "STATIC_FRAME_SEGMENT") {
    return [
      agentReviewAction({
        label: beat ? `Add motion to beat ${beat}` : "Fix static visual hold",
        agentPrompt: "Fix static-frame issues from review-report.json, then rerender.",
        reason: "Static segments usually need creative scene, storyboard, or asset changes.",
        sourceIssueCodes,
      }),
    ];
  }

  if (code === "LONG_SILENCE") {
    return issue.fixOwner === "host-agent"
      ? [
          agentReviewAction({
            label: beat ? `Fix long silence in beat ${beat}` : "Fix long silence",
            agentPrompt: "Fix long-silence issues from review-report.json, then rerender.",
            reason: "The beat duration, narration, or music cue needs host-agent judgment.",
            sourceIssueCodes,
          }),
        ]
      : [
          commandReviewAction(`vibe build ${projectDir}${beatFlag} --stage sync --json`, {
            label: beat ? `Sync audio for beat ${beat}` : "Sync audio wiring",
            reason: "The silence may be caused by stale narration or music wiring.",
            sourceIssueCodes,
          }),
        ];
  }

  if (code.startsWith("AI_REVIEW_")) {
    return [
      agentReviewAction({
        label: "Fix AI review findings",
        agentPrompt: "Fix host-agent-owned AI review issues from review-report.json, then rerender.",
        reason: "AI review findings require storyboard, design, or composition judgment.",
        sourceIssueCodes,
      }),
    ];
  }

  if (code === "FFPROBE_UNAVAILABLE" || code === "FFMPEG_UNAVAILABLE") {
    return [
      manualReviewAction({
        label: "Install FFmpeg and rerun inspection",
        reason: "Local media inspection depends on ffmpeg/ffprobe being available.",
        fixOwner: "host-agent",
        sourceIssueCodes,
      }),
    ];
  }

  if (code === "FFPROBE_FAILED" || code === "NO_VIDEO_STREAM") {
    return [
      commandReviewAction(
        beat
          ? `vibe render ${projectDir} --beat ${beat} --json`
          : `vibe render ${projectDir} --json`,
        {
          label: beat ? `Rerender beat ${beat}` : "Rerender the project",
          reason: "The rendered media could not be probed as a valid video.",
          sourceIssueCodes,
        }
      ),
    ];
  }

  if (code === "ASPECT_MISMATCH") {
    return [
      manualReviewAction({
        label: "Check project aspect and render settings",
        reason: "Aspect mismatches can come from either config intent or render settings.",
        fixOwner: issue.fixOwner,
        sourceIssueCodes,
      }),
    ];
  }

  return [];
}

function classifyReviewCommand(command: string): {
  fixOwner: ReviewFixOwner;
  costTier: ReviewActionCostTier;
  safeToAutoRun: boolean;
  requiresConfirmation: boolean;
} {
  const lower = command.trim().toLowerCase();
  if (lower.startsWith("vibe status ")) return safe("free");
  if (lower.startsWith("vibe scene repair")) return safe("free");
  if (
    lower.startsWith("vibe storyboard validate") ||
    lower.startsWith("vibe storyboard get") ||
    lower.startsWith("vibe storyboard list")
  ) {
    return safe("free", "host-agent");
  }
  if (lower.startsWith("vibe inspect project")) return safe("free");
  if (lower.startsWith("vibe inspect render")) {
    if (lower.includes("--ai")) return unsafe("low");
    return safe("free");
  }
  if (lower.startsWith("vibe render ")) return safe("free");
  if (lower.startsWith("vibe build ")) {
    if (lower.includes("--dry-run")) return safe("free");
    if (lower.includes("--stage sync") || lower.includes("--stage render")) return safe("free");
    return unsafe("unknown");
  }
  if (
    lower.startsWith("vibe generate video") ||
    lower.startsWith("vibe edit fill-gaps") ||
    lower.startsWith("vibe remix ")
  ) {
    return unsafe("very-high");
  }
  if (lower.startsWith("vibe storyboard revise")) return unsafe("unknown", "host-agent");
  return unsafe("unknown");
}

function safe(costTier: ReviewActionCostTier, fixOwner: ReviewFixOwner = "vibe") {
  return { fixOwner, costTier, safeToAutoRun: true, requiresConfirmation: false };
}

function unsafe(costTier: ReviewActionCostTier, fixOwner: ReviewFixOwner = "vibe") {
  return { fixOwner, costTier, safeToAutoRun: false, requiresConfirmation: true };
}

function actionId(kind: ReviewActionKind, value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `${kind}:${slug || "action"}`;
}

function uniqueStrings(items: Array<string | undefined | null>): string[] {
  return [
    ...new Set(items.filter((item): item is string => typeof item === "string" && item.length > 0)),
  ];
}
