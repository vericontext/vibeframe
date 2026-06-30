import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = `node ${resolve(here, "../../dist/index.js")}`;

// Hermetic: no dev .env / user config leaks (mirrors envelope-snapshots.test.ts).
const HERMETIC_ENV = { PATH: process.env.PATH ?? "", HOME: "/tmp/vibeframe-test-home" };

function runCli(args: string): string {
  return execSync(`${CLI} ${args}`, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    env: HERMETIC_ENV,
    cwd: "/tmp",
  });
}

describe("vibe preview", () => {
  it("defaults to the cheap draft levers (fps 24 / quality draft) and a stable preview.mp4", () => {
    const out = runCli("preview my-video --dry-run --json");
    const parsed = JSON.parse(out);
    expect(parsed.dryRun).toBe(true);
    const params = parsed.data.params;
    expect(params.fps).toBe(24);
    expect(params.quality).toBe("draft");
    expect(params.output).toBe("preview.mp4");
    expect(params.format).toBe("mp4");
  });

  it("keeps the cheap defaults overridable (explicit --fps / --quality win)", () => {
    const out = runCli("preview my-video --fps 30 --quality standard --dry-run --json");
    const params = JSON.parse(out).data.params;
    expect(params.fps).toBe(30);
    expect(params.quality).toBe("standard");
  });

  it("rejects an out-of-range fps with a usage error", () => {
    expect(() => runCli("preview my-video --fps 99 --dry-run --json")).toThrow();
  });

  it("is registered as a top-level public command in `schema --list`", () => {
    const list = JSON.parse(runCli("schema --list")) as Array<{ path: string; surface: string }>;
    const entry = list.find((e) => e.path === "preview");
    expect(entry).toBeDefined();
    expect(entry?.surface).toBe("public");
  });
});
