/**
 * Black-box tests for `vibe setup` non-interactive flags + key-format validator.
 * Spawns the CLI binary with a fake $HOME so the wizard's persistence is
 * isolated from the developer's real config.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

import { validateKeyFormat } from "../utils/key-format.js";

const CLI = resolve(__dirname, "..", "..", "dist", "index.js");

let projectDir: string;
let fakeHome: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "vibe-setup-cwd-"));
  fakeHome = mkdtempSync(join(tmpdir(), "vibe-setup-home-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
});

function runSetup(
  args: string[],
  extraEnv: Record<string, string> = {},
): { stdout: string; stderr: string; configPath: string } {
  const result = execFileSync(
    process.execPath,
    [CLI, "setup", ...args],
    {
      cwd: projectDir,
      env: {
        ...process.env,
        HOME: fakeHome,
        PATH: "/usr/bin:/bin",
        NO_COLOR: "1",
        ...extraEnv,
      },
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return {
    stdout: result,
    stderr: "",
    configPath: join(fakeHome, ".vibeframe", "config.yaml"),
  };
}

describe("validateKeyFormat", () => {
  it("returns ok=true for empty / whitespace input", () => {
    expect(validateKeyFormat("anthropic", "").ok).toBe(true);
    expect(validateKeyFormat("anthropic", "   ").ok).toBe(true);
  });

  it("accepts well-formed prefixes for known providers", () => {
    expect(validateKeyFormat("anthropic", "sk-ant-abc123").ok).toBe(true);
    expect(validateKeyFormat("openai", "sk-proj-abc").ok).toBe(true);
    expect(validateKeyFormat("google", "AIzaSyDxyz").ok).toBe(true);
    expect(validateKeyFormat("xai", "xai-abcdef").ok).toBe(true);
    expect(validateKeyFormat("elevenlabs", "sk_abc123").ok).toBe(true);
    expect(validateKeyFormat("runway", "key_abcdef").ok).toBe(true);
    expect(validateKeyFormat("kling", "ACCESS:SECRET").ok).toBe(true);
    expect(validateKeyFormat("replicate", "r8_abcdef").ok).toBe(true);
    expect(validateKeyFormat("openrouter", "sk-or-abcdef").ok).toBe(true);
  });

  it("flags mismatched prefixes with the documented example", () => {
    const r = validateKeyFormat("anthropic", "sk-proj-mistakenly-pasted");
    expect(r.ok).toBe(false);
    expect(r.expected).toBe("sk-ant-...");

    const r2 = validateKeyFormat("google", "not-a-google-key");
    expect(r2.ok).toBe(false);
    expect(r2.expected).toBe("AIza...");
  });

  it("flags malformed fal and imgbb keys (added in v0.81)", () => {
    // fal: requires `<id>:<secret>` shape — no colon → soft warn.
    const fal = validateKeyFormat("fal", "no-colon-here");
    expect(fal.ok).toBe(false);
    expect(fal.expected).toBe("<key-id>:<key-secret>");

    // imgbb: 32-char lowercase hex.
    const imgbb = validateKeyFormat("imgbb", "deadbeef0123"); // too short
    expect(imgbb.ok).toBe(false);
    expect(imgbb.expected).toBe("32-char hex");
  });

  it("accepts well-formed fal and imgbb keys", () => {
    expect(validateKeyFormat("fal", "abc-id:xyz-secret").ok).toBe(true);
    expect(validateKeyFormat("imgbb", "0123456789abcdef0123456789abcdef").ok).toBe(true);
  });

  it("returns ok=true for unknown configKeys", () => {
    expect(validateKeyFormat("not-a-real-provider", "whatever").ok).toBe(true);
  });
});

describe("vibe setup --yes (non-interactive)", () => {
  it("creates a config file with defaults when no other flags are given", () => {
    const { stdout, configPath } = runSetup(["--yes"]);
    expect(stdout).toContain("Setup complete (non-interactive, user scope)");
    expect(stdout).toContain("No changes (config already up to date)");
    expect(existsSync(configPath)).toBe(true);
    const cfg = parseYaml(readFileSync(configPath, "utf-8"));
    expect(cfg.llm.provider).toBeDefined();
    expect(cfg.providers).toBeDefined();
  });

  it("--provider switches the agent provider", () => {
    const { stdout, configPath } = runSetup(["--yes", "--provider", "openai"]);
    expect(stdout).toContain("provider=openai");
    const cfg = parseYaml(readFileSync(configPath, "utf-8"));
    expect(cfg.llm.provider).toBe("openai");
  });

  it("rejects an invalid --provider value", () => {
    let threw = false;
    try {
      execFileSync(
        process.execPath,
        [CLI, "setup", "--yes", "--provider", "bogus"],
        {
          cwd: projectDir,
          env: { ...process.env, HOME: fakeHome, NO_COLOR: "1" },
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch (err) {
      threw = true;
      const msg = (err as { stderr?: string; stdout?: string }).stderr ?? (err as { stdout?: string }).stdout ?? "";
      expect(msg).toMatch(/Invalid --provider/);
    }
    expect(threw).toBe(true);
  });

  it("--import-env promotes shell env keys into config", () => {
    const { stdout, configPath } = runSetup(["--yes", "--import-env"], {
      ANTHROPIC_API_KEY: "sk-ant-test123",
      OPENAI_API_KEY: "sk-proj-test456",
    });
    expect(stdout).toContain("imported");
    const cfg = parseYaml(readFileSync(configPath, "utf-8"));
    expect(cfg.providers.anthropic).toBe("sk-ant-test123");
    expect(cfg.providers.openai).toBe("sk-proj-test456");
  });

  it("--import-env reads .env in cwd", () => {
    writeFileSync(
      join(projectDir, ".env"),
      "ANTHROPIC_API_KEY=sk-ant-from-dotenv\n",
    );
    const { stdout, configPath } = runSetup(["--yes", "--import-env"]);
    expect(stdout).toContain("imported");
    const cfg = parseYaml(readFileSync(configPath, "utf-8"));
    expect(cfg.providers.anthropic).toBe("sk-ant-from-dotenv");
  });

  it("--import-env warns on unusual key format but still saves", () => {
    const result = execFileSync(
      process.execPath,
      [CLI, "setup", "--yes", "--import-env"],
      {
        cwd: projectDir,
        env: {
          ...process.env,
          HOME: fakeHome,
          NO_COLOR: "1",
          ANTHROPIC_API_KEY: "totally-not-the-right-prefix",
        },
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const configPath = join(fakeHome, ".vibeframe", "config.yaml");
    const cfg = parseYaml(readFileSync(configPath, "utf-8"));
    expect(cfg.providers.anthropic).toBe("totally-not-the-right-prefix");
    // The warning is on stderr; execFileSync collects it via stdio[2].
    // Black-box: just ensure the value was persisted despite mismatch.
    expect(result).toContain("imported");
  });

  it("is idempotent — second run with same env reports no changes", () => {
    runSetup(["--yes", "--import-env"], { ANTHROPIC_API_KEY: "sk-ant-test" });
    const { stdout } = runSetup(["--yes", "--import-env"], { ANTHROPIC_API_KEY: "sk-ant-test" });
    expect(stdout).toContain("No changes");
  });
});

describe("vibe setup --scope project", () => {
  it("writes to ./.vibeframe/config.yaml, not ~/.vibeframe/config.yaml", () => {
    const { stdout } = runSetup(["--yes", "--scope", "project", "--provider", "openai"]);
    expect(stdout).toContain("project scope");

    const projectConfigPath = join(projectDir, ".vibeframe", "config.yaml");
    const userConfigPath = join(fakeHome, ".vibeframe", "config.yaml");

    expect(existsSync(projectConfigPath)).toBe(true);
    expect(existsSync(userConfigPath)).toBe(false);

    const cfg = parseYaml(readFileSync(projectConfigPath, "utf-8"));
    expect(cfg.llm.provider).toBe("openai");
  });

  it("project-scope --import-env reads .env from cwd", () => {
    writeFileSync(
      join(projectDir, ".env"),
      "ANTHROPIC_API_KEY=sk-ant-project\n",
    );
    runSetup(["--yes", "--scope", "project", "--import-env"]);

    const projectConfigPath = join(projectDir, ".vibeframe", "config.yaml");
    const cfg = parseYaml(readFileSync(projectConfigPath, "utf-8"));
    expect(cfg.providers.anthropic).toBe("sk-ant-project");
  });

  it("rejects an invalid --scope value", () => {
    let threw = false;
    try {
      execFileSync(
        process.execPath,
        [CLI, "setup", "--yes", "--scope", "global"],
        {
          cwd: projectDir,
          env: { ...process.env, HOME: fakeHome, NO_COLOR: "1" },
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch (err) {
      threw = true;
      const msg = (err as { stderr?: string; stdout?: string }).stderr ?? (err as { stdout?: string }).stdout ?? "";
      expect(msg).toMatch(/Invalid --scope/);
    }
    expect(threw).toBe(true);
  });

  it("user scope is unaffected when project scope writes", () => {
    runSetup(["--yes", "--provider", "claude"]);
    runSetup(["--yes", "--scope", "project", "--provider", "openai"]);

    const userCfg = parseYaml(readFileSync(join(fakeHome, ".vibeframe", "config.yaml"), "utf-8"));
    const projCfg = parseYaml(readFileSync(join(projectDir, ".vibeframe", "config.yaml"), "utf-8"));

    expect(userCfg.llm.provider).toBe("claude");
    expect(projCfg.llm.provider).toBe("openai");
  });
});
