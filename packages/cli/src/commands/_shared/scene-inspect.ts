import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

import { validateStoryboardMarkdown } from "./storyboard-edit.js";
import { readProjectConfig } from "./project-config.js";
import { runProjectLint } from "./scene-lint.js";
import {
  defaultReviewReportPath,
  scoreIssues,
  statusFromIssues,
  uniqueRetryWith,
  writeReviewReport,
  type ReviewIssue,
  type ReviewStatus,
} from "./review-report.js";

export interface ProjectInspectOptions {
  projectDir: string;
  beatId?: string;
  outputPath?: string;
  writeReport?: boolean;
}

export interface ProjectInspectResult {
  schemaVersion: "1";
  kind: "project";
  project: string;
  beat?: string;
  status: ReviewStatus;
  score: number;
  issues: ReviewIssue[];
  checks: {
    files: Record<string, boolean>;
    storyboard: {
      ok: boolean;
      beatCount: number;
    };
    compositions: {
      expected: number;
      found: number;
      missing: string[];
    };
    lint: {
      ok: boolean | null;
      errorCount: number;
      warningCount: number;
      infoCount: number;
    };
    buildReport: {
      exists: boolean;
      outputPath?: string;
    };
    assets: {
      checked: number;
      missing: string[];
    };
  };
  retryWith: string[];
  reportPath?: string;
}

