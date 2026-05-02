import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { runHyperframeLint, type PreparedHyperframeLintInput } from "@hyperframes/producer";

import {
  applyMechanicalFixes,
  discoverSceneFiles,
  filterSubCompFalsePositives,
  type FileFixResult,
  type FileLintResult,
  type LintFinding,
} from "./scene-lint.js";
import {
  scoreIssues,
  statusFromIssues,
  uniqueRetryWith,
  type ReviewIssue,
  type ReviewStatus,
} from "./review-report.js";

export interface SceneRepairOptions {
  projectDir: string;
  rootRel?: string;
  dryRun?: boolean;
  includeRoot?: boolean;
}

export interface SceneRepairResult {
  schemaVersion: "1";
  kind: "scene-repair";
  project: string;
  dryRun: boolean;
  status: ReviewStatus;
  score: number;
  fixed: FileFixResult[];
  wouldFix: FileFixResult[];
  remainingIssues: ReviewIssue[];
  files: FileLintResult[];
  retryWith: string[];
}

export async function executeSceneRepair(opts: SceneRepairOptions): Promise<SceneRepairResult> {
  const projectDir = resolve(opts.projectDir);
  const dryRun = opts.dryRun ?? false;
  const { root, subs } = await discoverSceneFiles({ projectDir, rootRel: opts.rootRel });
  const targets: Array<{ abs: string; isSub: boolean }> = [];
  if ((opts.includeRoot ?? true) && root) targets.push({ abs: root, isSub: false });
  for (const sub of subs) targets.push({ abs: sub, isSub: true });

  const fixed: FileFixResult[] = [];
  const wouldFix: FileFixResult[] = [];
  const files: FileLintResult[] = [];

  for (const target of targets) {
    const rel = relative(projectDir, target.abs) || target.abs;
    const html = await readFile(target.abs, "utf-8");
    const findings = lintHtml(html, rel, target.isSub);
    const { html: nextHtml, fixedCodes } = applyMechanicalFixes(html, findings);
    if (fixedCodes.length > 0) {
      const item = { file: rel, codes: fixedCodes };
      if (dryRun) {
        wouldFix.push(item);
      } else {
        await writeFile(target.abs, nextHtml, "utf-8");
        fixed.push(item);
      }
      files.push({
        file: rel,
        isSubComposition: target.isSub,
        findings: lintHtml(nextHtml, rel, target.isSub),
      });
    } else {
      files.push({ file: rel, isSubComposition: target.isSub, findings });
    }
  }

  const remainingIssues = lintFilesToIssues(files);
  const status = statusFromIssues(remainingIssues);
  const retryWith =
    status === "fail"
      ? [
          `vibe scene lint --project ${projectDir} --json`,
          "Edit remaining scene HTML findings with the host agent.",
        ]
      : [];

  return {
    schemaVersion: "1",
    kind: "scene-repair",
    project: projectDir,
    dryRun,
    status,
    score: scoreIssues(remainingIssues),
    fixed,
    wouldFix,
    remainingIssues,
    files,
    retryWith: uniqueRetryWith(retryWith),
  };
}

function lintHtml(html: string, rel: string, isSub: boolean): LintFinding[] {
  const prepared: PreparedHyperframeLintInput = {
    html,
    entryFile: rel,
    source: "projectDir",
  };
  const raw = runHyperframeLint(prepared);
  return filterSubCompFalsePositives(raw.findings as LintFinding[], isSub);
}

function lintFilesToIssues(files: FileLintResult[]): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  for (const file of files) {
    for (const finding of file.findings) {
      issues.push({
        severity: finding.severity,
        code: `SCENE_LINT_${finding.code}`,
        message: finding.message,
        file: file.file,
        suggestedFix: finding.fixHint ?? "Edit the scene HTML directly.",
      });
    }
  }
  return issues;
}
