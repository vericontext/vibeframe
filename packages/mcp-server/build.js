import { build } from "esbuild";
import { copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

// Clean dist
rmSync("dist", { recursive: true, force: true });

const root = resolve("../..");
const cliSrc = resolve(root, "packages/cli/src");

const cliSourceAliases = new Map([
  ["@vibeframe/cli/engine", resolve(cliSrc, "engine/index.ts")],
  ["@vibeframe/cli/tools/manifest", resolve(cliSrc, "tools/manifest/index.ts")],
  ["@vibeframe/cli/tools/adapters/mcp", resolve(cliSrc, "tools/adapters/mcp.ts")],
]);

const cliSourceAliasPlugin = {
  name: "cli-source-alias",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^@vibeframe\/cli\/(engine|tools\/manifest|tools\/adapters\/mcp)$/ }, (args) => {
      const path = cliSourceAliases.get(args.path);
      if (!path) return undefined;
      return { path };
    });
  },
};

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
  // 2. Native/heavy optional graphs that are only loaded dynamically.
  // Provider SDKs are bundled so `npx -y @vibeframe/mcp-server` works in a
  // clean MCP host without requiring users to install peer dependencies.
  external: [
    "@modelcontextprotocol/sdk",
    "@modelcontextprotocol/sdk/*",
    "zod",
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
  plugins: [cliSourceAliasPlugin],
});

// The bundled @hyperframes/producer resolves its verified Hyperframe runtime
// (hyperframe.manifest.json + the iife artifact it names) as SIBLINGS of its
// own module file. After bundling, import.meta.url points at dist/index.js,
// so those siblings must be copied next to the bundle or every render fails
// with "[HyperframeRuntimeLoader] Missing manifest at <root>/core/dist/...".
// Producer is ESM-only (no "require" export condition) and a dependency of
// the CLI package, so resolve its dist dir through the CLI's node_modules.
const producerDist = resolve(root, "packages/cli/node_modules/@hyperframes/producer/dist");
const manifestSrc = join(producerDist, "hyperframe.manifest.json");
if (!existsSync(manifestSrc)) {
  throw new Error(
    `Missing ${manifestSrc} — run pnpm install (the @hyperframes/producer runtime ships it).`
  );
}
const manifest = JSON.parse(readFileSync(manifestSrc, "utf8"));
const iifeName = manifest.artifacts?.iife;
if (!iifeName || !existsSync(join(producerDist, iifeName))) {
  throw new Error(`Producer manifest at ${manifestSrc} names a missing iife artifact: ${iifeName}`);
}
copyFileSync(manifestSrc, join("dist", "hyperframe.manifest.json"));
copyFileSync(join(producerDist, iifeName), join("dist", iifeName));

console.log("Bundle complete: dist/index.js (+ hyperframe runtime siblings)");
