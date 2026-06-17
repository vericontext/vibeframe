import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  aiReviewSeverity,
  blackFrameIssueForRange,
  durationDriftIssue,
  inspectRender,
  mapAiReviewFeedbackToIssues,
  parseBlackdetectOutput,
  parseFreezedetectOutput,
  parseSilencedetectOutput,
  previewInspectRender,
  renderExpectsAudio,
  resolveRenderVideoPath,
  scoreRenderReview,
  staticFrameIssueForRange,
} from "./render-inspect.js";
import type { VideoReviewFeedback } from "../ai-edit.js";
import { commandExists, execSafe } from "../../utils/exec-safe.js";

async function makeTmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "vibe-render-inspect-"));
}

describe("render inspect parsers", () => {
  it("parses ffmpeg blackdetect output", () => {
    const out = `
[blackdetect @ 0x123] black_start:0 black_end:1.24 black_duration:1.24
[blackdetect @ 0x123] black_start:5.5 black_end:6 black_duration:0.5
`;
    expect(parseBlackdetectOutput(out)).toEqual([
      { start: 0, end: 1.24, duration: 1.24 },
      { start: 5.5, end: 6, duration: 0.5 },
    ]);
  });

  it("parses ffmpeg silencedetect output", () => {
    const out = `
[silencedetect @ 0x123] silence_start: 2.1
[silencedetect @ 0x123] silence_end: 4.4 | silence_duration: 2.3
[silencedetect @ 0x123] silence_start: 8
[silencedetect @ 0x123] silence_end: 9.5 | silence_duration: 1.5
`;
    expect(parseSilencedetectOutput(out)).toEqual([
      { start: 2.1, end: 4.4, duration: 2.3 },
      { start: 8, end: 9.5, duration: 1.5 },
    ]);
  });

  it("parses ffmpeg freezedetect output", () => {
    const out = `
[freezedetect @ 0x123] lavfi.freezedetect.freeze_start: 1.25
[freezedetect @ 0x123] lavfi.freezedetect.freeze_duration: 3.5
[freezedetect @ 0x123] lavfi.freezedetect.freeze_end: 4.75
[freezedetect @ 0x123] lavfi.freezedetect.freeze_start: 8
[freezedetect @ 0x123] lavfi.freezedetect.freeze_end: 10.25
`;
    expect(parseFreezedetectOutput(out)).toEqual([
      { start: 1.25, end: 4.75, duration: 3.5 },
      { start: 8, end: 10.25, duration: 2.25 },
    ]);
  });

  it("maps static frame ranges to beat-level host-agent issues", () => {
    const issue = staticFrameIssueForRange(
      { start: 0.25, end: 4.5, duration: 4.25 },
      [
        {
          id: "hook",
          start: 0,
          end: 5,
          sceneDurationSec: 5,
          narrationDurationSec: 2,
        },
      ],
      "/tmp/render.mp4"
    );

    expect(issue).toMatchObject({
      severity: "error",
      code: "STATIC_FRAME_SEGMENT",
      beatId: "hook",
      scene: "hook",
      timeRange: { start: 0.25, end: 4.5, duration: 4.25 },
      sceneDurationSec: 5,
      narrationDurationSec: 2,
      fixOwner: "host-agent",
    });
  });

  it("maps black frame ranges to beat-level issues", () => {
    const issue = blackFrameIssueForRange(
      { start: 6, end: 9, duration: 3 },
      [
        { id: "hook", start: 0, end: 5, sceneDurationSec: 5 },
        { id: "close", start: 5, end: 10, sceneDurationSec: 5, narrationDurationSec: 4 },
      ],
      "/tmp/render.mp4"
    );

    expect(issue).toMatchObject({
      severity: "warning",
      code: "BLACK_FRAME_SEGMENT",
      beatId: "close",
      scene: "close",
      timeRange: { start: 6, end: 9, duration: 3 },
      fixOwner: "host-agent",
    });
  });

  it("maps duration drift to a report issue with timing context", () => {
    const issue = durationDriftIssue({
      durationSec: 8,
      expectedDurationSec: 10,
      driftSec: -2,
      beats: [
        { id: "hook", start: 0, end: 5, sceneDurationSec: 5 },
        { id: "close", start: 5, end: 10, sceneDurationSec: 5, narrationDurationSec: 4 },
      ],
      videoPath: "/tmp/render.mp4",
    });

    expect(issue).toMatchObject({
      severity: "warning",
      code: "DURATION_DRIFT",
      beatId: "close",
      scene: "close",
      timeRange: { start: 8, end: 10, duration: 2 },
      fixOwner: "vibe",
    });
  });

  it("maps AI review scores to issue severity", () => {
    expect(aiReviewSeverity(4)).toBe("error");
    expect(aiReviewSeverity(6)).toBe("warning");
    expect(aiReviewSeverity(7)).toBe("info");
  });

  it("maps AI review feedback to review-report issues", () => {
    const feedback: VideoReviewFeedback = {
      overallScore: 5,
      categories: {
        pacing: { score: 4, issues: ["Opening drags"], fixable: true },
        color: { score: 8, issues: [], fixable: false },
        textReadability: { score: 6, issues: ["Caption contrast is low"], fixable: true },
        audioVisualSync: { score: 7, issues: ["Voiceover lands slightly late"], fixable: false },
        composition: { score: 9, issues: [], fixable: false },
      },
      autoFixable: [],
      recommendations: ["Tighten the first scene"],
    };

    expect(mapAiReviewFeedbackToIssues(feedback, "/tmp/render.mp4")).toEqual([
      expect.objectContaining({
        severity: "error",
        code: "AI_REVIEW_PACING",
        message: "Pacing: Opening drags",
        fixOwner: "host-agent",
      }),
      expect.objectContaining({
        severity: "warning",
        code: "AI_REVIEW_TEXT_READABILITY",
        message: "Text readability: Caption contrast is low",
        fixOwner: "host-agent",
      }),
      expect.objectContaining({
        severity: "info",
        code: "AI_REVIEW_AUDIO_VISUAL_SYNC",
        message: "Audio-visual sync: Voiceover lands slightly late",
        fixOwner: "host-agent",
      }),
    ]);
  });

  it("maps beat-level AI review findings to host-agent issues", () => {
    const feedback: VideoReviewFeedback = {
      overallScore: 6,
      categories: {
        pacing: { score: 8, issues: [], fixable: false },
        color: { score: 8, issues: [], fixable: false },
        textReadability: { score: 8, issues: [], fixable: false },
        audioVisualSync: { score: 6, issues: [], fixable: true },
        composition: { score: 8, issues: [], fixable: false },
      },
      beatIssues: [
        {
          beatId: "hook",
          timeRange: { start: 2, end: 5 },
          severity: "warning",
          category: "audioVisualSync",
          message: "Narration talks about the logo while the scene remains on a blank gradient.",
          suggestedFix: "Show the logo during the narration or rewrite the narration.",
        },
      ],
      autoFixable: [],
      recommendations: [],
    };

    expect(mapAiReviewFeedbackToIssues(feedback, "/tmp/render.mp4")).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "AI_REVIEW_AUDIO_VISUAL_SYNC",
        beatId: "hook",
        scene: "hook",
        timeRange: { start: 2, end: 5, duration: 3 },
        fixOwner: "host-agent",
      }),
    ]);
  });

  it("combines local issue score and AI overall score on the 0-100 scale", () => {
    expect(scoreRenderReview([], 8)).toBe(90);
    expect(scoreRenderReview([{ severity: "error", code: "X", message: "Bad" }], 4)).toBe(58);
  });

  it("resolves beat render videos from render-report.json", async () => {
    const dir = await makeTmp();
    await mkdir(resolve(dir, "renders"), { recursive: true });
    const videoPath = resolve(dir, "renders", "promo-hook.mp4");
    await writeFile(videoPath, Buffer.from([1]));
    await writeFile(
      resolve(dir, "render-report.json"),
      JSON.stringify({
        schemaVersion: "1",
        kind: "render",
        beat: "hook",
        outputPath: videoPath,
      }),
      "utf-8"
    );

    await expect(resolveRenderVideoPath(dir, undefined, "hook")).resolves.toBe(videoPath);
    await expect(resolveRenderVideoPath(dir, undefined, "close")).resolves.toBeNull();
  });

  it("returns a beat-specific retry when no render is available", async () => {
    const dir = await makeTmp();

    const result = await inspectRender({ projectDir: dir, beatId: "hook", writeReport: false });

    expect(result.status).toBe("fail");
    expect(result.mode).toBe("render");
    expect(result.beat).toBe("hook");
    expect(result.summary.errorCount).toBe(1);
    expect(result.issues[0].fixOwner).toBe("vibe");
    expect(result.issues[0].actions).toEqual([
      expect.objectContaining({
        command: `vibe render ${dir} --beat hook --json`,
        safeToAutoRun: true,
        requiresConfirmation: false,
        sourceIssueCodes: ["RENDER_NOT_FOUND"],
      }),
    ]);
    expect(result.nextActions).toEqual([
      expect.objectContaining({
        command: `vibe render ${dir} --beat hook --json`,
      }),
    ]);
    expect(result.retryWith).toEqual([`vibe render ${dir} --beat hook --json`]);
  });

  it("writes a normalized review report by default", async () => {
    const dir = await makeTmp();

    const result = await inspectRender({ projectDir: dir });

    expect(result.reportPath).toBe(resolve(dir, "review-report.json"));
    const report = JSON.parse(await readFile(resolve(dir, "review-report.json"), "utf-8"));
    expect(report).toMatchObject({
      schemaVersion: "1",
      kind: "review",
      mode: "render",
      project: resolve(dir),
      status: "fail",
      summary: { errorCount: 1, fixOwners: { vibe: 1, hostAgent: 0 } },
      nextActions: expect.arrayContaining([
        expect.objectContaining({
          command: `vibe render ${dir} --json`,
          safeToAutoRun: true,
        }),
      ]),
    });
  });

  it("uses the selected beat duration from build-report.json", async () => {
    const dir = await makeTmp();
    const videoPath = resolve(dir, "hook.mp4");
    await writeFile(videoPath, Buffer.alloc(0));
    await writeFile(
      resolve(dir, "build-report.json"),
      JSON.stringify({
        schemaVersion: "1",
        kind: "build",
        beats: [
          { id: "hook", sceneDurationSec: 3 },
          { id: "close", sceneDurationSec: 9 },
        ],
      }),
      "utf-8"
    );

    const result = await inspectRender({
      projectDir: dir,
      beatId: "hook",
      videoPath,
      writeReport: false,
    });

    expect(result.checks.expectedDurationSec).toBe(3);
    expect(result.retryWith).toContain(`vibe render ${dir} --beat hook --json`);
  });

  it("includes beat parameters in dry-run previews", async () => {
    const dir = await makeTmp();

    const result = await previewInspectRender({
      projectDir: dir,
      beatId: "hook",
      writeReport: false,
    });

    expect(result.beat).toBe("hook");
    expect(result.params.beatId).toBe("hook");
  });
});

