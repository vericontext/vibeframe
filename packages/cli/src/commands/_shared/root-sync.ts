import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { getAudioDuration } from "../../utils/audio.js";
import { parseStoryboard } from "./storyboard-parse.js";
import type { ReviewIssue } from "./review-report.js";

export const ROOT_SYNC_FIX_CODES = {
  clipRefs: "root_clip_refs_synced",
  duration: "root_duration_synced",
  narrationAudio: "root_narration_audio_synced",
} as const;

export interface RootSyncBeatInput {
  id: string;
  duration?: number;
  narrationPath?: string;
  sceneDurationSec?: number;
}

export interface RootSyncPlan {
  rootPath: string;
  rootRel: string;
  exists: boolean;
  changed: boolean;
  fixCodes: string[];
  issues: ReviewIssue[];
  nextHtml?: string;
  totalDurationSec?: number;
}

interface ExpectedRootSync {
  block: string;
  totalDurationSec: number;
  audioRefs: Array<{
    beatId: string;
    src: string;
    start: number;
    duration: number;
  }>;
}

interface BuildReportAsset {
  path?: unknown;
  sceneDurationSec?: unknown;
  durationSec?: unknown;
}

interface BuildReportBeat {
  id?: unknown;
  narrationPath?: unknown;
  sceneDurationSec?: unknown;
  narration?: BuildReportAsset;
}

export async function createRootSyncPlan(opts: {
  projectDir: string;
  beats: RootSyncBeatInput[];
  rootRel?: string;
}): Promise<RootSyncPlan> {
  const projectDir = resolve(opts.projectDir);
  const rootRel = opts.rootRel ?? "index.html";
  const rootPath = resolve(projectDir, rootRel);
  if (!existsSync(rootPath)) {
    return { rootPath, rootRel, exists: false, changed: false, fixCodes: [], issues: [] };
  }

  const html = await readFile(rootPath, "utf-8");
  if (opts.beats.length === 0) {
    return { rootPath, rootRel, exists: true, changed: false, fixCodes: [], issues: [] };
  }
  const expected = await expectedRootSync({ projectDir, beats: opts.beats });
  const canPatch = canPatchRootSync(html);
  if (!canPatch.ok) {
    return {
      rootPath,
      rootRel,
      exists: true,
      changed: false,
      fixCodes: [],
      issues: [
        {
          severity: "error",
          code: "ROOT_SHELL_UNREPAIRABLE",
          message: canPatch.reason,
          file: rootRel,
          fixOwner: "host-agent",
          suggestedFix: "Repair the root index.html shell, then rerun `vibe scene repair`.",
        },
      ],
      totalDurationSec: expected.totalDurationSec,
    };
  }

  const issueCodes = rootSyncIssueCodes(html, expected);
  const nextHtml = applyRootSyncHtml(html, expected);
  const fixCodes = issueCodes.map((code) => {
    if (code === "ROOT_CLIP_REFS_OUT_OF_SYNC") return ROOT_SYNC_FIX_CODES.clipRefs;
    if (code === "ROOT_DURATION_OUT_OF_SYNC") return ROOT_SYNC_FIX_CODES.duration;
    return ROOT_SYNC_FIX_CODES.narrationAudio;
  });

  return {
    rootPath,
    rootRel,
    exists: true,
    changed: nextHtml !== html,
    fixCodes,
    issues: issueCodes.map((code) => rootSyncIssue(code, rootRel)),
    nextHtml: nextHtml !== html ? nextHtml : undefined,
    totalDurationSec: expected.totalDurationSec,
  };
}

export async function createProjectRootSyncPlan(opts: {
  projectDir: string;
  rootRel?: string;
}): Promise<RootSyncPlan> {
  return createRootSyncPlan({
    projectDir: opts.projectDir,
    rootRel: opts.rootRel,
    beats: await loadProjectRootSyncBeats(opts.projectDir),
  });
}

export async function syncRootComposition(opts: {
  projectDir: string;
  beats: RootSyncBeatInput[];
  rootRel?: string;
}): Promise<RootSyncPlan> {
  const plan = await createRootSyncPlan(opts);
  if (plan.nextHtml) await writeFile(plan.rootPath, plan.nextHtml, "utf-8");
  return plan;
}

