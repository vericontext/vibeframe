import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type {
  TimelineState,
  Clip,
  Track,
  MediaSource,
  Effect,
  Id,
  TimeSeconds,
  AspectRatio,
} from "./types.js";

/** Generate unique ID */
export const generateId = (): Id => {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
};

/** Initial timeline state */
const initialState: TimelineState = {
  project: {
    id: generateId(),
    name: "Untitled Project",
    createdAt: new Date(),
    updatedAt: new Date(),
    aspectRatio: "16:9",
    frameRate: 30,
    duration: 0,
  },
  tracks: [
    {
      id: "video-track-1",
      name: "Video 1",
      type: "video",
      order: 1,
      isMuted: false,
      isLocked: false,
      isVisible: true,
    },
    {
      id: "audio-track-1",
      name: "Audio 1",
      type: "audio",
      order: 0,
      isMuted: false,
      isLocked: false,
      isVisible: true,
    },
  ],
  clips: [],
  sources: [],
  transitions: [],
  currentTime: 0,
  isPlaying: false,
  zoom: 50, // 50 pixels per second
  scrollX: 0,
  selectedClipIds: [],
  selectedTrackId: null,
};

/** Timeline actions */
interface TimelineActions {
  // Playback controls
  play: () => void;
  pause: () => void;
  togglePlayback: () => void;
  seek: (time: TimeSeconds) => void;
  setZoom: (zoom: number) => void;
  setScrollX: (scrollX: number) => void;

  // Media sources
  addSource: (source: Omit<MediaSource, "id">) => MediaSource;
  removeSource: (id: Id) => void;

  // Track operations
  addTrack: (track: Omit<Track, "id">) => Track;
  removeTrack: (id: Id) => void;
  updateTrack: (id: Id, updates: Partial<Track>) => void;
  selectTrack: (id: Id | null) => void;

  // Clip operations
  addClip: (clip: Omit<Clip, "id" | "effects">) => Clip;
  removeClip: (id: Id) => void;
  updateClip: (id: Id, updates: Partial<Clip>) => void;
  moveClip: (id: Id, trackId: Id, startTime: TimeSeconds) => void;
  trimClipStart: (id: Id, newStartTime: TimeSeconds) => void;
  trimClipEnd: (id: Id, newDuration: TimeSeconds) => void;
  selectClip: (id: Id, addToSelection?: boolean) => void;
  deselectClip: (id: Id) => void;
  clearSelection: () => void;

  // Effect operations
  addEffect: (clipId: Id, effect: Omit<Effect, "id">) => Effect;
  removeEffect: (clipId: Id, effectId: Id) => void;
  updateEffect: (clipId: Id, effectId: Id, updates: Partial<Effect>) => void;

  // Project operations
  setAspectRatio: (ratio: AspectRatio) => void;
  setProjectName: (name: string) => void;
  calculateDuration: () => void;

  // Reset
  reset: () => void;
}

/** Combined store type */
export type TimelineStore = TimelineState & TimelineActions;

