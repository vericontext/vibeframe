/**
 * Unit tests for scene-audio-scan. Pure parsing — no fs touches via the
 * injected `readComposition` reader.
 */

import { describe, expect, it } from "vitest";
import {
  parseRootClips,
  parseSceneAudios,
  scanSceneAudio,
} from "./scene-audio-scan.js";

describe("parseRootClips", () => {
  it("returns one entry per <div class=\"clip\"> with all four attrs", () => {
    const html = `
<div id="root" data-composition-id="main" data-start="0" data-duration="10">
  <div class="clip" data-composition-id="intro" data-composition-src="compositions/scene-intro.html" data-start="0" data-duration="3" data-track-index="1"></div>
  <div class="clip" data-composition-id="outro" data-composition-src="compositions/scene-outro.html" data-start="3" data-duration="4" data-track-index="1"></div>
</div>`;
    const clips = parseRootClips(html);
    expect(clips).toEqual([
      {
        compositionId: "intro",
        compositionSrc: "compositions/scene-intro.html",
        start: 0,
        duration: 3,
        trackIndex: 1,
      },
      {
        compositionId: "outro",
        compositionSrc: "compositions/scene-outro.html",
        start: 3,
        duration: 4,
        trackIndex: 1,
      },
    ]);
  });

  it("ignores divs without class=\"clip\"", () => {
    const html = `<div class="backdrop" data-composition-id="x" data-start="0" data-duration="1"></div>`;
    expect(parseRootClips(html)).toEqual([]);
  });

  it("skips clips missing required attributes", () => {
    const html = `<div class="clip" data-start="0" data-duration="3"></div>`; // no composition-id/src
    expect(parseRootClips(html)).toEqual([]);
  });

  it("defaults trackIndex to 1 when absent", () => {
    const html = `<div class="clip" data-composition-id="x" data-composition-src="x.html" data-start="0" data-duration="2"></div>`;
    expect(parseRootClips(html)[0].trackIndex).toBe(1);
  });

  it("tolerates attribute order and whitespace", () => {
    const html = `<div  data-start="2"   class="clip"
        data-duration="5"
        data-composition-id="mid"
        data-composition-src="compositions/mid.html"></div>`;
    expect(parseRootClips(html)).toHaveLength(1);
    expect(parseRootClips(html)[0]).toMatchObject({
      compositionId: "mid",
      start: 2,
      duration: 5,
    });
  });
});

describe("parseSceneAudios", () => {
  it("extracts narration audio with all attributes", () => {
    const html = `
<template id="scene-intro-template">
  <div data-composition-id="intro" data-start="0" data-duration="5">
    <audio
      id="narration"
      data-start="0"
      data-duration="auto"
      data-track-index="2"
      src="assets/narration-intro.wav"
      data-volume="1"
    ></audio>
  </div>
</template>`;
    const audios = parseSceneAudios(html);
    expect(audios).toEqual([
      {
        srcRel: "assets/narration-intro.wav",
        localStart: 0,
        durationHint: "auto",
        volume: 1,
        trackIndex: 2,
      },
    ]);
  });

  it("treats numeric data-duration as a hard duration", () => {
    const html = `<audio src="x.mp3" data-start="1.5" data-duration="3.2" data-volume="0.6"></audio>`;
    expect(parseSceneAudios(html)[0]).toMatchObject({
      localStart: 1.5,
      durationHint: 3.2,
      volume: 0.6,
    });
  });

  it("defaults volume to 1 and trackIndex to 2 when absent", () => {
    const html = `<audio src="x.wav" data-start="0"></audio>`;
    const audios = parseSceneAudios(html);
    expect(audios[0]).toMatchObject({ volume: 1, trackIndex: 2, durationHint: "auto" });
  });

  it("ignores audio without src", () => {
    const html = `<audio data-start="0" data-duration="auto"></audio>`;
    expect(parseSceneAudios(html)).toEqual([]);
  });

  it("supports multiple audios in one composition (narration + music)", () => {
    const html = `
<audio src="assets/narration-1.wav" data-start="0" data-duration="auto" data-track-index="2"></audio>
<audio src="assets/music.mp3" data-start="0" data-duration="auto" data-track-index="3" data-volume="0.4"></audio>`;
    const audios = parseSceneAudios(html);
    expect(audios).toHaveLength(2);
    expect(audios[0].trackIndex).toBe(2);
    expect(audios[1]).toMatchObject({ trackIndex: 3, volume: 0.4 });
  });
});

