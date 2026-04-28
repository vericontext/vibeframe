import { describe, expect, it } from "vitest";

import {
  WALKTHROUGH_TOPICS,
  isWalkthroughTopic,
  listWalkthroughs,
  loadWalkthrough,
} from "./walkthroughs.js";

describe("walkthroughs", () => {
  describe("WALKTHROUGH_TOPICS", () => {
    it("includes both scene and pipeline", () => {
      expect(WALKTHROUGH_TOPICS).toContain("scene");
      expect(WALKTHROUGH_TOPICS).toContain("pipeline");
      expect(WALKTHROUGH_TOPICS).toHaveLength(2);
    });
  });

  describe("isWalkthroughTopic", () => {
    it("accepts known topics", () => {
      expect(isWalkthroughTopic("scene")).toBe(true);
      expect(isWalkthroughTopic("pipeline")).toBe(true);
    });
    it("rejects unknown values", () => {
      expect(isWalkthroughTopic("agent")).toBe(false);
      expect(isWalkthroughTopic("")).toBe(false);
      expect(isWalkthroughTopic(undefined)).toBe(false);
      expect(isWalkthroughTopic(123)).toBe(false);
    });
  });

  describe("loadWalkthrough", () => {
    it("returns the scene walkthrough with all required fields", () => {
      const r = loadWalkthrough("scene");
      expect(r.topic).toBe("scene");
      expect(r.title).toContain("Scene");
      expect(r.summary.length).toBeGreaterThan(10);
      expect(r.steps.length).toBeGreaterThanOrEqual(3);
      expect(r.relatedCommands).toContain("vibe scene init");
      expect(r.relatedCommands).toContain("vibe scene build");
      expect(r.relatedCommands).toContain("vibe scene compose-prompts");
      expect(r.content.length).toBeGreaterThan(500);
      expect(r.content).toContain("STORYBOARD.md");
    });

    it("returns the pipeline walkthrough with all required fields", () => {
      const r = loadWalkthrough("pipeline");
      expect(r.topic).toBe("pipeline");
      expect(r.title).toContain("pipelines");
      expect(r.steps.length).toBeGreaterThanOrEqual(3);
      expect(r.relatedCommands).toContain("vibe run");
      expect(r.content).toContain("steps:");
      expect(r.content).toContain("$<step-id>");
    });

    it("scene walkthrough mentions Plan H mode dispatch (--mode agent)", () => {
      const r = loadWalkthrough("scene");
      expect(r.content).toMatch(/--mode agent/);
      expect(r.content).toContain("compose-prompts");
    });

    it("pipeline walkthrough enumerates the supported actions", () => {
      const r = loadWalkthrough("pipeline");
      expect(r.content).toContain("generate-image");
      expect(r.content).toContain("scene-build");
      expect(r.content).toContain("compose-scenes-with-skills");
    });

    it("steps are non-trivial actionable instructions and at least one references a vibe command", () => {
      for (const topic of WALKTHROUGH_TOPICS) {
        const r = loadWalkthrough(topic);
        for (const step of r.steps) {
          expect(step.length).toBeGreaterThan(20);
        }
        // The walkthrough as a whole must drive the user toward a vibe command —
        // mostly the case anyway, but assert it explicitly so a future edit
        // doesn't drift into pure prose.
        const hasVibeCommand = r.steps.some((s) => /\bvibe\s/.test(s));
        expect(hasVibeCommand, `walkthrough "${topic}" steps mention no vibe command`).toBe(true);
      }
    });
  });

  describe("listWalkthroughs", () => {
    it("returns a catalog with topic + title + summary for each entry", () => {
      const list = listWalkthroughs();
      expect(list).toHaveLength(2);
      for (const entry of list) {
        expect(entry.topic).toMatch(/^scene$|^pipeline$/);
        expect(entry.title.length).toBeGreaterThan(5);
        expect(entry.summary.length).toBeGreaterThan(10);
      }
    });

    it("ordering is stable (scene first, then pipeline) for predictable agent output", () => {
      const list = listWalkthroughs();
      expect(list[0].topic).toBe("scene");
      expect(list[1].topic).toBe("pipeline");
    });
  });
});
