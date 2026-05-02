import { describe, expect, it } from "vitest";

import {
  aiReviewSeverity,
  mapAiReviewFeedbackToIssues,
  parseBlackdetectOutput,
  parseSilencedetectOutput,
  scoreRenderReview,
} from "./render-inspect.js";
import type { VideoReviewFeedback } from "../ai-edit.js";

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
      }),
      expect.objectContaining({
        severity: "warning",
        code: "AI_REVIEW_TEXT_READABILITY",
        message: "Text readability: Caption contrast is low",
      }),
      expect.objectContaining({
        severity: "info",
        code: "AI_REVIEW_AUDIO_VISUAL_SYNC",
        message: "Audio-visual sync: Voiceover lands slightly late",
      }),
    ]);
  });

  it("combines local issue score and AI overall score on the 0-100 scale", () => {
    expect(scoreRenderReview([], 8)).toBe(90);
    expect(scoreRenderReview([{ severity: "error", code: "X", message: "Bad" }], 4)).toBe(58);
  });
});
