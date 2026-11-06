---
paths:
  - "packages/cli/src/**"
---

# Code Quality Standards

- ALWAYS run `pnpm build` after TypeScript changes to catch type errors early
- ALWAYS run `pnpm lint` after changes — fix errors before committing (0 errors policy)
- NEVER leave unused imports — remove them immediately
- NEVER suppress lint with `// eslint-disable` or `@ts-ignore` — fix the root cause
- Use `exitWithError()` from `commands/output.ts` for structured error handling (not `console.error` + `process.exit(1)`)
- Use `requireApiKey()` from `utils/api-key.ts` for API key validation (not manual checks)
- Use `hasApiKey()` for side-effect-free key detection (no prompting)
- Use `resolveProvider()` from `utils/provider-resolver.ts` for auto-fallback when default provider key is missing
