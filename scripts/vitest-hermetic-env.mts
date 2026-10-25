/**
 * @file scripts/vitest-hermetic-env.mts
 * @description Vitest setup file shared by every package: no test can read a
 * real provider key.
 *
 * The CLI's `loadEnv()` walks up from its cwd and loads every `.env` it finds,
 * and a developer's repo `.env` holds real keys. Without this, the first test
 * that resolved a key loaded the repo `.env` into the worker's `process.env`,
 * where later tests and every spawned CLI inherited it, so a local test run
 * could make paid provider calls.
 *
 * `VIBE_NO_DOTENV=1` turns `loadEnv()` off in this process and in every CLI a
 * test spawns with `process.env`. Key-shaped variables exported by the shell
 * are removed, and VIBEFRAME_CONFIG_HOME points at a fresh temp dir so keys
 * saved by `vibe setup` are out of reach too. HOME stays real: the render
 * tests find Chrome through it. A test that needs a key sets a fake one
 * itself.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEY_SHAPED = /_(API_KEY|API_SECRET|API_TOKEN|ACCESS_KEY_ID|SECRET_ACCESS_KEY)$/;

for (const name of Object.keys(process.env)) {
  if (KEY_SHAPED.test(name)) delete process.env[name];
}
process.env.VIBE_NO_DOTENV = "1";
process.env.VIBEFRAME_CONFIG_HOME = mkdtempSync(join(tmpdir(), "vibe-test-config-"));
