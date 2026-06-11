import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseStoryboard } from "./storyboard-parse.js";

/**
 * @module _shared/project-list
 *
 * Workspace overview: every VibeFrame scene project (a directory with a
 * STORYBOARD.md) directly under the workspace root, with enough status to
 * answer "what projects do I have and where did I leave off?" in one call.
 * Directories whose names start with `_` (e.g. `_archive`) or `.` and
 * `node_modules` are skipped, so archiving a project is just `mv` into
 * `_archive/`.
 */

export interface ProjectListEntry {
  /** Directory name — what build/render/storyboard tools take as projectDir. */
  name: string;
  path: string;
  beats: number;
  /** Sum of storyboard beat durations (narration sync may stretch renders). */
  storyboardDurationSec: number;
  /** build-report.json status/phase, when a build has run. */
  buildStatus?: string;
  buildUpdatedAt?: string;
  /** Newest video in renders/, when any render exists. */
  latestRender?: { file: string; modifiedAt: string };
  /** Most recent activity across storyboard, build report, and renders. */
  updatedAt: string;
}

export interface ProjectListResult {
  success: boolean;
  workspaceDir: string;
  projects: ProjectListEntry[];
  /** Count of projects parked under _-prefixed dirs (e.g. _archive). */
  archivedCount: number;
  error?: string;
}

export async function executeProjectList(
  opts: { workspaceDir?: string } = {}
): Promise<ProjectListResult> {
  const workspaceDir = resolve(opts.workspaceDir ?? ".");
  if (!existsSync(workspaceDir)) {
    return {
      success: false,
      workspaceDir,
      projects: [],
      archivedCount: 0,
      error: `Workspace directory not found: ${workspaceDir}`,
    };
  }

  const entries = await readdir(workspaceDir, { withFileTypes: true });
  const projects: ProjectListEntry[] = [];
  let archivedCount = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules") continue;
    if (entry.name.startsWith(".")) continue;
    if (entry.name.startsWith("_")) {
      archivedCount += await countProjects(join(workspaceDir, entry.name));
      continue;
    }
    const projectDir = join(workspaceDir, entry.name);
    if (!existsSync(join(projectDir, "STORYBOARD.md"))) continue;
    projects.push(await describeProject(entry.name, projectDir));
  }

  projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { success: true, workspaceDir, projects, archivedCount };
}

async function countProjects(dir: string): Promise<number> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter(
      (e) => e.isDirectory() && existsSync(join(dir, e.name, "STORYBOARD.md"))
    ).length;
  } catch {
    return 0;
  }
}

async function describeProject(name: string, projectDir: string): Promise<ProjectListEntry> {
  let beats = 0;
  let storyboardDurationSec = 0;
  const timestamps: number[] = [];

  try {
    const storyboardPath = join(projectDir, "STORYBOARD.md");
    const parsed = parseStoryboard(await readFile(storyboardPath, "utf-8"));
    beats = parsed.beats.length;
    storyboardDurationSec = Number(
      parsed.beats.reduce((sum, beat) => sum + (beat.duration ?? 0), 0).toFixed(2)
    );
    timestamps.push((await stat(storyboardPath)).mtimeMs);
  } catch {
    // Unparseable storyboard still counts as a project; report zeros.
  }

  let buildStatus: string | undefined;
  let buildUpdatedAt: string | undefined;
  try {
    const reportPath = join(projectDir, "build-report.json");
    const report = JSON.parse(await readFile(reportPath, "utf-8")) as {
      status?: string;
      phase?: string;
      updatedAt?: string;
    };
    buildStatus = report.status ?? report.phase;
    buildUpdatedAt = report.updatedAt;
    timestamps.push((await stat(reportPath)).mtimeMs);
  } catch {
    // No build yet.
  }

  let latestRender: ProjectListEntry["latestRender"];
  try {
    const rendersDir = join(projectDir, "renders");
    const files = await readdir(rendersDir);
    let newest: { file: string; mtimeMs: number } | undefined;
    for (const file of files) {
      if (!/\.(mp4|webm|mov)$/i.test(file)) continue;
      const { mtimeMs } = await stat(join(rendersDir, file));
      if (!newest || mtimeMs > newest.mtimeMs) newest = { file, mtimeMs };
    }
    if (newest) {
      latestRender = { file: newest.file, modifiedAt: new Date(newest.mtimeMs).toISOString() };
      timestamps.push(newest.mtimeMs);
    }
  } catch {
    // No renders dir yet.
  }

  const updatedAt = new Date(
    timestamps.length > 0 ? Math.max(...timestamps) : (await stat(projectDir)).mtimeMs
  ).toISOString();

  return {
    name,
    path: projectDir,
    beats,
    storyboardDurationSec,
    ...(buildStatus ? { buildStatus } : {}),
    ...(buildUpdatedAt ? { buildUpdatedAt } : {}),
    ...(latestRender ? { latestRender } : {}),
    updatedAt,
  };
}
