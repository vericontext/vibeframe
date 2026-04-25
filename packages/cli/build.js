/**
 * @vibeframe/cli bundle script.
 *
 * The CLI used to ship as a `tsc` directory build that imported its
 * workspace siblings (`@vibeframe/ai-providers`, `@vibeframe/core`) at
 * runtime. Those workspace packages are private (we never publish them to
 * npm), which made `npm i -g @vibeframe/cli` fail with a 404 on the
 * `@vibeframe/ai-providers@x.y.z` resolution. Caught during the v0.55
 * pre-HN fresh-machine smoke.
 *
 * Switching to a single esbuild bundle inlines every workspace dep into
 * `dist/index.js` so the published package is self-contained. Native deps
 * (kokoro-js + transformers.js + onnxruntime-node + sharp) and the heavy
 * Hyperframes producer are externals: their `.node` prebuilts can't be
 * bundled, and they pull their own peer / npm tree on install.
 */

import { build } from "esbuild";
import { rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/index.js",
  banner: {
    // createRequire shim — bundled CJS dependencies (commander, music-metadata,
    // image-size, etc.) call `require()` at module init, which esbuild's ESM
    // output rewrites to `__require`. Without the shim those calls throw
    // "Dynamic require of X is not supported" on first run.
    //
    // src/index.ts already starts with `#!/usr/bin/env node`, so we don't
    // re-emit the shebang in the banner — duplicated shebangs are a syntax
    // error in ESM mode under Node 24+.
    js: [
      "import { createRequire as __vfCreateRequire } from 'node:module';",
      "const require = __vfCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  external: [
    // Native bindings — `.node` prebuilts can't be bundled by esbuild.
    "kokoro-js",
    "@huggingface/transformers",
    "onnxruntime-node",
    "onnxruntime-node/*",
    "sharp",
    // Hyperframes producer pulls Chrome via Puppeteer + native FFmpeg — too
    // big and platform-specific to bundle. Stays a runtime dep.
    "@hyperframes/producer",
    // Optional AI SDKs — declared as peerDependencies so users can pin
    // versions or omit providers they don't use. Same pattern as mcp-server.
    "@anthropic-ai/sdk",
    "@google/generative-ai",
    "openai",
    // Lottie web component — has its own loader pipeline and isn't needed
    // for the CLI bin entry path; leaving external avoids bundle bloat for
    // a feature most CLI users don't trigger.
    "@lottiefiles/dotlottie-wc",
  ],
  sourcemap: false,
  minify: false,
  treeShaking: true,
  // The CLI imports many subpaths through its own `exports` field. Tell
  // esbuild to follow them via the package.json conditions exposed there.
  conditions: ["import"],
});

console.log("Bundle complete: dist/index.js");
