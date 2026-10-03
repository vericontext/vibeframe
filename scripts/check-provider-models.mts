/**
 * @file scripts/check-provider-models.mts
 * @description Drift check for `.agents/references/providers/*.md`.
 *
 * Each provider reference lists the model IDs our source uses
 * (`models_in_use`) and the date its facts were verified (`checked`).
 * This script reports, per file:
 *
 *  - format errors (missing frontmatter fields or sections),
 *  - listed IDs that no longer appear in `packages/*\/src` (stale list),
 *  - a `checked` date older than STALE_DAYS,
 *  - unless `--offline`, in-use IDs that the provider's free model-listing
 *    endpoint no longer returns or silently redirects to another model, and
 *    recommended IDs (`models_recommended`) it does not list.
 *
 * Run `pnpm providers:check` (live where keys exist) or
 * `pnpm providers:check --offline`. Exits 1 on format errors or on IDs a
 * provider no longer serves; staleness and code drift are warnings.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const REF_DIR = join(ROOT, ".agents", "references", "providers");
const STALE_DAYS = 45;
const SECTIONS = [
  "## API shape",
  "## Gotchas",
  "## In our code",
  "## Recommended changes",
  "## Sources",
];
const ENDPOINTS = ["anthropic", "openai", "gemini", "xai", "openrouter", "none"] as const;
type Endpoint = (typeof ENDPOINTS)[number];

interface Reference {
  file: string;
  provider: string;
  checked: string;
  endpoint: Endpoint;
  /** IDs our source calls today, most important first. */
  models: string[];
  /** IDs the reference recommends moving to. */
  recommended: string[];
}

const LISTS = ["models_in_use", "models_recommended"] as const;

const offline = process.argv.includes("--offline");
const errors: string[] = [];
const warnings: string[] = [];

if (existsSync(join(ROOT, ".env"))) {
  process.loadEnvFile(join(ROOT, ".env"));
}

function parseFrontmatter(file: string, text: string): Reference | undefined {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) {
    errors.push(`${file}: missing frontmatter`);
    return undefined;
  }
  const fields: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  let list: string[] | undefined;
  for (const raw of match[1].split("\n")) {
    const line = raw.replace(/\s+#.*$/, "");
    const item = /^\s+-\s+(\S+)/.exec(line);
    if (list && item) {
      list.push(item[1].replace(/^["']|["']$/g, ""));
      continue;
    }
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    list = (LISTS as readonly string[]).includes(kv[1]) ? (lists[kv[1]] = []) : undefined;
    if (list && kv[2].startsWith("[")) {
      list.push(
        ...kv[2]
          .replace(/^\[|\]$/g, "")
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean),
      );
    }
    fields[kv[1]] = kv[2].trim();
  }

  for (const key of ["provider", "checked", "env", "models_endpoint", ...LISTS]) {
    if (!(key in fields)) errors.push(`${file}: frontmatter is missing \`${key}\``);
  }
  if (fields.checked && !/^\d{4}-\d{2}-\d{2}$/.test(fields.checked)) {
    errors.push(`${file}: \`checked\` must be YYYY-MM-DD, got "${fields.checked}"`);
  }
  const endpoint = fields.models_endpoint as Endpoint;
  if (fields.models_endpoint && !ENDPOINTS.includes(endpoint)) {
    errors.push(`${file}: unknown models_endpoint "${fields.models_endpoint}"`);
  }
  return {
    file,
    provider: fields.provider,
    checked: fields.checked,
    endpoint,
    models: lists.models_in_use ?? [],
    recommended: lists.models_recommended ?? [],
  };
}

function sourceText(): string {
  const chunks: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "dist" || name === "__tests__") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        chunks.push(readFileSync(path, "utf-8"));
      }
    }
  };
  for (const pkg of readdirSync(join(ROOT, "packages"))) {
    const src = join(ROOT, "packages", pkg, "src");
    if (existsSync(src)) walk(src);
  }
  return chunks.join("\n");
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

