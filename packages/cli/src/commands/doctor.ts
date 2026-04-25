/**
 * Doctor command - System health check and capability report
 */

import { Command } from "commander";
import chalk from "chalk";
import { access } from "node:fs/promises";
import { CONFIG_PATH } from "../config/index.js";
import { PROVIDER_ENV_VARS } from "../config/schema.js";
import { commandExists } from "../utils/exec-safe.js";
import { execSafe } from "../utils/exec-safe.js";
import { loadEnv } from "../utils/api-key.js";
import { outputResult } from "./output.js";

/** Mapping of env vars to the commands they unlock */
const COMMAND_KEY_MAP: Record<string, string[]> = {
  GOOGLE_API_KEY: [
    "generate image",
    "generate video -p veo",
    "edit image",
    "analyze media",
    "analyze video",
    "analyze review",
  ],
  OPENAI_API_KEY: [
    "agent -p openai",
    "generate image -p openai",
    "edit image -p openai",
    "audio transcribe",
    "edit caption",
    "edit jump-cut",
  ],
  ANTHROPIC_API_KEY: [
    "agent -p claude",
    "generate storyboard",
    "generate motion",
    "edit grade",
    "edit reframe",
    "edit speed-ramp",
    "pipeline script-to-video",
  ],
  XAI_API_KEY: [
    "agent -p xai",
    "generate image -p grok",
    "generate video -p grok",
    "edit image -p grok",
  ],
  FAL_KEY: [
    "generate video -p fal (Seedance 2.0 — default since v0.57)",
    "generate video -p fal -m fast (lower-latency variant)",
    "generate video -p fal -i <image> (image-to-video)",
  ],
  ELEVENLABS_API_KEY: [
    "generate speech",
    "generate sound-effect",
    "generate music",
    "audio voices",
    "audio voice-clone",
    "audio dub",
  ],
  KLING_API_KEY: ["generate video -p kling"],
  RUNWAY_API_SECRET: ["generate video -p runway"],
  REPLICATE_API_TOKEN: ["generate music -p replicate"],
  IMGBB_API_KEY: ["generate video -p kling/fal (image-to-video upload host)"],
};

/** Commands that need no API key (FFmpeg only) */
const FREE_COMMANDS = [
  "edit silence-cut",
  "edit noise-reduce",
  "edit fade",
  "edit text-overlay",
  "detect scenes",
  "detect silence",
  "detect beats",
  "export",
  "project create/info",
  "timeline (all)",
  "batch import/concat",
];

export const doctorCommand = new Command("doctor")
  .description("Check system health and available commands")
  .option("--json", "Output in JSON format")
  .addHelpText(
    "after",
    `
Examples:
  $ vibe doctor              Show system health and capabilities
  $ vibe doctor --json       Machine-readable output
`
  )
  .action(async (options) => {
    if (options.json) process.env.VIBE_JSON_OUTPUT = "1";
    const isJson = process.env.VIBE_JSON_OUTPUT === "1";
    const results = await runDiagnostics();

    if (isJson) {
      outputResult({
        success: true,
        command: "doctor",
        result: results,
      });
      return;
    }

    printReport(results);
  });

/** FFmpeg filters required by offline commands */
const REQUIRED_FFMPEG_FILTERS: Record<string, { commands: string[]; fix: Record<string, string> }> = {
  drawtext: {
    commands: ["edit text-overlay", "edit caption"],
    fix: {
      darwin: "brew uninstall ffmpeg && brew install ffmpeg",
      linux: "sudo apt install ffmpeg (or rebuild with --enable-libfreetype)",
    },
  },
  subtitles: {
    commands: ["edit caption"],
    fix: {
      darwin: "brew uninstall ffmpeg && brew install ffmpeg",
      linux: "sudo apt install ffmpeg (or rebuild with --enable-libass)",
    },
  },
  afftdn: {
    commands: ["edit noise-reduce"],
    fix: {
      darwin: "brew uninstall ffmpeg && brew install ffmpeg",
      linux: "sudo apt install ffmpeg (or rebuild with --enable-libfftw3)",
    },
  },
};

