/**
 * Snapshot tests pinning the derived provider arrays + commandsKeyMap to
 * the values that the previously-hardcoded source files expressed.
 *
 * These tests exist to catch silent regressions when `defineProvider` /
 * `defineApiKey` declarations drift away from CLI surface expectations.
 *
 * If a test here fails after a deliberate change, update the snapshot in
 * lockstep — but read the diff carefully: the resolver / doctor / setup
 * outputs are user-facing and changing their order or names is a UX
 * change, not just a refactor.
 */

import { describe, expect, it } from "vitest";
import {
  getProvidersFor,
  getProviderEnvVars,
  getCommandKeyMap,
  getSetupProviders,
} from "@vibeframe/ai-providers";

describe("provider registry — derived shapes match v0.67 hardcoded arrays", () => {
  it("getProvidersFor('image') matches IMAGE_PROVIDERS", () => {
    expect(getProvidersFor("image")).toEqual([
      { name: "openai", envVar: "OPENAI_API_KEY", label: "OpenAI" },
      { name: "gemini", envVar: "GOOGLE_API_KEY", label: "Gemini" },
      { name: "grok", envVar: "XAI_API_KEY", label: "Grok" },
    ]);
  });

  it("getProvidersFor('video') matches VIDEO_PROVIDERS", () => {
    expect(getProvidersFor("video")).toEqual([
      { name: "fal", envVar: "FAL_KEY", label: "fal.ai (Seedance 2.0)" },
      { name: "grok", envVar: "XAI_API_KEY", label: "Grok" },
      { name: "veo", envVar: "GOOGLE_API_KEY", label: "Veo" },
      { name: "kling", envVar: "KLING_API_KEY", label: "Kling" },
      { name: "runway", envVar: "RUNWAY_API_SECRET", label: "Runway" },
    ]);
  });

  it("getProvidersFor('speech') matches SPEECH_PROVIDERS", () => {
    expect(getProvidersFor("speech")).toEqual([
      { name: "elevenlabs", envVar: "ELEVENLABS_API_KEY", label: "ElevenLabs" },
      { name: "kokoro", envVar: null, label: "Kokoro (local)" },
    ]);
  });

  it("getProviderEnvVars() matches schema PROVIDER_ENV_VARS", () => {
    // Same set + same envvar mapping. Insertion order is preserved by
    // defineApiKey calls in api-keys.ts; the schema constant relied on the
    // declaration order in the original file. We compare as objects.
    expect(getProviderEnvVars()).toEqual({
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      google: "GOOGLE_API_KEY",
      elevenlabs: "ELEVENLABS_API_KEY",
      runway: "RUNWAY_API_SECRET",
      kling: "KLING_API_KEY",
      fal: "FAL_KEY",
      imgbb: "IMGBB_API_KEY",
      replicate: "REPLICATE_API_TOKEN",
      xai: "XAI_API_KEY",
      openrouter: "OPENROUTER_API_KEY",
    });
  });

  it("getCommandKeyMap() preserves the same set of commands per env var as doctor.ts", () => {
    // We compare as Sets because aggregating provider commandsUnlocked may
    // shift display order. The set of commands per env var is the
    // user-visible behavior we care about.
    const map = getCommandKeyMap();

    const original: Record<string, string[]> = {
      GOOGLE_API_KEY: [
        "generate image",
        "generate video -p veo",
        "edit image",
        "analyze media",
        "analyze video",
        "analyze review",
      ],
      OPENAI_API_KEY: [
        "agent -p openai",
        "generate image -p openai",
        "edit image -p openai",
        "audio transcribe",
        "edit caption",
        "edit jump-cut",
      ],
      ANTHROPIC_API_KEY: [
        "agent -p claude",
        "generate storyboard",
        "generate motion",
        "edit grade",
        "edit reframe",
        "edit speed-ramp",
        "pipeline script-to-video",
      ],
      XAI_API_KEY: [
        "agent -p xai",
        "generate image -p grok",
        "generate video -p grok",
        "edit image -p grok",
      ],
      FAL_KEY: [
        "generate video -p fal (Seedance 2.0 — default since v0.57)",
        "generate video -p fal -m fast (lower-latency variant)",
        "generate video -p fal -i <image> (image-to-video)",
      ],
      ELEVENLABS_API_KEY: [
        "generate speech",
        "generate sound-effect",
        "generate music",
        "audio voices",
        "audio voice-clone",
        "audio dub",
      ],
      KLING_API_KEY: ["generate video -p kling"],
      RUNWAY_API_SECRET: ["generate video -p runway"],
      REPLICATE_API_TOKEN: ["generate music -p replicate"],
      IMGBB_API_KEY: [
        "generate video -p kling/fal (image-to-video upload host)",
      ],
    };

    for (const [envVar, expected] of Object.entries(original)) {
      const actual = map[envVar];
      expect(actual, `missing entry for ${envVar}`).toBeDefined();
      expect(new Set(actual)).toEqual(new Set(expected));
    }

    // No extra env vars beyond the original (intentional — preserves
    // doctor display behavior; OPENROUTER_API_KEY is in PROVIDER_ENV_VARS
    // but never appeared in COMMAND_KEY_MAP).
    expect(new Set(Object.keys(map))).toEqual(new Set(Object.keys(original)));
  });

  it("getSetupProviders() matches setup.ts allProviders set", () => {
    const result = getSetupProviders();
    const keys = result.map((p) => p.key);
    expect(new Set(keys)).toEqual(
      new Set([
        "openai",
        "anthropic",
        "fal",
        "google",
        "xai",
        "elevenlabs",
        "runway",
        "kling",
        "openrouter",
        "replicate",
      ]),
    );
    // imgbb is intentionally not in setup wizard (showInSetup: false).
    expect(keys).not.toContain("imgbb");
  });
});