/** Model IDs a provider lists today, or undefined when it cannot be probed. */
async function listModels(endpoint: Endpoint): Promise<Set<string> | undefined> {
  const env = process.env;
  switch (endpoint) {
    case "anthropic": {
      if (!env.ANTHROPIC_API_KEY) return undefined;
      const body = (await getJson("https://api.anthropic.com/v1/models?limit=1000", {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      })) as { data: { id: string }[] };
      return new Set(body.data.map((m) => m.id));
    }
    case "openai": {
      if (!env.OPENAI_API_KEY) return undefined;
      const body = (await getJson("https://api.openai.com/v1/models", {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      })) as { data: { id: string }[] };
      return new Set(body.data.map((m) => m.id));
    }
    case "gemini": {
      if (!env.GOOGLE_API_KEY) return undefined;
      const body = (await getJson(
        `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${env.GOOGLE_API_KEY}`,
      )) as { models: { name: string }[] };
      return new Set(body.models.map((m) => m.name.replace(/^models\//, "")));
    }
    case "xai": {
      if (!env.XAI_API_KEY) return undefined;
      const body = (await getJson("https://api.x.ai/v1/models", {
        Authorization: `Bearer ${env.XAI_API_KEY}`,
      })) as { data: { id: string }[] };
      return new Set(body.data.map((m) => m.id));
    }
    case "openrouter": {
      const body = (await getJson("https://openrouter.ai/api/v1/models")) as {
        data: { id: string }[];
      };
      return new Set(body.data.map((m) => m.id));
    }
    default:
      return undefined;
  }
}

/** xAI resolves retired IDs to a different model instead of failing. */
async function xaiRedirect(id: string): Promise<string | undefined> {
  const key = process.env.XAI_API_KEY;
  if (!key) return undefined;
  const response = await fetch(`https://api.x.ai/v1/models/${id}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) return undefined;
  const body = (await response.json()) as { id: string; aliases?: string[] };
  return body.id !== id && !body.aliases?.includes(id) ? body.id : undefined;
}

const files = readdirSync(REF_DIR)
  .filter((name) => name.endsWith(".md") && name !== "README.md")
  .sort();
const code = sourceText();
const today = Date.now();

for (const name of files) {
  const file = relative(ROOT, join(REF_DIR, name));
  const text = readFileSync(join(REF_DIR, name), "utf-8");
  const ref = parseFrontmatter(file, text);
  if (!ref) continue;

  if (ref.provider && `${ref.provider}.md` !== name) {
    errors.push(`${file}: provider "${ref.provider}" does not match the file name`);
  }
  let last = -1;
  for (const heading of SECTIONS) {
    const at = text.indexOf(`\n${heading}`);
    if (at === -1) errors.push(`${file}: missing section "${heading}"`);
    else if (at < last) errors.push(`${file}: section "${heading}" is out of order`);
    else last = at;
  }

  if (ref.checked) {
    const ageDays = Math.floor((today - Date.parse(ref.checked)) / 864e5);
    if (ageDays > STALE_DAYS) {
      warnings.push(`${file}: checked ${ref.checked} (${ageDays} days ago) - re-verify`);
    }
  }

  for (const id of ref.models) {
    if (!code.includes(id)) {
      warnings.push(`${file}: "${id}" is listed in models_in_use but no longer appears in packages/*/src`);
    }
  }

  if (offline || ref.endpoint === "none" || ref.models.length + ref.recommended.length === 0) continue;
  let listed: Set<string> | undefined;
  try {
    listed = await listModels(ref.endpoint);
  } catch (error) {
    warnings.push(`${file}: could not list ${ref.endpoint} models (${(error as Error).message})`);
    continue;
  }
  if (!listed) {
    warnings.push(`${file}: skipped live check (no API key for ${ref.endpoint})`);
    continue;
  }
  for (const id of ref.recommended) {
    if (!listed.has(id)) {
      errors.push(`${file}: recommended "${id}" is not listed by the ${ref.endpoint} models endpoint`);
    }
  }
  for (const id of ref.models) {
    if (!listed.has(id)) {
      const redirect = ref.endpoint === "xai" ? await xaiRedirect(id) : undefined;
      if (redirect) {
        errors.push(`${file}: "${id}" is retired; xAI silently serves "${redirect}" instead`);
      } else {
        errors.push(`${file}: "${id}" is not listed by the ${ref.endpoint} models endpoint`);
      }
    }
  }
}

for (const line of warnings) console.log(`warn  ${line}`);
for (const line of errors) console.log(`error ${line}`);
console.log(
  `\n${files.length} provider references, ${errors.length} errors, ${warnings.length} warnings${
    offline ? " (offline)" : ""
  }`,
);
process.exit(errors.length > 0 ? 1 : 0);
