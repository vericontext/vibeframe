/**
 * @file scripts/gen-models.mts
 * @description Regenerate the catalog section of MODELS.md from the model
 * catalog (`packages/ai-providers/src/catalog/catalog.ts`).
 *
 *     pnpm gen:models          # rewrite the section
 *     pnpm gen:models --check  # exit 1 if MODELS.md is stale (CI, pre-push)
 *
 * Only the text between the BEGIN/END markers is generated; the narrative
 * around it stays hand-written.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { MODEL_CATALOG } = await import("../packages/ai-providers/src/catalog/catalog.js");
type Spec = (typeof MODEL_CATALOG)[number];

const ROOT = join(import.meta.dirname, "..");
const FILE = join(ROOT, "MODELS.md");
const BEGIN = "<!-- BEGIN GENERATED: model catalog (pnpm gen:models) -->";
const END = "<!-- END GENERATED: model catalog -->";

const KINDS: Array<{ kind: Spec["kind"]; title: string }> = [
  { kind: "llm", title: "LLMs" },
  { kind: "image", title: "Image" },
  { kind: "video", title: "Video" },
  { kind: "speech", title: "Speech" },
  { kind: "music", title: "Music" },
  { kind: "sound-effect", title: "Sound effects" },
  { kind: "transcription", title: "Transcription" },
];

const STATUS: Record<Spec["status"], string> = {
  ga: "GA",
  preview: "Preview",
  legacy: "Legacy",
  deprecated: "Deprecated",
};

function price(m: Spec): string {
  if (!m.price) return "";
  const usd = `$${m.price.usd}`;
  return `${usd} / ${m.price.per}${m.price.basis ? ` (${m.price.basis})` : ""}`;
}

function status(m: Spec): string {
  if (!m.shutdown) return STATUS[m.status];
  const replacement = m.replacement ? `; use ${m.replacement}` : "";
  return `${STATUS[m.status]}, shuts down ${m.shutdown}${replacement}`;
}

function render(): string {
  const out: string[] = [
    BEGIN,
    "",
    "Generated from the model catalog; edit `packages/ai-providers/src/catalog/catalog.ts`, then run `pnpm gen:models`.",
    "Prices are upper-bound list prices for estimates, not metered billing.",
  ];
  for (const { kind, title } of KINDS) {
    const models = MODEL_CATALOG.filter((m) => m.kind === kind);
    if (models.length === 0) continue;
    out.push(
      "",
      `### ${title}`,
      "",
      "| Provider | Model | ID | Aliases | Status | Price | Notes |",
      "|---|---|---|---|---|---|---|"
    );
    for (const m of models) {
      const label = m.default ? `**${m.label}** (default)` : m.label;
      const aliases = (m.aliases ?? []).map((a) => `\`${a}\``).join(", ");
      out.push(`| ${m.provider} | ${label} | \`${m.id}\` | ${aliases} | ${status(m)} | ${price(m)} | ${m.note ?? ""} |`);
    }
  }
  out.push("", END);
  return out.join("\n");
}

const current = readFileSync(FILE, "utf-8");
const start = current.indexOf(BEGIN);
const end = current.indexOf(END);
if (start === -1 || end === -1) {
  console.error(`MODELS.md is missing the generated-section markers:\n${BEGIN}\n${END}`);
  process.exit(1);
}
const next = current.slice(0, start) + render() + current.slice(end + END.length);

if (process.argv.includes("--check")) {
  if (next !== current) {
    console.error("MODELS.md catalog section is stale. Run `pnpm gen:models`.");
    process.exit(1);
  }
  console.log("MODELS.md catalog section is up to date.");
} else {
  writeFileSync(FILE, next);
  console.log(`Wrote MODELS.md catalog section (${MODEL_CATALOG.length} models).`);
}
