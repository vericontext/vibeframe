/**
 * Core Timeline Types for VibeEdit
 *
 * Using "Vibe" terminology:
 * - Clip -> 조각 (piece)
 * - Track -> 겹침 (layer)
 * - Timeline -> 스토리보드 (storyboard)
 * - Keyframe -> 포인트 (point)
 * - Transition -> 전환 (transition)
 */

/** Unique identifier type */
export type Id = string;

/** Time in seconds */
export type TimeSeconds = number;

/** Media types supported */
export type MediaType = "video" | "audio" | "image";

/** Aspect ratios for different platforms */
export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:5";

/** Media source information */
export interface MediaSource {
  id: Id;
  name: string;
  type: MediaType;
  url: string;
  duration: TimeSeconds;
  width?: number;
  height?: number;
  thumbnail?: string;
}

/** A clip (조각) - a piece of media on the timeline */
export interface Clip {
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

/** A track (겹침) - a layer containing clips */
export interface Track {
  id: Id;
  name: string;
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

/** Effect types available */
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

/** An effect applied to a clip */
export interface Effect {
  id: Id;
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

/** A keyframe (포인트) - a point of change */
export interface Keyframe {
  id: Id;
  /** Time relative to effect start */
  time: TimeSeconds;
  /** Parameter values at this keyframe */
  values: Record<string, number | string | boolean>;
  /** Easing function for interpolation */
  easing: "linear" | "easeIn" | "easeOut" | "easeInOut";
}

/** Transition between clips */
export interface Transition {
  id: Id;
  type: "cut" | "dissolve" | "fade" | "wipe" | "slide";
  duration: TimeSeconds;
  /** Clip this transition leads from */
  fromClipId: Id;
  /** Clip this transition leads to */
  toClipId: Id;
}

/** Project metadata */
export interface ProjectMeta {
  id: Id;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  aspectRatio: AspectRatio;
  frameRate: number;
  /** Total project duration */
  duration: TimeSeconds;
}

/** Complete timeline state */
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
