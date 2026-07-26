import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function runVibe(args: string[]): string {
  try {
    return execFileSync("pnpm", ["-s", "vibe", ...args], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        CI: "true",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const failed = error as { stdout?: Buffer | string; stderr?: Buffer | string };
    const stdout = failed.stdout ? String(failed.stdout) : "";
    const stderr = failed.stderr ? String(failed.stderr) : "";
    throw new Error(
      `vibe ${args.join(" ")} failed\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`.trim()
    );
  }
}

function runJson(args: string[]): unknown {
  const out = runVibe(args);
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`vibe ${args.join(" ")} did not return JSON:\n${out}`);
  }
}

function dataOf<T = Record<string, unknown>>(value: unknown): T {
  if (value && typeof value === "object" && "data" in value) {
    return (value as { data: T }).data;
  }
  return value as T;
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  assert.equal(typeof value, "object", `${label} should be an object`);
  assert.notEqual(value, null, `${label} should not be null`);
}

const tmp = await mkdtemp(join(tmpdir(), "vibe-dogfood-smoke-"));

try {
  // Root help groups commands by use case. `renderCommandGroups` parks any
  // command no group claims under "Other" so it can never vanish; this
  // asserts the real tree never needs that fallback. It also guards the
  // Commander 12 `visibleCommands` override, which suppresses the flat
  // alphabetical block for the root only - subcommands must keep theirs.
  const rootHelp = runVibe(["--help"]);
  for (const heading of ["Project video", "One-off media", "Agents & setup"]) {
    assert.match(rootHelp, new RegExp(`^${heading}$`, "m"), `root help should group "${heading}"`);
  }
  assert.doesNotMatch(rootHelp, /^Other$/m, "every top-level command should belong to a group");
  assert.doesNotMatch(rootHelp, /^Commands:$/m, "root help should not print the flat list too");
  assert.match(runVibe(["generate", "--help"]), /^Commands:$/m, "subcommands keep their listing");

  const context = runJson(["context", "--json"]);
  assertRecord(context, "context");
  assert.equal(context.product, "vibeframe");
  assert.match(String(context.publicFlow), /vibe init --from/);

  const schema = runJson(["schema", "--list", "--surface", "public", "--json"]);
  assert.ok(Array.isArray(schema), "public schema should be an array");
  const schemaPaths = schema.map((entry) => String((entry as { path?: unknown }).path));
  assert.ok(schemaPaths.includes("build"), "public schema should include build");
  assert.ok(
    schemaPaths.includes("storyboard.validate"),
    "public schema should include storyboard.validate"
  );
  assert.ok(!schemaPaths.includes("generate.speech"), "public schema should exclude legacy aliases");

  const project = join(tmp, "dogfood-project");
  dataOf(
    runJson([
      "init",
      project,
      "--from",
      "A concise CLI dogfood video about validating before provider spend.",
      "--duration",
      "6",
      "--json",
    ])
  );
  assert.ok(existsSync(join(project, "STORYBOARD.md")), "init should write STORYBOARD.md");
  assert.ok(existsSync(join(project, "DESIGN.md")), "init should write DESIGN.md");
  assert.ok(existsSync(join(project, "vibe.config.json")), "init should write vibe.config.json");

  // `init --from` rewrites the starter bundle with the draft. A duration
  // long enough for a 4-beat draft makes the draft's scene set differ from
  // the 3-scene starter, which is exactly the case where leftover starter
  // files used to survive (two files both numbered 03). The short-duration
  // init above cannot catch that: its draft ids match the starter's.
  const fourBeat = join(tmp, "dogfood-four-beat");
  dataOf(
    runJson([
      "init",
      fourBeat,
      "--from",
      "A 20-second four-scene product film to exercise the draft rewrite.",
      "--duration",
      "20",
      "--json",
    ])
  );
  const sceneFiles = (await readdir(join(fourBeat, "scenes"))).filter((f) => f.endsWith(".md")).sort();
  const prefixes = sceneFiles.map((f) => f.split("-")[0]);
  assert.equal(
    new Set(prefixes).size,
    prefixes.length,
    `scene filename prefixes must be unique, got: ${sceneFiles.join(", ")}`
  );
  assert.ok(sceneFiles.length >= 4, `4-beat draft should yield 4 scenes, got: ${sceneFiles.join(", ")}`);

  const validation = dataOf(runJson(["storyboard", "validate", project, "--json"]));
  assertRecord(validation, "storyboard validation");
  assert.equal(validation.ok, true);

  const plan = dataOf(runJson(["plan", project, "--json"]));
  assertRecord(plan, "plan");
  assert.equal(plan.kind, "build-plan");
  assert.equal(plan.schemaVersion, "1");
  assertRecord(plan.summary, "plan.summary");

  const dryRun = dataOf(
    runJson([
      "build",
      project,
      "--dry-run",
      "--mode",
      "agent",
      "--skip-narration",
      "--skip-backdrop",
      "--skip-video",
      "--skip-music",
      "--json",
    ])
  );
  assertRecord(dryRun, "build dry-run");
  assertRecord(dryRun.plan, "build dry-run plan");
  assert.equal((dryRun.plan as Record<string, unknown>).kind, "build-plan");
  assert.equal(
    ((dryRun.plan as Record<string, unknown>).validation as { ok?: unknown }).ok,
    true
  );

  const status = dataOf(runJson(["status", "project", project, "--json"]));
  assertRecord(status, "project status");
  assert.equal(status.kind, "project");
  assert.equal(status.schemaVersion, "1");

  console.log("dogfood smoke passed");
} finally {
  await rm(tmp, { recursive: true, force: true });
}
