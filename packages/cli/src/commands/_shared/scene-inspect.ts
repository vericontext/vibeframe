import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

import { validateStoryboardMarkdown } from "./storyboard-edit.js";
import type { Beat } from "./storyboard-parse.js";
import { readProjectConfig } from "./project-config.js";
import { runProjectLint } from "./scene-lint.js";
import { createProjectRootSyncPlan } from "./root-sync.js";
import {
  buildReviewReport,
  defaultReviewReportPath,
  deriveNextReviewActions,
  normalizeReviewIssues,
  scoreIssues,
  statusFromIssues,
  summarizeReviewIssues,
  uniqueRetryWith,
  writeReviewReport,
  type ReviewAction,
  type ReviewIssue,
  type ReviewSummary,
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
  mode: "project";
  project: string;
  beat?: string;
  status: ReviewStatus;
  score: number;
  issues: ReviewIssue[];
  summary: ReviewSummary;
  nextActions: ReviewAction[];
  sourceReports: string[];
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
      stale: string[];
      unknownFreshness: string[];
    };
    rootSync: {
      ok: boolean | null;
      issueCount: number;
      issues: string[];
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
    assets: { checked: 0, missing: [], stale: [], unknownFreshness: [] },
    rootSync: { ok: null, issueCount: 0, issues: [] },
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
  let storyboardBeats: Beat[] = [];
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
    storyboardBeats = validation.beats;
    beatIds = validation.beats.map((beat) => beat.id);
    inspectedBeatIds = opts.beatId ? beatIds.filter((beatId) => beatId === opts.beatId) : beatIds;
    checks.storyboard = { ok: validation.ok, beatCount: validation.beats.length };
    for (const issue of validation.issues) {
      issues.push({
        severity: issue.severity,
        code: `STORYBOARD_${issue.code}`,
        message: issue.message,
        scene: issue.beatId,
        beatId: issue.beatId,
        suggestedFix:
          "Run `vibe storyboard validate --json` and edit STORYBOARD.md or use `vibe storyboard set`.",
      });
    }
    const placeholderIssues = storyboardPlaceholderIssues(storyboard);
    for (const issue of placeholderIssues) {
      issues.push(issue);
      retryWith.push(
        `vibe storyboard revise ${projectDir} --from "<make cues concrete>" --dry-run --json`
      );
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
  } else {
    const design = await readFile(coreFiles.design, "utf-8");
    for (const issue of designPlaceholderIssues(design)) {
      issues.push(issue);
    }
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
        beatId,
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
    await inspectBuildReport(
      projectDir,
      coreFiles.buildReport,
      opts.beatId,
      checks,
      issues,
      retryWith,
      storyboardBeats
    );
  }

  if (checks.files.root && checks.files.storyboard) {
    try {
      const rootSync = await createProjectRootSyncPlan({ projectDir });
      checks.rootSync = {
        ok: rootSync.issues.length === 0,
        issueCount: rootSync.issues.length,
        issues: rootSync.issues.map((issue) => issue.code),
      };
      if (rootSync.issues.length > 0) {
        issues.push(...rootSync.issues);
        if (rootSync.issues.some((issue) => issue.fixOwner === "vibe")) {
          retryWith.push(
            `vibe scene repair ${projectDir} --json`,
            `vibe build ${projectDir} --stage sync --json`
          );
        }
      }
    } catch (error) {
      issues.push({
        severity: "warning",
        code: "ROOT_SYNC_CHECK_FAILED",
        message: `Root sync check failed: ${error instanceof Error ? error.message : String(error)}`,
        file: "index.html",
        suggestedFix: "Run `vibe build --stage sync --json`.",
      });
    }
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
      if (lintCounts.errorCount > 0) retryWith.push(`vibe scene repair ${projectDir} --json`);
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
  const normalizedRetryWith = uniqueRetryWith(retryWith);
  const normalizedIssues = normalizeReviewIssues(issues, {
    projectDir,
    retryWith: normalizedRetryWith,
  });
  const status = statusFromIssues(normalizedIssues);
  return {
    schemaVersion: "1",
    kind: "project",
    mode: "project",
    project: projectDir,
    ...(beatId ? { beat: beatId } : {}),
    status,
    score: scoreIssues(normalizedIssues),
    issues: normalizedIssues,
    summary: summarizeReviewIssues(normalizedIssues),
    nextActions: deriveNextReviewActions({
      issues: normalizedIssues,
      retryWith: normalizedRetryWith,
      projectDir,
    }),
    sourceReports: projectSourceReports(checks),
    checks,
    retryWith: normalizedRetryWith,
  };
}

function storyboardPlaceholderIssues(storyboard: string): ReviewIssue[] {
  const patterns: Array<[RegExp, string]> = [
    [
      /Open with the viewer's problem/i,
      "Storyboard narration still contains the starter hook placeholder.",
    ],
    [
      /clearest promise from the brief/i,
      "Storyboard narration still refers to the brief instead of the actual video promise.",
    ],
    [
      /Show the mechanism that makes the promise believable/i,
      "Storyboard narration still contains the starter proof placeholder.",
    ],
    [
      /Close with the action or idea the viewer should remember/i,
      "Storyboard narration still contains the starter close placeholder.",
    ],
    [
      /for:\s*\d+[- ]?second/i,
      "Storyboard backdrop cues still contain the raw generated template shape.",
    ],
  ];
  return patterns
    .filter(([pattern]) => pattern.test(storyboard))
    .map(([, message]) => ({
      severity: "warning" as const,
      code: "STORYBOARD_PLACEHOLDER_CUE",
      message,
      file: "STORYBOARD.md",
      fixOwner: "host-agent" as const,
      suggestedFix:
        "Revise STORYBOARD.md so narration, backdrop, and motion cues describe the actual video.",
    }));
}

function designPlaceholderIssues(design: string): ReviewIssue[] {
  const patterns: Array<[RegExp, string]> = [
    [/_hex_/, "DESIGN.md still contains placeholder palette entries."],
    [/_anti-pattern \d_/, "DESIGN.md still contains placeholder anti-pattern entries."],
    [/_One family, two weights/i, "DESIGN.md still contains placeholder typography guidance."],
    [/_Grid\? Centered\? Layered\?/i, "DESIGN.md still contains placeholder composition guidance."],
    [/_How fast\? Snappy or fluid\?/i, "DESIGN.md still contains placeholder motion guidance."],
  ];
  return patterns
    .filter(([pattern]) => pattern.test(design))
    .map(([, message]) => ({
      severity: "warning" as const,
      code: "DESIGN_PLACEHOLDER_FIELD",
      message,
      file: "DESIGN.md",
      fixOwner: "host-agent" as const,
      suggestedFix:
        "Fill DESIGN.md or rerun `vibe init --from ... --visual-style <name>` in a clean project.",
    }));
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
    const reviewReport = buildReviewReport({
      project: projectDir,
      mode: "project",
      beat: result.beat,
      status: result.status,
      score: result.score,
      issues: result.issues,
      retryWith: result.retryWith,
      sourceReports: result.sourceReports,
      reportPath,
    });
    await writeReviewReport(reportPath, reviewReport as unknown as Record<string, unknown>);
    return { ...result, reportPath };
  } catch {
    return result;
  }
}

