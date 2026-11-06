/**
 * Which take fills each beat slot of a project, read from the build's slot
 * metadata (`.vibeframe/assets/<slot>-<beat>.json`).
 */

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { assetMetadataPath, readAssetMetadata } from "../commands/_shared/build-asset-metadata.js";
import { TAKE_SLOTS, type TakeSlot } from "./take.js";

export interface SlotHolder {
  beatId: string;
  asset: TakeSlot;
  /** True when `vibe take promote` put the take there, rather than a build. */
  promoted: boolean;
}

/** Which take fills each slot of a project, from the build's slot metadata. */
export function projectSlots(projectDir: string): Map<string, SlotHolder> {
  const slots = new Map<string, SlotHolder>();
  const dir = join(projectDir, dirname(assetMetadataPath("video", "x")));
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return slots;
  }
  const file = new RegExp(`^(${TAKE_SLOTS.join("|")})-(.+)\\.json$`);
  for (const name of names) {
    const match = file.exec(name);
    if (!match) continue;
    const asset = match[1] as TakeSlot;
    const metadata = readAssetMetadata(projectDir, asset, match[2]);
    if (metadata?.takeId && existsSync(join(projectDir, metadata.canonicalPath))) {
      slots.set(metadata.takeId, { beatId: metadata.beatId, asset, promoted: metadata.promotedCue !== undefined });
    }
  }
  return slots;
}
