/**
 * Headless Project Engine for CLI operations
 * No React/Zustand dependency - pure TypeScript
 */

import type {
  TimelineState,
  ProjectMeta,
  Track,
  Clip,
  MediaSource,
  Effect,
  Transition,
  Id,
  TimeSeconds,
  AspectRatio,
  MediaType,
} from "@vibeframe/core/timeline";

/** Generate unique ID */
export const generateId = (): Id => {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
};

/** Project file format */
export interface ProjectFile {
  version: string;
  state: TimelineState;
}

/** Create default project state */
function createDefaultState(name: string = "Untitled Project"): TimelineState {
  return {
    project: {
      id: generateId(),
      name,
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
    zoom: 50,
    scrollX: 0,
    selectedClipIds: [],
    selectedTrackId: null,
  };
}

/**
 * Headless Project Engine
 * Manages timeline state without React/Zustand
 */
export class Project {
  private state: TimelineState;
  private filePath: string | null = null;

  constructor(name?: string) {
    this.state = createDefaultState(name);
  }

  /** Get current state (immutable copy) */
  getState(): TimelineState {
    return structuredClone(this.state);
  }

  /** Get project metadata */
  getMeta(): ProjectMeta {
    return { ...this.state.project };
  }

  /** Get file path */
  getFilePath(): string | null {
    return this.filePath;
  }

  // ============ Project Operations ============

  setName(name: string): void {
    this.state.project.name = name;
    this.state.project.updatedAt = new Date();
  }

  setAspectRatio(ratio: AspectRatio): void {
    this.state.project.aspectRatio = ratio;
    this.state.project.updatedAt = new Date();
  }

  setFrameRate(fps: number): void {
    this.state.project.frameRate = fps;
    this.state.project.updatedAt = new Date();
  }

  // ============ Media Source Operations ============

  addSource(source: Omit<MediaSource, "id">): MediaSource {
    const newSource: MediaSource = { ...source, id: generateId() };
    this.state.sources.push(newSource);
    return newSource;
  }

  removeSource(id: Id): boolean {
    const index = this.state.sources.findIndex((s) => s.id === id);
    if (index === -1) return false;

    this.state.sources.splice(index, 1);
    // Also remove clips using this source
    this.state.clips = this.state.clips.filter((c) => c.sourceId !== id);
    this.calculateDuration();
    return true;
  }

  getSource(id: Id): MediaSource | undefined {
    return this.state.sources.find((s) => s.id === id);
  }

  getSources(): MediaSource[] {
    return [...this.state.sources];
  }

  // ============ Track Operations ============

  addTrack(track: Omit<Track, "id">): Track {
    const newTrack: Track = { ...track, id: generateId() };
    this.state.tracks.push(newTrack);
    return newTrack;
  }

  removeTrack(id: Id): boolean {
    const index = this.state.tracks.findIndex((t) => t.id === id);
    if (index === -1) return false;

    this.state.tracks.splice(index, 1);
    // Also remove clips on this track
    this.state.clips = this.state.clips.filter((c) => c.trackId !== id);
    this.calculateDuration();
    return true;
  }

  updateTrack(id: Id, updates: Partial<Omit<Track, "id">>): boolean {
    const track = this.state.tracks.find((t) => t.id === id);
    if (!track) return false;
    Object.assign(track, updates);
    return true;
  }

  getTrack(id: Id): Track | undefined {
    return this.state.tracks.find((t) => t.id === id);
  }

  getTracks(): Track[] {
    return [...this.state.tracks];
  }

  getTracksByType(type: MediaType): Track[] {
    return this.state.tracks.filter((t) => t.type === type);
  }

  // ============ Clip Operations ============

  addClip(clip: Omit<Clip, "id" | "effects">): Clip {
    const newClip: Clip = {
      ...clip,
      id: generateId(),
      effects: [],
    };
    this.state.clips.push(newClip);
    this.calculateDuration();
    return newClip;
  }

  removeClip(id: Id): boolean {
    const index = this.state.clips.findIndex((c) => c.id === id);
    if (index === -1) return false;

    this.state.clips.splice(index, 1);
    this.state.selectedClipIds = this.state.selectedClipIds.filter((cid) => cid !== id);
    this.calculateDuration();
    return true;
  }

  updateClip(id: Id, updates: Partial<Omit<Clip, "id">>): boolean {
    const clip = this.state.clips.find((c) => c.id === id);
    if (!clip) return false;
    Object.assign(clip, updates);
    this.calculateDuration();
    return true;
  }

  moveClip(id: Id, trackId: Id, startTime: TimeSeconds): boolean {
    const clip = this.state.clips.find((c) => c.id === id);
    if (!clip) return false;

    clip.trackId = trackId;
    clip.startTime = Math.max(0, startTime);
    this.calculateDuration();
    return true;
  }

  trimClipStart(id: Id, newStartTime: TimeSeconds): boolean {
    const clip = this.state.clips.find((c) => c.id === id);
    if (!clip) return false;

    const delta = newStartTime - clip.startTime;
    clip.startTime = newStartTime;
    clip.sourceStartOffset += delta;
    clip.duration -= delta;
    this.calculateDuration();
    return true;
  }

  trimClipEnd(id: Id, newDuration: TimeSeconds): boolean {
    const clip = this.state.clips.find((c) => c.id === id);
    if (!clip) return false;

    clip.duration = Math.max(0.1, newDuration);
    clip.sourceEndOffset = clip.sourceStartOffset + clip.duration;
    this.calculateDuration();
    return true;
  }

  getClip(id: Id): Clip | undefined {
    return this.state.clips.find((c) => c.id === id);
  }

  getClips(): Clip[] {
    return [...this.state.clips];
  }

  getClipsByTrack(trackId: Id): Clip[] {
    return this.state.clips.filter((c) => c.trackId === trackId);
  }

  /**
   * Split a clip at a specific time, creating two clips
   * @param id Clip ID to split
   * @param splitTime Time relative to clip start (not timeline time)
   * @returns [firstClip, secondClip] or null if failed
   */
  splitClip(id: Id, splitTime: TimeSeconds): [Clip, Clip] | null {
    const clip = this.state.clips.find((c) => c.id === id);
    if (!clip) return null;

    // Validate split time
    if (splitTime <= 0 || splitTime >= clip.duration) {
      return null;
    }

    // Create the second clip (after split point)
    const secondClip: Clip = {
      id: generateId(),
      sourceId: clip.sourceId,
      trackId: clip.trackId,
      startTime: clip.startTime + splitTime,
      duration: clip.duration - splitTime,
      sourceStartOffset: clip.sourceStartOffset + splitTime,
      sourceEndOffset: clip.sourceEndOffset,
      effects: [], // Effects don't transfer to split clips
    };

    // Modify the first clip (before split point)
    clip.duration = splitTime;
    clip.sourceEndOffset = clip.sourceStartOffset + splitTime;

    // Add the second clip
    this.state.clips.push(secondClip);
    this.calculateDuration();

    return [clip, secondClip];
  }

  /**
   * Duplicate a clip
   * @param id Clip ID to duplicate
   * @param offsetTime Optional time offset for the duplicate (default: place after original)
   * @returns The duplicated clip or null if failed
   */
  duplicateClip(id: Id, offsetTime?: TimeSeconds): Clip | null {
    const clip = this.state.clips.find((c) => c.id === id);
    if (!clip) return null;

    const newStartTime = offsetTime ?? clip.startTime + clip.duration;

    const duplicatedClip: Clip = {
      id: generateId(),
      sourceId: clip.sourceId,
      trackId: clip.trackId,
      startTime: newStartTime,
      duration: clip.duration,
      sourceStartOffset: clip.sourceStartOffset,
      sourceEndOffset: clip.sourceEndOffset,
      effects: clip.effects.map((e) => ({
        ...e,
        id: generateId(),
      })),
    };

    this.state.clips.push(duplicatedClip);
    this.calculateDuration();

    return duplicatedClip;
  }

  // ============ Effect Operations ============

  addEffect(clipId: Id, effect: Omit<Effect, "id">): Effect | null {
    const clip = this.state.clips.find((c) => c.id === clipId);
    if (!clip) return null;

    const newEffect: Effect = { ...effect, id: generateId() };
    clip.effects.push(newEffect);
    return newEffect;
  }

  removeEffect(clipId: Id, effectId: Id): boolean {
    const clip = this.state.clips.find((c) => c.id === clipId);
    if (!clip) return false;

    const index = clip.effects.findIndex((e) => e.id === effectId);
    if (index === -1) return false;

    clip.effects.splice(index, 1);
    return true;
  }

  updateEffect(clipId: Id, effectId: Id, updates: Partial<Omit<Effect, "id">>): boolean {
    const clip = this.state.clips.find((c) => c.id === clipId);
    if (!clip) return false;

    const effect = clip.effects.find((e) => e.id === effectId);
    if (!effect) return false;

    Object.assign(effect, updates);
    return true;
  }

  // ============ Transition Operations ============

  addTransition(transition: Omit<Transition, "id">): Transition {
    const newTransition: Transition = { ...transition, id: generateId() };
    this.state.transitions.push(newTransition);
    return newTransition;
  }

  removeTransition(id: Id): boolean {
    const index = this.state.transitions.findIndex((t) => t.id === id);
    if (index === -1) return false;

    this.state.transitions.splice(index, 1);
    return true;
  }

  getTransitions(): Transition[] {
    return [...this.state.transitions];
  }

  // ============ Duration Calculation ============

  private calculateDuration(): void {
    const maxEndTime = this.state.clips.reduce((max, clip) => {
      const endTime = clip.startTime + clip.duration;
      return Math.max(max, endTime);
    }, 0);
    this.state.project.duration = maxEndTime;
  }

  getDuration(): TimeSeconds {
    return this.state.project.duration;
  }

  // ============ Serialization ============

  toJSON(): ProjectFile {
    return {
      version: "1.0.0",
      state: this.getState(),
    };
  }

  static fromJSON(data: ProjectFile): Project {
    const project = new Project();
    // Convert date strings back to Date objects
    data.state.project.createdAt = new Date(data.state.project.createdAt);
    data.state.project.updatedAt = new Date(data.state.project.updatedAt);
    project.state = data.state;
    return project;
  }

  setFilePath(path: string): void {
    this.filePath = path;
  }

  // ============ Summary ============

  getSummary(): {
    name: string;
    duration: TimeSeconds;
    aspectRatio: AspectRatio;
    frameRate: number;
    trackCount: number;
    clipCount: number;
    sourceCount: number;
  } {
    return {
      name: this.state.project.name,
      duration: this.state.project.duration,
      aspectRatio: this.state.project.aspectRatio,
      frameRate: this.state.project.frameRate,
      trackCount: this.state.tracks.length,
      clipCount: this.state.clips.length,
      sourceCount: this.state.sources.length,
    };
  }
}