export async function loadProjectRootSyncBeats(projectDir: string): Promise<RootSyncBeatInput[]> {
  const root = resolve(projectDir);
  const storyboardPath = join(root, "STORYBOARD.md");
  if (!existsSync(storyboardPath)) return [];

  const parsed = parseStoryboard(await readFile(storyboardPath, "utf-8"));
  const reportBeats = await readBuildReportBeats(root);
  return parsed.beats.map((beat) => {
    const reportBeat = reportBeats.find((item) => item.id === beat.id);
    return {
      id: beat.id,
      duration: beat.duration,
      narrationPath:
        stringOrUndefined(reportBeat?.narration?.path) ??
        stringOrUndefined(reportBeat?.narrationPath) ??
        firstExisting(root, [`assets/narration-${beat.id}.mp3`, `assets/narration-${beat.id}.wav`]),
      sceneDurationSec:
        numberOrUndefined(reportBeat?.sceneDurationSec) ??
        numberOrUndefined(reportBeat?.narration?.sceneDurationSec),
    };
  });
}

async function expectedRootSync(opts: {
  projectDir: string;
  beats: RootSyncBeatInput[];
}): Promise<ExpectedRootSync> {
  let cursor = 0;
  const clipLines: string[] = [];
  const audioLines: string[] = [];
  const audioRefs: ExpectedRootSync["audioRefs"] = [];

  for (const beat of opts.beats) {
    const duration = await resolveRootSyncBeatDuration({
      projectDir: opts.projectDir,
      beatDuration: beat.duration,
      narrationPath: beat.narrationPath,
      sceneDurationSec: beat.sceneDurationSec,
    });
    const compositionId = `scene-${beat.id}`;
    clipLines.push(
      `      <div class="clip" data-composition-id="${compositionId}" data-composition-src="compositions/${compositionId}.html" data-start="${cursor}" data-duration="${duration}" data-track-index="0"></div>`
    );
    if (beat.narrationPath) {
      audioRefs.push({ beatId: beat.id, src: beat.narrationPath, start: cursor, duration });
      audioLines.push(
        `      <audio id="narration-${beat.id}" src="${beat.narrationPath}" data-start="${cursor}" data-duration="${duration}" data-track-index="2"></audio>`
      );
    }
    cursor = Number((cursor + duration).toFixed(2));
  }

  const block =
    "      <!-- vibe-scene-build: clip refs (auto-generated; safe to re-run) -->\n" +
    clipLines.join("\n") +
    (audioLines.length > 0 ? "\n" + audioLines.join("\n") : "") +
    "\n      <!-- /vibe-scene-build -->";

  return { block, totalDurationSec: Number(cursor.toFixed(2)), audioRefs };
}

async function resolveRootSyncBeatDuration(opts: {
  projectDir: string;
  beatDuration?: number;
  narrationPath?: string;
  sceneDurationSec?: number;
}): Promise<number> {
  if (opts.sceneDurationSec !== undefined) return Number(opts.sceneDurationSec.toFixed(2));
  const storyboardMin = opts.beatDuration ?? 3;
  if (!opts.narrationPath) return Number(storyboardMin.toFixed(2));

  try {
    const audioDuration = await getAudioDuration(join(opts.projectDir, opts.narrationPath));
    return Number(Math.max(storyboardMin, audioDuration + 0.5).toFixed(2));
  } catch {
    return Number(storyboardMin.toFixed(2));
  }
}

function rootSyncIssueCodes(
  html: string,
  expected: ExpectedRootSync
): Array<
  "ROOT_CLIP_REFS_OUT_OF_SYNC" | "ROOT_DURATION_OUT_OF_SYNC" | "ROOT_NARRATION_AUDIO_OUT_OF_SYNC"
> {
  const codes: Array<
    "ROOT_CLIP_REFS_OUT_OF_SYNC" | "ROOT_DURATION_OUT_OF_SYNC" | "ROOT_NARRATION_AUDIO_OUT_OF_SYNC"
  > = [];
  const currentBlock = html.match(rootSyncMarkerRe())?.[0]?.trim();
  if (currentBlock !== expected.block.trim()) codes.push("ROOT_CLIP_REFS_OUT_OF_SYNC");

  const rootDuration = readRootDuration(html);
  if (rootDuration === undefined || Math.abs(rootDuration - expected.totalDurationSec) > 0.01) {
    codes.push("ROOT_DURATION_OUT_OF_SYNC");
  }

  if (expected.audioRefs.some((ref) => !hasExpectedAudioRef(html, ref))) {
    codes.push("ROOT_NARRATION_AUDIO_OUT_OF_SYNC");
  }

  return codes;
}

