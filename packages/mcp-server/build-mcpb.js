import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import { buildServerBundle } from "./build.js";

/**
 * Package the MCP server as an MCPB Desktop Extension (.mcpb).
 *
 * An .mcpb is a zip with manifest.json at the archive root; Claude Desktop
 * installs it via Settings → Extensions (drag & drop) and manages the server
 * lifecycle itself — no claude_desktop_config.json entry, no node/npx on the
 * user's machine (Desktop ships its own Node runtime for type "node").
 *
 * The extension runs from Desktop's install directory, so the bundle must be
 * self-contained (bundleHostDeps) and the user's workspace folder reaches the
 * server via the VIBE_MCP_WORKSPACE env mapping below. Local kokoro TTS ships
 * as a pruned WASM-only runtime under server/kokoro-runtime (see
 * stageKokoroRuntime) so free narration works with zero npm steps.
 */

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

const stageRoot = resolve("dist-mcpb");
const stage = join(stageRoot, "stage");
rmSync(stageRoot, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

await buildServerBundle({ outDir: join(stage, "server"), bundleHostDeps: true });

stageKokoroRuntime(join(stage, "server", "kokoro-runtime"));

/**
 * Stage a self-contained, WASM-only kokoro-js runtime the extension can load
 * with no npm install on the user's machine (`KokoroProvider.
 * loadBundledKokoroRuntime` reads it via the VIBE_KOKORO_RUNTIME env below).
 *
 * kokoro-js's normal dependency graph needs onnxruntime-node and sharp —
 * platform-native binaries that cannot ship in a portable zip. The pruned
 * tree avoids both:
 *
 *   - @huggingface/transformers is pinned to its WEB build (no native
 *     imports). Its package.json is rewritten so Node resolution lands on
 *     dist/transformers.web.js, and the one line that picks the webpack-
 *     stubbed onnxruntime-node namespace is patched to use onnxruntime-web
 *     instead (the stub is an empty module; under Node the web build's
 *     "cpu" device then executes on onnxruntime-web's WASM engine).
 *   - onnxruntime-web ships only its Node entry + the single WASM artifact
 *     that entry loads.
 *
 * Verified end-to-end before this was wired up: model loads in ~10s on
 * first use (88MB download, cached per-user by KokoroProvider), ~0.5s after,
 * ~5s synthesis for a 14s line.
 */
function stageKokoroRuntime(runtimeRoot) {
  // Resolve a dependency's package ROOT. `resolve("<pkg>/package.json")`
  // throws for these packages (their exports maps don't expose it), so
  // resolve the entry file and climb until the package.json whose `name`
  // matches — plain findUp stops early on stubs like
  // onnxruntime-common/dist/esm/package.json.
  const pkgDir = (specifier, from) => {
    const r = createRequire(join(from ?? resolve("."), "package.json"));
    let dir = dirname(r.resolve(specifier));
    for (;;) {
      const pj = join(dir, "package.json");
      if (existsSync(pj) && JSON.parse(readFileSync(pj, "utf8")).name === specifier) {
        return dir;
      }
      const parent = dirname(dir);
      if (parent === dir) throw new Error(`package root not found for ${specifier}`);
      dir = parent;
    }
  };

  const kokoroDir = pkgDir("kokoro-js");
  const transformersDir = pkgDir("@huggingface/transformers", kokoroDir);
  const phonemizerDir = pkgDir("phonemizer", kokoroDir);
  const jinjaDir = pkgDir("@huggingface/jinja", transformersDir);
  const ortWebDir = pkgDir("onnxruntime-web", transformersDir);
  const ortCommonDir = pkgDir("onnxruntime-common", ortWebDir);

  const mods = join(runtimeRoot, "node_modules");

  // kokoro-js: entry + bundled voice embeddings (read from <pkg>/voices via fs).
  for (const piece of ["package.json", "LICENSE", "dist", "voices"]) {
    cpSync(join(kokoroDir, piece), join(mods, "kokoro-js", piece), { recursive: true });
  }

  // Small pure-JS deps ship whole.
  cpSync(phonemizerDir, join(mods, "phonemizer"), { recursive: true });
  cpSync(jinjaDir, join(mods, "@huggingface", "jinja"), { recursive: true });
  cpSync(ortCommonDir, join(mods, "onnxruntime-common"), { recursive: true });

  // onnxruntime-web: Node entry + the WASM engine it loads (wasmPaths points
  // here at runtime). Everything else in its 86MB dist is browser-only.
  const ortStage = join(mods, "onnxruntime-web");
  mkdirSync(join(ortStage, "dist"), { recursive: true });
  copyFileSync(join(ortWebDir, "package.json"), join(ortStage, "package.json"));
  if (existsSync(join(ortWebDir, "LICENSE")))
    copyFileSync(join(ortWebDir, "LICENSE"), join(ortStage, "LICENSE"));
  for (const file of [
    "ort.node.min.mjs",
    "ort-wasm-simd-threaded.mjs",
    "ort-wasm-simd-threaded.wasm",
  ]) {
    copyFileSync(join(ortWebDir, "dist", file), join(ortStage, "dist", file));
  }

  // transformers: web build only, with two bundle-time modifications.
  const tfStage = join(mods, "@huggingface", "transformers");
  mkdirSync(join(tfStage, "dist"), { recursive: true });
  if (existsSync(join(transformersDir, "LICENSE")))
    copyFileSync(join(transformersDir, "LICENSE"), join(tfStage, "LICENSE"));

  // (1) Rewrite exports so Node resolution (kokoro-js's bare import) lands on
  // the web build, and drop the native deps from the manifest.
  const tfPkg = JSON.parse(readFileSync(join(transformersDir, "package.json"), "utf8"));
  const webEntry = "./dist/transformers.web.js";
  tfPkg.main = webEntry;
  tfPkg.exports = {
    node: { import: { default: webEntry }, require: { default: webEntry } },
    default: { default: webEntry },
  };
  tfPkg.dependencies = {
    "@huggingface/jinja": tfPkg.dependencies["@huggingface/jinja"],
    "onnxruntime-web": tfPkg.dependencies["onnxruntime-web"],
  };
  writeFileSync(join(tfStage, "package.json"), JSON.stringify(tfPkg, null, 2) + "\n");

  // (2) Patch the ONNX namespace pick: under Node the web build grabs the
  // webpack-stubbed onnxruntime-node module (an empty object — no
  // InferenceSession). Point it at the real onnxruntime-web import instead.
  const tfBundle = readFileSync(join(transformersDir, "dist", "transformers.web.js"), "utf8");
  const needle = "ONNX = onnxruntime_node__WEBPACK_IMPORTED_MODULE_1__ ??";
  const count = tfBundle.split(needle).length - 1;
  if (count !== 1) {
    throw new Error(
      `kokoro-runtime patch needle matched ${count} times (expected 1) — ` +
        "@huggingface/transformers web build changed; re-verify the WASM runtime."
    );
  }
  writeFileSync(
    join(tfStage, "dist", "transformers.web.js"),
    tfBundle.replace(needle, "ONNX = onnxruntime_web__WEBPACK_IMPORTED_MODULE_2__ ??")
  );

  console.log(`Staged WASM kokoro runtime at ${runtimeRoot}`);
}

// Extension icon — the square web logo (512x512 PNG, Desktop-recommended size).
copyFileSync(resolve("../../apps/web/public/logo-512.png"), join(stage, "icon.png"));

const manifest = {
  manifest_version: "0.3",
  name: "vibeframe",
  display_name: "VibeFrame",
  version: pkg.version,
  description: pkg.description,
  long_description:
    "AI-native video editing for Claude Desktop. Draft a storyboard, generate narration and backdrops, " +
    "author HTML/GSAP scenes (scene_submit lets Claude write them in-chat), and render the result to MP4 — " +
    "all inside the workspace folder you pick below. Free local narration (Kokoro) is bundled and needs no " +
    "install; rendering requires Google Chrome and ffmpeg on this machine.",
  author: {
    name: "VibeFrame Contributors",
    url: "https://github.com/vericontext/vibeframe",
  },
  repository: {
    type: "git",
    url: "https://github.com/vericontext/vibeframe",
  },
  homepage: "https://github.com/vericontext/vibeframe#mcp-integration",
  documentation: "https://github.com/vericontext/vibeframe/blob/main/packages/mcp-server/README.md",
  support: "https://github.com/vericontext/vibeframe/issues",
  icon: "icon.png",
  license: "MIT",
  keywords: pkg.keywords,
  // Directory requirement: URLs to policies covering external services that
  // handle user data (narration/image/video providers the user opts into).
  privacy_policies: ["https://vibeframe.ai/privacy"],
  server: {
    type: "node",
    entry_point: "server/index.js",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/server/index.js"],
      env: {
        VIBE_MCP_WORKSPACE: "${user_config.workspace}",
        VIBE_KOKORO_RUNTIME: "${__dirname}/server/kokoro-runtime",
        ANTHROPIC_API_KEY: "${user_config.anthropic_api_key}",
        OPENAI_API_KEY: "${user_config.openai_api_key}",
        GOOGLE_API_KEY: "${user_config.google_api_key}",
        ELEVENLABS_API_KEY: "${user_config.elevenlabs_api_key}",
      },
    },
  },
  user_config: {
    workspace: {
      type: "directory",
      title: "Workspace folder",
      description:
        "Video projects are created here. A .env file in this folder (or any parent) is also loaded, " +
        "so API keys can live there instead of the fields below.",
      required: true,
      default: "${HOME}/VibeFrame",
    },
    anthropic_api_key: {
      type: "string",
      title: "Anthropic API key",
      description:
        "Optional. Used by the batch scene composer and storyboard revision. " +
        "Not needed when Claude authors scenes itself via scene_submit.",
      sensitive: true,
      required: false,
    },
    openai_api_key: {
      type: "string",
      title: "OpenAI API key",
      description: "Optional. Backdrop image generation and fast cloud narration (gpt-4o-mini-tts).",
      sensitive: true,
      required: false,
    },
    google_api_key: {
      type: "string",
      title: "Google API key",
      description: "Optional. Gemini-backed generation and review.",
      sensitive: true,
      required: false,
    },
    elevenlabs_api_key: {
      type: "string",
      title: "ElevenLabs API key",
      description:
        "Optional. Premium narration voices (bundled kokoro TTS is the free alternative).",
      sensitive: true,
      required: false,
    },
  },
  compatibility: {
    platforms: ["darwin", "win32", "linux"],
    runtimes: {
      node: ">=20",
    },
  },
};

writeFileSync(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

const outName = `vibeframe-${pkg.version}.mcpb`;
// zip from inside the stage so manifest.json sits at the archive root.
execFileSync("zip", ["-q", "-r", join("..", outName), "."], { cwd: stage, stdio: "inherit" });

const sizeMb = (statSync(join(stageRoot, outName)).size / 1024 / 1024).toFixed(1);
console.log(`MCPB bundle complete: dist-mcpb/${outName} (${sizeMb} MB)`);
