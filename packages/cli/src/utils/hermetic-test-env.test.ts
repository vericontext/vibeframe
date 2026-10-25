/**
 * Guards scripts/vitest-hermetic-env.mts: a developer's `.env` must never put
 * a real provider key in front of a test, or a local test run can spend money.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PROVIDER_ENV_VARS } from "../config/schema.js";
import { getConfiguredApiKey, loadEnv } from "./api-key.js";

const ENV_VARS = [...new Set(Object.values(PROVIDER_ENV_VARS))];

function leakyProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "vibe-hermetic-"));
  writeFileSync(join(dir, ".env"), ENV_VARS.map((name) => `${name}=sk-leaked`).join("\n"));
  return dir;
}

describe("hermetic test env", () => {
  it("no provider key is set", () => {
    for (const name of ENV_VARS) expect(process.env[name], name).toBeUndefined();
  });

  it("a .env in the cwd or project dir cannot supply a key", async () => {
    const dir = leakyProject();
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    try {
      loadEnv(dir);
      for (const name of ENV_VARS) {
        expect(await getConfiguredApiKey(name, undefined, { cwd: dir }), name).toBeUndefined();
      }
    } finally {
      cwd.mockRestore();
    }
  });

  it("a spawned CLI inherits the guard", () => {
    const dir = leakyProject();
    const out = execFileSync(
      "npx",
      ["tsx", resolve(__dirname, "../index.ts"), "doctor", "--json"],
      { cwd: dir, env: process.env, encoding: "utf-8", timeout: 60_000 }
    );
    const providers = (JSON.parse(out) as { data: { providers: Record<string, { configured: boolean }> } })
      .data.providers;
    const configured = Object.entries(providers).filter(([, p]) => p.configured).map(([name]) => name);
    expect(configured).toEqual([]);
  });

  it("keys saved by `vibe setup` are out of reach", () => {
    expect(process.env.VIBEFRAME_CONFIG_HOME).toContain(tmpdir());
  });
});
