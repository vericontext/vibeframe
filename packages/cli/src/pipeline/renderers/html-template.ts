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

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: #000; }
  .clip { position: absolute; inset: 0; display: none; }
</style>
${lottieRuntime}</head><body>
  ${clipMarkup}
<script>
${script}
</script>
</body></html>`;
}
