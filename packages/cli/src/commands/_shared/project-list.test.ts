import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeProjectList } from "./project-list.js";

const STORYBOARD = `---
title: test
---

# Storyboard

## Beat hook — Hook

\`\`\`yaml
narration: "Hi."
duration: 6
\`\`\`

Hook.

## Beat close — Close

\`\`\`yaml
duration: 8
\`\`\`

Close.
`;

let workspace: string;

async function makeProject(name: string, opts: { report?: object; render?: string } = {}) {
  const dir = join(workspace, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "STORYBOARD.md"), STORYBOARD);
  if (opts.report) {
    await writeFile(join(dir, "build-report.json"), JSON.stringify(opts.report));
  }
  if (opts.render) {
    await mkdir(join(dir, "renders"), { recursive: true });
    await writeFile(join(dir, "renders", opts.render), "fake");
  }
  return dir;
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "vibe-project-list-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("executeProjectList", () => {
  it("lists scene projects with beats, duration, build status, and latest render", async () => {
    await makeProject("alpha", {
      report: { status: "done", updatedAt: "2026-06-11T00:00:00.000Z" },
      render: "alpha.mp4",
    });
    await makeProject("beta");

    const result = await executeProjectList({ workspaceDir: workspace });
    expect(result.success).toBe(true);
    expect(result.projects.map((p) => p.name).sort()).toEqual(["alpha", "beta"]);

    const alpha = result.projects.find((p) => p.name === "alpha")!;
    expect(alpha.beats).toBe(2);
    expect(alpha.storyboardDurationSec).toBe(14);
    expect(alpha.buildStatus).toBe("done");
    expect(alpha.latestRender?.file).toBe("alpha.mp4");

    const beta = result.projects.find((p) => p.name === "beta")!;
    expect(beta.buildStatus).toBeUndefined();
    expect(beta.latestRender).toBeUndefined();
  });

  it("skips _archive, dotdirs, node_modules, and non-project dirs", async () => {
    await makeProject("active");
    await mkdir(join(workspace, "_archive"), { recursive: true });
    await mkdir(join(workspace, "_archive", "old-one"), { recursive: true });
    await writeFile(join(workspace, "_archive", "old-one", "STORYBOARD.md"), STORYBOARD);
    await mkdir(join(workspace, ".hidden"), { recursive: true });
    await mkdir(join(workspace, "node_modules", "kokoro-js"), { recursive: true });
    await mkdir(join(workspace, "random-dir"), { recursive: true });
    await writeFile(join(workspace, "stray-file.txt"), "x");

    const result = await executeProjectList({ workspaceDir: workspace });
    expect(result.projects.map((p) => p.name)).toEqual(["active"]);
    expect(result.archivedCount).toBe(1);
  });

  it("returns a structured error for a missing workspace", async () => {
    const result = await executeProjectList({ workspaceDir: join(workspace, "nope") });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});
