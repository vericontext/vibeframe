import { describe, it, expect } from "vitest";
import {
  detectFormat,
  formatTranscript,
  formatSRT,
  formatVTT,
  formatSRTTime,
  formatVTTTime,
} from "./subtitle.js";

describe("subtitle utilities", () => {
  describe("detectFormat", () => {
    it("detects SRT from file extension", () => {
      expect(detectFormat("output.srt")).toBe("srt");
      expect(detectFormat("video.SRT")).toBe("srt");
    });

    it("detects VTT from file extension", () => {
      expect(detectFormat("output.vtt")).toBe("vtt");
      expect(detectFormat("video.VTT")).toBe("vtt");
    });

    it("defaults to JSON for unknown extensions", () => {
      expect(detectFormat("output.json")).toBe("json");
      expect(detectFormat("output.txt")).toBe("json");
      expect(detectFormat("output")).toBe("json");
    });

    it("uses explicit format over extension", () => {
      expect(detectFormat("output.json", "srt")).toBe("srt");
      expect(detectFormat("output.srt", "vtt")).toBe("vtt");
      expect(detectFormat("output.vtt", "json")).toBe("json");
    });
  });

  describe("formatSRTTime", () => {
    it("formats zero", () => {
      expect(formatSRTTime(0)).toBe("00:00:00,000");
    });

    it("formats seconds", () => {
      expect(formatSRTTime(5.5)).toBe("00:00:05,500");
    });

    it("formats minutes", () => {
      expect(formatSRTTime(65.25)).toBe("00:01:05,250");
    });

    it("formats hours", () => {
      expect(formatSRTTime(3661.123)).toBe("01:01:01,123");
    });
  });

  describe("formatVTTTime", () => {
    it("formats zero", () => {
      expect(formatVTTTime(0)).toBe("00:00:00.000");
    });

    it("formats seconds with period separator", () => {
      expect(formatVTTTime(5.5)).toBe("00:00:05.500");
    });

    it("formats hours", () => {
      expect(formatVTTTime(3661.123)).toBe("01:01:01.123");
    });
  });

  describe("formatSRT", () => {
    it("formats empty segments", () => {
      expect(formatSRT([])).toBe("");
    });

    it("formats single segment", () => {
      const segments = [
        { startTime: 0, endTime: 2.5, text: "Hello world" },
      ];

      const result = formatSRT(segments);

      expect(result).toBe(
        "1\n00:00:00,000 --> 00:00:02,500\nHello world\n"
      );
    });

    it("formats multiple segments", () => {
      const segments = [
        { startTime: 0, endTime: 2.5, text: "First line" },
        { startTime: 2.5, endTime: 5.0, text: "Second line" },
      ];

      const result = formatSRT(segments);

      expect(result).toContain("1\n00:00:00,000 --> 00:00:02,500\nFirst line\n");
      expect(result).toContain("2\n00:00:02,500 --> 00:00:05,000\nSecond line\n");
    });
  });

  describe("formatVTT", () => {
    it("includes WEBVTT header", () => {
      const result = formatVTT([]);
      expect(result).toBe("WEBVTT\n\n");
    });

    it("formats segments with period separator", () => {
      const segments = [
        { startTime: 0, endTime: 2.5, text: "Hello world" },
      ];

      const result = formatVTT(segments);

      expect(result).toBe(
        "WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.500\nHello world\n"
      );
    });
  });

  describe("formatTranscript", () => {
    const mockResult = {
      id: "test-id",
      status: "completed",
      fullText: "Hello world. This is a test.",
      segments: [
        { startTime: 0, endTime: 2.5, text: "Hello world." },
        { startTime: 2.5, endTime: 5.0, text: "This is a test." },
      ],
    };

    it("formats as JSON", () => {
      const result = formatTranscript(mockResult, "json");
      const parsed = JSON.parse(result);

      expect(parsed.id).toBe("test-id");
      expect(parsed.segments).toHaveLength(2);
    });

    it("formats as SRT", () => {
      const result = formatTranscript(mockResult, "srt");

      expect(result).toContain("00:00:00,000 --> 00:00:02,500");
      expect(result).toContain("Hello world.");
      expect(result).not.toContain("WEBVTT");
    });

    it("formats as VTT", () => {
      const result = formatTranscript(mockResult, "vtt");

      expect(result).toContain("WEBVTT");
      expect(result).toContain("00:00:00.000 --> 00:00:02.500");
      expect(result).toContain("Hello world.");
    });

    it("handles empty segments", () => {
      const emptyResult = { id: "test", status: "completed" };

      expect(formatTranscript(emptyResult, "srt")).toBe("");
      expect(formatTranscript(emptyResult, "vtt")).toBe("WEBVTT\n\n");
    });
  });
});