describe("render expected-audio detection", () => {
  it("does not expect audio for a silent storyboard with no audio assets", async () => {
    const dir = await makeTmp();
    await writeFile(
      resolve(dir, "STORYBOARD.md"),
      `# Silent\n\n## Beat hook - Hook\n\n\`\`\`yaml\nduration: 3\n\`\`\`\n\nBody.\n`,
      "utf-8"
    );

    await expect(renderExpectsAudio(dir)).resolves.toBe(false);
  });

  it("expects audio from root audio refs, build reports, or matching assets", async () => {
    const dir = await makeTmp();
    await mkdir(resolve(dir, "assets"), { recursive: true });
    await writeFile(
      resolve(dir, "index.html"),
      `<div id="root"><audio id="narration-hook" src="assets/narration-hook.mp3"></audio></div>`,
      "utf-8"
    );
    await writeFile(
      resolve(dir, "build-report.json"),
      JSON.stringify({ beats: [{ id: "close", narrationPath: "assets/narration-close.mp3" }] }),
      "utf-8"
    );
    await writeFile(
      resolve(dir, "STORYBOARD.md"),
      `# Audio\n\n## Beat music - Music\n\n\`\`\`yaml\nduration: 3\n\`\`\`\n\nBody.\n`,
      "utf-8"
    );
    await writeFile(resolve(dir, "assets/music-music.wav"), Buffer.from([1, 2, 3]));

    await expect(renderExpectsAudio(dir, "hook")).resolves.toBe(true);
    await expect(renderExpectsAudio(dir, "close")).resolves.toBe(true);
    await expect(renderExpectsAudio(dir, "music")).resolves.toBe(true);
    await expect(renderExpectsAudio(dir, "silent")).resolves.toBe(false);
  });
});

describe("render inspect no-audio warnings", () => {
  const hasVideoTools = commandExists("ffmpeg") && commandExists("ffprobe");

  it.skipIf(!hasVideoTools)(
    "only warns about missing audio when project state expects audio",
    async () => {
      const dir = await makeTmp();
      const videoPath = resolve(dir, "silent.mp4");
      await execSafe("ffmpeg", [
        "-hide_banner",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=64x64:d=1",
        "-an",
        "-pix_fmt",
        "yuv420p",
        videoPath,
      ]);

      const silent = await inspectRender({ projectDir: dir, videoPath, writeReport: false });
      expect(silent.issues.map((issue) => issue.code)).not.toContain("NO_AUDIO_STREAM");

      await writeFile(
        resolve(dir, "index.html"),
        `<div id="root"><audio id="narration-hook" src="assets/narration-hook.mp3"></audio></div>`,
        "utf-8"
      );
      const expected = await inspectRender({ projectDir: dir, videoPath, writeReport: false });
      expect(expected.issues.map((issue) => issue.code)).toContain("NO_AUDIO_STREAM");
    }
  );
});
