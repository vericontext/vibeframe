/**
 * Unit tests for the cross-platform URL opener.
 *
 * We test `resolveOpener` (pure) directly. The actual `openUrl` invokes
 * `child_process.spawn` and is verified by mocking the spawn function.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { resolveOpener } from "./open-url.js";

describe("resolveOpener", () => {
  const originalPlatform = process.platform;

  function setPlatform(p: NodeJS.Platform): void {
    Object.defineProperty(process, "platform", { value: p, configurable: true });
  }

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });

  it("returns `open` on darwin", () => {
    setPlatform("darwin");
    const r = resolveOpener("https://example.com");
    expect(r.command).toBe("open");
    expect(r.args).toEqual(["https://example.com"]);
  });

  it("returns `xdg-open` on linux", () => {
    setPlatform("linux");
    const r = resolveOpener("https://example.com/foo");
    expect(r.command).toBe("xdg-open");
    expect(r.args).toEqual(["https://example.com/foo"]);
  });

  it("returns `xdg-open` on freebsd / openbsd", () => {
    setPlatform("freebsd");
    expect(resolveOpener("u").command).toBe("xdg-open");
    setPlatform("openbsd");
    expect(resolveOpener("u").command).toBe("xdg-open");
  });

  it("returns `cmd /c start` on win32, with the empty title argument", () => {
    setPlatform("win32");
    const r = resolveOpener("https://example.com");
    expect(r.command).toBe("cmd");
    // The empty "" before the URL is required so Windows doesn't treat the
    // URL as a window title for `start`.
    expect(r.args).toEqual(["/c", "start", "", "https://example.com"]);
  });

  it("returns command=null on unknown platforms (caller skips spawn)", () => {
    setPlatform("aix" as NodeJS.Platform);
    const r = resolveOpener("https://example.com");
    expect(r.command).toBeNull();
    expect(r.args).toEqual([]);
  });

  it("passes the URL as a single arg (no shell interpretation)", () => {
    setPlatform("darwin");
    // Even URLs with characters that would be dangerous in a shell are passed
    // through verbatim because spawn is invoked with shell:false.
    const r = resolveOpener("https://example.com/?x=1&y=$(rm -rf /)");
    expect(r.args).toHaveLength(1);
    expect(r.args[0]).toContain("$(rm -rf /)");
  });
});

describe("openUrl", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("spawns the resolved command with detached + ignored stdio + shell:false", async () => {
    const onMock = vi.fn();
    const unrefMock = vi.fn();
    const spawnMock = vi.fn(() => ({ on: onMock, unref: unrefMock }));

    vi.doMock("node:child_process", () => ({ spawn: spawnMock }));
    vi.doMock("node:os", () => ({ platform: () => "darwin" }));

    const { openUrl } = await import("./open-url.js");
    await openUrl("https://example.com");

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawnMock.mock.calls[0] as [string, string[], { detached?: boolean; stdio?: string; shell?: boolean }];
    expect(cmd).toBe("open");
    expect(args).toEqual(["https://example.com"]);
    expect(opts.detached).toBe(true);
    expect(opts.stdio).toBe("ignore");
    expect(opts.shell).toBe(false);
    expect(unrefMock).toHaveBeenCalledTimes(1);
  });

  it("is silent when the platform has no opener", async () => {
    const spawnMock = vi.fn();
    vi.doMock("node:child_process", () => ({ spawn: spawnMock }));
    vi.doMock("node:os", () => ({ platform: () => "aix" }));

    const { openUrl } = await import("./open-url.js");
    await expect(openUrl("https://example.com")).resolves.toBeUndefined();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("swallows synchronous spawn errors", async () => {
    const spawnMock = vi.fn(() => {
      throw new Error("EACCES");
    });
    vi.doMock("node:child_process", () => ({ spawn: spawnMock }));
    vi.doMock("node:os", () => ({ platform: () => "darwin" }));

    const { openUrl } = await import("./open-url.js");
    await expect(openUrl("https://example.com")).resolves.toBeUndefined();
  });
});
