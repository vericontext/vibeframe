import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { executeTranslateSrt } from "./translate-srt.js";

const SRT = "1\n00:00:00,000 --> 00:00:01,500\nHello world.\n";

describe("executeTranslateSrt", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "translate-srt-"));
    await writeFile(join(dir, "in.srt"), SRT);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });

  function run(provider: "claude" | "openai") {
    return executeTranslateSrt({
      srtPath: join(dir, "in.srt"),
      outputPath: join(dir, "out.srt"),
      targetLanguage: "ko",
      provider,
      apiKey: "test-key",
    });
  }

  it("calls Claude with a valid model ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: "text", text: "[0] 안녕하세요." }] }))
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(run("claude")).resolves.toMatchObject({ success: true, segmentCount: 1 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(await readFile(join(dir, "out.srt"), "utf-8")).toContain("안녕하세요.");
  });

  it("calls OpenAI without the temperature gpt-5-mini rejects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "[0] 안녕하세요." } }] }))
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(run("openai")).resolves.toMatchObject({ success: true });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe("gpt-5-mini");
    expect(body).not.toHaveProperty("temperature");
  });

  it("surfaces the provider error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response('{"error":{"message":"model: not_found"}}', {
          status: 404,
          statusText: "Not Found",
        })
      )
    );

    const result = await run("claude");
    expect(result.success).toBe(false);
    expect(result.error).toContain("404 Not Found");
    expect(result.error).toContain("model: not_found");
  });
});
