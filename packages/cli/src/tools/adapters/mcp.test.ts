import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { buildMcpDispatcher, makeProgressSink } from "./mcp.js";
import { defineTool, type AnyTool, type ExecuteContext } from "../define-tool.js";

function stubTool(execute: AnyTool["execute"]): AnyTool {
  return defineTool({
    name: "stub_tool",
    category: "scene",
    cost: "free",
    description: "test stub",
    schema: z.object({ value: z.string().optional() }),
    execute,
  }) as unknown as AnyTool;
}

describe("makeProgressSink", () => {
  it("no-ops without a raw callback", () => {
    const sink = makeProgressSink(undefined);
    expect(() => sink.send({ progress: 1 })).not.toThrow();
  });

  it("throttles updates to one per interval and lets the first through", () => {
    vi.useFakeTimers();
    try {
      const raw = vi.fn();
      const sink = makeProgressSink(raw, 1000);
      sink.send({ progress: 1 });
      sink.send({ progress: 2 });
      sink.send({ progress: 3 });
      expect(raw).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1001);
      sink.send({ progress: 4 });
      expect(raw).toHaveBeenCalledTimes(2);
      expect(raw).toHaveBeenLastCalledWith(expect.objectContaining({ progress: 4 }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("forces monotonically increasing progress", () => {
    vi.useFakeTimers();
    try {
      const raw = vi.fn();
      const sink = makeProgressSink(raw, 0);
      sink.send({ progress: 50 });
      vi.advanceTimersByTime(1);
      sink.send({ progress: 10 }); // regressing → bumped past 50
      vi.advanceTimersByTime(1);
      sink.send({}); // missing → counter advance
      const values = raw.mock.calls.map(([u]) => (u as { progress: number }).progress);
      expect(values).toHaveLength(3);
      expect(values[1]).toBeGreaterThan(values[0]);
      expect(values[2]).toBeGreaterThan(values[1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops updates after close()", () => {
    const raw = vi.fn();
    const sink = makeProgressSink(raw, 0);
    sink.send({ progress: 1 });
    sink.close();
    sink.send({ progress: 2 });
    expect(raw).toHaveBeenCalledTimes(1);
  });
});

describe("buildMcpDispatcher progress threading", () => {
  it("exposes onProgress to the tool when the call carries one", async () => {
    let seenCtx: ExecuteContext | undefined;
    const dispatcher = buildMcpDispatcher([
      stubTool(async (_args, ctx) => {
        seenCtx = ctx;
        ctx.onProgress?.({ progress: 42, total: 100, message: "halfway" });
        return { success: true, data: { ok: true } };
      }),
    ]);
    const raw = vi.fn();
    const response = await dispatcher("stub_tool", {}, { onProgress: raw });
    expect(JSON.parse(response.content[0].text)).toMatchObject({ success: true, ok: true });
    expect(seenCtx?.onProgress).toBeDefined();
    expect(raw).toHaveBeenCalledWith(
      expect.objectContaining({ progress: 42, total: 100, message: "halfway" })
    );
  });

  it("leaves onProgress undefined when the call has none (regression)", async () => {
    let seenCtx: ExecuteContext | undefined;
    const dispatcher = buildMcpDispatcher([
      stubTool(async (_args, ctx) => {
        seenCtx = ctx;
        return { success: true, data: { ok: true } };
      }),
    ]);
    const response = await dispatcher("stub_tool", {});
    expect(JSON.parse(response.content[0].text)).toMatchObject({ success: true });
    expect(seenCtx?.onProgress).toBeUndefined();
  });

  it("stops forwarding progress after the call resolves", async () => {
    let leakedProgress: ExecuteContext["onProgress"];
    const dispatcher = buildMcpDispatcher([
      stubTool(async (_args, ctx) => {
        leakedProgress = ctx.onProgress;
        return { success: true, data: {} };
      }),
    ]);
    const raw = vi.fn();
    await dispatcher("stub_tool", {}, { onProgress: raw });
    leakedProgress?.({ progress: 99 });
    expect(raw).not.toHaveBeenCalledWith(expect.objectContaining({ progress: 99 }));
  });
});
