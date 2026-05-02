import { createHash, randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";

import { executeVideoStatus } from "../ai-video.js";
import { executeMusicStatus } from "../generate/music-status.js";
import { parseStoryboard } from "./storyboard-parse.js";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "unknown";
export type JobType = "generate-video" | "generate-music";
export type ProjectWorkflowStatus =
  | "empty"
  | "ready"
  | "running"
  | "needs-author"
  | "failed"
  | "done"
  | "warn";
export type ProjectCurrentStage =
  | "init"
  | "assets"
  | "compose"
  | "sync"
  | "render"
  | "review"
  | "done";

export interface JobRecord {
  schemaVersion: "1";
  id: string;
  jobType: JobType;
  status: JobStatus;
  providerStatus?: string;
  createdAt: string;
  updatedAt: string;
  projectDir: string;
  workingDirectory: string;
  command: string;
  provider: string;
  providerTaskId: string;
  providerTaskType?: "text2video" | "image2video";
  progress?: number;
  resultUrl?: string;
  beatId?: string;
  outputPath?: string;
  cachePath?: string;
  error?: string;
  promptPreview?: string;
  retryWith: string[];
}

export interface CreateJobRecordOptions {
  id?: string;
  now?: Date;
  jobType: JobType;
  status?: JobStatus;
  provider: string;
  providerTaskId: string;
  providerTaskType?: "text2video" | "image2video";
  projectDir?: string;
  workingDirectory?: string;
  command: string;
  prompt?: string;
  progress?: number;
  resultUrl?: string;
  beatId?: string;
  outputPath?: string;
  cachePath?: string;
  error?: string;
}

export interface RefreshJobOptions {
  wait?: boolean;
  output?: string;
  workingDirectory?: string;
  write?: boolean;
}

export interface JobStatusResult {
  schemaVersion: "1";
  kind: "job";
  id: string;
  jobType: JobType;
  status: JobStatus;
  provider: string;
  providerTaskId: string;
  providerTaskType?: "text2video" | "image2video";
  createdAt: string;
  updatedAt: string;
  progress?: JobProgress;
  result: JobResult | null;
  job: JobRecord;
  refreshed: boolean;
  live: {
    supported: boolean;
    error?: string;
  };
  warnings: string[];
  retryWith: string[];
}

export interface ProjectStatusResult {
  schemaVersion: "1";
  kind: "project";
  project: string;
  status: ProjectWorkflowStatus;
  currentStage: ProjectCurrentStage;
  beats: ProjectBeatReadiness;
  build: BuildSummary | null;
  review: ReviewSummary | null;
  jobs: {
    total: number;
    active: number;
    completed: number;
    failed: number;
    cancelled: number;
    unknown: number;
    latest: JobSummary[];
  };
  warnings: string[];
  retryWith: string[];
}

export interface BuildSummary {
  reportPath: string;
  kind?: string;
  success?: boolean;
  phase?: string;
  status?: string;
  currentStage?: string;
  selectedStage?: string;
  outputPath?: string;
  estimatedCostUsd?: number;
  costUsd?: number;
  beats?: ProjectBeatReadiness;
  updatedAt?: string;
  warnings: unknown[];
  retryWith: string[];
}

export interface ReviewSummary {
  reportPath: string;
  kind?: string;
  mode?: string;
  status?: string;
  score?: number;
  issueCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  fixOwners: {
    vibe: number;
    hostAgent: number;
  };
  sourceReports: string[];
  updatedAt?: string;
  retryWith: string[];
}

export interface JobSummary {
  id: string;
  jobType: JobType;
  status: JobStatus;
  provider: string;
  providerTaskId: string;
  providerTaskType?: string;
  progress?: number;
  resultUrl?: string;
  beatId?: string;
  outputPath?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  retryWith: string[];
}

export interface JobProgress {
  percent?: number;
  phase: string;
  providerStatus?: string;
}

export interface JobResult {
  url?: string;
  outputPath?: string;
  cachePath?: string;
  error?: string;
}

export interface ProjectBeatReadiness {
  total: number;
  assetsReady: number;
  compositionsReady: number;
  needsAuthor: string[];
}

export function findProjectRoot(start = process.cwd()): string {
  let dir = resolve(start);
  try {
    if (existsSync(dir) && statSync(dir).isFile()) dir = dirname(dir);
  } catch {
    // Keep the resolved path and walk upward.
  }

  for (;;) {
    if (existsSync(join(dir, "vibe.config.json")) || existsSync(join(dir, "STORYBOARD.md"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

export function jobsDir(projectDir: string): string {
  return join(resolve(projectDir), ".vibeframe", "jobs");
}

export function normalizeJobStatus(status: unknown): JobStatus {
  const value = String(status ?? "").toLowerCase();
  if (value === "completed" || value === "succeeded" || value === "success") return "completed";
  if (value === "failed" || value === "error") return "failed";
  if (value === "cancelled" || value === "canceled") return "cancelled";
  if (value === "queued" || value === "pending") return "queued";
  if (
    value === "running" ||
    value === "processing" ||
    value === "in_progress" ||
    value === "started"
  )
    return "running";
  return "unknown";
}

export function createJobRecord(opts: CreateJobRecordOptions): JobRecord {
  const now = opts.now ?? new Date();
  const projectDir = resolve(
    opts.projectDir ?? findProjectRoot(opts.workingDirectory ?? process.cwd())
  );
  const workingDirectory = resolve(opts.workingDirectory ?? process.cwd());
  const id = opts.id ?? makeJobId(opts.providerTaskId, now);
  const base: JobRecord = {
    schemaVersion: "1",
    id,
    jobType: opts.jobType,
    status: opts.status ?? "running",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    projectDir,
    workingDirectory,
    command: opts.command,
    provider: opts.provider,
    providerTaskId: opts.providerTaskId,
    providerTaskType: opts.providerTaskType,
    progress: opts.progress,
    resultUrl: opts.resultUrl,
    beatId: opts.beatId,
    outputPath: opts.outputPath,
    cachePath: opts.cachePath,
    error: opts.error,
    promptPreview: previewPrompt(opts.prompt),
    retryWith: [],
  };
  base.retryWith = retryWithForJob(base);
  return stripUndefined(base);
}

export async function createAndWriteJobRecord(opts: CreateJobRecordOptions): Promise<JobRecord> {
  const record = createJobRecord(opts);
  await writeJobRecord(record);
  return record;
}

export async function writeJobRecord(record: JobRecord): Promise<void> {
  const dir = jobsDir(record.projectDir);
  await mkdir(dir, { recursive: true });
  await writeFile(
    jobRecordPath(record.id, record.projectDir),
    JSON.stringify(stripUndefined(record), null, 2) + "\n",
    "utf-8"
  );
}

export async function readJobRecord(jobId: string, projectDir?: string): Promise<JobRecord | null> {
  const id = normalizeJobId(jobId);
  const project = resolve(projectDir ?? findProjectRoot());
  const path = jobRecordPath(id, project);
  if (!existsSync(path)) return null;
  return parseJobRecord(await readFile(path, "utf-8"));
}

export async function listJobRecords(projectDir: string): Promise<JobRecord[]> {
  const dir = jobsDir(projectDir);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const records: JobRecord[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const parsed = parseJobRecord(await readFile(join(dir, entry.name), "utf-8"));
      if (parsed) records.push(parsed);
    } catch {
      // Ignore malformed job files; status project should stay useful.
    }
  }
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function refreshJobRecord(
  record: JobRecord,
  opts: RefreshJobOptions = {}
): Promise<JobStatusResult> {
  const warnings: string[] = [];
  const live = liveSupport(record);
  if (!live.supported) {
    warnings.push(
      `Live status is not supported for ${record.provider} ${record.jobType} jobs yet.`
    );
    return makeJobStatusResult(record, {
      refreshed: false,
      live,
      warnings,
    });
  }

  let updated = record;
  try {
    if (record.jobType === "generate-video") {
      const output = resolveRefreshOutput(record, opts);
      if (output) await mkdir(dirname(output), { recursive: true });
      const result = await executeVideoStatus({
        taskId: record.providerTaskId,
        provider: record.provider as "runway" | "kling",
        taskType: record.providerTaskType as "text2video" | "image2video" | undefined,
        wait: opts.wait,
        output,
      });
      if (!result.success) throw new Error(result.error ?? "Video status check failed");
      updated = updateRecordFromProvider(record, {
        status: result.status,
        progress: result.progress,
        resultUrl: result.videoUrl,
        outputPath: result.outputPath,
        error: result.error,
      });
      await maybeCacheOutput(updated);
    } else if (record.jobType === "generate-music") {
      const result = await refreshMusicStatus(record.providerTaskId, opts.wait);
      if (!result.success) throw new Error(result.error ?? "Music status check failed");
      let outputPath: string | undefined;
      const output = resolveRefreshOutput(record, opts);
      if (output && result.audioUrl) {
        outputPath = await downloadUrl(result.audioUrl, output);
      }
      updated = updateRecordFromProvider(record, {
        status: result.status,
        resultUrl: result.audioUrl,
        outputPath,
        error: result.error,
      });
      await maybeCacheOutput(updated);
    }
    if (opts.write !== false) await writeJobRecord(updated);
    return makeJobStatusResult(updated, {
      refreshed: true,
      live,
      warnings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(message);
    return makeJobStatusResult(record, {
      refreshed: false,
      live: { ...live, error: message },
      warnings,
    });
  }
}

export async function inspectProjectStatus(
  projectDirArg: string,
  opts: { refresh?: boolean } = {}
): Promise<ProjectStatusResult> {
  const project = resolve(projectDirArg);
  const warnings: string[] = [];
  let records = await listJobRecords(project);
  if (opts.refresh) {
    const refreshed: JobRecord[] = [];
    for (const record of records) {
      if (!isActiveStatus(record.status)) {
        refreshed.push(record);
        continue;
      }
      const result = await refreshJobRecord(record, { write: true });
      warnings.push(...result.warnings);
      refreshed.push(result.job);
    }
    records = refreshed.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  const build = await readBuildSummary(project);
  const review = await readReviewSummary(project);
  const beats = await readProjectBeatReadiness(project, build, records);
  const jobs = summarizeJobs(records);
  const workflow = deriveProjectWorkflow({ project, build, review, beats, jobs });
  const retryWith = [
    `vibe status project ${project} --json`,
    ...records
      .filter((record) => isActiveStatus(record.status))
      .map((record) => `vibe status job ${record.id} --project ${project} --json`),
    ...(records.some((record) => isActiveStatus(record.status))
      ? [`vibe status project ${project} --refresh --json`]
      : []),
    ...(build?.retryWith ?? []),
    ...(review?.retryWith ?? []),
    ...workflow.retryWith,
  ];

  return {
    schemaVersion: "1",
    kind: "project",
    project,
    status: workflow.status,
    currentStage: workflow.currentStage,
    beats,
    build,
    review,
    jobs,
    warnings,
    retryWith: unique(retryWith),
  };
}

export function summarizeJob(record: JobRecord): JobSummary {
  return stripUndefined({
    id: record.id,
    jobType: record.jobType,
    status: record.status,
    provider: record.provider,
    providerTaskId: record.providerTaskId,
    providerTaskType: record.providerTaskType,
    progress: record.progress,
    resultUrl: record.resultUrl,
    beatId: record.beatId,
    outputPath: record.outputPath,
    error: record.error,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    retryWith: retryWithForJob(record),
  });
}

export function retryWithForJob(record: JobRecord): string[] {
  return unique([
    `vibe status job ${record.id} --project ${record.projectDir} --json`,
    providerStatusCommand(record),
  ]);
}

export function makeJobStatusResult(
  record: JobRecord,
  opts: {
    refreshed: boolean;
    live: { supported: boolean; error?: string };
    warnings?: string[];
  }
): JobStatusResult {
  return stripUndefined({
    schemaVersion: "1" as const,
    kind: "job" as const,
    id: record.id,
    jobType: record.jobType,
    status: record.status,
    provider: record.provider,
    providerTaskId: record.providerTaskId,
    providerTaskType: record.providerTaskType,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    progress: jobProgress(record),
    result: jobResult(record),
    job: record,
    refreshed: opts.refreshed,
    live: opts.live,
    warnings: opts.warnings ?? [],
    retryWith: retryWithForJob(record),
  });
}

function jobProgress(record: JobRecord): JobProgress | undefined {
  if (
    record.status === "completed" ||
    record.status === "failed" ||
    record.status === "cancelled"
  ) {
    if (record.progress === undefined && !record.providerStatus) return undefined;
  }
  return stripUndefined({
    percent: record.progress,
    phase: record.providerStatus ?? statusPhase(record.status),
    providerStatus: record.providerStatus,
  });
}

function jobResult(record: JobRecord): JobResult | null {
  if (!record.resultUrl && !record.outputPath && !record.cachePath && !record.error) return null;
  return stripUndefined({
    url: record.resultUrl,
    outputPath: record.outputPath,
    cachePath: record.cachePath,
    error: record.error,
  });
}

function statusPhase(status: JobStatus): string {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "provider-processing";
    case "completed":
      return "complete";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "unknown":
      return "unknown";
  }
}

function makeJobId(providerTaskId: string, now: Date): string {
  const hash = createHash("sha256")
    .update(`${providerTaskId}:${randomUUID()}`)
    .digest("hex")
    .slice(0, 8);
  return `job_${now.getTime().toString(36)}_${hash}`;
}

function normalizeJobId(jobId: string): string {
  const id = jobId.endsWith(".json") ? parse(jobId).name : jobId;
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) {
    throw new Error(`Invalid job id: ${jobId}`);
  }
  return id;
}

function jobRecordPath(jobId: string, projectDir: string): string {
  return join(jobsDir(projectDir), `${normalizeJobId(jobId)}.json`);
}

function parseJobRecord(raw: string): JobRecord | null {
  const parsed = JSON.parse(raw) as Partial<JobRecord>;
  if (
    parsed.schemaVersion !== "1" ||
    typeof parsed.id !== "string" ||
    typeof parsed.providerTaskId !== "string"
  ) {
    return null;
  }
  return {
    ...parsed,
    status: normalizeJobStatus(parsed.status),
    retryWith: Array.isArray(parsed.retryWith) ? parsed.retryWith : [],
  } as JobRecord;
}

function updateRecordFromProvider(
  record: JobRecord,
  result: {
    status?: string;
    progress?: number;
    resultUrl?: string;
    outputPath?: string;
    error?: string;
  }
): JobRecord {
  const next: JobRecord = {
    ...record,
    status: normalizeJobStatus(result.status ?? record.status),
    providerStatus: result.status ?? record.providerStatus,
    progress: result.progress ?? record.progress,
    resultUrl: result.resultUrl ?? record.resultUrl,
    outputPath: result.outputPath ?? record.outputPath,
    error: result.error ?? record.error,
    updatedAt: new Date().toISOString(),
  };
  next.retryWith = retryWithForJob(next);
  return stripUndefined(next);
}

function resolveRefreshOutput(record: JobRecord, opts: RefreshJobOptions): string | undefined {
  if (opts.output) return resolve(opts.workingDirectory ?? process.cwd(), opts.output);
  return record.outputPath ? resolve(record.outputPath) : undefined;
}

function liveSupport(record: JobRecord): { supported: boolean; error?: string } {
  if (
    record.jobType === "generate-video" &&
    (record.provider === "runway" || record.provider === "kling")
  ) {
    return { supported: true };
  }
  if (record.jobType === "generate-music" && record.provider === "replicate") {
    return { supported: true };
  }
  return { supported: false };
}

async function refreshMusicStatus(
  taskId: string,
  wait?: boolean
): Promise<{
  success: boolean;
  status?: string;
  audioUrl?: string;
  error?: string;
}> {
  let result = await executeMusicStatus({ taskId });
  if (!wait) return result;
  for (let i = 0; i < 120 && result.success && result.status === "processing"; i++) {
    await sleep(5000);
    result = await executeMusicStatus({ taskId });
  }
  return result;
}

async function downloadUrl(url: string, outputPath: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, buffer);
  return outputPath;
}

async function maybeCacheOutput(record: JobRecord): Promise<void> {
  if (record.status !== "completed" || !record.outputPath || !record.cachePath) return;
  try {
    await mkdir(dirname(record.cachePath), { recursive: true });
    await copyFile(record.outputPath, record.cachePath);
  } catch {
    // Cache writes should not hide provider status refresh success.
  }
}

async function readBuildSummary(projectDir: string): Promise<BuildSummary | null> {
  const reportPath = join(projectDir, "build-report.json");
  const report = await readJson(reportPath);
  if (!report) return null;
  const info = await statOrNull(reportPath);
  const beatSummary = projectBeatReadinessFromUnknown(report.beatSummary);
  return stripUndefined({
    reportPath,
    kind: typeof report.kind === "string" ? report.kind : undefined,
    success: typeof report.success === "boolean" ? report.success : undefined,
    phase: typeof report.phase === "string" ? report.phase : undefined,
    status: typeof report.status === "string" ? report.status : undefined,
    currentStage: typeof report.currentStage === "string" ? report.currentStage : undefined,
    selectedStage: typeof report.selectedStage === "string" ? report.selectedStage : undefined,
    outputPath: typeof report.outputPath === "string" ? report.outputPath : undefined,
    estimatedCostUsd:
      typeof report.estimatedCostUsd === "number" ? report.estimatedCostUsd : undefined,
    costUsd: typeof report.costUsd === "number" ? report.costUsd : undefined,
    beats: beatSummary ?? beatReadinessFromBuildBeats(projectDir, report.beats),
    updatedAt: info?.mtime.toISOString(),
    warnings: Array.isArray(report.warnings) ? report.warnings : [],
    retryWith: Array.isArray(report.retryWith)
      ? report.retryWith.filter((item): item is string => typeof item === "string")
      : [],
  });
}

async function readReviewSummary(projectDir: string): Promise<ReviewSummary | null> {
  const reportPath = join(projectDir, "review-report.json");
  const report = await readJson(reportPath);
  if (!report) return null;
  const info = await statOrNull(reportPath);
  const issues = Array.isArray(report.issues) ? report.issues : [];
  const summary =
    report.summary && typeof report.summary === "object"
      ? (report.summary as Record<string, unknown>)
      : {};
  const fixOwners =
    summary.fixOwners && typeof summary.fixOwners === "object"
      ? (summary.fixOwners as Record<string, unknown>)
      : {};
  const computedFixOwners = countIssueFixOwners(issues);
  return stripUndefined({
    reportPath,
    kind: typeof report.kind === "string" ? report.kind : undefined,
    mode: typeof report.mode === "string" ? report.mode : undefined,
    status: typeof report.status === "string" ? report.status : undefined,
    score: typeof report.score === "number" ? report.score : undefined,
    issueCount: numberOr(issues.length, summary.issueCount),
    errorCount: numberOr(
      issues.filter((issue) => issueSeverity(issue) === "error").length,
      summary.errorCount
    ),
    warningCount: numberOr(
      issues.filter((issue) => issueSeverity(issue) === "warning").length,
      summary.warningCount
    ),
    infoCount: numberOr(
      issues.filter((issue) => issueSeverity(issue) === "info").length,
      summary.infoCount
    ),
    fixOwners: {
      vibe: numberOr(computedFixOwners.vibe, fixOwners.vibe),
      hostAgent: numberOr(computedFixOwners.hostAgent, fixOwners.hostAgent),
    },
    sourceReports: stringArray(report.sourceReports),
    updatedAt: info?.mtime.toISOString(),
    retryWith: stringArray(report.retryWith),
  });
}

function summarizeJobs(records: JobRecord[]): ProjectStatusResult["jobs"] {
  return {
    total: records.length,
    active: records.filter((record) => isActiveStatus(record.status)).length,
    completed: records.filter((record) => record.status === "completed").length,
    failed: records.filter((record) => record.status === "failed").length,
    cancelled: records.filter((record) => record.status === "cancelled").length,
    unknown: records.filter((record) => record.status === "unknown").length,
    latest: records.slice(0, 10).map(summarizeJob),
  };
}

async function readProjectBeatReadiness(
  projectDir: string,
  build: BuildSummary | null,
  records: JobRecord[]
): Promise<ProjectBeatReadiness> {
  if (build) {
    const report = await readJson(build.reportPath);
    const fromBeats = beatReadinessFromBuildBeats(projectDir, report?.beats, records, report?.jobs);
    if (fromBeats) return fromBeats;
    if (build.beats) return augmentBeatReadinessFromJobs(build.beats, records, report?.jobs);
  }

  const storyboardPath = join(projectDir, "STORYBOARD.md");
  if (!existsSync(storyboardPath)) {
    return { total: 0, assetsReady: 0, compositionsReady: 0, needsAuthor: [] };
  }

  try {
    const parsed = parseStoryboard(await readFile(storyboardPath, "utf-8"));
    const needsAuthor: string[] = [];
    let compositionsReady = 0;
    for (const beat of parsed.beats) {
      if (existsSync(join(projectDir, "compositions", `scene-${beat.id}.html`))) {
        compositionsReady += 1;
      } else {
        needsAuthor.push(beat.id);
      }
    }
    return {
      total: parsed.beats.length,
      assetsReady: 0,
      compositionsReady,
      needsAuthor,
    };
  } catch {
    return { total: 0, assetsReady: 0, compositionsReady: 0, needsAuthor: [] };
  }
}

function deriveProjectWorkflow(opts: {
  project: string;
  build: BuildSummary | null;
  review: ReviewSummary | null;
  beats: ProjectBeatReadiness;
  jobs: ProjectStatusResult["jobs"];
}): { status: ProjectWorkflowStatus; currentStage: ProjectCurrentStage; retryWith: string[] } {
  const retryWith: string[] = [];
  const hasStoryboard = existsSync(join(opts.project, "STORYBOARD.md"));

  if (!hasStoryboard && !opts.build) {
    retryWith.push(`vibe init ${opts.project} --from "<brief>" --json`);
    return { status: "empty", currentStage: "init", retryWith };
  }

  if (
    opts.jobs.failed > 0 ||
    opts.build?.success === false ||
    opts.build?.phase === "failed" ||
    opts.build?.status === "failed"
  ) {
    retryWith.push(`vibe build ${opts.project} --stage assets --force --json`);
    return {
      status: "failed",
      currentStage: currentStageFromBuild(opts.build) ?? (opts.jobs.failed > 0 ? "assets" : "init"),
      retryWith,
    };
  }

  if (opts.jobs.active > 0) {
    retryWith.push(`vibe status project ${opts.project} --refresh --json`);
    return { status: "running", currentStage: "assets", retryWith };
  }

  if (opts.build?.phase === "pending-jobs" || opts.build?.status === "running") {
    if (opts.beats.total > 0 && opts.beats.assetsReady >= opts.beats.total) {
      retryWith.push(`vibe build ${opts.project} --stage compose --json`);
      return { status: "ready", currentStage: "compose", retryWith };
    }
    retryWith.push(`vibe status project ${opts.project} --refresh --json`);
    return { status: "running", currentStage: "assets", retryWith };
  }

  if (opts.build?.phase === "needs-author" || opts.build?.status === "needs-author") {
    retryWith.push(`vibe build ${opts.project} --stage compose --json`);
    return { status: "needs-author", currentStage: "compose", retryWith };
  }

  if (opts.review?.status === "fail") {
    retryWith.push(
      ...(opts.review.retryWith.length > 0
        ? opts.review.retryWith
        : [`vibe inspect render ${opts.project} --json`])
    );
    return { status: "failed", currentStage: "review", retryWith };
  }

  if (opts.review?.status === "warn") {
    retryWith.push(
      ...(opts.review.retryWith.length > 0
        ? opts.review.retryWith
        : [`vibe inspect render ${opts.project} --json`])
    );
    return { status: "warn", currentStage: "review", retryWith };
  }

  if (opts.build?.phase === "done" || opts.build?.status === "done") {
    return { status: "done", currentStage: "done", retryWith };
  }

  if (opts.build && opts.beats.total > 0 && opts.beats.compositionsReady < opts.beats.total) {
    retryWith.push(`vibe build ${opts.project} --stage compose --json`);
    return { status: "needs-author", currentStage: "compose", retryWith };
  }

  if (!opts.build) {
    retryWith.push(`vibe plan ${opts.project} --json`, `vibe build ${opts.project} --json`);
    return { status: "ready", currentStage: "assets", retryWith };
  }

  const currentStage =
    currentStageFromBuild(opts.build) ?? nextStageAfterBuildPhase(opts.build.phase);
  retryWith.push(
    `vibe build ${opts.project} --stage ${currentStage === "done" ? "render" : currentStage} --json`
  );
  return { status: "ready", currentStage, retryWith };
}

function currentStageFromBuild(build: BuildSummary | null): ProjectCurrentStage | null {
  const stage = build?.currentStage;
  if (
    stage === "assets" ||
    stage === "compose" ||
    stage === "sync" ||
    stage === "render" ||
    stage === "done"
  ) {
    return stage;
  }
  return null;
}

function nextStageAfterBuildPhase(phase: string | undefined): ProjectCurrentStage {
  if (phase === "assets-only") return "compose";
  if (phase === "compose-only") return "sync";
  if (phase === "sync-only") return "render";
  if (phase === "render-only" || phase === "done") return "done";
  if (phase === "needs-author") return "compose";
  return "assets";
}

function projectBeatReadinessFromUnknown(value: unknown): ProjectBeatReadiness | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const total = numberOrNull(record.total);
  const assetsReady = numberOrNull(record.assetsReady);
  const compositionsReady = numberOrNull(record.compositionsReady);
  const needsAuthor = Array.isArray(record.needsAuthor)
    ? record.needsAuthor.filter((item): item is string => typeof item === "string")
    : null;
  if (total === null || assetsReady === null || compositionsReady === null || needsAuthor === null)
    return null;
  return { total, assetsReady, compositionsReady, needsAuthor };
}

function beatReadinessFromBuildBeats(
  projectDir: string,
  beats: unknown,
  records: JobRecord[] = [],
  reportJobs: unknown = []
): ProjectBeatReadiness | undefined {
  if (!Array.isArray(beats)) return undefined;
  let assetsReady = 0;
  let compositionsReady = 0;
  const needsAuthor: string[] = [];

  for (const beat of beats) {
    if (!beat || typeof beat !== "object") continue;
    const record = beat as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : undefined;
    if (buildBeatAssetsReady(record) || (id ? buildBeatJobsReady(id, records, reportJobs) : false))
      assetsReady += 1;
    const compositionPath =
      typeof record.compositionPath === "string"
        ? record.compositionPath
        : id
          ? `compositions/scene-${id}.html`
          : undefined;
    if (compositionPath && existsSync(resolve(projectDir, compositionPath))) {
      compositionsReady += 1;
    } else if (id) {
      needsAuthor.push(id);
    }
  }

  return {
    total: beats.length,
    assetsReady,
    compositionsReady,
    needsAuthor,
  };
}

function augmentBeatReadinessFromJobs(
  readiness: ProjectBeatReadiness,
  records: JobRecord[],
  reportJobs: unknown
): ProjectBeatReadiness {
  const readyJobBeats = new Set(
    records
      .filter(
        (record) =>
          record.beatId &&
          jobHasResult(record) &&
          buildBeatJobsReady(record.beatId, records, reportJobs)
      )
      .map((record) => record.beatId as string)
  );
  if (readyJobBeats.size === 0) return readiness;
  return {
    ...readiness,
    assetsReady: Math.min(readiness.total, Math.max(readiness.assetsReady, readyJobBeats.size)),
  };
}

function buildBeatJobsReady(beatId: string, records: JobRecord[], reportJobs: unknown): boolean {
  const reported = Array.isArray(reportJobs)
    ? reportJobs.filter(
        (job): job is Record<string, unknown> =>
          !!job && typeof job === "object" && (job as Record<string, unknown>).beatId === beatId
      )
    : [];
  const relevant =
    reported.length > 0
      ? reported
          .map((job) => {
            const id = typeof job.id === "string" ? job.id : undefined;
            return records.find((record) => record.id === id) ?? null;
          })
          .filter((record): record is JobRecord => record !== null)
      : records.filter((record) => record.beatId === beatId);
  return (
    relevant.length > 0 &&
    relevant.every((record) => record.status === "completed" && jobHasResult(record))
  );
}

function jobHasResult(record: JobRecord): boolean {
  return (
    typeof record.outputPath === "string" ||
    typeof record.resultUrl === "string" ||
    typeof record.cachePath === "string"
  );
}

function buildBeatAssetsReady(beat: Record<string, unknown>): boolean {
  return ["narrationStatus", "backdropStatus", "videoStatus", "musicStatus"]
    .map((key) => (typeof beat[key] === "string" ? beat[key] : undefined))
    .every((status) => status !== "pending" && status !== "failed");
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function issueSeverity(issue: unknown): string | undefined {
  if (!issue || typeof issue !== "object") return undefined;
  const severity = (issue as Record<string, unknown>).severity;
  return typeof severity === "string" ? severity : undefined;
}

function issueFixOwner(issue: unknown): string | undefined {
  if (!issue || typeof issue !== "object") return undefined;
  const fixOwner = (issue as Record<string, unknown>).fixOwner;
  return typeof fixOwner === "string" ? fixOwner : undefined;
}

function countIssueFixOwners(issues: unknown[]): { vibe: number; hostAgent: number } {
  let vibe = 0;
  let hostAgent = 0;
  for (const issue of issues) {
    const owner = issueFixOwner(issue);
    if (owner === "host-agent") hostAgent++;
    else vibe++;
  }
  return { vibe, hostAgent };
}

function numberOr(fallback: number, value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function isActiveStatus(status: JobStatus): boolean {
  return status === "queued" || status === "running";
}

function providerStatusCommand(record: JobRecord): string | undefined {
  if (record.jobType === "generate-video") {
    const type =
      record.provider === "kling" && record.providerTaskType
        ? ` --type ${record.providerTaskType}`
        : "";
    return `vibe generate video-status ${record.providerTaskId} -p ${record.provider}${type} --json`;
  }
  if (record.jobType === "generate-music" && record.provider === "replicate") {
    return `vibe generate music-status ${record.providerTaskId} --json`;
  }
  return undefined;
}

function previewPrompt(prompt: string | undefined): string | undefined {
  if (!prompt) return undefined;
  const compact = prompt.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function statOrNull(path: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function unique(items: Array<string | undefined>): string[] {
  return [
    ...new Set(items.filter((item): item is string => typeof item === "string" && item.length > 0)),
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
