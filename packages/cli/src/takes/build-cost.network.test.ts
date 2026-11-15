/**
 * What a build says it will cost and what it says it cost, over the real
 * plan, build, provider, and take paths (only `fetch` is faked).
 *
 * The contract: the plan prices each clip with the figure `generate video
 * --dry-run` gives for that provider (the tier bound only when the provider
 * cannot say); the build reports what its takes recorded, so a provider's
 * charge replaces the estimate; and a job the provider failed without
 * reporting a charge costs nothing.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FAKE_GROK_TICKS, createFakeProviderNetwork, jsonResponse, type FakeProviderNetwork } from "../testing/fake-provider-network.js";
import { __setFfmpegToolsForTests } from "../commands/_shared/ffmpeg-gate.js";
import { createBuildPlan } from "../commands/_shared/build-plan.js";
import { executeSceneBuild } from "../commands/_shared/scene-build.js";
import { executeVideoGenerate } from "../commands/ai-video.js";
import { listTakes, projectTakeStore } from "./take.js";

const GROK_USD = FAKE_GROK_TICKS * 1e-10;

function storyboard(video: string, provider = "grok"): string {
  return `---
project: cost-test
providers:
  video: ${provider}
---

## Beat pond - Pond

\`\`\`yaml
duration: 5
video: "${video}"
\`\`\`
`;
}

let projectDir: string;
let net: FakeProviderNetwork;
const savedEnv = { ...process.env };

beforeEach(() => {
  __setFfmpegToolsForTests(true);
  for (const key of ["FAL_API_KEY", "KLING_API_KEY", "GOOGLE_API_KEY", "OPENAI_API_KEY"]) delete process.env[key];
  Object.assign(process.env, { XAI_API_KEY: "test-xai", RUNWAY_API_SECRET: "test-runway" });
  delete process.env.VIBE_TAKES;
  projectDir = mkdtempSync(join(tmpdir(), "vibe-build-cost-"));
  mkdirSync(join(projectDir, "compositions"), { recursive: true });
  writeFileSync(join(projectDir, "DESIGN.md"), "# Design\n");
  net = createFakeProviderNetwork();
  net.install();
});

afterEach(() => {
  net.uninstall();
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
  rmSync(projectDir, { recursive: true, force: true });
});

const takes = () => listTakes(projectTakeStore(projectDir));

describe("the build plan prices a clip as generate video --dry-run does", () => {
  it("Grok: 5 s of 720p at the model's per-second rate, not the $5 tier bound", async () => {
    writeFileSync(join(projectDir, "STORYBOARD.md"), storyboard("A paper boat drifts"));
    const plan = await createBuildPlan({ projectDir, stage: "assets" });
    expect(plan.estimatedCostUsd).toBeCloseTo(5 * 0.14, 6);
  });

  it("Runway, which gives no estimate, keeps the tier bound", async () => {
    writeFileSync(join(projectDir, "STORYBOARD.md"), storyboard("A paper boat drifts", "runway"));
    const plan = await createBuildPlan({ projectDir, stage: "assets" });
    expect(plan.estimatedCostUsd).toBe(5);
  });
});

describe("the build reports what its takes recorded", () => {
  it("a Grok clip costs what xAI reported, and the figure is billing, not an estimate", async () => {
    writeFileSync(join(projectDir, "STORYBOARD.md"), storyboard("A paper boat drifts"));
    const report = await executeSceneBuild({ projectDir, stage: "assets" });
    expect(report.success).toBe(true);

    const recorded = await takes();
    expect(recorded).toHaveLength(1);
    expect(recorded[0].cost).toMatchObject({ basis: "reported" });
    expect(report.stageReports?.assets).toMatchObject({ costEstimated: false });
    expect(report.stageReports?.assets.costUsd).toBeCloseTo(GROK_USD, 6);
    expect(report.costUsd).toBeCloseTo(GROK_USD, 6);
  });
});

describe("a failed job costs only what the provider reported", () => {
  it("Grok failed the job and reported no charge: the failed take costs $0", async () => {
    writeFileSync(join(projectDir, "STORYBOARD.md"), storyboard("A paper boat drifts"));
    net.on("GET", "api.x.ai", /^\/v1\/videos\/[^/]+$/, () =>
      jsonResponse({ status: "failed", error: { code: "content_policy", message: "Rejected" } }),
    );
    const result = await executeVideoGenerate({
      prompt: "A paper boat drifts",
      provider: "grok",
      duration: 5,
      output: join(projectDir, "boat.mp4"),
      take: { via: "cli", command: "generate video", cwd: projectDir },
    });
    expect(result.success).toBe(false);
    const [failed] = await takes();
    expect(failed).toMatchObject({ status: "failed", cost: { usd: 0, basis: "estimate" } });
  });
});
