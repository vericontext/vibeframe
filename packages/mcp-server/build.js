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
    js: "#!/usr/bin/env node",
  },
  external: [
    "@modelcontextprotocol/sdk",
    "@modelcontextprotocol/sdk/*",
    "zod",
    "@anthropic-ai/sdk",
    "@google/generative-ai",
    "openai",
    "chalk",
    "ora",
    "commander",
    "music-metadata",
    "dotenv",
    "yaml",
  ],
  sourcemap: false,
  minify: false,
  treeShaking: true,
});

console.log("Bundle complete: dist/index.js");