/** Optional external tools for advanced commands */
const OPTIONAL_TOOLS: Record<string, { commands: string[]; install: string }> = {
  remotion: {
    commands: ["generate motion", "edit caption (fallback)"],
    install: "npm install -g @remotion/cli",
  },
  chrome: {
    commands: ["export --backend hyperframes", "run with render.backend=hyperframes"],
    install: "macOS: brew install --cask google-chrome · Linux: apt install chromium",
  },
};

interface FFmpegFilterStatus {
  available: boolean;
  commands: string[];
  fix?: string;
}

interface OptionalToolStatus {
  installed: boolean;
  commands: string[];
  install: string;
}

interface DiagnosticResults {
  system: {
    node: { version: string; ok: boolean };
    ffmpeg: { version: string | null; ok: boolean; filters?: Record<string, FFmpegFilterStatus> };
    config: { path: string; ok: boolean };
    optionalTools?: Record<string, OptionalToolStatus>;
  };
  providers: Record<
    string,
    { envVar: string; configured: boolean; commands: string[] }
  >;
  readyCount: number;
  totalCount: number;
}

async function runDiagnostics(): Promise<DiagnosticResults> {
  loadEnv();

  // System checks
  const nodeVersion = process.version;

  let ffmpegVersion: string | null = null;
  const ffmpegExists = commandExists("ffmpeg");
  if (ffmpegExists) {
    try {
      const result = await execSafe("ffmpeg", ["-version"]);
      const match = result.stdout.match(/ffmpeg version (\S+)/);
      ffmpegVersion = match ? match[1] : "unknown";
    } catch {
      ffmpegVersion = "unknown";
    }
  }

  // FFmpeg filter checks
  let ffmpegFilters: Record<string, FFmpegFilterStatus> | undefined;
  if (ffmpegExists) {
    try {
      const filtersResult = await execSafe("ffmpeg", ["-filters"]);
      const filtersOutput = filtersResult.stdout;
      const platform = process.platform;
      ffmpegFilters = {};
      for (const [filterName, info] of Object.entries(REQUIRED_FFMPEG_FILTERS)) {
        const available = filtersOutput.includes(filterName);
        ffmpegFilters[filterName] = {
          available,
          commands: info.commands,
          ...(!available && info.fix[platform] ? { fix: info.fix[platform] } : {}),
        };
      }
    } catch {
      // filter check failed, skip
    }
  }

  // Optional tools check
  const optionalTools: Record<string, OptionalToolStatus> = {};
  for (const [toolName, info] of Object.entries(OPTIONAL_TOOLS)) {
    let installed = false;
    if (toolName === "remotion") {
      // Check global install without triggering npx download
      try {
        await execSafe("npx", ["--no", "remotion", "--version"], { timeout: 5000 });
        installed = true;
      } catch {
        installed = false;
      }
    } else if (toolName === "chrome") {
      const { existsSync } = await import("node:fs");
      const { homedir } = await import("node:os");
      const { join } = await import("node:path");
      const chromePaths = [
        process.env.HYPERFRAMES_CHROME_PATH,
        process.env.CHROME_PATH,
        join(homedir(), ".cache", "puppeteer", "chrome-headless-shell", "mac_arm-147.0.7727.56", "chrome-headless-shell-mac_arm", "chrome-headless-shell"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
      ];
      installed = chromePaths.some((p) => p && existsSync(p));
    } else {
      installed = commandExists(toolName);
    }
    optionalTools[toolName] = {
      installed,
      commands: info.commands,
      install: info.install,
    };
  }

  let configExists = false;
  try {
    await access(CONFIG_PATH);
    configExists = true;
  } catch {
    // not configured
  }

  // Provider checks
  const providers: DiagnosticResults["providers"] = {};
  let readyCount = FREE_COMMANDS.length;
  let totalCount = FREE_COMMANDS.length;

  for (const [envVar, commands] of Object.entries(COMMAND_KEY_MAP)) {
    const configured = !!process.env[envVar];
    const providerName =
      Object.entries(PROVIDER_ENV_VARS).find(([, v]) => v === envVar)?.[0] ??
      envVar;
    providers[providerName] = { envVar, configured, commands };
    totalCount += commands.length;
    if (configured) {
      readyCount += commands.length;
    }
  }

  return {
    system: {
      node: { version: nodeVersion, ok: true },
      ffmpeg: { version: ffmpegVersion, ok: ffmpegExists, ...(ffmpegFilters ? { filters: ffmpegFilters } : {}) },
      config: { path: CONFIG_PATH, ok: configExists },
      ...(Object.keys(optionalTools).length > 0 ? { optionalTools } : {}),
    },
    providers,
    readyCount,
    totalCount,
  };
}

function printReport(results: DiagnosticResults): void {
  console.log();
  console.log(chalk.bold("  System"));

  // Node
  const nodeIcon = results.system.node.ok ? chalk.green("OK") : chalk.red("MISSING");
  console.log(`    Node.js    ${results.system.node.version}  ${nodeIcon}`);

  // FFmpeg
  if (results.system.ffmpeg.ok) {
    console.log(
      `    FFmpeg     ${results.system.ffmpeg.version}  ${chalk.green("OK")}`
    );
  } else {
    console.log(`    FFmpeg     ${chalk.red("NOT FOUND")}  ${chalk.dim("Install: brew install ffmpeg")}`);
  }

  // FFmpeg filters
  if (results.system.ffmpeg.ok && results.system.ffmpeg.filters) {
    const filters = results.system.ffmpeg.filters;
    const missingFilters = Object.entries(filters).filter(([, f]) => !f.available);
    if (missingFilters.length > 0) {
      for (const [name, info] of missingFilters) {
        console.log(
          `    Filter     ${chalk.yellow(`${name} MISSING`)}  ${chalk.dim(`needed by: ${info.commands.join(", ")}`)}`
        );
        if (info.fix) {
          console.log(`               ${chalk.dim(`Fix: ${info.fix}`)}`);
        }
      }
    } else {
      console.log(`    Filters    ${chalk.green("OK")}  ${chalk.dim("drawtext, subtitles, afftdn")}`);
    }
  }

  // Optional tools
  if (results.system.optionalTools) {
    for (const [name, info] of Object.entries(results.system.optionalTools)) {
      if (info.installed) {
        console.log(`    ${name.padEnd(11)}${chalk.green("OK")}  ${chalk.dim(info.commands.join(", "))}`);
      } else {
        console.log(
          `    ${name.padEnd(11)}${chalk.yellow("MISSING")}  ${chalk.dim(`needed by: ${info.commands.join(", ")}`)}`
        );
        console.log(`               ${chalk.dim(`Install: ${info.install}`)}`);
      }
    }
  }

  // Config
  if (results.system.config.ok) {
    console.log(`    Config     ${chalk.green("OK")}  ${chalk.dim(results.system.config.path)}`);
  } else {
    console.log(
      `    Config     ${chalk.yellow("NOT SET")}  ${chalk.dim("Run: vibe setup")}`
    );
  }

  console.log();
  console.log(chalk.bold("  API Keys"));

  const configured: string[] = [];
  const missing: string[] = [];

  for (const [name, info] of Object.entries(results.providers)) {
    if (info.configured) {
      configured.push(name);
      console.log(
        `    ${chalk.green("OK")}  ${info.envVar.padEnd(24)} ${chalk.dim(info.commands.join(", "))}`
      );
    } else {
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    for (const name of missing) {
      const info = results.providers[name];
      console.log(
        `    ${chalk.red("--")}  ${info.envVar.padEnd(24)} ${chalk.dim(info.commands.join(", "))}`
      );
    }
  }

  // Free commands
  console.log();
  console.log(chalk.bold("  No API key needed"));
  console.log(`    ${chalk.dim(FREE_COMMANDS.join(", "))}`);

  // Summary
  console.log();
  const pct = Math.round((results.readyCount / results.totalCount) * 100);
  const readyColor = pct >= 80 ? chalk.green : pct >= 40 ? chalk.yellow : chalk.red;
  console.log(
    `  Ready: ${readyColor(`${results.readyCount}/${results.totalCount}`)} commands (${pct}%)`
  );

  if (missing.length > 0) {
    console.log(chalk.dim(`  Run 'vibe setup' to configure more providers.`));
  }
  console.log();
}