export async function inspectProject(opts: ProjectInspectOptions): Promise<ProjectInspectResult> {
  const projectDir = resolve(opts.projectDir);
  const issues: ReviewIssue[] = [];
  const retryWith: string[] = [];
  const checks: ProjectInspectResult["checks"] = {
    files: {},
    storyboard: { ok: false, beatCount: 0 },
    compositions: { expected: 0, found: 0, missing: [] },
    lint: { ok: null, errorCount: 0, warningCount: 0, infoCount: 0 },
    buildReport: { exists: false },
    assets: { checked: 0, missing: [] },
  };

  if (!existsSync(projectDir) || !(await isDirectory(projectDir))) {
    issues.push({
      severity: "error",
      code: "PROJECT_NOT_FOUND",
      message: `Project directory not found: ${projectDir}`,
      suggestedFix: 'Run `vibe init <dir> --from "brief" --json` first.',
    });
    retryWith.push(`vibe init ${projectDir} --from "<brief>" --json`);
    return maybeWriteProjectReport(
      projectDir,
      opts,
      makeProjectResult(projectDir, issues, checks, retryWith)
    );
  }

  const coreFiles = {
    storyboard: join(projectDir, "STORYBOARD.md"),
    design: join(projectDir, "DESIGN.md"),
    config: join(projectDir, "vibe.config.json"),
    legacyConfig: join(projectDir, "vibe.project.yaml"),
    buildReport: join(projectDir, "build-report.json"),
    root: join(projectDir, "index.html"),
  };
  for (const [name, path] of Object.entries(coreFiles)) {
    checks.files[name] = existsSync(path);
  }

  let beatIds: string[] = [];
  let inspectedBeatIds: string[] = [];
  if (!checks.files.storyboard) {
    issues.push({
      severity: "error",
      code: "MISSING_STORYBOARD",
      message: "STORYBOARD.md is missing.",
      suggestedFix: "Run `vibe init --from` or create STORYBOARD.md.",
    });
    retryWith.push(`vibe init ${projectDir} --from "<brief>" --json`);
  } else {
    const storyboard = await readFile(coreFiles.storyboard, "utf-8");
    const validation = validateStoryboardMarkdown(storyboard);
    beatIds = validation.beats.map((beat) => beat.id);
    inspectedBeatIds = opts.beatId ? beatIds.filter((beatId) => beatId === opts.beatId) : beatIds;
    checks.storyboard = { ok: validation.ok, beatCount: validation.beats.length };
    for (const issue of validation.issues) {
      issues.push({
        severity: issue.severity,
        code: `STORYBOARD_${issue.code}`,
        message: issue.message,
        scene: issue.beatId,
        suggestedFix:
          "Run `vibe storyboard validate --json` and edit STORYBOARD.md or use `vibe storyboard set`.",
      });
    }
    if (!validation.ok) retryWith.push(`vibe storyboard validate ${projectDir} --json`);
    if (opts.beatId && inspectedBeatIds.length === 0) {
      issues.push({
        severity: "error",
        code: "BEAT_NOT_FOUND",
        message: `Beat "${opts.beatId}" was not found in STORYBOARD.md.`,
        suggestedFix: "Run `vibe storyboard validate --json` and choose an existing beat id.",
      });
      retryWith.push(`vibe storyboard validate ${projectDir} --json`);
    }
  }

  if (!checks.files.design) {
    issues.push({
      severity: "error",
      code: "MISSING_DESIGN",
      message: "DESIGN.md is missing.",
      suggestedFix: "Create DESIGN.md or rerun `vibe init --from` in a new project.",
    });
  }

  if (!checks.files.config) {
    const severity = checks.files.legacyConfig ? "info" : "warning";
    issues.push({
      severity,
      code: checks.files.legacyConfig ? "LEGACY_CONFIG_ONLY" : "MISSING_CONFIG",
      message: checks.files.legacyConfig
        ? "Only legacy vibe.project.yaml was found; vibe.config.json is the canonical config."
        : "vibe.config.json is missing; defaults will be used.",
      suggestedFix: "Run `vibe init --from` for new projects or add vibe.config.json.",
    });
  } else {
    await readProjectConfig(projectDir);
  }

  if (!checks.files.root) {
    issues.push({
      severity: "error",
      code: "MISSING_ROOT_COMPOSITION",
      message: "index.html root composition is missing.",
      suggestedFix: "Run `vibe build --stage sync --json`.",
    });
    retryWith.push(`vibe build ${projectDir} --stage sync --json`);
  }

  const compositionsDir = join(projectDir, "compositions");
  const existingComps = existsSync(compositionsDir)
    ? new Set(await listHtmlBasenames(compositionsDir))
    : new Set<string>();
  checks.compositions.expected = inspectedBeatIds.length;
  for (const beatId of inspectedBeatIds) {
    const file = `scene-${beatId}.html`;
    if (existingComps.has(file)) {
      checks.compositions.found++;
    } else {
      checks.compositions.missing.push(join("compositions", file));
      issues.push({
        severity: "error",
        code: "MISSING_COMPOSITION",
        message: `Composition for beat "${beatId}" is missing.`,
        file: join("compositions", file),
        scene: beatId,
        suggestedFix: "Run `vibe build --stage compose --json`.",
      });
    }
  }
  if (checks.compositions.missing.length > 0) {
    retryWith.push(
      `vibe build ${projectDir}${opts.beatId ? ` --beat ${opts.beatId}` : ""} --stage compose --json`
    );
  }

  if (!checks.files.buildReport) {
    issues.push({
      severity: "warning",
      code: "MISSING_BUILD_REPORT",
      message: "build-report.json is missing, so asset/render status is incomplete.",
      suggestedFix: "Run `vibe build --dry-run --json` or `vibe build --stage sync --json`.",
    });
    retryWith.push(`vibe build ${projectDir} --dry-run --json`);
  } else {
    await inspectBuildReport(projectDir, coreFiles.buildReport, opts.beatId, checks, issues, retryWith);
  }

  if (checks.files.root) {
    try {
      const lint = await runProjectLint({ projectDir });
      const lintFiles = opts.beatId
        ? lint.files.filter(
            (file) =>
              file.file === "index.html" ||
              file.file === join("compositions", `scene-${opts.beatId}.html`)
          )
        : lint.files;
      const lintCounts = countLintFindings(lintFiles);
      checks.lint = {
        ok: lintCounts.errorCount === 0,
        errorCount: lintCounts.errorCount,
        warningCount: lintCounts.warningCount,
        infoCount: lintCounts.infoCount,
      };
      for (const file of lintFiles) {
        for (const finding of file.findings) {
          issues.push({
            severity: finding.severity,
            code: `SCENE_LINT_${finding.code}`,
            message: finding.message,
            file: file.file,
            suggestedFix:
              finding.fixHint ?? "Run `vibe scene repair --json` or edit the scene HTML.",
          });
        }
      }
      if (lintCounts.errorCount > 0) retryWith.push(`vibe scene repair --project ${projectDir} --json`);
    } catch (error) {
      issues.push({
        severity: "error",
        code: "SCENE_LINT_FAILED",
        message: `Scene lint failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return maybeWriteProjectReport(
    projectDir,
    opts,
    makeProjectResult(projectDir, issues, checks, retryWith, opts.beatId)
  );
}

function makeProjectResult(
  projectDir: string,
  issues: ReviewIssue[],
  checks: ProjectInspectResult["checks"],
  retryWith: string[],
  beatId?: string
): ProjectInspectResult {
  const status = statusFromIssues(issues);
  return {
    schemaVersion: "1",
    kind: "project",
    project: projectDir,
    ...(beatId ? { beat: beatId } : {}),
    status,
    score: scoreIssues(issues),
    issues,
    checks,
    retryWith: uniqueRetryWith(retryWith),
  };
}

async function maybeWriteProjectReport(
  projectDir: string,
  opts: ProjectInspectOptions,
  result: ProjectInspectResult
): Promise<ProjectInspectResult> {
  if (opts.writeReport === false) return result;
  const reportPath = opts.outputPath
    ? resolve(process.cwd(), opts.outputPath)
    : defaultReviewReportPath(projectDir);
  try {
    const withPath = { ...result, reportPath };
    await writeReviewReport(reportPath, withPath as unknown as Record<string, unknown>);
    return withPath;
  } catch {
    return result;
  }
}

async function inspectBuildReport(
  projectDir: string,
  reportPath: string,
  beatId: string | undefined,
  checks: ProjectInspectResult["checks"],
  issues: ReviewIssue[],
  retryWith: string[]
): Promise<void> {
  checks.buildReport.exists = true;
  try {
    const report = JSON.parse(await readFile(reportPath, "utf-8")) as {
      outputPath?: unknown;
      beats?: Array<{
        id?: unknown;
        narrationPath?: unknown;
        backdropPath?: unknown;
        videoPath?: unknown;
        musicPath?: unknown;
        compositionPath?: unknown;
        narration?: { path?: unknown };
        backdrop?: { path?: unknown };
        video?: { path?: unknown };
        music?: { path?: unknown };
      }>;
      jobs?: Array<{
        id?: unknown;
        beatId?: unknown;
        outputPath?: unknown;
        cachePath?: unknown;
      }>;
    };
    if (typeof report.outputPath === "string") checks.buildReport.outputPath = report.outputPath;
    const reportBeats = report.beats ?? [];
    const selectedReportBeats = reportBeats.filter((item) => !beatId || item.id === beatId);
    if (beatId && selectedReportBeats.length === 0) {
      issues.push({
        severity: "warning",
        code: "BUILD_REPORT_BEAT_MISSING",
        message: `build-report.json does not contain beat "${beatId}".`,
        file: "build-report.json",
        scene: beatId,
        suggestedFix: "Rerun the selected beat build.",
      });
      retryWith.push(`vibe build ${projectDir} --beat ${beatId} --stage sync --json`);
    }
    for (const beat of selectedReportBeats) {
      const id = typeof beat.id === "string" ? beat.id : undefined;
      for (const key of [
        "narrationPath",
        "backdropPath",
        "videoPath",
        "musicPath",
        "compositionPath",
      ] as const) {
        inspectReportedAsset({
          projectDir,
          value: beat[key],
          label: key,
          scene: id,
          checks,
          issues,
          retryWith,
        });
      }
      for (const [label, value] of [
        ["narration.path", beat.narration?.path],
        ["backdrop.path", beat.backdrop?.path],
        ["video.path", beat.video?.path],
        ["music.path", beat.music?.path],
      ] as const) {
        inspectReportedAsset({
          projectDir,
          value,
          label,
          scene: id,
          checks,
          issues,
          retryWith,
        });
      }
    }
    for (const job of (report.jobs ?? []).filter((item) => {
      const jobBeatId = typeof item.beatId === "string" ? item.beatId : undefined;
      return !beatId || jobBeatId === beatId;
    })) {
      const id = typeof job.id === "string" ? job.id : undefined;
      const beatId = typeof job.beatId === "string" ? job.beatId : undefined;
      for (const key of ["outputPath", "cachePath"] as const) {
        inspectReportedAsset({
          projectDir,
          value: job[key],
          label: id ? `job ${id} ${key}` : `job ${key}`,
          scene: beatId,
          checks,
          issues,
          retryWith,
        });
      }
    }
  } catch (error) {
    issues.push({
      severity: "warning",
      code: "MALFORMED_BUILD_REPORT",
      message: `build-report.json could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      file: "build-report.json",
      suggestedFix: "Rerun `vibe build --json`.",
    });
    retryWith.push(`vibe build ${projectDir} --json`);
  }
}

function inspectReportedAsset(opts: {
  projectDir: string;
  value: unknown;
  label: string;
  scene?: string;
  checks: ProjectInspectResult["checks"];
  issues: ReviewIssue[];
  retryWith: string[];
}): void {
  if (typeof opts.value !== "string" || opts.value.length === 0) return;
  opts.checks.assets.checked++;
  if (isExternalRef(opts.value)) return;
  const abs = isAbsolute(opts.value) ? opts.value : resolve(opts.projectDir, opts.value);
  if (existsSync(abs)) return;
  opts.checks.assets.missing.push(opts.value);
  opts.issues.push({
    severity: "warning",
    code: "MISSING_REPORTED_ASSET",
    message: `Build report references a missing ${opts.label}: ${opts.value}`,
    file: opts.value,
    scene: opts.scene,
    suggestedFix: "Rerun the relevant build stage with --force.",
  });
  opts.retryWith.push(
    `vibe build ${opts.projectDir}${opts.scene ? ` --beat ${opts.scene}` : ""} --stage assets --force --json`
  );
}

function countLintFindings(files: Array<{ findings: Array<{ severity: string }> }>): {
  errorCount: number;
  warningCount: number;
  infoCount: number;
} {
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  for (const file of files) {
    for (const finding of file.findings) {
      if (finding.severity === "error") errorCount++;
      else if (finding.severity === "warning") warningCount++;
      else infoCount++;
    }
  }
  return { errorCount, warningCount, infoCount };
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function listHtmlBasenames(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => entry.name);
}

function isExternalRef(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^data:/i.test(value);
}

export function displayIssue(issue: ReviewIssue): string {
  const file = issue.file
    ? ` ${relative(process.cwd(), resolve(issue.file)) || basename(issue.file)}`
    : "";
  return `[${issue.severity}] ${issue.code}${file}: ${issue.message}`;
}
