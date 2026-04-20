import type { TimelineState } from "@vibeframe/core";

export function relAsset(url: string): string {
  const basename = url.split("/").pop() ?? url;
  return `assets/${basename}`;
}

export function buildClipElements(state: TimelineState): string {
  return state.clips
    .map((clip) => {
      const source = state.sources.find((s) => s.id === clip.sourceId);
      const track = state.tracks.find((t) => t.id === clip.trackId);
      if (!source || !track) return `<!-- missing source/track for clip ${clip.id} -->`;
      const zIndex = track.order;

      switch (source.type) {
        case "image":
          return `<div id="${clip.id}" class="clip" style="z-index:${zIndex};"><img src="${relAsset(source.url)}" style="width:100%;height:100%;object-fit:cover;"></div>`;
        case "video":
          return `<div id="${clip.id}" class="clip" style="z-index:${zIndex};"><video id="${clip.id}-media" src="${relAsset(source.url)}" style="width:100%;height:100%;object-fit:cover;" muted playsinline></video></div>`;
        case "audio":
          return `<audio id="${clip.id}-media" src="${relAsset(source.url)}"></audio><div id="${clip.id}" class="clip" style="z-index:${zIndex};background:#111;"></div>`;
        case "lottie":
          return `<div id="${clip.id}" class="clip" style="z-index:${zIndex};"><dotlottie-wc src="${relAsset(source.url)}" autoplay loop style="width:100%;height:100%;"></dotlottie-wc></div>`;
        default:
          return `<!-- unsupported source type: ${(source as { type: string }).type} for clip ${clip.id} -->`;
      }
    })
    .join("\n  ");
}

export interface HfMediaElement {
  elementId: string;
  src: string;
  startTime: number;
  endTime: number;
  mediaOffset: number;
  volume: number;
  hasAudio: boolean;
}

export function buildMediaDeclarations(state: TimelineState): HfMediaElement[] {
  return state.clips
    .map((clip) => ({ clip, source: state.sources.find((s) => s.id === clip.sourceId) }))
    .filter((x): x is { clip: typeof x.clip; source: NonNullable<typeof x.source> } =>
      x.source !== undefined && (x.source.type === "video" || x.source.type === "audio")
    )
    .map(({ clip, source }) => ({
      elementId: `${clip.id}-media`,
      src: relAsset(source.url),
      startTime: clip.startTime,
      endTime: clip.startTime + clip.duration,
      mediaOffset: clip.sourceStartOffset ?? 0,
      volume: 1,
      hasAudio: true,
    }));
}

export function buildClipRuntimeData(state: TimelineState) {
  return state.clips.map((clip) => ({
    id: clip.id,
    startTime: clip.startTime,
    duration: clip.duration,
    effects: clip.effects,
  }));
}
