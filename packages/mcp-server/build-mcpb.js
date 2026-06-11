import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

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
 * server via the VIBE_MCP_WORKSPACE env mapping below. kokoro-js local TTS is
 * the one optional piece that cannot ship inside (platform-native binaries);
 * KokoroProvider falls back to <workspace>/node_modules/kokoro-js.
 */

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

const stageRoot = resolve("dist-mcpb");
const stage = join(stageRoot, "stage");
rmSync(stageRoot, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

await buildServerBundle({ outDir: join(stage, "server"), bundleHostDeps: true });

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
    "all inside the workspace folder you pick below. Rendering requires Google Chrome and ffmpeg on this machine.",
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
      description: "Optional. Backdrop image generation and TTS.",
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
      description: "Optional. Narration TTS (kokoro local TTS is the free alternative).",
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
