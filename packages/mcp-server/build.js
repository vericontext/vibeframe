import { build } from "esbuild";
import { rmSync } from "node:fs";

// Clean dist
rmSync("dist", { recursive: true, force: true });

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/index.js",
  banner: {
    // createRequire shim: bundled CJS packages (e.g. commander) call require() at
    // module init; without this shim esbuild's __require throws
    // "Dynamic require of X is not supported" on ESM.
    js: [
      "#!/usr/bin/env node",
      "import { createRequire as __vfCreateRequire } from 'node:module';",
      "const require = __vfCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  // Externals are limited to:
  // 1. MCP SDK + zod — host communicates through these; must match host version
  // 2. Optional AI provider SDKs — declared as peerDependencies (user brings their own)
  // Everything else (chalk, ora, commander, yaml, dotenv, etc.) is bundled
  // to keep runtime deps minimal and avoid version-drift bugs like ERR_MODULE_NOT_FOUND
  external: [
    "@modelcontextprotocol/sdk",
    "@modelcontextprotocol/sdk/*",
    "zod",
    "@anthropic-ai/sdk",
    "@google/generative-ai",
    "openai",
    // KokoroProvider only fires its dynamic import when textToSpeech() is
    // called, which never happens through the MCP surface. Marking the heavy
    // native graph (~150 MB across onnxruntime-node + transformers.js) as
    // external keeps the bundle small and avoids esbuild's "no loader for
    // .node files" error on prebuilt binaries.
    "kokoro-js",
    "@huggingface/transformers",
    "onnxruntime-node",
    "onnxruntime-node/*",
    "sharp",
  ],
  sourcemap: false,
  minify: false,
  treeShaking: true,
});

console.log("Bundle complete: dist/index.js");
