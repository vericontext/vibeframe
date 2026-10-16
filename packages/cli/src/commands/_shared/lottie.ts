/**
 * @module _shared/lottie
 *
 * Pieces shared by the two places VibeFrame draws a Lottie animation in a
 * Hyperframes page: `vibe edit motion-overlay --asset` (a standalone layer
 * page) and `vibe scene add --lottie` (a canvas inside a scene).
 *
 * Both drive a dotLottie player frame by frame from the render's seek
 * instead of letting it autoplay, so every captured frame is the frame for
 * that time. Both load the runtime from files copied next to the page, not
 * from a CDN, so a render works offline and never depends on the network.
 */

import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

export type LottiePosition = "full" | "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

export const LOTTIE_POSITIONS: readonly LottiePosition[] = [
  "full",
  "center",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

/** Reject files dotLottie cannot open before spending a browser render on them. */
export async function checkLottieAsset(path: string): Promise<string | undefined> {
  const bytes = await readFile(path);
  const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip) return undefined;
  try {
    const json = JSON.parse(bytes.toString("utf-8")) as { layers?: unknown };
    if (Array.isArray(json.layers)) return undefined;
  } catch {
    // fall through
  }
  return `${basename(path)} is not a Lottie animation (expected Lottie JSON or a .lottie archive).`;
}

/** CSS box for the overlay canvas, in pixels of the layer. */
export function overlayBox(
  layer: { width: number; height: number },
  position: LottiePosition,
  scale: number,
): { left: number; top: number; width: number; height: number } {
  if (position === "full") return { left: 0, top: 0, width: layer.width, height: layer.height };
  const width = Math.max(1, Math.round(layer.width * scale));
  const height = Math.max(1, Math.round(layer.height * scale));
  const marginX = Math.round(layer.width * 0.04);
  const marginY = Math.round(layer.height * 0.04);
  const left = position === "center"
    ? Math.round((layer.width - width) / 2)
    : position.endsWith("left") ? marginX : layer.width - marginX - width;
  const top = position === "center"
    ? Math.round((layer.height - height) / 2)
    : position.startsWith("top") ? marginY : layer.height - marginY - height;
  return { left, top, width, height };
}

/** File names of the dotLottie runtime inside the vendor directory. */
export const DOTLOTTIE_SCRIPT = "dotlottie-web.js";
export const DOTLOTTIE_WASM = "dotlottie-player.wasm";

/**
 * Directory the MCP server bundle ships the runtime in, next to its
 * `index.js` (see packages/mcp-server/build.js). The bundle has no
 * `@lottiefiles/dotlottie-web` in node_modules to resolve.
 */
const BUNDLED_DOTLOTTIE_DIR = "dotlottie";

/** The directory holding the runtime's ESM build (`index.js`) and its WASM. */
function dotLottieDist(): string {
  try {
    // The CJS entry sits next to the ESM build and the WASM in dist/.
    return join(createRequire(import.meta.url).resolve("@lottiefiles/dotlottie-web"), "..");
  } catch {
    const bundled = fileURLToPath(new URL(`./${BUNDLED_DOTLOTTIE_DIR}/`, import.meta.url));
    if (existsSync(join(bundled, DOTLOTTIE_WASM))) return bundled;
    throw new Error("The dotLottie runtime (@lottiefiles/dotlottie-web) is not installed. Reinstall VibeFrame.");
  }
}

/** Copy the dotLottie runtime (ESM build plus its WASM) into `dir`. */
export async function copyDotLottieRuntime(dir: string): Promise<void> {
  const dist = dotLottieDist();
  await mkdir(dir, { recursive: true });
  await copyFile(join(dist, "index.js"), join(dir, DOTLOTTIE_SCRIPT));
  await copyFile(join(dist, DOTLOTTIE_WASM), join(dir, DOTLOTTIE_WASM));
}

/**
 * Browser-side JavaScript: `loadDotLottie(vendorDir)` imports the runtime
 * from a directory relative to the page and points it at the WASM, and
 * `setLottieTime(player, t, loop)` shows the frame for `t` seconds.
 * The render server sends .wasm without application/wasm, which makes
 * WebAssembly.instantiateStreaming reject it, so the WASM goes through a
 * typed Blob URL.
 */
export const DOTLOTTIE_BROWSER_HELPERS = `async function loadDotLottie(vendorDir) {
    const url = (file) => new URL(vendorDir + "/" + file, document.baseURI).href;
    const { DotLottie } = await import(url("${DOTLOTTIE_SCRIPT}"));
    const wasm = await (await fetch(url("${DOTLOTTIE_WASM}"))).arrayBuffer();
    DotLottie.setWasmUrl(URL.createObjectURL(new Blob([wasm], { type: "application/wasm" })));
    return DotLottie;
  }
  function setLottieTime(player, t, loop) {
    const length = player.duration;
    const frames = player.totalFrames;
    if (!(length > 0) || !(frames > 0)) return;
    const local = Math.max(0, Number(t) || 0);
    const at = loop ? local % length : Math.min(local, length);
    player.setFrame(Math.min(frames - 1, (at / length) * frames));
  }`;
