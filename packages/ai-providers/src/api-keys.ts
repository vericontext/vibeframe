/**
 * @module api-keys
 * @description Centralized declarations for API credentials and virtual
 * providers (those without a dedicated directory under `src/<id>/`).
 *
 * This file MUST be imported before any provider's `index.ts` — the provider
 * `defineProvider` calls assert that the referenced apiKey configKey was
 * already registered. `src/index.ts` enforces import order.
 *
 * Adding a new apiKey: append a `defineApiKey({...})` block. Adding a new
 * provider: typically also adds a new directory and that directory's
 * `index.ts` adds a `defineProvider` — see `define-provider.ts` for the
 * shape.
 *
 * Virtual providers (no directory): declare `defineProvider` here too. As of
 * v0.68 only `openrouter` qualifies (LLM-only, no class — agent uses
 * OpenAI-compat HTTP). `veo` is virtual but lives in `gemini/index.ts` since
 * it shares that directory.
 */

import { defineApiKey, defineProvider } from "./define-provider.js";

// ─── API keys ───────────────────────────────────────────────────────────────

defineApiKey({
  configKey: "openai",
  envVar: "OPENAI_API_KEY",
  label: "OpenAI",
  showInSetup: true,
  setupDescription:
    "gpt-image-2 image gen ($, default since v0.56), Whisper transcribe, Agent",
  envExampleComment:
    "OpenAI API Key (Whisper transcription, gpt-image-2 — default text-to-image since v0.56)",
  envExampleUrl: "https://platform.openai.com/api-keys",
});

defineApiKey({
  configKey: "google",
  envVar: "GOOGLE_API_KEY",
  label: "Google",
  showInSetup: true,
  setupDescription:
    "Gemini — image gen (free tier), video analysis ($), Veo ($$)",
  envExampleComment:
    "Google API Key (Gemini auto-edit suggestions, image gen, Veo video)",
  envExampleUrl: "https://aistudio.google.com/apikey",
});

defineApiKey({
  configKey: "anthropic",
  envVar: "ANTHROPIC_API_KEY",
  label: "Anthropic",
  showInSetup: true,
  setupDescription:
    "Claude — storyboard, color grade, reframe, Agent ($)",
  envExampleComment: "Anthropic API Key (Claude motion graphics & storyboarding)",
  envExampleUrl: "https://console.anthropic.com/",
});

defineApiKey({
  configKey: "elevenlabs",
  envVar: "ELEVENLABS_API_KEY",
  label: "ElevenLabs",
  showInSetup: true,
  setupDescription:
    "TTS ($), SFX, music, voice clone, dubbing — skip to use local Kokoro",
  envExampleComment:
    "ElevenLabs API Key (text-to-speech — Kokoro local fallback runs when this is unset, since v0.54)",
  envExampleUrl: "https://elevenlabs.io/api",
});

defineApiKey({
  configKey: "fal",
  envVar: "FAL_KEY",
  label: "fal.ai",
  showInSetup: true,
  setupDescription: "Seedance 2.0 video gen ($$, default since v0.57)",
  envExampleComment:
    "fal.ai API Key (Seedance 2.0 video — default text/image-to-video since v0.57, Artificial Analysis ELO #2)",
  envExampleUrl: "https://fal.ai/dashboard/keys",
});

defineApiKey({
  configKey: "xai",
  envVar: "XAI_API_KEY",
  label: "xAI",
  showInSetup: true,
  setupDescription:
    "Grok — video gen with audio ($$), image ($), Agent",
  envExampleComment:
    "xAI API Key (Grok video generation — fallback when no FAL_KEY)",
  envExampleUrl: "https://console.x.ai/",
});

defineApiKey({
  configKey: "runway",
  envVar: "RUNWAY_API_SECRET",
  label: "Runway",
  showInSetup: true,
  setupDescription: "Gen-4.5 video generation ($$)",
  envExampleComment: "Runway API Secret (Runway Gen-4.5 video generation)",
  envExampleUrl: "https://app.runwayml.com/settings/api-keys",
});

defineApiKey({
  configKey: "kling",
  envVar: "KLING_API_KEY",
  label: "Kling",
  showInSetup: true,
  setupDescription:
    "v2.5/v3 video — std ($$) and pro ($$$) modes",
  envExampleComment: "Kling API Key (Kling video generation)",
  envExampleUrl: "https://platform.klingai.com/",
  envExampleExtraLines: ["Format: ACCESS_KEY:SECRET_KEY"],
});

defineApiKey({
  configKey: "replicate",
  envVar: "REPLICATE_API_TOKEN",
  label: "Replicate",
  showInSetup: true,
  setupDescription: "MusicGen background music ($, max 30s)",
  envExampleComment:
    "Replicate API Token (music generation, video upscale, audio restoration)",
  envExampleUrl: "https://replicate.com/account/api-tokens",
});

defineApiKey({
  configKey: "openrouter",
  envVar: "OPENROUTER_API_KEY",
  label: "OpenRouter",
  showInSetup: true,
  setupDescription:
    "300+ models via one key — Agent only (pay per model)",
  envExampleComment:
    "OpenRouter API Key (300+ AI models via unified API, used by `vibe agent`)",
  envExampleUrl: "https://openrouter.ai/keys",
});

defineApiKey({
  configKey: "imgbb",
  envVar: "IMGBB_API_KEY",
  label: "ImgBB",
  showInSetup: false, // not prompted in setup wizard — internal upload host
  envExampleComment:
    "ImgBB API Key (image hosting — used by Kling and fal.ai for image-to-video uploads)",
  envExampleUrl: "https://api.imgbb.com/",
  // ImgBB has no provider class (envvar-only); doctor still shows what it
  // unlocks at the apiKey level.
  commandsUnlocked: [
    "generate video -p kling/fal (image-to-video upload host)",
  ],
});

// ─── Virtual providers (no directory under src/) ───────────────────────────

// Note: original COMMAND_KEY_MAP intentionally omits OPENROUTER_API_KEY
// from doctor output. We preserve that behavior by leaving
// `commandsUnlocked` empty here (not adding "agent -p openrouter"). If
// we later want to surface it, drop a single line below — the rest of
// the chain auto-derives.
defineProvider({
  id: "openrouter",
  label: "OpenRouter",
  apiKey: "openrouter",
  kinds: ["llm"],
});
