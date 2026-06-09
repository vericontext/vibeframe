import { build } from "esbuild";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

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

console.log("Bundle complete: dist/index.js");
