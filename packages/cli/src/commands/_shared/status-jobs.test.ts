import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

vi.mock("../generate/music-status.js", () => ({
  executeMusicStatus: vi.fn(),
}));

vi.mock("../ai-video.js", () => ({
  executeVideoStatus: vi.fn(),
}));

import {
  createAndWriteJobRecord,
  inspectProjectStatus,
  normalizeJobStatus,
  readJobRecord,
  refreshJobRecord,
} from "./status-jobs.js";
import { executeMusicStatus } from "../generate/music-status.js";
import { executeVideoStatus } from "../ai-video.js";

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vibe-status-jobs-"));
  await writeFile(join(dir, "STORYBOARD.md"), "# Story\n\n## Beat hook\n", "utf-8");
  return dir;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("status job records", () => {
  it("writes and reads local job records", async () => {
    const dir = await tempProject();
    const record = await createAndWriteJobRecord({
      id: "job_test",
      now: new Date("2026-01-01T00:00:00.000Z"),
      jobType: "generate-video",
      provider: "runway",
      providerTaskId: "task_123",
      providerTaskType: "text2video",
      projectDir: dir,
      workingDirectory: dir,
      command: "generate video --no-wait",
      prompt: "A long launch video prompt",
    });

    expect(record.id).toBe("job_test");
    expect(record.retryWith).toContain(`vibe status job job_test --project ${resolve(dir)} --json`);
    expect(record.retryWith).toContain("vibe generate video-status task_123 -p runway --json");

    const raw = await readFile(join(dir, ".vibeframe", "jobs", "job_test.json"), "utf-8");
    expect(JSON.parse(raw)).toMatchObject({ id: "job_test", providerTaskId: "task_123" });

    const read = await readJobRecord("job_test", dir);
    expect(read?.provider).toBe("runway");
  });

  it("does not suggest legacy video-status for video providers without live status support", async () => {
    const dir = await tempProject();
    const record = await createAndWriteJobRecord({
      id: "job_seedance",
      now: new Date("2026-01-01T00:00:00.000Z"),
      jobType: "generate-video",
      provider: "seedance",
      providerTaskId: "task_seedance",
      projectDir: dir,
      command: "generate video --no-wait",
    });

    expect(record.retryWith).toEqual([
      `vibe status job job_seedance --project ${resolve(dir)} --json`,
    ]);

    const status = await refreshJobRecord(record, { write: false });
    expect(status.refreshed).toBe(false);
    expect(status.live.supported).toBe(false);
    expect(status.warnings).toContain(
      "Live status is not supported for seedance generate-video jobs yet."
    );
    expect(status.retryWith).toEqual([
      `vibe status job job_seedance --project ${resolve(dir)} --json`,
    ]);
  });

  it("summarizes build, review, and job state for a project", async () => {
    const dir = await tempProject();
    await mkdir(join(dir, ".vibeframe", "jobs"), { recursive: true });
    await writeFile(
      join(dir, "build-report.json"),
      JSON.stringify({
        success: true,
        phase: "done",
        selectedStage: "all",
        outputPath: "renders/final.mp4",
        warnings: [],
      }),
      "utf-8"
    );
    await writeFile(
      join(dir, "review-report.json"),
      JSON.stringify({
        kind: "review",
        mode: "render",
        status: "warn",
        score: 82,
        issues: [{ severity: "warning", code: "X", message: "Check", fixOwner: "host-agent" }],
        summary: {
          issueCount: 1,
          errorCount: 0,
          warningCount: 1,
          infoCount: 0,
          fixOwners: { vibe: 0, hostAgent: 1 },
        },
        sourceReports: ["render-report.json", "ffprobe"],
        retryWith: [`vibe scene repair --project ${dir} --json`],
      }),
      "utf-8"
    );
    await createAndWriteJobRecord({
      id: "job_music",
      jobType: "generate-music",
      provider: "replicate",
      providerTaskId: "music_1",
      projectDir: dir,
      command: "generate music --no-wait",
      status: "completed",
    });

    const status = await inspectProjectStatus(dir);
    expect(status).toMatchObject({
      kind: "project",
      status: "warn",
      currentStage: "review",
      beats: { total: 1, assetsReady: 0, compositionsReady: 0, needsAuthor: ["beat-hook"] },
    });
    expect(status.build).toMatchObject({ success: true, phase: "done" });
    expect(status.review).toMatchObject({
      kind: "review",
      mode: "render",
      status: "warn",
      score: 82,
      issueCount: 1,
      errorCount: 0,
      warningCount: 1,
      infoCount: 0,
      fixOwners: { vibe: 0, hostAgent: 1 },
      sourceReports: ["render-report.json", "ffprobe"],
      retryWith: [`vibe scene repair --project ${dir} --json`],
    });
    expect(status.retryWith).toContain(`vibe scene repair --project ${dir} --json`);
    expect(status.jobs).toMatchObject({ total: 1, completed: 1, active: 0 });
  });

  it("derives project readiness and retry commands from build reports", async () => {
    const dir = await tempProject();
    await mkdir(join(dir, "compositions"), { recursive: true });
    await writeFile(join(dir, "compositions", "scene-hook.html"), "<div></div>", "utf-8");
    await writeFile(
      join(dir, "build-report.json"),
      JSON.stringify({
        schemaVersion: "1",
        kind: "build",
        success: true,
        phase: "needs-author",
        status: "needs-author",
        currentStage: "compose",
        beats: [
          {
            id: "hook",
            narrationStatus: "cached",
            backdropStatus: "cached",
            videoStatus: "no-cue",
            musicStatus: "no-cue",
            compositionPath: "compositions/scene-hook.html",
          },
          {
            id: "cta",
            narrationStatus: "cached",
            backdropStatus: "pending",
            videoStatus: "no-cue",
            musicStatus: "no-cue",
            compositionPath: "compositions/scene-cta.html",
          },
        ],
        retryWith: [`vibe build ${dir} --stage compose --json`],
        warnings: [],
      }),
      "utf-8"
    );

    const status = await inspectProjectStatus(dir);

    expect(status.status).toBe("needs-author");
    expect(status.currentStage).toBe("compose");
    expect(status.beats).toEqual({
      total: 2,
      assetsReady: 1,
      compositionsReady: 1,
      needsAuthor: ["cta"],
    });
    expect(status.retryWith).toContain(`vibe build ${dir} --stage compose --json`);
  });

  it("uses completed job records to refresh asset readiness", async () => {
    const dir = await tempProject();
    await writeFile(
      join(dir, "build-report.json"),
      JSON.stringify({
        schemaVersion: "1",
        kind: "build",
        success: true,
        phase: "pending-jobs",
        status: "running",
        currentStage: "assets",
        beats: [
          {
            id: "hook",
            videoStatus: "pending",
            musicStatus: "pending",
            narrationStatus: "no-cue",
            backdropStatus: "no-cue",
            compositionPath: "compositions/scene-hook.html",
          },
        ],
        jobs: [
          { id: "job_video", jobType: "generate-video", status: "running", beatId: "hook" },
          { id: "job_music", jobType: "generate-music", status: "running", beatId: "hook" },
        ],
        retryWith: [`vibe status project ${dir} --refresh --json`],
        warnings: [],
      }),
      "utf-8"
    );
    await createAndWriteJobRecord({
      id: "job_video",
      jobType: "generate-video",
      provider: "runway",
      providerTaskId: "video_1",
      projectDir: dir,
      command: "build --stage assets",
      beatId: "hook",
      outputPath: join(dir, "assets", "video-hook.mp4"),
      status: "completed",
    });
    await createAndWriteJobRecord({
      id: "job_music",
      jobType: "generate-music",
      provider: "replicate",
      providerTaskId: "music_1",
      projectDir: dir,
      command: "build --stage assets",
      beatId: "hook",
      outputPath: join(dir, "assets", "music-hook.mp3"),
      status: "completed",
    });

    const status = await inspectProjectStatus(dir);

    expect(status.beats.assetsReady).toBe(1);
    expect(status.status).toBe("ready");
    expect(status.currentStage).toBe("compose");
    expect(status.retryWith).toContain(`vibe build ${dir} --stage compose --json`);
  });

  it("normalizes provider status strings", () => {
    expect(normalizeJobStatus("processing")).toBe("running");
    expect(normalizeJobStatus("in_progress")).toBe("running");
    expect(normalizeJobStatus("canceled")).toBe("cancelled");
    expect(normalizeJobStatus("wat")).toBe("unknown");
  });

  it("refreshes supported Grok video jobs through the shared video status executor", async () => {
    const dir = await tempProject();
    const record = await createAndWriteJobRecord({
      id: "job_grok",
      jobType: "generate-video",
      provider: "grok",
      providerTaskId: "grok_1",
      projectDir: dir,
      command: "generate video --no-wait",
    });
    expect(record.retryWith).toContain("vibe generate video-status grok_1 -p grok --json");

    vi.mocked(executeVideoStatus).mockResolvedValueOnce({
      success: true,
      taskId: "grok_1",
      status: "completed",
      videoUrl: "https://example.test/grok.mp4",
    });

    const result = await refreshJobRecord(record, { write: false });
    expect(result.refreshed).toBe(true);
    expect(result.kind).toBe("job");
    expect(result.id).toBe("job_grok");
    expect(result.result).toMatchObject({ url: "https://example.test/grok.mp4" });
    expect(result.job.status).toBe("completed");
    expect(result.live.supported).toBe(true);
    expect(executeVideoStatus).toHaveBeenCalledWith({
      taskId: "grok_1",
      provider: "grok",
      taskType: undefined,
      wait: undefined,
      output: undefined,
    });
  });

  it("refreshes supported Veo video jobs through the shared video status executor", async () => {
    const dir = await tempProject();
    const record = await createAndWriteJobRecord({
      id: "job_veo",
      jobType: "generate-video",
      provider: "veo",
      providerTaskId: "operations/veo_1",
      projectDir: dir,
      command: "generate video --no-wait",
    });
    expect(record.retryWith).toContain("vibe generate video-status operations/veo_1 -p veo --json");

    vi.mocked(executeVideoStatus).mockResolvedValueOnce({
      success: true,
      taskId: "operations/veo_1",
      status: "processing",
      progress: 50,
    });

    const result = await refreshJobRecord(record, { write: false });
    expect(result.refreshed).toBe(true);
    expect(result.job.status).toBe("running");
    expect(result.progress).toMatchObject({ percent: 50, phase: "processing" });
    expect(result.live.supported).toBe(true);
  });

  it("downloads completed music jobs to the recorded output path and cache path", async () => {
    const dir = await tempProject();
    const outputPath = join(dir, "assets", "music-hook.mp3");
    const cachePath = join(dir, ".vibeframe", "cache", "assets", "music-test.mp3");
    const record = await createAndWriteJobRecord({
      id: "job_music_download",
      jobType: "generate-music",
      provider: "replicate",
      providerTaskId: "music_2",
      projectDir: dir,
      command: "build --stage assets",
      beatId: "hook",
      outputPath,
      cachePath,
    });
    vi.mocked(executeMusicStatus).mockResolvedValueOnce({
      success: true,
      status: "completed",
      audioUrl: "https://example.test/music.mp3",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new Uint8Array([7, 8, 9]).buffer,
      })
    );

    const result = await refreshJobRecord(record);

    expect(result.refreshed).toBe(true);
    expect(result.result).toMatchObject({ outputPath, cachePath });
    expect(result.job.status).toBe("completed");
    expect(result.job.outputPath).toBe(outputPath);
    expect(Array.from(await readFile(outputPath))).toEqual([7, 8, 9]);
    expect(Array.from(await readFile(cachePath))).toEqual([7, 8, 9]);
  });

  it("refreshes completed music jobs into build-report and asset metadata", async () => {
    const dir = await tempProject();
    const outputPath = join(dir, "assets", "music-hook.mp3");
    const cachePath = join(dir, ".vibeframe", "cache", "assets", "music-test.mp3");
    await writeFile(
      join(dir, "build-report.json"),
      JSON.stringify({
        schemaVersion: "1",
        kind: "build",
        success: true,
        phase: "pending-jobs",
        status: "running",
        currentStage: "assets",
        beats: [
          {
            id: "hook",
            narrationStatus: "no-cue",
            backdropStatus: "no-cue",
            videoStatus: "no-cue",
            musicStatus: "pending",
            music: { status: "pending", jobId: "job_music_refresh" },
          },
        ],
        jobs: [
          {
            id: "job_music_refresh",
            jobType: "generate-music",
            status: "running",
            beatId: "hook",
          },
        ],
        retryWith: [`vibe status project ${dir} --refresh --json`],
        warnings: [],
      }),
      "utf-8"
    );
    await createAndWriteJobRecord({
      id: "job_music_refresh",
      jobType: "generate-music",
      provider: "replicate",
      providerTaskId: "music_3",
      projectDir: dir,
      command: "build --stage assets",
      prompt: "Minimal confident pulse.",
      beatId: "hook",
      outputPath,
      cachePath,
      assetKind: "music",
      assetCue: "Minimal confident pulse.",
      assetOptions: { duration: 3 },
      cacheKey: "music-cache-key",
      canonicalPath: "assets/music-hook.mp3",
      metadataPath: ".vibeframe/assets/music-hook.json",
    });
    vi.mocked(executeMusicStatus).mockResolvedValueOnce({
      success: true,
      status: "completed",
      audioUrl: "https://example.test/music.mp3",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new Uint8Array([4, 5, 6]).buffer,
      })
    );

    const status = await inspectProjectStatus(dir, { refresh: true });

    expect(status.beats.assetsReady).toBe(1);
    const report = JSON.parse(await readFile(join(dir, "build-report.json"), "utf-8"));
    expect(report.beats[0]).toMatchObject({
      musicStatus: "generated",
      musicPath: "assets/music-hook.mp3",
      music: {
        path: "assets/music-hook.mp3",
        status: "generated",
        cacheKey: "music-cache-key",
        metadataPath: ".vibeframe/assets/music-hook.json",
        freshness: "fresh",
      },
    });
    const metadata = JSON.parse(
      await readFile(join(dir, ".vibeframe", "assets", "music-hook.json"), "utf-8")
    );
    expect(metadata).toMatchObject({
      kind: "music",
      beatId: "hook",
      cue: "Minimal confident pulse.",
      cacheKey: "music-cache-key",
      canonicalPath: "assets/music-hook.mp3",
      cachePath: ".vibeframe/cache/assets/music-test.mp3",
    });
  });
});

