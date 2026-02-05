/**
 * Core package smoke tests
 * Verifies exports and basic functionality
 */

import { describe, it, expect } from "vitest";
import {
  useTimelineStore,
  generateId,
  type TimelineState,
  type Clip,
  type Track,
  type MediaSource,
  type Effect,
  type TimelineStore,
} from "./index.js";

describe("@vibeframe/core", () => {
  describe("exports", () => {
    it("should export useTimelineStore", () => {
      expect(useTimelineStore).toBeDefined();
      expect(typeof useTimelineStore).toBe("function");
    });

    it("should export generateId", () => {
      expect(generateId).toBeDefined();
      expect(typeof generateId).toBe("function");
    });
  });

  describe("generateId", () => {
    it("should generate unique IDs", () => {
      const id1 = generateId();
      const id2 = generateId();

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
    });

    it("should generate IDs in expected format", () => {
      const id = generateId();
      // Format: timestamp-randomstring
      expect(id).toMatch(/^\d+-[a-z0-9]+$/);
    });
  });

  describe("useTimelineStore", () => {
    it("should provide getState method", () => {
      expect(typeof useTimelineStore.getState).toBe("function");
    });

    it("should have initial state with project", () => {
      const state = useTimelineStore.getState();

      expect(state.project).toBeDefined();
      expect(state.project.name).toBe("Untitled Project");
      expect(state.tracks).toBeDefined();
      expect(Array.isArray(state.tracks)).toBe(true);
      expect(state.clips).toBeDefined();
      expect(Array.isArray(state.clips)).toBe(true);
    });

    it("should have default tracks", () => {
      const state = useTimelineStore.getState();

      expect(state.tracks.length).toBeGreaterThanOrEqual(2);

      const videoTrack = state.tracks.find((t: Track) => t.type === "video");
      const audioTrack = state.tracks.find((t: Track) => t.type === "audio");

      expect(videoTrack).toBeDefined();
      expect(audioTrack).toBeDefined();
    });

    it("should have action methods", () => {
      const state = useTimelineStore.getState();

      // Check that common actions exist
      expect(typeof state.addSource).toBe("function");
      expect(typeof state.addClip).toBe("function");
      expect(typeof state.addTrack).toBe("function");
      expect(typeof state.removeClip).toBe("function");
    });
  });
});
