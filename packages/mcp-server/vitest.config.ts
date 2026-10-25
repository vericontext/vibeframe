import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // No test may read a real provider key: see the setup file.
    setupFiles: ["../../scripts/vitest-hermetic-env.mts"],
  },
});
