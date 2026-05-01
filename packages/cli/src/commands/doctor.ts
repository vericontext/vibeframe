/**
 * Doctor command - System health check and capability report
 */

import { Command } from "commander";
import chalk from "chalk";
import { access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { CONFIG_PATH, getProjectConfigPath, getActiveScope, type Scope } from "../config/index.js";
import { PROVIDER_ENV_VARS } from "../config/schema.js";
import { getCommandKeyMap, getDisplayLabelForApiKey } from "@vibeframe/ai-providers";
import { commandExists } from "../utils/exec-safe.js";
import { execSafe } from "../utils/exec-safe.js";
import { loadEnv } from "../utils/api-key.js";
import { detectAgentHosts, summariseAgentHosts } from "../utils/agent-host-detect.js";
import {
  composerEnvVar,
  composerLabel,
  resolveComposer,
  ComposerResolveError,
  type ComposerProvider,
} from "./_shared/composer-resolve.js";
import { getCostTier, TIER_COLOR, type CostTier } from "./_shared/cost-tier.js";
import { resolveSceneBuildMode } from "./_shared/scene-build.js";
import { outputSuccess } from "./output.js";

/**
 * Mapping of env vars to the commands they unlock. Derived from the
 * provider registry — each provider's `commandsUnlocked` aggregates by
 * apiKey. Pre-v0.68 this was hand-maintained alongside the provider
 * arrays; v0.68 collapsed both into the registry.
 */
const COMMAND_KEY_MAP: Record<string, readonly string[]> = getCommandKeyMap();

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
  "timeline create/info",
  "timeline (all)",
  "batch import/concat",
];

export const doctorCommand = new Command("doctor")
  .description("Check system health and available commands")
  .option("--json", "Output in JSON format")
  .option("-v, --verbose", "Show full report (every provider row, scene composer block, free-command list)")
  .option("--test-keys", "Make a lightweight authenticated request to each provider (validates configured keys; skips providers without a cheap test endpoint)")
  .addHelpText(
    "after",
    `
Examples:
  $ vibe doctor              Compact health summary (issues + Ready %)
  $ vibe doctor --verbose    Full report — all providers, composer, free commands
  $ vibe doctor --test-keys  Validate each configured key against its provider
  $ vibe doctor --json       Machine-readable output
`
  )
  .action(async (options) => {
    const startedAt = Date.now();
    if (options.json) process.env.VIBE_JSON_OUTPUT = "1";
    const isJson = process.env.VIBE_JSON_OUTPUT === "1";
    const results = await runDiagnostics();

    if (isJson) {
      outputSuccess({
        command: "doctor",
        startedAt,
        data: { ...results },
      });
      return;
    }

    printReport(results, {
      verbose: Boolean(options.verbose),
      program: doctorCommand.parent,
    });

    if (options.testKeys) {
      await runLiveKeyTests(results);
    }
  });

/** FFmpeg filters required by offline commands.
 *
 * The Homebrew core `ffmpeg` formula on macOS ships **without** several
 * libs we need (`libfreetype` → drawtext, `libass` → subtitles). The
 * `homebrew-ffmpeg/ffmpeg` tap rebuilds with the kitchen sink. Apple's
 * suggestions used to read "brew reinstall ffmpeg" — that does nothing
 * because the formula itself omits the libs. Fixed in v0.79.1. */