function projectSourceReports(checks: ProjectInspectResult["checks"]): string[] {
  const reports: string[] = [];
  if (checks.files.storyboard) reports.push("STORYBOARD.md");
  if (checks.files.design) reports.push("DESIGN.md");
  if (checks.files.config) reports.push("vibe.config.json");
  if (checks.files.root) reports.push("index.html");
  if (checks.buildReport.exists) reports.push("build-report.json");
  if (checks.rootSync.ok !== null) reports.push("root-sync");
  if (checks.lint.ok !== null) reports.push("scene-lint");
  return reports;
}

async function inspectBuildReport(
  projectDir: string,
  reportPath: string,
  beatId: string | undefined,
  checks: ProjectInspectResult["checks"],
  issues: ReviewIssue[],
  retryWith: string[],
  storyboardBeats: Beat[]
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
        narrationStatus?: unknown;
        backdropStatus?: unknown;
        videoStatus?: unknown;
        musicStatus?: unknown;
        narration?: BuildReportAsset;
        backdrop?: BuildReportAsset;
        video?: BuildReportAsset;
        music?: BuildReportAsset;
        composition?: { path?: unknown };
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
        beatId,
        suggestedFix: "Rerun the selected beat build.",
      });
      retryWith.push(`vibe build ${projectDir} --beat ${beatId} --stage sync --json`);
    }
    for (const beat of selectedReportBeats) {
      const id = typeof beat.id === "string" ? beat.id : undefined;
      const storyboardBeat = id ? storyboardBeats.find((item) => item.id === id) : undefined;
      inspectAssetFreshness({
        projectDir,
        beatId: id,
        kind: "narration",
        asset: beat.narration,
        checks,
        issues,
        retryWith,
      });
      inspectAssetFreshness({
        projectDir,
        beatId: id,
        kind: "backdrop",
        asset: beat.backdrop,
        checks,
        issues,
        retryWith,
      });
      inspectAssetFreshness({
        projectDir,
        beatId: id,
        kind: "video",
        asset: beat.video,
        checks,
        issues,
        retryWith,
      });
      inspectAssetFreshness({
        projectDir,
        beatId: id,
        kind: "music",
        asset: beat.music,
        checks,
        issues,
        retryWith,
      });
      inspectCueReadiness({
        projectDir,
        beatId: id,
        storyboardBeat,
        beat,
        checks,
        issues,
        retryWith,
      });
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
        ["narration.sourcePath", beat.narration?.sourcePath],
        ["backdrop.sourcePath", beat.backdrop?.sourcePath],
        ["video.sourcePath", beat.video?.sourcePath],
        ["music.sourcePath", beat.music?.sourcePath],
        ["composition.path", beat.composition?.path],
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
    beatId: opts.scene,
    suggestedFix: "Rerun the relevant build stage with --force.",
  });
  opts.retryWith.push(
    `vibe build ${opts.projectDir}${opts.scene ? ` --beat ${opts.scene}` : ""} --stage assets --force --json`
  );
}

