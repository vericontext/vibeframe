import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock the two ffmpeg-shelling helpers so the orchestration is tested
// deterministically without a real ffmpeg/ffprobe. `scanSceneAudio` stays real
// (pure HTML parsing).
vi.mock("./scene-audio-mux.js", () => ({
  muxAudioIntoVideo: vi.fn(async () => ({
    success: true,
    outputPath: "video.mp4",
    audioCount: 1,
  })),
}));
vi.mock("../../utils/exec-safe.js", () => ({
  ffprobeDuration: vi.fn(async () => 12.5),
}));

import { executeSceneAssemble } from "./scene-assemble.js";
import { muxAudioIntoVideo } from "./scene-audio-mux.js";
import { ffprobeDuration } from "../../utils/exec-safe.js";

const ROOT_NO_AUDIO = `<div id="root" data-composition-id="m" data-start="0" data-duration="5"></div>`;
const ROOT_WITH_AUDIO = `<div id="root" data-composition-id="m" data-start="0" data-duration="5">
  <audio src="assets/music.mp3" data-start="0"></audio>
</div>`;

describe("executeSceneAssemble", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "assemble-test-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("fails when the video does not exist", async () => {
    writeFileSync(join(projectDir, "index.html"), ROOT_NO_AUDIO);
    const r = await executeSceneAssemble({ projectDir, videoPath: "missing.mp4" });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Video not found/);
    expect(muxAudioIntoVideo).not.toHaveBeenCalled();
  });

  it("fails when the root composition is missing", async () => {
    writeFileSync(join(projectDir, "video.mp4"), Buffer.from([0]));
    const r = await executeSceneAssemble({ projectDir, videoPath: "video.mp4", root: "nope.html" });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Root composition not found/);
  });

  it("returns audioCount 0 + no mux when the project has no audio", async () => {
    writeFileSync(join(projectDir, "index.html"), ROOT_NO_AUDIO);
    writeFileSync(join(projectDir, "video.mp4"), Buffer.from([0]));
    const r = await executeSceneAssemble({ projectDir, videoPath: "video.mp4" });
    expect(r.success).toBe(true);
    expect(r.audioCount).toBe(0);
    expect(r.audioMuxApplied).toBe(false);
    expect(muxAudioIntoVideo).not.toHaveBeenCalled();
  });

  it("muxes audio and ffprobes the video duration when not provided", async () => {
    writeFileSync(join(projectDir, "index.html"), ROOT_WITH_AUDIO);
    mkdirSync(join(projectDir, "assets"), { recursive: true });
    writeFileSync(join(projectDir, "assets", "music.mp3"), Buffer.from([1]));
    writeFileSync(join(projectDir, "video.mp4"), Buffer.from([0]));

    const r = await executeSceneAssemble({ projectDir, videoPath: "video.mp4" });
    expect(r.success).toBe(true);
    expect(r.audioCount).toBe(1);
    expect(r.audioMuxApplied).toBe(true);
    expect(ffprobeDuration).toHaveBeenCalledOnce();
    expect(muxAudioIntoVideo).toHaveBeenCalledWith(
      expect.objectContaining({ videoDuration: 12.5 })
    );
  });

  it("passes a provided videoDuration straight through (no ffprobe)", async () => {
    writeFileSync(join(projectDir, "index.html"), ROOT_WITH_AUDIO);
    mkdirSync(join(projectDir, "assets"), { recursive: true });
    writeFileSync(join(projectDir, "assets", "music.mp3"), Buffer.from([1]));
    writeFileSync(join(projectDir, "video.mp4"), Buffer.from([0]));

    const r = await executeSceneAssemble({ projectDir, videoPath: "video.mp4", videoDuration: 8 });
    expect(r.success).toBe(true);
    expect(ffprobeDuration).not.toHaveBeenCalled();
    expect(muxAudioIntoVideo).toHaveBeenCalledWith(expect.objectContaining({ videoDuration: 8 }));
  });

  it("surfaces a mux failure as a non-fatal warning", async () => {
    vi.mocked(muxAudioIntoVideo).mockResolvedValueOnce({
      success: false,
      outputPath: "video.mp4",
      error: "ffmpeg exploded",
      audioCount: 1,
    });
    writeFileSync(join(projectDir, "index.html"), ROOT_WITH_AUDIO);
    mkdirSync(join(projectDir, "assets"), { recursive: true });
    writeFileSync(join(projectDir, "assets", "music.mp3"), Buffer.from([1]));
    writeFileSync(join(projectDir, "video.mp4"), Buffer.from([0]));

    const r = await executeSceneAssemble({ projectDir, videoPath: "video.mp4", videoDuration: 5 });
    expect(r.success).toBe(true);
    expect(r.audioMuxApplied).toBe(false);
    expect(r.audioMuxWarning).toBe("ffmpeg exploded");
  });
});
