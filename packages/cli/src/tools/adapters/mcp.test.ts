import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { buildMcpDispatcher, makeProgressSink, manifestToMcpTools } from "./mcp.js";
import { defineTool, type AnyTool, type ExecuteContext } from "../define-tool.js";

describe("manifestToMcpTools annotations projection", () => {
  const base = {
    category: "scene",
    cost: "free" as const,
    description: "test",
    schema: z.object({}),
    execute: async () => ({ success: true as const }),
  };

  it("projects readOnly tools as readOnlyHint without destructiveHint", () => {
    const [tool] = manifestToMcpTools([
      defineTool({
        ...base,
        name: "ro_tool",
        title: "Read-Only Tool",
        annotations: { readOnly: true, openWorld: true },
      }) as unknown as AnyTool,
    ]);
    expect(tool.title).toBe("Read-Only Tool");
    expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true });
  });

  it("projects writers with explicit destructive/idempotent hints", () => {
    const [tool] = manifestToMcpTools([
      defineTool({
        ...base,
        name: "writer_tool",
        title: "Writer Tool",
        annotations: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
      }) as unknown as AnyTool,
    ]);
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("defaults destructiveHint to true for writers", () => {
    const [tool] = manifestToMcpTools([
      defineTool({
        ...base,
        name: "default_writer",
        title: "Default Writer",
        annotations: { readOnly: false, openWorld: true },
      }) as unknown as AnyTool,
    ]);
    expect(tool.annotations.destructiveHint).toBe(true);
    expect(tool.annotations.idempotentHint).toBeUndefined();
  });
});

function stubTool(execute: AnyTool["execute"]): AnyTool {
  return defineTool({
    name: "stub_tool",
    category: "scene",
    cost: "free",
    title: "Stub Tool",
    annotations: { readOnly: true, openWorld: false },
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

  it("passes JSON-RPC frames through the stdout capture but swallows plain logs", async () => {
    const dispatcher = buildMcpDispatcher([
      stubTool(async () => {
        // Simulates the stdio transport emitting a notification mid-call
        // (the SDK serializes the jsonrpc member in spread position, i.e.
        // often last) alongside a stray renderer log.
        process.stdout.write('{"method":"notifications/progress","params":{},"jsonrpc":"2.0"}\n');
        process.stdout.write("stray renderer log\n");
        return { success: true, data: {} };
      }),
    ]);
    const writes: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await dispatcher("stub_tool", {});
    } finally {
      process.stdout.write = originalWrite;
    }
    expect(writes.some((w) => w.includes('"jsonrpc":"2.0"'))).toBe(true);
    expect(writes.some((w) => w.includes("stray renderer log"))).toBe(false);
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