describe("local build/render jobs", () => {
  it("refresh reads the record without provider warnings", async () => {
    const dir = await tempProject();
    const record = await createAndWriteJobRecord({
      jobType: "render",
      provider: "local",
      providerTaskId: "job_local_a",
      projectDir: dir,
      command: "vibe render .",
      status: "running",
      pid: process.pid,
      heartbeatAt: new Date().toISOString(),
      stage: "render",
      message: "Rendering frames",
      progress: 37,
    });

    const result = await refreshJobRecord(record);
    expect(result.warnings).toEqual([]);
    expect(result.live.supported).toBe(true);
    expect(result.job.status).toBe("running");
    expect(result.progress).toMatchObject({ percent: 37, phase: "render" });
    expect(executeVideoStatus).not.toHaveBeenCalled();
    expect(executeMusicStatus).not.toHaveBeenCalled();
  });

  it("downgrades orphaned running jobs to unknown with a report hint", async () => {
    const dir = await tempProject();
    const record = await createAndWriteJobRecord({
      jobType: "build",
      provider: "local",
      providerTaskId: "job_local_b",
      projectDir: dir,
      command: "vibe build .",
      status: "running",
      pid: 999999999,
      heartbeatAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    });

    const result = await refreshJobRecord(record);
    expect(result.job.status).toBe("unknown");
    expect(result.warnings.join(" ")).toContain("build-report.json");

    const persisted = await readJobRecord(record.id, dir);
    expect(persisted?.status).toBe("unknown");
  });

  it("surfaces resultPayload for completed local jobs", async () => {
    const dir = await tempProject();
    const record = await createAndWriteJobRecord({
      jobType: "render",
      provider: "local",
      providerTaskId: "job_local_c",
      projectDir: dir,
      command: "vibe render .",
      status: "running",
      pid: process.pid,
    });
    const completed = {
      ...record,
      status: "completed" as const,
      resultPayload: { outputPath: "renders/final.mp4", framesRendered: 100 },
      outputPath: "renders/final.mp4",
    };
    const { writeJobRecord } = await import("./status-jobs.js");
    await writeJobRecord(completed);

    const result = await refreshJobRecord(completed);
    expect(result.job.status).toBe("completed");
    expect(result.result?.payload).toMatchObject({ framesRendered: 100 });
    expect(result.result?.outputPath).toBe("renders/final.mp4");
  });
});
