---
paths:
  - "packages/mcp-server/**"
---

# MCP Server (npm package)

Published as [`@vibeframe/mcp-server`](https://www.npmjs.com/package/@vibeframe/mcp-server) on npm.

**End-user setup** (no clone/build needed):
```json
{
  "mcpServers": {
    "vibeframe": {
      "command": "npx",
      "args": ["-y", "@vibeframe/mcp-server"]
    }
  }
}
```

Config file locations:
- **Claude Desktop (macOS):** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Desktop (Windows):** `%APPDATA%\Claude\claude_desktop_config.json`
- **Cursor:** `.cursor/mcp.json` in workspace

**Bundling:** esbuild bundles all runtime code — workspace deps (`@vibeframe/cli`, `@vibeframe/core`, `@vibeframe/ai-providers`) and third-party utilities (chalk, ora, commander, yaml, dotenv) — into a single `dist/index.js` (~21MB).

**External deps** (NOT bundled — must be declared in `dependencies` or `peerDependencies`):
- `@modelcontextprotocol/sdk`, `zod` — MCP protocol; host controls version
- `@anthropic-ai/sdk`, `@google/generative-ai`, `openai` — optional AI SDKs via `peerDependencies`
- `kokoro-js` — `optionalDependencies`; transitively provides `@huggingface/transformers`, `onnxruntime-node`, `sharp` (native `.node` binaries can't be bundled). Loaded via dynamic import only when local kokoro TTS runs.

**Runtime artifacts copied next to the bundle by `build.js`:** `hyperframe.manifest.json` + `hyperframe.runtime.iife.js` (the bundled `@hyperframes/producer` resolves its verified runtime as siblings of its module file — without these every render fails with "Missing manifest").

**Why bundle everything else?** Avoids version-drift bugs: if `build.js` externals and `package.json` dependencies fall out of sync, `npx -y @vibeframe/mcp-server` fails at runtime with `ERR_MODULE_NOT_FOUND`. Bundling = one fewer thing to synchronize.

**CJS-in-ESM shim:** bundled CJS packages (e.g. commander) use `require()` at init, which esbuild's ESM output cannot resolve. The `createRequire` banner in `build.js` patches this — do NOT remove it.

**Publishing:**
```bash
cd packages/mcp-server
node build.js                    # Bundle
npm publish --access public      # Publish to npm
```