describe("scanSceneAudio (top-level)", () => {
  const rootHtml = `
<div id="root">
  <div class="clip" data-composition-id="intro" data-composition-src="compositions/scene-intro.html" data-start="0" data-duration="3" data-track-index="1"></div>
  <div class="clip" data-composition-id="outro" data-composition-src="compositions/scene-outro.html" data-start="3" data-duration="4" data-track-index="1"></div>
</div>`;

  const introHtml = `
<audio src="assets/narration-intro.wav" data-start="0" data-duration="auto" data-track-index="2"></audio>`;
  const outroHtml = `
<audio src="assets/narration-outro.wav" data-start="0.5" data-duration="auto" data-track-index="2" data-volume="0.8"></audio>`;

  const reader = async (path: string): Promise<string | null> => {
    if (path === "compositions/scene-intro.html") return introHtml;
    if (path === "compositions/scene-outro.html") return outroHtml;
    return null;
  };

  it("walks every clip and resolves absolute timing", async () => {
    const result = await scanSceneAudio({
      projectDir: "/tmp/proj",
      rootHtml,
      readComposition: reader,
    });
    expect(result).toEqual([
      {
        srcRel: "assets/narration-intro.wav",
        srcAbs: "/tmp/proj/assets/narration-intro.wav",
        absoluteStart: 0,
        durationHint: "auto",
        clipDurationCap: 3,
        volume: 1,
        trackIndex: 2,
        compositionSrc: "compositions/scene-intro.html",
      },
      {
        srcRel: "assets/narration-outro.wav",
        srcAbs: "/tmp/proj/assets/narration-outro.wav",
        absoluteStart: 3.5,
        durationHint: "auto",
        clipDurationCap: 3.5, // 4 - 0.5 (audio.localStart)
        volume: 0.8,
        trackIndex: 2,
        compositionSrc: "compositions/scene-outro.html",
      },
    ]);
  });

  it("skips clips whose composition file is missing", async () => {
    const sparseReader = async (p: string) =>
      p === "compositions/scene-intro.html" ? introHtml : null;
    const result = await scanSceneAudio({
      projectDir: "/tmp/proj",
      rootHtml,
      readComposition: sparseReader,
    });
    expect(result).toHaveLength(1);
    expect(result[0].srcRel).toBe("assets/narration-intro.wav");
  });

  it("skips clips with no <audio> elements", async () => {
    const silentReader = async () =>
      `<div data-composition-id="x"></div>`;
    const result = await scanSceneAudio({
      projectDir: "/tmp/proj",
      rootHtml,
      readComposition: silentReader,
    });
    expect(result).toEqual([]);
  });

  it("returns audios sorted by absolute start", async () => {
    const reorderedRoot = `
<div class="clip" data-composition-id="b" data-composition-src="b.html" data-start="5" data-duration="2"></div>
<div class="clip" data-composition-id="a" data-composition-src="a.html" data-start="0" data-duration="3"></div>`;
    const r = async (p: string) =>
      p === "a.html" || p === "b.html"
        ? `<audio src="x.wav" data-start="0"></audio>`
        : null;

    const result = await scanSceneAudio({
      projectDir: "/p",
      rootHtml: reorderedRoot,
      readComposition: r,
    });
    expect(result.map((r) => r.absoluteStart)).toEqual([0, 5]);
  });
});