interface BuildReportAsset {
  path?: unknown;
  sourcePath?: unknown;
  status?: unknown;
  freshness?: unknown;
  metadataPath?: unknown;
}

function inspectAssetFreshness(opts: {
  projectDir: string;
  beatId?: string;
  kind: "narration" | "backdrop" | "video" | "music";
  asset?: BuildReportAsset;
  checks: ProjectInspectResult["checks"];
  issues: ReviewIssue[];
  retryWith: string[];
}): void {
  const freshness = typeof opts.asset?.freshness === "string" ? opts.asset.freshness : undefined;
  if (freshness !== "stale" && freshness !== "unknown") return;
  const label = `${opts.kind}${opts.beatId ? ` for beat "${opts.beatId}"` : ""}`;
  const path =
    typeof opts.asset?.path === "string"
      ? opts.asset.path
      : typeof opts.asset?.sourcePath === "string"
        ? opts.asset.sourcePath
        : `${opts.kind}:${opts.beatId ?? "unknown"}`;
  if (freshness === "stale") {
    opts.checks.assets.stale.push(path);
  } else {
    opts.checks.assets.unknownFreshness.push(path);
  }
  opts.issues.push({
    severity: "warning",
    code: freshness === "stale" ? "STALE_ASSET" : "UNKNOWN_ASSET_FRESHNESS",
    message:
      freshness === "stale"
        ? `Build report marks ${label} as stale against the current cue.`
        : `Build report cannot prove freshness for ${label}.`,
    file: typeof opts.asset?.metadataPath === "string" ? opts.asset.metadataPath : undefined,
    scene: opts.beatId,
    beatId: opts.beatId,
    fixOwner: "vibe",
    suggestedFix: "Rerun the relevant assets stage with --force.",
  });
  opts.retryWith.push(
    `vibe build ${opts.projectDir}${opts.beatId ? ` --beat ${opts.beatId}` : ""} --stage assets --force --json`
  );
}

function inspectCueReadiness(opts: {
  projectDir: string;
  beatId?: string;
  storyboardBeat?: Beat;
  beat: {
    musicPath?: unknown;
    musicStatus?: unknown;
    music?: BuildReportAsset;
  };
  checks: ProjectInspectResult["checks"];
  issues: ReviewIssue[];
  retryWith: string[];
}): void {
  if (!opts.beatId || typeof opts.storyboardBeat?.cues?.music !== "string") return;
  const nestedPath = typeof opts.beat.music?.path === "string" ? opts.beat.music.path : undefined;
  const legacyPath = typeof opts.beat.musicPath === "string" ? opts.beat.musicPath : undefined;
  const status =
    typeof opts.beat.music?.status === "string"
      ? opts.beat.music.status
      : typeof opts.beat.musicStatus === "string"
        ? opts.beat.musicStatus
        : undefined;
  if ((nestedPath || legacyPath) && status !== "pending" && status !== "failed") return;
  opts.issues.push({
    severity: "warning",
    code: "MUSIC_CUE_NOT_READY",
    message: `Beat "${opts.beatId}" declares a music cue, but build-report.json does not contain ready music audio.`,
    file: "build-report.json",
    scene: opts.beatId,
    beatId: opts.beatId,
    fixOwner: "vibe",
    suggestedFix: "Run `vibe build --stage assets --json` without --skip-music, then rerun sync.",
  });
  opts.retryWith.push(
    `vibe build ${opts.projectDir} --beat ${opts.beatId} --stage assets --json`,
    `vibe build ${opts.projectDir} --stage sync --json`
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
