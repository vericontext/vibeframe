import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { projectConfigJson } from "./_shared/project-config.js";

const CLI = resolve(__dirname, "..", "..", "dist", "index.js");

let projectDir: string;
let fakeHome: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "vibe-review-actions-cli-"));
  fakeHome = mkdtempSync(join(tmpdir(), "vibe-review-actions-home-"));
  writeFileSync(join(projectDir, "vibe.config.json"), projectConfigJson({ name: "promo" }));
  writeFileSync(join(projectDir, "DESIGN.md"), "# Design\n");
  writeFileSync(join(projectDir, "index.html"), "<!doctype html><html><body></body></html>");
  writeFileSync(
    join(projectDir, "STORYBOARD.md"),
    `# Promo

## Beat hook - Hook

\`\`\`yaml
duration: 3
narration: "Hello."
\`\`\`

Body.
`
  );
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
});

function runVibe(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: fakeHome,
    NO_COLOR: "1",
    VIBE_HUMAN_OUTPUT: "1",
  };
  delete env.VIBE_JSON_OUTPUT;
  delete env.VIBE_QUIET_OUTPUT;
  delete env.VIBE_OUTPUT_FIELDS;
  const result = spawnSync(process.execPath, [CLI, ...args], {
    env,
    encoding: "utf-8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("review nextActions CLI contract", () => {
  it("surfaces nextActions through inspect reports and status project", () => {
    const project = runVibe(["inspect", "project", projectDir, "--json"]);
    expect(project.status).toBe(1);
    const projectJson = JSON.parse(project.stdout);

    expect(projectJson.command).toBe("inspect project");
    expect(projectJson.data.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: `vibe build ${projectDir} --beat hook --stage compose --json`,
          requiresConfirmation: true,
          safeToAutoRun: false,
        }),
      ])
    );

    const projectReport = JSON.parse(readFileSync(join(projectDir, "review-report.json"), "utf-8"));
    expect(projectReport.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: `vibe build ${projectDir} --beat hook --stage compose --json`,
        }),
      ])
    );

    const render = runVibe(["inspect", "render", projectDir, "--cheap", "--json"]);
    expect(render.status).toBe(1);
    const renderJson = JSON.parse(render.stdout);
    expect(renderJson.command).toBe("inspect render");
    expect(renderJson.data.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: `vibe render ${projectDir} --json`,
          safeToAutoRun: true,
          requiresConfirmation: false,
        }),
      ])
    );

    const status = runVibe(["status", "project", projectDir, "--json"]);
    expect(status.status).toBe(0);
    const statusJson = JSON.parse(status.stdout);
    expect(statusJson.command).toBe("status project");
    expect(statusJson.data.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: `vibe render ${projectDir} --json`,
          safeToAutoRun: true,
        }),
      ])
    );
  });

  it("prints next actions in human-readable project status", () => {
    const inspect = runVibe(["inspect", "render", projectDir, "--cheap", "--json"]);
    expect(inspect.status).toBe(1);
    expect(existsSync(join(projectDir, "review-report.json"))).toBe(true);

    const status = runVibe(["status", "project", projectDir]);
    expect(status.status).toBe(0);
    expect(status.stdout).toContain("Next actions");
    expect(status.stdout).toContain("vibe render");
    expect(status.stdout).toContain("auto");
  });
});
