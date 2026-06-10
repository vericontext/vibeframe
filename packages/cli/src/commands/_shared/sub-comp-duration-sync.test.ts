import { describe, expect, it } from "vitest";
import {
  syncSubCompositionDurationHtml,
  SUB_COMP_SYNC_FIX_CODES,
} from "./sub-comp-duration-sync.js";

function sceneHtml(opts: {
  beatId?: string;
  rootDuration: number;
  clips?: Array<{ start: number; duration: number }>;
  script?: string;
}): string {
  const beatId = opts.beatId ?? "hook";
  const clips = (opts.clips ?? [{ start: 0, duration: opts.rootDuration }])
    .map(
      (c) =>
        `    <div class="clip" data-start="${c.start}" data-duration="${c.duration}" data-track-index="1"></div>`
    )
    .join("\n");
  return `<template id="scene-${beatId}-template">
  <div data-composition-id="scene-${beatId}" data-start="0" data-duration="${opts.rootDuration}" data-width="1920" data-height="1080">
${clips}
    <script src="https://cdn.example/gsap.min.js"></script>
    <script>
${opts.script ?? ""}
    </script>
  </div>
</template>`;
}

describe("syncSubCompositionDurationHtml", () => {
  it("is a no-op when the duration already matches", () => {
    const html = sceneHtml({ rootDuration: 8.26 });
    const result = syncSubCompositionDurationHtml(html, "hook", 8.26);
    expect(result.changed).toBe(false);
    expect(result.fixCodes).toEqual([]);
  });

  it("is a no-op when the composition root cannot be found", () => {
    const result = syncSubCompositionDurationHtml("<div>not a scene</div>", "hook", 9);
    expect(result.changed).toBe(false);
  });

  it("rewrites root data-duration and end-aligned clips", () => {
    const html = sceneHtml({
      rootDuration: 6,
      clips: [
        { start: 0, duration: 6 },
        { start: 1.5, duration: 4.5 },
        { start: 0, duration: 2 }, // not end-aligned — must stay untouched
      ],
    });
    const result = syncSubCompositionDurationHtml(html, "hook", 8.26);
    expect(result.changed).toBe(true);
    expect(result.fixCodes).toContain(SUB_COMP_SYNC_FIX_CODES.rootDuration);
    expect(result.fixCodes).toContain(SUB_COMP_SYNC_FIX_CODES.clipDurations);
    expect(result.nextHtml).toContain('data-composition-id="scene-hook" data-start="0" data-duration="8.26"');
    expect(result.nextHtml).toContain('data-start="0" data-duration="8.26" data-track-index="1"');
    expect(result.nextHtml).toContain('data-start="1.5" data-duration="6.76" data-track-index="1"');
    expect(result.nextHtml).toContain('data-start="0" data-duration="2" data-track-index="1"');
  });

  it("rewrites a single timeline anchor const referenced by the timeline", () => {
    const html = sceneHtml({
      rootDuration: 7,
      script: `      const DUR = 7;
      const tl = gsap.timeline({ paused: true });
      tl.fromTo(".backdrop", { scale: 1 }, { scale: 1.015, duration: DUR, ease: "none" }, 0);
      tl.set(".card", { opacity: 1 }, DUR - 0.001);`,
    });
    const result = syncSubCompositionDurationHtml(html, "hook", 11.62);
    expect(result.fixCodes).toContain(SUB_COMP_SYNC_FIX_CODES.timelineConst);
    expect(result.nextHtml).toContain("const DUR = 11.62;");
    expect(result.issues).toEqual([]);
  });

  it("flags ambiguous timelines instead of editing them", () => {
    const html = sceneHtml({
      rootDuration: 7,
      script: `      const tl = gsap.timeline({ paused: true });
      tl.fromTo(".backdrop", { scale: 1 }, { scale: 1.015, duration: 7, ease: "none" }, 0);`,
    });
    const result = syncSubCompositionDurationHtml(html, "hook", 11.62);
    expect(result.changed).toBe(true);
    expect(result.fixCodes).not.toContain(SUB_COMP_SYNC_FIX_CODES.timelineConst);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      code: "SCENE_TIMELINE_DURATION_OUT_OF_SYNC",
      severity: "warning",
      fixOwner: "host-agent",
    });
    // The literal-anchored script must NOT be mutated.
    expect(result.nextHtml).toContain("duration: 7, ease");
  });

  it("stays quiet when the timeline has no old-duration anchor at all", () => {
    const html = sceneHtml({
      rootDuration: 7,
      script: `      const tl = gsap.timeline({ paused: true });
      tl.from(".title", { y: 40, opacity: 0, duration: 0.5 }, 0.2);`,
    });
    const result = syncSubCompositionDurationHtml(html, "hook", 11.62);
    expect(result.changed).toBe(true);
    expect(result.issues).toEqual([]);
  });
});