const REQUIRED_FFMPEG_FILTERS: Record<string, { commands: string[]; fix: Record<string, string> }> = {
  drawtext: {
    commands: ["edit text-overlay", "edit caption"],
    fix: {
      darwin: "brew tap homebrew-ffmpeg/ffmpeg && brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-freetype (Homebrew core ffmpeg lacks libfreetype)",
      linux: "sudo apt install ffmpeg (or rebuild with --enable-libfreetype)",
    },
  },
  subtitles: {
    commands: ["edit caption"],
    fix: {
      darwin: "brew tap homebrew-ffmpeg/ffmpeg && brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-libass (Homebrew core ffmpeg lacks libass)",
      linux: "sudo apt install ffmpeg (or rebuild with --enable-libass)",
    },
  },
  afftdn: {
    commands: ["edit noise-reduce"],
    fix: {
      darwin: "brew install ffmpeg (afftdn ships in the default Homebrew formula; a reinstall is rarely needed)",
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
  /**
   * v0.61: scope-aware status. The "what should I run next?" hint at the
   * bottom of the report uses these flags directly.
   */
  scope: {
    /**
     * Which scope `loadConfig()` is reading from right now: project
     * if `<cwd>/.vibeframe/config.yaml` exists, else user. Drives the
     * "← active" marker in the render output.
     */
    activeScope: Scope;
    user: {
      /** `~/.vibeframe/config.yaml` exists — `vibe setup` has been run. */
      configured: boolean;
      configPath: string;
    };
    project: {
      /** Current working directory. */
      cwd: string;
      /** True when ANY of (AGENTS.md / CLAUDE.md / vibe.project.yaml) exists. */
      initialized: boolean;
      /** Per-file existence — each entry is informational for the report. */
      files: { path: string; exists: boolean }[];
      /** `<cwd>/.vibeframe/config.yaml` path (whether or not it exists). */
      configPath: string;
      /** `<cwd>/.vibeframe/config.yaml` exists — `vibe setup --scope project` has run here. */
      configFileExists: boolean;
    };
    agentHosts: {
      detected: string[];
      summary: string;
    };
    /**
     * Plan H — `vibe build` agentic dispatch readiness.
     *
     * `recommendedMode` mirrors `resolveSceneBuildMode()` so the user
     * sees what `vibe build` will actually do without flags.
     * `composer` reports the auto-resolved batch fallback (claude /
     * gemini / openai) so they know which key powers `--mode batch`.
     * `sceneProjectInCwd` + `skillInstalled` flag whether the local
     * cwd is a scene project that already has SKILL.md from H1.
     */
    sceneComposer: {
      recommendedMode: "agent" | "batch";
      composer: ComposerProvider | null;
      composerEnvVar: string | null;
      sceneProjectInCwd: boolean;
      skillInstalled: boolean;
    };
  };
  providers: Record<
    string,
    { envVar: string; configured: boolean; commands: readonly string[] }
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

  // v0.61: scope diagnostics ─────────────────────────────────────────────
  const cwd = process.cwd();
  const projectFiles = ["AGENTS.md", "CLAUDE.md", "vibe.project.yaml"].map((rel) => ({
    path: rel,
    exists: existsSync(resolve(cwd, rel)),
  }));
  const projectInitialized = projectFiles.some((f) => f.exists);

  // v0.90: project-scope config.yaml diagnostics ────────────────────────
  const projectConfigPath = getProjectConfigPath(cwd);
  const projectConfigExists = existsSync(projectConfigPath);
  const activeScope = await getActiveScope(cwd);

  const hosts = detectAgentHosts();
  const detectedNames = hosts.filter((h) => h.detected).map((h) => h.label);

  // Plan H — scene composer readiness ───────────────────────────────────
  const recommendedMode = resolveSceneBuildMode({});
  let composerResolved: ComposerProvider | null = null;
  let composerEnv: string | null = null;
  try {
    const r = resolveComposer();
    composerResolved = r.provider;
    composerEnv = composerEnvVar(r.provider);
  } catch (err) {
    if (!(err instanceof ComposerResolveError)) throw err;
    // No composer key — composerResolved stays null. Reported in render.
  }
  const sceneProjectInCwd = existsSync(resolve(cwd, "STORYBOARD.md"));
  const skillInstalled = existsSync(resolve(cwd, "SKILL.md"));

  return {
    system: {
      node: { version: nodeVersion, ok: true },
      ffmpeg: { version: ffmpegVersion, ok: ffmpegExists, ...(ffmpegFilters ? { filters: ffmpegFilters } : {}) },
      config: { path: CONFIG_PATH, ok: configExists },
      ...(Object.keys(optionalTools).length > 0 ? { optionalTools } : {}),
    },
    scope: {
      activeScope,
      user: { configured: configExists, configPath: CONFIG_PATH },
      project: {
        cwd,
        initialized: projectInitialized,
        files: projectFiles,
        configPath: projectConfigPath,
        configFileExists: projectConfigExists,
      },
      agentHosts: { detected: detectedNames, summary: summariseAgentHosts(hosts) },
      sceneComposer: {
        recommendedMode,
        composer: composerResolved,
        composerEnvVar: composerEnv,
        sceneProjectInCwd,
        skillInstalled,
      },
    },
    providers,
    readyCount,
    totalCount,
  };
}

function printReport(
  results: DiagnosticResults,
  opts: { verbose: boolean; program?: Command | null } = { verbose: false },
): void {
  const { verbose, program } = opts;
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
    const tools = Object.entries(results.system.optionalTools);
    if (verbose) {
      for (const [name, info] of tools) {
        if (info.installed) {
          console.log(`    ${name.padEnd(11)}${chalk.green("OK")}  ${chalk.dim(info.commands.join(", "))}`);
        } else {
          console.log(
            `    ${name.padEnd(11)}${chalk.yellow("MISSING")}  ${chalk.dim(`needed by: ${info.commands.join(", ")}`)}`
          );
          console.log(`               ${chalk.dim(`Install: ${info.install}`)}`);
        }
      }
    } else {
      // Compact: collapse OK tools to one line, always show MISSING ones.
      const okNames = tools.filter(([, t]) => t.installed).map(([n]) => n);
      const missing = tools.filter(([, t]) => !t.installed);
      if (okNames.length > 0) {
        console.log(`    Tools      ${chalk.green("OK")}  ${chalk.dim(okNames.join(", "))}`);
      }
      for (const [name, info] of missing) {
        console.log(
          `    ${name.padEnd(11)}${chalk.yellow("MISSING")}  ${chalk.dim(`needed by: ${info.commands.join(", ")}`)}`
        );
        console.log(`               ${chalk.dim(`Install: ${info.install}`)}`);
      }
    }
  }

  console.log();
  console.log(chalk.bold("  Scope"));

  // Config scope — which config.yaml is being read
  const userActive = results.scope.activeScope === "user" && results.scope.user.configured;
  const projectActive = results.scope.activeScope === "project";
  const activeMark = chalk.cyan(" ← active");

  if (results.scope.user.configured) {
    console.log(
      `    Cfg(user)  ${chalk.green("OK")}       ${chalk.dim(results.scope.user.configPath)}${userActive ? activeMark : ""}`,
    );
  } else {
    console.log(`    Cfg(user)  ${chalk.yellow("NOT SET")}  ${chalk.dim("Run: vibe setup")}`);
  }

  if (results.scope.project.configFileExists) {
    console.log(
      `    Cfg(proj)  ${chalk.green("OK")}       ${chalk.dim(results.scope.project.configPath)}${projectActive ? activeMark : ""}`,
    );
  } else {
    console.log(
      `    Cfg(proj)  ${chalk.dim("none")}     ${chalk.dim(`Run: vibe setup --scope project  (cwd: ${results.scope.project.cwd})`)}`,
    );
  }

  // Project init — vibe init scaffolding (AGENTS.md / CLAUDE.md / vibe.project.yaml)
  if (results.scope.project.initialized) {
    const present = results.scope.project.files.filter((f) => f.exists).map((f) => f.path);
    console.log(`    Init       ${chalk.green("OK")}       ${chalk.dim(present.join(", "))}`);
  } else {
    console.log(`    Init       ${chalk.yellow("NOT INIT")} ${chalk.dim(`Run: vibe init  (cwd: ${results.scope.project.cwd})`)}`);
  }

  // Agent hosts — informational
  console.log(`    Agents     ${chalk.dim(results.scope.agentHosts.summary)}`);

  // Plan H — scene composer (verbose only — most users don't tune this).
  if (verbose) {
    console.log();
    console.log(chalk.bold("  Scene composer (vibe build)"));
    const sc = results.scope.sceneComposer;
    const modeBadge = sc.recommendedMode === "agent"
      ? chalk.cyan("agent")
      : chalk.dim("batch");
    const modeNote = sc.recommendedMode === "agent"
      ? chalk.dim("host agent authors HTML; no internal LLM call")
      : chalk.dim("CLI's internal LLM authors HTML");
    console.log(`    Mode (auto)  ${modeBadge}  ${modeNote}`);
    if (sc.composer) {
      console.log(
        `    Batch LLM    ${chalk.green("OK")}     ${chalk.dim(`${composerLabel(sc.composer)} (${sc.composerEnvVar})`)}`,
      );
    } else {
      console.log(
        `    Batch LLM    ${chalk.yellow("--")}     ${chalk.dim("no ANTHROPIC_API_KEY / GOOGLE_API_KEY / OPENAI_API_KEY — agent-mode only")}`,
      );
    }
    if (sc.sceneProjectInCwd) {
      if (sc.skillInstalled) {
        console.log(`    SKILL.md     ${chalk.green("OK")}     ${chalk.dim("installed in this scene project")}`);
      } else {
        console.log(`    SKILL.md     ${chalk.yellow("MISSING")} ${chalk.dim("Run: vibe scene install-skill")}`);
      }
    } else {
      console.log(`    SKILL.md     ${chalk.dim("(no STORYBOARD.md in cwd — skill is per-scene-project)")}`);
    }
  }

  console.log();
  console.log(chalk.bold("  API Keys"));

  const configured: string[] = [];
  const missing: string[] = [];

  // Friendly label disambiguates gateways (Seedance 2.0 via fal.ai) from
  // direct providers — derived from the `displayName`+`gateway` pair when
  // present, else the apiKey's own label.
  const labelFor = (configKey: string, fallbackEnv: string): string => {
    const label = getDisplayLabelForApiKey(configKey);
    return label === configKey ? fallbackEnv : label;
  };

  for (const [name, info] of Object.entries(results.providers)) {
    if (info.configured) {
      configured.push(name);
      const label = labelFor(name, info.envVar);
      console.log(
        `    ${chalk.green("OK")}  ${label.padEnd(28)} ${chalk.dim(info.envVar.padEnd(20))} ${chalk.dim(info.commands.join(", "))}`
      );
    } else {
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    if (verbose) {
      for (const name of missing) {
        const info = results.providers[name];
        const label = labelFor(name, info.envVar);
        console.log(
          `    ${chalk.red("--")}  ${label.padEnd(28)} ${chalk.dim(info.envVar.padEnd(20))} ${chalk.dim(info.commands.join(", "))}`
        );
      }
    } else {
      // Compact: one summary line — keeps the "what's missing" signal but
      // doesn't blast 11 rows when the user has only configured 2.
      console.log(
        chalk.dim(`    ${missing.length} provider${missing.length === 1 ? "" : "s"} unconfigured (${missing.slice(0, 4).join(", ")}${missing.length > 4 ? ", …" : ""}). Run with --verbose to list.`),
      );
    }
  }

  // Free commands (verbose only — they're always available, no signal in
  // the default view).
  if (verbose) {
    console.log();
    console.log(chalk.bold("  No API key needed"));
    console.log(`    ${chalk.dim(FREE_COMMANDS.join(", "))}`);
  }

  // Summary — three counts, each describing a different slice. Three
  // numbers used to drift unlabeled (catalog total, runnable count,
  // cost-tagged count) so they're now grouped together with explicit
  // labels and `vibe schema --list` is the canonical "show me
  // everything" pointer.
  console.log();
  const pct = Math.round((results.readyCount / results.totalCount) * 100);
  const readyColor = pct >= 80 ? chalk.green : pct >= 40 ? chalk.yellow : chalk.red;

  let catalogTotal = 0;
  let tierCounts: Record<CostTier, number> = { "free": 0, "low": 0, "high": 0, "very-high": 0 };
  if (program) {
    catalogTotal = countCatalog(program);
    tierCounts = countCostTiers(program);
  }
  const taggedTotal = tierCounts.free + tierCounts.low + tierCounts.high + tierCounts["very-high"];

  console.log(chalk.bold("  Catalog"));
  if (catalogTotal > 0) {
    console.log(`    Total commands         ${chalk.bold(catalogTotal)} ${chalk.dim("(see: vibe schema --list)")}`);
  }
  console.log(
    `    Runnable with keys     ${readyColor(`${results.readyCount}/${results.totalCount}`)} ${chalk.dim(`(${pct}%)`)}`
  );
  if (taggedTotal > 0) {
    const parts = [
      `${TIER_COLOR.free(`${tierCounts.free} free`)}`,
      `${TIER_COLOR.low(`${tierCounts.low} low`)}`,
      `${TIER_COLOR.high(`${tierCounts.high} high`)}`,
      `${TIER_COLOR["very-high"](`${tierCounts["very-high"]} very-high`)}`,
    ];
    console.log(`    Cost-tagged            ${chalk.bold(taggedTotal)}  ${parts.join(chalk.dim(", "))}`);
  }

  // ── v0.61: scope-aware "what to do next" hint ────────────────────────
  // Prioritise scope problems over provider gaps — a user without setup
  // configured can't run 'vibe setup' to add providers either.
  const nextStep = pickNextStep(results, missing.length > 0);
  if (nextStep) {
    console.log(chalk.dim(`  ${nextStep}`));
  }
  console.log();
}

/**
 * Count every non-deprecated command in the program tree. Mirrors the
 * filter used by `vibe schema --list` so the doctor's "Total commands"
 * line stays in sync with what users see when they list the catalog.
 */
function countCatalog(program: Command): number {
  let count = 0;
  const skipTopLevel = new Set(["help", "schema"]);
  for (const top of program.commands) {
    if (skipTopLevel.has(top.name())) continue;
    const subCmds = top.commands;
    if (subCmds.length === 0) {
      const desc = top.description() || "";
      if (desc.toLowerCase().includes("deprecated")) continue;
      count++;
      continue;
    }
    for (const sub of subCmds) {
      const desc = sub.description() || "";
      if (desc.toLowerCase().includes("deprecated")) continue;
      count++;
    }
  }
  return count;
}

/**
 * Walk the program command tree and tally subcommand counts per cost
 * tier. Only counts commands stamped via `applyTier()`; utility
 * commands like `setup` / `doctor` / `init` are intentionally skipped.
 */
function countCostTiers(program: Command): Record<CostTier, number> {
  const counts: Record<CostTier, number> = {
    "free": 0,
    "low": 0,
    "high": 0,
    "very-high": 0,
  };
  const walk = (cmd: Command) => {
    const tier = getCostTier(cmd);
    if (tier) counts[tier]++;
    for (const child of cmd.commands) walk(child);
  };
  for (const top of program.commands) walk(top);
  return counts;
}

/**
 * `--test-keys` driver. Runs sequentially — most providers rate-limit
 * authenticated requests and parallelism would also clutter the
 * progressive output.
 */
async function runLiveKeyTests(results: DiagnosticResults): Promise<void> {
  console.log();
  console.log(chalk.bold("  Live key tests"));
  console.log(chalk.dim("    Hits each provider's cheapest authenticated endpoint with a 5s timeout."));

  const configured = Object.entries(results.providers).filter(([, info]) => info.configured);
  if (configured.length === 0) {
    console.log(chalk.dim("    No keys configured — nothing to test."));
    return;
  }

  // Lazy import keeps the module out of `vibe doctor` (no flag) cold-start.
  const { testKey } = await import("../utils/key-live-test.js");

  for (const [name, info] of configured) {
    const value = process.env[info.envVar];
    if (!value) continue; // shouldn't happen — info.configured already checked
    process.stdout.write(`    ${name.padEnd(12)} `);
    const result = await testKey(name, value);
    if (result.skipped) {
      console.log(chalk.dim(`SKIP  ${result.message ?? "no test available"}`));
    } else if (result.ok) {
      console.log(`${chalk.green("OK")}    ${chalk.dim(`${result.status}`)}`);
    } else {
      const detail = result.message ?? `status ${result.status ?? "?"}`;
      console.log(`${chalk.red("FAIL")}  ${chalk.dim(detail)}`);
    }
  }
  console.log();
}

/**
 * Pick the single most-helpful next-step suggestion for the user. Order:
 *  1. no config in either scope → run setup
 *  2. project scope uninitialized → run init
 *  3. some providers missing → setup again to add more keys
 *  4. everything ok → no hint
 */
function pickNextStep(results: DiagnosticResults, hasMissingProviders: boolean): string | null {
  // Either scope satisfies "configured" — project-only users shouldn't be
  // nagged to run user-scope setup.
  const anyConfigured = results.scope.user.configured || results.scope.project.configFileExists;
  if (!anyConfigured) {
    return "Next: run 'vibe setup' (or 'vibe setup --scope project' to keep config inside the project) to configure API keys + LLM provider.";
  }
  if (!results.scope.project.initialized) {
    return "Next: run 'vibe init' in your project directory to scaffold AGENTS.md / CLAUDE.md / .env.example.";
  }
  // Plan H — nudge a scene project that's missing the skill files.
  // Without SKILL.md the agentic compose path can't run.
  const sc = results.scope.sceneComposer;
  if (sc.sceneProjectInCwd && !sc.skillInstalled) {
    return "Next: run 'vibe scene install-skill' so your host agent can read the Hyperframes rules from this project.";
  }
  if (hasMissingProviders) {
    return "Run 'vibe setup' to add more provider keys.";
  }
  return null;
}
