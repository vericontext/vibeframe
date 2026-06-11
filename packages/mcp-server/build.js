import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

/**
 * Bundle the MCP server into `${outDir}/index.js` plus its Hyperframe
 * runtime siblings.
 *
 * `bundleHostDeps` controls whether the MCP SDK + zod are bundled too:
 * - false (npm package): they stay external and resolve from node_modules,
 *   installed by npm alongside the published bundle.
 * - true (MCPB Desktop Extension): the bundle is the whole install — there
 *   is no node_modules next to it, so everything resolvable must be inside.
 */
export async function buildServerBundle({ outDir = "dist", bundleHostDeps = false } = {}) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const pkg = JSON.parse(readFileSync("package.json", "utf8"));

  await build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    outfile: join(outDir, "index.js"),
    define: {
      // serverInfo.version — keeps the MCP handshake in sync with the package.
      "process.env.VIBE_MCP_SERVER_VERSION": JSON.stringify(pkg.version),
    },
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
    //    (npm builds only; MCPB builds carry them inside the bundle).
    // 2. Native/heavy optional graphs that are only loaded dynamically.
    // Provider SDKs are bundled so `npx -y @vibeframe/mcp-server` works in a
    // clean MCP host without requiring users to install peer dependencies.
    external: [
      ...(bundleHostDeps ? [] : ["@modelcontextprotocol/sdk", "@modelcontextprotocol/sdk/*", "zod"]),
      // KokoroProvider loads kokoro-js via dynamic import only when local TTS
      // actually runs. The heavy native graph (~150 MB across onnxruntime-node
      // + transformers.js) stays external — bundling it would hit esbuild's
      // "no loader for .node files" on prebuilt binaries. kokoro-js is
      // declared in optionalDependencies so npm installs resolve the whole
      // transitive graph (transformers → onnxruntime-node + sharp) next to
      // the bundle; without that, `npx @vibeframe/mcp-server` kokoro TTS
      // fails with ERR_MODULE_NOT_FOUND.
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
  // own module file. After bundling, import.meta.url points at <outDir>/index.js,
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
  copyFileSync(manifestSrc, join(outDir, "hyperframe.manifest.json"));
  copyFileSync(join(producerDist, iifeName), join(outDir, iifeName));

  console.log(`Bundle complete: ${outDir}/index.js (+ hyperframe runtime siblings)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildServerBundle();
}
