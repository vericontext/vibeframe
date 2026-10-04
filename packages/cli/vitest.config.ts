import { configDefaults, defineConfig } from "vitest/config";

/**
 * Tests that drive real Chrome/Hyperframes renders or spawn the built CLI
 * many times. Together they are most of the suite's wall time, so the
 * default `pnpm test` skips them and `pnpm test:integration` (and CI, via
 * VIBE_TEST_INTEGRATION=1) runs everything.
 */
const INTEGRATION_TESTS = [
  "src/pipeline/renderers/__tests__/integration.test.ts",
  "src/commands/_shared/scene-render.test.ts",
  "src/commands/ai.test.ts",
  "src/commands/timeline.test.ts",
  "src/commands/batch.test.ts",
];

export default defineConfig({
  test: {
    exclude: process.env.VIBE_TEST_INTEGRATION
      ? configDefaults.exclude
      : [...configDefaults.exclude, ...INTEGRATION_TESTS],
  },
});
