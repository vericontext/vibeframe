import type { TimelineState } from "@vibeframe/core";
import { aspectToResolution } from "./hyperframes.js";
import {
  buildClipElements,
  buildClipRuntimeData,
  buildMediaDeclarations,
} from "./html-clips.js";
import { RUNTIME_SCRIPT } from "./html-runtime.js";

export function generateCompositionHtml(state: TimelineState): string {
  const { width, height } = aspectToResolution(state.project.aspectRatio);
  const clipMarkup = buildClipElements(state);
  const mediaDecls = buildMediaDeclarations(state);
  const clipData = buildClipRuntimeData(state);
  const duration = state.project.duration;
  const hasLottie = state.sources.some((s) => s.type === "lottie");

  const script = RUNTIME_SCRIPT
    .replace("/*CLIPS_JSON*/[]", JSON.stringify(clipData))
    .replace("/*DURATION*/0", String(duration))
    .replace("/*MEDIA_JSON*/[]", JSON.stringify(mediaDecls));

  const lottieRuntime = hasLottie
    ? `<script type="module">
  import { setWasmUrl } from "/vendor/dotlottie-wc/index.js";
  setWasmUrl("/vendor/dotlottie-player.wasm");
</script>
`
    : "";

  // The clips live inside a root `[data-composition-id]` carrying `data-duration`.
  // The producer's browser probe reads that attribute to learn the composition
  // length; without it the render aborts with "Composition has zero duration"
  // because this runtime drives seeks itself and registers no GSAP timeline.
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: #000; }
  #root { position: relative; width: ${width}px; height: ${height}px; }
  .clip { position: absolute; inset: 0; display: none; }
</style>
${lottieRuntime}</head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}">
  ${clipMarkup}
</div>
<script>
${script}
</script>
</body></html>`;
}