/** Create the timeline store */
export const useTimelineStore = create<TimelineStore>()(
  immer((set, get) => ({
    ...initialState,

    // Playback controls
    play: () => set((state) => { state.isPlaying = true; }),
    pause: () => set((state) => { state.isPlaying = false; }),
    togglePlayback: () => set((state) => { state.isPlaying = !state.isPlaying; }),
    seek: (time) => set((state) => { state.currentTime = Math.max(0, time); }),
    setZoom: (zoom) => set((state) => { state.zoom = Math.max(10, Math.min(200, zoom)); }),
    setScrollX: (scrollX) => set((state) => { state.scrollX = Math.max(0, scrollX); }),

    // Media sources
    addSource: (source) => {
      const newSource: MediaSource = { ...source, id: generateId() };
      set((state) => { state.sources.push(newSource); });
      return newSource;
    },
    removeSource: (id) => set((state) => {
      state.sources = state.sources.filter((s) => s.id !== id);
      state.clips = state.clips.filter((c) => c.sourceId !== id);
    }),

    // Track operations
    addTrack: (track) => {
      const newTrack: Track = { ...track, id: generateId() };
      set((state) => { state.tracks.push(newTrack); });
      return newTrack;
    },
    removeTrack: (id) => set((state) => {
      state.tracks = state.tracks.filter((t) => t.id !== id);
      state.clips = state.clips.filter((c) => c.trackId !== id);
    }),
    updateTrack: (id, updates) => set((state) => {
      const track = state.tracks.find((t) => t.id === id);
      if (track) Object.assign(track, updates);
    }),
    selectTrack: (id) => set((state) => { state.selectedTrackId = id; }),

    // Clip operations
    addClip: (clipData) => {
      const newClip: Clip = {
        ...clipData,
        id: generateId(),
        effects: [],
      };
      set((state) => {
        state.clips.push(newClip);
      });
      get().calculateDuration();
      return newClip;
    },
    removeClip: (id) => {
      set((state) => {
        state.clips = state.clips.filter((c) => c.id !== id);
        state.selectedClipIds = state.selectedClipIds.filter((cid) => cid !== id);
      });
      get().calculateDuration();
    },
    updateClip: (id, updates) => {
      set((state) => {
        const clip = state.clips.find((c) => c.id === id);
        if (clip) Object.assign(clip, updates);
      });
      get().calculateDuration();
    },
    moveClip: (id, trackId, startTime) => {
      set((state) => {
        const clip = state.clips.find((c) => c.id === id);
        if (clip) {
          clip.trackId = trackId;
          clip.startTime = Math.max(0, startTime);
        }
      });
      get().calculateDuration();
    },
    trimClipStart: (id, newStartTime) => set((state) => {
      const clip = state.clips.find((c) => c.id === id);
      if (clip) {
        const delta = newStartTime - clip.startTime;
        clip.startTime = newStartTime;
        clip.sourceStartOffset += delta;
        clip.duration -= delta;
      }
    }),
    trimClipEnd: (id, newDuration) => set((state) => {
      const clip = state.clips.find((c) => c.id === id);
      if (clip) {
        clip.duration = Math.max(0.1, newDuration);
        clip.sourceEndOffset = clip.sourceStartOffset + clip.duration;
      }
    }),
    selectClip: (id, addToSelection = false) => set((state) => {
      if (addToSelection) {
        if (!state.selectedClipIds.includes(id)) {
          state.selectedClipIds.push(id);
        }
      } else {
        state.selectedClipIds = [id];
      }
    }),
    deselectClip: (id) => set((state) => {
      state.selectedClipIds = state.selectedClipIds.filter((cid) => cid !== id);
    }),
    clearSelection: () => set((state) => { state.selectedClipIds = []; }),

    // Effect operations
    addEffect: (clipId, effect) => {
      const newEffect: Effect = { ...effect, id: generateId() };
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId);
        if (clip) clip.effects.push(newEffect);
      });
      return newEffect;
    },
    removeEffect: (clipId, effectId) => set((state) => {
      const clip = state.clips.find((c) => c.id === clipId);
      if (clip) {
        clip.effects = clip.effects.filter((e) => e.id !== effectId);
      }
    }),
    updateEffect: (clipId, effectId, updates) => set((state) => {
      const clip = state.clips.find((c) => c.id === clipId);
      if (clip) {
        const effect = clip.effects.find((e) => e.id === effectId);
        if (effect) Object.assign(effect, updates);
      }
    }),

    // Project operations
    setAspectRatio: (ratio) => set((state) => { state.project.aspectRatio = ratio; }),
    setProjectName: (name) => set((state) => {
      state.project.name = name;
      state.project.updatedAt = new Date();
    }),
    calculateDuration: () => set((state) => {
      const maxEndTime = state.clips.reduce((max, clip) => {
        const endTime = clip.startTime + clip.duration;
        return Math.max(max, endTime);
      }, 0);
      state.project.duration = maxEndTime;
    }),

    // Reset
    reset: () => set(initialState),
  }))
);

/** Selector hooks for performance */
export const usePlaybackState = () =>
  useTimelineStore((state) => ({
    isPlaying: state.isPlaying,
    currentTime: state.currentTime,
  }));

export const useTracks = () => useTimelineStore((state) => state.tracks);
export const useClips = () => useTimelineStore((state) => state.clips);
export const useSources = () => useTimelineStore((state) => state.sources);
export const useSelectedClipIds = () => useTimelineStore((state) => state.selectedClipIds);
export const useZoom = () => useTimelineStore((state) => state.zoom);