function rootSyncIssue(code: string, rootRel: string): ReviewIssue {
  if (code === "ROOT_DURATION_OUT_OF_SYNC") {
    return {
      severity: "warning",
      code,
      message: "Root composition duration does not match storyboard/build timing.",
      file: rootRel,
      fixOwner: "vibe",
      suggestedFix: "Run `vibe scene repair --project <project> --json`.",
    };
  }
  if (code === "ROOT_NARRATION_AUDIO_OUT_OF_SYNC") {
    return {
      severity: "warning",
      code,
      message: "Root composition is missing generated narration audio wiring.",
      file: rootRel,
      fixOwner: "vibe",
      suggestedFix: "Run `vibe scene repair --project <project> --json`.",
    };
  }
  return {
    severity: "warning",
    code,
    message: "Root composition clip references are out of sync with storyboard beats.",
    file: rootRel,
    fixOwner: "vibe",
    suggestedFix: "Run `vibe scene repair --project <project> --json`.",
  };
}

function applyRootSyncHtml(html: string, expected: ExpectedRootSync): string {
  let next: string;
  const markerRe = rootSyncMarkerRe();
  if (markerRe.test(html)) {
    next = html.replace(markerRe, "\n" + expected.block);
  } else {
    const rootCloseRe = /(\n\s*<\/div>\s*\n\s*<script[^>]*>[\s\S]*window\.__timelines)/;
    if (rootCloseRe.test(html)) {
      next = html.replace(rootCloseRe, `\n${expected.block}\n    $1`);
    } else {
      next = html.replace(/<\/body>/i, `${expected.block}\n  </body>`);
    }
  }
  return setRootDuration(next, expected.totalDurationSec);
}

function canPatchRootSync(html: string): { ok: true } | { ok: false; reason: string } {
  if (!rootOpenTagRe().test(html)) {
    return {
      ok: false,
      reason: 'Root index.html does not contain a repairable element with id="root".',
    };
  }
  if (
    !rootSyncMarkerRe().test(html) &&
    !/<\/body>/i.test(html) &&
    !/window\.__timelines/.test(html)
  ) {
    return {
      ok: false,
      reason: "Root index.html does not contain a safe insertion point for generated clip refs.",
    };
  }
  return { ok: true };
}

function setRootDuration(html: string, totalDuration: number): string {
  return html.replace(rootOpenTagRe(), (full, tag: string, attrs: string) => {
    if (/\sdata-duration="[^"]*"/.test(attrs)) {
      return `<${tag}${attrs.replace(/\sdata-duration="[^"]*"/, ` data-duration="${totalDuration}"`)}>`;
    }
    return `<${tag}${attrs} data-duration="${totalDuration}">`;
  });
}

function readRootDuration(html: string): number | undefined {
  const match = html.match(rootOpenTagRe());
  if (!match) return undefined;
  const attr = match[2].match(/\sdata-duration="([^"]*)"/);
  if (!attr) return undefined;
  const value = Number.parseFloat(attr[1]);
  return Number.isFinite(value) ? value : undefined;
}

function hasExpectedAudioRef(
  html: string,
  ref: { beatId: string; src: string; start: number; duration: number }
): boolean {
  const tag = html.match(
    new RegExp(`<audio\\b[^>]*id="${escapeRegExp(`narration-${ref.beatId}`)}"[^>]*>`, "i")
  )?.[0];
  if (!tag) return false;
  return (
    tag.includes(`src="${ref.src}"`) &&
    tag.includes(`data-start="${ref.start}"`) &&
    tag.includes(`data-duration="${ref.duration}"`)
  );
}

async function readBuildReportBeats(projectDir: string): Promise<BuildReportBeat[]> {
  const reportPath = join(projectDir, "build-report.json");
  if (!existsSync(reportPath)) return [];
  try {
    const report = JSON.parse(await readFile(reportPath, "utf-8")) as { beats?: BuildReportBeat[] };
    return Array.isArray(report.beats) ? report.beats : [];
  } catch {
    return [];
  }
}

function firstExisting(projectDir: string, rels: string[]): string | undefined {
  return rels.find((rel) => existsSync(join(projectDir, rel)));
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function rootSyncMarkerRe(): RegExp {
  return /\n? *<!-- vibe-scene-build: clip refs.*?<!-- \/vibe-scene-build -->/s;
}

function rootOpenTagRe(): RegExp {
  return /<([a-z][a-z0-9-]*)([^>]*\bid="root"[^>]*)>/i;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
