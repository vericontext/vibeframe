import type { ElicitForm } from "../adapters/mcp.js";

/**
 * @module tools/_shared/elicit
 *
 * Pre-flight elicitation for the `build` tool: when an MCP client supports
 * elicitation, ask the user the choices the host agent would otherwise pick
 * silently (narration provider, paid backdrop generation, cost ceiling).
 * Pure functions — the MCP wiring lives in the tool's execute and the
 * server's makeElicitFn; CLI/Agent surfaces never reach this code path.
 */

/** The subset of build args that drive the question set. */
export interface BuildChoiceArgs {
  stage?: "assets" | "compose" | "sync" | "render" | "all";
  ttsProvider?: "auto" | "elevenlabs" | "kokoro";
  skipNarration?: boolean;
  skipBackdrop?: boolean;
  imageProvider?: string;
  maxCostUsd?: number;
}

const NARRATION_CHOICES = ["kokoro", "elevenlabs"] as const;
const BACKDROP_CHOICES = ["skip", "openai"] as const;

/**
 * Builds the elicitation form for a build call, asking ONLY about choices the
 * caller left unspecified. Returns null when there is nothing to ask — every
 * choice explicit, or the requested stage doesn't generate assets.
 */
export function planBuildElicitation(args: BuildChoiceArgs): ElicitForm | null {
  const assetsWillRun =
    args.stage === undefined || args.stage === "all" || args.stage === "assets";
  if (!assetsWillRun) return null;

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  const narrationUndecided =
    !args.skipNarration && (args.ttsProvider === undefined || args.ttsProvider === "auto");
  if (narrationUndecided) {
    properties.narration = {
      type: "string",
      title: "Narration voice-over",
      description: "Which TTS engine narrates the video?",
      enum: [...NARRATION_CHOICES],
      enumNames: [
        "Kokoro — free, runs locally on this machine",
        "ElevenLabs — cloud TTS, uses your ElevenLabs credits",
      ],
    };
    required.push("narration");
  }

  if (args.skipBackdrop === undefined && args.imageProvider === undefined) {
    properties.backdrop_images = {
      type: "string",
      title: "Backdrop images",
      description: "Generate AI background images for each scene?",
      enum: [...BACKDROP_CHOICES],
      enumNames: [
        "Skip — free, pure typographic scenes",
        "OpenAI — paid image generation (roughly $1-3 per video)",
      ],
    };
    required.push("backdrop_images");
  }

  if (args.maxCostUsd === undefined) {
    properties.max_cost_usd = {
      type: "number",
      title: "Max provider spend (USD)",
      description: "Abort before any paid provider call when the estimate exceeds this cap. Leave empty for no cap.",
      minimum: 0,
    };
  }

  if (Object.keys(properties).length === 0) return null;

  return {
    message:
      "VibeFrame is about to build this video. Choose how the assets are generated:",
    requestedSchema: { type: "object", properties, required },
  };
}

/**
 * Maps accepted form answers back onto build args. Unknown or invalid values
 * are ignored so a misbehaving client can never produce a worse state than
 * the defaults the user would have gotten without elicitation.
 */
export function applyElicitationAnswers<T extends BuildChoiceArgs>(
  args: T,
  content: Record<string, string | number | boolean | string[]> | undefined
): T {
  if (!content) return args;
  const next = { ...args };

  const narration = content.narration;
  if (typeof narration === "string" && (NARRATION_CHOICES as readonly string[]).includes(narration)) {
    next.ttsProvider = narration as BuildChoiceArgs["ttsProvider"];
  }

  const backdrop = content.backdrop_images;
  if (backdrop === "skip") {
    next.skipBackdrop = true;
  } else if (backdrop === "openai") {
    next.skipBackdrop = false;
    next.imageProvider = "openai";
  }

  const cap = content.max_cost_usd;
  if (typeof cap === "number" && Number.isFinite(cap) && cap >= 0) {
    next.maxCostUsd = cap;
  }

  return next;
}
