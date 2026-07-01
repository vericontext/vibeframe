import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readProjectConfig } from "./project-config.js";

describe("readProjectConfig — legacy vibe.project.yaml back-compat", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "project-config-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads a legacy project.yaml when no vibe.config.json exists", async () => {
    writeFileSync(
      join(dir, "vibe.project.yaml"),
      "name: legacy-proj\naspect: '9:16'\ndefaultSceneDuration: 8\nproviders:\n  image: openai\n  tts: kokoro\n",
      "utf-8",
    );

    const loaded = await readProjectConfig(dir);
    expect(loaded.legacy).toBe(true);
    expect(loaded.source).toBe("vibe.project.yaml");
    expect(loaded.config.name).toBe("legacy-proj");
    expect(loaded.config.aspect).toBe("9:16");
    expect(loaded.config.providers.image).toBe("openai");
    expect(loaded.config.providers.narration).toBe("kokoro");
  });

  it("salvages a real budget cap (budget.maxUsd) into build.maxCostUsd", async () => {
    writeFileSync(
      join(dir, "vibe.project.yaml"),
      "name: capped\nbudget:\n  maxUsd: 7\n",
      "utf-8",
    );

    const loaded = await readProjectConfig(dir);
    expect(loaded.config.build.maxCostUsd).toBe(7);
  });

  it("does not turn the scaffold's maxUsd:0 into a $0 cap (keeps the no-cap default)", async () => {
    writeFileSync(
      join(dir, "vibe.project.yaml"),
      "name: uncapped\nbudget:\n  maxUsd: 0\n",
      "utf-8",
    );

    const loaded = await readProjectConfig(dir);
    // 0 is the scaffold default meaning "no explicit cap" — must not become a
    // hard $0 gate; the V1 default (null = no cap) stands.
    expect(loaded.config.build.maxCostUsd).toBeNull();
  });

  it("prefers vibe.config.json over the legacy yaml when both exist", async () => {
    writeFileSync(
      join(dir, "vibe.config.json"),
      JSON.stringify({ schemaVersion: "1", name: "canonical" }),
      "utf-8",
    );
    writeFileSync(join(dir, "vibe.project.yaml"), "name: legacy\n", "utf-8");

    const loaded = await readProjectConfig(dir);
    expect(loaded.legacy).toBe(false);
    expect(loaded.source).toBe("vibe.config.json");
    expect(loaded.config.name).toBe("canonical");
  });
});
