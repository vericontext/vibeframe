export type SceneBuildMode = "agent" | "batch" | "auto";

/**
 * Resolve which compose path a build takes.
 *
 * `agent` is the only LLM-authored path VibeFrame ships: the host's agent
 * writes each `compositions/scene-<id>.html` and the CLI lints, syncs, and
 * renders around it. `batch` now means one thing - the deterministic
 * `--composer template` path, which authors HTML without any model.
 *
 * The mode used to also select a CLI-internal LLM composer that called
 * Claude/OpenAI/Gemini directly. That path is gone: the host agent is the
 * outer loop, and duplicating its job inside the CLI meant carrying a stale
 * copy of upstream's authoring skill and demanding an extra API key.
 * `VIBE_BUILD_MODE=batch` therefore no longer forces a model-authored build;
 * without `--composer template` it resolves to `agent`.
 */
export function resolveSceneBuildMode(opts: { mode?: SceneBuildMode }): "agent" | "batch" {
  void opts;
  return "agent";
}
