import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.NODE_ENV = "development";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appRoot, "../..");
const assetsRoot = resolve(repoRoot, "assets/demos");

const showcase = (await import("../components/demo-showcase.tsx")) as {
  PROCESS_HIGHLIGHT_VIDEO: string;
  RESULT_VIDEO: string;
};

const expected = [showcase.PROCESS_HIGHLIGHT_VIDEO, showcase.RESULT_VIDEO];

for (const src of expected) {
  if (!src.startsWith("/demo-media/")) {
    throw new Error(`Expected development demo video to use /demo-media route, got: ${src}`);
  }

  const assetPath = resolve(assetsRoot, src.replace(/^\/demo-media\//, ""));
  if (!assetPath.startsWith(`${assetsRoot}/`)) {
    throw new Error(`Resolved demo asset escaped assets root: ${src}`);
  }
  if (!existsSync(assetPath)) {
    throw new Error(`Demo video asset does not exist: ${assetPath}`);
  }
  if (!statSync(assetPath).isFile()) {
    throw new Error(`Demo video asset is not a file: ${assetPath}`);
  }
}

console.log("Demo media smoke checks passed.");
