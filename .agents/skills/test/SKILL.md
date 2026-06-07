---
name: test
description: Run VibeFrame tests for one package or the whole monorepo and summarize failures.
---

# Test

Use this skill when the user asks Codex to run or diagnose VibeFrame tests.

## Commands

- CLI package:

  ```bash
  pnpm -F @vibeframe/cli exec vitest run
  ```

- Core package:

  ```bash
  pnpm -F @vibeframe/core test
  ```

- All packages:

  ```bash
  pnpm test
  ```

## Reporting

Report the command run, pass/fail status, failed test file names, and the
smallest useful diagnosis. If a test fails, read both the failing test and the
source file it covers before proposing a fix.
