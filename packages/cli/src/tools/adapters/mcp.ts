/**
 * @module adapters/mcp
 * @description Adapter from manifest entries to MCP server tool array +
 * dispatcher. Consumed by `packages/mcp-server/src/tools/index.ts`.
 */

import type { ZodError } from "zod";
import { zodToJsonSchema, type JsonSchema } from "../zod-to-json-schema.js";
import type { ToolDefinition } from "../define-tool.js";

/**
 * Top-level MCP tool inputSchema. We always emit `{ type:"object", properties,
 * required }` at the root, so unlike the generic `JsonSchema` (which has
 * optional `properties`/`required` for leaf nodes), the top-level shape's
 * `properties` is required.
 */
export interface McpInputSchema {
  type: "object";
  properties: Record<string, JsonSchema>;
  required: string[];
  description?: string;
}

/** MCP spec ToolAnnotations — safety hints surfaced to hosts. */
export interface McpToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint: boolean;
}

export interface McpTool {
  name: string;
  /** Human-readable display name (MCP BaseMetadata.title). */
  title: string;
  description: string;
  inputSchema: McpInputSchema;
  annotations: McpToolAnnotations;
}

/**
 * Structural mirror of the MCP elicitation form request/result (the CLI
 * package deliberately has no dependency on @modelcontextprotocol/sdk).
 * `requestedSchema.properties` values follow the spec's flat primitive
 * schema: string (optionally with enum/enumNames), number, boolean.
 */
