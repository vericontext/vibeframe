import { describe, it, expect, beforeEach } from "vitest";
import { Project, generateId } from "./project";

describe("generateId", () => {
  it("generates unique IDs", () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).not.toBe(id2);
  });

  it("generates IDs in expected format", () => {
    const id = generateId();
    expect(id).toMatch(/^\d+-[a-z0-9]+$/);
  });
});

describe("Project", () => {
  let project: Project;

  beforeEach(() => {
    project = new Project("Test Project");
  });

  describe("initialization", () => {
    it("creates project with given name", () => {
      expect(project.getMeta().name).toBe("Test Project");
    });

    it("creates project with default aspect ratio 16:9", () => {
      expect(project.getMeta().aspectRatio).toBe("16:9");
    });

    it("creates project with default frame rate 30", () => {
      expect(project.getMeta().frameRate).toBe(30);
    });

    it("creates project with two default tracks", () => {
      const tracks = project.getTracks();
      expect(tracks).toHaveLength(2);
      expect(tracks[0].type).toBe("video");
      expect(tracks[1].type).toBe("audio");
    });

    it("creates project with empty clips and sources", () => {
      expect(project.getClips()).toHaveLength(0);
      expect(project.getSources()).toHaveLength(0);
    });

    it("creates project with zero duration", () => {
      expect(project.getDuration()).toBe(0);
    });
  });

  describe("project settings", () => {
    it("sets project name", () => {
      project.setName("New Name");
      expect(project.getMeta().name).toBe("New Name");
    });

    it("sets aspect ratio", () => {
      project.setAspectRatio("9:16");
      expect(project.getMeta().aspectRatio).toBe("9:16");
    });

    it("sets frame rate", () => {
      project.setFrameRate(60);
      expect(project.getMeta().frameRate).toBe(60);
    });
  });

  describe("media sources", () => {
    it("adds a source", () => {
      const source = project.addSource({
        name: "test.mp4",
        type: "video",
        url: "/path/to/test.mp4",
        duration: 10,
      });

      expect(source.id).toBeDefined();
      expect(source.name).toBe("test.mp4");
      expect(project.getSources()).toHaveLength(1);
    });

    it("gets source by id", () => {
      const source = project.addSource({
        name: "test.mp4",
        type: "video",
        url: "/path/to/test.mp4",
        duration: 10,
      });

      const found = project.getSource(source.id);
      expect(found).toBeDefined();
      expect(found?.name).toBe("test.mp4");
    });

    it("removes a source", () => {
      const source = project.addSource({
        name: "test.mp4",
        type: "video",
        url: "/path/to/test.mp4",
        duration: 10,
      });

      const removed = project.removeSource(source.id);
      expect(removed).toBe(true);
      expect(project.getSources()).toHaveLength(0);
    });

    it("removes clips when source is removed", () => {
      const source = project.addSource({
        name: "test.mp4",
        type: "video",
        url: "/path/to/test.mp4",
        duration: 10,
      });

      project.addClip({
        sourceId: source.id,
        trackId: "video-track-1",
        startTime: 0,
        duration: 5,
        sourceStartOffset: 0,
        sourceEndOffset: 5,
      });

      expect(project.getClips()).toHaveLength(1);
      project.removeSource(source.id);
      expect(project.getClips()).toHaveLength(0);
    });

    it("returns false when removing non-existent source", () => {
      const removed = project.removeSource("non-existent");
      expect(removed).toBe(false);
    });
  });

  describe("tracks", () => {
    it("adds a track", () => {
      const track = project.addTrack({
        name: "Video 2",
        type: "video",
        order: 2,
        isMuted: false,
        isLocked: false,
        isVisible: true,
      });

      expect(track.id).toBeDefined();
      expect(track.name).toBe("Video 2");
      expect(project.getTracks()).toHaveLength(3);
    });

    it("gets track by id", () => {
      const track = project.getTrack("video-track-1");
      expect(track).toBeDefined();
      expect(track?.name).toBe("Video 1");
    });

    it("gets tracks by type", () => {
      const videoTracks = project.getTracksByType("video");
      const audioTracks = project.getTracksByType("audio");

      expect(videoTracks).toHaveLength(1);
      expect(audioTracks).toHaveLength(1);
    });

    it("updates a track", () => {
      const updated = project.updateTrack("video-track-1", { name: "Main Video" });
      expect(updated).toBe(true);
      expect(project.getTrack("video-track-1")?.name).toBe("Main Video");
    });

    it("removes a track", () => {
      const removed = project.removeTrack("video-track-1");
      expect(removed).toBe(true);
      expect(project.getTracks()).toHaveLength(1);
    });

    it("removes clips when track is removed", () => {
      const source = project.addSource({
        name: "test.mp4",
        type: "video",
        url: "/path/to/test.mp4",
        duration: 10,
      });

      project.addClip({
        sourceId: source.id,
        trackId: "video-track-1",
        startTime: 0,
        duration: 5,
        sourceStartOffset: 0,
        sourceEndOffset: 5,
      });

      expect(project.getClips()).toHaveLength(1);
      project.removeTrack("video-track-1");
      expect(project.getClips()).toHaveLength(0);
    });
  });

  describe("clips", () => {
    let sourceId: string;

    beforeEach(() => {
      const source = project.addSource({
        name: "test.mp4",
        type: "video",
        url: "/path/to/test.mp4",
        duration: 10,
      });
      sourceId = source.id;
    });

    it("adds a clip", () => {
      const clip = project.addClip({
        sourceId,
        trackId: "video-track-1",
        startTime: 0,
        duration: 5,
        sourceStartOffset: 0,
        sourceEndOffset: 5,
      });

      expect(clip.id).toBeDefined();
      expect(clip.effects).toEqual([]);
      expect(project.getClips()).toHaveLength(1);
    });

    it("gets clip by id", () => {
      const clip = project.addClip({
        sourceId,
        trackId: "video-track-1",
        startTime: 0,
        duration: 5,
        sourceStartOffset: 0,
        sourceEndOffset: 5,
      });

      const found = project.getClip(clip.id);
      expect(found).toBeDefined();
      expect(found?.sourceId).toBe(sourceId);
    });

    it("gets clips by track", () => {
      project.addClip({
        sourceId,
        trackId: "video-track-1",
        startTime: 0,
        duration: 5,
        sourceStartOffset: 0,
        sourceEndOffset: 5,
      });

      const videoClips = project.getClipsByTrack("video-track-1");
      const audioClips = project.getClipsByTrack("audio-track-1");

      expect(videoClips).toHaveLength(1);
      expect(audioClips).toHaveLength(0);
    });

    it("updates a clip", () => {
      const clip = project.addClip({
        sourceId,
        trackId: "video-track-1",
        startTime: 0,
        duration: 5,
        sourceStartOffset: 0,
        sourceEndOffset: 5,
      });

      const updated = project.updateClip(clip.id, { duration: 3 });
      expect(updated).toBe(true);
      expect(project.getClip(clip.id)?.duration).toBe(3);
    });

    it("moves a clip", () => {
      const clip = project.addClip({
        sourceId,
        trackId: "video-track-1",
        startTime: 0,
        duration: 5,
        sourceStartOffset: 0,
        sourceEndOffset: 5,
      });

      project.moveClip(clip.id, "video-track-1", 10);
      expect(project.getClip(clip.id)?.startTime).toBe(10);
    });

    it("prevents negative start time when moving", () => {
      const clip = project.addClip({
        sourceId,
        trackId: "video-track-1",
        startTime: 5,
        duration: 5,
        sourceStartOffset: 0,
        sourceEndOffset: 5,
      });

      project.moveClip(clip.id, "video-track-1", -10);
      expect(project.getClip(clip.id)?.startTime).toBe(0);
    });

    it("trims clip start", () => {
      const clip = project.addClip({
        sourceId,
        trackId: "video-track-1",
        startTime: 0,
        duration: 10,
        sourceStartOffset: 0,
        sourceEndOffset: 10,
      });

      project.trimClipStart(clip.id, 2);
      const updated = project.getClip(clip.id);
      expect(updated?.startTime).toBe(2);
      expect(updated?.sourceStartOffset).toBe(2);
      expect(updated?.duration).toBe(8);
    });

    it("trims clip end", () => {
      const clip = project.addClip({
        sourceId,
        trackId: "video-track-1",
        startTime: 0,
        duration: 10,
        sourceStartOffset: 0,
        sourceEndOffset: 10,
      });

      project.trimClipEnd(clip.id, 5);
      const updated = project.getClip(clip.id);
      expect(updated?.duration).toBe(5);
      expect(updated?.sourceEndOffset).toBe(5);
    });

    it("enforces minimum duration when trimming", () => {
      const clip = project.addClip({
        sourceId,
        trackId: "video-track-1",
        startTime: 0,
        duration: 10,
        sourceStartOffset: 0,
        sourceEndOffset: 10,
      });

      project.trimClipEnd(clip.id, 0);
      expect(project.getClip(clip.id)?.duration).toBe(0.1);
    });

    it("removes a clip", () => {
      const clip = project.addClip({
        sourceId,
        trackId: "video-track-1",
        startTime: 0,
        duration: 5,
        sourceStartOffset: 0,
        sourceEndOffset: 5,
      });

      const removed = project.removeClip(clip.id);
      expect(removed).toBe(true);
      expect(project.getClips()).toHaveLength(0);
    });

    it("calculates project duration from clips", () => {
      project.addClip({
        sourceId,
        trackId: "video-track-1",
        startTime: 0,
        duration: 5,
        sourceStartOffset: 0,
        sourceEndOffset: 5,
      });

      project.addClip({
        sourceId,
        trackId: "video-track-1",
        startTime: 10,
        duration: 5,
        sourceStartOffset: 0,
        sourceEndOffset: 5,
      });

      expect(project.getDuration()).toBe(15);
    });

    describe("splitClip", () => {
      it("splits a clip at given time", () => {
        const clip = project.addClip({
          sourceId,
          trackId: "video-track-1",
          startTime: 0,
          duration: 10,
          sourceStartOffset: 0,
          sourceEndOffset: 10,
        });

        const result = project.splitClip(clip.id, 4);
        expect(result).not.toBeNull();

        const [firstClip, secondClip] = result!;
        expect(firstClip.duration).toBe(4);
        expect(firstClip.sourceEndOffset).toBe(4);
        expect(secondClip.startTime).toBe(4);
        expect(secondClip.duration).toBe(6);
        expect(secondClip.sourceStartOffset).toBe(4);
        expect(project.getClips()).toHaveLength(2);
      });

      it("returns null for non-existent clip", () => {
        const result = project.splitClip("non-existent", 5);
        expect(result).toBeNull();
      });

      it("returns null when split time is at or before 0", () => {
        const clip = project.addClip({
          sourceId,
          trackId: "video-track-1",
          startTime: 0,
          duration: 10,
          sourceStartOffset: 0,
          sourceEndOffset: 10,
        });

        expect(project.splitClip(clip.id, 0)).toBeNull();
        expect(project.splitClip(clip.id, -1)).toBeNull();
      });

      it("returns null when split time is at or after duration", () => {
        const clip = project.addClip({
          sourceId,
          trackId: "video-track-1",
          startTime: 0,
          duration: 10,
          sourceStartOffset: 0,
          sourceEndOffset: 10,
        });

        expect(project.splitClip(clip.id, 10)).toBeNull();
        expect(project.splitClip(clip.id, 15)).toBeNull();
      });
    });

    describe("duplicateClip", () => {
      it("duplicates a clip after original", () => {
        const clip = project.addClip({
          sourceId,
          trackId: "video-track-1",
          startTime: 0,
          duration: 5,
          sourceStartOffset: 0,
          sourceEndOffset: 5,
        });

        const duplicate = project.duplicateClip(clip.id);
        expect(duplicate).not.toBeNull();
        expect(duplicate?.sourceId).toBe(sourceId);
        expect(duplicate?.trackId).toBe("video-track-1");
        expect(duplicate?.startTime).toBe(5); // After original
        expect(duplicate?.duration).toBe(5);
        expect(project.getClips()).toHaveLength(2);
      });

      it("duplicates a clip at specified time", () => {
        const clip = project.addClip({
          sourceId,
          trackId: "video-track-1",
          startTime: 0,
          duration: 5,
          sourceStartOffset: 0,
          sourceEndOffset: 5,
        });

        const duplicate = project.duplicateClip(clip.id, 20);
        expect(duplicate).not.toBeNull();
        expect(duplicate?.startTime).toBe(20);
      });

      it("duplicates clip effects with new IDs", () => {
        const clip = project.addClip({
          sourceId,
          trackId: "video-track-1",
          startTime: 0,
          duration: 5,
          sourceStartOffset: 0,
          sourceEndOffset: 5,
        });

        project.addEffect(clip.id, {
          type: "fadeIn",
          startTime: 0,
          duration: 1,
          params: { intensity: 1 },
        });

        const duplicate = project.duplicateClip(clip.id);
        expect(duplicate?.effects).toHaveLength(1);
        expect(duplicate?.effects[0].type).toBe("fadeIn");
        expect(duplicate?.effects[0].id).not.toBe(clip.effects?.[0]?.id);
      });

      it("returns null for non-existent clip", () => {
        const result = project.duplicateClip("non-existent");
        expect(result).toBeNull();
      });
    });
  });

  describe("effects", () => {
    let clipId: string;

    beforeEach(() => {
      const source = project.addSource({
        name: "test.mp4",
        type: "video",
        url: "/path/to/test.mp4",
        duration: 10,
      });

      const clip = project.addClip({
        sourceId: source.id,
        trackId: "video-track-1",
        startTime: 0,
        duration: 5,
        sourceStartOffset: 0,
        sourceEndOffset: 5,
      });

      clipId = clip.id;
    });

    it("adds an effect to a clip", () => {
      const effect = project.addEffect(clipId, {
        type: "fadeIn",
        startTime: 0,
        duration: 1,
        params: { intensity: 1 },
      });

      expect(effect).not.toBeNull();
      expect(effect?.type).toBe("fadeIn");
      expect(project.getClip(clipId)?.effects).toHaveLength(1);
    });

    it("returns null when adding effect to non-existent clip", () => {
      const effect = project.addEffect("non-existent", {
        type: "fadeIn",
        startTime: 0,
        duration: 1,
        params: {},
      });

      expect(effect).toBeNull();
    });

    it("removes an effect from a clip", () => {
      const effect = project.addEffect(clipId, {
        type: "fadeIn",
        startTime: 0,
        duration: 1,
        params: {},
      });

      const removed = project.removeEffect(clipId, effect!.id);
      expect(removed).toBe(true);
      expect(project.getClip(clipId)?.effects).toHaveLength(0);
    });

    it("updates an effect", () => {
      const effect = project.addEffect(clipId, {
        type: "fadeIn",
        startTime: 0,
        duration: 1,
        params: { intensity: 0.5 },
      });

      const updated = project.updateEffect(clipId, effect!.id, {
        params: { intensity: 1 },
      });

      expect(updated).toBe(true);
      expect(project.getClip(clipId)?.effects[0].params.intensity).toBe(1);
    });
  });

  describe("transitions", () => {
    it("adds a transition", () => {
      const transition = project.addTransition({
        type: "dissolve",
        duration: 1,
        fromClipId: "clip-1",
        toClipId: "clip-2",
      });

      expect(transition.id).toBeDefined();
      expect(project.getTransitions()).toHaveLength(1);
    });

    it("removes a transition", () => {
      const transition = project.addTransition({
        type: "dissolve",
        duration: 1,
        fromClipId: "clip-1",
        toClipId: "clip-2",
      });

      const removed = project.removeTransition(transition.id);
      expect(removed).toBe(true);
      expect(project.getTransitions()).toHaveLength(0);
    });
  });

  describe("serialization", () => {
    it("serializes to JSON", () => {
      const source = project.addSource({
        name: "test.mp4",
        type: "video",
        url: "/path/to/test.mp4",
        duration: 10,
      });

      project.addClip({
        sourceId: source.id,
        trackId: "video-track-1",
        startTime: 0,
        duration: 5,
        sourceStartOffset: 0,
        sourceEndOffset: 5,
      });

      const json = project.toJSON();
      expect(json.version).toBe("1.0.0");
      expect(json.state.project.name).toBe("Test Project");
      expect(json.state.sources).toHaveLength(1);
      expect(json.state.clips).toHaveLength(1);
    });

    it("deserializes from JSON", () => {
      const source = project.addSource({
        name: "test.mp4",
        type: "video",
        url: "/path/to/test.mp4",
        duration: 10,
      });

      project.addClip({
        sourceId: source.id,
        trackId: "video-track-1",
        startTime: 0,
        duration: 5,
        sourceStartOffset: 0,
        sourceEndOffset: 5,
      });

      const json = project.toJSON();
      const restored = Project.fromJSON(json);

      expect(restored.getMeta().name).toBe("Test Project");
      expect(restored.getSources()).toHaveLength(1);
      expect(restored.getClips()).toHaveLength(1);
    });

    it("returns immutable state copy", () => {
      const state1 = project.getState();
      const state2 = project.getState();

      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe("summary", () => {
    it("returns project summary", () => {
      const source = project.addSource({
        name: "test.mp4",
        type: "video",
        url: "/path/to/test.mp4",
        duration: 10,
      });

      project.addClip({
        sourceId: source.id,
        trackId: "video-track-1",
        startTime: 0,
        duration: 5,
        sourceStartOffset: 0,
        sourceEndOffset: 5,
      });

      const summary = project.getSummary();
      expect(summary.name).toBe("Test Project");
      expect(summary.duration).toBe(5);
      expect(summary.trackCount).toBe(2);
      expect(summary.clipCount).toBe(1);
      expect(summary.sourceCount).toBe(1);
    });
  });
});
