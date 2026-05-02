import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type ReviewSeverity = "error" | "warning" | "info";
export type ReviewStatus = "pass" | "warn" | "fail";
export type ReviewMode = "project" | "render";
export type ReviewFixOwner = "vibe" | "host-agent";

export interface ReviewIssue {
  severity: ReviewSeverity;
  code: string;
  message: string;
  file?: string;
  scene?: string;
  beatId?: string;
  fixOwner?: ReviewFixOwner;
  suggestedFix?: string;
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
  fallbackOwner?: ReviewFixOwner
): ReviewIssue[] {
  return issues.map((issue) => ({
    ...issue,
    fixOwner: issue.fixOwner ?? fallbackOwner ?? fixOwnerForIssue(issue),
  }));
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
  const issues = normalizeReviewIssues(opts.issues);
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
    retryWith: uniqueRetryWith(opts.retryWith),
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
