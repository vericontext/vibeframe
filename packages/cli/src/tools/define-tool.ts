/**
 * @module define-tool
 * @description Single source of truth DSL for VibeFrame tool definitions.
 *
 * Each tool is declared once via `defineTool({...})` with a Zod schema, an
 * `execute` function, and metadata. The MCP server (`packages/mcp-server`)
 * and the in-process Agent (`packages/cli/src/agent/tools`) both consume the
 * manifest via thin adapters — no tool definition is ever duplicated across
 * surfaces.
 *
 * The CLI Commander tree (`packages/cli/src/commands/*.ts`) is intentionally
 * left hand-written. Its short flags, `--no-foo` negations, variadic args,
 * and custom validators don't fit cleanly into a metadata sidecar. The
 * Commander chains call the same `executeXxx` engine functions that the
 * manifest entries call, so the CLI stays in sync via the existing
 * `cli-sync.test.ts` invariant.
 *
 * See `/Users/kiyeonjeon/.claude/plans/logical-wibbling-sonnet.md` for the
 * full v0.65 migration plan.
 */

import { z, type ZodTypeAny } from "zod";
import {
  productSurfaceForToolName,
  type ProductSurface,
} from "../commands/_shared/product-surface.js";

export type CostTier = "free" | "low" | "medium" | "high" | "very-high";
export type Surface = "mcp" | "agent";

export interface ExecuteContext {
  /** Resolves relative paths in tool args (`process.cwd()` for MCP/CLI; `AgentContext.workingDirectory` for Agent). */
  workingDirectory: string;
  /** The surface invoking the tool. Lets executes branch on JSON vs human output if needed. */
  surface: "cli" | Surface;
  /**
   * Agent-only mutable state. Populated when invoked via the in-process agent
   * REPL; `undefined` for MCP/CLI. Tools that read or set the "current
   * project" pointer (e.g. project_open/project_save) declare
   * `surfaces: ["agent"]` and access this via `ctx.agent?`.
   */
  agent?: {
    projectPath: string | null;
    setProjectPath(path: string): void;
  };
  /**
   * Optional progress sink. The MCP adapter wires this to MCP
   * `notifications/progress` when the client supplied a progressToken;
   * CLI/Agent surfaces leave it undefined. Omitting `progress` advances an
   * internal monotonic counter; the adapter also throttles and enforces
   * monotonicity defensively.
   */
  onProgress?: (update: { progress?: number; total?: number; message?: string }) => void;
  /**
   * Optional MCP elicitation channel. Present only when the connected MCP
   * client advertises the elicitation capability; CLI/Agent surfaces leave
   * it undefined, so CLI behavior never changes. See adapters/mcp.ts for
   * the structural types.
   */
  elicit?: (form: {
    message: string;
    requestedSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  }) => Promise<{
    action: "accept" | "decline" | "cancel";
    content?: Record<string, string | number | boolean | string[]>;
  }>;
}

export interface ToolExecuteResult {
  success: boolean;
  /** JSON-stringifiable payload. MCP returns `JSON.stringify(data)`; Agent uses humanLines first, falls back to data. */
  data?: Record<string, unknown>;
  /** Human-readable lines for Agent REPL output. Optional — adapter falls back to JSON if absent. */
  humanLines?: readonly string[];
  error?: string;
}

export interface ToolDefinition<S extends ZodTypeAny = ZodTypeAny> {
  /** snake_case canonical name (used by MCP `tools/list` and Agent registry). */
  name: string;
  /** Group this tool belongs to ("scene" | "audio" | "edit" | …). Drives skill regen + sync-counts. */
  category: string;
  /** Cost tier from `.claude/rules/architecture.md` cost table. */
  cost: CostTier;
  /** Product-facing command classification. Transport surfaces use `surfaces`. */
  productSurface?: ProductSurface;
  /** Preferred replacement when `productSurface` is legacy. */
  replacement?: string;
  /** Short explanation for product-surface routing. */
  note?: string;
  /**
   * Human-readable display name shown by MCP hosts, e.g. "Add Clip to
   * Timeline". Required by the Anthropic extension directory.
   */
  title: string;
  /**
   * MCP safety annotations (directory requirement: every tool declares
   * readOnlyHint or destructiveHint).
   * - `readOnly: true` — the tool never modifies files or project state.
   * - `readOnly: false` — the tool writes; `destructive` defaults to true
   *   (may overwrite/modify existing data), set false for purely additive
   *   tools; `idempotent: true` when re-running with identical args has no
   *   additional effect.
   * - `openWorld` — true when the tool calls external provider APIs; false
   *   for purely local work (ffmpeg, filesystem). Always stated explicitly
   *   because the MCP spec default is true.
   */
  annotations:
    | { readOnly: true; openWorld: boolean }
    | { readOnly: false; destructive?: boolean; idempotent?: boolean; openWorld: boolean };
  /** Identical for MCP description and Agent description. One paragraph. */
  description: string;
  /** Single source of truth for argument shape. Must be a `z.object({...})`. */
  schema: S;
  /** Surfaces the tool lives on. Defaults to `["mcp", "agent"]` when omitted. */
  surfaces?: readonly Surface[];
  /** Engine fn. Receives Zod-validated args. */
  execute: (args: z.infer<S>, ctx: ExecuteContext) => Promise<ToolExecuteResult>;
}

/**
 * Type erasure helper for collecting tools into the manifest array.
 *
 * `ToolDefinition` is generic over the Zod schema type, so a heterogeneous
 * array of tools each with different schemas can't directly satisfy
 * `ToolDefinition<ZodTypeAny>[]` (Zod's generic is invariant). At the
 * manifest aggregation boundary we cast individual tools to this erased
 * shape — the adapters use `tool.schema.safeParse()` which doesn't need the
 * narrow type.
 */
export type AnyTool = ToolDefinition<ZodTypeAny>;

const NAME_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

function validateToolDefinition<S extends ZodTypeAny>(t: ToolDefinition<S>): void {
  if (!NAME_PATTERN.test(t.name)) {
    throw new Error(
      `Tool name "${t.name}" must be snake_case (matches /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/)`
    );
  }
  if (!t.category || !/^[a-z-]+$/.test(t.category)) {
    throw new Error(
      `Tool "${t.name}" has invalid category "${t.category}" (must be lowercase, dash-separated)`
    );
  }
  // Schema must be a ZodObject so we can derive {properties, required}. We
  // accept any ZodTypeAny in the type sig for ergonomics, then runtime-check.
  const schemaTypeName = (t.schema as { _def?: { typeName?: string } })._def?.typeName;
  if (schemaTypeName !== "ZodObject") {
    throw new Error(`Tool "${t.name}" schema must be a z.object({...}); got ${schemaTypeName}`);
  }
  if (t.surfaces && t.surfaces.length === 0) {
    throw new Error(
      `Tool "${t.name}" has empty surfaces array; use [] only via explicit type override`
    );
  }
}

export function defineTool<S extends ZodTypeAny>(t: ToolDefinition<S>): ToolDefinition<S> {
  validateToolDefinition(t);
  const surface = productSurfaceForToolName(t.name);
  return {
    ...t,
    productSurface: t.productSurface ?? surface.surface,
    replacement: t.replacement ?? surface.replacement,
    note: t.note ?? surface.note,
  };
}
