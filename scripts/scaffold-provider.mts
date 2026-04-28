/**
 * @file scripts/scaffold-provider.mts
 * @description Generate a new AI provider scaffold under
 * `packages/ai-providers/src/<name>/`. Creates the directory + stub
 * Provider class + `index.ts` with `defineProvider` call. Updates
 * `packages/ai-providers/src/index.ts` to add the re-export line.
 *
 * Usage:
 *   pnpm scaffold:provider <name>
 *
 * Example:
 *   pnpm scaffold:provider stability
 *
 * Then:
 *   1. Edit `packages/ai-providers/src/stability/StabilityProvider.ts`
 *      to implement the `AIProvider` interface.
 *   2. (If using a NEW API credential) add `defineApiKey({...})` to
 *      `packages/ai-providers/src/api-keys.ts`.
 *   3. Edit `packages/ai-providers/src/stability/index.ts` to fill in
 *      the `defineProvider({...})` metadata (kinds, apiKey, etc.).
 *   4. Run `pnpm -r exec tsc --noEmit && pnpm -F @vibeframe/cli test`.
 *
 * The scaffold is intentionally minimal. The `defineProvider` call is
 * the only place the new provider needs to register — the 5 derived
 * consumers (provider-resolver, schema, doctor, setup, .env.example)
 * auto-update.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const rawName = args[0];

if (!rawName) {
  console.error("Usage: pnpm scaffold:provider <name>");
  console.error("Example: pnpm scaffold:provider stability");
  process.exit(2);
}

if (!/^[a-z][a-z0-9-]*$/.test(rawName)) {
  console.error(
    `Invalid name "${rawName}". Use lowercase letters, digits, and hyphens (e.g. "stability", "openai-image").`,
  );
  process.exit(2);
}

// id: matches directory name. className: PascalCase + "Provider".
const id = rawName;
const className =
  rawName
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("") + "Provider";
const instanceName = className.charAt(0).toLowerCase() + className.slice(1);

const repoRoot = resolve(import.meta.dirname, "..");
const providerDir = resolve(repoRoot, "packages/ai-providers/src", id);
const providerFile = resolve(providerDir, `${className}.ts`);
const indexFile = resolve(providerDir, "index.ts");
const aiProvidersIndex = resolve(repoRoot, "packages/ai-providers/src/index.ts");

if (existsSync(providerDir)) {
  console.error(`Provider directory already exists: ${providerDir}`);
  process.exit(1);
}

await mkdir(providerDir, { recursive: true });

// Stub Provider class
const providerSource = `/**
 * ${className} — TODO: describe what this provider does.
 *
 * Implement the methods you need from the \`AIProvider\` interface.
 * Common ones: initialize, isConfigured, generateImage, generateVideo,
 * transcribe, generateMusic, etc.
 *
 * See \`packages/ai-providers/src/interface/types.ts\` for the full contract.
 */

import type { AIProvider, AICapability, ProviderConfig } from "../interface/types.js";

export class ${className} implements AIProvider {
  id = "${id}";
  name = "${className.replace(/Provider$/, "")}";
  description = "TODO: short description shown in setup wizard";
  capabilities: AICapability[] = [
    // TODO: add AICapability values, e.g. "text-to-image", "text-to-video"
  ];
  isAvailable = true;

  private apiKey: string | null = null;

  async initialize(config: ProviderConfig): Promise<void> {
    this.apiKey = config.apiKey ?? null;
    // TODO: any other init (SDK client construction, etc.)
  }

  isConfigured(): boolean {
    return this.apiKey !== null;
  }

  // TODO: implement provider methods here, e.g.
  // async generateImage(prompt: string, options?: GenerateOptions): Promise<...> { ... }
}

export const ${instanceName} = new ${className}();
`;

await writeFile(providerFile, providerSource, "utf-8");

// index.ts — re-exports + defineProvider stub
const indexSource = `export { ${className}, ${instanceName} } from "./${className}.js";

import { defineProvider } from "../define-provider.js";

defineProvider({
  id: "${id}",
  label: "${className.replace(/Provider$/, "")}",
  // TODO: reference an existing apiKey configKey from api-keys.ts (e.g.
  //   "openai", "google", "fal"), OR add a new defineApiKey call there
  //   first and reference it here. Keep as \`null\` if this provider runs
  //   locally with no credential (like kokoro/ollama).
  apiKey: null,
  kinds: [
    // TODO: which surfaces does this provider serve?
    // "image" | "video" | "speech" | "llm" | "transcription" | "music"
  ],
  // resolverPriority: { image: 4 }, // optional: lower number = higher priority
  commandsUnlocked: [
    // TODO: list commands this provider unlocks for \`vibe doctor\`, e.g.
    // "generate image -p ${id}",
  ],
});
`;

await writeFile(indexFile, indexSource, "utf-8");

// Append re-export to ai-providers/src/index.ts
const aiProvidersIndexContent = await readFile(aiProvidersIndex, "utf-8");
const reExportLine = `export { ${className}, ${instanceName} } from "./${id}/index.js";\n`;

if (!aiProvidersIndexContent.includes(reExportLine)) {
  // Insert before the "// Re-export commonly used types" comment block, or at end if not found.
  let updated: string;
  const marker = "// Re-export commonly used types";
  if (aiProvidersIndexContent.includes(marker)) {
    updated = aiProvidersIndexContent.replace(marker, `${reExportLine}${marker}`);
  } else {
    updated = aiProvidersIndexContent + reExportLine;
  }
  await writeFile(aiProvidersIndex, updated, "utf-8");
}

console.log(`✓ Created ${providerDir}/`);
console.log(`  - ${className}.ts (stub class)`);
console.log(`  - index.ts (defineProvider call)`);
console.log(`✓ Added re-export to packages/ai-providers/src/index.ts`);
console.log("");
console.log("Next steps:");
console.log(`  1. Edit ${providerFile}`);
console.log(`     to implement the AIProvider methods you need.`);
console.log(`  2. Edit ${indexFile}`);
console.log(`     to fill in the defineProvider metadata (kinds, apiKey, etc.).`);
console.log(`  3. (If new credential) add a defineApiKey block to`);
console.log(`     packages/ai-providers/src/api-keys.ts.`);
console.log(`  4. Run \`pnpm -F @vibeframe/ai-providers build\` to compile.`);
console.log(`  5. Run \`pnpm -r exec tsc --noEmit && pnpm -F @vibeframe/cli test\` to verify.`);
console.log("");
console.log("See docs/CONTRIBUTOR_GUIDE.md for a full walkthrough.");