export interface ElicitForm {
  message: string;
  requestedSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ElicitOutcome {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, string | number | boolean | string[]>;
}

export type ElicitFn = (form: ElicitForm) => Promise<ElicitOutcome>;

/** Per-call extras forwarded by the MCP server request handler. */
export interface McpCallExtra {
  /**
   * Raw progress sink — typically sends an MCP `notifications/progress` for
   * the request's progressToken. The dispatcher wraps it with throttling,
   * monotonicity, and post-completion cutoff before exposing it to tools.
   */
  onProgress?: (update: { progress: number; total?: number; message?: string }) => void;
  /**
   * Sends an `elicitation/create` form to the client and resolves with the
   * user's answer. Only present when the connected client advertises the
   * elicitation capability.
   */
  elicit?: ElicitFn;
}

export type McpDispatcher = (
  name: string,
  args: Record<string, unknown>,
  extra?: McpCallExtra,
) => Promise<{ content: Array<{ type: "text"; text: string }> }>;

type StdoutWrite = typeof process.stdout.write;

function formatConsolePart(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function invokeWriteCallback(encodingOrCallback?: unknown, callback?: unknown): void {
  const cb = typeof encodingOrCallback === "function"
    ? encodingOrCallback
    : typeof callback === "function"
      ? callback
      : undefined;
  if (cb) queueMicrotask(() => (cb as () => void)());
}

function formatStdoutChunk(chunk: unknown, encodingOrCallback?: unknown): string {
  if (Buffer.isBuffer(chunk)) {
    const encoding = typeof encodingOrCallback === "string"
      ? encodingOrCallback as BufferEncoding
      : "utf8";
    return chunk.toString(encoding);
  }
  return String(chunk);
}

async function withCapturedStdout<T>(fn: () => Promise<T>): Promise<T> {
  const originalWrite = process.stdout.write;
  const originalConsoleLog = console.log;
  const originalConsoleInfo = console.info;
  const originalConsoleDebug = console.debug;
  let captured = "";
  const captureConsole = (...values: unknown[]) => {
    captured += `${values.map(formatConsolePart).join(" ")}\n`;
  };

  process.stdout.write = ((chunk: unknown, encodingOrCallback?: unknown, callback?: unknown) => {
    const text = formatStdoutChunk(chunk, encodingOrCallback);
    // The stdio transport itself writes through process.stdout during tool
    // execution (e.g. notifications/progress for the in-flight request).
    // Those protocol frames must pass through — capturing them silently
    // drops the notification. The SDK serializes the envelope with the
    // jsonrpc key in spread position (often LAST), so check for the
    // member anywhere in an object-shaped chunk; stray tool/renderer logs
    // never contain a JSON-RPC envelope member.
    if (text.startsWith("{") && text.includes('"jsonrpc":"2.0"')) {
      return originalWrite.call(
        process.stdout,
        chunk as string | Uint8Array,
        encodingOrCallback as BufferEncoding,
        callback as (err?: Error | null) => void
      );
    }
    captured += text;
    invokeWriteCallback(encodingOrCallback, callback);
    return true;
  }) as StdoutWrite;
  console.log = captureConsole;
  console.info = captureConsole;
  console.debug = captureConsole;

  try {
    return await fn();
  } finally {
    process.stdout.write = originalWrite;
    console.log = originalConsoleLog;
    console.info = originalConsoleInfo;
    console.debug = originalConsoleDebug;
    if (captured.trim() && process.env.VIBE_MCP_DEBUG_STDIO === "1") {
      process.stderr.write(captured);
    }
  }
}

export interface ProgressSink {
  send: (update: { progress?: number; total?: number; message?: string }) => void;
  close: () => void;
}

/**
 * Wrap a raw progress callback with the guarantees the MCP spec expects:
 * `progress` increases monotonically per token, updates are throttled to at
 * most one per `minIntervalMs` (the first always passes), and nothing is
 * emitted after `close()` — progress notifications must stop once the
 * request's result has been sent.
 */
export function makeProgressSink(
  raw: McpCallExtra["onProgress"],
  minIntervalMs = 1000
): ProgressSink {
  if (!raw) {
    return { send: () => undefined, close: () => undefined };
  }
  let closed = false;
  let lastSentAt = 0;
  let lastProgress = 0;
  return {
    send: (update) => {
      if (closed) return;
      const now = Date.now();
      if (lastSentAt !== 0 && now - lastSentAt < minIntervalMs) return;
      lastSentAt = now;
      const progress =
        update.progress !== undefined && update.progress > lastProgress
          ? update.progress
          : lastProgress + 1;
      lastProgress = progress;
      raw({
        progress,
        ...(update.total !== undefined ? { total: update.total } : {}),
        ...(update.message ? { message: update.message } : {}),
      });
    },
    close: () => {
      closed = true;
    },
  };
}

function formatZodError(err: ZodError): string {
  // Surface "this required field is missing/null/undefined" as the legacy
  // "missing required argument" phrasing so existing MCP-host integrations
  // that match on that string keep working. Zod issues this with two
  // shapes:
  //   - {code: "invalid_type", message: "Required", received: "undefined"}
  //   - {code: "invalid_type", message: "Expected …, received null", received: "null"}
  const missing = err.issues
    .filter((i) => {
      if (i.code !== "invalid_type") return false;
      // ZodIssue's `received` field is typed `unknown` here.
      const received = (i as unknown as { received?: string }).received;
      return received === "undefined" || received === "null";
    })
    .map((i) => i.path.join("."))
    .filter(Boolean);
  if (missing.length > 0) {
    const plural = missing.length > 1 ? "s" : "";
    return `missing required argument${plural}: ${missing.join(", ")}`;
  }
  return err.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

/** Filter manifest by `surfaces.mcp` (default: included) and project to MCP tool shape. */
export function manifestToMcpTools(manifest: readonly ToolDefinition[]): McpTool[] {
  return manifest
    .filter((t) => !t.surfaces || t.surfaces.includes("mcp"))
    .map((t) => {
      const inputSchema = zodToJsonSchema(t.schema);
      // zodToJsonSchema always emits properties/required for top-level
      // ZodObject (validated by zod-to-json-schema's convertObject); narrow
      // the type for MCP consumers.
      return {
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: {
          type: "object" as const,
          properties: inputSchema.properties ?? {},
          required: inputSchema.required ?? [],
          ...(inputSchema.description ? { description: inputSchema.description } : {}),
        },
        annotations: toMcpAnnotations(t.annotations),
      };
    });
}

/**
 * Projects the manifest's declarative annotations onto the MCP wire shape.
 * destructiveHint defaults to true for non-read-only tools (spec default,
 * stated explicitly because the extension directory requires it); the
 * openWorldHint is always explicit because the spec default of true would
 * mislabel local-only ffmpeg/filesystem tools.
 */
function toMcpAnnotations(a: ToolDefinition["annotations"]): McpToolAnnotations {
  if (a.readOnly) {
    return { readOnlyHint: true, openWorldHint: a.openWorld };
  }
  return {
    readOnlyHint: false,
    destructiveHint: a.destructive ?? true,
    ...(a.idempotent !== undefined ? { idempotentHint: a.idempotent } : {}),
    openWorldHint: a.openWorld,
  };
}

/** Build the dispatcher used by `handleToolCall` in the MCP server. */
export function buildMcpDispatcher(manifest: readonly ToolDefinition[]): McpDispatcher {
  const byName = new Map<string, ToolDefinition>();
  for (const t of manifest) {
    if (!t.surfaces || t.surfaces.includes("mcp")) {
      byName.set(t.name, t);
    }
  }

  return async (name, args, extra) => {
    const tool = byName.get(name);
    if (!tool) {
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }
    const parsed = tool.schema.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{ type: "text", text: `${name} failed: ${formatZodError(parsed.error)}` }],
      };
    }
    const sink = makeProgressSink(extra?.onProgress);
    try {
      const result = await withCapturedStdout(() =>
        tool.execute(parsed.data, {
          workingDirectory: process.cwd(),
          surface: "mcp",
          ...(extra?.onProgress ? { onProgress: sink.send } : {}),
          ...(extra?.elicit ? { elicit: extra.elicit } : {}),
        })
      );
      const text = result.success
        ? JSON.stringify({ success: true, ...result.data })
        : result.data
          ? JSON.stringify({
              success: false,
              error: result.error ?? "unknown error",
              ...result.data,
            })
          : `${name} failed: ${result.error ?? "unknown error"}`;
      return { content: [{ type: "text", text }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `${name} threw: ${msg}` }] };
    } finally {
      // Progress notifications must stop once the result is sent — this also
      // covers promoted (backgrounded) work that keeps reporting afterwards.
      sink.close();
    }
  };
}
