/**
 * @module timeline/types
 * @description Core timeline data types for VibeFrame.
 *
 * Defines the fundamental structures that represent a video editing project:
 * media sources, clips, tracks, effects, keyframes, transitions, and the
 * complete timeline state. All time values use seconds (floats allowed).
 *
 * VibeFrame terminology mapping:
 * - Clip -> piece (segment of media on the timeline)
 * - Track -> layer (vertical stack for compositing)
 * - Timeline -> storyboard (the complete sequence)
 * - Keyframe -> point (a moment of parameter change)
 * - Transition -> transition (effect between clips)
 */

/** Unique identifier string (e.g., `"clip-1"`, `"track-2"`, `"source-3"`). */
export type Id = string;

/** Time value in seconds (floats allowed, e.g., `1.5` = 1500ms). */
export type TimeSeconds = number;

/** Supported media types for sources and tracks. */
export type MediaType = "video" | "audio" | "image";

/** Standard aspect ratios for different platforms (landscape, portrait, square, social). */
export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:5";

/**
 * An imported media source (video, audio, or image file).
 *
 * Sources are referenced by {@link Clip.sourceId} and stored in
 * {@link TimelineState.sources}. A single source can be used by multiple clips.
 */
export interface MediaSource {
  /** Unique identifier (format: `source-{id}`) */
  id: Id;
  /** Human-readable display name */
  name: string;
  /** Media type of this source */
  type: MediaType;
  /** File path or URL to the media */
  url: string;
  /** Total duration of the source media in seconds */
  duration: TimeSeconds;
  /** Width in pixels (video/image only) */
  width?: number;
  /** Height in pixels (video/image only) */
  height?: number;
  /** Thumbnail URL or data URI for preview */
  thumbnail?: string;
}

/**
 * A clip (piece) placed on the timeline, representing a segment of a media source.
 *
 * Each clip references a {@link MediaSource} via `sourceId` and belongs to a
 * {@link Track} via `trackId`. Source offsets define which portion of the
 * original media is used.
 */
export interface Clip {
  /** Unique identifier (format: `clip-{id}`) */
  id: Id;
  /** Reference to the source media */
  sourceId: Id;
  /** Track this clip belongs to */
  trackId: Id;
  /** Start time of clip in timeline */
  startTime: TimeSeconds;
  /** Duration of clip as shown in timeline */
  duration: TimeSeconds;
  /** Start offset within source media (for trimmed clips) */
  sourceStartOffset: TimeSeconds;
  /** End offset within source media */
  sourceEndOffset: TimeSeconds;
  /** Effects applied to this clip */
  effects: Effect[];
  /** Whether clip is selected */
  isSelected?: boolean;
  /** Whether clip is locked */
  isLocked?: boolean;
}

/**
 * A track (layer) in the timeline stack.
 *
 * Tracks are ordered vertically; clips on higher-order tracks composite
 * on top of lower-order tracks during export.
 */
export interface Track {
  /** Unique identifier (format: `track-{id}`) */
  id: Id;
  /** Human-readable track name (e.g., "Video 1", "Audio 1") */
  name: string;
  /** Media type this track holds */
  type: MediaType;
  /** Order in the track stack (lower = bottom) */
  order: number;
  /** Whether track is muted */
  isMuted: boolean;
  /** Whether track is locked */
  isLocked: boolean;
  /** Whether track is visible */
  isVisible: boolean;
}

/** Built-in effect types that can be applied to clips. Use `"custom"` for user-defined effects. */
export type EffectType =
  | "fadeIn"
  | "fadeOut"
  | "blur"
  | "brightness"
  | "contrast"
  | "saturation"
  | "speed"
  | "volume"
  | "custom";

/**
 * An effect applied to a {@link Clip}.
 *
 * Effects have a time range relative to the clip start, typed parameters,
 * and optional {@link Keyframe} animation.
 */
export interface Effect {
  /** Unique identifier (format: `effect-{id}`) */
  id: Id;
  /** The type of effect */
  type: EffectType;
  /** When effect starts (relative to clip start) */
  startTime: TimeSeconds;
  /** Effect duration */
  duration: TimeSeconds;
  /** Effect parameters */
  params: Record<string, number | string | boolean>;
  /** Keyframes for animated parameters */
  keyframes?: Keyframe[];
}

/**
 * A keyframe (point) defining parameter values at a specific time.
 *
 * The engine interpolates between keyframes using the specified {@link easing}
 * function to animate effect parameters over time.
 */
export interface Keyframe {
  /** Unique keyframe identifier */
  id: Id;
  /** Time relative to effect start */
  time: TimeSeconds;
  /** Parameter values at this keyframe */
  values: Record<string, number | string | boolean>;
  /** Easing function for interpolation */
  easing: "linear" | "easeIn" | "easeOut" | "easeInOut";
}

/**
 * A transition effect between two adjacent clips.
 *
 * Defines how one clip blends into the next over the specified duration.
 */
export interface Transition {
  /** Unique identifier */
  id: Id;
  /** Transition style */
  type: "cut" | "dissolve" | "fade" | "wipe" | "slide";
  /** Duration of the transition overlap in seconds */
  duration: TimeSeconds;
  /** Clip this transition leads from */
  fromClipId: Id;
  /** Clip this transition leads to */
  toClipId: Id;
}

/**
 * Metadata for a VibeFrame project (stored in `.vibe.json`).
 */
export interface ProjectMeta {
  /** Unique project identifier */
  id: Id;
  /** Project display name */
  name: string;
  /** Timestamp when the project was created */
  createdAt: Date;
  /** Timestamp of the last modification */
  updatedAt: Date;
  /** Output aspect ratio */
  aspectRatio: AspectRatio;
  /** Output frame rate (frames per second) */
  frameRate: number;
  /** Total project duration */
  duration: TimeSeconds;
}

/**
 * Complete timeline state managed by the Zustand + Immer store.
 *
 * This is the top-level data structure serialized to `.vibe.json` project files
 * and used as the single source of truth for all timeline operations.
 */
export interface TimelineState {
  /** Project metadata */
  project: ProjectMeta;
  /** All tracks in the timeline */
  tracks: Track[];
  /** All clips in the timeline */
  clips: Clip[];
  /** All media sources */
  sources: MediaSource[];
  /** All transitions */
  transitions: Transition[];
  /** Current playhead position */
  currentTime: TimeSeconds;
  /** Whether timeline is playing */
  isPlaying: boolean;
  /** Timeline zoom level (pixels per second) */
  zoom: number;
  /** Timeline scroll position */
  scrollX: number;
  /** Selected clip IDs */
  selectedClipIds: Id[];
  /** Selected track ID */
  selectedTrackId: Id | null;
}
