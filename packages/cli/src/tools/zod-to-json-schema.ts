/**
 * @module zod-to-json-schema
 * @description Vendored Zod → JSON Schema converter. Supports the subset of
 * Zod the VibeFrame manifest uses (object, string, number, boolean, enum,
 * optional, default, array, literal).
 *
 * Why vendored instead of npm `zod-to-json-schema`:
 * - We don't need refs/$ref/nested defs. All manifest schemas are flat.
 * - The MCP SDK's `inputSchema` field expects a specific JSON Schema subset
 *   (`{ type: "object", properties, required }`); the npm package emits
 *   $schema/dialect URLs that some MCP hosts mishandle.
 * - The Agent's `parameters` field is structurally identical to MCP's
 *   `inputSchema` (see `packages/cli/src/agent/types.ts`); one converter
 *   serves both adapters.
 * - 150 lines we can debug.
 *
 * Coverage gaps (intentional):
 * - z.union, z.discriminatedUnion: not used by any current tool.
 * - z.record, z.map, z.tuple, z.intersection: not used.
 * - z.nullable: not used (we use .optional() everywhere).
 * - z.transform/preprocess: pre-applied by Zod parse; output schema is the
 *   "input" view, which is what MCP/Agent need.
 *
 * If a manifest entry needs an unsupported feature, this converter throws
 * loudly so the gap is visible at registration time, not at runtime.
 */

import type { ZodTypeAny } from "zod";

export interface JsonSchema {
  type: "object" | "string" | "number" | "boolean" | "array";
  description?: string;
  enum?: readonly (string | number)[];
  default?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
}

interface ZodTypeDef {
  typeName: string;
  description?: string;
  defaultValue?: () => unknown;
  innerType?: ZodTypeAny;
  values?: readonly string[];
  schema?: ZodTypeAny;
  type?: ZodTypeAny;
  shape?: () => Record<string, ZodTypeAny>;
}

function getDef(z: ZodTypeAny): ZodTypeDef {
  return (z as unknown as { _def: ZodTypeDef })._def;
}

function getDescription(z: ZodTypeAny): string | undefined {
  // Zod stores `.describe()` text on `description`. Walk through wrappers
  // (ZodOptional, ZodDefault) to find it.
  let current: ZodTypeAny | undefined = z;
  while (current) {
    const def = getDef(current);
    if (def.description) return def.description;
    current = def.innerType;
  }
  return undefined;
}

function unwrapOptional(z: ZodTypeAny): { inner: ZodTypeAny; optional: boolean } {
  const def = getDef(z);
  if (def.typeName === "ZodOptional" && def.innerType) {
    return { inner: def.innerType, optional: true };
  }
  return { inner: z, optional: false };
}

function unwrapDefault(z: ZodTypeAny): { inner: ZodTypeAny; defaultValue?: unknown } {
  const def = getDef(z);
  if (def.typeName === "ZodDefault" && def.innerType && def.defaultValue) {
    return { inner: def.innerType, defaultValue: def.defaultValue() };
  }
  return { inner: z };
}

function convertLeaf(z: ZodTypeAny, description?: string): JsonSchema {
  const { inner: afterDefault, defaultValue } = unwrapDefault(z);
  const def = getDef(afterDefault);
  const desc = description ?? getDescription(z);
  const base: Partial<JsonSchema> = {};
  if (desc) base.description = desc;
  if (defaultValue !== undefined) base.default = defaultValue;

  switch (def.typeName) {
    case "ZodString":
      return { type: "string", ...base };
    case "ZodNumber":
      return { type: "number", ...base };
    case "ZodBoolean":
      return { type: "boolean", ...base };
    case "ZodEnum":
      if (!def.values) throw new Error(`zod-to-json-schema: ZodEnum without values`);
      return { type: "string", enum: def.values, ...base };
    case "ZodLiteral": {
      const value = (def as { value?: unknown }).value;
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        throw new Error(`zod-to-json-schema: ZodLiteral with unsupported value type`);
      }
      const type: "string" | "number" | "boolean" = typeof value === "boolean" ? "boolean" : (typeof value as "string" | "number");
      const out: JsonSchema = { type, ...base } as JsonSchema;
      if (typeof value === "string" || typeof value === "number") out.enum = [value];
      return out;
    }
    case "ZodArray": {
      if (!def.type) throw new Error(`zod-to-json-schema: ZodArray without item type`);
      return { type: "array", items: convertLeaf(def.type), ...base };
    }
    case "ZodObject":
      return convertObject(afterDefault, desc);
    default:
      throw new Error(
        `zod-to-json-schema: unsupported Zod type "${def.typeName}". ` +
          `Add support in packages/cli/src/tools/zod-to-json-schema.ts or use a supported variant ` +
          `(string, number, boolean, enum, literal, optional, default, array, object).`,
      );
  }
}

function convertObject(z: ZodTypeAny, description?: string): JsonSchema {
  const def = getDef(z);
  if (def.typeName !== "ZodObject" || !def.shape) {
    throw new Error(`zod-to-json-schema: convertObject called on non-ZodObject (${def.typeName})`);
  }
  const shape = def.shape();
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const { inner, optional } = unwrapOptional(value);
    const fieldDesc = getDescription(value);
    properties[key] = convertLeaf(inner, fieldDesc);
    if (!optional) required.push(key);
  }

  const out: JsonSchema = {
    type: "object",
    properties,
    required,
  };
  if (description) out.description = description;
  return out;
}

/**
 * Convert a ZodObject schema to a JSON Schema suitable for MCP `inputSchema`.
 * Throws on unsupported Zod variants.
 */
export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema {
  const def = getDef(schema);
  if (def.typeName !== "ZodObject") {
    throw new Error(`zodToJsonSchema: top-level schema must be ZodObject; got ${def.typeName}`);
  }
  return convertObject(schema);
}

/**
 * The Agent surface uses a `parameters` field that's structurally identical
 * to MCP's `inputSchema`. This is just an alias to make adapter code clearer.
 */
export const zodToAgentParameters = zodToJsonSchema;
