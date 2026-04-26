/**
 * Vitest config — mostly defaults. The one customisation is a tiny plugin
 * that lets `import md from "./X.md"` resolve to the file content as a
 * string. esbuild handles this in production via `loader: { ".md": "text" }`
 * (see `build.js`); vitest needs an equivalent.
 *
 * This applies to the vendored Hyperframes skill bundle under
 * `src/commands/_shared/hf-skill-bundle/` — the only `.md` imports in the
 * codebase as of v0.59.
 */

import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";

export default defineConfig({
  plugins: [
    {
      name: "vibeframe-md-as-text",
      transform(_code, id) {
        if (!id.endsWith(".md")) return null;
        const content = readFileSync(id, "utf-8");
        return {
          code: `export default ${JSON.stringify(content)};`,
          map: null,
        };
      },
    },
  ],
});
