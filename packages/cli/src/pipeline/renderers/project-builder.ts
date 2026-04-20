import { mkdtemp, mkdir, copyFile, writeFile, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import * as path from "node:path";
import type { TimelineState } from "@vibeframe/core";
import { generateCompositionHtml } from "./html-template.js";

export interface TempProject {
  dir: string;
  cleanup: () => Promise<void>;
}

export async function buildTempProject(
  state: TimelineState,
  projectFileDir?: string
): Promise<TempProject> {
  const dir = await mkdtemp(path.join(tmpdir(), "vibeframe-hf-"));
  const assetsDir = path.join(dir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const copied = new Map<string, string>();
  for (const source of state.sources) {
    if (copied.has(source.id)) continue;
    const resolved = resolveSourceUrl(source.url, projectFileDir);
    if (!existsSync(resolved)) {
      throw new Error(`Source file not found: ${resolved} (from source id=${source.id})`);
    }
    const dest = path.join(assetsDir, path.basename(resolved));
    await copyFile(resolved, dest);
    copied.set(source.id, dest);
  }

  if (state.sources.some((s) => s.type === "lottie")) {
    await copyLottieRuntime(dir);
  }

  const html = generateCompositionHtml(state);
  await writeFile(path.join(dir, "index.html"), html, "utf-8");

  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/**
 * Vendor the `@lottiefiles/dotlottie-wc` runtime into `<tempDir>/vendor/` so
 * the composition HTML can load it via `<script type="module">` over the
 * hyperframes local HTTP server without reaching the public CDN.
 */
async function copyLottieRuntime(tempDir: string): Promise<void> {
  const require = createRequire(import.meta.url);
  // dotlottie-wc has no `exports` restriction on package.json
  const wcPkgPath = require.resolve("@lottiefiles/dotlottie-wc/package.json");
  const wcDistDir = path.join(path.dirname(wcPkgPath), "dist");
  // dotlottie-web restricts via `exports`; resolve the main entry and walk up to dist/
  const webEntry = require.resolve("@lottiefiles/dotlottie-web");
  const wasmSrc = path.join(path.dirname(webEntry), "dotlottie-player.wasm");

  const vendorDir = path.join(tempDir, "vendor");
  const wcDest = path.join(vendorDir, "dotlottie-wc");
  await mkdir(wcDest, { recursive: true });

  for (const file of await readdir(wcDistDir)) {
    if (file.endsWith(".map") || file.endsWith(".d.ts")) continue;
    await copyFile(path.join(wcDistDir, file), path.join(wcDest, file));
  }
  await copyFile(wasmSrc, path.join(vendorDir, "dotlottie-player.wasm"));
}

export function resolveSourceUrl(url: string, baseDir?: string): string {
  if (url.startsWith("file://")) return url.slice(7);
  if (path.isAbsolute(url)) return url;
  if (baseDir) return path.resolve(baseDir, url);
  return path.resolve(process.cwd(), url);
}
