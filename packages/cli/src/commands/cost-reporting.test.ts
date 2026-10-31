/**
 * Every paid command reports what it cost.
 *
 * Agents budget on the `costUsd` of the `--json` envelope, so a paid call
 * that reports 0 reads as free. Each non-free command either reports its
 * metered provider usage priced from the model catalog (the default of
 * `outputSuccess`), passes an explicit list-price estimate for providers the
 * meter does not cover (image and video generation), or makes no billed
 * call. This test pins which is which, so a new paid command has to choose.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

type Reporting =
  /** No `costUsd` passed: `outputSuccess` prices the metered provider usage. Unpriced models report the tier bound, flagged `costEstimated`. */
  | "metered"
  /** An explicit `costUsd` estimate from list prices or the tier bound, flagged `costEstimated`. */
  | "estimate"
  /** No billed provider call. */
  | "no-charge";

const COST_REPORTING: Record<string, { reporting: Reporting; how: string }> = {
  "generate image": { reporting: "estimate", how: "catalog price per image (estimateImageCostUsd); image providers are not metered" },
  "generate video": { reporting: "estimate", how: "Seedance token estimate, else the tier bound (realRunCost)" },
  "generate video-extend": { reporting: "estimate", how: "tier bound per extension" },
  "edit fill-gaps": { reporting: "estimate", how: "tier bound per generated gap" },
  "edit image": { reporting: "estimate", how: "catalog price per edited image" },
  "generate narration": { reporting: "metered", how: "TTS characters or Gemini audio seconds; gpt-4o-mini-tts is unpriced" },
  "generate sound-effect": { reporting: "metered", how: "requested seconds, else the measured MP3 length" },
  "generate music": { reporting: "metered", how: "requested seconds; Replicate MusicGen is unpriced" },
  "generate motion": { reporting: "metered", how: "LLM tokens" },
  "edit silence-cut": { reporting: "metered", how: "Gemini tokens with --use-gemini, else nothing billed" },
  "edit caption": { reporting: "metered", how: "transcribed audio seconds" },
  "edit translate-srt": { reporting: "metered", how: "LLM tokens" },
  "edit jump-cut": { reporting: "metered", how: "transcribed audio seconds" },
  "edit motion-overlay": { reporting: "metered", how: "LLM tokens" },
  "edit grade": { reporting: "metered", how: "LLM tokens with --style; presets bill nothing" },
  "edit speed-ramp": { reporting: "metered", how: "transcribed seconds plus LLM tokens" },
  "edit reframe": { reporting: "metered", how: "Claude vision tokens; the center crop bills nothing" },
  "inspect render": { reporting: "metered", how: "Gemini tokens with --ai; --cheap bills nothing" },
  "inspect media": { reporting: "metered", how: "Gemini tokens" },
  "inspect suggest": { reporting: "metered", how: "Gemini tokens" },
  "audio transcribe": { reporting: "metered", how: "billed audio seconds" },
  "audio isolate": { reporting: "metered", how: "unpriced in the catalog: tier bound, flagged" },
  "audio dub": { reporting: "metered", how: "transcription seconds, translation tokens, TTS characters" },
  "remix animated-caption": { reporting: "metered", how: "transcribed audio seconds" },
  "remix highlights": { reporting: "metered", how: "transcription seconds and LLM tokens" },
  "remix auto-shorts": { reporting: "metered", how: "transcription seconds and LLM tokens" },
  "storyboard revise": { reporting: "metered", how: "LLM tokens" },
  "audio list-voices": { reporting: "no-charge", how: "GET /v1/voices is not billed" },
  "audio clone-voice": { reporting: "no-charge", how: "no per-call price is listed for instant voice cloning in the ElevenLabs reference (unverified on the pricing page)" },
};

interface SchemaEntry {
  path: string;
  cost?: string;
}

function paidCommands(): string[] {
  const out = execFileSync("npx", ["tsx", resolve(here, "../index.ts"), "schema", "--list", "--json"], {
    encoding: "utf-8",
    env: process.env,
    timeout: 60_000,
  });
  return (JSON.parse(out) as SchemaEntry[])
    .filter((entry) => entry.cost && entry.cost !== "free")
    .map((entry) => entry.path.replace(".", " "));
}

/** Every `outputSuccess({ ... })` call in the command sources, as its object literal text. */
function envelopeCalls(): Array<{ file: string; command: string; body: string }> {
  const calls: Array<{ file: string; command: string; body: string }> = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!name.endsWith(".ts") || name.includes(".test.")) continue;
      const source = readFileSync(path, "utf-8");
      for (const match of source.matchAll(/outputSuccess\(\{/g)) {
        let depth = 0;
        let end = match.index! + "outputSuccess(".length;
        for (; end < source.length; end++) {
          if (source[end] === "{") depth++;
          else if (source[end] === "}" && --depth === 0) break;
        }
        const body = source.slice(match.index!, end + 1);
        const command = body.match(/command:\s*"([^"]+)"/)?.[1];
        if (command) calls.push({ file: path.slice(here.length + 1), command, body });
      }
    }
  };
  walk(here);
  return calls;
}

describe("cost reporting", () => {
  const paid = paidCommands();
  const calls = envelopeCalls().filter((call) => !/dryRun:\s*true/.test(call.body));

  it("classifies every non-free command", () => {
    expect(paid.filter((command) => !(command in COST_REPORTING))).toEqual([]);
    expect(Object.keys(COST_REPORTING).filter((command) => !paid.includes(command))).toEqual([]);
  });

  it("estimate commands pass an explicit costUsd on every real-run envelope", () => {
    const missing = calls
      .filter((call) => COST_REPORTING[call.command]?.reporting === "estimate" && !call.body.includes("costUsd"))
      .map((call) => `${call.file}: ${call.command}`);
    expect(missing).toEqual([]);
  });

  it("metered and no-charge commands leave costUsd to the meter", () => {
    const overridden = calls
      .filter((call) => {
        const reporting = COST_REPORTING[call.command]?.reporting;
        return (reporting === "metered" || reporting === "no-charge") && call.body.includes("costUsd");
      })
      .map((call) => `${call.file}: ${call.command}`);
    expect(overridden).toEqual([]);
  });
});
