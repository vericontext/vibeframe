import { afterEach, describe, expect, it, vi } from "vitest";

const execSafe = vi.fn();
vi.mock("./exec-safe.js", () => ({
  execSafe,
  execSafeSync: vi.fn(),
  commandExists: vi.fn(),
  ffprobeDuration: vi.fn(),
  ffprobeVideoSize: vi.fn(),
}));

const { ensureRemotionInstalled } = await import("./remotion.js");

describe("ensureRemotionInstalled", () => {
  afterEach(() => {
    execSafe.mockReset();
  });

  it("only requires npm, since renders install a project-local Remotion CLI", async () => {
    execSafe.mockResolvedValue({ stdout: "10.9.0", stderr: "" });
    await expect(ensureRemotionInstalled()).resolves.toBeNull();
    expect(execSafe).toHaveBeenCalledWith("npm", ["--version"], expect.anything());
    expect(execSafe).not.toHaveBeenCalledWith("npx", expect.anything(), expect.anything());
  });

  it("explains how to get npm when it is missing", async () => {
    execSafe.mockRejectedValue(new Error("spawn npm ENOENT"));
    await expect(ensureRemotionInstalled()).resolves.toMatch(/install Node\.js 20\+/);
  });
});
