/**
 * Review findings point at takes, over real takes, real slot metadata, and
 * the real project inspector (only `fetch` is faked).
 *
 * The contract: a beat-scoped issue names the takes filling that beat's
 * slots now; an issue about generated content names only the slots that
 * content comes from and offers the take-level fixes (edit through the
 * provider session, promote an earlier take, list the beat's takes); and
 * linking sends no provider request.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FAKE_MP4, FAKE_GROK_TICKS, createFakeProviderNetwork, jsonResponse, type FakeProviderNetwork } from "../testing/fake-provider-network.js";
import { executeVideoGenerate } from "../commands/ai-video.js";
import { inspectProject } from "../commands/_shared/scene-inspect.js";
import type { ReviewIssue, ReviewReport } from "../commands/_shared/review-report.js";
import { executeTakePromote } from "./promote.js";
import { linkReviewTakes } from "./review-links.js";

let root: string;
let project: string;
let net: FakeProviderNetwork;
const savedEnv = { ...process.env };

const videoBytes = (id: string) => Buffer.concat([FAKE_MP4, Buffer.from(id)]);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vibe-review-links-"));
  project = join(root, "film");
  mkdirSync(project, { recursive: true });
  writeFileSync(
    join(project, "STORYBOARD.md"),
    "---\nproject: t\n---\n\n## Beat pond - Pond\n\n```yaml\nduration: 4\nvideo: A paper boat drifts\n```\n",
  );
  Object.assign(process.env, { XAI_API_KEY: "test-xai" });
  delete process.env.VIBE_TAKES;
  net = createFakeProviderNetwork();
  net.on("GET", "api.x.ai", /^\/v1\/videos\/[^/]+$/, (req) => {
    const id = req.path.split("/").at(-1)!;
    return jsonResponse({
      status: "done",
      model: "grok-imagine-video",
      video: { url: `https://fake.media/${id}.mp4`, duration: 5 },
      usage: { cost_in_usd_ticks: FAKE_GROK_TICKS },
    });
  });
  net.on("GET", "fake.media", /^\/[^/]+\.mp4$/, (req) => new Response(new Uint8Array(videoBytes(req.path.slice(1, -4)))));
  net.install();
});

afterEach(() => {
  net.uninstall();
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

async function grokTakeForPond(name: string): Promise<string> {
  const result = await executeVideoGenerate({
    prompt: "A paper boat drifts",
    provider: "grok",
    duration: 5,
    output: join(project, "renders", `${name}.mp4`),
    take: { via: "cli", command: "generate video", cwd: project, beatId: "pond", asset: "video" },
  });
  expect(result.takeId).toBeDefined();
  return result.takeId!;
}

/** Two Grok takes for the pond video slot; the newer fills it. */
async function twoTakesNewerInSlot(): Promise<{ older: string; newer: string }> {
  const older = await grokTakeForPond("first");
  const newer = await grokTakeForPond("second");
  const promoted = await executeTakePromote({ takeId: newer, cwd: project });
  if (!promoted.success) throw new Error(promoted.error);
  return { older, newer };
}

const issue = (code: string, beatId?: string): ReviewIssue => ({
  severity: "warning",
  code,
  message: code,
  ...(beatId ? { beatId, scene: beatId } : {}),
});

describe("review findings point at takes", () => {
  it("a content issue names the take in the slot and offers edit, promote, and list", async () => {
    const { older, newer } = await twoTakesNewerInSlot();
    const before = net.requests.length;

    const [linked] = await linkReviewTakes(project, [issue("STATIC_FRAME_SEGMENT", "pond")]);

    expect(net.requests.length).toBe(before);
    expect(linked.takes).toEqual([
      {
        takeId: newer,
        asset: "video",
        kind: "video",
        provider: "grok",
        model: expect.any(String),
        promoted: true,
        continuations: ["extend", "edit"],
        alternatives: [older],
      },
    ]);
    const byCommand = new Map((linked.actions ?? []).map((action) => [action.command, action]));
    expect(byCommand.get(`vibe take edit ${newer} --project ${project} --prompt "<the change>" --dry-run --json`)).toMatchObject({
      costTier: "very-high",
      fixOwner: "host-agent",
      safeToAutoRun: false,
      requiresConfirmation: true,
    });
    expect(byCommand.get(`vibe take promote ${older} --project ${project} --dry-run --json`)).toMatchObject({
      costTier: "free",
      safeToAutoRun: true,
    });
    expect(byCommand.get(`vibe take list --project ${project} --beat pond --json`)).toMatchObject({
      costTier: "free",
      safeToAutoRun: true,
    });
  });

  it("a content issue names only the slots its content comes from", async () => {
    await twoTakesNewerInSlot();
    const silence = issue("LONG_SILENCE", "pond");
    const [linked] = await linkReviewTakes(project, [silence]);
    // The beat has no narration or music take, so a silence finding points at nothing.
    expect(linked).toBe(silence);
  });

  it("another beat issue names the beat's takes as provenance, with no take fixes", async () => {
    const { newer } = await twoTakesNewerInSlot();
    const [linked, elsewhere, unscoped] = await linkReviewTakes(project, [
      issue("MISSING_COMPOSITION", "pond"),
      issue("MISSING_COMPOSITION", "shore"),
      issue("MISSING_DESIGN"),
    ]);
    expect(linked.takes?.map((take) => take.takeId)).toEqual([newer]);
    expect(linked.actions).toBeUndefined();
    expect(elsewhere.takes).toBeUndefined();
    expect(unscoped.takes).toBeUndefined();
  });

  it("vibe inspect project writes the take links into the review report", async () => {
    const { newer } = await twoTakesNewerInSlot();
    const before = net.requests.length;

    const result = await inspectProject({ projectDir: project });

    expect(net.requests.length).toBe(before);
    const pondIssues = result.issues.filter((i) => i.beatId === "pond");
    expect(pondIssues.length).toBeGreaterThan(0);
    for (const i of pondIssues) expect(i.takes?.map((take) => take.takeId)).toEqual([newer]);
    const report = JSON.parse(readFileSync(join(project, "review-report.json"), "utf-8")) as ReviewReport;
    expect(report.issues.filter((i) => i.beatId === "pond").every((i) => i.takes?.[0]?.takeId === newer)).toBe(true);
  });

  it("a project with no takes reviews exactly as before", async () => {
    const issues = [issue("STATIC_FRAME_SEGMENT", "pond")];
    expect(await linkReviewTakes(project, issues)).toBe(issues);
  });
});
