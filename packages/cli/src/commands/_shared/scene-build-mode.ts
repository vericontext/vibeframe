import { detectedAgentHosts } from "../../utils/agent-host-detect.js";

export type SceneBuildMode = "agent" | "batch" | "auto";

export function resolveSceneBuildMode(opts: { mode?: SceneBuildMode }): "agent" | "batch" {
  const env = process.env.VIBE_BUILD_MODE?.trim().toLowerCase();
  if (env === "agent" || env === "batch") return env;
  if (opts.mode === "agent" || opts.mode === "batch") return opts.mode;
  return detectedAgentHosts().length > 0 ? "agent" : "batch";
}
